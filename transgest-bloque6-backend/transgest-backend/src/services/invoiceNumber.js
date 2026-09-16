// Call inside the transaction that inserts the invoice. All invoice writers share this lock.
async function nextInvoiceNumber(client, empresaId, serie, year) {
  if (!/^[A-Z]+$/.test(serie) || !Number.isInteger(year)) throw new Error("Serie o año de factura inválido");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`facturas:${empresaId}:${serie}:${year}`]);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(substring(numero from '[0-9]+$')::bigint), 0)::text AS last_num
       FROM facturas WHERE empresa_id=$1 AND numero ~ $2`,
    [empresaId, `^${serie}-${year}-[0-9]+$`]
  );
  const next = BigInt(rows[0].last_num) + 1n;
  return `${serie}-${year}-${String(next).padStart(4, "0")}`;
}
module.exports = { nextInvoiceNumber };
