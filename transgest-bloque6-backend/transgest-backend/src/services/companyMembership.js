const db=require('./db');
const ROLES=['gerente','contable','trafico','administrativo','responsable_taller','mecanico','carretillero','colaborador','visualizador','chofer','cliente'];
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const uuid=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
async function userForCompany(userId,companyId,client=db){
 if(!uuid(userId)||(companyId&&!uuid(companyId)))return null;
 return (await client.query(`SELECT u.id,u.nombre,u.email,u.username,u.activo,u.password_changed_at,u.debe_cambiar_password,
 m.empresa_id,m.rol,m.permisos,m.perfil,m.trafico_config,m.cliente_id,m.chofer_id,m.colaborador_id,m.bi_consolidado,m.revision AS membership_revision,
 e.nombre AS empresa_nombre,e.email_admin,e.dominio,e.cfg_precios,e.plan,e.estado AS empresa_estado,e.fecha_vencimiento,e.bloqueo_manual,e.bloqueo_motivo
 FROM usuarios u JOIN usuario_empresas m ON m.usuario_id=u.id AND m.empresa_id=COALESCE($2::uuid,u.empresa_id) AND m.activo=true
 JOIN empresas e ON e.id=m.empresa_id WHERE u.id=$1 AND u.activo=true`,[userId,companyId||null])).rows[0]||null;
}
async function memberships(userId){return (await db.query(`SELECT m.empresa_id,m.rol,m.bi_consolidado,m.revision,e.nombre,e.plan,e.estado
 FROM usuario_empresas m JOIN usuarios u ON u.id=m.usuario_id AND u.activo=true JOIN empresas e ON e.id=m.empresa_id
 WHERE m.usuario_id=$1 AND m.activo=true ORDER BY e.nombre,e.id`,[userId])).rows;}
async function adminList(){const [groups,companies,users,members]=await Promise.all([
 db.query(`SELECT g.*,COALESCE(jsonb_agg(ge.empresa_id) FILTER(WHERE ge.empresa_id IS NOT NULL),'[]') AS empresas FROM grupos_empresariales g LEFT JOIN grupo_empresas ge ON ge.grupo_id=g.id GROUP BY g.id ORDER BY g.nombre`),
 db.query('SELECT id,nombre FROM empresas ORDER BY nombre'),db.query('SELECT id,nombre,email,empresa_id FROM usuarios WHERE activo=true ORDER BY nombre'),
 db.query('SELECT * FROM usuario_empresas ORDER BY empresa_id,usuario_id')]);return {groups:groups.rows,companies:companies.rows,users:users.rows,members:members.rows,roles:ROLES};}
async function saveGroup(input,actor){
 if(!Array.isArray(input.empresas))fail('Selecciona las sociedades del grupo');
 const name=String(input.nombre||'').trim(),ids=[...new Set(input.empresas||[])];if(!name||name.length>120||!ids.length||ids.length>50||!ids.every(uuid)||(input.id&&!uuid(input.id)))fail('Nombre y empresas válidas requeridos (máximo 50)');
 return db.transaction(async tx=>{
  if((await tx.query('SELECT id FROM empresas WHERE id=ANY($1::uuid[])',[ids])).rows.length!==ids.length)fail('Empresa no encontrada',404);
  const row=input.id?(await tx.query('UPDATE grupos_empresariales SET nombre=$2 WHERE id=$1 RETURNING *',[input.id,name])).rows[0]:(await tx.query('INSERT INTO grupos_empresariales(nombre) VALUES($1) RETURNING *',[name])).rows[0];if(!row)fail('Grupo no encontrado',404);
  await tx.query('DELETE FROM grupo_empresas WHERE grupo_id=$1',[row.id]);
  for(const id of ids)await tx.query('INSERT INTO grupo_empresas(grupo_id,empresa_id) VALUES($1,$2)',[row.id,id]);
  await tx.query("INSERT INTO multiempresa_eventos(actor,accion,detalle) VALUES($1,'group_updated',$2)",[actor,JSON.stringify({grupo_id:row.id,empresas:ids})]);return row;
 });
}
async function saveMembership(input,actor){
 const {usuario_id:userId,empresa_id:companyId}=input;
 if(!uuid(userId)||!uuid(companyId)||!ROLES.includes(input.rol)||typeof input.activo!=='boolean'||typeof input.bi_consolidado!=='boolean')fail('Membresía no válida');
 if(!input.permisos||typeof input.permisos!=='object'||Array.isArray(input.permisos))fail('Permisos no válidos');
 if(input.bi_consolidado&&!['gerente','contable'].includes(input.rol))fail('La consolidación requiere gerente o contable');
 return db.transaction(async tx=>{
  const user=(await tx.query('SELECT id,empresa_id FROM usuarios WHERE id=$1 FOR UPDATE',[userId])).rows[0];
  if(!user||!(await tx.query('SELECT id FROM empresas WHERE id=$1',[companyId])).rows.length)fail('Usuario o empresa no encontrados',404);
  const existing=(await tx.query('SELECT * FROM usuario_empresas WHERE usuario_id=$1 AND empresa_id=$2 FOR UPDATE',[userId,companyId])).rows[0];
  if(Number(input.revision)!==Number(existing?.revision||0))fail('Membresía modificada. Recarga los datos.',409);
  for(const [field,table] of [['cliente_id','clientes'],['chofer_id','choferes'],['colaborador_id','colaboradores']]){
   const value=input[field];if(value&&(!uuid(value)||!(await tx.query(`SELECT id FROM ${table} WHERE id=$1 AND empresa_id=$2`,[value,companyId])).rows.length))fail('Ficha vinculada de otra empresa o inexistente');
  }
  if(input.rol==='cliente'&&!input.cliente_id)fail('El cliente requiere su ficha');if(input.rol==='chofer'&&!input.chofer_id)fail('El chófer requiere su ficha');if(input.rol==='colaborador'&&!input.colaborador_id)fail('El colaborador requiere su ficha');
  const values=[userId,companyId,input.rol,JSON.stringify(input.permisos),input.activo,input.cliente_id||null,input.chofer_id||null,input.colaborador_id||null,input.bi_consolidado];
  await tx.query(`INSERT INTO usuario_empresas(usuario_id,empresa_id,rol,permisos,activo,cliente_id,chofer_id,colaborador_id,bi_consolidado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
  ON CONFLICT(usuario_id,empresa_id) DO UPDATE SET rol=$3,permisos=$4,activo=$5,cliente_id=$6,chofer_id=$7,colaborador_id=$8,bi_consolidado=$9,revision=usuario_empresas.revision+1,updated_at=now()`,values);
  if(user.empresa_id===companyId)await tx.query('UPDATE usuarios SET rol=$2,permisos=$3,cliente_id=$4,chofer_id=$5,colaborador_id=$6 WHERE id=$1',[userId,input.rol,JSON.stringify(input.permisos),input.cliente_id||null,input.chofer_id||null,input.colaborador_id||null]);
  await tx.query("INSERT INTO multiempresa_eventos(usuario_id,empresa_id,actor,accion,detalle) VALUES($1,$2,$3,'membership_updated',$4)",[userId,companyId,actor,JSON.stringify({rol:input.rol,activo:input.activo,bi_consolidado:input.bi_consolidado,permisos:input.permisos})]);return {ok:true};
 });
}
module.exports={userForCompany,memberships,adminList,saveGroup,saveMembership};
