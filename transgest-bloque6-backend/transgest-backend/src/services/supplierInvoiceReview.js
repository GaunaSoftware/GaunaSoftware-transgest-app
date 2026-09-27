const {fail}=require('./plannerInventory');
const {hash,canonical}=require('./transportDocumentVersions');
const {validateBase64Upload}=require('./uploadValidation');
const normalized=v=>String(v||'').trim().toUpperCase().replace(/\s+/g,'');
const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
const cents=v=>Math.round(Number(v)*100);
function amount(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Math.abs(Number(v))<1e9?Number(v):null;}
function date(v){const s=v instanceof Date?v.toISOString().slice(0,10):clean(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:null;}
function document(input){
 const mime=clean(input.mime).toLowerCase(),name=clean(input.nombre).replace(/[\\/\r\n]/g,'_');if(!name)throw fail('Indica el nombre del documento.');
 let original;
 if(['application/xml','text/xml'].includes(mime)){
  if(!/^[a-z0-9+/]+={0,2}$/i.test(input.base64||''))throw fail('XML codificado no válido.');
  original=Buffer.from(input.base64,'base64');const xml=original.toString('utf8');
  if(!original.length||original.length>5*1024*1024||!xml.trim().startsWith('<')||/<!DOCTYPE|<!ENTITY/i.test(xml))throw fail('XML no válido, demasiado grande o con entidades externas.');
 }else{const f=validateBase64Upload({data:input.base64,mime,filename:name,maxBytes:5*1024*1024,allowedMimes:new Set(['application/pdf','image/jpeg','image/png','image/webp'])});original=Buffer.from(f.base64,'base64');}
 return {mime,name,original,sha256:hash(original)};
}
async function event(tx,c,id,actor,tipo,datos={}){await tx.query('INSERT INTO factura_proveedor_eventos(empresa_id,factura_id,actor_id,tipo,datos) VALUES($1,$2,$3,$4,$5)',[c,id,actor,tipo,JSON.stringify(datos)]);}
async function get(tx,c,id,{lock=false,original=false}={}){
 const row=(await tx.query(`SELECT id,empresa_id,proveedor_id,nombre,mime,sha256,numero,datos,extraccion,estado,version,revisada_por,revisada_at,created_at ${original?',original':''} FROM facturas_proveedor WHERE id::text=$1 AND empresa_id=$2 ${lock?'FOR UPDATE':''}`,[String(id),c])).rows[0];
 if(!row)throw fail('Factura de proveedor no encontrada.',404);return row;
}
async function receive(db,c,actor,provider,input){
 const f=document(input);
 return db.transaction(async tx=>{
  if(!(await tx.query('SELECT id FROM colaboradores WHERE id::text=$1 AND empresa_id=$2',[String(provider),c])).rows.length)throw fail('Proveedor no encontrado.',404);
  const prior=(await tx.query('SELECT id FROM facturas_proveedor WHERE empresa_id=$1 AND proveedor_id=$2 AND sha256=$3',[c,provider,f.sha256])).rows[0];if(prior)return {...await get(tx,c,prior.id),repetida:true};
  const row=(await tx.query(`INSERT INTO facturas_proveedor(empresa_id,proveedor_id,nombre,mime,original,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(empresa_id,proveedor_id,sha256) DO NOTHING RETURNING id`,[c,provider,f.name,f.mime,f.original,f.sha256,actor])).rows[0];
  const id=row?.id||(await tx.query('SELECT id FROM facturas_proveedor WHERE empresa_id=$1 AND proveedor_id=$2 AND sha256=$3',[c,provider,f.sha256])).rows[0].id;
  if(row)await event(tx,c,id,actor,'recibida',{sha256:f.sha256});return get(tx,c,id);
 });
}
async function textOf(row){
 if(hash(Buffer.from(row.original))!==row.sha256)throw fail('Fallo de integridad del documento original.',500);
 if(row.mime.includes('xml'))return Buffer.from(row.original).toString('utf8');
 if(row.mime==='application/pdf'){try{return (await require('pdf-parse/lib/pdf-parse')(Buffer.from(row.original))).text.slice(0,90000);}catch{throw fail('No se puede leer el texto de este PDF. Revisa el original o utiliza la extracción IA visual.',422);}}
 return '';
}
function parseXml(text){
 const tag=(name,scope=text)=>{const m=scope.match(new RegExp('<(?:[\\w.-]+:)?'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?'+name+'>','i'));return m?m[1].replace(/<[^>]+>/g,'').trim():null;};
 const blocks=[...text.matchAll(/<(?:[\w.-]+:)?InvoiceLine(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?InvoiceLine>/gi)];
 if(blocks.length>200)throw fail('El XML supera las 200 líneas de esta revisión. Divide el trabajo de revisión sin perder el original; no se ha importado un desglose truncado.',422);
 return {numero:[tag('InvoiceSeriesCode'),tag('InvoiceNumber')].filter(Boolean).join('')||null,fecha:date(tag('IssueDate')),moneda:tag('InvoiceCurrencyCode')||null,proveedor_cif:tag('TaxIdentificationNumber'),base:amount(tag('TotalGrossAmountBeforeTaxes')),total:amount(tag('InvoiceTotal')),impuestos:amount(tag('TotalTaxOutputs'))!==null&&amount(tag('TotalTaxesWithheld'))!==null?amount(tag('TotalTaxOutputs'))-amount(tag('TotalTaxesWithheld')):null,
  lineas:blocks.slice(0,200).map(b=>({descripcion:tag('ItemDescription',b[1]),referencia:tag('ReceiverContractReference',b[1])||tag('IssuerTransactionReference',b[1]),base:amount(tag('GrossAmount',b[1]))})),metodo:'xml_facturae_campos',advertencia:'Campos candidatos Facturae, sin validación fiscal ni firma. Revisa emisor, retenciones y desglose contra el original.'};
}
function normalize(raw={}){
 if(!Array.isArray(raw.lineas)||raw.lineas.length>200)throw fail('Indica entre una y 200 líneas de factura.');
 return {numero:clean(raw.numero,100),proveedor_cif:normalized(raw.proveedor_cif),fecha:date(raw.fecha),vencimiento:date(raw.vencimiento),moneda:clean(raw.moneda,3).toUpperCase(),base:amount(raw.base),impuestos:amount(raw.impuestos),total:amount(raw.total),nota_revision:clean(raw.nota_revision,2000),
 lineas:raw.lineas.map(l=>({descripcion:clean(l.descripcion,500),referencia:clean(l.referencia,120),fecha:date(l.fecha),origen:clean(l.origen),destino:clean(l.destino),matricula:clean(l.matricula,25),pedido_id:clean(l.pedido_id,40)||null,base:amount(l.base),impuestos:amount(l.impuestos),parcial:l.parcial===true}))};
}
async function reconcile(tx,c,provider,data){
 const cfg=(await tx.query('SELECT tolerancia_eur,tolerancia_pct FROM factura_proveedor_config WHERE empresa_id=$1',[c])).rows[0]||{tolerancia_eur:0,tolerancia_pct:0};
 const lines=[];
 for(const line of data.lineas){
  let candidates=[];
  if(line.pedido_id||line.referencia){candidates=(await tx.query(`SELECT id,numero,fecha_carga,origen,destino,matricula_colaborador,precio_colaborador,estado FROM pedidos WHERE empresa_id=$1 AND colaborador_id=$2 AND ${line.pedido_id?'id::text=$3':"(upper(numero)=upper($3) OR upper(referencia_cliente)=upper($3) OR EXISTS(SELECT 1 FROM viaje_pedidos vp WHERE vp.empresa_id=pedidos.empresa_id AND vp.pedido_id=pedidos.id AND vp.viaje_id::text=$3))"} ORDER BY id LIMIT 6`,[c,provider,line.pedido_id||line.referencia])).rows;}
  else if(line.fecha&&(line.matricula||(line.origen&&line.destino))){candidates=(await tx.query(`SELECT id,numero,fecha_carga,origen,destino,matricula_colaborador,precio_colaborador,estado FROM pedidos WHERE empresa_id=$1 AND colaborador_id=$2 AND fecha_carga=$3 AND ($4='' OR regexp_replace(upper(matricula_colaborador),'[^A-Z0-9]','','g')=$4) AND ($5='' OR lower(origen)=lower($5)) AND ($6='' OR lower(destino)=lower($6)) ORDER BY id LIMIT 6`,[c,provider,line.fecha,normalized(line.matricula).replace(/[^A-Z0-9]/g,''),line.origen,line.destino])).rows;}
  if(line.pedido_id&&!candidates.length)throw fail('El servicio seleccionado no pertenece a este proveedor y empresa.',404);
  const p=candidates.length===1?candidates[0]:null,issues=[];
  if(p){if(['cancelado','borrador'].includes(p.estado))issues.push('Servicio cancelado o borrador');if(line.fecha&&date(p.fecha_carga)!==line.fecha)issues.push('Fecha de servicio distinta');if(line.origen&&normalized(line.origen)!==normalized(p.origen))issues.push('Origen distinto');if(line.destino&&normalized(line.destino)!==normalized(p.destino))issues.push('Destino distinto');if(line.matricula&&normalized(line.matricula).replace(/[^A-Z0-9]/g,'')!==normalized(p.matricula_colaborador).replace(/[^A-Z0-9]/g,''))issues.push('Matrícula distinta');}
  lines.push({...line,pedido_id:p?.id||null,conciliacion:{estado:!p?'no_encontrado':'parcial',candidatos:candidates,incidencias:issues,precio_acordado:amount(p?.precio_colaborador),diferencia:null}});
 }
 for(const line of lines){const match=line.conciliacion;if(!line.pedido_id)continue;const group=lines.filter(l=>l.pedido_id===line.pedido_id),complete=group.every(l=>l.base!==null),sum=group.reduce((n,l)=>n+(l.base||0),0),agreed=match.precio_acordado,tolerance=Math.max(Number(cfg.tolerancia_eur),Math.abs(agreed||0)*Number(cfg.tolerancia_pct)/100);match.base_servicio=complete?sum:null;match.diferencia=complete&&agreed!==null?Math.round((sum-agreed)*100)/100:null;match.estado=match.incidencias.length?'diferencia':!complete||agreed===null||group.some(l=>l.parcial)?'parcial':Math.abs(match.diferencia)<=tolerance?'coincide':'diferencia';}
 return {lineas:lines,tolerancias:cfg,definition:'Base neta de las líneas agrupadas por pedido frente al precio acordado del colaborador. Facturación parcial se identifica expresamente; no se compara el total con IVA con un precio neto.'};
}
async function save(db,c,id,actor,input,confirm=false){
 const data=normalize(input.datos);
 return db.transaction(async tx=>{
  const row=await get(tx,c,id,{lock:true});if(row.estado==='revisada'){if(confirm&&input.revisado===true&&canonical(data)===canonical(row.datos))return row;throw fail('Factura ya revisada. Su original y revisión se conservan.',409);}if(row.version!==Number(input.version))throw fail('Otra persona ha modificado la revisión. Actualiza.',409);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[c+':supplier:'+row.proveedor_id]);
  if(data.numero){const duplicate=(await tx.query("SELECT id FROM colaborador_facturas WHERE empresa_id=$1 AND colaborador_id=$2 AND upper(regexp_replace(numero_factura,'\\s','','g'))=$3 AND factura_proveedor_id IS DISTINCT FROM $4 LIMIT 1",[c,row.proveedor_id,normalized(data.numero),id])).rows[0];if(duplicate)throw fail('Ya existe una factura recibida con ese número para el proveedor.',409);}
  const result=await reconcile(tx,c,row.proveedor_id,data);
  if(confirm){
   if(input.revisado!==true||!data.numero||!data.fecha||data.moneda!=='EUR'||!data.lineas.length||[data.base,data.impuestos,data.total].some(v=>v===null))throw fail('Revisa número, fecha, moneda EUR, bases, impuestos y líneas y confirma la revisión.');
   if(Math.abs(cents(data.base)+cents(data.impuestos)-cents(data.total))>1||data.lineas.some(l=>l.base===null||l.impuestos===null)||Math.abs(data.lineas.reduce((n,l)=>n+cents(l.base),0)-cents(data.base))>1||Math.abs(data.lineas.reduce((n,l)=>n+cents(l.impuestos),0)-cents(data.impuestos))>1)throw fail('El desglose de líneas, impuestos y total no cuadra con el original.');
   const provider=(await tx.query('SELECT cif FROM colaboradores WHERE id=$1 AND empresa_id=$2',[row.proveedor_id,c])).rows[0];if(!data.proveedor_cif||data.proveedor_cif!==normalized(provider?.cif))throw fail('Revisa el NIF del emisor: no coincide con el proveedor seleccionado.');
   if(result.lineas.some(l=>l.conciliacion.estado!=='coincide')&&!data.nota_revision)throw fail('Justifica las diferencias, líneas parciales o sin servicio antes de registrar la factura.');
  }
  try{await tx.query('UPDATE facturas_proveedor SET datos=$3,numero=$4,numero_normalizado=$5,version=version+1 WHERE id=$1 AND empresa_id=$2',[id,c,JSON.stringify(data),data.numero||null,normalized(data.numero)||null]);}catch(e){if(e.code==='23505')throw fail('Número de factura duplicado para este proveedor.',409);throw e;}
  await tx.query('DELETE FROM factura_proveedor_lineas WHERE factura_id=$1 AND empresa_id=$2',[id,c]);
  for(const [index,line]of result.lineas.entries())await tx.query('INSERT INTO factura_proveedor_lineas(empresa_id,factura_id,posicion,pedido_id,datos,conciliacion) VALUES($1,$2,$3,$4,$5,$6)',[c,id,index+1,line.pedido_id,JSON.stringify(line),JSON.stringify(line.conciliacion)]);
  if(confirm){
   const groups=new Map();for(const line of result.lineas){const key=line.pedido_id||'sin_servicio',g=groups.get(key)||{pedido_id:line.pedido_id,base:0,impuestos:0,refs:[]};g.base+=cents(line.base);g.impuestos+=cents(line.impuestos);g.refs.push(line.referencia);groups.set(key,g);}
   for(const g of groups.values()){
    // Replace only an unnumbered, unpaid forecast. Never change a received invoice.
    const prior=g.pedido_id?(await tx.query("SELECT * FROM colaborador_facturas WHERE empresa_id=$1 AND colaborador_id=$2 AND pedido_id=$3 AND NULLIF(trim(numero_factura),'') IS NULL AND estado='pendiente' AND factura_proveedor_id IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE",[c,row.proveedor_id,g.pedido_id])).rows[0]:null;
    const values=[c,row.proveedor_id,g.pedido_id,data.numero,data.fecha,data.vencimiento,g.base/100,g.base?g.impuestos/g.base*100:0,(g.base+g.impuestos)/100,id,actor,'Factura recibida revisada. Desglose fiscal y original en conciliación proveedor. '+data.nota_revision];
    if(prior){await event(tx,c,id,actor,'prevision_sustituida',{registro:prior});await tx.query(`UPDATE colaborador_facturas SET numero_factura=$4,fecha=$5,vencimiento=$6,base=$7,iva_pct=$8,total=$9,factura_proveedor_id=$10,created_by=$11,notas=$12,updated_at=now() WHERE empresa_id=$1 AND colaborador_id=$2 AND pedido_id=$3 AND id=$13`,[...values,prior.id]);}
    else await tx.query(`INSERT INTO colaborador_facturas(empresa_id,colaborador_id,pedido_id,numero_factura,fecha,vencimiento,base,iva_pct,total,factura_proveedor_id,created_by,notas,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendiente')`,values);
   }
   await tx.query("UPDATE facturas_proveedor SET estado='revisada',revisada_por=$3,revisada_at=now() WHERE id=$1 AND empresa_id=$2",[id,c,actor]);
  }
  await event(tx,c,id,actor,confirm?'revisada':'revision_guardada',{datos:data,conciliacion:result});return {...await get(tx,c,id),conciliacion:result};
 });
}
module.exports={document,get,receive,textOf,parseXml,normalize,reconcile,save,event,amount,date};
