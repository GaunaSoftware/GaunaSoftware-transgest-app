const crypto=require('crypto'),bcrypt=require('bcryptjs'),db=require('./db');
const {enviarEmail}=require('./email');
async function inviteSupplier({empresaId,colaboradorId,nombre,email,driver=false,actor}){
 email=String(email||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Object.assign(new Error('Guarda un email válido para enviar la invitación'),{status:400});
 const app=(process.env.APP_URL||process.env.FRONTEND_URL||process.env.PUBLIC_APP_URL||'').replace(/\/$/,'');
 if(!/^https?:\/\//.test(app))throw Object.assign(new Error('Configura APP_URL en el servidor antes de enviar invitaciones'),{status:503});
 const token=crypto.randomBytes(32).toString('hex'),hash=await bcrypt.hash(crypto.randomBytes(32).toString('hex'),12);
 const usuario=await db.transaction(async tx=>{
  const col=await tx.query('SELECT id FROM colaboradores WHERE id=$1 AND empresa_id=$2 AND activo=true FOR UPDATE',[colaboradorId,empresaId]);
  if(!col.rows.length)throw Object.assign(new Error('Proveedor no encontrado'),{status:404});
  const existing=await tx.query('SELECT id,empresa_id,colaborador_id,rol FROM usuarios WHERE LOWER(email)=$1 OR LOWER(username)=$1',[email]);
  let user=existing.rows[0];
  const rol=driver?'chofer':'colaborador';
  if(user&&(String(user.empresa_id)!==String(empresaId)||String(user.colaborador_id)!==String(colaboradorId)||user.rol!==rol))throw Object.assign(new Error('Ese email pertenece a otra cuenta'),{status:409});
  if(!user)user=(await tx.query(`INSERT INTO usuarios(nombre,email,username,password_hash,rol,empresa_id,colaborador_id,activo,debe_cambiar_password,perfil)
    VALUES($1,$2,$2,$3,$4,$5,$6,false,false,$7) RETURNING id`,[nombre,email,hash,rol,empresaId,colaboradorId,driver?'Conductor de proveedor':'Portal proveedor'])).rows[0];
  await tx.query('UPDATE invitaciones_usuario SET usado_at=NOW() WHERE usuario_id=$1 AND usado_at IS NULL',[user.id]);
  await tx.query(`INSERT INTO invitaciones_usuario(empresa_id,usuario_id,email,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,NOW()+INTERVAL '72 hours',$5)`,[empresaId,user.id,email,crypto.createHash('sha256').update(token).digest('hex'),actor||null]);
  return user;
 });
 const empresa=(await db.query('SELECT nombre FROM empresas WHERE id=$1',[empresaId])).rows[0];
 const mail=await enviarEmail({trigger:'invitacion_usuario',destinatario:email,plantilla:'invitacion_usuario',datos:{nombre,empresa:empresa?.nombre||'TransGest',url:`${app}/invitacion/${token}`},empresa_id:empresaId,meta:{usuario_id:usuario.id,proveedor:true}});
 if(mail?.simulado||mail?.error)throw Object.assign(new Error('La cuenta está preparada, pero el correo no se ha enviado. Configura y prueba SMTP; después reenvía la invitación.'),{status:503});
 return {usuario_id:usuario.id,invitacion_enviada:true,email};
}
module.exports={inviteSupplier};
