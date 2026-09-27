const crypto=require('crypto'),{fail}=require('./plannerInventory'),{hash,canonical}=require('./transportDocumentVersions');
const {encryptSecret,decryptSecret}=require('./apiKeys');
const normalized=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const catalog={pedidos:'Encargos y mercancía',estados:'Estados e incidencias',recursos:'Matrículas y nombre del conductor',eta:'ETA disponible',gps:'Posición GPS actual durante el servicio',documentos:'Documentos de transporte',pod:'Justificantes de entrega',slots:'Solicitudes y reservas de muelle'};
catalog.facturas='Facturas de los encargos compartidos y estado de revisión';
const allowed=(link,scope)=>Boolean(link?.activo&&!link.revocada_at&&link.consentimiento_origen_at&&link.consentimiento_destino_at&&link.scopes?.includes(scope));
function scopes(value){if(!Array.isArray(value)||!value.includes('pedidos')||value.some(s=>!Object.hasOwn(catalog,s)))throw fail('Selecciona encargos y los permisos de intercambio admitidos.');return [...new Set(value)].sort();}
function termsData(p){return {id:p.id,numero:p.numero,colaborador_id:p.colaborador_id,precio_colaborador:p.precio_colaborador,origen:p.origen,destino:p.destino,fecha_carga:p.fecha_carga,fecha_descarga:p.fecha_descarga};}
function terms(p){return hash(canonical(termsData(p)));}
async function manager(tx,company,user){if(!(await tx.query("SELECT u.id FROM usuarios u JOIN usuario_empresas m ON m.usuario_id=u.id WHERE u.id=$1 AND m.empresa_id=$2 AND m.rol='gerente' AND u.activo AND m.activo",[user,company])).rows.length)throw fail('Solo gerencia de esta empresa puede autorizar conexiones.',403);}
async function event(tx,company,user,type,{link=null,invite=null,data={}}={}){await tx.query('INSERT INTO network_eventos(empresa_id,created_by,tipo,conexion_id,invitacion_id,datos) VALUES($1,$2,$3,$4,$5,$6)',[company,user||null,type,link,invite,JSON.stringify(data)]);}
async function target(tx,company,collaborator){
 const c=(await tx.query('SELECT nombre,cif FROM colaboradores WHERE id::text=$1 AND empresa_id=$2',[String(collaborator),company])).rows[0];if(!c||!normalized(c.cif))throw fail('Colaborador con NIF/CIF no encontrado.',404);
 const rows=(await tx.query("SELECT e.id,e.nombre,e.cif FROM empresas e LEFT JOIN empresa_productos ep ON ep.empresa_id=e.id WHERE regexp_replace(upper(e.cif),'[^A-Z0-9]','','g')=$1 AND e.id<>$2 AND e.estado IN ('activo','activa') AND e.plan IN ('profesional','enterprise','pro','pro_intelligence','pro_planner') AND COALESCE(ep.modalidad,'transgest')<>'planner'",[normalized(c.cif),company])).rows;
 if(rows.length!==1)throw fail(rows.length?'Hay varias empresas con ese NIF; revisa la identidad antes de conectar.':'No hay una empresa TransGest Pro disponible con ese NIF/CIF.',409);return rows[0];
}
async function invite(db,company,user,input){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.operacion||''))throw fail('Falta identificador de operación.');
 const selected=scopes(input.scopes),fingerprint=hash(canonical({pedido_id:input.pedido_id,scopes:selected}));
 return db.transaction(async tx=>{
  await manager(tx,company,user);await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[company+':network']);
  const prior=(await tx.query('SELECT * FROM network_invitaciones WHERE empresa_id=$1 AND operacion=$2',[company,input.operacion])).rows[0];
  if(prior){if(prior.created_by!==user||prior.fingerprint!==fingerprint||prior.revocada_at)throw fail('La operación pertenece a otra invitación o está revocada.',409);return {id:prior.id,token:decryptSecret(prior.token_encrypted),scopes:prior.scopes,expires_at:prior.expires_at};}
  const order=(await tx.query('SELECT * FROM pedidos WHERE id::text=$1 AND empresa_id=$2 FOR UPDATE',[String(input.pedido_id),company])).rows[0];
  if(!order||!order.colaborador_id)throw fail('Selecciona un pedido propio con colaborador.',404);
  if(['cancelado','entregado','facturado','borrador'].includes(order.estado))throw fail('El pedido no admite una invitación.',409);
  if(order.precio_colaborador===null||!Number.isFinite(Number(order.precio_colaborador)))throw fail('Registra el precio acordado con el colaborador.',409);
  const recipient=await target(tx,company,order.colaborador_id),token=crypto.randomBytes(32).toString('hex');
  const row=(await tx.query(`INSERT INTO network_invitaciones(empresa_id,transportista_empresa_id,colaborador_id,pedido_id,scopes,condiciones_hash,token_hash,token_encrypted,operacion,fingerprint,created_by,condiciones,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '7 days') RETURNING id,expires_at`,[company,recipient.id,order.colaborador_id,order.id,JSON.stringify(selected),terms(order),hash(token),encryptSecret(token),input.operacion,fingerprint,user,JSON.stringify(termsData(order))])).rows[0];
  await event(tx,company,user,'invitacion.creada',{invite:row.id,data:{scopes:selected,pedido_id:order.id}});
  return {...row,token,scopes:selected,destinatario:recipient.nombre};
 });
}
async function invitation(tx,company,token,lock=false){
 if(!/^[a-f0-9]{64}$/i.test(token||''))throw fail('Código de invitación inválido.');
 const row=(await tx.query(`SELECT n.*,e.nombre AS cargador,e.cif AS cargador_cif,t.cif AS transportista_cif FROM network_invitaciones n JOIN empresas e ON e.id=n.empresa_id JOIN empresas t ON t.id=n.transportista_empresa_id WHERE n.token_hash=$1 AND n.transportista_empresa_id=$2 AND n.revocada_at IS NULL AND n.expires_at>now() ${lock?'FOR UPDATE OF n':''}`,[hash(token),company])).rows[0];
 if(!row)throw fail('Invitación Network no disponible. Solicita al remitente una invitación nueva desde Conexiones.',404);
 // Identity and eligibility are checked again, not just when the invitation was issued.
 const recipient=await target(tx,row.empresa_id,row.colaborador_id);if(recipient.id!==company)throw fail('La identidad de la empresa invitada ha cambiado.',409);
 return row;
}
async function preview(db,company,user,token){await manager(db,company,user);const n=await invitation(db,company,token);const p=n.condiciones;return {id:n.id,cargador:n.cargador,cif:n.cargador_cif,scopes:n.scopes,expires_at:n.expires_at,encargo:p,aceptada:Boolean(n.aceptada_at)};}
async function accept(db,company,user,input){
 if(input.acepta_condiciones!==true)throw fail('Confirma las condiciones y permisos de intercambio.');
 return db.transaction(async tx=>{
  await manager(tx,company,user);const n=await invitation(tx,company,input.token,true);
  const selected=scopes(input.scopes);if(selected.some(s=>!n.scopes.includes(s)))throw fail('No puedes ampliar los permisos de la invitación.',403);
  const p=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[n.pedido_id,n.empresa_id])).rows[0];
  if(!p||p.colaborador_id!==n.colaborador_id)throw fail('El encargo ya no está disponible.',409);
  if(n.aceptada_at){const old=(await tx.query('SELECT * FROM planner_conexiones_transporte WHERE id=$1',[n.conexion_id])).rows[0];if(!allowed(old,'pedidos')||canonical(old.scopes)!==canonical(selected))throw fail('La conexión cambió o fue revocada. Solicita otra invitación.',409);return require('./plannerExchange').createTrip(tx,old,p);}
  if(terms(p)!==n.condiciones_hash||['cancelado','entregado','facturado'].includes(p.estado))throw fail('Han cambiado las condiciones del encargo; solicita una nueva invitación.',409);
  const customer=(await tx.query('SELECT id,cif FROM clientes WHERE id::text=$1 AND empresa_id=$2',[String(input.cliente_id),company])).rows[0];if(!customer||!normalized(n.cargador_cif)||normalized(customer.cif)!==normalized(n.cargador_cif))throw fail('Selecciona el cliente cuyo NIF/CIF coincide con el remitente.',409);
  const old=(await tx.query('SELECT * FROM planner_conexiones_transporte WHERE empresa_id=$1 AND colaborador_id=$2 FOR UPDATE',[n.empresa_id,n.colaborador_id])).rows[0];
  if(old?.transportista_empresa_id&&old.transportista_empresa_id!==company)throw fail('Existe una conexión con otra identidad; revisa el colaborador.',409);
  if(old?.consentimiento_origen_at&&new Date(n.created_at)<new Date(old.consentimiento_origen_at))throw fail('Existe un consentimiento posterior; solicita una invitación vigente.',409);
  if(old?.revocada_at&&new Date(n.created_at)<=new Date(old.revocada_at))throw fail('La invitación es anterior a la revocación.',409);
  const link=(await tx.query(`INSERT INTO planner_conexiones_transporte(empresa_id,colaborador_id,transportista_empresa_id,cliente_id,created_by,scopes,consentimiento_origen_at,consentimiento_destino_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(empresa_id,colaborador_id) DO UPDATE SET cliente_id=EXCLUDED.cliente_id,activo=true,scopes=EXCLUDED.scopes,consentimiento_origen_at=EXCLUDED.consentimiento_origen_at,consentimiento_destino_at=now(),consentimiento_version=planner_conexiones_transporte.consentimiento_version+1,revocada_at=NULL RETURNING *`,[n.empresa_id,n.colaborador_id,company,customer.id,user,JSON.stringify(selected),n.created_at])).rows[0];
  await tx.query('UPDATE network_invitaciones SET aceptada_at=now(),accepted_by=$2,conexion_id=$3 WHERE id=$1',[n.id,user,link.id]);
  await tx.query("UPDATE pedidos SET colaborador_precio_confirmado=true,colaborador_precio_confirmado_at=NOW(),estado=CASE WHEN estado::text='pendiente' THEN 'confirmado'::estado_pedido ELSE estado END WHERE id=$1 AND empresa_id=$2",[p.id,n.empresa_id]);
  await event(tx,company,user,'conexion.aceptada',{link:link.id,invite:n.id,data:{scopes:selected,version:link.consentimiento_version}});
  return {...await require('./plannerExchange').createTrip(tx,link,p,true),conexion_id:link.id};
 });
}
async function revoke(db,company,user,id){return db.transaction(async tx=>{await manager(tx,company,user);const link=(await tx.query('SELECT * FROM planner_conexiones_transporte WHERE id::text=$1 AND (empresa_id=$2 OR transportista_empresa_id=$2) FOR UPDATE',[String(id),company])).rows[0];if(!link)throw fail('Conexión no encontrada.',404);if(link.revocada_at)return {ok:true};await tx.query('UPDATE planner_conexiones_transporte SET activo=false,revocada_at=now(),consentimiento_version=consentimiento_version+1 WHERE id=$1',[link.id]);await tx.query('UPDATE network_invitaciones SET revocada_at=now() WHERE empresa_id=$1 AND colaborador_id=$2 AND revocada_at IS NULL',[link.empresa_id,link.colaborador_id]);await event(tx,company,user,'conexion.revocada',{link:link.id});return {ok:true};});}
module.exports={catalog,allowed,scopes,invite,preview,accept,revoke,target,event};
