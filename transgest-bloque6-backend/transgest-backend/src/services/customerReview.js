const REVIEW_ROLES = new Set(['gerente', 'contable', 'administrativo']);
function customerNeedsReview(user, data) {
  if (REVIEW_ROLES.has(String(user?.rol || '').toLowerCase())) return false;
  return Boolean(data.pendiente_revision || !String(data.cif || '').trim() ||
    !String(data.email || '').trim() || !String(data.telefono || '').trim() ||
    !String(data.cp || data.codigo_postal || data.cod_postal || '').trim() ||
    !String(data.ciudad || data.municipio || '').trim());
}
module.exports = { customerNeedsReview };
