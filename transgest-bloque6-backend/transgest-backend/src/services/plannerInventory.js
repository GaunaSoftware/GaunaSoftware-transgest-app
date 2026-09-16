const crypto = require('crypto');
const fail = (message,status=400) => Object.assign(new Error(message),{status});
function decimal(value, {positive=false, signed=false}={}) {
  const raw=String(value ?? '').trim().replace(',','.');
  if(!/^-?\d+(\.\d{1,4})?$/.test(raw)) throw fail('Introduce una cantidad numérica válida, con un máximo de cuatro decimales.');
  const n=Number(raw);
  if(!Number.isFinite(n)||Math.abs(n)>=1e10||(!signed&&n<0)||(positive&&n<=0)) throw fail('La cantidad está fuera del rango permitido.');
  return n;
}
const text=(value,max=120)=>String(value||'').trim().slice(0,max);
async function log(tx,{company,user,stock,type,quantity,reason,reference='',preparation=null,operation=crypto.randomUUID()}) {
  await tx.query(`INSERT INTO planner_movimientos(empresa_id,existencia_id,tipo,cantidad,saldo,reservado,motivo,referencia,preparacion_id,created_by,operacion)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[company,stock.id,type,quantity,stock.cantidad,stock.reservado,reason,reference,preparation,user,operation]);
}
async function move(db,company,user,input){
 const type=input.tipo;
 if(!['recepcion','fabricacion','devolucion','ajuste'].includes(type))throw fail('Tipo de movimiento no válido.');
 const quantity=decimal(input.cantidad,{signed:type==='ajuste',positive:type!=='ajuste'});
 if(!quantity||Math.abs(Math.round(quantity*1000)-quantity*1000)>1e-6)throw fail('La cantidad debe ser distinta de cero y tener como máximo tres decimales.');
 const reason=text(input.motivo,2000),warehouse=text(input.almacen),location=text(input.ubicacion),lot=text(input.lote);
 if(!reason||!warehouse)throw fail('Indica almacén y motivo del movimiento.');
 if(!/^[0-9a-f-]{36}$/i.test(input.operacion||''))throw fail('Falta el identificador de operación. Recarga el formulario.');
 return db.transaction(async tx=>{
  const article=(await tx.query('SELECT * FROM planner_articulos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[input.articulo_id,company])).rows[0];
  if(!article||!article.activo)throw fail('Artículo no disponible.',404);
  const previous=(await tx.query('SELECT * FROM planner_movimientos WHERE empresa_id=$1 AND operacion=$2',[company,input.operacion])).rows[0];
  if(previous){
   const saved=(await tx.query('SELECT * FROM planner_existencias WHERE id=$1 AND empresa_id=$2',[previous.existencia_id,company])).rows[0];
   if(!saved||saved.articulo_id!==article.id||saved.almacen!==warehouse||saved.ubicacion!==location||saved.lote!==lot||previous.tipo!==type||Number(previous.cantidad)!==quantity||previous.motivo!==reason||previous.referencia!==text(input.referencia,160))throw fail('Este identificador ya se utilizó para otro movimiento. Recarga el formulario.',409);
   return saved;
  }
  await tx.query(`INSERT INTO planner_existencias(empresa_id,articulo_id,almacen,ubicacion,lote,caducidad)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(empresa_id,articulo_id,almacen,ubicacion,lote) DO NOTHING`,[company,article.id,warehouse,location,lot,input.caducidad||null]);
  const stock=(await tx.query(`UPDATE planner_existencias SET cantidad=cantidad+$6 WHERE empresa_id=$1 AND articulo_id=$2 AND almacen=$3 AND ubicacion=$4 AND lote=$5
    AND cantidad+$6>=reservado RETURNING *`,[company,article.id,warehouse,location,lot,quantity])).rows[0];
  if(!stock)throw fail('El ajuste dejaría menos mercancía que la reservada. Libera primero la preparación.',409);
  await log(tx,{company,user,stock,type,quantity,reason,reference:text(input.referencia,160),operation:input.operacion});return stock;
 });
}
async function prepare(db,company,user,input){
 if(!Array.isArray(input.lineas)||!input.lineas.length||input.lineas.length>200)throw fail('Añade entre 1 y 200 líneas de mercancía.');
 return db.transaction(async tx=>{
  const order=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[input.pedido_id,company])).rows[0];
  if(!order)throw fail('Pedido no encontrado.',404);
  if(['cancelado','entregado','facturado'].includes(order.estado))throw fail('El pedido ya está cerrado.',409);
  const old=(await tx.query("SELECT * FROM planner_preparaciones WHERE pedido_id=$1 AND empresa_id=$2 AND estado<>'cancelada'",[order.id,company])).rows[0];
  if(old)throw fail('Este pedido ya tiene una preparación. Ábrela para revisar o liberar su mercancía.',409);
  let stops=order.puntos_descarga||[];if(typeof stops==='string'){try{stops=JSON.parse(stops);}catch{stops=[];}}
  const maxStop=Math.max(1,stops.length),keys=new Set();
  const lines=input.lineas.map(line=>{
   const n=decimal(line.cantidad,{positive:true}),stop=Number(line.parada||1),key=`${line.existencia_id}:${stop}`;
   if(!Number.isInteger(stop)||stop<1||stop>maxStop||keys.has(key)||Math.abs(n*1000-Math.round(n*1000))>1e-6)throw fail('Revisa las cantidades, las líneas duplicadas y los puntos de reparto.');
   keys.add(key);return {...line,cantidad:n,parada:stop};
  }).sort((a,b)=>String(a.existencia_id).localeCompare(String(b.existencia_id))||a.parada-b.parada);
  const prep=(await tx.query('INSERT INTO planner_preparaciones(empresa_id,pedido_id,created_by) VALUES($1,$2,$3) RETURNING *',[company,order.id,user])).rows[0];
  let totalWeight=0,totalPallets=0;const descriptions=[];
  for(const line of lines){
   const row=(await tx.query(`SELECT e.*,a.coste,a.precio_venta,a.activo,a.peso_kg,a.unidades_palet,a.referencia,a.descripcion,a.unidad FROM planner_existencias e JOIN planner_articulos a ON a.id=e.articulo_id AND a.empresa_id=e.empresa_id
     WHERE e.id=$1 AND e.empresa_id=$2 FOR UPDATE OF e`,[line.existencia_id,company])).rows[0];
   if(!row||!row.activo)throw fail('Existencia no disponible.',404);
   if(row.caducidad&&new Date(row.caducidad).toISOString().slice(0,10)<new Date().toISOString().slice(0,10))throw fail('No se puede preparar un lote caducado.',409);
   const stock=(await tx.query('UPDATE planner_existencias SET reservado=reservado+$3 WHERE id=$1 AND empresa_id=$2 AND cantidad-reservado>=$3 RETURNING *',[row.id,company,line.cantidad])).rows[0];
   if(!stock)throw fail('Stock insuficiente. Otra carga puede haber reservado esta mercancía.',409);
   await tx.query(`INSERT INTO planner_preparacion_lineas(empresa_id,preparacion_id,existencia_id,cantidad,coste_unitario,precio_venta,parada,referencia,descripcion,unidad,peso_kg,unidades_palet) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[company,prep.id,row.id,line.cantidad,row.coste,line.precio_venta===undefined?row.precio_venta:decimal(line.precio_venta),line.parada,row.referencia,row.descripcion,row.unidad,row.peso_kg,row.unidades_palet]);
   totalWeight+=Number(row.peso_kg)*line.cantidad;totalPallets+=Math.ceil(line.cantidad/Number(row.unidades_palet));descriptions.push(`${row.referencia} · ${row.descripcion}`);
   await log(tx,{company,user,stock,type:'reserva',quantity:line.cantidad,reason:'Preparación de mercancía',reference:order.numero,preparation:prep.id});
  }
  await tx.query('UPDATE pedidos SET peso_kg=$3,palets_cantidad=$4,bultos=$4,mercancia=$5 WHERE id=$1 AND empresa_id=$2',[order.id,company,Number(totalWeight.toFixed(3)),totalPallets,[...new Set(descriptions)].join('; ').slice(0,200)]);
  const pricing={};if(require('./supplierPricing').applySupplierPricing(pricing,{peso_kg:Number(totalWeight.toFixed(3))},order))await tx.query('UPDATE pedidos SET precio_colaborador=$3 WHERE id=$1 AND empresa_id=$2',[order.id,company,pricing.precio_colaborador]);
  return prep;
 });
}
async function transition(db,company,user,id,input){
 return db.transaction(async tx=>{
  const prep=(await tx.query('SELECT * FROM planner_preparaciones WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[id,company])).rows[0];
  if(!prep)throw fail('Preparación no encontrada.',404);
  if(Number(input.version)!==prep.version)throw fail('La preparación ha cambiado. Actualiza antes de continuar.',409);
  if(['expedida','cancelada'].includes(prep.estado))throw fail('La preparación está cerrada.',409);
  const lines=(await tx.query('SELECT * FROM planner_preparacion_lineas WHERE preparacion_id=$1 AND empresa_id=$2 ORDER BY existencia_id,parada',[id,company])).rows;
  const action=input.accion;
  if(action==='preparar_linea'){
   if(typeof input.preparada!=='boolean')throw fail('Indica si la línea está preparada.');
   const row=(await tx.query('UPDATE planner_preparacion_lineas SET preparada=$4 WHERE id=$1 AND preparacion_id=$2 AND empresa_id=$3 RETURNING id',[input.linea_id,id,company,Boolean(input.preparada)])).rows[0];
   if(!row||prep.estado!=='preparando')throw fail('No se puede cambiar esta línea.',409);
  }else if(action==='lista'){
   if(prep.estado!=='preparando'||!lines.length||lines.some(l=>!l.preparada))throw fail('Comprueba todas las líneas antes de marcar la carga como lista.',409);
  }else if(action==='camion'){
   const next={pendiente:'espera_carga',espera_carga:'cargando',cargando:'cargado',cargado:'salida'}[prep.situacion_camion];
   if(input.situacion!==next||next==='salida')throw fail('Secuencia no válida. Registra espera, carga y camión cargado; después confirma la expedición.',409);
   const assigned=(await tx.query('SELECT colaborador_id,colaborador_precio_confirmado FROM pedidos WHERE id=$1 AND empresa_id=$2',[prep.pedido_id,company])).rows[0];
   if(assigned?.colaborador_id&&!assigned.colaborador_precio_confirmado)throw fail('El transportista debe aceptar la carga antes de registrar su llegada.',409);
   if(['cargando','cargado'].includes(next)&&prep.estado!=='lista')throw fail('La mercancía debe estar lista antes de cargar.',409);
  }else if(['expedir','cancelar'].includes(action)){
   if(action==='expedir'&&(prep.estado!=='lista'||prep.situacion_camion!=='cargado'))throw fail('La mercancía debe estar lista y el camión cargado antes de dar salida.',409);
   if(action==='cancelar'&&!text(input.motivo,2000))throw fail('Indica el motivo para liberar la mercancía.');
   const order=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[prep.pedido_id,company])).rows[0];
   if(action==='expedir'&&(!order||['cancelado','entregado','facturado'].includes(order.estado)))throw fail('El viaje no permite una expedición.',409);
   for(const line of lines){
    const stock=(await tx.query(`UPDATE planner_existencias SET reservado=reservado-$3,cantidad=cantidad-$4 WHERE id=$1 AND empresa_id=$2 AND reservado>=$3 RETURNING *`,[line.existencia_id,company,line.cantidad,action==='expedir'?line.cantidad:0])).rows[0];
    if(!stock)throw fail('La reserva de stock no coincide. No se ha aplicado ningún movimiento.',409);
    await log(tx,{company,user,stock,type:action==='expedir'?'expedicion':'liberacion',quantity:-Number(line.cantidad),reason:action==='expedir'?'Salida de mercancía':text(input.motivo,2000),reference:order?.numero||'',preparation:id});
   }
  }else throw fail('Acción no reconocida.');
  return (await tx.query(`UPDATE planner_preparaciones SET version=version+1,
    estado=CASE WHEN $3='lista' THEN 'lista' WHEN $3='expedir' THEN 'expedida' WHEN $3='cancelar' THEN 'cancelada' ELSE estado END,
    situacion_camion=CASE WHEN $3='camion' THEN $4 WHEN $3='expedir' THEN 'salida' ELSE situacion_camion END,
    expedida_at=CASE WHEN $3='expedir' THEN now() ELSE expedida_at END WHERE id=$1 AND empresa_id=$2 RETURNING *`,[id,company,action,input.situacion||null])).rows[0];
 });
}
module.exports={decimal,text,fail,move,prepare,transition};
