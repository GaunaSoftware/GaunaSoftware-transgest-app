function mailbox(value) {
  const address = String(value || '').trim().toLowerCase();
  return /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address) ? address : '';
}

function normalizeSenderEmails(value) {
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== 'string' && !Array.isArray(value)) {
    throw Object.assign(Error('Introduce los correos remitentes de pedidos separados por líneas.'), {status:400});
  }
  const entries = (Array.isArray(value) ? value : [value || ''])
    .flatMap(item => String(item).split(/[;,\r\n]+/)).map(item => item.trim()).filter(Boolean);
  if (entries.length > 20 || entries.some(item => !mailbox(item))) {
    throw Object.assign(Error('Revisa los correos remitentes de pedidos: admite hasta 20 direcciones válidas.'), {status:400});
  }
  return [...new Set(entries.map(mailbox))].join('\n') || null;
}

async function findSenderClient(db, company, senders = []) {
  const unique = [...new Set(senders.map(mailbox).filter(Boolean))];
  if (unique.length !== 1) return {client:null, ambiguous:unique.length > 1};
  const sender = unique[0];
  const {rows} = await db.query(`
    SELECT c.id,c.nombre,c.cif FROM clientes c
    WHERE c.empresa_id=$1 AND c.activo IS DISTINCT FROM false
      AND EXISTS (
        SELECT 1 FROM regexp_split_to_table(
          CONCAT_WS(E'\n',c.email,to_jsonb(c)->>'emails_remitentes_pedidos'), E'[,;\r\n]+'
        ) AS addresses(address)
        WHERE LOWER(BTRIM(address))=$2
      )
    LIMIT 2`, [company,sender]);
  return {sender, client:rows.length === 1 ? rows[0] : null, ambiguous:rows.length > 1};
}

module.exports = {mailbox,normalizeSenderEmails,findSenderClient};
