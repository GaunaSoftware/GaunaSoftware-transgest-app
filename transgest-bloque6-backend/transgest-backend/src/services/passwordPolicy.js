const bcrypt = require("bcryptjs");

const HISTORY_LIMIT = Math.max(1, Number(process.env.PASSWORD_HISTORY_LIMIT || 5));

let schemaReady = false;

async function ensurePasswordPolicySchema(queryClient) {
  if (schemaReady) return;
  const client = queryClient || require("./db");
  await client.query(`
    CREATE TABLE IF NOT EXISTS password_history (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
      password_hash VARCHAR(200) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
        password_hash VARCHAR(200) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  });
  await client.query("CREATE INDEX IF NOT EXISTS idx_password_history_usuario ON password_history(usuario_id, created_at DESC)").catch(() => {});
  schemaReady = true;
}

async function assertPasswordNotReused({ usuarioId, empresaId, passwordNuevo, currentHash, queryClient }) {
  const client = queryClient || require("./db");
  await ensurePasswordPolicySchema(client);
  if (currentHash && await bcrypt.compare(passwordNuevo, currentHash)) {
    const err = new Error("La nueva contrasena debe ser distinta a la actual");
    err.status = 400;
    throw err;
  }
  const { rows } = await client.query(
    `SELECT password_hash
       FROM password_history
      WHERE usuario_id=$1
        AND ($2::uuid IS NULL OR empresa_id=$2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [usuarioId, empresaId || null, HISTORY_LIMIT]
  );
  for (const row of rows) {
    if (await bcrypt.compare(passwordNuevo, row.password_hash)) {
      const err = new Error(`No puedes reutilizar una de las ultimas ${HISTORY_LIMIT} contrasenas.`);
      err.status = 400;
      throw err;
    }
  }
}

async function rememberPasswordHash({ usuarioId, empresaId, passwordHash, queryClient }) {
  if (!usuarioId || !passwordHash) return;
  const client = queryClient || require("./db");
  await ensurePasswordPolicySchema(client);
  await client.query(
    "INSERT INTO password_history (usuario_id, empresa_id, password_hash) VALUES ($1,$2,$3)",
    [usuarioId, empresaId || null, passwordHash]
  );
}

module.exports = {
  ensurePasswordPolicySchema,
  assertPasswordNotReused,
  rememberPasswordHash,
};
