function numeric(value){const n=Number(typeof value==='string'?value.replace(',','.'):value);return Number.isFinite(n)?n:0;}
function estimateFuelCost(order,config={}){
 if(order.colaborador_id)return null;
 const km=numeric(order.km_ruta);if(km<=0)return null;
 const fuel=config.combustible||config.gasoil||{};
 const price=numeric(fuel.precio_fijo||fuel.precio_litro)||1.45;
 const tonnes=Math.max(0,numeric(order.peso_kg)/1000);
 const consumption=Math.round((20+Math.min(tonnes,30)*7/24)*10)/10;
 return Math.round(km*consumption/100*price*100)/100;
}
async function fillMissingFuelCost(db,body,previous,empresaId){
 // An explicitly entered value, including zero, always wins.
 if(Object.prototype.hasOwnProperty.call(body,'coste_gasoil')||numeric(previous?.coste_gasoil)>0)return;
 const effective={...previous,...body};if(effective.colaborador_id||numeric(effective.km_ruta)<=0)return;
 const {rows}=await db.query('SELECT cfg_precios FROM empresas WHERE id=$1',[empresaId]);
 const estimate=estimateFuelCost(effective,rows[0]?.cfg_precios||{});
 if(estimate!==null)body.coste_gasoil=estimate;
}
module.exports={estimateFuelCost,fillMissingFuelCost};
