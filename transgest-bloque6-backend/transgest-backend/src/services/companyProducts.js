const MODES = { transgest:['transgest'], planner:['planner'], combinado:['transgest','planner'] };
const SHARED = new Set(['pedidos','clientes','rutas','colaboradores','palets','documentos','facturacion','empresa','usuarios','mi_cuenta','agenda','avisos','solicitudes','portal_cliente','portal-cliente']);
const modeForPlan = plan => plan === 'planner' ? 'planner' : plan === 'pro_planner' ? 'combinado' : null;
const defaultMode = () => process.env.TRANSGEST_PRODUCT === 'planner' ? 'planner' : 'transgest';
function productsFor(mode) { return [...(MODES[mode] || MODES[defaultMode()])]; }
function moduleAvailable(products, module) {
  const enabled = Array.isArray(products) ? products : productsFor();
  if (module === 'planner') return enabled.includes('planner');
  return enabled.includes('transgest') || (enabled.includes('planner') && SHARED.has(module));
}

function createStore(db) {
  let schema;
  async function ensure() {
    if (!schema) schema = db.query(`CREATE TABLE IF NOT EXISTS empresa_productos (
      empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
      modalidad TEXT NOT NULL CHECK(modalidad IN ('transgest','planner','combinado')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(error => { schema=null; throw error; });
    await schema;
  }
  return {
    async get(empresaId) {
      if (!empresaId) return {modalidad:defaultMode(),productos:productsFor()};
      await ensure();
      const {rows} = await db.query('SELECT modalidad,e.plan FROM empresas e LEFT JOIN empresa_productos p ON p.empresa_id=e.id WHERE e.id=$1',[empresaId]);
      const modalidad=modeForPlan(rows[0]?.plan) || rows[0]?.modalidad || defaultMode();
      return {modalidad,productos:productsFor(modalidad)};
    },
    async set(empresaId, modalidad) {
      if (!Object.prototype.hasOwnProperty.call(MODES,modalidad)) throw Object.assign(new Error('Selecciona TransGest, Planner o ambos.'),{status:400});
      await ensure();
      const company=(await db.query('SELECT plan FROM empresas WHERE id=$1',[empresaId])).rows[0];
      const fixed=modeForPlan(company?.plan);
      if(fixed&&fixed!==modalidad)throw Object.assign(new Error('Esta modalidad la determina el plan contratado. Cambia el plan de la empresa para modificarla.'),{status:409});
      const {rows} = await db.query(`INSERT INTO empresa_productos(empresa_id,modalidad)
        SELECT id,$2 FROM empresas WHERE id=$1
        ON CONFLICT(empresa_id) DO UPDATE SET modalidad=EXCLUDED.modalidad,updated_at=NOW()
        RETURNING modalidad`,[empresaId,modalidad]);
      if (!rows.length) throw Object.assign(new Error('Empresa no encontrada'),{status:404});
      return {modalidad,productos:productsFor(modalidad)};
    },
  };
}
let store;
function getStore() { if (!store) store=createStore(require('./db')); return store; }
module.exports={productsFor,moduleAvailable,createStore,get: id=>getStore().get(id),set:(id,mode)=>getStore().set(id,mode)};
