async function nextGestionPedidoNumero(client, empresaId) {
  const year = new Date().getFullYear();
  const prefix = `PED-${year}-`;
  await client.query(
    `INSERT INTO pedido_numero_counters (empresa_id, year, last_num)
     SELECT $1, $2,
            COALESCE(MAX(CASE WHEN numero ~ $3 THEN substring(numero from $3)::int ELSE 0 END), 0)
       FROM pedidos
      WHERE empresa_id=$1 AND numero LIKE $4
     ON CONFLICT (empresa_id, year) DO UPDATE
       SET last_num=GREATEST(pedido_numero_counters.last_num, EXCLUDED.last_num),
           updated_at=NOW()`,
    [empresaId, year, `^${prefix}([0-9]+)$`, `${prefix}%`]
  );
  const { rows } = await client.query(
    `UPDATE pedido_numero_counters
        SET last_num=last_num+1, updated_at=NOW()
      WHERE empresa_id=$1 AND year=$2
      RETURNING last_num`,
    [empresaId, year]
  );
  const next = Number(rows[0]?.last_num || 1);
  return `${prefix}${String(next).padStart(4, "0")}`;
}
module.exports={nextGestionPedidoNumero};
