const crypto=require('crypto'),inventory=require('./plannerInventory'),{hash,canonical}=require('./transportDocumentVersions');
const {fail,text,decimal}=inventory;
const uuid=v=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v||'');
function quantity(v,positive=true){const n=decimal(v,{positive});if(Math.abs(n*1000-Math.round(n*1000))>1e-6)throw fail('Cantidad con máximo tres decimales.');return n;}
function gs1Check(value){if(!/^\d+$/.test(value))return false;let sum=0;for(let i=value.length-2,weight=3;i>=0;i--,weight=4-weight)sum+=Number(value[i])*weight;return (10-sum%10)%10===Number(value.at(-1));}
function parseGs1(raw){
 const input=String(raw||'').trim().replace(/^\]d2/,'');if(input.length>240)throw fail('Código demasiado largo.');
 const sizes={'00':18,'01':14,'17':6,'10':null,'21':null,'37':null},out={};let rest=input;
 while(rest){rest=rest.replace(/^\x1d/,'');if(!rest)break;const bracket=rest.match(/^\((\d{2})\)/),ai=bracket?.[1]||rest.slice(0,2);
  if(!Object.hasOwn(sizes,ai)||out[ai]!==undefined)throw fail('Código GS1 no admitido o identificador duplicado.');rest=rest.slice(bracket?4:2);
  let value;if(sizes[ai]){value=rest.slice(0,sizes[ai]);rest=rest.slice(sizes[ai]);if(!new RegExp('^\\d{'+sizes[ai]+'}$').test(value))throw fail('Longitud GS1 no válida.');}
  else{const split=rest.search(bracket?/\(\d{2}\)|\x1d/:/\x1d/);value=split<0?rest:rest.slice(0,split);rest=split<0?'':rest.slice(split);if(!value||value.length>(ai==='37'?8:20))throw fail('Valor GS1 de longitud no válida.');}
  out[ai]=value;
 }
 if(!Object.keys(out).length)throw fail('Código GS1 vacío.');
 for(const key of ['00','01'])if(out[key]&&!gs1Check(out[key]))throw fail('Dígito de control GS1 incorrecto.');
 if(out['37']&&!/^\d+$/.test(out['37']))throw fail('Cantidad GS1 no válida.');
 if(out['17']){const y=2000+Number(out['17'].slice(0,2)),m=Number(out['17'].slice(2,4)),d=Number(out['17'].slice(4));if(m<1||m>12||d>new Date(Date.UTC(y,m,0)).getUTCDate())throw fail('Fecha GS1 no válida.');}
 return {sscc:out['00'],gtin:out['01'],lote:out['10'],serie:out['21'],caducidad_yymmdd:out['17'],cantidad:out['37']?Number(out['37']):undefined};
}
async function stock(tx,company,id){const s=(await tx.query('SELECT * FROM planner_existencias WHERE empresa_id=$1 AND id::text=$2 FOR UPDATE',[company,String(id)])).rows[0];if(!s)throw fail('Existencias no encontradas.',404);return s;}
async function location(tx,company,id){const l=(await tx.query('SELECT * FROM planner_ubicaciones WHERE empresa_id=$1 AND id::text=$2 AND activo=true',[company,String(id)])).rows[0];if(!l)throw fail('Ubicación activa no encontrada.',404);return l;}
async function act(db,company,user,input){
 if(!uuid(input.operacion))throw fail('Falta el identificador de operación.');
 const fingerprint=hash(canonical({...input,operacion:undefined}));
 return db.transaction(async tx=>{
  // Only WMS writes in this tenant are serialized. Other tenants remain independent.
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[company+':wms']);
  const prior=(await tx.query('SELECT * FROM planner_wms_operaciones WHERE empresa_id=$1 AND operacion=$2',[company,input.operacion])).rows[0];
  if(prior){if(prior.fingerprint!==fingerprint||prior.created_by!==user)throw fail('Identificador utilizado para otra operación.',409);return prior.datos;}
  const scoped={query:(...a)=>tx.query(...a),transaction:fn=>fn(tx)};let result;
  const action=input.accion;
  if(action==='regla_reposicion'){
   result=await require('./plannerAutomation').saveRule(tx,company,user,input);
  }else if(action==='reponer_propuesta'){
   result=await require('./plannerAutomation').apply(scoped,company,user,input);
  }else if(action==='ubicacion'){
   const almacen=text(input.almacen),codigo=text(input.codigo);if(!almacen||!codigo)throw fail('Indica almacén y código de ubicación.');
   result=(await tx.query('INSERT INTO planner_ubicaciones(empresa_id,almacen,codigo,zona,pasillo,estanteria,nivel) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[company,almacen,codigo,text(input.zona),text(input.pasillo),text(input.estanteria),text(input.nivel)])).rows[0];
  }else if(action==='asn'){
   if(!text(input.referencia,160)||!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha_prevista||'')||!Array.isArray(input.lineas)||input.lineas.length<1||input.lineas.length>100)throw fail('Indica referencia, fecha prevista y entre 1 y 100 líneas.');
   const lines=[];
   for(const l of input.lineas){const article=(await tx.query('SELECT id,referencia FROM planner_articulos WHERE empresa_id=$1 AND id::text=$2 AND activo',[company,String(l.articulo_id)])).rows[0];if(!article)throw fail('Artículo no disponible.',404);lines.push({id:crypto.randomUUID(),articulo_id:article.id,referencia:article.referencia,prevista:quantity(l.cantidad),recibida:0});}
   result=(await tx.query('INSERT INTO planner_asn(empresa_id,referencia,fecha_prevista,lineas,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[company,text(input.referencia,160),input.fecha_prevista,JSON.stringify(lines),user])).rows[0];
  }else if(action==='recibir'){
   const asn=(await tx.query('SELECT * FROM planner_asn WHERE empresa_id=$1 AND id::text=$2 FOR UPDATE',[company,String(input.asn_id)])).rows[0];
   if(!asn||asn.estado==='cerrada')throw fail('Recepción no disponible.',409);
   const index=asn.lineas.findIndex(l=>l.id===input.linea_id);if(index<0)throw fail('Línea no encontrada.',404);
   const line=asn.lineas[index],loc=await location(tx,company,input.ubicacion_id),amount=quantity(input.cantidad);
   const moved=await inventory.move(scoped,company,user,{articulo_id:line.articulo_id,tipo:'recepcion',almacen:loc.almacen,ubicacion:loc.codigo,lote:text(input.lote),caducidad:input.caducidad||null,cantidad:amount,motivo:'Recepción ASN '+asn.referencia,referencia:asn.referencia,operacion:crypto.randomUUID()});
   // Mixing a new unchecked receipt with released stock quarantines that lot/location.
   await tx.query("UPDATE planner_existencias SET calidad='pendiente',recepcion_real_at=CASE WHEN cantidad=$3 THEN now() ELSE recepcion_real_at END WHERE id=$1 AND empresa_id=$2",[moved.id,company,amount]);
   line.recibida=Number((Number(line.recibida)+amount).toFixed(3));
   const state=asn.lineas.every(l=>l.recibida>=l.prevista)?'recibida':'parcial';
   await tx.query('UPDATE planner_asn SET lineas=$3,estado=$4 WHERE id=$1 AND empresa_id=$2',[asn.id,company,JSON.stringify(asn.lineas),state]);
   result={existencia_id:moved.id,asn_id:asn.id,estado:state,discrepancia:line.recibida-line.prevista,calidad:'pendiente'};
  }else if(action==='cerrar_asn'){
   const asn=(await tx.query('SELECT * FROM planner_asn WHERE empresa_id=$1 AND id::text=$2 FOR UPDATE',[company,String(input.asn_id)])).rows[0];
   if(!asn||asn.estado==='cerrada')throw fail('Recepción no disponible.',409);
   if(!text(input.motivo,2000))throw fail('Indica el resultado de la revisión y las discrepancias.');
   await tx.query("UPDATE planner_asn SET estado='cerrada',cierre_motivo=$3 WHERE id=$1 AND empresa_id=$2",[asn.id,company,text(input.motivo,2000)]);result={id:asn.id,estado:'cerrada',discrepancias:asn.lineas.filter(l=>l.prevista!==l.recibida)};
  }else if(action==='calidad'){
   const s=await stock(tx,company,input.existencia_id);
   if(!['liberado','bloqueado'].includes(input.calidad)||!text(input.motivo,2000))throw fail('Indica decisión y motivo de calidad.');
   if(Number(input.version)!==s.version)throw fail('Las existencias han cambiado; vuelve a revisar el lote.',409);
   await tx.query('UPDATE planner_existencias SET calidad=$3 WHERE id=$1 AND empresa_id=$2',[s.id,company,input.calidad]);result={id:s.id,calidad:input.calidad};
  }else if(action==='trasladar'){
   const s=await stock(tx,company,input.existencia_id),loc=await location(tx,company,input.ubicacion_id),amount=quantity(input.cantidad);
   if(s.almacen===loc.almacen&&s.ubicacion===loc.codigo)throw fail('Selecciona otra ubicación.');
   if(s.version!==Number(input.version)||!text(input.motivo,2000))throw fail('Actualiza el stock e indica el motivo del traslado.',409);
   const target=(await tx.query('SELECT * FROM planner_existencias WHERE empresa_id=$1 AND articulo_id=$2 AND almacen=$3 AND ubicacion=$4 AND lote=$5 FOR UPDATE',[company,s.articulo_id,loc.almacen,loc.codigo,s.lote])).rows[0];
   if(target&&target.calidad!==s.calidad&&Number(target.cantidad)>0)throw fail('La ubicación destino contiene el mismo lote con otra situación de calidad.',409);
   const common={articulo_id:s.articulo_id,tipo:'ajuste',lote:s.lote,caducidad:s.caducidad?new Date(s.caducidad).toISOString().slice(0,10):null,motivo:text(input.motivo,2000),referencia:'Traslado '+input.operacion};
   await inventory.move(scoped,company,user,{...common,almacen:s.almacen,ubicacion:s.ubicacion,cantidad:-amount,operacion:crypto.randomUUID()});
   const dest=await inventory.move(scoped,company,user,{...common,almacen:loc.almacen,ubicacion:loc.codigo,cantidad:amount,operacion:crypto.randomUUID()});
   await tx.query('UPDATE planner_existencias SET calidad=$3,recepcion_real_at=CASE WHEN cantidad=$5 THEN $4 WHEN recepcion_real_at IS NULL OR $4::timestamptz IS NULL THEN NULL ELSE LEAST(recepcion_real_at,$4) END WHERE id=$1 AND empresa_id=$2',[dest.id,company,s.calidad,s.recepcion_real_at,amount]);result={origen:s.id,destino:dest.id,cantidad:amount};
  }else if(action==='abrir_conteo'){
   const s=await stock(tx,company,input.existencia_id);
   result=(await tx.query("SELECT * FROM planner_conteos WHERE empresa_id=$1 AND existencia_id=$2 AND estado='pendiente' AND stock_version=$3 ORDER BY created_at DESC LIMIT 1",[company,s.id,s.version])).rows[0];
   if(!result)result=(await tx.query('INSERT INTO planner_conteos(empresa_id,existencia_id,stock_version,cantidad_sistema,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[company,s.id,s.version,s.cantidad,user])).rows[0];
  }else if(action==='confirmar_conteo'){
   const count=(await tx.query('SELECT * FROM planner_conteos WHERE empresa_id=$1 AND id::text=$2 FOR UPDATE',[company,String(input.conteo_id)])).rows[0];
   if(!count||count.estado!=='pendiente')throw fail('Conteo no disponible.',409);
   const s=await stock(tx,company,count.existencia_id),actual=quantity(input.cantidad,false);
   if(s.version!==count.stock_version)throw fail('Hubo movimientos después de abrir el conteo. Abre un conteo nuevo.',409);
   if(!text(input.motivo,2000))throw fail('Indica el motivo o resultado del conteo.');
   const difference=Number((actual-Number(s.cantidad)).toFixed(3));
   if(difference)await inventory.move(scoped,company,user,{articulo_id:s.articulo_id,tipo:'ajuste',almacen:s.almacen,ubicacion:s.ubicacion,lote:s.lote,caducidad:s.caducidad?new Date(s.caducidad).toISOString().slice(0,10):null,cantidad:difference,motivo:text(input.motivo,2000),referencia:'Conteo '+count.id,operacion:crypto.randomUUID()});
   await tx.query("UPDATE planner_conteos SET cantidad_contada=$3,estado='confirmado',motivo=$4,confirmed_at=now() WHERE id=$1 AND empresa_id=$2",[count.id,company,actual,text(input.motivo,2000)]);result={id:count.id,diferencia:difference,cantidad:actual};
  }else if(action==='gtin'){
   const value=String(input.gtin||'');if(!/^\d{14}$/.test(value)||!gs1Check(value))throw fail('GTIN-14 o dígito de control no válido.');
   result=(await tx.query('UPDATE planner_articulos SET gtin=$3,version=version+1 WHERE empresa_id=$1 AND id::text=$2 RETURNING id,gtin',[company,String(input.articulo_id),value])).rows[0];if(!result)throw fail('Artículo no encontrado.',404);
  }else if(action==='packing'){
   const p=(await tx.query('SELECT * FROM planner_preparaciones WHERE empresa_id=$1 AND id::text=$2 FOR UPDATE',[company,String(input.preparacion_id)])).rows[0];
   if(!p||!['preparando','lista'].includes(p.estado))throw fail('Preparación no disponible.',409);
   const sscc=String(input.sscc||'');if(!/^\d{18}$/.test(sscc)||!gs1Check(sscc))throw fail('Introduce el SSCC-18 asignado a la unidad logística, con dígito de control válido.');
   if(!Array.isArray(input.lineas)||!input.lineas.length||input.lineas.length>200)throw fail('Indica el contenido de la unidad logística.');
   const lines=(await tx.query('SELECT id,cantidad FROM planner_preparacion_lineas WHERE preparacion_id=$1 AND empresa_id=$2',[p.id,company])).rows;
   const packs=(await tx.query('SELECT lineas FROM planner_bultos_sscc WHERE preparacion_id=$1 AND empresa_id=$2',[p.id,company])).rows;
   const allocated=new Map();for(const pack of packs)for(const l of pack.lineas)allocated.set(l.linea_id,(allocated.get(l.linea_id)||0)+Number(l.cantidad));
   const items=input.lineas.map(l=>({linea_id:l.linea_id,cantidad:quantity(l.cantidad)}));
   for(const l of items){const line=lines.find(x=>x.id===l.linea_id);const sum=(allocated.get(l.linea_id)||0)+l.cantidad;if(!line||sum>Number(line.cantidad)+.00001)throw fail('El contenido excede la mercancía de esa línea.',409);allocated.set(l.linea_id,sum);}
   result=(await tx.query('INSERT INTO planner_bultos_sscc(empresa_id,preparacion_id,sscc,lineas,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,sscc,lineas',[company,p.id,sscc,JSON.stringify(items),user])).rows[0];
  }else if(action==='checkin'){
   const booking=(await tx.query("SELECT r.* FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id AND m.empresa_id=r.empresa_id AND m.activo WHERE r.empresa_id=$1 AND r.id::text=$2 AND r.tipo='carga' FOR UPDATE OF r",[company,String(input.reserva_id)])).rows[0];if(!booking?.pedido_id)throw fail('Reserva de carga no encontrada.',404);
   const p=(await tx.query("SELECT * FROM planner_preparaciones WHERE empresa_id=$1 AND pedido_id=$2 AND estado NOT IN ('cancelada','expedida') FOR UPDATE",[company,booking.pedido_id])).rows[0];if(!p||p.situacion_camion!=='pendiente')throw fail('La carga ya registró su llegada o no está preparada.',409);
   result=await inventory.transition(scoped,company,user,p.id,{accion:'camion',situacion:'espera_carga',version:p.version});
   result={preparacion_id:p.id,muelle_id:booking.muelle_id,estado:'en_muelle'};
  }else throw fail('Operación WMS no reconocida.');
  await tx.query('INSERT INTO planner_wms_operaciones(empresa_id,operacion,tipo,fingerprint,datos,created_by) VALUES($1,$2,$3,$4,$5,$6)',[company,input.operacion,action,fingerprint,JSON.stringify({resultado:result,motivo:text(input.motivo,2000)}),user]);
  return {resultado:result,motivo:text(input.motivo,2000)};
 });
}
async function suggest(db,company,article,method){
 if(!['FIFO','FEFO'].includes(method))throw fail('Selecciona FIFO o FEFO.');
 const rows=(await db.query(`SELECT e.*,a.referencia,a.unidad FROM planner_existencias e JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id
 WHERE e.empresa_id=$1 AND e.articulo_id::text=$2 AND a.activo AND e.cantidad>e.reservado
 AND e.calidad='liberado' AND (e.caducidad IS NULL OR e.caducidad>=(now() AT TIME ZONE 'Europe/Madrid')::date)
 ORDER BY CASE WHEN $3='FEFO' THEN e.caducidad END NULLS LAST,e.recepcion_real_at NULLS LAST,e.id LIMIT 200`,[company,String(article),method])).rows;
 return {metodo:method,datos:rows,limite:200,cobertura:rows.some(r=>method==='FIFO'?!r.recepcion_real_at:!r.caducidad)?'parcial':rows.length?'completo':'sin_datos',criterio:method==='FIFO'?'Primera recepción registrada; las fechas desconocidas quedan al final.':'Caducidad más próxima, después primera recepción; desconocidos al final. No reserva automáticamente.'};
}
module.exports={act,suggest,parseGs1,gs1Check};
