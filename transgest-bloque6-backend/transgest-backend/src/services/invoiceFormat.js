const {fuelInvoiceLinesForOrders,fuelParts}=require('./invoiceFuelLines');
const MODES=new Set(['individual','detalle','detalle_combustible_agrupado','linea','kg']);
const customerFormat=mode=>({por_viaje:'individual',agrupada_detalle:'detalle',agrupada_linea:'linea',agrupada_kg:'kg'})[mode]||'';
function invoiceFormat(value,customerMode){
 const mode=value||customerFormat(customerMode)||(customerMode==='segun_factura'?'':'detalle');
 if(!MODES.has(mode))throw Object.assign(new Error('Elige el formato de esta factura.'),{status:400});
 return mode;
}
const cents=value=>Math.round(Number(value||0)*100);
const line=(concepto,amount)=>({concepto,cantidad:1,precio_unit:amount/100});
function invoiceLinesForFormat(orders,clause,mode){
 if(mode==='individual'&&orders.length!==1)throw Object.assign(new Error('La modalidad por viaje requiere una factura separada para cada pedido.'),{status:409});
 const lines=fuelInvoiceLinesForOrders(orders,clause);
 if(['detalle','individual'].includes(mode))return lines;
 const extras=lines.filter(l=>l.paralizacion_pedido_id);
 const portes=orders.reduce((n,p)=>n+cents(fuelParts(p).transport),0);
 const fuel=clause?cents(clause.applied_fuel):orders.reduce((n,p)=>n+cents(fuelParts(p).fuel),0);
 const fuelText=clause?`Variación de gasoil (${clause.percentage.toLocaleString('es-ES')} %)`:'Recargo de combustible';
 let transport;
 if(mode==='linea')transport=[line(`Transporte agrupado · ${orders.length} viajes`,portes)];
 else if(mode==='detalle_combustible_agrupado')transport=orders.map(p=>line(`Porte ${p.numero} · ${p.origen||''} → ${p.destino||''}`,cents(fuelParts(p).transport)));
 else{
  const groups=new Map();
  for(const p of orders){const key=JSON.stringify([p.tipo_precio||'viaje',Number(p.precio_base_sin_combustible||p.precio_unitario||0)]),g=groups.get(key)||{tipo:p.tipo_precio,rate:Number(p.precio_base_sin_combustible||p.precio_unitario||0),kg:0,amount:0,count:0};g.kg+=Number(p.peso_kg||0);g.amount+=cents(fuelParts(p).transport);g.count++;groups.set(key,g);}
  transport=[...groups.values()].map(g=>{
   const concept=`Transporte ${g.kg.toLocaleString('es-ES')} kg · ${g.count} viajes`;
   return g.tipo==='tonelada'&&g.rate>0&&g.kg>0&&cents(g.kg/1000*g.rate)===g.amount?{concepto:concept,cantidad:g.kg/1000,precio_unit:g.rate}:line(concept,g.amount);
  });
 }
 return [...transport,...(fuel?[line(fuelText,fuel)]:[]),...extras];
}
function invoiceObservations(current,orders){
 return [...new Set([String(current||'').trim(),...orders.map(p=>String(p.observaciones_factura||'').trim())].filter(Boolean))].join('\n');
}
module.exports={customerFormat,invoiceFormat,invoiceLinesForFormat,invoiceObservations};
