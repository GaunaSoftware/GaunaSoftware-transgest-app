import { displayOrderLocation } from './orderTown';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const textFields = value => Object.fromEntries(Object.entries(value || {}).map(([key, field]) => [key, typeof field === 'string' ? escapeHtml(field) : field]));
const imageData = value => /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(String(value || '')) ? value : '';

export function waybillLocation(order, type) {
  let points = type === 'carga' ? order.puntos_carga : order.puntos_descarga;
  if (typeof points === 'string') { try { points = JSON.parse(points); } catch { points = []; } }
  const point = Array.isArray(points) ? points.find(p => p && typeof p === 'object') || {} : {};
  return { label:displayOrderLocation(order,type), address:String(point.direccion_normalizada || point.direccion || point.address || '').trim() };
}

// Printable presentation of the existing waybill; no persistence or fiscal mutation.
export function buildWaybillHtml({data, docNumero, pedidoNumero, documentoTitulo, isCmrInternacional, origenGeo, destinoGeo, origenPostalGeo, destinoPostalGeo, anexosConArchivo, firmas, firmaNombre}) {
    const origen = waybillLocation(data || {}, 'carga');
    const destino = waybillLocation(data || {}, 'descarga');
    const d = textFields(data);
    docNumero = escapeHtml(docNumero);
    pedidoNumero = escapeHtml(pedidoNumero);
    documentoTitulo = escapeHtml(documentoTitulo);
    origenGeo = escapeHtml(origenGeo);
    destinoGeo = escapeHtml(destinoGeo);
    origenPostalGeo = escapeHtml(origenPostalGeo);
    destinoPostalGeo = escapeHtml(destinoPostalGeo);
    firmaNombre = escapeHtml(firmaNombre);
    firmas = Object.fromEntries(Object.entries(firmas || {}).map(([key, value]) => [key, imageData(value)]));
    anexosConArchivo = (anexosConArchivo || []).map(a => ({...textFields(a), data_url:imageData(a.data_url)}));
    const anexosHtml = anexosConArchivo.length ? `
<div class="page-break"></div>
<h1>Anexos de la carta de porte / DCD</h1>
<div style="font-size:10px;color:#555;text-align:center;margin-bottom:12px">
  Albaranes, POD o CMR subidos al viaje una vez firmados.
</div>
${anexosConArchivo.map((a, idx) => `
  <div class="box anexo-box">
    <h2>Anexo ${idx + 1}: ${a.etiqueta || a.tipo || "Documento adjunto"}</h2>
    <div class="grid3" style="margin-bottom:8px">
      <div><div class="lbl">Nombre</div><div class="val">${a.nombre || "-"}</div></div>
      <div><div class="lbl">Tipo</div><div class="val">${a.tipo || "-"}</div></div>
      <div><div class="lbl">Fecha subida</div><div class="val">${a.created_at ? new Date(a.created_at).toLocaleString("es-ES") : "-"}</div></div>
    </div>
    ${a.data_url
      ? `<img src="${a.data_url}" class="anexo-img" alt="${a.nombre || "Anexo"}"/>`
      : `<div class="anexo-pdf">PDF adjunto al expediente DCD: ${a.nombre || "Documento"}${a.size_kb ? ` (${a.size_kb} KB)` : ""}</div>`}
  </div>
`).join("")}` : "";
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>${documentoTitulo} - ${docNumero}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#111;padding:20px}
  h1{font-size:16px;font-weight:700;text-align:center;letter-spacing:1px;margin-bottom:4px}
  h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;color:#1e3a5f;border-bottom:1px solid #1e3a5f;padding-bottom:3px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #1e3a5f}
  .empresa{flex:1}
  .doc-info{text-align:right;min-width:180px}
  .doc-num{font-size:20px;font-weight:700;color:#1e3a5f}
  .doc-label{font-size:9px;color:#666;letter-spacing:1px;text-transform:uppercase}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px}
  .box{border:1px solid #ccc;border-radius:4px;padding:10px}
  .lbl{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
  .val{font-size:11px;font-weight:600}
  .val-big{font-size:14px;font-weight:700;color:#1e3a5f}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#1e3a5f;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
  td{padding:6px 8px;border-bottom:1px solid #eee;font-size:11px}
  .firma-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:20px}
  .firma-box{border:1px solid #ccc;border-radius:4px;padding:10px;min-height:80px}
  .firma-label{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .firma-line{margin-top:50px;border-top:1px solid #999;font-size:9px;color:#666;padding-top:3px}
  .status{display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700}
  .badge-ok{background:#d1fae5;color:#065f46}
  .badge-warn{background:#fef3c7;color:#92400e}
  .cmr-note{border-color:var(--accent);background:#f0fdfa;margin-bottom:12px}
  .cmr-note h2{color:var(--accent);border-bottom-color:var(--accent)}
  .page-break{break-before:page;page-break-before:always}
  .anexo-box{margin-bottom:14px;break-inside:avoid;page-break-inside:avoid}
  .anexo-img{display:block;max-width:100%;max-height:920px;margin:10px auto 0;border:1px solid #ddd;object-fit:contain}
  .anexo-pdf{border:1px dashed #999;border-radius:4px;padding:14px;background:#f8fafc;color:#334155;font-size:12px}
  @media print{@page{margin:1cm}body{padding:0}}
</style></head><body>
<div class="header">
  <div class="empresa">
    <div style="font-size:18px;font-weight:700;color:#1e3a5f">${d.empresa_nombre||"-"}</div>
    <div style="color:#555">CIF: ${d.empresa_cif||"-"} - ${d.empresa_direccion||""} - Tel: ${d.empresa_telefono||"-"}</div>
    <div style="color:#555">${d.empresa_email||""}</div>
  </div>
  <div class="doc-info">
    <div class="doc-label">${documentoTitulo}</div>
    <div class="doc-num">${docNumero||"-"}</div>
    <div style="font-size:10px;color:#555;margin-top:4px">Pedido: ${pedidoNumero||"-"}</div>
    <div style="font-size:10px;color:#555;margin-top:4px">Fecha: ${new Date().toLocaleDateString("es-ES")}</div>
    <div style="margin-top:6px">
      <span class="status ${["entregado","facturado"].includes(d.estado)?"badge-ok":"badge-warn"}">${(d.estado||"").toUpperCase()}</span>
    </div>
  </div>
</div>

${isCmrInternacional ? `<div class="box cmr-note">
  <h2>CMR internacional</h2>
  <div class="grid3" style="margin-bottom:0">
    <div><div class="lbl">CP / poblacion / provincia carga</div><div class="val">${origenPostalGeo || origenGeo || "-"}</div></div>
    <div><div class="lbl">CP / poblacion / provincia entrega</div><div class="val">${destinoPostalGeo || destinoGeo || "-"}</div></div>
    <div><div class="lbl">Regimen</div><div class="val">Transporte internacional por carretera sujeto al Convenio CMR cuando proceda</div></div>
  </div>
  <div style="margin-top:8px;font-size:10px;color:#134e4a">
    Verifica remitente, transportista, destinatario, lugar y fecha de toma de mercancia, lugar de entrega, descripcion, bultos, marcas/numeros, peso/cantidad, gastos, instrucciones y documentos entregados.
  </div>
</div>` : ""}

<div class="grid2">
  <div class="box">
    <h2>Transportista (Porteador)</h2>
    <div class="lbl">Empresa</div><div class="val">${d.empresa_nombre||"-"}</div>
    <div class="lbl" style="margin-top:6px">CIF</div><div class="val">${d.empresa_cif||"-"}</div>
    <div class="lbl" style="margin-top:6px">Direccion</div><div class="val">${d.empresa_direccion||"-"}</div>
    <div class="lbl" style="margin-top:6px">Telefono / Email</div>
    <div class="val">${d.empresa_telefono||"-"} - ${d.empresa_email||"-"}</div>
  </div>
  <div class="box">
    <h2>Remitente / Cliente</h2>
    <div class="lbl">Empresa / Persona</div><div class="val">${d.cliente_nombre||"-"}</div>
    <div class="lbl" style="margin-top:6px">CIF / NIF</div><div class="val">${d.cliente_cif||"-"}</div>
    <div class="lbl" style="margin-top:6px">Direccion</div><div class="val">${d.cliente_dir||d.cliente_ciudad||"-"}</div>
    <div class="lbl" style="margin-top:6px">Telefono / Email</div>
    <div class="val">${d.cliente_tel||"-"} - ${d.cliente_email||"-"}</div>
  </div>
</div>

<div class="grid2">
  <div class="box">
    <h2>Origen (Carga)</h2>
    <div class="val-big">${escapeHtml(origen.label)}</div>
    ${origen.address ? `<div class="lbl" style="margin-top:6px">Dirección de carga</div><div class="val">${escapeHtml(origen.address)}</div>` : ''}
    <div class="lbl" style="margin-top:6px">Pais / provincia</div>
    <div class="val">${origenGeo || "-"}</div>
    <div class="lbl" style="margin-top:6px">Codigo postal / poblacion / provincia</div>
    <div class="val">${origenPostalGeo || "-"}</div>
    <div class="lbl" style="margin-top:8px">Fecha de carga</div>
    <div class="val">${d.fecha_carga?new Date(d.fecha_carga).toLocaleDateString("es-ES"):"-"}${d.hora_carga?" - "+d.hora_carga:""}</div>
    ${d.ventana_carga?`<div class="lbl" style="margin-top:4px">Ventana horaria</div><div class="val">${d.ventana_carga}</div>`:""}
    ${d.referencia_cliente?`<div class="lbl" style="margin-top:4px">Ref. cliente</div><div class="val">${d.referencia_cliente}</div>`:""}
  </div>
  <div class="box">
    <h2>Destino (Descarga)</h2>
    <div class="val-big">${escapeHtml(destino.label)}</div>
    ${destino.address ? `<div class="lbl" style="margin-top:6px">Dirección de descarga</div><div class="val">${escapeHtml(destino.address)}</div>` : ''}
    <div class="lbl" style="margin-top:6px">Pais / provincia</div>
    <div class="val">${destinoGeo || "-"}</div>
    <div class="lbl" style="margin-top:6px">Codigo postal / poblacion / provincia</div>
    <div class="val">${destinoPostalGeo || "-"}</div>
    <div class="lbl" style="margin-top:8px">Fecha de entrega</div>
    <div class="val">${d.fecha_entrega?new Date(d.fecha_entrega).toLocaleDateString("es-ES"):"-"}${d.hora_descarga?" - "+d.hora_descarga:""}</div>
    ${d.ventana_descarga?`<div class="lbl" style="margin-top:4px">Ventana horaria</div><div class="val">${d.ventana_descarga}</div>`:""}
  </div>
</div>

<h2>Mercancia</h2>
<table>
  <thead><tr>
    <th style="width:40%">Descripcion</th><th>Bultos</th><th>Peso (kg)</th>
    <th>Volumen (m3)</th><th>ML</th><th>Tipo carga</th><th>Valor</th>
  </tr></thead>
  <tbody><tr>
    <td>${d.mercancia||"-"}</td>
    <td>${d.bultos||"-"}</td>
    <td>${d.peso_kg?Number(d.peso_kg).toLocaleString("es-ES")+" kg":"-"}</td>
    <td>${d.volumen||"-"}</td>
    <td>${d.metros_lineales||"-"}</td>
    <td>${d.tipo_carga||"-"}</td>
    <td>${d.importe?Number(d.importe).toLocaleString("es-ES",{minimumFractionDigits:2})+" EUR":"-"}</td>
  </tr></tbody>
</table>

${isCmrInternacional ? `<div class="grid2">
  <div class="box">
    <h2>Documentos / Aduanas</h2>
    <div class="lbl">Documentos entregados al transportista</div>
    <div class="val">${d.documentos_aduaneros || d.condiciones_adicionales || "-"}</div>
    <div class="lbl" style="margin-top:6px">Instrucciones del remitente</div>
    <div class="val">${d.instrucciones_aduaneras || d.notas || "-"}</div>
  </div>
  <div class="box">
    <h2>Reservas y gastos</h2>
    <div class="lbl">Reservas del transportista</div>
    <div class="val">${d.reservas_transportista || "-"}</div>
    <div class="lbl" style="margin-top:6px">Gastos / porte</div>
    <div class="val">${d.importe?Number(d.importe).toLocaleString("es-ES",{minimumFractionDigits:2})+" EUR":"-"}</div>
  </div>
</div>` : ""}

<div class="grid3">
  <div class="box">
    <h2>Vehiculo Tractor</h2>
    <div class="val-big">${d.veh_matricula||"-"}</div>
    <div class="val" style="color:#555">${[d.veh_marca,d.veh_modelo].filter(Boolean).join(" ")||""}</div>
  </div>
  <div class="box">
    <h2>Remolque / Semirremolque</h2>
    <div class="val-big">${d.rem_matricula||"-"}</div>
  </div>
  <div class="box">
    <h2>Chofer</h2>
    <div class="val-big">${[d.chofer_nombre,d.chofer_apellidos].filter(Boolean).join(" ")||"-"}</div>
    ${d.chofer_dni?`<div class="lbl" style="margin-top:4px">DNI/NIE</div><div class="val">${d.chofer_dni}</div>`:""}
    ${d.chofer_tel?`<div class="lbl" style="margin-top:4px">Telefono</div><div class="val">${d.chofer_tel}</div>`:""}
  </div>
</div>

${d.notas?`<div class="box" style="margin-bottom:12px"><h2>Observaciones</h2><div style="white-space:pre-line">${d.notas}</div></div>`:""}

<div class="firma-row">
  <div class="firma-box">
    <div class="firma-label">Firma Remitente</div>
    ${firmas.remitente
      ? `<img src="${firmas.remitente}" style="max-width:100%;max-height:60px;margin-top:4px"/>`
      : `<div class="firma-line">Nombre y sello</div>`}
  </div>
  <div class="firma-box">
    <div class="firma-label">Firma Chofer / Transportista</div>
    ${firmas.chofer
      ? `<img src="${firmas.chofer}" style="max-width:100%;max-height:60px;margin-top:4px"/>`
      : `<div class="firma-line">Nombre y sello</div>`}
  </div>
  <div class="firma-box">
    <div class="firma-label">Firma Destinatario</div>
    ${firmas.destinatario
      ? `<img src="${firmas.destinatario}" style="max-width:100%;max-height:60px;margin-top:4px"/>
         <div style="font-size:9px;color:#555;margin-top:3px">${firmaNombre||""}</div>
         <div style="font-size:9px;color:#555;">Fecha: ${new Date().toLocaleDateString("es-ES")}</div>`
      : `<div class="firma-line">Nombre, sello y fecha de recepcion</div>`}
  </div>
</div>

<div style="text-align:center;margin-top:16px;font-size:9px;color:#999;border-top:1px solid #eee;padding-top:8px">
  Documento generado por TransGest TMS - ${new Date().toLocaleString("es-ES")}
</div>
${anexosHtml}
</body></html>`;
  
}
