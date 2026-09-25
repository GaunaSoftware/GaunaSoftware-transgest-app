// src/routes/email.js
const express = require("express");
const db      = require("../services/db");
const { authenticate, SOLO_GERENTE } = require("../middleware/auth");
const { enviarEmail, getEmpresaEmailConfig, saveEmpresaEmailConfig, markEmailConfigTest } = require("../services/email");
const { CUSTOMER_INVOICE_DOCUMENT_SCOPE } = require("../services/invoiceCustomerDocuments");
const { buildFacturaPdfBuffer } = require("../services/invoicePdf");
const router  = express.Router();
router.use(authenticate);
const EID = req => req.empresaId || req.user?.empresa_id;

const ESTADOS_ENVIO_FACTURA = ['emitida', 'enviada', 'cobrada', 'vencida', 'reclamada', 'sin_cobrar'];

async function getEmpresaPerfilEmail(empresaId) {
  const [{rows}, template] = await Promise.all([
    db.query("SELECT nombre, cfg_precios FROM empresas WHERE id=$1", [empresaId]),
    db.query('SELECT mime,imagen_base64 FROM empresa_factura_plantillas WHERE empresa_id=$1',[empresaId]),
  ]);
  const cfg = rows[0]?.cfg_precios || {};
  const perfil = cfg?.empresa_perfil && typeof cfg.empresa_perfil === "object" ? cfg.empresa_perfil : cfg;
  return { nombre: rows[0]?.nombre || "TransGest", ...perfil, factura_plantilla:template.rows[0] || null };
}

