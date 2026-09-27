const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
async function recordJourneyCost(tx,{empresaId,journeyId,actorId,operationId,concepto,referencia,importe_neto,fecha}){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(operationId||'')))fail('Identificador de operación no válido.');
  const amount=Number(importe_neto),date=String(fecha||'');
  if(importe_neto==null||importe_neto===''||!Number.isFinite(amount)||amount<0||amount>999999999999.99||Math.abs(amount*100-Math.round(amount*100))>0.00001)fail('Introduce un coste neto válido con hasta dos decimales.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('Fecha no válida.');
  const values={concepto:String(concepto||'').trim(),referencia:String(referencia||'').trim(),importe_neto:amount,fecha:date};
  if(!values.concepto||values.concepto.length>300||!values.referencia||values.referencia.length>160)fail('Indica concepto y referencia del justificante.');
  if(!(await tx.query("SELECT id FROM viajes_operativos WHERE empresa_id=$1 AND id=$2 AND estado<>'cancelado' FOR UPDATE",[empresaId,journeyId])).rows.length)fail('Viaje no disponible.',404);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:journey-costs`]);
  const receipt=(await tx.query('SELECT * FROM viaje_costes WHERE empresa_id=$1 AND client_operation_uuid=$2',[empresaId,operationId])).rows[0];
  if(receipt){if(receipt.viaje_id!==journeyId||receipt.concepto!==values.concepto||receipt.referencia!==values.referencia||Number(receipt.importe_neto)!==amount||(receipt.fecha instanceof Date?receipt.fecha.toISOString().slice(0,10):String(receipt.fecha).slice(0,10))!==date)fail('La operación se reutilizó con otros datos.',409);return receipt;}
  if((await tx.query('SELECT id FROM viaje_costes WHERE empresa_id=$1 AND lower(trim(referencia))=lower($2) AND anulado_at IS NULL',[empresaId,values.referencia])).rows.length)fail('Ya hay un coste con esa referencia. Revisa el original para evitar duplicados.',409);
  return (await tx.query('INSERT INTO viaje_costes(empresa_id,viaje_id,client_operation_uuid,concepto,referencia,importe_neto,fecha,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[empresaId,journeyId,operationId,values.concepto,values.referencia,amount,date,actorId])).rows[0];
}
module.exports={recordJourneyCost};
