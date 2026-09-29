module.exports = async function withCompanyCode(db, path, body) {
  if (path !== '/auth/login' || !body || body.codigo_empresa) return body;
  const { rows } = await db.query(
    'SELECT e.codigo_acceso FROM usuarios u JOIN empresas e ON e.id=u.empresa_id WHERE LOWER(u.email)=LOWER($1) LIMIT 1',
    [body.email]
  );
  return { ...body, codigo_empresa: rows[0]?.codigo_acceso || '' };
};
