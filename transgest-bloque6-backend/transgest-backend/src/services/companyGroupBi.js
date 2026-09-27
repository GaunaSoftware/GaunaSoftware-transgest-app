const db=require('./db');
const {userForCompany}=require('./companyMembership');
const {normalizePermissionsForRole,planHasFeature,getSubscriptionState}=require('../middleware/auth');
const {reportRange,ratio,money}=require('./financialKpis');
const {readWorkspace}=require('./financialWorkspace');
const deny=()=>{throw Object.assign(Error('No tienes permiso de BI consolidado en todas las empresas del grupo'),{status:403});};
async function authorize(userId,groupId){
 const rows=(await db.query('SELECT e.id,e.nombre,g.nombre AS grupo_nombre FROM grupo_empresas ge JOIN empresas e ON e.id=ge.empresa_id JOIN grupos_empresariales g ON g.id=ge.grupo_id WHERE ge.grupo_id=$1 ORDER BY e.id',[groupId])).rows;
 if(!rows.length)deny();
 const members=[];
 for(const row of rows){const m=await userForCompany(userId,row.id);if(!m||!m.bi_consolidado||!['gerente','contable'].includes(m.rol)||!planHasFeature(m.plan,'kpis_avanzados'))deny();
 const p=normalizePermissionsForRole(m.permisos,m.rol);if(p.modulos?.informes?.ver===false)deny();
 if(getSubscriptionState({estado:m.empresa_estado,plan:m.plan,fecha_vencimiento:m.fecha_vencimiento,bloqueo_manual:m.bloqueo_manual}).blocked)deny();
 const products=await require('./companyProducts').get(row.id);if(!require('./companyProducts').moduleAvailable(products.productos,'informes'))deny();members.push(m);}
 return {rows,members};
}
async function list(userId){const groups=(await db.query('SELECT DISTINCT g.id,g.nombre FROM grupos_empresariales g JOIN grupo_empresas ge ON ge.grupo_id=g.id JOIN usuario_empresas m ON m.empresa_id=ge.empresa_id WHERE m.usuario_id=$1 AND m.activo=true AND m.bi_consolidado=true ORDER BY g.nombre',[userId])).rows;
 const result=[];for(const g of groups){try{await authorize(userId,g.id);result.push(g);}catch(e){if(e.status!==403)throw e;}}return result;}
function consolidate(companies){
 const sum=fn=>companies.some(c=>fn(c)==null)?null:money(companies.reduce((n,c)=>n+Number(fn(c)),0));
 const income=sum(c=>c.economia.ingreso_servicios_realizados),cost=sum(c=>c.economia.costes_directos.directo_registrado),margin=sum(c=>c.economia.margen_directo);
 const km=companies.some(c=>c.economia.kilometros.cobertura.evaluables<c.economia.kilometros.cobertura.total)?null:sum(c=>c.economia.kilometros.total);
 const empty=sum(c=>c.economia.kilometros.vacios);
 return {ingreso:income,coste_directo:cost,margen_directo:margin,km_totales:km,km_vacios:empty,margen_pct:ratio(margin,income,100),ingreso_km:ratio(income,km),coste_km:ratio(cost,km),margen_km:ratio(margin,km),vacio_pct:ratio(empty,km,100),estado:'parcial'};
}
async function read(userId,query){
 if(!/^[0-9a-f-]{36}$/i.test(String(query.grupo_id)))throw Object.assign(Error('Grupo no válido'),{status:400});
 if(['cliente_id','ruta','vehiculo_id','ejecucion'].some(k=>query[k]))throw Object.assign(Error('El agregado de grupo admite periodo, no dimensiones específicas de una sociedad'),{status:400});
 const range=reportRange(query),before=await authorize(userId,query.grupo_id),companies=[];
 for(const row of before.rows){const w=await readWorkspace(row.id,{...range,periodo:'personalizado',limit:1});companies.push({id:row.id,nombre:row.nombre,economia:{ingreso_servicios_realizados:w.economia.ingreso_servicios_realizados,costes_directos:w.economia.costes_directos,margen_directo:w.economia.margen_directo,kilometros:w.economia.kilometros,metricas:w.economia.metricas},updated_at:w.metadata.actualizado_en});}
 const after=await authorize(userId,query.grupo_id);if(JSON.stringify(before.members.map(m=>[m.id,m.empresa_id,m.membership_revision,m.plan]))!==JSON.stringify(after.members.map(m=>[m.id,m.empresa_id,m.membership_revision,m.plan])))deny();
 return {grupo:{id:query.grupo_id,nombre:before.rows[0].grupo_nombre},periodo:range,fecha_corte:range.hasta,generado_at:new Date().toISOString(),version:'group.bi.v1',advertencia:'Agregado de gestión, sin eliminación de operaciones entre empresas. Margen directo registrado; no beneficio neto ni cuentas anuales consolidadas. Lecturas por sociedad durante la generación.',totales:consolidate(companies),empresas:companies};
}
module.exports={list,read,consolidate,authorize};
