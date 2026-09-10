const positive = value => { const n=Number(String(value ?? '').replace(',','.')); return Number.isFinite(n) && n>0 ? n : 0; };
export function routeMargin(route = {}, client = {}) {
  const type=route.tarifa_tipo || route.tipo_precio || 'viaje';
  const km=positive(route.km), peajes=positive(route.peajes);
  const rate=positive(route.precio_base ?? route.precio) * (1+positive(route.recargo_combustible_pct)/100);
  const routeMinimum=positive(route.minimo_unidades);
  const clientMinimum=positive(route.cliente_minimo_facturable_toneladas ?? client.minimo_facturable_toneladas);
  const units=type==='tonelada' ? (routeMinimum || clientMinimum || 24)
    : type==='km' ? km : ['hora','palet','kg'].includes(type) ? routeMinimum : 1;
  const ingresoTotal=type==='viaje' ? Math.max(rate,positive(route.minimo_facturable)) : rate*units;
  const costeKm=positive(route.coste_km_estimado) || .42;
  const costeTotal=costeKm*km+peajes;
  const ingresoKm=km>0 ? ingresoTotal/km : 0;
  const totalCostKm=km>0 ? costeTotal/km : 0;
  const margen=ingresoTotal-costeTotal, margenKm=km>0 ? margen/km : 0;
  return {ingresoTotal,ingresoKm,costeKm:totalCostKm,margen,margenKm,pct:ingresoTotal>0?margen/ingresoTotal*100:0,units,estimated:true};
}
