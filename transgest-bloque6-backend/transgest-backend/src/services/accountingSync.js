// Empuja las facturas emitidas al modulo contable (libro de IVA por factura).
// Best-effort: nunca lanza ni bloquea la facturacion; si no esta configurado,
// no hace nada. Requiere ACCOUNTING_API_URL y ACCOUNTING_INGEST_KEY.
const db = require("./db");
const logger = require("./logger");

function accountingConfigured() {
  return Boolean(process.env.ACCOUNTING_API_URL && process.env.ACCOUNTING_INGEST_KEY);
}

async function pushFacturaToAccounting({ empresaId, factura, clienteId, fromOutbox=false, partySnapshot=null }) {
  try {
    if (!accountingConfigured() || !factura || !empresaId) return { skipped: true };

    const fiscal=await db.query("SELECT e.configuracion->'facturacion_fiscal'->>'modo' AS modo,r.estado_envio FROM empresas e LEFT JOIN factura_registros_fiscales r ON r.empresa_id=e.id AND r.factura_id=$2 WHERE e.id=$1",[empresaId,factura.id]);
    if(fiscal.rows[0]?.modo==='verifactu' && fiscal.rows[0]?.estado_envio!=='aceptado')return {skipped:true,reason:'awaiting_aeat'};
    if(fiscal.rows[0]?.modo==='verifactu' && !fromOutbox)return {skipped:true,reason:'durable_outbox'};
    let cliente = {};
    try {
      const { rows } = await db.query(
        "SELECT nombre, cif FROM clientes WHERE id=$1 AND empresa_id=$2 LIMIT 1",
        [clienteId || factura.cliente_id, empresaId]
      );
      cliente = partySnapshot || rows[0] || {};
    } catch { /* sin datos de cliente, se envia sin tercero */ }

    const payload = {
      source_system: "transgest",
      source_company_id: empresaId,
      source_ref: `factura:${factura.id}`,
      direction: "repercutido", // factura emitida a cliente = IVA repercutido
      entry_date: (factura.fecha instanceof Date ? factura.fecha.toISOString() : String(factura.fecha || new Date().toISOString())).slice(0, 10),
      invoice_number: factura.numero || "",
      party: { tax_id: cliente.cif || "", name: cliente.nombre || "" },
      base: Number(factura.base_imponible || 0),
      iva_rate: Number(factura.tipo_iva || 0),
      iva_amount: Number(factura.cuota_iva || 0),
      irpf_rate: Number(factura.tipo_irpf || 0),
      irpf_amount: Number(factura.cuota_irpf || 0),
      total: Number(factura.total || 0),
    };

    const baseUrl = String(process.env.ACCOUNTING_API_URL || "").replace(/\/+$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${baseUrl}/api/v1/invoices/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Accounting-Ingest-Key": process.env.ACCOUNTING_INGEST_KEY,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn(`accountingSync: ingesta de factura ${factura.numero} devolvio ${res.status}`);
        return { ok: false, status: res.status };
      }
      return { ok: true };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.warn(`accountingSync: no se pudo enviar factura ${factura?.numero || ""} a contabilidad: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { pushFacturaToAccounting, accountingConfigured };
