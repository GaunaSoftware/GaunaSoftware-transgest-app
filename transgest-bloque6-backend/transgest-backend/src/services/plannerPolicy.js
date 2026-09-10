const fleetModules = new Set(['vehiculos','choferes','taller','nominas','hojas-ruta','explotacion','control-horario']);
function plannerPolicy(req, res, next) {
  if (process.env.TRANSGEST_PRODUCT !== 'planner') return next();
  const segments = req.path.split('/').filter(Boolean);
  const module = segments[2];
  if (fleetModules.has(module) || (module === 'pedidos' && /chofer|auto.asigna|grupaje/i.test(segments.slice(3).join('/')))) {
    return res.status(403).json({ error: 'TransGest Planner contrata agencias externas; no gestiona flota propia.' });
  }
  if (module === 'pedidos' && ['POST','PUT','PATCH'].includes(req.method)) {
    if (['vehiculo_id','chofer_id','chofer2_id','remolque_id'].some(key => req.body?.[key])) {
      return res.status(400).json({ error: 'Asigna una agencia de transporte, no un recurso de flota propia.' });
    }
  }
  return next();
}
module.exports = { plannerPolicy };
