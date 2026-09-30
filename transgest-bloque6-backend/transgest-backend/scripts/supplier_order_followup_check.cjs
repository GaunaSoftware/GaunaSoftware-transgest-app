const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pdfParse = require("pdf-parse");
const { PGlite } = require("@electric-sql/pglite");
const { canonicalOrderAmount, correctedLegacyOrderAmount, legacyUnbilledClientDelta } = require("../src/services/orderPriceReconciliation");
const { pedidoConImporteVisible } = require("../src/routes/pedidos")._test;
const { buildSupplierLoadOrderPdf, companyDataForSupplierOrder, stopLines } = require("../src/services/supplierLoadOrderPdf");
const { PLANTILLAS } = require("../src/services/email");

async function main() {
  const order = {
    numero: "PED-QA-0501", orden_carga_numero: "OC-QA-0307", tipo_precio: "viaje",
    precio_unitario: 275, importe: 275, precio_cliente_col: 275,
    puntos_carga: [{ nombre: "Planta Norte", direccion: "Calle Uno 1", poblacion: "Madrid", fecha: "2026-09-30", google_maps_url: "https://maps.app.goo.gl/example" }],
    puntos_descarga: [
      { nombre: "Descarga suplementaria", direccion: "Calle Dos 2", poblacion: "Sevilla", precio: 40, fecha: "2026-10-01", google_maps_url: "https://www.google.com/maps/search/?api=1&query=Sevilla" },
      { nombre: "Destino", direccion: "Calle Tres 3", poblacion: "Cádiz", fecha: "2026-10-02" },
    ],
    empresa_nombre: "Transportes sintéticos, S.L.", empresa_cif: "B00000000",
    empresa_direccion: "Calle Prueba 1", empresa_cp: "28001", empresa_ciudad: "Madrid",
    empresa_provincia: "Madrid", empresa_pais: "España", empresa_email: "empresa@example.invalid",
    empresa_emails_albaranes: "albaranes@example.invalid",
    empresa_perfil: { texto_pago_colaboradores: "Transferencia a 30 días" },
    colaborador_nombre: "Colaborador QA", colaborador_cif: "B11111111",
    matricula_colaborador: "1234-ABC", remolque_matricula_colaborador: "R-1234-XYZ",
    mercancia: "Mercancía de prueba", peso_kg: 12000, bultos: 10,
    condiciones_adicionales: "Llamar antes de entrar.", destino: "Cádiz",
  };
  const scheduledStops = stopLines([{nombre:'Primera',fecha:'2026-10-01'},{nombre:'Segunda',fecha_descarga:'2026-10-02',hora_descarga:'11:30'}]);
  assert.match(scheduledStops[1].when,/02\/10\/2026.*11:30/, 'La segunda descarga confirma fecha y hora propias del pedido');
  assert.equal(canonicalOrderAmount(order), 315);
  assert.equal(correctedLegacyOrderAmount(order), 315);
  assert.equal(pedidoConImporteVisible(order).importe, 315);
  assert.equal(pedidoConImporteVisible({ ...order, factura_id: "fiscal", factura_estado: "emitida" }).importe, 275,
    "una factura emitida conserva el precio histórico");
  assert.equal(canonicalOrderAmount({ ...order, puntos_descarga: [...order.puntos_descarga].reverse() }), 315);
  assert.equal(correctedLegacyOrderAmount({ ...order, importe: 310 }), null, "no cambiar importes negociados");
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE pedidos (
      empresa_id uuid, cliente_id uuid, estado text, factura_id uuid,
      importe numeric, precio_unitario numeric, tipo_precio text, cantidad numeric,
      extracostes_importe numeric, importe_minimo numeric, minimo_unidades numeric,
      puntos_descarga jsonb, puntos_carga jsonb
    )`);
    const companyA = "11111111-1111-4111-8111-111111111111";
    const companyB = "22222222-2222-4222-8222-222222222222";
    const clientA = "33333333-3333-4333-8333-333333333333";
    const clientB = "44444444-4444-4444-8444-444444444444";
    for (const [company, customer, amount, invoice] of [
      [companyA, clientA, 275, null], [companyA, clientA, 310, null],
      [companyA, clientA, 275, "55555555-5555-4555-8555-555555555555"],
      [companyB, clientA, 275, null], [companyA, clientB, 275, null],
    ]) {
      await pg.query(`INSERT INTO pedidos (empresa_id,cliente_id,estado,factura_id,importe,precio_unitario,tipo_precio,cantidad,puntos_descarga,puntos_carga)
        VALUES ($1,$2,'confirmado',$3,$4,275,'viaje',1,$5::jsonb,'[]'::jsonb)`,
      [company, customer, invoice, amount, JSON.stringify(order.puntos_descarga)]);
    }
    assert.equal(await legacyUnbilledClientDelta(pg, companyA, clientA), 40,
      "el aviso corrige solo el pedido facturable de la empresa y conserva el precio negociado");
    assert.equal(await legacyUnbilledClientDelta(pg, companyB, clientA), 40);
    assert.equal(await legacyUnbilledClientDelta(pg, companyA, clientB), 40);
  } finally { await pg.close(); }
  assert.equal(stopLines(order.puntos_carga)[0].mapUrl, "https://maps.app.goo.gl/example");
  assert.equal(companyDataForSupplierOrder({
    empresa_cif: "B03486675",
    empresa_cfg_precios: { empresa_perfil: { cif: "B-03168853", razon_social: "Transportes Asensi" } },
  }).empresa_cif, "B-03168853", "el PDF del correo usa el CIF configurado en Mi Empresa");
  const pdf = await buildSupplierLoadOrderPdf(order, { orderNumber: order.orden_carga_numero, priceLabel: "290,00 EUR", acceptedAt: new Date("2026-09-30T09:00:00Z") });
  const output = path.join(os.tmpdir(), "transgest-orden-colaborador-sintetica.pdf");
  fs.writeFileSync(output, pdf);
  const parsed = await pdfParse(pdf);
  for (const text of ["ORDEN DE CARGA", "Descarga 2", "Condiciones para el colaborador", "Cláusula de revisión del combustible",
    "albaranes@example.invalid", "290,00 EUR", "Calle Prueba 1", "Llamar antes de entrar."]) {
    assert.ok(parsed.text.toLocaleLowerCase("es-ES").includes(text.toLocaleLowerCase("es-ES")), `Falta en el PDF: ${text}`);
  }
  assert.equal(parsed.numpages, 2, "la orden sintética no debe añadir páginas vacías");
  assert.ok(pdf.toString("latin1").includes("https://www.google.com/maps"), "Falta enlace de Maps");
  assert.ok(!parsed.text.includes("315,00 EUR"), "No mostrar el precio cobrado al cliente al colaborador");
  for (const template of ["colaborador_confirmar", "colaborador_carga", "colaborador_camino", "colaborador_descarga"]) {
    const rendered = PLANTILLAS[template]({ numero: order.numero, url: "https://example.invalid/paso", colaborador: order.colaborador_nombre });
    assert.match(rendered.html, template === "colaborador_descarga" ? /albaranes firmados/i : /otro correo|recibirás|por separado/i);
    assert.match(rendered.html, /https:\/\/example.invalid\/paso/);
  }
  console.log(`PASS suplementos 275 + 40 = 315, orden PDF (${parsed.numpages} páginas), Maps, precio privado y correos por etapas: ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
