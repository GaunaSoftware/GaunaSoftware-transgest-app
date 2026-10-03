const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const number=(value)=>{
  if (value==null||value==='') return null;
  const n=Number(String(value).replace(',','.'));
  if (!Number.isFinite(n)||n<0) throw fail('Indica importes y cantidades válidos, iguales o mayores que cero.');
  return n;
};
async function saveCommercialRoute(tx,company,body,id=null) {
  let previous={};
  if(id) {
    if(!UUID.test(id))throw fail('Ruta no válida.');
    previous=(await tx.query('SELECT * FROM rutas WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[id,company])).rows[0];
    if(!previous)throw fail('Ruta no encontrada en esta empresa.',404);
  }
  const draft={...previous,...body};
  const customer=draft.cliente_id||null;
  if(customer && (!UUID.test(customer)||!(await tx.query('SELECT id FROM clientes WHERE id=$1 AND empresa_id=$2 AND activo=true',[customer,company])).rows[0]))throw fail('Cliente no encontrado en esta empresa.',404);
  const values={origen:String(draft.origen||'').trim().toUpperCase(),destino:String(draft.destino||'').trim().toUpperCase(),
    cliente_id:customer,tipo_vehiculo:draft.tipo_vehiculo||'cualquiera',tarifa_tipo:draft.tarifa_tipo||'viaje',
    notas:String(draft.notas||'').trim()||null,observaciones_factura:String(draft.observaciones_factura||'').trim()||null};
  if(!values.origen||!values.destino)throw fail('Origen y destino son obligatorios.');
  if(!['viaje','kg','tonelada','km','hora','palet'].includes(values.tarifa_tipo))throw fail('Tipo de tarifa no válido.');
  if((values.observaciones_factura||'').length>2000)throw fail('Las observaciones para la factura admiten hasta 2.000 caracteres.');
  for(const key of ['km','peajes','tiempo_h','precio_base','minimo_facturable','minimo_unidades','recargo_combustible_pct'])values[key]=number(draft[key]);
  values.pct_subida=draft.pct_subida==null?0:Number(String(draft.pct_subida).replace(",","."));
  if(!Number.isFinite(values.pct_subida)||values.pct_subida < -100)throw fail("Indica una variación de tarifa válida.");
  values.precio_base??=0;
  if(values.tarifa_tipo==='viaje')values.minimo_unidades=null;else values.minimo_facturable=null;
  for(const key of ['origen_punto_id','destino_punto_id']) {
    const point=draft[key]||null;
    if(point && (!UUID.test(point)||!(await tx.query('SELECT id FROM puntos_interes WHERE id=$1 AND empresa_id=$2 AND activo=true',[point,company])).rows[0]))throw fail('Punto no encontrado en esta empresa.',404);
    values[key]=point;
  }
  // Serializes creates for this tenant and route so duplicate requests reuse it.
  if(!id) {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([company,customer,values.origen,values.destino,values.tipo_vehiculo])]);
    id=(await tx.query(`SELECT id FROM rutas WHERE empresa_id=$1 AND activa=true AND UPPER(origen)=$2 AND UPPER(destino)=$3
      AND cliente_id IS NOT DISTINCT FROM $4::uuid AND COALESCE(tipo_vehiculo,'cualquiera')=$5 FOR UPDATE`,[company,values.origen,values.destino,customer,values.tipo_vehiculo])).rows[0]?.id;
  }
  const keys=Object.keys(values),params=Object.values(values);
  const row=id ? (await tx.query(`UPDATE rutas SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE id=$${keys.length+1} AND empresa_id=$${keys.length+2} RETURNING *`,[...params,id,company])).rows[0]
    : (await tx.query(`INSERT INTO rutas(${keys.join(',')},empresa_id,activa) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')},$${keys.length+1},true) RETURNING *`,[...params,company])).rows[0];
  if(customer)await tx.query(`INSERT INTO ruta_precios_cliente(ruta_id,cliente_id,precio,tarifa_tipo,minimo_facturable,minimo_unidades,recargo_combustible_pct)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(ruta_id,cliente_id) DO UPDATE SET precio=EXCLUDED.precio,tarifa_tipo=EXCLUDED.tarifa_tipo,
    minimo_facturable=EXCLUDED.minimo_facturable,minimo_unidades=EXCLUDED.minimo_unidades,recargo_combustible_pct=EXCLUDED.recargo_combustible_pct`,
    [row.id,customer,values.precio_base,values.tarifa_tipo,values.minimo_facturable,values.minimo_unidades,values.recargo_combustible_pct||0]);
  if(customer)await require("./commercialRouteTerms").saveCustomerRouteTerms(tx,company,customer,row.id,values);
  return row;
}
module.exports={saveCommercialRoute,number};