async function cargarFacturaEmailContext(facturaId, empresaId) {
  const { rows } = await db.query(
    `SELECT f.*, f.updated_at::text AS envio_version, c.nombre AS cliente_nombre, c.cif AS cliente_cif,
            c.direccion AS cliente_direccion, c.cp AS cliente_cp, c.ciudad AS cliente_ciudad, c.pais AS cliente_pais,
            c.email AS cliente_email, c.email_facturacion AS cliente_email_facturacion,
            c.telefono AS cliente_telefono, c.contacto AS cliente_contacto,
            c.forma_pago AS cliente_forma_pago, c.vencimiento AS cliente_vencimiento
       FROM facturas f
       JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
      WHERE f.id=$1 AND f.empresa_id=$2`,
    [facturaId, empresaId]
  );
  const factura = rows[0];
  if (!factura) return null;
  const [lineas, facturaDocs, pedidos, pedidoDocs, empresa] = await Promise.all([
    db.query("SELECT concepto,cantidad,precio_unit FROM factura_lineas WHERE factura_id=$1 ORDER BY orden,id", [factura.id]),
    db.query(`SELECT fd.pedido_doc_id,fd.pedido_id,fd.nombre,fd.file_base64,fd.file_mime
      FROM factura_docs fd WHERE fd.factura_id=$1 AND fd.empresa_id=$2
        AND ${CUSTOMER_INVOICE_DOCUMENT_SCOPE}
      ORDER BY fd.created_at DESC,fd.id`, [factura.id, empresaId]),
    db.query(
      `SELECT p.id, p.numero, p.referencia_cliente, p.origen, p.destino,
              COUNT(pd.id) FILTER (
                WHERE LOWER(COALESCE(pd.tipo,'')) LIKE '%albar%'
                   OR LOWER(COALESCE(pd.nombre,'')) LIKE '%albar%'
                   OR LOWER(COALESCE(pd.tipo,'')) LIKE '%pod%'
                   OR LOWER(COALESCE(pd.nombre,'')) LIKE '%pod%'
                   OR LOWER(COALESCE(pd.tipo,'')) LIKE '%cmr%'
                   OR LOWER(COALESCE(pd.nombre,'')) LIKE '%cmr%'
              )::int AS albaranes_count
         FROM factura_pedidos fp
         JOIN pedidos p ON p.id=fp.pedido_id AND p.empresa_id=$2 AND p.cliente_id=$3
         LEFT JOIN pedido_docs pd ON pd.pedido_id=p.id AND pd.empresa_id=p.empresa_id
        WHERE fp.factura_id=$1
        GROUP BY p.id,p.numero,p.referencia_cliente,p.origen,p.destino
        ORDER BY p.numero`,
      [factura.id, empresaId, factura.cliente_id]
    ),
    db.query(
      `SELECT d.id AS pedido_doc_id, d.pedido_id, d.nombre, d.file_base64, d.file_mime
         FROM factura_pedidos fp
         JOIN pedidos p ON p.id=fp.pedido_id AND p.empresa_id=$2 AND p.cliente_id=$3
         JOIN pedido_docs d ON d.pedido_id=p.id AND d.empresa_id=p.empresa_id
        WHERE fp.factura_id=$1
          AND (
            LOWER(COALESCE(d.tipo,'')) LIKE '%albar%'
            OR LOWER(COALESCE(d.nombre,'')) LIKE '%albar%'
            OR LOWER(COALESCE(d.tipo,'')) LIKE '%pod%'
            OR LOWER(COALESCE(d.nombre,'')) LIKE '%pod%'
            OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
            OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
          )
        ORDER BY d.created_at DESC`,
      [factura.id, empresaId, factura.cliente_id]
    ),
    getEmpresaPerfilEmail(empresaId),
  ]);
  const seen = new Set();
  const docs = [...(facturaDocs.rows || []), ...(pedidoDocs.rows || [])].filter(doc => {
    const key = String(doc.pedido_doc_id || `${doc.pedido_id || ""}:${doc.nombre || ""}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { factura, lineas: lineas.rows || [], docs, pedidos: pedidos.rows || [], empresa };
}

function buildFacturaEmailPreflight(ctx, destinatario = "") {
  const factura = ctx?.factura || {};
  const lineas = Array.isArray(ctx?.lineas) ? ctx.lineas : [];
  const docs = Array.isArray(ctx?.docs) ? ctx.docs : [];
  const pedidos = Array.isArray(ctx?.pedidos) ? ctx.pedidos : [];
  const issues = [];
  const warnings = [];
  if (!ESTADOS_ENVIO_FACTURA.includes(factura.estado)) issues.push('El estado de la factura no permite enviarla.');
  if (!String(destinatario || "").trim()) issues.push("El cliente no tiene email de facturacion configurado.");
  if (!String(factura.numero || "").trim()) issues.push("La factura no tiene numero.");
  if (!lineas.length) issues.push("La factura no tiene lineas.");
  if (Number(factura.total || 0) <= 0) issues.push("El total de la factura es cero o negativo.");
  const pedidosSinAlbaran = pedidos.filter(p => Number(p.albaranes_count || 0) <= 0);
  if (pedidosSinAlbaran.length) {
    issues.push(`Faltan albaranes/POD en ${pedidosSinAlbaran.length} pedido(s): ${pedidosSinAlbaran.map(p => p.numero || p.id).slice(0, 8).join(", ")}.`);
  }
  if (!String(factura.cliente_cif || "").trim()) warnings.push("El cliente no tiene CIF/NIF informado.");
  if (!factura.fecha_vencimiento) warnings.push("La factura no tiene vencimiento calculado.");
  if (pedidos.some(p => !String(p.referencia_cliente || "").trim())) warnings.push("Hay pedidos sin referencia de cliente/albaran revisada.");
  const adjuntos_estimados = 1 + docs.filter(d => d.file_base64).slice(0, 12).length;
  return {
    ok: issues.length === 0,
    bloqueantes: issues,
    avisos: warnings,
    adjuntos_estimados,
    documentos: docs.length,
    pedidos: pedidos.length,
    destinatario,
  };
}

// Log de emails
router.get("/log", SOLO_GERENTE, async (req,res) => {
  const { rows } = await db.query("SELECT * FROM email_log WHERE empresa_id=$1 OR empresa_id IS NULL ORDER BY sent_at DESC LIMIT 200", [EID(req)]);
  res.json(rows);
});

router.get("/config", SOLO_GERENTE, async (req,res) => {
  try {
    const cfg = await getEmpresaEmailConfig(EID(req));
    res.json(cfg || {
      smtp_host:"", smtp_port:"587", smtp_user:"", smtp_pass:"", smtp_from:"", smtp_from_nombre:"TransGest TMS", reply_to:"",
      envio_facturas_auto:false, envio_avisos_carga_auto:false,
      ai_inbox_enabled:false, ai_inbox_email:"",
      asunto_factura:"Factura {numero} - {empresa}", cuerpo_factura:"",
      asunto_carga:"Nuevo pedido asignado - {numero}", cuerpo_carga:"",
      activo:true,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/config", SOLO_GERENTE, async (req,res) => {
  try {
    const cfg = await saveEmpresaEmailConfig(EID(req), req.body || {}, req.user?.id || null);
    res.json({ ok:true, config: cfg });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Test de envío manual
router.post("/test", SOLO_GERENTE, async (req,res) => {
  const { destinatario } = req.body;
  if (!destinatario) return res.status(400).json({ error: "destinatario requerido" });
  try {
    await enviarEmail({
      trigger:"test",
      destinatario,
      plantilla:"pedido_confirmado",
      empresa_id: EID(req),
      datos:{ numero:"TEST-0001", ruta:"Madrid → Barcelona", fecha_carga:"hoy", mercancia:"Prueba de email" }
    });
    await markEmailConfigTest(EID(req), true).catch(() => {});
    res.json({ ok:true });
  } catch(e) {
    await markEmailConfigTest(EID(req), false, e.message).catch(() => {});
    res.status(500).json({ error: e.message });
  }
});

router.get("/factura/:id/preflight", async (req, res) => {
  const empresaId = EID(req);
  try {
    const ctx = await cargarFacturaEmailContext(req.params.id, empresaId);
    if (!ctx) return res.status(404).json({ error: "Factura no encontrada" });
    const factura = ctx.factura;
    const destinatario = String(req.query?.destinatario || factura.cliente_email_facturacion || factura.cliente_email || "").trim();
    res.json(buildFacturaEmailPreflight(ctx, destinatario));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/factura/:id", async (req, res) => {
  const empresaId = EID(req);
  try {
    const ctx = await cargarFacturaEmailContext(req.params.id, empresaId);
    if (!ctx) return res.status(404).json({ error: "Factura no encontrada" });
    const { factura, lineas, docs, empresa } = ctx;
    const destinatario = String(req.body?.destinatario || factura.cliente_email_facturacion || factura.cliente_email || "").trim();
    const preflight = buildFacturaEmailPreflight(ctx, destinatario);
    if (!preflight.ok) return res.status(409).json({ error: preflight.bloqueantes.join(" "), preflight });
    if (preflight.avisos.length && req.body?.force !== true) {
      return res.status(409).json({ error: "La factura necesita revision antes de enviarse.", preflight });
    }
    if (!destinatario) return res.status(400).json({ error: "El cliente no tiene email de facturacion configurado" });
    const attachments = [{
      filename: `Factura-${String(factura.numero || factura.id).replace(/[^\w.-]+/g, "_")}.pdf`,
      content: await buildFacturaPdfBuffer(factura, lineas, empresa),
      contentType: "application/pdf",
    }];
    for (const doc of docs.slice(0, 12)) {
      if (!doc.file_base64) continue;
      const base64 = String(doc.file_base64).includes(",") ? String(doc.file_base64).split(",").pop() : String(doc.file_base64);
      attachments.push({
        filename: doc.nombre || "documento.pdf",
        content: Buffer.from(base64, "base64"),
        contentType: doc.file_mime || "application/octet-stream",
      });
    }
    const vigente = await db.query(`SELECT id FROM facturas
      WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3
        AND estado::text=ANY($4::text[]) AND updated_at::text IS NOT DISTINCT FROM $5`,
      [factura.id, empresaId, factura.cliente_id, ESTADOS_ENVIO_FACTURA, factura.envio_version]);
    if (!vigente.rows[0]) return res.status(409).json({error:'La factura ha cambiado. Revisala antes de enviarla.'});
    const result = await enviarEmail({
      trigger: "factura_manual",
      destinatario,
      plantilla: "factura_emitida",
      empresa_id: empresaId,
      datos: {
        numero: factura.numero,
        empresa: empresa.razon_social || empresa.nombre || "TransGest",
        total: Number(factura.total || 0).toLocaleString("es-ES", { minimumFractionDigits: 2 }),
        fecha_vencimiento: factura.fecha_vencimiento ? new Date(factura.fecha_vencimiento).toLocaleDateString("es-ES") : "-",
        forma_pago: empresa.texto_pago_clientes || factura.forma_pago || "Transferencia bancaria",
        iban: empresa.iban || "",
      },
      attachments,
      meta: {
        factura_id: factura.id,
        factura_numero: factura.numero,
        cliente_id: factura.cliente_id,
        documentos_factura: docs.length,
        adjuntos: attachments.map(a => ({ filename: a.filename, contentType: a.contentType })).slice(0, 20),
      },
    });
    if (!result?.simulado && !result?.messageId) {
      return res.status(502).json({error:'No se pudo confirmar el envio. Revisa el historial antes de reintentar.'});
    }
    if (!result.simulado) {
      await db.query(`UPDATE facturas SET estado='enviada', updated_at=NOW()
        WHERE id=$1 AND empresa_id=$2 AND estado='emitida'
          AND updated_at::text IS NOT DISTINCT FROM $3`, [factura.id, empresaId, factura.envio_version]);
    }
    const actual = await db.query('SELECT estado FROM facturas WHERE id=$1 AND empresa_id=$2', [factura.id, empresaId]);
    res.json({ ok: true, estado: actual.rows[0]?.estado || factura.estado, adjuntos: attachments.length, simulado: !!result.simulado });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
