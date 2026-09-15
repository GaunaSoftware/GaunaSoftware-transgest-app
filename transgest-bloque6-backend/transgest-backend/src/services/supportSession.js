// A support session is never stored in usuarios or attached to a tenant user's ID.
// gerente is the effective office capability role; perfil identifies the actual actor.
function supportUser(empresa, email) {
  return { id: null, nombre: "Superadmin · Soporte", email, username: email,
    rol: "gerente", perfil: "superadmin", empresa_id: empresa.id,
    empresa_nombre: empresa.nombre, empresa: empresa.nombre, plan: "enterprise",
    activo: true, permisos: {}, trafico_config: {}, debe_cambiar_password: false,
    superadmin_impersonation: true, impersonado_por: email };
}
module.exports = { supportUser };
