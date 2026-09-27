const crypto=require('crypto');
const {fail,decimal,text}=require('./plannerInventory');
const day=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(new Date());
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const available=s=>Math.max(0,Number(s.cantidad)-Number(s.reservado));
const date=v=>v?new Date(v).toISOString().slice(0,10):null;
function proposals(rules,stock,today=day()){
 const reposiciones=[],conteos=[];
 for(const r of rules.filter(r=>r.activo)){
  const all=stock.filter(s=>s.articulo_id===r.articulo_id),target=all.filter(s=>s.almacen===r.almacen&&s.ubicacion===r.codigo);
  const eligible=s=>s.calidad==='liberado'&&(!s.caducidad||date(s.caducidad)>=today);
  const amount=target.filter(eligible).reduce((n,s)=>n+available(s),0);
  if(amount<Number(r.minimo)){
   let remaining=Number(r.objetivo)-amount;
   const moves=[];
   const sources=all.filter(s=>s.almacen===r.almacen&&s.ubicacion!==r.codigo&&eligible(s)&&available(s)>0).sort((a,b)=>(date(a.caducidad)||'9999').localeCompare(date(b.caducidad)||'9999')||String(a.recepcion_real_at||'9999').localeCompare(String(b.recepcion_real_at||'9999'))||a.id.localeCompare(b.id));
   for(const s of sources){if(remaining<=0)break;const qty=Math.round(Math.min(remaining,available(s))*1000)/1000;if(qty>0)moves.push({existencia_id:s.id,version:s.version,cantidad:qty,lote:s.lote,origen:s.ubicacion,caducidad:date(s.caducidad)});remaining=Math.round((remaining-qty)*1000)/1000;}
   const p={regla_id:r.id,version:r.version,referencia:r.referencia,unidad:r.unidad,almacen:r.almacen,destino:r.codigo,ubicacion_id:r.ubicacion_id,disponible:amount,objetivo:Number(r.objetivo),faltante:remaining,movimientos:moves};
   p.huella=digest({...p,destino_versiones:target.map(s=>[s.id,s.version]).sort()});reposiciones.push(p);
  }
  for(const s of target){if(Number(s.cantidad)<=0||s.conteo_abierto)continue;const last=date(s.ultimo_conteo);const elapsed=last?(new Date(today+'T00:00Z')-new Date(last+'T00:00Z'))/86400000:null;
   if(elapsed===null||elapsed>=r.conteo_dias)conteos.push({regla_id:r.id,existencia_id:s.id,version:s.version,referencia:r.referencia,almacen:s.almacen,ubicacion:s.ubicacion,lote:s.lote,ultimo_conteo:last,dias:r.conteo_dias});
  }
 }
 return {reposiciones,conteos};
}
async function list(db,company){
 const rules=(await db.query(`SELECT r.*,a.referencia,a.unidad,l.almacen,l.codigo FROM planner_reglas_reposicion r JOIN planner_articulos a ON a.id=r.articulo_id AND a.empresa_id=r.empresa_id JOIN planner_ubicaciones l ON l.id=r.ubicacion_id AND l.empresa_id=r.empresa_id WHERE r.empresa_id=$1 AND a.activo AND l.activo ORDER BY a.referencia,l.codigo`,[company])).rows;
 const stock=(await db.query(`SELECT e.*, (SELECT max(c.confirmed_at) FROM planner_conteos c WHERE c.empresa_id=e.empresa_id AND c.existencia_id=e.id AND c.estado='confirmado') ultimo_conteo,
 EXISTS(SELECT 1 FROM planner_conteos c WHERE c.empresa_id=e.empresa_id AND c.existencia_id=e.id AND c.estado='pendiente' AND c.stock_version=e.version) conteo_abierto
 FROM planner_existencias e WHERE e.empresa_id=$1 AND e.articulo_id=ANY($2::uuid[]) ORDER BY e.id`,[company,[...new Set(rules.map(r=>r.articulo_id))]])).rows;
 const result=proposals(rules,stock);
 return {reglas:rules,...result,fecha_corte:new Date().toISOString(),criterio:'Disponible liberado y no caducado. Reposición dentro del almacén por FEFO hasta objetivo; confirma el traslado físico. Conteo desde el último confirmado; sin histórico se propone el primero.'};
}
async function saveRule(tx,company,user,input){
 const location=(await tx.query('SELECT id FROM planner_ubicaciones WHERE empresa_id=$1 AND id::text=$2 AND activo',[company,String(input.ubicacion_id)])).rows[0];
 const article=(await tx.query('SELECT id FROM planner_articulos WHERE empresa_id=$1 AND id::text=$2 AND activo',[company,String(input.articulo_id)])).rows[0];
 if(!location||!article)throw fail('Artículo o ubicación no disponible.',404);
 const min=decimal(input.minimo),target=decimal(input.objetivo),days=Number(input.conteo_dias);
 if([min,target].some(v=>Math.abs(v*1000-Math.round(v*1000))>1e-7))throw fail('Mínimo y objetivo admiten hasta tres decimales.');
 if(target<=min||!Number.isInteger(days)||days<1||days>3650||!text(input.motivo,1000))throw fail('Indica objetivo superior al mínimo, periodicidad de conteo y motivo.');
 const old=(await tx.query('SELECT * FROM planner_reglas_reposicion WHERE empresa_id=$1 AND articulo_id=$2 AND ubicacion_id=$3 FOR UPDATE',[company,article.id,location.id])).rows[0];
 if(old&&old.version!==Number(input.version))throw fail('La regla ha cambiado. Actualiza antes de guardar.',409);
 const result=(await tx.query(`INSERT INTO planner_reglas_reposicion(empresa_id,articulo_id,ubicacion_id,minimo,objetivo,conteo_dias,activo,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
 ON CONFLICT(empresa_id,articulo_id,ubicacion_id) DO UPDATE SET minimo=$4,objetivo=$5,conteo_dias=$6,activo=$7,updated_by=$8,updated_at=now(),version=planner_reglas_reposicion.version+1 RETURNING *`,[company,article.id,location.id,min,target,days,input.activo!==false,user])).rows[0];
 return {anterior:old||null,regla:result};
}
async function apply(db,company,user,input){
 const rule=(await db.query('SELECT articulo_id FROM planner_reglas_reposicion WHERE empresa_id=$1 AND id::text=$2 AND activo',[company,String(input.regla_id)])).rows[0];
 if(!rule)throw fail('Regla no encontrada.',404);
 await db.query('SELECT id FROM planner_articulos WHERE empresa_id=$1 AND id=$2 FOR UPDATE',[company,rule.articulo_id]);
 await db.query('SELECT id FROM planner_existencias WHERE empresa_id=$1 AND articulo_id=$2 ORDER BY id FOR UPDATE',[company,rule.articulo_id]);
 const fresh=await list(db,company),p=fresh.reposiciones.find(p=>p.regla_id===input.regla_id);
 if(!p||p.huella!==input.huella)throw fail('La propuesta ha cambiado. Actualiza y revisa las existencias.',409);
 if(!p.movimientos.length||input.confirmado!==true||!text(input.motivo,1000))throw fail('Confirma el traslado físico e indica el motivo.');
 // act's tenant lock and each stock version check protect the complete transaction.
 const results=[];for(const m of p.movimientos)results.push(await require('./plannerWms').act(db,company,user,{accion:'trasladar',operacion:crypto.randomUUID(),...m,ubicacion_id:p.ubicacion_id,motivo:text(input.motivo,1000)}));
 return {propuesta:p,resultados:results};
}
async function docks(db,company,input){
 const start=new Date(input.inicio);if(!Number.isFinite(+start))throw fail('Indica fecha y hora para consultar muelles.');
 const rows=(await db.query(`SELECT m.id,m.nombre,m.almacen,
 (SELECT count(DISTINCT p.id)::int FROM planner_reservas r JOIN pedidos p ON p.id=r.pedido_id AND p.empresa_id=r.empresa_id WHERE r.empresa_id=m.empresa_id AND r.muelle_id=m.id AND p.estado::text NOT IN ('entregado','facturado','cancelado') AND r.inicio<=$2) cola,
 EXISTS(SELECT 1 FROM planner_reservas r JOIN planner_preparaciones p ON p.empresa_id=r.empresa_id AND p.pedido_id=r.pedido_id WHERE r.empresa_id=m.empresa_id AND r.muelle_id=m.id AND p.estado<>'cancelada' AND p.situacion_camion='cargando') ocupado,
 t.mediana_min,t.muestra FROM planner_muelles m LEFT JOIN LATERAL(SELECT count(DISTINCT p.id)::int muestra,percentile_cont(0.5) WITHIN GROUP(ORDER BY EXTRACT(EPOCH FROM(p.carga_fin_at-p.carga_inicio_at))/60) mediana_min
 FROM planner_preparaciones p WHERE p.empresa_id=m.empresa_id AND p.estado<>'cancelada' AND p.carga_fin_at>p.carga_inicio_at AND p.carga_fin_at>=now()-interval '90 days' AND EXISTS(SELECT 1 FROM planner_reservas r WHERE r.empresa_id=p.empresa_id AND r.pedido_id=p.pedido_id AND r.muelle_id=m.id)) t ON true
 WHERE m.empresa_id=$1 AND m.activo AND EXTRACT(ISODOW FROM $2::timestamptz AT TIME ZONE m.zona_horaria)::int=ANY(m.dias)
 AND ($2::timestamptz AT TIME ZONE m.zona_horaria)::time>=m.horario_inicio AND ($2::timestamptz AT TIME ZONE m.zona_horaria)::time<m.horario_fin ORDER BY ocupado,cola,m.nombre`,[company,start])).rows;
 return {datos:rows,inicio:start.toISOString(),criterio:'Muelles abiertos: primero sin camión cargando, después menor cola registrada. Mediana informativa de cargas finalizadas en los últimos 90 días; no es una reserva ni una duración garantizada.'};
}
module.exports={proposals,list,saveRule,apply,docks};
