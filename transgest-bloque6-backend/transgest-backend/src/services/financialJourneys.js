// Reconcile materialized physical journeys before analytics filters/pagination.
// The allocation population is ALL linked commercial orders, not the visible page.
const number = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const unique = rows => [...new Map(rows.map(r => [r.id, r])).values()];
function reconcileJourneys({empresaId, orders, journeys=[], members=[], costs=[]}) {
  const result=orders.map(p=>({...p})), byOrder=new Map(result.map(p=>[String(p.id),p]));
  const reconciliation={journeys:0,costes_incluidos:0,costes_sin_conciliar:0,referencias_sin_conciliar:[],criterio:'Peso si todos los pedidos tienen peso; bultos si todos tienen bultos; en otro caso reparto no calculable. Costes de viaje separados cuando ya existe coste de pedido sin enlace documental.'};
  const scoped=journeys.filter(v=>String(v.empresa_id)===String(empresaId)&&v.estado!=='cancelado');
  for(const journey of scoped){
    const linked=unique(members.filter(m=>String(m.empresa_id)===String(empresaId)&&m.viaje_id===journey.id).map(m=>({...m,id:m.pedido_id}))).sort((a,b)=>a.id.localeCompare(b.id));
    if(!linked.length)continue;
    const basis=linked.every(m=>number(m.peso_kg)>0)?'peso_kg':linked.every(m=>number(m.bultos)>0)?'bultos':linked.length===1?'single':null;
    const total=basis?linked.reduce((n,m)=>n+(basis==='single'?1:Number(m[basis])),0):null;
    const shares=linked.map(m=>basis?(basis==='single'?1:Number(m[basis]))/total:null);
    const records=unique(costs.filter(c=>String(c.empresa_id)===String(empresaId)&&c.viaje_id===journey.id&&!c.anulado_at));
    const costCents=records.reduce((n,c)=>n+Math.round(Number(c.importe_neto)*100),0);
    const overlaps=linked.some(m=>Number(m.coste_operativo)>0);
    const includeCosts=!!basis&&!overlaps;
    let allocatedCents=0;
    linked.forEach((m,index)=>{
      const p=byOrder.get(String(m.pedido_id));
      const cents=includeCosts?(index===linked.length-1?costCents-allocatedCents:Math.floor(costCents*shares[index])):0;
      allocatedCents+=cents;
      if(!p)return;
      const share=shares[index], loaded=number(journey.km_cargados), empty=number(journey.km_vacios);
      p.bi_legs ||= [];
      p.bi_legs.push({id:journey.id,fraccion:share,criterio:basis,cargados:share==null||loaded==null?null:loaded*share,vacios:share==null||empty==null?null:empty*share,asignacion:journey.asignacion_snapshot||{},asignaciones_anteriores:(journey.relevos||[]).map(r=>r.anterior)});
      p.bi_journey_cost=(p.bi_journey_cost||0)+cents/100;
      p.bi_cost_recorded ||= includeCosts&&records.length>0;
      p.bi_unreconciled_cost=(p.bi_unreconciled_cost||0)+(includeCosts?0:(share==null?costCents/100:costCents/100*share));
      if(!includeCosts&&records.length) p.bi_cost_warning='Coste físico pendiente de conciliación; no se suma dos veces.';
    });
    reconciliation.journeys++;
    if(includeCosts)reconciliation.costes_incluidos+=costCents/100;
    else {reconciliation.costes_sin_conciliar+=costCents/100;reconciliation.referencias_sin_conciliar.push(...records.map(c=>({id:c.id,viaje_id:journey.id,referencia:c.referencia,importe:Number(c.importe_neto)})));}
  }
  for(const p of result){
    if(!p.bi_legs)continue;
    p.coste_operativo=Number(p.coste_operativo||0)+(p.bi_journey_cost||0);
    p.km_ruta=p.bi_legs.every(l=>l.cargados!=null)?p.bi_legs.reduce((n,l)=>n+l.cargados,0):null;
    p.km_vacio=p.bi_legs.every(l=>l.vacios!=null)?p.bi_legs.reduce((n,l)=>n+l.vacios,0):null;
    for(const key of ['vehiculo_id','chofer_id','remolque_id']){
      const ids=[...new Set(p.bi_legs.flatMap(l=>[l.asignacion,...(l.asignaciones_anteriores||[])]
        .map(a=>a?.[key]||null).filter(Boolean)))];
      // A legacy physical leg may have no assignment snapshot. That absence is
      // not evidence that the order's recorded vehicle/driver was removed.
      if(ids.length===1) p[key]=ids[0];
      else if(ids.length>1) {
        p[key]=null;
        p.bi_assignment_warning='Varios recursos históricos; no atribuible a uno solo.';
      } else if(key==='vehiculo_id' && p[key]) p.bi_assignment_source='pedido_sin_instantanea';
    }
  }
  return {orders:result,reconciliation};
}
async function loadJourneyReconciliation(empresaId,orders,cutoff,queryDb){
  if(!orders.length)return {orders,reconciliation:{journeys:0,costes_sin_conciliar:0}};
  const exists=await queryDb("SELECT to_regclass('viajes_operativos') AS journeys,to_regclass('viaje_costes') AS costs");
  if(!exists.rows[0]?.journeys||!exists.rows[0]?.costs)return {orders,reconciliation:{disponible:false,motivo:'Modelo físico no disponible'}};
  const journeys=(await queryDb(`SELECT DISTINCT v.* FROM viajes_operativos v JOIN viaje_pedidos vp ON vp.empresa_id=v.empresa_id AND vp.viaje_id=v.id
    WHERE v.empresa_id=$1 AND vp.pedido_id=ANY($2::uuid[]) AND v.estado<>'cancelado'`,[empresaId,orders.map(p=>p.id)])).rows;
  if(!journeys.length)return {orders,reconciliation:{journeys:0,costes_sin_conciliar:0}};
  const ids=journeys.map(v=>v.id);
  const [members,costs]=await Promise.all([
    queryDb(`SELECT vp.*,p.peso_kg,p.bultos,COALESCE(p.precio_colaborador,0)+COALESCE(p.coste_gasoil,0)+COALESCE(p.coste_peajes,0)+COALESCE(p.coste_dietas,0)+COALESCE(p.coste_otros,0)
      +COALESCE((SELECT sum(e.importe) FROM pedido_extracostes e WHERE e.pedido_id=p.id),0) AS coste_operativo
      FROM viaje_pedidos vp JOIN pedidos p ON p.empresa_id=vp.empresa_id AND p.id=vp.pedido_id WHERE vp.empresa_id=$1 AND vp.viaje_id=ANY($2::uuid[])`,[empresaId,ids]),
    queryDb('SELECT * FROM viaje_costes WHERE empresa_id=$1 AND viaje_id=ANY($2::uuid[]) AND anulado_at IS NULL AND fecha<=$3',[empresaId,ids,cutoff])
  ]);
  return reconcileJourneys({empresaId,orders,journeys,members:members.rows,costs:costs.rows});
}
module.exports={reconcileJourneys,loadJourneyReconciliation};
