const {parseLocaleNumber}=require('../utils/number');
const {validateBase64Upload}=require('./uploadValidation');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const date=value=>{
 if(value==null||value==='')return null;
 const text=value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
 const parsed=new Date(text+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==text)throw fail('Revisa las fechas del pago.');
 return text;
};
const keys=['factura_nombre','factura_data','fecha_recepcion','fecha_pago_calculada','fecha_pago_real','importe','pagado','documentacion_recibida','fecha_documentacion_recepcion','notas_pago'];
async function saveSupplierTripPayment(tx,company,orderId,actor,input,{paymentDate}={}){
 const order=(await tx.query('SELECT id,colaborador_id,precio_colaborador FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[orderId,company])).rows[0];
 if(!order)throw fail('Pedido no encontrado en esta empresa.',404);
 if(!order.colaborador_id)throw fail('Este pedido no tiene colaborador asignado.',409);
 if(input.colaborador_id&&input.colaborador_id!==order.colaborador_id)throw fail('El colaborador del viaje ha cambiado. Actualiza antes de guardar.',409);
 const provider=(await tx.query('SELECT id FROM colaboradores WHERE id=$1 AND empresa_id=$2',[order.colaborador_id,company])).rows[0];
 if(!provider)throw fail('El colaborador no pertenece a esta empresa.',409);
 const previous=(await tx.query('SELECT * FROM pedido_colaborador_pagos WHERE pedido_id=$1 AND empresa_id=$2 FOR UPDATE',[orderId,company])).rows[0]||{};
 const data={...previous};
 for(const key of keys)if(input[key]!==undefined)data[key]=input[key];
 for(const key of ['fecha_recepcion','fecha_pago_calculada','fecha_pago_real','fecha_documentacion_recepcion'])data[key]=date(data[key]);
 data.importe=parseLocaleNumber(data.importe??order.precio_colaborador,NaN);
 if(!Number.isFinite(data.importe)||data.importe<0||data.importe>=1e10||Math.abs(data.importe*100-Math.round(data.importe*100))>1e-6)throw fail('Indica un importe válido con hasta dos decimales.');
 for(const key of ['pagado','documentacion_recibida']){
  if(data[key]!=null&&typeof data[key]!=='boolean')throw fail('El estado de pago o documentación no es válido.');
  data[key]=data[key]===true;
 }
 if(data.pagado&&!data.fecha_pago_real)throw fail('Indica la fecha real del pago.');
 if(data.documentacion_recibida&&!data.fecha_documentacion_recepcion)throw fail('Indica cuándo se recibió la documentación.');
 data.factura_nombre=String(data.factura_nombre||'').trim().slice(0,255)||null;
 data.notas_pago=String(data.notas_pago||'').trim().slice(0,2000)||null;
 if(input.factura_data){
  const mime=String(input.factura_data).match(/^data:([^;]+);base64,/)?.[1];
  const file=validateBase64Upload({data:input.factura_data,mime,filename:data.factura_nombre||'factura.pdf',maxBytes:5*1024*1024,allowedMimes:new Set(['application/pdf','image/jpeg','image/png','image/webp'])});
  data.factura_data=`data:${file.mime};base64,${file.base64}`;
 }
 if(data.fecha_recepcion&&!data.fecha_pago_calculada&&paymentDate)data.fecha_pago_calculada=await paymentDate(data.fecha_recepcion);
 const row=(await tx.query(`INSERT INTO pedido_colaborador_pagos(pedido_id,empresa_id,colaborador_id,${keys.join(',')},created_by,updated_by)
  VALUES($1::uuid,$2::uuid,$3::uuid,${keys.map((_,i)=>'$'+(i+4)).join(',')},$14::uuid,$14::uuid)
  ON CONFLICT(pedido_id) DO UPDATE SET ${keys.map(k=>`${k}=EXCLUDED.${k}`).join(',')},colaborador_id=EXCLUDED.colaborador_id,updated_by=EXCLUDED.updated_by,updated_at=now()
  WHERE pedido_colaborador_pagos.empresa_id=EXCLUDED.empresa_id RETURNING *`,[orderId,company,order.colaborador_id,...keys.map(k=>data[k]??null),actor])).rows[0];
 if(!row)throw fail('No se pudo confirmar la pertenencia del pago a esta empresa.',409);
 const {factura_data,...audit}=data;
 await tx.query("INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle) VALUES($1,$2,'colaborador.pago_actualizado','usuario',$3,$4::jsonb)",[orderId,company,actor,JSON.stringify({...audit,archivo_adjuntado:!!factura_data})]);
 return row;
}
module.exports={saveSupplierTripPayment,date};
