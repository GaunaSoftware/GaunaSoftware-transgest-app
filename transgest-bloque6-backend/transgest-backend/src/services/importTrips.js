const crypto=require('node:crypto');
const {compact}=require('./importMasterData');
const TABLES=Object.freeze({Viajes_Historicos:'import_viajes_historicos',Viajes_Pendientes:'pedidos'});
function text(value){return String(value??'').trim()||null;}
function review(reason){return{action:'review',reason};}
async function resolveOne(client,sql,params,label){
  const {rows}=await client.query(`${sql} LIMIT 2`,params);
  if(rows.length>1)return{error:`${label}: varias coincidencias`};
  return rows[0]||null;
}
async function evaluateTrip(client,empresaId,sourceSystem,type,data,sourceId,fingerprint){
  if(!TABLES[type])return{action:'unsupported',reason:'Tipo de viaje no admitido'};
  if(!data||typeof data!=='object'||!text(sourceId))return review('El viaje requiere source_id estable');
  const identity=(await client.query(`SELECT target_id FROM import_identities WHERE empresa_id=$1 AND entity_type=$2 AND source_system=$3 AND source_id=$4 LIMIT 1`,
    [empresaId,type,sourceSystem,sourceId])).rows[0];
  if(identity)return{action:'skip',identityExisting:true,targetId:identity.target_id,reason:'Viaje de origen ya importado'};
  if(!text(data.cliente_nombre)||!text(data.origen)||!text(data.destino)||!data.fecha_carga)return review('Cliente, origen, destino y fecha de carga obligatorios');
  if(data.fecha_descarga&&data.fecha_descarga<data.fecha_carga)return review('Fecha de descarga anterior a la carga');
  const existing=await resolveOne(client,
    type==='Viajes_Historicos'?'SELECT id FROM import_viajes_historicos WHERE empresa_id=$1 AND source_system=$2 AND source_id=$3'
      :'SELECT id FROM pedidos WHERE empresa_id=$1 AND migration_source_system=$2 AND migration_source_id=$3',
    [empresaId,sourceSystem,sourceId],'Viaje de origen');
  if(existing?.error)return review(existing.error);
  if(existing)return{action:'skip',targetId:existing.id,reason:'Viaje ya importado; no se sobrescribe'};
  const result={action:'create',table:TABLES[type]};
  if(text(data.cliente_cif)){
    const customer=await resolveOne(client,'SELECT id FROM clientes WHERE empresa_id=$1 AND UPPER(TRIM(cif))=$2',
      [empresaId,text(data.cliente_cif).toUpperCase()],'Cliente');
    if(customer?.error)return review(customer.error);
    if(!customer&&type==='Viajes_Pendientes')return review('Cliente con CIF no localizado');
    result.customerId=customer?.id||null;
  }
  if(type==='Viajes_Historicos')return result;
  if(!result.customerId)return review('Viaje pendiente sin CIF de cliente verificable');
  if(data.estado&&!['pendiente','confirmado'].includes(String(data.estado).toLowerCase()))return review('Un viaje pendiente solo admite estado pendiente o confirmado');
  for(const [field,label] of [['peso_kg','Peso'],['bultos','Bultos']]){
    if(data[field]!=null&&(!Number.isSafeInteger(Number(data[field]))||Number(data[field])<0))return review(`${label} no compatible con el pedido operativo`);
  }
  const lookups=[
    ['matricula_tractora','vehiculoId','vehiculos','matricula','Tractora'],
    ['matricula_remolque','remolqueId','vehiculos','matricula','Remolque'],
    ['chofer_dni','driverId','choferes','dni','Conductor'],
    ['colaborador_cif','collaboratorId','colaboradores','cif','Colaborador'],
  ];
  for(const [field,target,table,column,label] of lookups){
    if(!text(data[field]))continue;
    const found=await resolveOne(client,`SELECT id FROM ${table} WHERE empresa_id=$1 AND REGEXP_REPLACE(UPPER(${column}),'[^A-Z0-9]','','g')=$2`,
      [empresaId,compact(data[field])],label);
    if(found?.error)return review(found.error);
    if(!found)return review(`${label} no localizado`);
    result[target]=found.id;
  }
  return result;
}
async function createTrip(client,empresaId,batchId,sourceSystem,type,data,decision){
  if(decision.action!=='create')throw new Error('El viaje no está autorizado para crear');
  let sql,params;
  if(type==='Viajes_Historicos'){
    sql=`INSERT INTO import_viajes_historicos(empresa_id,source_system,source_id,numero_origen,cliente_id,cliente_cif,cliente_nombre,
      referencia_cliente,origen,destino,fecha_carga,hora_carga,fecha_descarga,hora_descarga,matricula_tractora,matricula_remolque,
      chofer_dni,colaborador_cif,mercancia,peso_kg,bultos,km_ruta,km_vacio,importe,precio_colaborador,coste_gasoil,coste_peajes,
      coste_dietas,coste_otros,estado,notas,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32) RETURNING id`;
    params=[empresaId,sourceSystem,text(data.source_id),text(data.numero_origen),decision.customerId||null,text(data.cliente_cif),
      text(data.cliente_nombre),text(data.referencia_cliente),text(data.origen),text(data.destino),data.fecha_carga,text(data.hora_carga),
      data.fecha_descarga||null,text(data.hora_descarga),text(data.matricula_tractora),text(data.matricula_remolque),text(data.chofer_dni),
      text(data.colaborador_cif),text(data.mercancia),data.peso_kg??null,data.bultos??null,data.km_ruta??null,data.km_vacio??null,
      data.importe??null,data.precio_colaborador??null,data.coste_gasoil??null,data.coste_peajes??null,data.coste_dietas??null,
      data.coste_otros??null,text(data.estado),text(data.notas),batchId];
  }else if(type==='Viajes_Pendientes'){
    const number='IMP-'+crypto.createHash('sha256').update(`${empresaId}\0${sourceSystem}\0${data.source_id}`).digest('hex').slice(0,16).toUpperCase();
    sql=`INSERT INTO pedidos(empresa_id,numero,cliente_id,origen,destino,fecha_carga,hora_carga,fecha_descarga,fecha_entrega,
      vehiculo_id,remolque_id,chofer_id,colaborador_id,mercancia,peso_kg,bultos,km_ruta,km_vacio,importe,precio_colaborador,
      coste_gasoil,coste_peajes,coste_dietas,coste_otros,estado,notas,referencia_cliente,origen_producto,
      migration_source_system,migration_source_id,migration_numero_origen,migration_matricula_remolque,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'transgest',$27,$28,$29,$30,$31) RETURNING id`;
    params=[empresaId,number,decision.customerId,text(data.origen),text(data.destino),data.fecha_carga,text(data.hora_carga),
      data.fecha_descarga||null,decision.vehiculoId||null,decision.remolqueId||null,decision.driverId||null,
      decision.collaboratorId||null,text(data.mercancia),data.peso_kg??null,data.bultos??null,data.km_ruta??null,data.km_vacio??null,
      data.importe??0,data.precio_colaborador??null,data.coste_gasoil??null,data.coste_peajes??null,data.coste_dietas??null,
      data.coste_otros??null,String(data.estado||'pendiente').toLowerCase(),text(data.notas),text(data.referencia_cliente),
      sourceSystem,text(data.source_id),text(data.numero_origen),text(data.matricula_remolque),batchId];
  }else throw new Error('Tipo de viaje no implementado');
  const {rows}=await client.query(sql,params);
  return{table:TABLES[type],id:rows[0].id};
}
module.exports={TABLES,evaluateTrip,createTrip};
