const crypto = require("crypto");
const db = require("./db");

let schemaPromise = null;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function cleanText(value) {
  return String(value || "").trim();
}

function bool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

async function ensureRegulatoryCoreSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_parties (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          role VARCHAR(80) NOT NULL,
          name VARCHAR(240),
          tax_id VARCHAR(80),
          address TEXT,
          contact JSONB NOT NULL DEFAULT '{}'::jsonb,
          source VARCHAR(80) NOT NULL DEFAULT 'transgest',
          raw JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_locations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          role VARCHAR(80) NOT NULL,
          name VARCHAR(240),
          address TEXT,
          country VARCHAR(80),
          geo JSONB NOT NULL DEFAULT '{}'::jsonb,
          raw JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_goods (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          description TEXT,
          weight_kg NUMERIC(14,3),
          packages VARCHAR(120),
          units VARCHAR(80),
          indicators JSONB NOT NULL DEFAULT '{}'::jsonb,
          raw JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_waste_details (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          is_waste BOOLEAN NOT NULL DEFAULT false,
          procedure_type VARCHAR(80),
          waste_code VARCHAR(80),
          hazardous BOOLEAN NOT NULL DEFAULT false,
          annex_vii BOOLEAN NOT NULL DEFAULT false,
          notification_required BOOLEAN NOT NULL DEFAULT false,
          transit_countries JSONB NOT NULL DEFAULT '[]'::jsonb,
          producer JSONB NOT NULL DEFAULT '{}'::jsonb,
          notifier JSONB NOT NULL DEFAULT '{}'::jsonb,
          receiving_facility JSONB NOT NULL DEFAULT '{}'::jsonb,
          treatment_operation VARCHAR(120),
          validation JSONB NOT NULL DEFAULT '{}'::jsonb,
          raw JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (empresa_id, pedido_id)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_dangerous_goods_details (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          adr_applicable BOOLEAN NOT NULL DEFAULT false,
          un_number VARCHAR(40),
          adr_class VARCHAR(40),
          packing_group VARCHAR(40),
          tunnel_code VARCHAR(40),
          validation JSONB NOT NULL DEFAULT '{}'::jsonb,
          raw JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (empresa_id, pedido_id)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          document_type VARCHAR(80) NOT NULL,
          status VARCHAR(80) NOT NULL DEFAULT 'prepared',
          source_table VARCHAR(120),
          source_id UUID,
          filename VARCHAR(240),
          mime VARCHAR(120),
          hash_sha256 VARCHAR(64),
          url TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_document_versions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID NOT NULL REFERENCES regulatory_documents(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          hash_sha256 VARCHAR(64),
          reason VARCHAR(160),
          created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (document_id, version)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_payloads (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          payload_type VARCHAR(40) NOT NULL,
          status VARCHAR(80) NOT NULL DEFAULT 'prepared',
          version INTEGER NOT NULL DEFAULT 1,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          hash_sha256 VARCHAR(64) NOT NULL,
          validation JSONB NOT NULL DEFAULT '{}'::jsonb,
          external_reference VARCHAR(240),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (empresa_id, pedido_id, payload_type)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE,
          actor_user_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          action VARCHAR(120) NOT NULL,
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_external_integrations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          integration_type VARCHAR(40) NOT NULL,
          provider VARCHAR(120) NOT NULL,
          status VARCHAR(80) NOT NULL DEFAULT 'planned',
          config JSONB NOT NULL DEFAULT '{}'::jsonb,
          credentials_ref VARCHAR(240),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          last_sync_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (empresa_id, integration_type, provider)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS regulatory_transmissions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          payload_id UUID REFERENCES regulatory_payloads(id) ON DELETE SET NULL,
          integration_id UUID REFERENCES regulatory_external_integrations(id) ON DELETE SET NULL,
          payload_type VARCHAR(40) NOT NULL,
          provider VARCHAR(120) NOT NULL,
          direction VARCHAR(40) NOT NULL DEFAULT 'outbound',
          status VARCHAR(80) NOT NULL DEFAULT 'draft',
          idempotency_key VARCHAR(160) NOT NULL,
          request_hash_sha256 VARCHAR(64),
          response JSONB NOT NULL DEFAULT '{}'::jsonb,
          error_message TEXT,
          created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (empresa_id, idempotency_key)
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_reg_parties_pedido ON regulatory_parties(empresa_id, pedido_id, role)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_reg_locations_pedido ON regulatory_locations(empresa_id, pedido_id, role)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_reg_payloads_pedido ON regulatory_payloads(empresa_id, pedido_id, payload_type)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_reg_documents_pedido ON regulatory_documents(empresa_id, pedido_id, document_type)").catch(() => {});
      await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_documents_source ON regulatory_documents(empresa_id, source_table, source_id) WHERE source_id IS NOT NULL").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_reg_audit_pedido ON regulatory_audit_logs(empresa_id, pedido_id, created_at DESC)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_reg_integrations_empresa ON regulatory_external_integrations(empresa_id, integration_type, status)").catch(() => {});
      await db.query("CREATE INDEX IF NOT EXISTS idx_reg_transmissions_pedido ON regulatory_transmissions(empresa_id, pedido_id, created_at DESC)").catch(() => {});
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

function buildWasteValidation(documento = {}, structuredExport = {}) {
  const annex = structuredExport.waste_annex_vii || {};
  const prep = documento.preparacion_digital?.diwass_annex_vii || {};
  const detected = bool(annex.potentially_applicable) || bool(prep.senal_residuo);
  const required = [];
  if (detected && !cleanText(prep.codigo_residuo || annex.waste_code)) required.push("codigo_residuo");
  if (detected && !cleanText(documento.destino?.nombre || documento.destino?.destinatario)) required.push("instalacion_destino");
  if (detected && !cleanText(documento.transportista_efectivo?.nombre)) required.push("transportista");
  if (detected && bool(prep.indicio_transfronterizo) && !Array.isArray(prep.paises_transito)) required.push("paises_transito");
  return {
    applicable: detected,
    status: detected ? (required.length ? "requires_review" : "prepared") : "not_applicable",
    missing: required,
    warnings: Array.isArray(annex.required_if_applicable) ? annex.required_if_applicable : [],
  };
}

function buildDangerousGoodsValidation(documento = {}) {
  const compliance = documento.preparacion_digital?.cumplimiento_operativo || {};
  const adr = compliance.adr || {};
  const applicable = bool(adr.requiere_revision);
  const missing = [];
  if (applicable && !cleanText(adr.un_number || adr.numero_onu)) missing.push("un_number");
  if (applicable && !cleanText(adr.adr_class || adr.clase)) missing.push("adr_class");
  return {
    applicable,
    status: applicable ? (missing.length ? "requires_review" : "prepared") : "not_applicable",
    missing,
    warnings: Array.isArray(compliance.avisos) ? compliance.avisos.filter(a => String(a).toLowerCase().includes("adr")) : [],
  };
}

function buildEftiPayload(structuredExport = {}) {
  return {
    schema: "transgest.efti.internal.v1",
    generated_at: new Date().toISOString(),
    status: "prepared_for_certified_platform",
    identifiers: structuredExport.identifiers || {},
    parties: structuredExport.parties || {},
    transport: structuredExport.transport || {},
    goods: structuredExport.goods || {},
    ecmr_consignment_note: structuredExport.ecmr_consignment_note || {},
    efti_dataset: structuredExport.efti_dataset || {},
    compliance_operativo: structuredExport.compliance_operativo || {},
    digital_readiness: structuredExport.digital_readiness || {},
    note: "Internal eFTI-ready payload. Official B2A exchange requires a certified eFTI platform or certified TransGest process.",
  };
}

function buildDiwassPayload(documento = {}, structuredExport = {}) {
  const prep = documento.preparacion_digital?.diwass_annex_vii || {};
  const wasteValidation = buildWasteValidation(documento, structuredExport);
  return {
    schema: "transgest.diwass.internal.v1",
    generated_at: new Date().toISOString(),
    status: wasteValidation.status,
    procedure_type: prep.procedimiento || (prep.senal_residuo ? "to_be_classified" : "not_applicable"),
    waste: {
      applicable: wasteValidation.applicable,
      code: prep.codigo_residuo || "",
      description: documento.mercancia?.descripcion || "",
      quantity_kg: documento.mercancia?.peso_kg || null,
      hazardous: bool(prep.residuo_peligroso),
      annex_vii: bool(prep.annex_vii || prep.anexo_vii),
      notification_required: bool(prep.notificacion_requerida),
      detected_terms: prep.terminos_detectados || structuredExport.waste_annex_vii?.detected_terms || [],
    },
    actors: {
      notifier: prep.notificante || {},
      producer: prep.productor || {},
      transporter: documento.transportista_efectivo || {},
      consignee: structuredExport.parties?.destinatario || {},
      receiving_facility: prep.instalacion_receptora || {},
    },
    route: {
      origin: documento.origen || {},
      destination: documento.destino || {},
      transit_countries: prep.paises_transito || [],
      cross_border_hint: bool(prep.indicio_transfronterizo),
    },
    validation: wasteValidation,
    note: "Internal DIWASS-ready payload. Official exchange depends on DIWASS or interconnected certified systems when applicable.",
  };
}

function buildRegulatoryChecklist({ documento = {}, structuredExport = {}, repository = null, payloads = {} }) {
  const ecmr = structuredExport.ecmr_consignment_note || {};
  const wasteValidation = buildWasteValidation(documento, structuredExport);
  const adrValidation = buildDangerousGoodsValidation(documento);
  const international = bool(documento.preparacion_digital?.cumplimiento_operativo?.internacional?.requiere_revision);
  const decaReady = !!(repository?.pdf_hash_sha256 || structuredExport.identifiers?.codigo_control);
  const decaPublicUrl = !!(repository?.public_url || repository?.url_publica);
  const decaQrReady = !!(repository?.qr_data_url || repository?.qr_url || structuredExport.identifiers?.qr_url || structuredExport.identifiers?.codigo_control);
  const retentionReady = !!(repository?.retencion_minima_hasta || repository?.retention_until);
  const eftiReady = !!payloads.efti?.hash_sha256;
  const ecmrMissing = Array.isArray(ecmr.missing_fields) ? ecmr.missing_fields : [];
  const decaMissing = [
    ...(decaReady ? [] : ["pdf_deca"]),
    ...(decaQrReady ? [] : ["qr_o_codigo_control"]),
    ...(decaPublicUrl ? [] : ["url_https_descarga"]),
    ...(retentionReady ? [] : ["retencion_minima_1_ano"]),
  ];
  const checklist = [
    {
      key: "deca",
      label: "DeCA / DCD",
      applies: true,
      status: decaMissing.length ? "requires_review" : "ready",
      missing: decaMissing,
      detail: decaMissing.length ? "Completar PDF nativo, QR/URL HTTPS y retencion interna." : "PDF DeCA/DCD generado, localizable y conservado.",
    },
    {
      key: "ecmr",
      label: "CMR / eCMR",
      applies: international || ecmrMissing.length > 0,
      status: ecmrMissing.length ? "requires_review" : (international ? "ready" : "not_applicable"),
      missing: ecmrMissing,
      detail: international ? "Transporte con senal internacional: revisar carta de porte/eCMR." : "Sin senal internacional automatica.",
    },
    {
      key: "efti",
      label: "eFTI",
      applies: international || true,
      status: eftiReady ? "prepared" : "missing",
      missing: eftiReady ? [] : ["efti_payload"],
      detail: eftiReady ? "Payload interno eFTI preparado. Remision oficial requiere plataforma certificada." : "Falta generar payload interno eFTI.",
    },
    {
      key: "diwass",
      label: "DIWASS / residuos",
      applies: wasteValidation.applicable,
      status: wasteValidation.applicable ? (wasteValidation.missing.length ? "requires_review" : "prepared") : "not_applicable",
      missing: wasteValidation.missing,
      detail: wasteValidation.applicable ? "Carga con senal de residuo: revisar procedimiento, actores y documentos." : "Sin senal automatica de residuo.",
    },
    {
      key: "adr",
      label: "ADR",
      applies: adrValidation.applicable,
      status: adrValidation.applicable ? (adrValidation.missing.length ? "requires_review" : "prepared") : "not_applicable",
      missing: adrValidation.missing,
      detail: adrValidation.applicable ? "Mercancia con senal ADR: validar datos obligatorios." : "Sin senal automatica ADR.",
    },
  ];
  const blocking = checklist.filter(item => item.applies && ["missing", "requires_review"].includes(item.status));
  const applicable = checklist.filter(item => item.applies);
  const readyCount = applicable.filter(item => ["ready", "prepared"].includes(item.status)).length;
  const readinessScore = applicable.length ? Math.round((readyCount / applicable.length) * 100) : 100;
  const certificationGaps = [];
  if (!eftiReady) certificationGaps.push("generar_payload_efti");
  certificationGaps.push("conectar_plataforma_efti_certificada_o_certificar_proceso_transgest");
  if (international && ecmrMissing.length) certificationGaps.push("completar_datos_ecmr");
  if (decaMissing.length) certificationGaps.push("cerrar_requisitos_dcd_deca");
  return {
    status: blocking.length ? "requires_review" : "ready",
    readiness_score: readinessScore,
    blocking: blocking.map(item => item.key),
    summary: {
      applicable: applicable.length,
      ready: readyCount,
      review: blocking.length,
      not_applicable: checklist.filter(item => !item.applies || item.status === "not_applicable").length,
    },
    certification_gaps: certificationGaps,
    items: checklist,
  };
}

function certificationRequirementMatrix(pkg = {}) {
  const readiness = pkg.regulatory_readiness || {};
  const docs = Array.isArray(pkg.documents) ? pkg.documents : [];
  const payloads = Array.isArray(pkg.payloads) ? pkg.payloads : [];
  const versions = Array.isArray(pkg.document_versions) ? pkg.document_versions : [];
  const parties = Array.isArray(pkg.parties) ? pkg.parties : [];
  const locations = Array.isArray(pkg.locations) ? pkg.locations : [];
  const audit = Array.isArray(pkg.audit) ? pkg.audit : [];
  const transmissions = Array.isArray(pkg.transmissions) ? pkg.transmissions : [];
  const hasDoc = (type) => docs.some(d => d.document_type === type && d.hash_sha256);
  const hasPayload = (type) => payloads.some(p => p.payload_type === type && p.hash_sha256);
  const hasParty = (role) => parties.some(p => p.role === role && cleanText(p.name));
  const hasLocation = (role) => locations.some(l => l.role === role && (cleanText(l.name) || cleanText(l.address)));
  const checklistItems = Array.isArray(readiness.checklist?.items) ? readiness.checklist.items : [];
  const blocking = Array.isArray(readiness.blocking) ? readiness.blocking : [];
  return [
    {
      area: "DeCA / DCD",
      requirement: "PDF nativo archivado con hash SHA-256",
      status: hasDoc("deca") ? "ok" : "missing",
      evidence: hasDoc("deca") ? "regulatory_documents.deca" : "Falta generar/archivar DeCA",
    },
    {
      area: "DeCA / DCD",
      requirement: "QR o URL HTTPS tokenizada disponible durante el servicio",
      status: docs.some(d => d.url || d.metadata?.public_activo) ? "ok" : "review",
      evidence: docs.find(d => d.url)?.url ? "URL segura registrada" : "Revisar URL/QR del repositorio",
    },
    {
      area: "Trazabilidad",
      requirement: "Versiones, hashes y motivo de cambio conservados",
      status: versions.length ? "ok" : "review",
      evidence: versions.length ? `${versions.length} version(es) documentales` : "Sin version documental registrada",
    },
    {
      area: "Datos estructurados",
      requirement: "Partes legales y roles diferenciados",
      status: hasParty("cargador_contractual") && hasParty("transportista_efectivo") ? "ok" : "missing",
      evidence: `${parties.length} parte(s) sincronizada(s)`,
    },
    {
      area: "Datos estructurados",
      requirement: "Origen, destino y puntos operativos normalizados",
      status: hasLocation("origen") && hasLocation("destino") ? "ok" : "missing",
      evidence: `${locations.length} ubicacion(es) sincronizada(s)`,
    },
    {
      area: "eCMR",
      requirement: "Carta de porte electronica preparada si aplica",
      status: hasPayload("ecmr") ? "ok" : "missing",
      evidence: hasPayload("ecmr") ? "payload eCMR interno versionado" : "Falta payload eCMR",
    },
    {
      area: "eFTI",
      requirement: "Dataset interno exportable a plataforma certificada",
      status: hasPayload("efti") ? "ok" : "missing",
      evidence: hasPayload("efti") ? "payload eFTI interno con hash" : "Falta payload eFTI",
    },
    {
      area: "DIWASS / residuos",
      requirement: "Deteccion y payload de residuos/eAnnex VII cuando aplique",
      status: hasPayload("diwass") ? "ok" : "missing",
      evidence: pkg.waste?.is_waste ? "residuo detectado/revisado" : "payload DIWASS preparado como no aplicable o pendiente",
    },
    {
      area: "Integraciones",
      requirement: "Borradores de envio y conectores para proveedor certificado",
      status: transmissions.length ? "review" : "planned",
      evidence: transmissions.length ? `${transmissions.length} borrador(es) de transmision` : "Pendiente proveedor certificado/API real",
    },
    {
      area: "Auditoria",
      requirement: "Historial de sincronizacion, exportacion y acciones",
      status: audit.length ? "ok" : "review",
      evidence: audit.length ? `${audit.length} evento(s) regulatorios` : "Sin eventos regulatorios",
    },
    {
      area: "Motor de cumplimiento",
      requirement: "Checklist por transporte con bloqueos visibles",
      status: blocking.length ? "review" : (checklistItems.length ? "ok" : "review"),
      evidence: blocking.length ? `Bloqueos: ${blocking.join(", ")}` : `${checklistItems.length} check(s)`,
    },
  ];
}

function buildRegulatoryCertificationDossier(pkg = {}) {
  const matrix = certificationRequirementMatrix(pkg);
  const ok = matrix.filter(i => i.status === "ok").length;
  const review = matrix.filter(i => i.status === "review").length;
  const missing = matrix.filter(i => i.status === "missing").length;
  const planned = matrix.filter(i => i.status === "planned").length;
  const score = matrix.length ? Math.round((ok / matrix.length) * 100) : 0;
  const body = {
    schema: "transgest.regulatory.certification_dossier.v1",
    generated_at: new Date().toISOString(),
    purpose: "Expediente de preparacion para inspeccion, auditoria e integraciones eFTI/eCMR/DIWASS. No acredita certificacion externa por si solo.",
    scope: pkg.scope || {},
    readiness_score: score,
    summary: { ok, review, missing, planned, total: matrix.length },
    matrix,
    regulatory_readiness: pkg.regulatory_readiness || {},
    evidence: {
      package_hash_sha256: pkg.package_hash_sha256 || "",
      documents: (pkg.documents || []).map(d => ({
        type: d.document_type,
        status: d.status,
        filename: d.filename,
        hash_sha256: d.hash_sha256,
        url_present: !!d.url,
        metadata: d.metadata || {},
        updated_at: d.updated_at,
      })),
      payloads: (pkg.payloads || []).map(p => ({
        type: p.payload_type,
        status: p.status,
        version: p.version,
        hash_sha256: p.hash_sha256,
        validation: p.validation || {},
        updated_at: p.updated_at,
      })),
      document_versions: pkg.document_versions || [],
      transmissions: pkg.transmissions || [],
      audit: pkg.audit || [],
    },
    certification_path: [
      "Mantener DeCA/DCD nativo con QR/URL HTTPS, hash y repositorio seguro.",
      "Completar datos maestros obligatorios de partes, ubicaciones, mercancia, vehiculos y conductor.",
      "Conservar versiones y motivos de modificacion antes/despues de remision o firma.",
      "Conectar proveedor eCMR/eFTI/DIWASS certificado o abrir proceso formal de certificacion de TransGest.",
      "Ejecutar pruebas de interoperabilidad, seguridad, tenant isolation, auditoria y retencion documental.",
    ],
    governance: {
      tenant_isolation: "Todos los datos del expediente se filtran por empresa_id.",
      public_access: "Solo enlaces tokenizados para soporte DCD; la descarga publica puede desactivarse despues del servicio.",
      retention: "Conservacion interna minima configurada/recomendada de 1 ano para DCD, ampliable por politica de empresa.",
      security_note: "Los hashes permiten detectar modificaciones, pero la certificacion externa requiere proveedor/plataforma conforme cuando aplique.",
    },
  };
  return {
    ...body,
    dossier_hash_sha256: sha256Hex(body),
  };
}

async function generateRegulatoryDossierPdf(dossier = {}) {
  const PDFDocument = require("pdfkit");
  const generatedAt = new Date(dossier.generated_at || Date.now());
  const title = `Dossier regulatorio ${dossier.scope?.pedido_numero || dossier.scope?.pedido_id || ""}`.trim();
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    info: {
      Title: title,
      Author: "TransGest",
      Subject: "Dossier de preparacion eFTI, eCMR, DIWASS y DeCA",
      Keywords: "TransGest,DeCA,DCD,eFTI,eCMR,DIWASS,compliance",
      Creator: "TransGest",
      Producer: "TransGest PDF service",
      CreationDate: generatedAt,
      ModDate: generatedAt,
    },
  });
  const chunks = [];
  doc.on("data", chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const text = (value) => String(value ?? "").trim() || "-";
  const fit = (value, len = 100) => {
    const raw = text(value);
    return raw.length > len ? `${raw.slice(0, len - 3)}...` : raw;
  };
  const ensureSpace = (height = 100) => {
    if (doc.y + height > doc.page.height - 58) doc.addPage();
  };
  const section = (label) => {
    ensureSpace(50);
    doc.moveDown(0.7);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f766e").text(label);
    doc.moveTo(42, doc.y + 4).lineTo(553, doc.y + 4).strokeColor("#cbd5e1").lineWidth(0.7).stroke();
    doc.moveDown(0.65);
  };
  const line = (label, value, opts = {}) => {
    ensureSpace(opts.height || 34);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text(String(label || "").toUpperCase());
    doc.font("Helvetica").fontSize(opts.size || 9).fillColor("#111827").text(text(value), { width: opts.width || 500, lineGap: 1.5 });
    doc.moveDown(0.35);
  };
  const statusColor = (status) => status === "ok" ? "#059669" : status === "missing" ? "#dc2626" : status === "planned" ? "#64748b" : "#d97706";

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text("Dossier regulatorio TransGest", 42, 42, { width: 360 });
  doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("Preparacion DeCA/DCD, eCMR, eFTI, DIWASS, ADR y residuos", { width: 380 });
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f766e").text("Preparacion", 420, 42, { width: 130, align: "right" });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(Number(dossier.readiness_score || 0) >= 80 ? "#059669" : "#d97706").text(`${Number(dossier.readiness_score || 0)}%`, 420, 58, { width: 130, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(`Generado: ${generatedAt.toLocaleString("es-ES")}`, 350, 82, { width: 200, align: "right" });
  doc.moveDown(2.2);

  section("Alcance");
  line("Pedido", `${text(dossier.scope?.pedido_numero)} | ${text(dossier.scope?.pedido_id)}`);
  line("Estado operativo", dossier.scope?.status || "-");
  line("Hash dossier", dossier.dossier_hash_sha256 || "-", { size: 8 });
  line("Hash paquete regulatorio", dossier.evidence?.package_hash_sha256 || "-", { size: 8 });
  line("Aviso", dossier.purpose || "-", { size: 8 });

  section("Resumen");
  const summary = dossier.summary || {};
  line("Estado matriz", `OK: ${summary.ok || 0} | Revisar: ${summary.review || 0} | Faltan: ${summary.missing || 0} | Planificado: ${summary.planned || 0}`);
  line("Checklist core", `Estado: ${text(dossier.regulatory_readiness?.checklist_status)} | Bloqueos: ${Array.isArray(dossier.regulatory_readiness?.blocking) && dossier.regulatory_readiness.blocking.length ? dossier.regulatory_readiness.blocking.join(", ") : "sin bloqueos"}`);

  section("Matriz de cumplimiento");
  (Array.isArray(dossier.matrix) ? dossier.matrix : []).forEach(item => {
    ensureSpace(58);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(statusColor(item.status)).text(`[${String(item.status || "").toUpperCase()}] ${item.area}`, { width: 500 });
    doc.font("Helvetica").fontSize(8.6).fillColor("#111827").text(fit(item.requirement, 130), { width: 500 });
    doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(fit(item.evidence, 150), { width: 500 });
    doc.moveDown(0.35);
  });

  section("Evidencias tecnicas");
  const documents = dossier.evidence?.documents || [];
  const payloads = dossier.evidence?.payloads || [];
  line("Documentos", documents.length ? documents.map(d => `${d.type}:${d.status}:${String(d.hash_sha256 || "").slice(0, 10)}`).join(" | ") : "Sin documentos regulatorios");
  line("Payloads", payloads.length ? payloads.map(p => `${p.type}:v${p.version}:${String(p.hash_sha256 || "").slice(0, 10)}`).join(" | ") : "Sin payloads regulatorios");
  line("Versiones", `${(dossier.evidence?.document_versions || []).length} version(es) documentales registradas`);
  line("Transmisiones", `${(dossier.evidence?.transmissions || []).length} borrador(es)/envio(s) registrados`);

  section("Camino de certificacion");
  (dossier.certification_path || []).forEach((item, idx) => line(`${idx + 1}`, item, { height: 28 }));

  section("Gobernanza");
  Object.entries(dossier.governance || {}).forEach(([key, value]) => line(key.replace(/_/g, " "), value, { size: 8 }));

  doc.font("Helvetica").fontSize(7).fillColor("#64748b")
    .text("Este informe es una evidencia de preparacion interna. La certificacion oficial depende de proveedor/plataforma certificada o proceso formal de certificacion cuando sea exigible.", 42, 792, { width: 510, align: "center" });
  doc.end();
  const buffer = await done;
  const ref = String(dossier.scope?.pedido_numero || dossier.scope?.pedido_id || "pedido").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return {
    buffer,
    mime: "application/pdf",
    filename: `transgest-dossier-regulatorio-${ref}.pdf`,
    hash_sha256: sha256Buffer(buffer),
  };
}

async function upsertPayload({ empresaId, pedidoId, type, payload, validation }) {
  const hash = sha256Hex(payload);
  const status = validation?.status || payload?.status || "prepared";
  const { rows } = await db.query(`
    INSERT INTO regulatory_payloads
      (empresa_id,pedido_id,payload_type,status,version,payload,hash_sha256,validation)
    VALUES ($1,$2,$3,$4,1,$5::jsonb,$6,$7::jsonb)
    ON CONFLICT (empresa_id,pedido_id,payload_type)
    DO UPDATE SET
      status=EXCLUDED.status,
      version=CASE
        WHEN regulatory_payloads.hash_sha256 IS DISTINCT FROM EXCLUDED.hash_sha256 THEN regulatory_payloads.version + 1
        ELSE regulatory_payloads.version
      END,
      payload=EXCLUDED.payload,
      hash_sha256=EXCLUDED.hash_sha256,
      validation=EXCLUDED.validation,
      updated_at=NOW()
    RETURNING id,payload_type,status,version,hash_sha256,validation,updated_at
  `, [empresaId, pedidoId, type, status, JSON.stringify(payload || {}), hash, JSON.stringify(validation || {})]);
  return rows[0] || null;
}

async function syncPedidoRegulatoryCore({
  empresaId,
  pedidoId,
  payload,
  structuredExport,
  repository = null,
  userId = null,
  reason = "sync",
}) {
  await ensureRegulatoryCoreSchema();
  const documento = payload?.documento || {};
  const exportData = structuredExport || {};
  await db.query("DELETE FROM regulatory_parties WHERE empresa_id=$1 AND pedido_id=$2", [empresaId, pedidoId]);
  await db.query("DELETE FROM regulatory_locations WHERE empresa_id=$1 AND pedido_id=$2", [empresaId, pedidoId]);
  await db.query("DELETE FROM regulatory_goods WHERE empresa_id=$1 AND pedido_id=$2", [empresaId, pedidoId]);

  const parties = [
    ["cargador_contractual", documento.cargador_contractual || {}],
    ["transportista_efectivo", documento.transportista_efectivo || {}],
    ["destinatario", exportData.parties?.destinatario || documento.destino || {}],
  ];
  for (const [role, party] of parties) {
    await db.query(`
      INSERT INTO regulatory_parties (empresa_id,pedido_id,role,name,tax_id,address,contact,raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
    `, [
      empresaId,
      pedidoId,
      role,
      party.nombre || party.name || "",
      party.nif || party.tax_id || "",
      party.domicilio || party.direccion || party.address || "",
      JSON.stringify({ contacto: party.contacto || "", email: party.email || "", telefono: party.telefono || "" }),
      JSON.stringify(party || {}),
    ]);
  }

  const locations = [
    ["origen", documento.origen || {}],
    ["destino", documento.destino || {}],
    ...((Array.isArray(documento.cargas) ? documento.cargas : []).map((p, i) => [`carga_${i + 1}`, p])),
    ...((Array.isArray(documento.descargas) ? documento.descargas : []).map((p, i) => [`descarga_${i + 1}`, p])),
  ];
  for (const [role, location] of locations) {
    await db.query(`
      INSERT INTO regulatory_locations (empresa_id,pedido_id,role,name,address,country,geo,raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
    `, [
      empresaId,
      pedidoId,
      role,
      location.nombre || location.name || "",
      location.direccion || location.address || "",
      location.pais || location.country || "",
      JSON.stringify({ google_maps_url: location.google_maps_url || location.maps_url || "" }),
      JSON.stringify(location || {}),
    ]);
  }

  const dangerousValidation = buildDangerousGoodsValidation(documento);
  const wasteValidation = buildWasteValidation(documento, exportData);
  await db.query(`
    INSERT INTO regulatory_goods (empresa_id,pedido_id,description,weight_kg,packages,units,indicators,raw)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
  `, [
    empresaId,
    pedidoId,
    documento.mercancia?.descripcion || "",
    documento.mercancia?.peso_kg || null,
    documento.mercancia?.bultos || "",
    documento.mercancia?.unidades || "",
    JSON.stringify({
      adr: dangerousValidation.applicable,
      waste: wasteValidation.applicable,
      international: bool(documento.preparacion_digital?.cumplimiento_operativo?.internacional?.requiere_revision),
      cabotage: bool(documento.preparacion_digital?.cumplimiento_operativo?.cabotaje?.requiere_revision),
    }),
    JSON.stringify(documento.mercancia || {}),
  ]);

  const diwassPayload = buildDiwassPayload(documento, exportData);
  await db.query(`
    INSERT INTO regulatory_waste_details
      (empresa_id,pedido_id,is_waste,procedure_type,waste_code,hazardous,annex_vii,notification_required,transit_countries,producer,notifier,receiving_facility,treatment_operation,validation,raw)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15::jsonb)
    ON CONFLICT (empresa_id,pedido_id)
    DO UPDATE SET
      is_waste=EXCLUDED.is_waste,
      procedure_type=EXCLUDED.procedure_type,
      waste_code=EXCLUDED.waste_code,
      hazardous=EXCLUDED.hazardous,
      annex_vii=EXCLUDED.annex_vii,
      notification_required=EXCLUDED.notification_required,
      transit_countries=EXCLUDED.transit_countries,
      producer=EXCLUDED.producer,
      notifier=EXCLUDED.notifier,
      receiving_facility=EXCLUDED.receiving_facility,
      treatment_operation=EXCLUDED.treatment_operation,
      validation=EXCLUDED.validation,
      raw=EXCLUDED.raw,
      updated_at=NOW()
  `, [
    empresaId,
    pedidoId,
    wasteValidation.applicable,
    diwassPayload.procedure_type || "",
    diwassPayload.waste?.code || "",
    bool(diwassPayload.waste?.hazardous),
    bool(diwassPayload.waste?.annex_vii),
    bool(diwassPayload.waste?.notification_required),
    JSON.stringify(diwassPayload.route?.transit_countries || []),
    JSON.stringify(diwassPayload.actors?.producer || {}),
    JSON.stringify(diwassPayload.actors?.notifier || {}),
    JSON.stringify(diwassPayload.actors?.receiving_facility || {}),
    documento.preparacion_digital?.diwass_annex_vii?.tratamiento || "",
    JSON.stringify(wasteValidation),
    JSON.stringify(diwassPayload),
  ]);

  const compliance = documento.preparacion_digital?.cumplimiento_operativo || {};
  const adr = compliance.adr || {};
  await db.query(`
    INSERT INTO regulatory_dangerous_goods_details
      (empresa_id,pedido_id,adr_applicable,un_number,adr_class,packing_group,tunnel_code,validation,raw)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
    ON CONFLICT (empresa_id,pedido_id)
    DO UPDATE SET
      adr_applicable=EXCLUDED.adr_applicable,
      un_number=EXCLUDED.un_number,
      adr_class=EXCLUDED.adr_class,
      packing_group=EXCLUDED.packing_group,
      tunnel_code=EXCLUDED.tunnel_code,
      validation=EXCLUDED.validation,
      raw=EXCLUDED.raw,
      updated_at=NOW()
  `, [
    empresaId,
    pedidoId,
    dangerousValidation.applicable,
    adr.un_number || adr.numero_onu || "",
    adr.adr_class || adr.clase || "",
    adr.packing_group || adr.grupo_embalaje || "",
    adr.tunnel_code || adr.codigo_tunel || "",
    JSON.stringify(dangerousValidation),
    JSON.stringify(adr || {}),
  ]);

  let regulatoryDocument = null;
  if (repository?.id) {
    const documentHash = repository.pdf_hash_sha256 || repository.payload_hash_sha256 || "";
    const { rows } = await db.query(`
      INSERT INTO regulatory_documents
        (empresa_id,pedido_id,document_type,status,source_table,source_id,filename,mime,hash_sha256,url,metadata)
      VALUES ($1,$2,'deca','archived','documento_control_repositorio',$3,$4,$5,$6,$7,$8::jsonb)
      ON CONFLICT (empresa_id, source_table, source_id) WHERE source_id IS NOT NULL
      DO UPDATE SET
        status=EXCLUDED.status,
        filename=EXCLUDED.filename,
        mime=EXCLUDED.mime,
        hash_sha256=EXCLUDED.hash_sha256,
        url=EXCLUDED.url,
        metadata=EXCLUDED.metadata,
        updated_at=NOW()
      RETURNING id
    `, [
      empresaId,
      pedidoId,
      repository.id,
      repository.pdf_filename || repository.filename || "",
      repository.pdf_mime || "application/pdf",
      documentHash,
      repository.public_url || "",
      JSON.stringify({
        public_activo: repository.public_activo,
        public_expires_at: repository.public_expires_at,
        retencion_minima_hasta: repository.retencion_minima_hasta,
      }),
    ]);
    regulatoryDocument = rows[0] || null;
    if (regulatoryDocument?.id) {
      await db.query(`
        WITH next_version AS (
          SELECT COALESCE(MAX(version),0)+1 AS version FROM regulatory_document_versions WHERE document_id=$1
        )
        INSERT INTO regulatory_document_versions (document_id,version,payload,hash_sha256,reason,created_by)
        SELECT $1,version,$2::jsonb,$3,$4,$5 FROM next_version
      `, [
        regulatoryDocument.id,
        JSON.stringify({ payload, structured_export: exportData, repository }),
        documentHash || sha256Hex({ payload, exportData }),
        reason,
        userId || null,
      ]).catch(() => {});
    }
  }

  const eftiPayload = buildEftiPayload(exportData);
  const efti = await upsertPayload({
    empresaId,
    pedidoId,
    type: "efti",
    payload: eftiPayload,
    validation: eftiPayload.digital_readiness || {},
  });
  const diwass = await upsertPayload({
    empresaId,
    pedidoId,
    type: "diwass",
    payload: diwassPayload,
    validation: wasteValidation,
  });
  const ecmr = await upsertPayload({
    empresaId,
    pedidoId,
    type: "ecmr",
    payload: exportData.ecmr_consignment_note || {},
    validation: {
      status: exportData.ecmr_consignment_note?.status || "prepared",
      missing: exportData.ecmr_consignment_note?.missing_fields || [],
    },
  });
  const checklist = buildRegulatoryChecklist({
    documento,
    structuredExport: exportData,
    repository,
    payloads: { efti, diwass, ecmr },
  });

  await db.query(`
    INSERT INTO regulatory_audit_logs (empresa_id,pedido_id,actor_user_id,action,detail)
    VALUES ($1,$2,$3,$4,$5::jsonb)
  `, [
    empresaId,
    pedidoId,
    userId || null,
    "regulatory_core.synced",
    JSON.stringify({
      reason,
      payloads: [efti, diwass, ecmr].filter(Boolean).map(p => ({ type: p.payload_type, status: p.status, version: p.version, hash: p.hash_sha256 })),
      checklist,
      waste: wasteValidation,
      adr: dangerousValidation,
      repository_id: repository?.id || null,
    }),
  ]).catch(() => {});

  return {
    efti,
    diwass,
    ecmr,
    checklist,
    waste: wasteValidation,
    adr: dangerousValidation,
    repository_id: repository?.id || null,
  };
}

async function getPedidoRegulatoryCoreSummary(pedidoId, empresaId) {
  await ensureRegulatoryCoreSchema();
  const [payloads, docs, waste, adr, audit] = await Promise.all([
    db.query(
      `SELECT payload_type,status,version,hash_sha256,validation,updated_at
         FROM regulatory_payloads
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY payload_type`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT document_type,status,filename,mime,hash_sha256,updated_at
         FROM regulatory_documents
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY updated_at DESC`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT is_waste,procedure_type,waste_code,hazardous,annex_vii,notification_required,validation,updated_at
         FROM regulatory_waste_details
        WHERE pedido_id=$1 AND empresa_id=$2
        LIMIT 1`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT adr_applicable,un_number,adr_class,validation,updated_at
         FROM regulatory_dangerous_goods_details
        WHERE pedido_id=$1 AND empresa_id=$2
        LIMIT 1`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT action,detail,created_at
         FROM regulatory_audit_logs
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY created_at DESC
        LIMIT 10`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
  ]);
  return {
    payloads: payloads.rows || [],
    documents: docs.rows || [],
    waste: waste.rows?.[0] || null,
    adr: adr.rows?.[0] || null,
    audit: audit.rows || [],
    checklist: audit.rows?.[0]?.detail?.checklist || null,
  };
}

async function buildRegulatoryTransportPackage(pedidoId, empresaId, options = {}) {
  await ensureRegulatoryCoreSchema();
  const includePayloadBodies = options.includePayloadBodies !== false;
  const [pedido, payloads, docs, versions, parties, locations, goods, waste, adr, audit, transmissions] = await Promise.all([
    db.query(
      `SELECT id,numero,estado::text,origen,destino,fecha_carga,fecha_descarga,fecha_entrega,mercancia,peso_kg,created_at,updated_at
         FROM pedidos
        WHERE id=$1 AND empresa_id=$2
        LIMIT 1`,
      [pedidoId, empresaId]
    ).then(r => r.rows?.[0] || null),
    db.query(
      `SELECT id,payload_type,status,version,${includePayloadBodies ? "payload," : ""}hash_sha256,validation,external_reference,created_at,updated_at
         FROM regulatory_payloads
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY payload_type`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT id,document_type,status,source_table,source_id,filename,mime,hash_sha256,url,metadata,created_at,updated_at
         FROM regulatory_documents
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY updated_at DESC`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT rdv.id,rdv.document_id,rd.document_type,rdv.version,rdv.hash_sha256,rdv.reason,rdv.created_at
         FROM regulatory_document_versions rdv
         JOIN regulatory_documents rd ON rd.id=rdv.document_id
        WHERE rd.pedido_id=$1 AND rd.empresa_id=$2
        ORDER BY rdv.created_at DESC
        LIMIT 100`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT role,name,tax_id,address,contact,source,raw,updated_at
         FROM regulatory_parties
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY role`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT role,name,address,country,geo,raw,updated_at
         FROM regulatory_locations
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY role`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT description,weight_kg,packages,units,indicators,raw,updated_at
         FROM regulatory_goods
        WHERE pedido_id=$1 AND empresa_id=$2`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT is_waste,procedure_type,waste_code,hazardous,annex_vii,notification_required,transit_countries,producer,notifier,receiving_facility,treatment_operation,validation,raw,updated_at
         FROM regulatory_waste_details
        WHERE pedido_id=$1 AND empresa_id=$2
        LIMIT 1`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT adr_applicable,un_number,adr_class,packing_group,tunnel_code,validation,raw,updated_at
         FROM regulatory_dangerous_goods_details
        WHERE pedido_id=$1 AND empresa_id=$2
        LIMIT 1`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT action,detail,created_at
         FROM regulatory_audit_logs
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY created_at DESC
        LIMIT 50`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT rt.id,rt.payload_type,rt.provider,rt.direction,rt.status,rt.idempotency_key,rt.request_hash_sha256,rt.response,rt.error_message,rt.created_at,rt.updated_at
         FROM regulatory_transmissions rt
        WHERE rt.pedido_id=$1 AND rt.empresa_id=$2
        ORDER BY rt.created_at DESC
        LIMIT 50`,
      [pedidoId, empresaId]
    ).catch(() => ({ rows: [] })),
  ]);
  if (!pedido) return null;
  const payloadRows = payloads.rows || [];
  const documentRows = docs.rows || [];
  const latestChecklist = (audit.rows || [])[0]?.detail?.checklist || null;
  const hasPayload = type => payloadRows.some(p => p.payload_type === type && p.hash_sha256);
  const hasDoc = type => documentRows.some(d => d.document_type === type && d.hash_sha256);
  const packageBody = {
    schema: "transgest.regulatory.transport_package.v1",
    generated_at: new Date().toISOString(),
    scope: {
      tenant_isolation: "empresa_id",
      pedido_id: pedido.id,
      pedido_numero: pedido.numero,
      status: pedido.estado,
    },
    regulatory_readiness: {
      deca: hasDoc("deca") ? "archived" : "missing",
      efti: hasPayload("efti") ? "internal_payload_ready" : "missing",
      ecmr: hasPayload("ecmr") ? "internal_payload_ready" : "missing",
      diwass: hasPayload("diwass") ? "internal_payload_ready" : "missing",
      official_exchange: "requires_certified_or_connected_platform_when_applicable",
      checklist_status: latestChecklist?.status || "not_synced",
      blocking: latestChecklist?.blocking || [],
    },
    pedido,
    documents: documentRows,
    document_versions: versions.rows || [],
    payloads: payloadRows,
    parties: parties.rows || [],
    locations: locations.rows || [],
    goods: goods.rows || [],
    waste: waste.rows?.[0] || null,
    adr: adr.rows?.[0] || null,
    audit: audit.rows || [],
    transmissions: transmissions.rows || [],
    governance: {
      deca_public_download_policy: "URL/QR descargable durante el servicio; desactivable tras el plazo operativo.",
      retention_policy: "Conservacion interna minima recomendada: 1 ano, ampliable por politica de empresa.",
      immutable_evidence: "Hashes SHA-256 y versiones de documento/payload para detectar cambios.",
    },
  };
  const packageWithHash = {
    ...packageBody,
    package_hash_sha256: sha256Hex(packageBody),
  };
  return {
    ...packageWithHash,
    certification_dossier: buildRegulatoryCertificationDossier(packageWithHash),
  };
}

async function getRegulatoryPayloadForExport(pedidoId, empresaId, payloadType) {
  await ensureRegulatoryCoreSchema();
  const allowed = new Set(["efti", "diwass", "ecmr"]);
  const type = String(payloadType || "").trim().toLowerCase();
  if (!allowed.has(type)) {
    const err = new Error("Tipo de payload no soportado");
    err.status = 400;
    throw err;
  }
  const { rows } = await db.query(
    `SELECT id,payload_type,status,version,payload,hash_sha256,validation,external_reference,created_at,updated_at
       FROM regulatory_payloads
      WHERE pedido_id=$1 AND empresa_id=$2 AND payload_type=$3
      LIMIT 1`,
    [pedidoId, empresaId, type]
  );
  return rows[0] || null;
}

async function createRegulatoryTransmissionDraft({ empresaId, pedidoId, payloadType, provider, userId = null }) {
  await ensureRegulatoryCoreSchema();
  const payload = await getRegulatoryPayloadForExport(pedidoId, empresaId, payloadType);
  if (!payload) {
    const err = new Error("Primero genera o sincroniza el payload regulatorio del pedido.");
    err.status = 404;
    throw err;
  }
  const type = String(payloadType || "").trim().toLowerCase();
  const providerKey = cleanText(provider || "certified_platform_pending").toLowerCase().replace(/[^a-z0-9._-]+/g, "_").slice(0, 80) || "certified_platform_pending";
  const integration = await db.query(
    `INSERT INTO regulatory_external_integrations (empresa_id,integration_type,provider,status,metadata)
     VALUES ($1,$2,$3,'planned',$4::jsonb)
     ON CONFLICT (empresa_id,integration_type,provider)
     DO UPDATE SET updated_at=NOW()
     RETURNING id,integration_type,provider,status`,
    [empresaId, type, providerKey, JSON.stringify({ created_from: "transmission_draft" })]
  );
  const idempotency = `${empresaId}:${pedidoId}:${type}:${providerKey}:${payload.version}:${payload.hash_sha256}`.slice(0, 160);
  const requestHash = sha256Hex({
    pedido_id: pedidoId,
    payload_type: type,
    provider: providerKey,
    payload_hash_sha256: payload.hash_sha256,
    version: payload.version,
  });
  const { rows } = await db.query(
    `INSERT INTO regulatory_transmissions
       (empresa_id,pedido_id,payload_id,integration_id,payload_type,provider,status,idempotency_key,request_hash_sha256,response,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9::jsonb,$10)
     ON CONFLICT (empresa_id,idempotency_key)
     DO UPDATE SET updated_at=NOW()
     RETURNING id,payload_type,provider,direction,status,idempotency_key,request_hash_sha256,response,created_at,updated_at`,
    [
      empresaId,
      pedidoId,
      payload.id,
      integration.rows[0]?.id || null,
      type,
      providerKey,
      idempotency,
      requestHash,
      JSON.stringify({
        note: "Draft only. No external certified platform call was made.",
        payload_hash_sha256: payload.hash_sha256,
        payload_version: payload.version,
      }),
      userId || null,
    ]
  );
  await db.query(
    `INSERT INTO regulatory_audit_logs (empresa_id,pedido_id,actor_user_id,action,detail)
     VALUES ($1,$2,$3,'regulatory_transmission.draft_created',$4::jsonb)`,
    [empresaId, pedidoId, userId || null, JSON.stringify(rows[0] || {})]
  ).catch(() => {});
  return rows[0] || null;
}

module.exports = {
  ensureRegulatoryCoreSchema,
  syncPedidoRegulatoryCore,
  getPedidoRegulatoryCoreSummary,
  buildRegulatoryTransportPackage,
  getRegulatoryPayloadForExport,
  createRegulatoryTransmissionDraft,
  buildEftiPayload,
  buildDiwassPayload,
  buildRegulatoryChecklist,
  buildRegulatoryCertificationDossier,
  generateRegulatoryDossierPdf,
};
