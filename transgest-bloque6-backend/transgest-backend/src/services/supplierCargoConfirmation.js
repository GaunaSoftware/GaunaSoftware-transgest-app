const {driverStops}=require('./driverStops');
const {fromOrder}=require('./transportShipments');
const {documentOrderWeight}=require('./stopWeights');
const {parseLocaleNumber}=require('../utils/number');
const fail=(message,code='SUPPLIER_CARGO_REQUIRED')=>{throw Object.assign(Error(message),{status:422,code});};
const list=value=>{try{return Array.isArray(value)?value:JSON.parse(value||'[]');}catch{return[];}};
const number=value=>parseLocaleNumber(value);
function cargoRows(order){
  const stops=driverStops(order),loads=stops.filter(s=>s.tipo==='carga'),unloads=stops.filter(s=>s.tipo==='descarga');
  const multi=loads.length>1||unloads.length>1;
  return (unloads.length>1?unloads:loads.length>1?loads:[unloads[0]]).map((point,index)=>({
    index,side:unloads.length>1?'descarga':loads.length>1?'carga':'general',label:point.label,
    origin:unloads.length>1?point.origen_carga_indice??(loads.length===1?0:''):loads.length>1?index:0,
    mercancia:point.mercancia||order.mercancia||'',embalaje:point.embalaje||order.embalaje||'',
    bultos:point.bultos||point.unidades||(!multi?order.bultos:'')||'',
    peso_kg:point.peso_kg||(!multi?documentOrderWeight(order):'')||'',
  }));
}
function confirmedCargo(order,input){
  if(input.verificado_chofer!=='true')fail('Contrasta la carga con el chófer y confirma la verificación antes de continuar.');
  const rows=cargoRows(order),stops=driverStops(order),loads=stops.filter(s=>s.tipo==='carga');
  const fields=rows.map(row=>{
    const mercancia=String(input[`mercancia_${row.index}`]||'').trim();
    const peso=number(input[`peso_${row.index}`]),bultos=number(input[`bultos_${row.index}`]);
    if(!mercancia||mercancia.length>500||!(peso>0)||!Number.isFinite(peso)||!(bultos>0)||!Number.isInteger(bultos))
      fail(`Envío ${row.index+1}: indica mercancía, peso en kg y número de bultos válidos.`);
    if(String(input[`origen_${row.index}`]??'').trim()==='')fail(`Envío ${row.index+1}: confirma su carga de origen.`);
    const origin=number(input[`origen_${row.index}`]);
    if(!Number.isInteger(origin)||origin<0||origin>=loads.length)fail(`Envío ${row.index+1}: confirma su carga de origen.`);
    return {...row,mercancia,peso_kg:peso,bultos,origen_carga_indice:origin,embalaje:String(input[`embalaje_${row.index}`]||'').trim().slice(0,300)};
  });
  const patch={mercancia:[...new Set(fields.map(f=>f.mercancia))].join(' · '),
    peso_kg:fields.reduce((n,f)=>n+f.peso_kg,0),bultos:fields.reduce((n,f)=>n+f.bultos,0)};
  for(const [side,key] of [['carga','puntos_carga'],['descarga','puntos_descarga']]) {
    const points=list(order[key]);
    if(points.length&&fields.some(f=>f.side===side))patch[key]=points.map((point,index)=>{
      const f=fields.find(f=>f.index===index&&f.side===side);
      return f?{...point,mercancia:f.mercancia,peso_kg:f.peso_kg,bultos:f.bultos,embalaje:f.embalaje,
        ...(side==='descarga'?{origen_carga_indice:f.origen_carga_indice}:{})}:point;
    });
  }
  // A single consignment uses the general cargo fields. Explicit old stop
  // quantities must change with them or the document would silently prefer them.
  if(fields.length===1&&fields[0].side==='general'){
    patch.embalaje=fields[0].embalaje;
    for(const key of ['puntos_carga','puntos_descarga'])if(list(order[key]).length===1)
      patch[key]=[{...list(order[key])[0],mercancia:patch.mercancia,peso_kg:patch.peso_kg,bultos:patch.bultos,embalaje:patch.embalaje}];
  }
  const candidate={...order,...patch};
  fromOrder(candidate); // Same attribution and weight checks as traffic's order.
  return patch;
}
async function saveConfirmation(db,{empresaId,pedidoId,colaboradorId,input}){
  return db.transaction(async tx=>{
    const order=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[pedidoId,empresaId])).rows[0];
    if(!order||order.colaborador_id!==colaboradorId)throw Object.assign(Error('La asignación del transporte ha cambiado.'),{status:403});
    if(order.estado!=='cargado'||!order.colaborador_carga_confirmada_at)fail('Confirma primero la carga.','SUPPLIER_STEP_SEQUENCE');
    const expected=String(input.updated_at||'');
    if(expected&&new Date(expected).getTime()!==new Date(order.updated_at).getTime())throw Object.assign(Error('Tráfico ha cambiado el pedido. Abre de nuevo el enlace para revisar los datos actuales.'),{status:409});
    const patch=confirmedCargo(order,input),keys=Object.keys(patch);
    const saved=(await tx.query(`UPDATE pedidos SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_at=NOW()
      WHERE id=$${keys.length+1} AND empresa_id=$${keys.length+2} RETURNING *`,[...keys.map(k=>typeof patch[k]==='object'?JSON.stringify(patch[k]):patch[k]),pedidoId,empresaId])).rows[0];
    await tx.query(`INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,detalle)
      VALUES($1,$2,'colaborador.mercancia_verificada','colaborador',$3)`,[pedidoId,empresaId,JSON.stringify({verificado_chofer:true,peso_kg:patch.peso_kg,bultos:patch.bultos,mercancia:patch.mercancia})]);
    return saved;
  });
}
module.exports={cargoRows,confirmedCargo,saveConfirmation};
