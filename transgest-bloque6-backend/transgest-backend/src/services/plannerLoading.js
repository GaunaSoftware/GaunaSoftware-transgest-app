const crypto = require('crypto');
const {fail,decimal,text} = require('./plannerInventory');
const documents = require('./transportDocumentVersions');
const uuid = value => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value || '');
const office = user => ['gerente','trafico','administrativo'].includes(user.rol);
function state(p) {
 if(p.estado==='cancelada')return 'cancelada';
 if(p.incidencia)return 'incidencia';
 if(p.entrega_confirmada_at)return 'entregada';
 if(p.estado==='expedida')return 'en_transito';
 if(p.documentos_listos_at)return 'lista_para_salida';
 if(p.situacion_camion==='cargado')return 'cargada';
 if(p.situacion_camion==='cargando')return 'cargando';
 if(p.situacion_camion==='espera_carga')return 'en_muelle';
 return p.carretillero_id?'asignada':'planificada';
}
function billingReady(p){return p.estado==='expedida'&&!p.incidencia&&(p.billing_trigger==='departure'||!!p.entrega_confirmada_at);}
async function detail(tx,company,user,id){
 const p=(await tx.query(`SELECT r.id,r.pedido_id,r.estado,r.situacion_camion,r.version,r.carretillero_id,
 r.carga_confirmada_at,r.documentacion_estado,r.documentos_listos_at,r.entrega_confirmada_at,r.incidencia,r.billing_trigger,
 p.numero,p.referencia_cliente,p.origen,p.destino,p.fecha_carga,m.nombre AS muelle
 FROM planner_preparaciones r JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id
 LEFT JOIN planner_muelles m ON m.id=r.muelle_carga_id AND m.empresa_id=r.empresa_id
 WHERE r.id=$1 AND r.empresa_id=$2 AND ($3::boolean OR r.carretillero_id=$4)`,[id,company,office(user),user.id])).rows[0];
 if(!p)throw fail('Carga no disponible para tu usuario.',404);
 p.lineas=(await tx.query(`SELECT l.id,l.referencia,l.descripcion,l.cantidad,l.cantidad_cargada,l.unidad,l.parada,l.peso_kg,l.unidades_palet,e.almacen,e.ubicacion,e.lote
 FROM planner_preparacion_lineas l JOIN planner_existencias e ON e.id=l.existencia_id AND e.empresa_id=l.empresa_id
 WHERE l.preparacion_id=$1 AND l.empresa_id=$2 ORDER BY l.parada,l.referencia`,[id,company])).rows;
 if(office(user))p.pods=(await tx.query("SELECT id,nombre FROM pedido_docs WHERE pedido_id=$1 AND empresa_id=$2 AND (tipo ILIKE '%albaran%' OR tipo ILIKE '%pod%') ORDER BY created_at DESC LIMIT 100",[p.pedido_id,company])).rows;
 return {...p,estado_operativo:state(p),listo_facturar:billingReady(p)};
}
async function act(db,company,user,id,input){
 if(!uuid(input.operacion))throw fail('Falta el identificador de operación.');
 const fingerprint=documents.hash(documents.canonical({id,...input,operacion:undefined,version:undefined}));
 return db.transaction(async tx=>{
  const p=(await tx.query('SELECT * FROM planner_preparaciones WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[id,company])).rows[0];
  if(!p||(!office(user)&&p.carretillero_id!==user.id))throw fail('Carga no disponible para tu usuario.',404);
  const old=(await tx.query('SELECT * FROM planner_carga_operaciones WHERE empresa_id=$1 AND operacion=$2',[company,input.operacion])).rows[0];
  if(old){if(old.preparacion_id!==id||old.fingerprint!==fingerprint||old.created_by!==user.id)throw fail('Identificador utilizado en otra operación.',409);return old.resultado;}
  if(Number(input.version)!==p.version)throw fail('La carga ha cambiado. Actualiza para continuar.',409);
  if(p.estado==='cancelada'||p.entrega_confirmada_at)throw fail('La carga está cerrada.',409);
  const action=input.accion;
  if(['asignar','resolver','documentos_listos','entregada'].includes(action)&&!office(user))throw fail('Esta acción requiere tráfico.',403);
  const scoped={query:(s,a)=>tx.query(s,a),transaction:fn=>fn(tx)};
  if(action==='asignar'){
   if(!office(user)||p.estado==='expedida'||p.carga_confirmada_at)throw fail('No puedes cambiar la asignación de esta carga.',403);
   const worker=(await tx.query("SELECT id FROM usuarios WHERE id=$1 AND empresa_id=$2 AND rol='carretillero' AND activo=true",[input.carretillero_id,company])).rows[0];
   if(!worker)throw fail('Carretillero no disponible.',404);
   if(!['departure','delivery'].includes(input.billing_trigger))throw fail('Selecciona salida o entrega como hito de facturación.');
   await tx.query('UPDATE planner_preparaciones SET carretillero_id=$3,billing_trigger=$4 WHERE id=$1 AND empresa_id=$2',[id,company,worker.id,input.billing_trigger]);
  }else if(action==='incidencia'){
   if(!text(input.motivo,2000))throw fail('Describe la incidencia.');
   await tx.query('UPDATE planner_preparaciones SET incidencia=$3 WHERE id=$1 AND empresa_id=$2',[id,company,text(input.motivo,2000)]);
  }else if(action==='resolver'){
   if(!office(user)||!p.incidencia||!text(input.motivo,2000))throw fail('Tráfico debe indicar cómo se resolvió la incidencia.',409);
   await tx.query('UPDATE planner_preparaciones SET incidencia=NULL WHERE id=$1 AND empresa_id=$2',[id,company]);
  }else{
   if(p.incidencia)throw fail('Resuelve la incidencia antes de continuar.',409);
   if(action==='iniciar'){
    if(!['pendiente','espera_carga'].includes(p.situacion_camion)||p.estado!=='lista')throw fail('La mercancía debe estar preparada y el camión en muelle.',409);
    if(p.situacion_camion==='pendiente')throw fail('Tráfico debe registrar la llegada al muelle antes de iniciar la carga.',409);
    const dock=(await tx.query("SELECT r.muelle_id FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id AND m.empresa_id=r.empresa_id AND m.activo=true WHERE r.empresa_id=$1 AND r.pedido_id=$2 AND r.tipo='carga' LIMIT 1",[company,p.pedido_id])).rows[0];
    if(!dock)throw fail('Asigna un muelle activo antes de iniciar la carga.',409);
    await require('./plannerInventory').transition(scoped,company,user.id,id,{version:p.version,accion:'camion',situacion:'cargando'});
   }else if(action==='escanear'){
    if(p.situacion_camion!=='cargando'||p.carga_confirmada_at)throw fail('Inicia la carga antes de registrar mercancía.',409);
    const line=(await tx.query(`SELECT l.*,e.ubicacion,e.lote FROM planner_preparacion_lineas l
     JOIN planner_existencias e ON e.id=l.existencia_id AND e.empresa_id=l.empresa_id WHERE l.id=$1 AND l.preparacion_id=$2 AND l.empresa_id=$3`,[input.linea_id,id,company])).rows[0];
    if(!line||text(input.ubicacion)!==line.ubicacion||text(input.referencia,80)!==line.referencia||text(input.lote)!==line.lote)throw fail('Ubicación, artículo o lote no coinciden con la línea asignada.',409);
    const quantity=decimal(input.cantidad,{positive:true});
    if(Math.abs(quantity*1000-Math.round(quantity*1000))>1e-6)throw fail('Máximo tres decimales.');
    const next=Number(line.cantidad_cargada||0)+quantity;
    if(next>Number(line.cantidad)+.00001)throw fail('La lectura supera la cantidad prevista. Revisa la mercancía con tráfico.',409);
    await tx.query('UPDATE planner_preparacion_lineas SET cantidad_cargada=$4 WHERE id=$1 AND preparacion_id=$2 AND empresa_id=$3',[line.id,id,company,next]);
   }else if(action==='finalizar'){
    if(p.situacion_camion!=='cargando'||input.confirmado!==true)throw fail('Confirma la carga terminada.',409);
    const lines=(await tx.query('SELECT * FROM planner_preparacion_lineas WHERE preparacion_id=$1 AND empresa_id=$2',[id,company])).rows;
    if(!lines.length||lines.some(l=>l.cantidad_cargada===null||Number(l.cantidad)!==Number(l.cantidad_cargada)))throw fail('Falta mercancía por confirmar.',409);
    const weight=lines.reduce((n,l)=>n+Number(l.cantidad_cargada)*Number(l.peso_kg),0);
    const pallets=Math.max(lines.filter(l=>l.unidad!=='palet').reduce((n,l)=>n+Math.ceil(Number(l.cantidad_cargada)/Number(l.unidades_palet)),0),lines.filter(l=>l.unidad==='palet').reduce((n,l)=>n+Number(l.cantidad_cargada),0));
    const changed=(await tx.query("UPDATE pedidos SET peso_kg=$3,palets_cantidad=$4,bultos=$4,mercancia=$5 WHERE id=$1 AND empresa_id=$2 AND estado::text NOT IN ('cancelado','entregado','facturado') RETURNING id",[p.pedido_id,company,Number(weight.toFixed(3)),pallets,[...new Set(lines.map(l=>l.referencia+' · '+l.descripcion))].join('; ').slice(0,200)])).rows[0];
    if(!changed)throw fail('El viaje ha sido cerrado por tráfico. Actualiza la carga.',409);
    const photo=Buffer.from(input.foto_base64||'','base64');
    const mime=input.foto_mime;
    if(photo.length>5*1024*1024||photo.length<12||!((mime==='image/jpeg'&&photo[0]===255&&photo[1]===216)||(mime==='image/png'&&photo.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))))throw fail('Adjunta una foto JPEG o PNG válida, hasta 5 MB.');
    const docId=crypto.randomUUID();
    await tx.query(`INSERT INTO pedido_docs(id,empresa_id,pedido_id,tipo,nombre,file_mime,file_base64,file_size_kb) VALUES($1,$2,$3,'foto_carga','Carga confirmada',$4,$5,$6)`,[docId,company,p.pedido_id,mime,photo.toString('base64'),Math.ceil(photo.length/1024)]);
    await tx.query("UPDATE planner_preparaciones SET carga_confirmada_at=now(),carga_foto_id=$3,carga_fin_at=now(),situacion_camion='cargado' WHERE id=$1 AND empresa_id=$2",[id,company,docId]);
    await require('./plannerDocumentation').closedLoad(tx,company,user.id,p,process.env.PUBLIC_API_URL||process.env.API_PUBLIC_URL||process.env.RENDER_EXTERNAL_URL||process.env.PUBLIC_APP_URL||'');
    await tx.query(`INSERT INTO notificaciones_internas(empresa_id,usuario_id,tipo,titulo,mensaje,data,created_by)
     SELECT p.empresa_id,u.id,'planner.cargada','Carga terminada','Revisa la documentación antes de confirmar la salida.',jsonb_build_object('pedido_id',p.id),$3
     FROM pedidos p JOIN usuarios u ON u.empresa_id=p.empresa_id AND u.chofer_id=p.chofer_id AND u.activo=true AND u.rol='chofer'
     WHERE p.id=$1 AND p.empresa_id=$2`,[p.pedido_id,company,user.id]);
   }else if(action==='documentos_listos'){
    if(!office(user)||p.situacion_camion!=='cargado')throw fail('Tráfico debe revisar la documentación del camión cargado.',409);
    const order=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2',[p.pedido_id,company])).rows[0];
    await documents.assertDeparture(tx,company,order,input);
    await tx.query('UPDATE planner_preparaciones SET documentos_listos_at=now() WHERE id=$1 AND empresa_id=$2',[id,company]);
   }else if(action==='entregada'){
    if(!office(user)||p.estado!=='expedida'||input.confirmado!==true)throw fail('Confirma la entrega de una carga expedida.',409);
    const pod=(await tx.query("SELECT id FROM pedido_docs WHERE id=$1 AND empresa_id=$2 AND pedido_id=$3 AND (tipo ILIKE '%albaran%' OR tipo ILIKE '%pod%')",[input.pod_id,company,p.pedido_id])).rows[0];
    if(!pod)throw fail('Selecciona el POD de esta carga.',409);
    const delivered=(await tx.query("UPDATE pedidos SET estado=CASE WHEN estado::text='facturado' THEN estado ELSE 'entregado'::estado_pedido END,descarga_real_at=COALESCE(descarga_real_at,now()) WHERE id=$1 AND empresa_id=$2 AND estado::text<>'cancelado' RETURNING descarga_real_at",[p.pedido_id,company])).rows[0];
    if(!delivered)throw fail('La carga se ha cancelado. Revisa el viaje con tráfico.',409);
    await tx.query('UPDATE planner_preparaciones SET entrega_confirmada_at=now() WHERE id=$1 AND empresa_id=$2',[id,company]);
    await tx.query(`INSERT INTO transport_document_events(empresa_id,document_id,event,effective_at,created_by,reason)
     SELECT empresa_id,id,'service_completed',$3,$4,'Entrega Planner revisada con POD' FROM transport_document_versions d WHERE empresa_id=$1 AND pedido_id=$2
     AND NOT EXISTS(SELECT 1 FROM transport_document_events e WHERE e.empresa_id=d.empresa_id AND e.document_id=d.id AND e.event='service_completed')`,[company,p.pedido_id,delivered.descarga_real_at,user.id]);
   }else throw fail('Acción no reconocida.');
  }
  if(action!=='iniciar')await tx.query('UPDATE planner_preparaciones SET version=version+1 WHERE id=$1 AND empresa_id=$2',[id,company]);
  const result=await detail(tx,company,user,id);
  await tx.query('INSERT INTO planner_carga_operaciones(empresa_id,operacion,preparacion_id,accion,fingerprint,resultado,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[company,input.operacion,id,action,fingerprint,JSON.stringify(result),user.id]);
  await tx.query('INSERT INTO planner_eventos(empresa_id,pedido_id,preparacion_id,tipo,datos,created_by) VALUES($1,$2,$3,$4,$5,$6)',[company,p.pedido_id,id,'carga.'+action,JSON.stringify({operacion:input.operacion,linea_id:input.linea_id,cantidad:input.cantidad,motivo:text(input.motivo,2000),estado:result.estado_operativo}),user.id]);
  return result;
 });
}
module.exports={state,billingReady,office,detail,act};
