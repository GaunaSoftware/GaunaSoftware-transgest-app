const baseUrl = (process.env.FUNCTIONAL_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, "");
const user = process.env.FUNCTIONAL_USER || "gerente@empresa.com";
const password = process.env.FUNCTIONAL_PASSWORD || "demo1234";
const clienteUser = process.env.FUNCTIONAL_CLIENTE_USER || "cliente@empresa.com";
const clientePassword = process.env.FUNCTIONAL_CLIENTE_PASSWORD || "demo1234";
const superadminUser = process.env.FUNCTIONAL_SUPERADMIN_USER || process.env.SUPERADMIN_EMAIL || "admin@transgest.local";
const superadminPassword = process.env.FUNCTIONAL_SUPERADMIN_PASSWORD || process.env.SUPERADMIN_PASSWORD || "admin1234";

async function request(name, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = typeof data === "object" && data?.error ? data.error : String(text || res.statusText);
    throw new Error(`${name}: ${res.status} ${message.slice(0, 220)}`);
  }
  console.log(`OK ${name}`);
  return data;
}

async function expectStatus(name, path, expectedStatus, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (res.status >= 500) {
    throw new Error(`${name}: error servidor ${res.status}. ${text.slice(0, 220)}`);
  }
  if (res.status !== expectedStatus) {
    throw new Error(`${name}: esperado ${expectedStatus}, recibido ${res.status}. ${text.slice(0, 220)}`);
  }
  console.log(`OK ${name}`);
}

async function fetchRaw(name, urlOrPath, options = {}) {
  const url = /^https?:\/\//i.test(urlOrPath) ? urlOrPath : `${baseUrl}${urlOrPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${name}: ${res.status} ${text.slice(0, 220)}`);
  }
  console.log(`OK ${name}`);
  return { res, text };
}

async function checkColaboradorPublicLink(auth) {
  const colaboradores = await request("colaboradores", "/api/v1/colaboradores", { headers: auth });
  const colab = Array.isArray(colaboradores) ? colaboradores.find(c => c?.id) : null;
  if (!colab) {
    console.log("OK portal colaborador sin datos para prueba publica");
    return;
  }
  const token = await request("crear enlace liquidacion colaborador", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/liquidacion-token`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ dias: 1 }),
  });
  if (!token?.url || !token?.portal_url || !token?.id) throw new Error("crear enlace liquidacion colaborador: no devuelve url/portal_url/id");
  const publicPage = await fetchRaw("portal colaborador liquidacion publica", token.url);
  if (!publicPage.text.includes("Liquidacion de colaborador") || !publicPage.text.includes("Portal proveedor") || !publicPage.text.includes("Descargar informe HTML") || !publicPage.text.includes("Facturas vencidas")) {
    throw new Error("portal colaborador liquidacion publica: HTML incompleto");
  }
  const portalPage = await fetchRaw("portal proveedor publico", token.portal_url);
  if (!portalPage.text.includes("Portal proveedor") || !portalPage.text.includes("Subir") || !portalPage.text.includes("Prioridades del portal") || !portalPage.text.includes("Vehiculos del proveedor") || !portalPage.text.includes("Documento digital")) {
    throw new Error("portal proveedor publico: HTML incompleto");
  }
  const portalToken = token.portal_url.split("/").pop();
  const viajesColab = await request("portal proveedor viajes colaborador", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/historial`, { headers: auth });
  const facturasColab = await request("portal proveedor facturas colaborador", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/facturas`, { headers: auth });
  let portalPagoId = null;
  let portalDocumentoNombre = null;
  let portalDocumentoId = null;
  let portalVehiculoId = null;
  const portalVehiculoMatricula = `QA-${String(Date.now()).slice(-6)}`;
  const pagoQa = await request("portal proveedor preparar pago QA", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/pagos`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      fecha: new Date().toISOString().slice(0, 10),
      concepto: `QA portal proveedor pago ${Date.now()}`,
      importe: 1,
      estado: "pagado",
      notas: "QA portal proveedor pagos",
    }),
  });
  portalPagoId = pagoQa?.id || null;
  const pagosPublicos = await request("portal proveedor pagos publicos", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/pagos`);
  if (!pagosPublicos?.resumen || !Array.isArray(pagosPublicos.pagos) || !Array.isArray(pagosPublicos.facturas_pendientes)) {
    throw new Error("portal proveedor pagos publicos: estructura invalida");
  }
  if (portalPagoId && !pagosPublicos.pagos.some(p => p.id === portalPagoId)) {
    throw new Error("portal proveedor pagos publicos: no incluye pago QA");
  }
  portalDocumentoNombre = `QA portal proveedor documento ${Date.now()}`;
  const docQa = await request("portal proveedor preparar documento QA", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/documentos`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      tipo: "seguro_rc",
      nombre: portalDocumentoNombre,
      caducidad: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      notas: "QA portal proveedor documentos",
    }),
  });
  portalDocumentoId = docQa?.id || null;
  const documentosPublicos = await request("portal proveedor documentos publicos", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/documentos`);
  if (!documentosPublicos?.resumen || !Array.isArray(documentosPublicos.documentos)) {
    throw new Error("portal proveedor documentos publicos: estructura invalida");
  }
  const docPublico = documentosPublicos.documentos.find(d => d.nombre === portalDocumentoNombre);
  if (!docPublico?.estado || docPublico.estado_color !== "amber") {
    throw new Error("portal proveedor documentos publicos: no refleja documento QA proximo a vencer");
  }
  const vehiculoQa = await request("portal proveedor preparar vehiculo QA", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/vehiculos`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      matricula: portalVehiculoMatricula,
      marca: "QA",
      modelo: "Portal",
      tipo: "Camion",
      doc_itv_venc: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10),
      doc_seguro_venc: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10),
      doc_tacografo_venc: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    }),
  });
  portalVehiculoId = vehiculoQa?.id || null;
  const vehiculosPublicos = await request("portal proveedor vehiculos publicos", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/vehiculos`);
  if (!vehiculosPublicos?.resumen || !Array.isArray(vehiculosPublicos.vehiculos)) {
    throw new Error("portal proveedor vehiculos publicos: estructura invalida");
  }
  const vehiculoPublico = vehiculosPublicos.vehiculos.find(v => v.matricula === portalVehiculoMatricula);
  if (!vehiculoPublico || !vehiculoPublico.documentos?.some(d => d.clave === "itv" && d.estado_color === "amber")) {
    throw new Error("portal proveedor vehiculos publicos: no refleja ITV QA proxima a vencer");
  }
  const resumenPublico = await request("portal proveedor resumen publico", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/resumen`);
  if (!resumenPublico?.colaborador || !resumenPublico?.pagos || !resumenPublico?.documentos || !resumenPublico?.vehiculos || !Array.isArray(resumenPublico.acciones)) {
    throw new Error("portal proveedor resumen publico: estructura invalida");
  }
  if (Number(resumenPublico.documentos.proximos_30 || 0) < 1 || Number(resumenPublico.vehiculos.proximos_30 || 0) < 1) {
    throw new Error("portal proveedor resumen publico: no refleja caducidades QA");
  }
  const accionesInternas = await request("colaborador acciones pendientes internas", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/acciones-pendientes`, { headers: auth });
  if (!accionesInternas?.colaborador || !Array.isArray(accionesInternas.acciones) || !Array.isArray(accionesInternas.documentos_en_riesgo) || !Array.isArray(accionesInternas.vehiculos_en_riesgo)) {
    throw new Error("colaborador acciones pendientes internas: estructura invalida");
  }
  if (!accionesInternas.documentos_en_riesgo.some(d => d.nombre === portalDocumentoNombre) || !accionesInternas.vehiculos_en_riesgo.some(v => v.matricula === portalVehiculoMatricula)) {
    throw new Error("colaborador acciones pendientes internas: no refleja riesgos QA");
  }
  const informeInterno = await fetchRaw("colaborador informe acciones interno", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/informe-acciones`, { headers: auth });
  const cdInterno = informeInterno.res.headers.get("content-disposition") || "";
  if (!cdInterno.toLowerCase().includes("attachment") || !informeInterno.text.includes("Informe de acciones proveedor") || !informeInterno.text.includes("Facturas pendientes o en riesgo")) {
    throw new Error("colaborador informe acciones interno: HTML/descarga incompleto");
  }
  const portalPageConQa = await fetchRaw("portal proveedor publico con resumen QA", token.portal_url);
  if (!portalPageConQa.text.includes(portalVehiculoMatricula) || !portalPageConQa.text.includes("Caducidades proximas")) {
    throw new Error("portal proveedor publico con resumen QA: no muestra vehiculo/prioridad QA");
  }
  if (!portalPageConQa.text.includes("Informe de acciones")) {
    throw new Error("portal proveedor publico con resumen QA: falta informe de acciones");
  }
  const informeAcciones = await fetchRaw("portal proveedor informe acciones", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/informe-acciones`);
  const cdAcciones = informeAcciones.res.headers.get("content-disposition") || "";
  if (!cdAcciones.toLowerCase().includes("attachment") || !informeAcciones.text.includes("Informe de acciones proveedor") || !informeAcciones.text.includes("Viajes sin soporte documental") || !informeAcciones.text.includes("Documentacion administrativa")) {
    throw new Error("portal proveedor informe acciones: HTML/descarga incompleto");
  }
  const docPublicUploadRes = await fetch(`${baseUrl}/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/documentos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-TransGest-QA": "1" },
    body: JSON.stringify({
      tipo: "certificado",
      nombre: `qa-portal-proveedor-doc-publico-${Date.now()}.txt`,
      caducidad: new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10),
      file_base64: Buffer.from("QA documento proveedor publico").toString("base64"),
      file_mime: "text/plain",
      file_size_kb: 1,
      notas: "QA subida publica documento proveedor",
    }),
  });
  const docPublicUpload = await docPublicUploadRes.json().catch(() => ({}));
  if (!docPublicUploadRes.ok || !docPublicUpload?.id || !docPublicUpload?.download_url) {
    throw new Error(`portal proveedor subir documento publico: ${docPublicUploadRes.status} ${JSON.stringify(docPublicUpload).slice(0, 160)}`);
  }
  const portalDocumentoPublicoId = docPublicUpload.id;
  const documentosTrasUpload = await request("portal proveedor documento publico listado", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/documentos`);
  const docListado = Array.isArray(documentosTrasUpload.documentos) ? documentosTrasUpload.documentos.find(d => d.nombre === docPublicUpload.nombre) : null;
  if (!docListado?.download_url || docListado.estado_color !== "amber") {
    throw new Error("portal proveedor documento publico listado: no refleja subida descargable");
  }
  const downloadDocPublico = await fetchRaw("portal proveedor descarga documento publico", `${baseUrl}${docPublicUpload.download_url}`);
  if (!downloadDocPublico.res.headers.get("content-disposition")?.toLowerCase().includes("attachment")) {
    throw new Error("portal proveedor descarga documento publico: falta attachment");
  }
  const facturaPedidoIds = new Set((Array.isArray(facturasColab) ? facturasColab : []).map(f => String(f.pedido_id || "")).filter(Boolean));
  const viajeColab = Array.isArray(viajesColab) ? viajesColab.find(v => v?.id && !facturaPedidoIds.has(String(v.id))) : null;
  let portalDocId = null;
  let portalFacturaId = null;
  if (viajeColab?.id) {
    const dcdProveedor = await request("portal proveedor documento control viaje", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/pedidos/${encodeURIComponent(viajeColab.id)}/documento-control`);
    if (!dcdProveedor?.documento?.codigo_control || !dcdProveedor?.status?.readiness || !dcdProveedor?.remision?.download_url || dcdProveedor.source !== "portal_proveedor") {
      throw new Error("portal proveedor documento control viaje: estructura incompleta");
    }
    const dcdProveedorHtml = await fetchRaw("portal proveedor documento control soporte", dcdProveedor.remision.download_url);
    if (!dcdProveedorHtml.text.includes("Documento de Control") && !dcdProveedorHtml.text.includes("Documento de control")) {
      throw new Error("portal proveedor documento control soporte: HTML incompleto");
    }
    const preAlbaranes = await request("portal proveedor albaranes previos viaje", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/pedidos/${encodeURIComponent(viajeColab.id)}/albaranes`);
    if (Array.isArray(preAlbaranes) && preAlbaranes.length === 0) {
      const facturaSinSoporte = await fetch(`${baseUrl}/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/pedidos/${encodeURIComponent(viajeColab.id)}/factura`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-TransGest-QA": "1" },
        body: JSON.stringify({
          numero_factura: `QA-SIN-SOP-${Date.now()}`,
          total: Number(viajeColab.precio_colaborador || 25) || 25,
          archivo_base64: Buffer.from("QA factura sin albaran").toString("base64"),
          archivo_mime: "text/plain",
        }),
      });
      const facturaSinSoporteData = await facturaSinSoporte.json().catch(() => ({}));
      if (facturaSinSoporte.status !== 409 || facturaSinSoporteData?.requiere_albaran !== true) {
        throw new Error(`portal proveedor bloquea factura sin albaran: esperado 409, recibido ${facturaSinSoporte.status}`);
      }
      console.log("OK portal proveedor bloquea factura sin albaran");
    } else {
      console.log("OK portal proveedor factura con soporte previo existente");
    }
    const uploadRes = await fetch(`${baseUrl}/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/pedidos/${encodeURIComponent(viajeColab.id)}/albaranes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-TransGest-QA": "1" },
      body: JSON.stringify({
        nombre: `qa-portal-proveedor-${Date.now()}.txt`,
        tipo: "albaran_colaborador",
        file_base64: Buffer.from("QA portal proveedor albaran").toString("base64"),
        file_mime: "text/plain",
        file_size_kb: 1,
        notas: "QA portal proveedor",
      }),
    });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !uploadData?.id || !uploadData?.download_url) {
      throw new Error(`portal proveedor subida albaran: ${uploadRes.status} ${JSON.stringify(uploadData).slice(0, 160)}`);
    }
    portalDocId = uploadData.id;
    const listed = await request("portal proveedor albaranes viaje", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/pedidos/${encodeURIComponent(viajeColab.id)}/albaranes`);
    if (!Array.isArray(listed) || !listed.find(d => d.id === portalDocId)) {
      throw new Error("portal proveedor albaranes viaje: no refleja albaran subido");
    }
    const downloadProveedor = await fetchRaw("portal proveedor descarga albaran", `${baseUrl}${uploadData.download_url}`);
    if (!downloadProveedor.res.headers.get("content-disposition")?.toLowerCase().includes("attachment")) {
      throw new Error("portal proveedor descarga albaran: falta attachment");
    }
    const facturaRes = await fetch(`${baseUrl}/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/pedidos/${encodeURIComponent(viajeColab.id)}/factura`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-TransGest-QA": "1" },
      body: JSON.stringify({
        numero_factura: `QA-PROV-${Date.now()}`,
        total: Number(viajeColab.precio_colaborador || 25) || 25,
        archivo_base64: Buffer.from("QA portal proveedor factura").toString("base64"),
        archivo_mime: "text/plain",
        notas: "QA portal proveedor factura",
      }),
    });
    const facturaData = await facturaRes.json().catch(() => ({}));
    if (!facturaRes.ok || !facturaData?.id || !facturaData?.download_url) {
      throw new Error(`portal proveedor subida factura: ${facturaRes.status} ${JSON.stringify(facturaData).slice(0, 160)}`);
    }
    portalFacturaId = facturaData.id;
    const facturasPublicas = await request("portal proveedor facturas publicas", `/api/v1/colaboradores/public/portal/${encodeURIComponent(portalToken)}/facturas`);
    const facturaPublica = Array.isArray(facturasPublicas) ? facturasPublicas.find(f => f.id === portalFacturaId) : null;
    if (!facturaPublica?.situacion || !facturaPublica?.download_url) {
      throw new Error("portal proveedor facturas publicas: falta situacion o download_url");
    }
    const downloadFactura = await fetchRaw("portal proveedor descarga factura", `${baseUrl}${facturaData.download_url}`);
    if (!downloadFactura.res.headers.get("content-disposition")?.toLowerCase().includes("attachment")) {
      throw new Error("portal proveedor descarga factura: falta attachment");
    }
    const eventosFactura = await request("portal proveedor traza descarga factura", `/api/v1/pedidos/${encodeURIComponent(viajeColab.id)}/eventos`, { headers: auth });
    if (!Array.isArray(eventosFactura) || !eventosFactura.some(ev => ev?.tipo === "colaborador_portal.factura_descargada")) {
      throw new Error("portal proveedor traza descarga factura: no registra evento");
    }
  } else {
    console.log("OK portal proveedor sin viajes libres para validar subida factura/albaran");
  }
  await fetchRaw("portal colaborador acuse revision", `${token.url.replace(/\/$/, "")}/ack`, { method: "POST" });
  const downloadUrl = `${token.url.replace(/\/$/, "")}/descargar`;
  const download = await fetchRaw("portal colaborador descarga trazada", downloadUrl);
  const disposition = download.res.headers.get("content-disposition") || "";
  if (!disposition.toLowerCase().includes("attachment")) {
    throw new Error("portal colaborador descarga trazada: falta Content-Disposition attachment");
  }
  const tokens = await request("bandeja enlaces liquidacion colaborador", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/liquidacion-tokens`, { headers: auth });
  const refreshed = Array.isArray(tokens) ? tokens.find(t => t.id === token.id) : null;
  if (!refreshed?.downloaded_at || Number(refreshed.download_count || 0) < 1 || !refreshed?.acknowledged_at) {
    throw new Error("bandeja enlaces liquidacion colaborador: no refleja descarga/acuse");
  }
  await request("revocar enlace liquidacion colaborador", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/liquidacion-tokens/${encodeURIComponent(token.id)}`, {
    method: "DELETE",
    headers: auth,
  });
  if (portalDocId) {
    await request("portal proveedor limpiar albaran QA", `/api/v1/empresa/pedido-docs/${encodeURIComponent(portalDocId)}`, {
      method: "DELETE",
      headers: auth,
    }).catch(e => console.warn(`WARN portal proveedor limpiar albaran QA: ${e.message}`));
  }
  if (portalFacturaId) {
    await request("portal proveedor limpiar factura QA", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/facturas/${encodeURIComponent(portalFacturaId)}`, {
      method: "DELETE",
      headers: auth,
    }).catch(e => console.warn(`WARN portal proveedor limpiar factura QA: ${e.message}`));
  }
  if (portalPagoId) {
    await request("portal proveedor limpiar pago QA", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/pagos/${encodeURIComponent(portalPagoId)}`, {
      method: "DELETE",
      headers: auth,
    }).catch(e => console.warn(`WARN portal proveedor limpiar pago QA: ${e.message}`));
  }
  if (portalDocumentoId) {
    await request("portal proveedor limpiar documento QA", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/documentos/${encodeURIComponent(portalDocumentoId)}`, {
      method: "DELETE",
      headers: auth,
    }).catch(e => console.warn(`WARN portal proveedor limpiar documento QA: ${e.message}`));
  }
  if (portalDocumentoPublicoId) {
    await request("portal proveedor limpiar documento publico QA", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/documentos/${encodeURIComponent(portalDocumentoPublicoId)}`, {
      method: "DELETE",
      headers: auth,
    }).catch(e => console.warn(`WARN portal proveedor limpiar documento publico QA: ${e.message}`));
  }
  if (portalVehiculoId) {
    await request("portal proveedor limpiar vehiculo QA", `/api/v1/colaboradores/${encodeURIComponent(colab.id)}/vehiculos/${encodeURIComponent(portalVehiculoId)}`, {
      method: "DELETE",
      headers: auth,
    }).catch(e => console.warn(`WARN portal proveedor limpiar vehiculo QA: ${e.message}`));
  }
}

async function checkAlmacenPalets(auth) {
  await request("palets movimientos almacen filtrados", "/api/v1/palets/movimientos-almacen?origen=propia", { headers: auth });
  await expectStatus("palets bloquea devolucion sin cliente", "/api/v1/palets/movimientos", 400, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      tipo: "devolucion",
      cantidad: 1,
      precio_unitario: 1,
      num_albaran: `QA-SIN-CLI-${Date.now()}`,
      pedido_ref: "QA-BLOQUE8-SIN-CLIENTE",
      notas: "QA bloqueo cliente obligatorio",
    }),
  });

  const clientes = asArray(await request("clientes para palets", "/api/v1/clientes?activo=true&limit=5", { headers: auth }));
  const cliente = clientes.find(c => c?.id);
  if (!cliente) {
    console.log("OK palets sin clientes para validar devolucion completa");
    return;
  }

  await expectStatus("palets bloquea devolucion sin albaran", "/api/v1/palets/movimientos", 400, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      tipo: "devolucion",
      propietario_cliente_id: cliente.id,
      cantidad: 1,
      precio_unitario: 1,
      pedido_ref: "QA-BLOQUE8-SIN-ALBARAN",
      notas: "QA bloqueo albaran obligatorio",
    }),
  });

  const entradasSeparadasIds = [];
  try {
    const stamp = Date.now();
    const entradaA = await request("palets entrada cliente separada dia 1", "/api/v1/palets/movimientos", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        tipo: "entrega",
        propietario_cliente_id: cliente.id,
        cantidad: 20,
        precio_unitario: 0,
        fecha: "2026-05-01",
        pedido_ref: `QA-DEV-CLIENTE-${stamp}-A`,
        notas: "QA registro separado cliente dia 1",
      }),
    });
    if (entradaA?.id) entradasSeparadasIds.push(entradaA.id);

    const entradaB = await request("palets entrada cliente separada dia 4", "/api/v1/palets/movimientos", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        tipo: "entrega",
        propietario_cliente_id: cliente.id,
        cantidad: 60,
        precio_unitario: 0,
        fecha: "2026-05-04",
        pedido_ref: `QA-DEV-CLIENTE-${stamp}-B`,
        notas: "QA registro separado cliente dia 4",
      }),
    });
    if (entradaB?.id) entradasSeparadasIds.push(entradaB.id);

    const registrosCliente = await request(
      "palets dev cliente mantiene registros separados",
      `/api/v1/palets/movimientos?propietario_cliente_id=${encodeURIComponent(cliente.id)}&desde=2026-05-01&hasta=2026-05-04`,
      { headers: auth }
    );
    const qaRegistros = asArray(registrosCliente).filter(m => String(m.pedido_ref || "").startsWith(`QA-DEV-CLIENTE-${stamp}-`));
    if (qaRegistros.length !== 2) {
      throw new Error(`palets dev cliente mantiene registros separados: esperado 2, recibido ${qaRegistros.length}`);
    }
    const cantidades = qaRegistros.map(m => Number(m.cantidad || 0)).sort((a,b) => a-b).join(",");
    const fechas = qaRegistros.map(m => String(m.fecha || "").slice(0,10)).sort().join(",");
    if (cantidades !== "20,60" || fechas !== "2026-05-01,2026-05-04") {
      throw new Error(`palets dev cliente mantiene registros separados: cantidades=${cantidades} fechas=${fechas}`);
    }
  } finally {
    for (const id of entradasSeparadasIds) {
      await request("palets dev cliente QA limpiar entrada", `/api/v1/palets/movimientos/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: auth,
      }).catch(err => console.warn(`WARN palets dev cliente QA limpiar entrada: ${err.message}`));
    }
  }

  let devolucionId = null;
  let facturaDevolucionId = null;
  let facturaOtroClienteId = null;
  try {
    const crearFacturaPaletsQa = (targetCliente, ref) => request(ref, "/api/v1/facturas", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        cliente_id: targetCliente.id,
        serie: "A",
        fecha: "2026-05-04",
        estado: "borrador",
        lineas: [{
          concepto: `QA devolucion palets ${ref}`,
          cantidad: 1,
          precio_unit: 1,
        }],
        observaciones: "QA factura borrador vinculacion palets",
      }),
    });
    const getResumenStockCliente = async (label) => {
      const resumen = await request(label, "/api/v1/palets/resumen", { headers: auth });
      return asArray(resumen)
        .filter(r => String(r.propietario_cliente_id || "") === String(cliente.id))
        .reduce((sum, r) => sum + Number(r.stock || 0), 0);
    };
    const stockAntesDevolucion = await getResumenStockCliente("palets resumen antes devolucion pendiente");
    const devolucion = await request("palets devolucion pendiente crear", "/api/v1/palets/movimientos", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        tipo: "devolucion",
        propietario_cliente_id: cliente.id,
        cantidad: 2,
        precio_unitario: 1.5,
        num_albaran: `QA-${Date.now()}`,
        pedido_ref: "QA-BLOQUE8",
        notas: "QA devolucion editable hasta confirmacion",
      }),
    });
    devolucionId = devolucion?.id || null;
    if (!devolucionId || devolucion.estado_salida !== "pendiente") {
      throw new Error("palets devolucion pendiente crear: no queda pendiente");
    }

    const editada = await request("palets devolucion pendiente editar", `/api/v1/palets/movimientos/${encodeURIComponent(devolucionId)}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        tipo: "devolucion",
        propietario_cliente_id: cliente.id,
        cantidad: 3,
        precio_unitario: 2,
        num_albaran: devolucion.num_albaran,
        pedido_ref: "QA-BLOQUE8-EDIT",
        notas: "QA devolucion editada antes de confirmar",
      }),
    });
    if (Number(editada.cantidad || 0) !== 3 || editada.estado_salida !== "pendiente") {
      throw new Error("palets devolucion pendiente editar: no actualiza cantidad o estado");
    }
    const stockConPendiente = await getResumenStockCliente("palets resumen ignora devolucion pendiente");
    if (stockConPendiente !== stockAntesDevolucion) {
      throw new Error(`palets resumen ignora devolucion pendiente: stock antes=${stockAntesDevolucion}, pendiente=${stockConPendiente}`);
    }

    const otroCliente = clientes.find(c => c?.id && String(c.id) !== String(cliente.id));
    if (otroCliente) {
      const facturaOtroCliente = await crearFacturaPaletsQa(otroCliente, "palets factura otro cliente crear QA");
      facturaOtroClienteId = facturaOtroCliente?.id || null;
      await expectStatus("palets bloquea factura de otro cliente", `/api/v1/palets/movimientos/${encodeURIComponent(devolucionId)}/confirmar-salida`, 400, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify({ factura_id: facturaOtroClienteId }),
      });
    }

    const facturaDevolucion = await crearFacturaPaletsQa(cliente, "palets factura devolucion crear QA");
    facturaDevolucionId = facturaDevolucion?.id || null;
    const confirmada = await request("palets devolucion confirmar salida", `/api/v1/palets/movimientos/${encodeURIComponent(devolucionId)}/confirmar-salida`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ factura_id: facturaDevolucionId }),
    });
    if (confirmada.estado_salida !== "confirmada" || !confirmada.salida_confirmada_at || String(confirmada.factura_id || "") !== String(facturaDevolucionId || "")) {
      throw new Error("palets devolucion confirmar salida: no marca confirmacion real");
    }
    const stockConConfirmada = await getResumenStockCliente("palets resumen descuenta devolucion confirmada");
    if (stockConConfirmada !== stockAntesDevolucion - 3) {
      throw new Error(`palets resumen descuenta devolucion confirmada: esperado=${stockAntesDevolucion - 3}, recibido=${stockConConfirmada}`);
    }

    await expectStatus("palets bloquea editar devolucion confirmada", `/api/v1/palets/movimientos/${encodeURIComponent(devolucionId)}`, 409, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        tipo: "devolucion",
        cantidad: 4,
        precio_unitario: 2,
        pedido_ref: "QA-BLOQUE8-BLOCK",
      }),
    });

    const facturaBorrada = await request("palets factura borrar desvincula movimiento", `/api/v1/facturas/${encodeURIComponent(facturaDevolucionId)}`, {
      method: "DELETE",
      headers: auth,
    });
    facturaDevolucionId = null;
    if (!asArray(facturaBorrada.palets_movimiento_ids_afectados).map(String).includes(String(devolucionId))) {
      throw new Error("palets factura borrar desvincula movimiento: no devuelve el movimiento afectado");
    }
    const movimientosTrasBorrarFactura = await request(
      "palets movimiento queda sin factura borrada",
      `/api/v1/palets/movimientos?propietario_cliente_id=${encodeURIComponent(cliente.id)}`,
      { headers: auth }
    );
    const movimientoTrasBorrarFactura = asArray(movimientosTrasBorrarFactura).find(m => String(m.id) === String(devolucionId));
    if (!movimientoTrasBorrarFactura || movimientoTrasBorrarFactura.factura_id) {
      throw new Error("palets movimiento queda sin factura borrada: sigue vinculado a factura inexistente");
    }
  } finally {
    if (devolucionId) {
      await request("palets devolucion QA limpiar", `/api/v1/palets/movimientos/${encodeURIComponent(devolucionId)}`, {
        method: "DELETE",
        headers: auth,
      }).catch(err => console.warn(`WARN palets devolucion QA limpiar: ${err.message}`));
    }
    for (const id of [facturaDevolucionId, facturaOtroClienteId].filter(Boolean)) {
      await request("palets factura QA limpiar", `/api/v1/facturas/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: auth,
      }).catch(err => console.warn(`WARN palets factura QA limpiar: ${err.message}`));
    }
  }

  const mercancias = await request("palets mercancias propias", "/api/v1/palets/mercancias?origen=propia", { headers: auth });
  const mercancia = Array.isArray(mercancias) ? mercancias.find(m => m?.id) : null;
  if (!mercancia) {
    console.log("OK palets sin mercancia propia para prueba de stock");
    return;
  }
  await expectStatus("palets bloquea salida sin stock", "/api/v1/palets/movimientos-almacen", 409, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      almacen_id: mercancia.almacen_id || null,
      mercancia_id: mercancia.id,
      tipo: "salida",
      cantidad: Number(mercancia.stock_actual || 0) + 999999,
      unidad: mercancia.unidad || "ud",
      precio_unitario: 0,
    }),
  });
}

async function checkPortalSolicitudesAdmin(auth) {
  const solicitudes = await request("solicitudes portal admin trazabilidad", "/api/v1/portal-cliente/admin/solicitudes", { headers: auth });
  if (!Array.isArray(solicitudes)) {
    throw new Error("solicitudes portal admin trazabilidad: la respuesta no es un array");
  }
  const sol = solicitudes.find(s => s?.id);
  if (!sol) {
    console.log("OK solicitudes portal admin sin datos para validar trazabilidad");
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(sol, "eventos_count")) {
    throw new Error("solicitudes portal admin trazabilidad: falta eventos_count");
  }
  if (!Object.prototype.hasOwnProperty.call(sol, "ultimo_evento_at")) {
    throw new Error("solicitudes portal admin trazabilidad: falta ultimo_evento_at");
  }
}

async function checkPortalClienteOperativo(gerenteAuth) {
  let login = null;
  let clienteIdPortal = null;
  async function prepararLoginPortalClienteActivo(motivo = "preparar") {
    const clientesResp = await request(`portal cliente ${motivo} clientes activos`, "/api/v1/clientes?q=&activo=true&page=1&limit=100", { headers: gerenteAuth });
    const clientesActivos = (Array.isArray(clientesResp?.data) ? clientesResp.data : Array.isArray(clientesResp) ? clientesResp : [])
      .filter(c => c?.id && c.activo !== false);
    let clienteActivo = clienteIdPortal ? clientesActivos.find(c => c.id === clienteIdPortal) : null;
    if (!clienteActivo) {
      const pedidosGerente = await request(`portal cliente ${motivo} pedido gerente`, "/api/v1/pedidos?limit=200", { headers: gerenteAuth });
      const pedidos = Array.isArray(pedidosGerente?.data) ? pedidosGerente.data : Array.isArray(pedidosGerente) ? pedidosGerente : [];
      clienteActivo = pedidos
        .map(p => clientesActivos.find(c => c.id === p?.cliente_id))
        .find(Boolean) || clientesActivos[0] || null;
    }
    if (!clienteActivo?.id) return null;
    const portalUser = await request(`portal cliente ${motivo} usuario`, `/api/v1/clientes/${encodeURIComponent(clienteActivo.id)}/portal-user`, {
      method: "POST",
      headers: gerenteAuth,
      body: JSON.stringify({ reset_password: true }),
    });
    const identifier = portalUser?.usuario?.email || portalUser?.usuario?.username;
    const tempPassword = portalUser?.password_temporal;
    if (!identifier || !tempPassword) return null;
    const portalLogin = await request(`login cliente portal ${motivo}`, "/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: identifier, password: tempPassword }),
    });
    return { login: portalLogin, cliente_id: clienteActivo.id };
  }
  try {
    login = await request("login cliente portal", "/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: clienteUser, password: clientePassword }),
    });
    clienteIdPortal = login?.user?.cliente_id || null;
  } catch (e) {
    const preparado = await prepararLoginPortalClienteActivo("preparar");
    if (!preparado?.login?.token || !preparado?.cliente_id) {
      console.log("OK portal cliente sin pedido con cliente para validacion autenticada");
      return;
    }
    login = preparado.login;
    clienteIdPortal = preparado.cliente_id;
  }
  const clientesActivosCheck = await request("portal cliente validar cliente activo", "/api/v1/clientes?q=&activo=true&page=1&limit=100", { headers: gerenteAuth });
  const clientePortalActivo = (Array.isArray(clientesActivosCheck?.data) ? clientesActivosCheck.data : Array.isArray(clientesActivosCheck) ? clientesActivosCheck : [])
    .some(c => c?.id === clienteIdPortal && c.activo !== false);
  if (!clientePortalActivo) {
    const preparado = await prepararLoginPortalClienteActivo("reparar inactivo");
    if (!preparado?.login?.token || !preparado?.cliente_id) {
      console.log("OK portal cliente sin cliente activo para validacion autenticada");
      return;
    }
    login = preparado.login;
    clienteIdPortal = preparado.cliente_id;
  }
  if (!login?.token) throw new Error("login cliente portal: no devuelve token");
  if (!clienteIdPortal) throw new Error("login cliente portal: falta cliente_id");
  const auth = { Authorization: `Bearer ${login.token}` };
  const manifestOnlyToken = await request("portal cliente token tecnico scope manifest crear", `/api/v1/clientes/${encodeURIComponent(clienteIdPortal)}/integracion-token`, {
    method: "POST",
    headers: gerenteAuth,
    body: JSON.stringify({ nombre: `QA EDI manifest ${Date.now()}`, dias: 1, scopes: ["manifest"] }),
  });
  if (!manifestOnlyToken?.token || !Array.isArray(manifestOnlyToken?.credencial?.scopes) || !manifestOnlyToken.credencial.scopes.includes("manifest")) {
    throw new Error("portal cliente token tecnico scope manifest crear: respuesta incompleta");
  }
  const manifestOnlyAuth = { Authorization: `Bearer ${manifestOnlyToken.token}` };
  const manifestSoloScope = await request("portal cliente manifest token scope manifest", "/api/v1/portal-cliente/integracion/manifest", { headers: manifestOnlyAuth });
  if (manifestSoloScope.schema !== "transgest.portal_cliente.manifest.v1") {
    throw new Error("portal cliente manifest token scope manifest: schema invalido");
  }
  await expectStatus("portal cliente feed bloquea scope manifest", "/api/v1/portal-cliente/integracion/feed?days=30", 403, { headers: manifestOnlyAuth });
  await request("portal cliente token tecnico scope manifest revocar", `/api/v1/clientes/${encodeURIComponent(clienteIdPortal)}/integracion-tokens/${encodeURIComponent(manifestOnlyToken.credencial.id)}`, {
    method: "DELETE",
    headers: gerenteAuth,
  });
  const techToken = await request("portal cliente token tecnico crear", `/api/v1/clientes/${encodeURIComponent(clienteIdPortal)}/integracion-token`, {
    method: "POST",
    headers: gerenteAuth,
    body: JSON.stringify({ nombre: `QA EDI ${Date.now()}`, dias: 1, scopes: ["manifest", "feed"] }),
  });
  if (!techToken?.token?.startsWith("tedi_") || !techToken?.credencial?.id || !techToken?.credencial?.token_mask) {
    throw new Error("portal cliente token tecnico crear: respuesta incompleta");
  }
  const techAuth = { Authorization: `Bearer ${techToken.token}` };
  await expectStatus("portal cliente token tecnico bloquea resumen", "/api/v1/portal-cliente/resumen", 403, { headers: techAuth });
  await expectStatus("portal cliente token tecnico bloquea pedidos", "/api/v1/portal-cliente/pedidos", 403, { headers: techAuth });
  await expectStatus("portal cliente token tecnico bloquea facturas", "/api/v1/portal-cliente/facturas", 403, { headers: techAuth });

  const resumen = await request("portal cliente resumen ejecutivo", "/api/v1/portal-cliente/resumen", { headers: auth });
  for (const key of ["pedidos", "facturas", "documentos", "solicitudes"]) {
    if (!resumen?.[key] || typeof resumen[key] !== "object") {
      throw new Error(`portal cliente resumen ejecutivo: falta ${key}`);
    }
  }
  if (!Array.isArray(resumen.acciones)) {
    throw new Error("portal cliente resumen ejecutivo: acciones no es array");
  }
  const pedidos = await request("portal cliente pedidos", "/api/v1/portal-cliente/pedidos", { headers: auth });
  const facturasPortal = await request("portal cliente facturas", "/api/v1/portal-cliente/facturas", { headers: auth });
  await request("portal cliente documentos resumen", "/api/v1/portal-cliente/documentos-resumen", { headers: auth });
  await request("portal cliente solicitudes", "/api/v1/portal-cliente/solicitudes", { headers: auth });
  const manifest = await request("portal cliente manifest integracion", "/api/v1/portal-cliente/integracion/manifest", { headers: auth });
  const manifestTecnico = await request("portal cliente manifest token tecnico", "/api/v1/portal-cliente/integracion/manifest", { headers: techAuth });
  if (manifestTecnico.schema !== "transgest.portal_cliente.manifest.v1") {
    throw new Error("portal cliente manifest token tecnico: schema invalido");
  }
  const manifestTecnicoRaw = await fetchRaw("portal cliente manifest token tecnico rate headers", "/api/v1/portal-cliente/integracion/manifest", { headers: techAuth });
  const rateLimit = Number(manifestTecnicoRaw.res.headers.get("x-ratelimit-limit") || 0);
  const rateRemaining = Number(manifestTecnicoRaw.res.headers.get("x-ratelimit-remaining") || -1);
  const rateReset = manifestTecnicoRaw.res.headers.get("x-ratelimit-reset") || "";
  if (rateLimit < 30 || rateRemaining < 0 || Number.isNaN(Date.parse(rateReset))) {
    throw new Error("portal cliente manifest token tecnico rate headers: cabeceras invalidas");
  }
  if (!Array.isArray(manifestTecnico.api?.rate_limit_headers) || !manifestTecnico.api.rate_limit_headers.includes("X-RateLimit-Remaining")) {
    throw new Error("portal cliente manifest token tecnico: no documenta cabeceras rate limit");
  }
  for (const key of ["schema", "generated_at", "cliente", "api", "endpoints", "contract", "governance", "examples", "integrity_hash_sha256"]) {
    if (!Object.prototype.hasOwnProperty.call(manifest || {}, key)) {
      throw new Error(`portal cliente manifest integracion: falta ${key}`);
    }
  }
  if (manifest.schema !== "transgest.portal_cliente.manifest.v1" || manifest.endpoints?.feed?.method !== "GET") {
    throw new Error("portal cliente manifest integracion: contrato invalido");
  }
  if (manifest.endpoints?.feed?.sync?.supports_delta !== true || !manifest.contract?.top_level_fields?.includes("sync")) {
    throw new Error("portal cliente manifest integracion: falta soporte delta");
  }
  if (manifest.governance?.includes_binary_content !== false || manifest.governance?.includes_secrets !== false) {
    throw new Error("portal cliente manifest integracion: governance invalido");
  }
  if (typeof manifest.integrity_hash_sha256 !== "string" || manifest.integrity_hash_sha256.length !== 64) {
    throw new Error("portal cliente manifest integracion: hash invalido");
  }
  const manifestText = JSON.stringify(manifest).toLowerCase();
  if (manifestText.includes("file_base64") || manifestText.includes("encrypted_key") || manifestText.includes("token_hash") || manifestText.includes("smtp_pass")) {
    throw new Error("portal cliente manifest integracion: expone contenido o secretos");
  }
  const feed = await request("portal cliente feed integracion", "/api/v1/portal-cliente/integracion/feed?days=120", { headers: auth });
  const feedTecnico = await request("portal cliente feed token tecnico", "/api/v1/portal-cliente/integracion/feed?days=30", { headers: techAuth });
  if (feedTecnico.schema !== "transgest.portal_cliente.feed.v1" || feedTecnico.governance?.data_scope !== "cliente_autenticado") {
    throw new Error("portal cliente feed token tecnico: contrato invalido");
  }
  const feedTecnicoRaw = await fetchRaw("portal cliente feed token tecnico rate headers", "/api/v1/portal-cliente/integracion/feed?days=30", { headers: techAuth });
  if (Number(feedTecnicoRaw.res.headers.get("x-ratelimit-limit") || 0) < 30 || Number(feedTecnicoRaw.res.headers.get("x-ratelimit-remaining") || -1) < 0) {
    throw new Error("portal cliente feed token tecnico rate headers: cabeceras invalidas");
  }
  const techTokensListado = await request("portal cliente token tecnico listado", `/api/v1/clientes/${encodeURIComponent(clienteIdPortal)}/integracion-tokens`, { headers: gerenteAuth });
  const techTokenListado = Array.isArray(techTokensListado) ? techTokensListado.find(t => t.id === techToken.credencial.id && t.activo === true) : null;
  if (!techTokenListado) {
    throw new Error("portal cliente token tecnico listado: no refleja token activo");
  }
  for (const key of ["usage_count", "window_count", "rate_limit_per_hour"]) {
    if (!Object.prototype.hasOwnProperty.call(techTokenListado, key)) {
      throw new Error(`portal cliente token tecnico listado: falta ${key}`);
    }
  }
  if (Number(techTokenListado.usage_count || 0) < 5 || Number(techTokenListado.window_count || 0) < 5 || Number(techTokenListado.rate_limit_per_hour || 0) < 30) {
    throw new Error("portal cliente token tecnico listado: contadores de uso invalidos");
  }
  for (const key of ["schema", "export_id", "generated_at", "window_days", "sync", "cliente", "counts", "governance", "shipments", "invoices", "integrity_hash_sha256"]) {
    if (!Object.prototype.hasOwnProperty.call(feed || {}, key)) {
      throw new Error(`portal cliente feed integracion: falta ${key}`);
    }
  }
  if (feed.schema !== "transgest.portal_cliente.feed.v1" || !Array.isArray(feed.shipments) || !Array.isArray(feed.invoices)) {
    throw new Error("portal cliente feed integracion: estructura invalida");
  }
  if (typeof feed.integrity_hash_sha256 !== "string" || feed.integrity_hash_sha256.length !== 64) {
    throw new Error("portal cliente feed integracion: hash invalido");
  }
  if (feed.sync?.mode !== "window" || feed.sync?.supports_delta !== true || !feed.sync?.next_cursor) {
    throw new Error("portal cliente feed integracion: sync window invalido");
  }
  if (feed.governance?.includes_binary_content !== false || feed.governance?.data_scope !== "cliente_autenticado") {
    throw new Error("portal cliente feed integracion: governance invalido");
  }
  const feedDelta = await request("portal cliente feed integracion delta", `/api/v1/portal-cliente/integracion/feed?days=365&since=${encodeURIComponent("1970-01-01T00:00:00.000Z")}`, { headers: auth });
  if (feedDelta.sync?.mode !== "delta" || feedDelta.sync?.since !== "1970-01-01T00:00:00.000Z" || !feedDelta.sync?.next_cursor) {
    throw new Error("portal cliente feed integracion delta: sync invalido");
  }
  if (!Array.isArray(feedDelta.shipments) || !Array.isArray(feedDelta.invoices) || typeof feedDelta.integrity_hash_sha256 !== "string") {
    throw new Error("portal cliente feed integracion delta: estructura invalida");
  }
  const feedText = JSON.stringify(feed).toLowerCase();
  if (feedText.includes("file_base64") || feedText.includes("encrypted_key") || feedText.includes("token_hash") || feedText.includes("smtp_pass")) {
    throw new Error("portal cliente feed integracion: expone contenido o secretos");
  }
  if (feed.shipments[0]) {
    for (const key of ["id", "numero", "estado", "origen", "destino", "fechas", "mercancia", "tracking", "documentos"]) {
      if (!Object.prototype.hasOwnProperty.call(feed.shipments[0], key)) {
        throw new Error(`portal cliente feed integracion: falta shipment.${key}`);
      }
    }
  }
  const actividadFeed = await request("portal cliente feed auditoria", "/api/v1/actividad?accion=portal_cliente.integracion_feed&limit=5", { headers: gerenteAuth });
  if (!Array.isArray(actividadFeed?.data) || !actividadFeed.data.some(row => row?.detalle?.export_id === feed.export_id && row?.accion === "EXPORT portal_cliente.integracion_feed")) {
    throw new Error("portal cliente feed auditoria: no registra exportacion especifica");
  }
  await request("portal cliente token tecnico revocar", `/api/v1/clientes/${encodeURIComponent(clienteIdPortal)}/integracion-tokens/${encodeURIComponent(techToken.credencial.id)}`, {
    method: "DELETE",
    headers: gerenteAuth,
  });
  await expectStatus("portal cliente token tecnico revocado bloqueado", "/api/v1/portal-cliente/integracion/manifest", 401, { headers: techAuth });

  const pedido = Array.isArray(pedidos) ? pedidos.find(p => p?.id) : null;
  if (!pedido) {
    console.log("OK portal cliente sin pedidos para validar actividad");
    return;
  }
  let clienteDocId = null;
  try {
    const createdDoc = await request("portal cliente preparar albaran descargable", `/api/v1/empresa/pedido-docs/${encodeURIComponent(pedido.id)}`, {
      method: "POST",
      headers: gerenteAuth,
      body: JSON.stringify({
        nombre: `qa-portal-cliente-cmr-${Date.now()}.txt`,
        tipo: "cmr_cliente",
        file_base64: Buffer.from("QA portal cliente CMR").toString("base64"),
        file_mime: "text/plain",
        file_size_kb: 1,
        notas: "QA portal cliente soporte documental",
      }),
    });
    clienteDocId = createdDoc?.id || null;
    const albaranes = await request("portal cliente albaranes descargables", `/api/v1/portal-cliente/pedidos/${encodeURIComponent(pedido.id)}/albaranes`, { headers: auth });
    const albaran = Array.isArray(albaranes) ? albaranes.find(d => d.id === clienteDocId && d.download_url) : null;
    if (!albaran) throw new Error("portal cliente albaranes descargables: no devuelve download_url del soporte CMR");
    const download = await fetchRaw("portal cliente descarga directa albaran", `${baseUrl}${albaran.download_url}`, { headers: auth });
    if (!download.res.headers.get("content-disposition")?.toLowerCase().includes("attachment")) {
      throw new Error("portal cliente descarga directa albaran: falta attachment");
    }
    const eventosTrasDescarga = await request("portal cliente traza descarga soporte", `/api/v1/portal-cliente/pedidos/${encodeURIComponent(pedido.id)}/eventos`, { headers: auth });
    if (!Array.isArray(eventosTrasDescarga) || !eventosTrasDescarga.some(ev => ev?.tipo === "portal_cliente.soporte_descargado")) {
      throw new Error("portal cliente traza descarga soporte: no registra evento");
    }
    const facturaParaDetalle = Array.isArray(facturasPortal) ? facturasPortal.find(f => f?.id) : null;
    if (facturaParaDetalle?.id) {
      const detalleFactura = await request("portal cliente factura con albaranes", `/api/v1/portal-cliente/facturas/${encodeURIComponent(facturaParaDetalle.id)}`, { headers: auth });
      if (!Array.isArray(detalleFactura.albaranes)) {
        throw new Error("portal cliente factura con albaranes: falta array albaranes");
      }
    }
  } finally {
    if (clienteDocId) {
      await request("portal cliente limpiar albaran QA", `/api/v1/empresa/pedido-docs/${encodeURIComponent(clienteDocId)}`, {
        method: "DELETE",
        headers: gerenteAuth,
      }).catch(e => console.warn(`WARN portal cliente limpiar albaran QA: ${e.message}`));
    }
  }
  const eventos = await request("portal cliente actividad pedido", `/api/v1/portal-cliente/pedidos/${encodeURIComponent(pedido.id)}/eventos`, { headers: auth });
  if (!Array.isArray(eventos)) {
    throw new Error("portal cliente actividad pedido: la respuesta no es un array");
  }
  const eventoConCampos = eventos.find(ev => Object.prototype.hasOwnProperty.call(ev, "etiqueta") && Object.prototype.hasOwnProperty.call(ev, "resumen"));
  if (eventos.length > 0 && !eventoConCampos) {
    throw new Error("portal cliente actividad pedido: falta etiqueta/resumen saneado");
  }
}

async function checkExcepcionesOperativas(auth) {
  const data = await request("excepciones operativas estructura", "/api/v1/informes/excepciones", { headers: auth });
  if (!data || typeof data !== "object") {
    throw new Error("excepciones operativas estructura: respuesta invalida");
  }
  if (!data.resumen || typeof data.resumen !== "object") {
    throw new Error("excepciones operativas estructura: falta resumen");
  }
  for (const key of ["total", "sla_vencidas", "asignadas_a_mi", "resueltas_7d"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen, key)) {
      throw new Error(`excepciones operativas estructura: falta resumen.${key}`);
    }
  }
  if (!Array.isArray(data.data)) {
    throw new Error("excepciones operativas estructura: data no es array");
  }
  const item = data.data.find(x => x?.id);
  if (!item) {
    console.log("OK excepciones operativas sin incidencias para validar SLA");
    return;
  }
  if (!item.workflow || typeof item.workflow !== "object" || !Object.prototype.hasOwnProperty.call(item.workflow, "activa")) {
    throw new Error("excepciones operativas estructura: falta workflow.activa");
  }
  if (!item.sla || typeof item.sla !== "object") {
    throw new Error("excepciones operativas estructura: falta sla");
  }
  for (const key of ["horas_objetivo", "horas_abierta", "vencida"]) {
    if (!Object.prototype.hasOwnProperty.call(item.sla, key)) {
      throw new Error(`excepciones operativas estructura: falta sla.${key}`);
    }
  }
  const resolved = await request("excepciones operativas marcar resuelta", `/api/v1/informes/excepciones/${encodeURIComponent(item.id)}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ estado: "resuelta", nota: "QA cierre manual de excepcion" }),
  });
  if (resolved?.data?.estado !== "resuelta" || !String(resolved?.data?.nota || "").includes("QA cierre manual")) {
    throw new Error("excepciones operativas marcar resuelta: respuesta incompleta");
  }
  await request("excepciones operativas reabrir QA", `/api/v1/informes/excepciones/${encodeURIComponent(item.id)}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ estado: "abierta", nota: "QA reabre excepcion tras prueba" }),
  });
}

async function checkGestionKpi(auth) {
  const data = await request("gestion KPI estructura", "/api/v1/informes/gestion?period=30d", { headers: auth });
  for (const key of ["facturacion", "pedidos", "flota", "taller", "objetivos", "salud"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`gestion KPI estructura: falta ${key}`);
    }
  }
  if (!Array.isArray(data.salud)) {
    throw new Error("gestion KPI estructura: salud no es array");
  }
  for (const key of ["total", "cobrado", "pendiente", "vencido", "num_facturas"]) {
    if (!Object.prototype.hasOwnProperty.call(data.facturacion, key)) {
      throw new Error(`gestion KPI estructura: falta facturacion.${key}`);
    }
  }
  for (const key of ["total", "importe", "coste", "km_ruta", "km_vacio", "km_totales", "pct_km_vacio"]) {
    if (!Object.prototype.hasOwnProperty.call(data.pedidos, key)) {
      throw new Error(`gestion KPI estructura: falta pedidos.${key}`);
    }
  }
  if (typeof data.objetivos.configurado !== "boolean" || !data.objetivos.desviaciones) {
    throw new Error("gestion KPI estructura: objetivos incompleto");
  }
  for (const key of ["facturacion", "pedidos", "km_totales", "pct_km_vacio", "coste_taller", "margen"]) {
    const item = data.objetivos.desviaciones[key];
    if (!item || !Object.prototype.hasOwnProperty.call(item, "actual") || !Object.prototype.hasOwnProperty.call(item, "ok")) {
      throw new Error(`gestion KPI estructura: falta desviacion ${key}`);
    }
  }
}

async function checkControlTower(auth) {
  const data = await request("control tower estructura", "/api/v1/informes/control-tower?period=7d", { headers: auth });
  for (const key of ["kpis", "resumen", "vistas", "items", "incidencias", "generated_at"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`control tower estructura: falta ${key}`);
    }
  }
  if (!Array.isArray(data.items)) {
    throw new Error("control tower estructura: items no es array");
  }
  if (!Array.isArray(data.incidencias)) {
    throw new Error("control tower estructura: incidencias no es array");
  }
  for (const key of ["activos", "cargas_hoy", "descargas_hoy", "incidencias", "retrasados"]) {
    if (!Object.prototype.hasOwnProperty.call(data.kpis || {}, key)) {
      throw new Error(`control tower estructura: falta kpis.${key}`);
    }
  }
  for (const key of ["total", "critica", "alta", "media", "areas"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen || {}, key)) {
      throw new Error(`control tower estructura: falta resumen.${key}`);
    }
  }
  for (const key of ["todas", "hoy", "riesgos", "rentabilidad", "incidencias"]) {
    if (!Object.prototype.hasOwnProperty.call(data.vistas || {}, key)) {
      throw new Error(`control tower estructura: falta vistas.${key}`);
    }
  }
  const item = data.items.find(x => x?.id);
  if (item) {
    for (const key of ["type", "area", "severity", "title", "description", "action", "view", "buckets", "next_actions"]) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) {
        throw new Error(`control tower estructura: item sin ${key}`);
      }
    }
    if (!Array.isArray(item.buckets)) {
      throw new Error("control tower estructura: buckets no es array");
    }
    if (!Array.isArray(item.next_actions) || !item.next_actions.length || !item.next_actions.every(a => a?.key && a?.label && a?.view)) {
      throw new Error("control tower estructura: next_actions incompletas");
    }
  }
  const pedidos = asArray(await request("control tower pedidos con factura vinculada", "/api/v1/pedidos?limit=1000", { headers: auth }));
  const pedidosConFacturaIds = new Set(
    pedidos
      .filter(p => p?.factura_id)
      .map(p => String(p.id))
      .filter(Boolean)
  );
  const pedidoItemsFacturados = data.items.filter(item =>
    item?.view === "pedidos"
    && pedidosConFacturaIds.has(String(item.entity_id || ""))
    && !["facturacion_inconsistente"].includes(String(item.type || ""))
  );
  if (pedidoItemsFacturados.length) {
    throw new Error(`control tower no debe mostrar pedidos con factura vinculada: ${pedidoItemsFacturados.map(i => i.title || i.entity_id).join(", ")}`);
  }
  const incidenciaItemsFacturados = data.incidencias.filter(item =>
    item?.view === "pedidos"
    && pedidosConFacturaIds.has(String(item.entity_id || ""))
  );
  if (incidenciaItemsFacturados.length) {
    throw new Error(`control tower no debe listar incidencias facturadas: ${incidenciaItemsFacturados.map(i => i.title || i.entity_id).join(", ")}`);
  }
}

async function checkCopilotoOperativo(auth) {
  const data = await request("copiloto operativo estructura", "/api/v1/informes/copiloto-operativo?period=7d", { headers: auth });
  for (const key of ["resumen", "prioridades", "preguntas_sugeridas", "generated_at"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`copiloto operativo estructura: falta ${key}`);
    }
  }
  if (!Array.isArray(data.prioridades) || !Array.isArray(data.preguntas_sugeridas)) {
    throw new Error("copiloto operativo estructura: prioridades/preguntas no son array");
  }
  for (const key of ["salud", "headline", "total_prioridades", "criticas", "altas", "activos", "cargas_hoy", "descargas_hoy"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen || {}, key)) {
      throw new Error(`copiloto operativo estructura: falta resumen.${key}`);
    }
  }
  if (!["critica", "alerta", "vigilancia", "ok"].includes(String(data.resumen?.salud || ""))) {
    throw new Error("copiloto operativo estructura: salud invalida");
  }
  const item = data.prioridades.find(x => x?.key);
  if (item) {
    for (const key of ["key", "area", "severity", "title", "answer", "recommended_action", "target_view", "requires_confirmation", "playbook", "quick_actions"]) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) {
        throw new Error(`copiloto operativo estructura: prioridad sin ${key}`);
      }
    }
    if (!Array.isArray(item.playbook) || !Array.isArray(item.quick_actions)) {
      throw new Error("copiloto operativo estructura: playbook/quick_actions no son array");
    }
    const action = item.quick_actions.find(x => x?.key);
    if (action && (!action.label || !action.view)) {
      throw new Error("copiloto operativo estructura: quick_action incompleta");
    }
  }
}

async function checkCalendarioLaboral(auth) {
  const year = new Date().getFullYear();
  const data = await request("calendario laboral estructura", `/api/v1/empresa/calendario-laboral?year=${year}&ccaa=ES-MD`, { headers: auth });
  for (const key of ["year", "ccaa", "ccaa_label", "fuente", "updated_at", "holidays"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`calendario laboral estructura: falta ${key}`);
    }
  }
  if (!Array.isArray(data.holidays)) {
    throw new Error("calendario laboral estructura: holidays no es array");
  }
  if (String(data.ccaa) !== "ES-MD") {
    throw new Error("calendario laboral estructura: comunidad inesperada");
  }
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function checkRutasTarifasMinimos(auth) {
  const clientes = asArray(await request("clientes para rutas tarifas", "/api/v1/clientes?activo=true&limit=5", { headers: auth }));
  const cliente = clientes.find(c => c?.id);
  if (!cliente) {
    console.log("OK rutas tarifas sin clientes para validar minimos");
    return;
  }

  const stamp = Date.now();
  let rutaId = null;
  let rutaSaludId = null;
  try {
    const creada = await request("ruta toneladas normaliza minimo crear", `/api/v1/clientes/${encodeURIComponent(cliente.id)}/rutas`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        origen: `QA MIN ${stamp}`,
        destino: `QA DEST ${stamp}`,
        km: 12,
        precio_base: 28.64,
        tarifa_tipo: "tonelada",
        minimo_facturable: 24000,
        tipo_vehiculo: "cualquiera",
      }),
    });
    rutaId = creada?.ruta_id || null;
    if (!rutaId) throw new Error("ruta toneladas normaliza minimo crear: no devuelve ruta_id");

    const rutas = asArray(await request("rutas cliente minimos normalizados", `/api/v1/clientes/${encodeURIComponent(cliente.id)}/rutas`, { headers: auth }));
    const ruta = rutas.find(r => r.ruta_id === rutaId || r.id === rutaId);
    if (!ruta) throw new Error("rutas cliente minimos normalizados: no encuentra ruta QA");
    if (String(ruta.tarifa_tipo) !== "tonelada") {
      throw new Error("rutas cliente minimos normalizados: tarifa_tipo inesperado");
    }
    if (Number(ruta.minimo_unidades || 0) !== 24) {
      throw new Error(`rutas cliente minimos normalizados: minimo_unidades=${ruta.minimo_unidades}`);
    }
    if (ruta.minimo_facturable !== null && ruta.minimo_facturable !== undefined && Number(ruta.minimo_facturable) !== 0) {
      throw new Error(`rutas cliente minimos normalizados: minimo_facturable debe quedar vacio, recibido ${ruta.minimo_facturable}`);
    }

    const saludCreada = await request("ruta salud cliente crear", `/api/v1/clientes/${encodeURIComponent(cliente.id)}/rutas`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        origen: `QA SALUD ${stamp}`,
        destino: `QA SALUD DEST ${stamp}`,
        km: 0,
        precio_base: 0,
        tarifa_tipo: "viaje",
        tipo_vehiculo: "cualquiera",
      }),
    });
    rutaSaludId = saludCreada?.ruta_id || null;
    if (!rutaSaludId) throw new Error("ruta salud cliente crear: no devuelve ruta_id");
    const salud = await request("rutas cliente salud estructura", `/api/v1/clientes/${encodeURIComponent(cliente.id)}/rutas/salud`, { headers: auth });
    for (const key of ["generated_at", "cliente_id", "resumen", "issues", "groups"]) {
      if (!Object.prototype.hasOwnProperty.call(salud || {}, key)) {
        throw new Error(`rutas cliente salud estructura: falta ${key}`);
      }
    }
    for (const key of ["total_rutas", "bloqueantes", "avisos", "score", "estado", "sin_precio", "sin_km", "minimos_incoherentes"]) {
      if (!Object.prototype.hasOwnProperty.call(salud.resumen || {}, key)) {
        throw new Error(`rutas cliente salud estructura: falta resumen.${key}`);
      }
    }
    if (!Array.isArray(salud.issues) || !salud.issues.some(i => i?.key === "sin_precio") || !salud.issues.some(i => i?.key === "sin_km")) {
      throw new Error("rutas cliente salud estructura: no detecta ruta sin precio/km");
    }
  } finally {
    if (rutaSaludId) {
      try {
        await request("ruta salud cliente limpiar", `/api/v1/rutas/${encodeURIComponent(rutaSaludId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN ruta salud cliente limpiar: ${e.message}`);
      }
    }
    if (rutaId) {
      try {
        await request("ruta toneladas normaliza minimo limpiar", `/api/v1/rutas/${encodeURIComponent(rutaId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN ruta toneladas normaliza minimo limpiar: ${e.message}`);
      }
    }
  }
}

async function checkPedidoToneladaNormalizacion(auth) {
  const clientes = asArray(await request("clientes para pedido toneladas", "/api/v1/clientes?activo=true&limit=5", { headers: auth }));
  const cliente = clientes.find(c => c?.id);
  if (!cliente) {
    console.log("OK pedido toneladas sin clientes para validar");
    return;
  }
  const stamp = Date.now();
  let pedidoId = null;
  let pedidoColaboradorId = null;
  let pedidoColaboradorLegacyId = null;
  let pedidoColaboradorFijoId = null;
  try {
    const creado = await request("pedido toneladas normaliza cantidad crear", "/api/v1/pedidos", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        cliente_id: cliente.id,
        origen: `QA TON ORIG ${stamp}`,
        destino: `QA TON DEST ${stamp}`,
        fecha_carga: "2026-06-02",
        tipo_precio: "tonelada",
        peso_kg: 24000,
        cantidad: 0.240,
        precio_unitario: 28.36,
        minimo_unidades: 24000,
        importe: 680640,
      }),
    });
    pedidoId = creado?.id || null;
    if (!pedidoId) throw new Error("pedido toneladas normaliza cantidad crear: no devuelve id");
    const pedido = await request("pedido toneladas normalizado leer", `/api/v1/pedidos/${encodeURIComponent(pedidoId)}`, { headers: auth });
    if (Number(pedido.cantidad || 0) !== 24) {
      throw new Error(`pedido toneladas normalizado leer: cantidad=${pedido.cantidad}`);
    }
    if (Number(pedido.minimo_unidades || 0) !== 24) {
      throw new Error(`pedido toneladas normalizado leer: minimo_unidades=${pedido.minimo_unidades}`);
    }
    if (Number(pedido.importe || 0) !== 680.64) {
      throw new Error(`pedido toneladas normalizado leer: importe=${pedido.importe}`);
    }
    const colaboradores = asArray(await request("colaboradores para pedido toneladas", "/api/v1/colaboradores?limit=5", { headers: auth }));
    const colaborador = colaboradores.find(c => c?.id);
    if (colaborador?.id) {
      const creadoColaborador = await request("pedido toneladas colaborador precio cliente crear", "/api/v1/pedidos", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          cliente_id: cliente.id,
          colaborador_id: colaborador.id,
          origen: `QA TON COL ORIG ${stamp}`,
          destino: `QA TON COL DEST ${stamp}`,
          fecha_carga: "2026-06-02",
          tipo_precio: "tonelada",
          peso_kg: 24000,
          cantidad: 0.240,
          precio_unitario: 28.36,
          minimo_unidades: 24000,
          importe: 680640,
          precio_cliente_col: 700,
          precio_colaborador: 690,
          precio_colaborador_unitario: "40.0000",
          minimo_colaborador_unidades: "25.600",
        }),
      });
      pedidoColaboradorId = creadoColaborador?.id || null;
      if (!pedidoColaboradorId) throw new Error("pedido toneladas colaborador precio cliente crear: no devuelve id");
      const pedidoColaborador = await request("pedido toneladas colaborador precio cliente leer", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorId)}`, { headers: auth });
      if (Number(pedidoColaborador.importe || 0) !== 680.64) {
        throw new Error(`pedido toneladas colaborador precio cliente leer: importe=${pedidoColaborador.importe}`);
      }
      if (Number(pedidoColaborador.precio_cliente_col || 0) !== 680.64) {
        throw new Error(`pedido toneladas colaborador precio cliente leer: precio_cliente_col=${pedidoColaborador.precio_cliente_col}`);
      }
      if (Number(pedidoColaborador.precio_colaborador_unitario || 0) !== 40) {
        throw new Error(`pedido toneladas colaborador precio cliente leer: precio_colaborador_unitario=${pedidoColaborador.precio_colaborador_unitario}`);
      }
      if (Number(pedidoColaborador.minimo_colaborador_unidades || 0) !== 25.6) {
        throw new Error(`pedido toneladas colaborador precio cliente leer: minimo_colaborador_unidades=${pedidoColaborador.minimo_colaborador_unidades}`);
      }
      const previewTonelada = await request("pedido colaborador toneladas preview economico", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorId)}/colaborador/preview`, { headers: auth });
      if (previewTonelada?.modo_precio !== "precio_por_tonelada" || previewTonelada?.precio_visible !== true) {
        throw new Error("pedido colaborador toneladas preview economico: no marca precio por tonelada visible");
      }
      const htmlTonelada = String(previewTonelada.html || "");
      if (!htmlTonelada.includes("Precio acordado por tonelada") || !htmlTonelada.includes("Minimo facturable acordado") || !htmlTonelada.includes("EUR/tn")) {
        throw new Error("pedido colaborador toneladas preview economico: no muestra EUR/tn y minimo");
      }
      if (htmlTonelada.includes("690,00 EUR")) {
        throw new Error("pedido colaborador toneladas preview economico: no debe mostrar total cerrado");
      }

      const creadoLegacy = await request("pedido colaborador toneladas legacy total crear", "/api/v1/pedidos", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          cliente_id: cliente.id,
          colaborador_id: colaborador.id,
          origen: `QA TON LEGACY ORIG ${stamp}`,
          destino: `QA TON LEGACY DEST ${stamp}`,
          fecha_carga: "2026-06-02",
          tipo_precio: "tonelada",
          peso_kg: 24000,
          cantidad: 24,
          precio_unitario: 28.36,
          minimo_unidades: 24,
          importe: 680.64,
          precio_cliente_col: 680.64,
          precio_colaborador: 700,
        }),
      });
      pedidoColaboradorLegacyId = creadoLegacy?.id || null;
      if (!pedidoColaboradorLegacyId) throw new Error("pedido colaborador toneladas legacy total crear: no devuelve id");
      const previewLegacy = await request("pedido colaborador toneladas legacy total preview", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorLegacyId)}/colaborador/preview`, { headers: auth });
      if (previewLegacy?.modo_precio !== "precio_cerrado" || previewLegacy?.precio_visible !== true) {
        throw new Error("pedido colaborador toneladas legacy total preview: no marca precio cerrado visible");
      }
      const htmlLegacy = String(previewLegacy.html || "");
      if (!htmlLegacy.includes("Precio acordado") || !htmlLegacy.includes("700,00 EUR") || htmlLegacy.includes("EUR/tn")) {
        throw new Error("pedido colaborador toneladas legacy total preview: no muestra total cerrado");
      }

      const creadoFijo = await request("pedido colaborador precio cerrado crear", "/api/v1/pedidos", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          cliente_id: cliente.id,
          colaborador_id: colaborador.id,
          origen: `QA COL FIJO ORIG ${stamp}`,
          destino: `QA COL FIJO DEST ${stamp}`,
          fecha_carga: "2026-06-02",
          tipo_precio: "viaje",
          precio_unitario: 700,
          importe: 700,
          precio_cliente_col: 700,
          precio_colaborador: 650,
        }),
      });
      pedidoColaboradorFijoId = creadoFijo?.id || null;
      if (!pedidoColaboradorFijoId) throw new Error("pedido colaborador precio cerrado crear: no devuelve id");
      const previewFijo = await request("pedido colaborador precio cerrado preview sin importe", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorFijoId)}/colaborador/preview`, { headers: auth });
      if (previewFijo?.modo_precio !== "sin_importe_impreso" || previewFijo?.precio_visible !== false) {
        throw new Error("pedido colaborador precio cerrado preview sin importe: debe ocultar importes");
      }
      const htmlFijo = String(previewFijo.html || "");
      if (htmlFijo.includes("Precio acordado por tonelada") || htmlFijo.includes("Minimo facturable acordado") || htmlFijo.includes("EUR/tn") || htmlFijo.includes("650,00 EUR")) {
        throw new Error("pedido colaborador precio cerrado preview sin importe: ha impreso precio/minimo indebido");
      }
    } else {
      console.log("OK pedido toneladas colaborador sin colaboradores para validar precio cliente canonico");
    }
  } finally {
    if (pedidoColaboradorFijoId) {
      try {
        await request("pedido colaborador precio cerrado cancelar", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorFijoId)}/estado`, {
          method: "PATCH",
          headers: auth,
          body: JSON.stringify({ estado: "cancelado", motivo_cancelacion: "Limpieza automatica QA" }),
        });
        await request("pedido colaborador precio cerrado limpiar", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorFijoId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN pedido colaborador precio cerrado limpiar: ${e.message}`);
      }
    }
    if (pedidoColaboradorId) {
      try {
        await request("pedido toneladas colaborador precio cliente cancelar", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorId)}/estado`, {
          method: "PATCH",
          headers: auth,
          body: JSON.stringify({ estado: "cancelado", motivo_cancelacion: "Limpieza automatica QA" }),
        });
        await request("pedido toneladas colaborador precio cliente limpiar", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN pedido toneladas colaborador precio cliente limpiar: ${e.message}`);
      }
    }
    if (pedidoColaboradorLegacyId) {
      try {
        await request("pedido colaborador toneladas legacy cancelar", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorLegacyId)}/estado`, {
          method: "PATCH",
          headers: auth,
          body: JSON.stringify({ estado: "cancelado", motivo_cancelacion: "Limpieza automatica QA" }),
        });
        await request("pedido colaborador toneladas legacy limpiar", `/api/v1/pedidos/${encodeURIComponent(pedidoColaboradorLegacyId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN pedido colaborador toneladas legacy limpiar: ${e.message}`);
      }
    }
    if (pedidoId) {
      try {
        await request("pedido toneladas normaliza cancelar", `/api/v1/pedidos/${encodeURIComponent(pedidoId)}/estado`, {
          method: "PATCH",
          headers: auth,
          body: JSON.stringify({ estado: "cancelado", motivo_cancelacion: "Limpieza automatica QA" }),
        });
        await request("pedido toneladas normaliza limpiar", `/api/v1/pedidos/${encodeURIComponent(pedidoId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN pedido toneladas normaliza limpiar: ${e.message}`);
      }
    }
  }
}

async function checkPedidoKmRutaYSaneadoParadas(auth) {
  const clientes = asArray(await request("clientes para pedido km auto", "/api/v1/clientes?activo=true&limit=5", { headers: auth }));
  const cliente = clientes.find(c => c?.id);
  if (!cliente) {
    console.log("OK pedido km auto sin clientes para validar");
    return;
  }
  const stamp = Date.now();
  let rutaId = null;
  let pedidoId = null;
  let pedidoIncompatibleId = null;
  try {
    const ruta = await request("pedido km auto ruta crear", `/api/v1/clientes/${encodeURIComponent(cliente.id)}/rutas`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        origen: `QA KM ORIG ${stamp}`,
        destino: `QA KM DEST ${stamp}`,
        km: 123,
        precio_base: 500,
        tarifa_tipo: "viaje",
        tipo_vehiculo: "cualquiera",
      }),
    });
    rutaId = ruta?.ruta_id || null;
    if (!rutaId) throw new Error("pedido km auto ruta crear: no devuelve ruta_id");
    const creado = await request("pedido km auto crear", "/api/v1/pedidos", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        cliente_id: cliente.id,
        ruta_id: rutaId,
        origen: `QA KM ORIG ${stamp}`,
        destino: `QA KM DEST ${stamp}`,
        fecha_carga: "2026-06-03",
        tipo_precio: "viaje",
        precio_unitario: 500,
        importe: 500,
        puntos_descarga: [{ direccion: `QA KM DEST ${stamp}`, google_maps_url: "SEGUN ALBARANES" }],
      }),
    });
    pedidoId = creado?.id || null;
    if (!pedidoId) throw new Error("pedido km auto crear: no devuelve id");
    const pedido = await request("pedido km auto leer", `/api/v1/pedidos/${encodeURIComponent(pedidoId)}`, { headers: auth });
    if (Number(pedido.km_ruta || 0) !== 123) {
      throw new Error(`pedido km auto leer: km_ruta=${pedido.km_ruta}`);
    }
    const descarga = Array.isArray(pedido.puntos_descarga) ? pedido.puntos_descarga[0] : null;
    if (!descarga || descarga.google_maps_url) {
      throw new Error("pedido km auto leer: no sanea google_maps_url invalida");
    }
    if (!String(descarga.notas || "").includes("SEGUN ALBARANES")) {
      throw new Error("pedido km auto leer: no conserva texto invalido como nota");
    }
    const incompatible = await request("pedido ruta incompatible crear", "/api/v1/pedidos", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        cliente_id: cliente.id,
        ruta_id: rutaId,
        origen: `QA KM ORIG ${stamp}`,
        destino: `QA KM DEST ${stamp}`,
        fecha_carga: "2026-06-04",
        tipo_precio: "tonelada",
        peso_kg: 24000,
        cantidad: 24,
        minimo_unidades: 24,
        precio_unitario: 28.36,
        importe: 680.64,
      }),
    });
    pedidoIncompatibleId = incompatible?.id || null;
    if (!pedidoIncompatibleId) throw new Error("pedido ruta incompatible crear: no devuelve id");
    const pedidoIncompatible = await request("pedido ruta incompatible leer", `/api/v1/pedidos/${encodeURIComponent(pedidoIncompatibleId)}`, { headers: auth });
    if (pedidoIncompatible.ruta_id) {
      throw new Error("pedido ruta incompatible leer: mantiene ruta_id incompatible");
    }
    if (Number(pedidoIncompatible.km_ruta || 0) !== 123) {
      throw new Error(`pedido ruta incompatible leer: no conserva km por origen/destino (${pedidoIncompatible.km_ruta})`);
    }
  } finally {
    if (pedidoIncompatibleId) {
      try {
        await request("pedido ruta incompatible cancelar", `/api/v1/pedidos/${encodeURIComponent(pedidoIncompatibleId)}/estado`, {
          method: "PATCH",
          headers: auth,
          body: JSON.stringify({ estado: "cancelado", motivo_cancelacion: "Limpieza automatica QA" }),
        });
        await request("pedido ruta incompatible limpiar", `/api/v1/pedidos/${encodeURIComponent(pedidoIncompatibleId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN pedido ruta incompatible limpiar: ${e.message}`);
      }
    }
    if (pedidoId) {
      try {
        await request("pedido km auto cancelar", `/api/v1/pedidos/${encodeURIComponent(pedidoId)}/estado`, {
          method: "PATCH",
          headers: auth,
          body: JSON.stringify({ estado: "cancelado", motivo_cancelacion: "Limpieza automatica QA" }),
        });
        await request("pedido km auto limpiar", `/api/v1/pedidos/${encodeURIComponent(pedidoId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN pedido km auto limpiar: ${e.message}`);
      }
    }
    if (rutaId) {
      try {
        await request("pedido km auto ruta limpiar", `/api/v1/rutas/${encodeURIComponent(rutaId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN pedido km auto ruta limpiar: ${e.message}`);
      }
    }
  }
}

async function checkPedidoAiInbox(auth) {
  const clientes = asArray(await request("clientes para bandeja IA pedidos", "/api/v1/clientes?activo=true&limit=5", { headers: auth }));
  const aiStatus = await request("bandeja IA pedidos estado", "/api/v1/pedidos/ai-inbox/status", { headers: auth });
  if (aiStatus?.basic_available !== true || typeof aiStatus.visual_available !== "boolean" || !Array.isArray(aiStatus.supported_basic_documents)) {
    throw new Error("bandeja IA pedidos estado: estructura invalida");
  }
  if (!String(aiStatus.guidance || "").includes("API") || !aiStatus.mode_label) {
    throw new Error("bandeja IA pedidos estado: falta guia operativa");
  }
  const cliente = clientes.find(c => c?.id);
  if (!cliente) {
    console.log("OK bandeja IA pedidos sin clientes para validar");
    return;
  }
  const stamp = Date.now();
  const data = await request("bandeja IA pedidos interpretar", "/api/v1/pedidos/ai-inbox/parse", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      texto: `Cliente: ${cliente.nombre}
Origen: QA AI ORIG ${stamp}
Destino: QA AI DEST ${stamp}
Fecha carga: 02/06/2026
Hora carga: 10:30
Mercancia: palets ceramica
Peso: 24000 kg
Precio: 850 EUR
Referencia: AI-${stamp}`,
    }),
  });
  if (!data?.pedido) throw new Error("bandeja IA pedidos interpretar: falta pedido");
  if (data.pedido.cliente_id !== cliente.id) {
    throw new Error(`bandeja IA pedidos interpretar: cliente_id=${data.pedido.cliente_id}`);
  }
  if (!String(data.pedido.origen || "").includes(`QA AI ORIG ${stamp}`)) {
    throw new Error(`bandeja IA pedidos interpretar: origen=${data.pedido.origen}`);
  }
  if (!String(data.pedido.destino || "").includes(`QA AI DEST ${stamp}`)) {
    throw new Error(`bandeja IA pedidos interpretar: destino=${data.pedido.destino}`);
  }
  if (String(data.pedido.fecha_carga || "") !== "2026-06-02") {
    throw new Error(`bandeja IA pedidos interpretar: fecha_carga=${data.pedido.fecha_carga}`);
  }
  if (Number(data.pedido.importe || 0) !== 850) {
    throw new Error(`bandeja IA pedidos interpretar: importe=${data.pedido.importe}`);
  }
  if (!Array.isArray(data.suggestions) || !Array.isArray(data.issues) || !Array.isArray(data.warnings)) {
    throw new Error("bandeja IA pedidos interpretar: sugerencias/incidencias/avisos no son arrays");
  }
  if (typeof data.confidence !== "number") {
    throw new Error("bandeja IA pedidos interpretar: falta confidence numerico");
  }
  const runs = asArray(await request("bandeja IA pedidos historial", "/api/v1/pedidos/ai-inbox/runs?limit=5", { headers: auth }));
  const last = runs[0];
  if (!last?.id || !last.status || typeof last.confidence !== "number") {
    throw new Error("bandeja IA pedidos historial: falta ultimo analisis estructurado");
  }
  if (!Array.isArray(last.attachments) || !Array.isArray(last.issues) || !Array.isArray(last.warnings) || !Array.isArray(last.suggestions)) {
    throw new Error("bandeja IA pedidos historial: arrays normalizados incompletos");
  }
  if (!last.operational_summary || !last.operational_summary.action || !["alta", "media", "baja"].includes(String(last.operational_summary.priority || ""))) {
    throw new Error("bandeja IA pedidos historial: falta resumen operativo");
  }
  if (!Array.isArray(last.operational_summary.detected) || !Array.isArray(last.operational_summary.missing) || !Array.isArray(last.operational_summary.alerts)) {
    throw new Error("bandeja IA pedidos historial: resumen operativo incompleto");
  }
  const pdfText = [
    `Cliente: ${cliente.nombre}`,
    `Origen: QA PDF ORIG ${stamp}`,
    `Destino: QA PDF DEST ${stamp}`,
    "Fecha carga: 03/06/2026",
    "Precio: 910 EUR",
  ].map(line => `(${line}) Tj`).join("\n");
  const pdfData = await request("bandeja IA pedidos PDF texto", "/api/v1/pedidos/ai-inbox/parse", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      texto: "",
      source: "pdf_texto",
      filename: "qa-orden.pdf",
      attachments: [{
        name: "qa-orden.pdf",
        mediaType: "application/pdf",
        sizeKb: 1,
        base64: Buffer.from(pdfText, "latin1").toString("base64"),
      }],
    }),
  });
  if (!String(pdfData?.pedido?.origen || "").includes(`QA PDF ORIG ${stamp}`) || Number(pdfData?.pedido?.importe || 0) !== 910) {
    throw new Error("bandeja IA pedidos PDF texto: no interpreta PDF con texto");
  }
  const xml = `<w:document><w:body><w:p><w:r><w:t>Cliente: ${cliente.nombre}</w:t></w:r></w:p><w:p><w:r><w:t>Origen: QA DOCX ORIG ${stamp}</w:t></w:r></w:p><w:p><w:r><w:t>Destino: QA DOCX DEST ${stamp}</w:t></w:r></w:p><w:p><w:r><w:t>Fecha carga: 04/06/2026</w:t></w:r></w:p><w:p><w:r><w:t>Precio: 920 EUR</w:t></w:r></w:p></w:body></w:document>`;
  const name = Buffer.from("word/document.xml");
  const dataBuf = Buffer.from(xml, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(dataBuf.length, 18);
  header.writeUInt32LE(dataBuf.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  const docxBase64 = Buffer.concat([header, name, dataBuf]).toString("base64");
  const docxData = await request("bandeja IA pedidos DOCX texto", "/api/v1/pedidos/ai-inbox/parse", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      texto: "",
      source: "docx_texto",
      filename: "qa-orden.docx",
      attachments: [{
        name: "qa-orden.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeKb: 1,
        base64: docxBase64,
      }],
    }),
  });
  if (!String(docxData?.pedido?.origen || "").includes(`QA DOCX ORIG ${stamp}`) || Number(docxData?.pedido?.importe || 0) !== 920) {
    throw new Error("bandeja IA pedidos DOCX texto: no interpreta DOCX con texto");
  }
}

async function checkDocumentoControlDigital(auth) {
  const pedidos = asArray(await request("pedidos para DCD", "/api/v1/pedidos?limit=5", { headers: auth }));
  const pedido = pedidos.find(p => p?.id);
  if (!pedido) {
    console.log("OK DCD sin pedidos para validar documento");
    return;
  }
  const dcd = await request("documento control digital estructura", `/api/v1/pedidos/${encodeURIComponent(pedido.id)}/documento-control-digital`, { headers: auth });
  if (!dcd?.documento?.codigo_control) {
    throw new Error("documento control digital estructura: falta codigo_control");
  }
  if (!dcd.status || typeof dcd.status !== "object") {
    throw new Error("documento control digital estructura: falta status");
  }
  if (!dcd.status.readiness || typeof dcd.status.readiness.score !== "number") {
    throw new Error("documento control digital estructura: falta readiness.score");
  }
  if (!Array.isArray(dcd.status.checks) || dcd.status.checks.length < 5) {
    throw new Error("documento control digital estructura: checks insuficientes");
  }
  if (!dcd.status.normativa?.documento_control_obligatorio_desde || !dcd.status.normativa?.efti_plena_aplicacion_desde || !dcd.status.normativa?.diwass_eannex_vii_entrada_vigor) {
    throw new Error("documento control digital estructura: falta normativa 2026/2027");
  }
  if (!Array.isArray(dcd.documento?.preparacion_digital?.diwass_annex_vii?.datos_requeridos_si_aplica)) {
    throw new Error("documento control digital estructura: falta preparacion DIWASS/eAnnex VII");
  }
  if (!dcd.documento?.preparacion_digital?.cumplimiento_operativo || !dcd.documento.preparacion_digital.cumplimiento_operativo.adr || !Array.isArray(dcd.documento.preparacion_digital.cumplimiento_operativo.avisos)) {
    throw new Error("documento control digital estructura: falta checklist cumplimiento operativo");
  }
  if (!dcd.remision?.filename || !dcd.remision?.canal) {
    throw new Error("documento control digital estructura: falta remision");
  }
  if (!/^[A-F0-9]{16}$/.test(String(dcd.documento?.verificacion?.codigo_verificacion || ""))) {
    throw new Error("documento control digital estructura: falta codigo de verificacion seguro");
  }
  if (!String(dcd.documento?.soporte_url || "").includes("token=") || !String(dcd.documento?.soporte_url || "").includes("verify=")) {
    throw new Error("documento control digital estructura: soporte_url no incluye token y verificacion");
  }
  const soporte = await fetchRaw("documento control soporte publico tokenizado", dcd.documento.soporte_url);
  if (!/noindex/i.test(String(soporte.res.headers.get("x-robots-tag") || "")) || !/no-store/i.test(String(soporte.res.headers.get("cache-control") || ""))) {
    throw new Error("documento control soporte publico tokenizado: faltan cabeceras noindex/no-store");
  }
  const invalidUrl = String(dcd.documento.soporte_url).replace(/verify=[A-F0-9]{16}/i, "verify=0000000000000000");
  const invalidRes = await fetch(invalidUrl);
  if (invalidRes.status !== 403) {
    throw new Error(`documento control soporte publico tokenizado: verificacion invalida esperaba 403, recibio ${invalidRes.status}`);
  }
  const exp = await request("documento control export efti ecmr", `/api/v1/pedidos/${encodeURIComponent(pedido.id)}/documento-control-digital/export`, { headers: auth });
  for (const key of ["schema", "regulatory_context", "identifiers", "parties", "transport", "goods", "waste_annex_vii", "compliance_operativo", "digital_readiness", "signature_envelope", "audit"]) {
    if (!Object.prototype.hasOwnProperty.call(exp || {}, key)) {
      throw new Error(`documento control export efti ecmr: falta ${key}`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(exp || {}, "verification") || exp.verification?.verification_code !== dcd.documento.verificacion.codigo_verificacion) {
    throw new Error("documento control export efti ecmr: falta verificacion tokenizada");
  }
  if (!exp.regulatory_context?.diwass_eannex_vii_entrada_vigor || !Array.isArray(exp.waste_annex_vii?.required_if_applicable)) {
    throw new Error("documento control export efti ecmr: falta bloque DIWASS/eAnnex VII");
  }
  if (!exp.compliance_operativo?.adr || !exp.compliance_operativo?.tacografo || !Array.isArray(exp.compliance_operativo?.avisos)) {
    throw new Error("documento control export efti ecmr: falta bloque cumplimiento operativo");
  }
  if (exp.schema?.profile !== "DCD-ES/eCMR/eFTI-ready") {
    throw new Error("documento control export efti ecmr: perfil inesperado");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(exp.audit?.integrity_hash_sha256 || ""))) {
    throw new Error("documento control export efti ecmr: hash de integridad invalido");
  }
  const firmaPkg = await request("documento control paquete firma eidas", `/api/v1/pedidos/${encodeURIComponent(pedido.id)}/documento-control-digital/firma-paquete`, { headers: auth });
  for (const key of ["schema", "document", "signature_policy", "signers_required", "evidence_current", "payload_to_sign", "hashes", "checks", "next_action"]) {
    if (!Object.prototype.hasOwnProperty.call(firmaPkg || {}, key)) {
      throw new Error(`documento control paquete firma eidas: falta ${key}`);
    }
  }
  if (firmaPkg.schema?.profile !== "eIDAS-advanced-signature-ready") {
    throw new Error("documento control paquete firma eidas: perfil inesperado");
  }
  if (firmaPkg.document?.verification_code !== dcd.documento.verificacion.codigo_verificacion) {
    throw new Error("documento control paquete firma eidas: no conserva codigo de verificacion");
  }
  if (!Array.isArray(firmaPkg.signers_required) || firmaPkg.signers_required.length < 2 || !Array.isArray(firmaPkg.checks)) {
    throw new Error("documento control paquete firma eidas: firmantes/checks insuficientes");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(firmaPkg.hashes?.payload_hash_sha256 || "")) || !/^[a-f0-9]{64}$/i.test(String(firmaPkg.hashes?.signature_package_hash_sha256 || ""))) {
    throw new Error("documento control paquete firma eidas: hashes invalidos");
  }
  const remisionRes = await fetch(`${baseUrl}/api/v1/pedidos/${encodeURIComponent(pedido.id)}/documento-control-digital/evento`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ action: "remitido", source: "functional_check" }),
  });
  const remisionText = await remisionRes.text();
  let remisionData = null;
  try { remisionData = remisionText ? JSON.parse(remisionText) : null; } catch { remisionData = {}; }
  if (dcd.status.ready) {
    if (!remisionRes.ok || remisionData?.action !== "remitido") {
      throw new Error(`documento control remision formal: respuesta inesperada ${remisionRes.status}`);
    }
  } else {
    const bloqueoValido = remisionData?.requiere_confirmacion === true &&
      (remisionData?.dcd_incompleto === true || remisionData?.firma_modificada === true);
    if (remisionRes.status !== 409 || !bloqueoValido) {
      throw new Error(`documento control remision formal: esperado bloqueo 409 por DCD incompleto o firma modificada, recibido ${remisionRes.status}`);
    }
  }
  console.log("OK documento control remision formal protegida");
}

async function checkRentabilidadPredictiva(auth) {
  const pedidos = asArray(await request("pedidos para rentabilidad predictiva", "/api/v1/pedidos?limit=5", { headers: auth }));
  const pedido = pedidos.find(p => p?.id);
  if (!pedido) {
    console.log("OK rentabilidad predictiva sin pedidos para validar");
    return;
  }
  const data = await request("rentabilidad predictiva pedido", `/api/v1/pedidos/${encodeURIComponent(pedido.id)}/rentabilidad-predictiva`, { headers: auth });
  for (const key of ["ingreso", "costes", "margen", "riesgos", "acciones", "decision", "recomendacion"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`rentabilidad predictiva pedido: falta ${key}`);
    }
  }
  if (!Array.isArray(data.riesgos) || !Array.isArray(data.acciones)) {
    throw new Error("rentabilidad predictiva pedido: riesgos/acciones no son array");
  }
  if (!["verde", "amarillo", "rojo"].includes(String(data.margen?.color || ""))) {
    throw new Error("rentabilidad predictiva pedido: color de margen invalido");
  }
}

async function checkIdaRetornoPedidos(auth) {
  const pedidos = asArray(await request("pedidos para ida-retorno", "/api/v1/pedidos?facturado=false&limit=20", { headers: auth }));
  const candidatos = pedidos.filter(p => p?.id && !p.viaje_enlazado_id);
  if (candidatos.length < 2) {
    console.log("OK ida-retorno sin pedidos suficientes para enlazar");
    return;
  }
  const salida = candidatos[0];
  const retorno = candidatos.find(p => String(p.id) !== String(salida.id));
  if (!retorno) {
    console.log("OK ida-retorno sin retorno candidato");
    return;
  }
  const linked = await request("pedido enlazar ida-retorno", `/api/v1/pedidos/${encodeURIComponent(salida.id)}/ida-retorno`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ retorno_id: retorno.id, km_vacio_enlace: 12.5, copiar_asignacion: true }),
  });
  if (!linked?.enlazado || !linked?.resumen || Number(linked.resumen.km?.vacio_enlace || 0) !== 12.5) {
    throw new Error("pedido enlazar ida-retorno: resumen invalido");
  }
  if (!Object.prototype.hasOwnProperty.call(linked.resumen, "precio_total_ida_vuelta")) {
    throw new Error("pedido enlazar ida-retorno: falta precio_total_ida_vuelta");
  }
  const resumen = await request("pedido resumen ida-retorno", `/api/v1/pedidos/${encodeURIComponent(salida.id)}/ida-retorno`, { headers: auth });
  if (!resumen?.enlazado || resumen?.resumen?.retorno_id !== retorno.id) {
    throw new Error("pedido resumen ida-retorno: no refleja retorno enlazado");
  }
  const unlinked = await request("pedido desvincular ida-retorno", `/api/v1/pedidos/${encodeURIComponent(salida.id)}/ida-retorno`, {
    method: "DELETE",
    headers: auth,
  });
  if (!unlinked?.desvinculado) throw new Error("pedido desvincular ida-retorno: respuesta invalida");
}

async function checkUsuariosTraficoScope(auth) {
  const vehiculos = asArray(await request("vehiculos para alcance trafico", "/api/v1/vehiculos", { headers: auth }));
  const vehiculo = vehiculos.find(v => v?.id);
  const suffix = Date.now();
  const username = `qa.trafico.scope.${suffix}`;
  const body = {
    nombre: "QA Trafico Scope",
    username,
    email: null,
    password: "Temporal123",
    rol: "trafico",
    perfil: "QA alcance operativo",
    activo: true,
    trafico_config: {
      vehiculo_ids: vehiculo?.id ? [vehiculo.id] : [],
      tipos_viaje: ["retorno"],
    },
  };
  const creado = await request("usuario trafico alcance crear", "/api/v1/usuarios", {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  if (!creado?.id || !creado?.trafico_config || !Array.isArray(creado.trafico_config.tipos_viaje)) {
    throw new Error("usuario trafico alcance crear: no devuelve trafico_config");
  }
  if (!creado.trafico_config.tipos_viaje.includes("retorno")) {
    throw new Error("usuario trafico alcance crear: no conserva retornos");
  }
  if (vehiculo?.id && !creado.trafico_config.vehiculo_ids.includes(vehiculo.id)) {
    throw new Error("usuario trafico alcance crear: no conserva matricula");
  }
  const listado = asArray(await request("usuario trafico alcance listado", "/api/v1/usuarios", { headers: auth }));
  const found = listado.find(u => u.id === creado.id);
  if (!found?.trafico_config?.tipos_viaje?.includes("retorno")) {
    throw new Error("usuario trafico alcance listado: no refleja configuracion");
  }
  await request("usuario trafico alcance desactivar", `/api/v1/usuarios/${encodeURIComponent(creado.id)}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ activo: false }),
  });
}

async function checkColaboradorRevisionNotificaciones(auth) {
  const suffix = Date.now();
  let creado = null;
  try {
    creado = await request("colaborador revision crear pendiente", "/api/v1/colaboradores", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        tipo: "empresa",
        nombre: `QA Colaborador Revision ${suffix}`,
        cif: `QAREV${String(suffix).slice(-8)}`,
        email: `qa-colaborador-${suffix}@example.com`,
        telefono: "600000000",
        pendiente_revision: true,
        origen_creacion: "pedidos",
      }),
    });
    if (!creado?.id || creado.pendiente_revision !== true) {
      throw new Error("colaborador revision crear pendiente: no queda pendiente_revision");
    }
    const notifs = await request("colaborador revision notificacion", "/api/v1/notificaciones?limit=100", { headers: auth });
    const notif = asArray(notifs?.data).find(n =>
      n.tipo === "colaborador_revision" &&
      String(n.data?.colaborador_id) === String(creado.id) &&
      n.leida === false
    );
    if (!notif) throw new Error("colaborador revision notificacion: no se creo aviso no leido");

    await request("colaborador revision completar", `/api/v1/colaboradores/${encodeURIComponent(creado.id)}/revision`, {
      method: "PATCH",
      headers: auth,
    });
    const refreshed = await request("colaborador revision notificacion leida", "/api/v1/notificaciones?limit=100&include_read=true", { headers: auth });
    const cleared = asArray(refreshed?.data).find(n =>
      n.tipo === "colaborador_revision" &&
      String(n.data?.colaborador_id) === String(creado.id)
    );
    if (!cleared?.leida) throw new Error("colaborador revision notificacion leida: el aviso no desaparece al revisar");
  } finally {
    if (creado?.id) {
      await request("colaborador revision limpiar QA", `/api/v1/colaboradores/${encodeURIComponent(creado.id)}`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({
          ...creado,
          activo: false,
          pendiente_revision: false,
          notas: `${creado.notas || ""}\nQA desactivado automaticamente tras functional_check.`.trim(),
        }),
      }).catch(() => null);
    }
  }
}

async function checkAvisoClientePedido(auth) {
  const pedidos = asArray(await request("pedidos para aviso cliente", "/api/v1/pedidos?limit=5", { headers: auth }));
  const pedido = pedidos.find(p => p?.id);
  if (!pedido) {
    console.log("OK aviso cliente sin pedidos para validar");
    return;
  }
  const data = await request("pedido aviso cliente preflight", `/api/v1/pedidos/${encodeURIComponent(pedido.id)}/avisar-cliente/preflight?destinatario=qa-controltower@example.com`, { headers: auth });
  for (const key of ["ok", "bloqueantes", "destinatario", "pedido"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`pedido aviso cliente preflight: falta ${key}`);
    }
  }
  if (!Array.isArray(data.bloqueantes)) {
    throw new Error("pedido aviso cliente preflight: bloqueantes no es array");
  }
  if (String(data.destinatario) !== "qa-controltower@example.com") {
    throw new Error("pedido aviso cliente preflight: destinatario inesperado");
  }
}

async function checkFirmaEvidenciaPedido(auth) {
  const pedidos = asArray(await request("pedidos para evidencia firma", "/api/v1/pedidos?limit=5", { headers: auth }));
  const pedido = pedidos.find(p => p?.id);
  if (!pedido) {
    console.log("OK evidencia firma sin pedidos para validar");
    return;
  }
  const data = await request("firma evidencia pedido estructura", `/api/v1/pedidos/${encodeURIComponent(pedido.id)}/firma/evidencia`, { headers: auth });
  for (const key of ["pedido_id", "pedido_numero", "firmado", "firma_fecha", "firma_nombre", "firma_hash", "evidencia", "post_signature_integrity", "target_eidas"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`firma evidencia pedido estructura: falta ${key}`);
    }
  }
  if (typeof data.post_signature_integrity?.checked !== "boolean" || typeof data.post_signature_integrity?.changed_after_signature !== "boolean" || !Array.isArray(data.post_signature_integrity?.changes)) {
    throw new Error("firma evidencia pedido estructura: integridad postfirma invalida");
  }
  if (data.post_signature_integrity.checked && (!data.post_signature_integrity.status || !data.post_signature_integrity.current_context_hash_sha256)) {
    throw new Error("firma evidencia pedido estructura: falta hash postfirma");
  }
  if (data.firma_hash && !/^[a-f0-9]{64}$/i.test(String(data.firma_hash))) {
    throw new Error("firma evidencia pedido estructura: firma_hash invalido");
  }
  if (data.evidencia && !/^[a-f0-9]{64}$/i.test(String(data.evidencia.integrity_hash_sha256 || ""))) {
    throw new Error("firma evidencia pedido estructura: integrity_hash invalido");
  }
  const report = await fetchRaw("firma evidencia pedido informe HTML", `/api/v1/pedidos/${encodeURIComponent(pedido.id)}/firma/evidencia/informe`, { headers: auth });
  if (!String(report.res.headers.get("content-type") || "").includes("text/html") || !String(report.text || "").includes("Informe de evidencia de firma") || !String(report.text || "").includes("Integridad postfirma")) {
    throw new Error("firma evidencia pedido informe HTML: contenido invalido");
  }
  const clientes = asArray(await request("clientes para firma postfirma", "/api/v1/clientes?activo=true&limit=5", { headers: auth }));
  const cliente = clientes.find(c => c?.id);
  if (!cliente) {
    console.log("OK firma postfirma sin clientes para validar evento");
    return;
  }
  const stamp = Date.now();
  let pedidoFirmadoId = null;
  try {
    const creado = await request("firma postfirma pedido crear", "/api/v1/pedidos", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        cliente_id: cliente.id,
        origen: `QA FIRMA ORIG ${stamp}`,
        destino: `QA FIRMA DEST ${stamp}`,
        fecha_carga: "2026-06-05",
        fecha_descarga: "2026-06-06",
        importe: 100,
      }),
    });
    pedidoFirmadoId = creado?.id || null;
    if (!pedidoFirmadoId) throw new Error("firma postfirma pedido crear: no devuelve id");
    await request("firma postfirma registrar firma", `/api/v1/pedidos/${encodeURIComponent(pedidoFirmadoId)}/firma`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        firma_destinatario: "data:image/png;base64,QA==",
        firma_nombre: "QA Destinatario",
        source: "functional_check",
      }),
    });
    await request("firma postfirma cambiar origen", `/api/v1/pedidos/${encodeURIComponent(pedidoFirmadoId)}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ origen: `QA FIRMA ORIG MOD ${stamp}` }),
    });
    const evidenciaModificada = await request("firma postfirma evidencia modificada", `/api/v1/pedidos/${encodeURIComponent(pedidoFirmadoId)}/firma/evidencia`, { headers: auth });
    if (evidenciaModificada.post_signature_integrity?.changed_after_signature !== true || !evidenciaModificada.post_signature_integrity?.changes?.some(c => c.field === "origen")) {
      throw new Error("firma postfirma evidencia modificada: no detecta cambio de origen");
    }
    const eventos = asArray(await request("firma postfirma eventos", `/api/v1/pedidos/${encodeURIComponent(pedidoFirmadoId)}/eventos`, { headers: auth }));
    if (!eventos.some(ev => ev.tipo === "firma.contexto_modificado" && Array.isArray(ev.detalle?.changes))) {
      throw new Error("firma postfirma eventos: no registra evento de cambio postfirma");
    }
    const notificaciones = await request("firma postfirma notificacion gerencia", "/api/v1/notificaciones?limit=100", { headers: auth });
    const aviso = asArray(notificaciones?.data).find(n =>
      n.tipo === "firma_postfirma_modificada" &&
      String(n.data?.pedido_id || "") === String(pedidoFirmadoId) &&
      n.leida === false
    );
    if (!aviso) throw new Error("firma postfirma notificacion gerencia: no crea aviso no leido");
    const remisionFirmaBloqueadaRes = await fetch(`${baseUrl}/api/v1/pedidos/${encodeURIComponent(pedidoFirmadoId)}/documento-control-digital/evento`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ action: "remitido", source: "functional_check_firma" }),
    });
    const remisionFirmaBloqueadaText = await remisionFirmaBloqueadaRes.text();
    let remisionFirmaBloqueada = null;
    try { remisionFirmaBloqueada = remisionFirmaBloqueadaText ? JSON.parse(remisionFirmaBloqueadaText) : null; } catch {}
    if (remisionFirmaBloqueadaRes.status !== 409 || remisionFirmaBloqueada?.firma_modificada !== true || remisionFirmaBloqueada?.requiere_confirmacion !== true) {
      throw new Error(`firma postfirma bloqueo DCD: esperaba 409 firma_modificada, recibido ${remisionFirmaBloqueadaRes.status} ${remisionFirmaBloqueadaText.slice(0, 220)}`);
    }
    console.log("OK firma postfirma bloqueo DCD");
    const remisionFirmaConfirmadaRes = await fetch(`${baseUrl}/api/v1/pedidos/${encodeURIComponent(pedidoFirmadoId)}/documento-control-digital/evento`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ action: "remitido", source: "functional_check_firma", confirmar_firma_modificada: true }),
    });
    const remisionFirmaConfirmadaText = await remisionFirmaConfirmadaRes.text();
    let remisionFirmaConfirmada = null;
    try { remisionFirmaConfirmada = remisionFirmaConfirmadaText ? JSON.parse(remisionFirmaConfirmadaText) : null; } catch {}
    if (remisionFirmaConfirmadaRes.status === 409 && remisionFirmaConfirmada?.firma_modificada === true) {
      throw new Error(`firma postfirma confirmacion DCD: sigue bloqueando por firma ${remisionFirmaConfirmadaText.slice(0, 220)}`);
    }
    if (!remisionFirmaConfirmadaRes.ok && !(remisionFirmaConfirmadaRes.status === 409 && remisionFirmaConfirmada?.dcd_incompleto === true)) {
      throw new Error(`firma postfirma confirmacion DCD: respuesta inesperada ${remisionFirmaConfirmadaRes.status} ${remisionFirmaConfirmadaText.slice(0, 220)}`);
    }
    console.log("OK firma postfirma confirmacion DCD");
  } finally {
    if (pedidoFirmadoId) {
      try {
        await request("firma postfirma cancelar QA", `/api/v1/pedidos/${encodeURIComponent(pedidoFirmadoId)}/estado`, {
          method: "PATCH",
          headers: auth,
          body: JSON.stringify({ estado: "cancelado", motivo_cancelacion: "Limpieza automatica QA" }),
        });
        await request("firma postfirma limpiar QA", `/api/v1/pedidos/${encodeURIComponent(pedidoFirmadoId)}`, {
          method: "DELETE",
          headers: auth,
        });
      } catch (e) {
        console.warn(`WARN firma postfirma limpiar QA: ${e.message}`);
      }
    }
  }
}

async function checkRentabilidadOperativa(auth) {
  const data = await request("rentabilidad operativa estructura", "/api/v1/informes/rentabilidad-operativa?period=30d", { headers: auth });
  for (const key of ["resumen", "riesgos", "por_cliente", "generated_at"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`rentabilidad operativa estructura: falta ${key}`);
    }
  }
  if (!Array.isArray(data.riesgos) || !Array.isArray(data.por_cliente)) {
    throw new Error("rentabilidad operativa estructura: riesgos/por_cliente no son array");
  }
  for (const key of ["pedidos", "ingreso", "coste", "margen", "margen_pct", "margen_bajo", "sin_precio", "sin_km", "pod_pendiente"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen || {}, key)) {
      throw new Error(`rentabilidad operativa estructura: falta resumen.${key}`);
    }
  }
  if (!["ok", "alerta", "critica"].includes(String(data.resumen?.salud || ""))) {
    throw new Error("rentabilidad operativa estructura: salud invalida");
  }
}

async function checkCargasRetorno(auth) {
  const data = await request("cargas retorno estructura", "/api/v1/informes/cargas-retorno?period=30d", { headers: auth });
  for (const key of ["resumen", "oportunidades", "sin_retorno", "zonas_demanda", "carriers_recomendados", "solicitudes_recientes", "reglas", "generated_at"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`cargas retorno estructura: falta ${key}`);
    }
  }
  if (!Array.isArray(data.oportunidades) || !Array.isArray(data.sin_retorno) || !Array.isArray(data.zonas_demanda) || !Array.isArray(data.carriers_recomendados) || !Array.isArray(data.solicitudes_recientes)) {
    throw new Error("cargas retorno estructura: listas invalidas");
  }
  for (const key of ["oportunidades", "alta", "media", "km_vacio_evitable", "pedidos_sin_retorno", "zonas_con_demanda", "carriers_aptos", "carriers_condicionados", "carriers_bloqueados", "solicitudes_enviadas"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen || {}, key)) {
      throw new Error(`cargas retorno estructura: falta resumen.${key}`);
    }
  }
  if (data.oportunidades[0]) {
    const item = data.oportunidades[0];
    for (const key of ["source", "score", "prioridad", "base", "candidato", "impacto", "accion"]) {
      if (!Object.prototype.hasOwnProperty.call(item || {}, key)) {
        throw new Error(`cargas retorno estructura: falta oportunidad.${key}`);
      }
    }
    if (!item.base?.pedido_id || !item.candidato?.pedido_id) {
      throw new Error("cargas retorno estructura: oportunidad sin pedidos vinculados");
    }
  }
  if (data.carriers_recomendados[0]) {
    const carrier = data.carriers_recomendados[0];
    for (const key of ["id", "nombre", "status", "label", "score", "checks", "bloqueantes", "avisos", "next_action"]) {
      if (!Object.prototype.hasOwnProperty.call(carrier || {}, key)) {
        throw new Error(`cargas retorno estructura: falta carrier.${key}`);
      }
    }
    if (!["apto", "condicionado", "bloqueado"].includes(String(carrier.status || ""))) {
      throw new Error("cargas retorno estructura: carrier.status invalido");
    }
    if (!Array.isArray(carrier.checks) || !Array.isArray(carrier.bloqueantes) || !Array.isArray(carrier.avisos)) {
      throw new Error("cargas retorno estructura: carrier listas invalidas");
    }
  }
  if (data.solicitudes_recientes[0]) {
    const sol = data.solicitudes_recientes[0];
    for (const key of ["id", "pedido_id", "carrier_id", "carrier_nombre", "destinatario", "estado", "notas", "sent_at", "responded_at", "pedido_asignado_at", "pedido_asignado_a_carrier", "updated_at"]) {
      if (!Object.prototype.hasOwnProperty.call(sol || {}, key)) {
        throw new Error(`cargas retorno estructura: falta solicitud.${key}`);
      }
    }
    if (typeof sol.pedido_asignado_a_carrier !== "boolean") {
      throw new Error("cargas retorno estructura: solicitud.pedido_asignado_a_carrier no es boolean");
    }
  }
  const pedidoId = data.oportunidades[0]?.candidato?.pedido_id || data.sin_retorno[0]?.pedido_id;
  const carrierId = data.carriers_recomendados[0]?.id;
  if (pedidoId && carrierId) {
    const solicitud = await request("cargas retorno solicitud carrier", "/api/v1/informes/cargas-retorno/solicitud", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        pedido_id: pedidoId,
        base_pedido_id: data.oportunidades[0]?.base?.pedido_id || null,
        carrier_id: carrierId,
      }),
    });
    for (const key of ["ok", "ready", "bloqueantes", "avisos", "solicitud", "carrier", "pedido"]) {
      if (!Object.prototype.hasOwnProperty.call(solicitud || {}, key)) {
        throw new Error(`cargas retorno solicitud carrier: falta ${key}`);
      }
    }
    if (!solicitud.solicitud?.asunto || !solicitud.solicitud?.cuerpo) {
      throw new Error("cargas retorno solicitud carrier: falta asunto/cuerpo");
    }
    if (!Array.isArray(solicitud.bloqueantes) || !Array.isArray(solicitud.avisos)) {
      throw new Error("cargas retorno solicitud carrier: bloqueantes/avisos invalidos");
    }
  }
}

async function checkScoringOperativo(auth) {
  const data = await request("scoring operativo estructura", "/api/v1/informes/scoring-operativo?period=90d", { headers: auth });
  for (const key of ["resumen", "decisiones_prioritarias", "clientes", "colaboradores", "generated_at"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`scoring operativo estructura: falta ${key}`);
    }
  }
  if (!Array.isArray(data.clientes) || !Array.isArray(data.colaboradores) || !Array.isArray(data.decisiones_prioritarias)) {
    throw new Error("scoring operativo estructura: clientes/colaboradores/decisiones no son array");
  }
  for (const key of ["clientes", "colaboradores", "riesgo_alto", "clientes_rojo", "colaboradores_rojo", "aceptacion_autorizacion", "aceptacion_condicionada", "carriers_verificados", "carriers_condicionados", "carriers_bloqueados"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen || {}, key)) {
      throw new Error(`scoring operativo estructura: falta resumen.${key}`);
    }
  }
  const item = data.clientes[0] || data.colaboradores[0];
  if (item) {
    for (const key of ["score", "salud", "motivos", "accion", "decision"]) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) {
        throw new Error(`scoring operativo estructura: item sin ${key}`);
      }
    }
    if (!["verde", "amarillo", "rojo"].includes(String(item.salud || ""))) {
      throw new Error("scoring operativo estructura: salud invalida");
    }
    if (!Array.isArray(item.motivos)) {
      throw new Error("scoring operativo estructura: motivos no es array");
    }
    for (const key of ["risk", "acceptance", "label", "max_volume", "required_controls", "recommended_conditions"]) {
      if (!Object.prototype.hasOwnProperty.call(item.decision || {}, key)) {
        throw new Error(`scoring operativo estructura: decision sin ${key}`);
      }
    }
    if (!["bajo", "medio", "alto"].includes(String(item.decision?.risk || ""))) {
      throw new Error("scoring operativo estructura: decision.risk invalido");
    }
    if (!["aceptar_normal", "aceptar_condicionado", "autorizar_gerencia"].includes(String(item.decision?.acceptance || ""))) {
      throw new Error("scoring operativo estructura: decision.acceptance invalido");
    }
  }
  const carrier = data.colaboradores.find(c => c?.id);
  if (carrier) {
    for (const key of ["documentos", "docs_caducados", "docs_proximos", "vehiculos", "vehiculos_doc_riesgo", "verificacion"]) {
      if (!Object.prototype.hasOwnProperty.call(carrier, key)) {
        throw new Error(`scoring operativo estructura: carrier sin ${key}`);
      }
    }
    for (const key of ["status", "label", "can_assign", "score", "checks", "faltantes", "avisos", "next_action"]) {
      if (!Object.prototype.hasOwnProperty.call(carrier.verificacion || {}, key)) {
        throw new Error(`scoring operativo estructura: carrier.verificacion sin ${key}`);
      }
    }
    if (!["verificado", "condicionado", "bloqueado"].includes(String(carrier.verificacion?.status || ""))) {
      throw new Error("scoring operativo estructura: carrier.verificacion.status invalido");
    }
    if (!Array.isArray(carrier.verificacion.checks) || !Array.isArray(carrier.verificacion.faltantes) || !Array.isArray(carrier.verificacion.avisos)) {
      throw new Error("scoring operativo estructura: carrier.verificacion listas invalidas");
    }
  }
}

async function checkEmisionesOperativas(auth) {
  const data = await request("emisiones operativas estructura", "/api/v1/informes/emisiones-operativas?period=90d", { headers: auth });
  for (const key of ["metodologia", "resumen", "por_cliente", "por_vehiculo", "por_ruta", "pendientes_km", "acciones", "generated_at"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`emisiones operativas estructura: falta ${key}`);
    }
  }
  if (!Array.isArray(data.por_cliente) || !Array.isArray(data.por_vehiculo) || !Array.isArray(data.por_ruta) || !Array.isArray(data.pendientes_km) || !Array.isArray(data.acciones)) {
    throw new Error("emisiones operativas estructura: listas no son array");
  }
  for (const key of ["pedidos", "km_total", "km_vacio", "litros_estimados", "co2_kg", "co2_t", "datos_incompletos"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen || {}, key)) {
      throw new Error(`emisiones operativas estructura: falta resumen.${key}`);
    }
  }
  for (const key of ["estado", "consumo_l_100km", "factor_kg_co2_litro"]) {
    if (!Object.prototype.hasOwnProperty.call(data.metodologia || {}, key)) {
      throw new Error(`emisiones operativas estructura: falta metodologia.${key}`);
    }
  }
  const accion = data.acciones.find(x => x?.type);
  if (accion) {
    for (const key of ["type", "severity", "title", "description", "recommendation"]) {
      if (!Object.prototype.hasOwnProperty.call(accion, key)) {
        throw new Error(`emisiones operativas estructura: accion sin ${key}`);
      }
    }
  }
}

async function checkDatosMaestrosReadiness(auth) {
  const data = await request("datos maestros readiness estructura", "/api/v1/informes/datos-maestros-readiness", { headers: auth });
  for (const key of ["resumen", "secciones", "acciones_recomendadas", "generated_at"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`datos maestros readiness estructura: falta ${key}`);
    }
  }
  for (const key of ["total", "completos", "incompletos", "pct_completo", "score_medio", "faltantes_obligatorios", "estado"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen || {}, key)) {
      throw new Error(`datos maestros readiness estructura: falta resumen.${key}`);
    }
  }
  for (const key of ["clientes", "colaboradores", "choferes", "vehiculos"]) {
    const sec = data.secciones?.[key];
    if (!sec?.resumen || !Array.isArray(sec.items)) {
      throw new Error(`datos maestros readiness estructura: seccion invalida ${key}`);
    }
  }
}

async function checkCumplimientoEuropeo(auth) {
  const data = await request("cumplimiento europeo estructura", "/api/v1/informes/cumplimiento-europeo?days=45", { headers: auth });
  for (const key of ["periodo", "marco_normativo", "resumen", "acciones", "viajes", "generated_at"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`cumplimiento europeo estructura: falta ${key}`);
    }
  }
  for (const key of ["total_viajes", "con_senales", "sin_senales", "adr", "zbe", "internacional", "cabotaje", "tacografo", "diwass", "alta", "media"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen || {}, key)) {
      throw new Error(`cumplimiento europeo estructura: falta resumen.${key}`);
    }
  }
  if (!data.marco_normativo.documento_control_obligatorio_desde || !data.marco_normativo.efti_plena_aplicacion_desde || !data.marco_normativo.diwass_eannex_vii_entrada_vigor) {
    throw new Error("cumplimiento europeo estructura: falta marco normativo");
  }
  if (!Array.isArray(data.acciones) || !Array.isArray(data.viajes)) {
    throw new Error("cumplimiento europeo estructura: acciones/viajes no son array");
  }
  const viaje = data.viajes.find(v => v?.id);
  if (viaje) {
    for (const key of ["flags", "cumplimiento", "prioridad", "score_riesgo", "accion_recomendada"]) {
      if (!Object.prototype.hasOwnProperty.call(viaje, key)) {
        throw new Error(`cumplimiento europeo estructura: viaje sin ${key}`);
      }
    }
    for (const key of ["adr", "zbe", "internacional", "cabotaje", "tacografo", "diwass"]) {
      if (!Object.prototype.hasOwnProperty.call(viaje.flags || {}, key)) {
        throw new Error(`cumplimiento europeo estructura: flags sin ${key}`);
      }
    }
    if (!viaje.cumplimiento?.diwass_eannex_vii || !Array.isArray(viaje.cumplimiento.diwass_eannex_vii.datos_requeridos_si_aplica)) {
      throw new Error("cumplimiento europeo estructura: falta detalle DIWASS/eAnnex VII");
    }
  }
}

async function checkFiscalConfig(auth) {
  const data = await request("configuracion fiscal estructura", "/api/v1/empresa/fiscal-config", { headers: auth });
  if (!data?.config || !data?.status || !data?.meta) {
    throw new Error("configuracion fiscal estructura: faltan config/status/meta");
  }
  if (!Array.isArray(data.status.checks)) {
    throw new Error("configuracion fiscal estructura: status.checks no es array");
  }
  if (!Object.prototype.hasOwnProperty.call(data.status, "production_ready")) {
    throw new Error("configuracion fiscal estructura: falta production_ready");
  }
  if (Object.prototype.hasOwnProperty.call(data.config?.verifactu || {}, "provider_api_key")) {
    throw new Error("configuracion fiscal estructura: provider_api_key no esta saneada");
  }
  if (Object.prototype.hasOwnProperty.call(data.config?.verifactu || {}, "provider_webhook_secret")) {
    throw new Error("configuracion fiscal estructura: provider_webhook_secret no esta saneado");
  }
  const queue = await request("cola fiscal resumen estructura", "/api/v1/empresa/fiscal-config/queue-summary", { headers: auth });
  if (!queue?.resumen || typeof queue.resumen !== "object") {
    throw new Error("cola fiscal resumen estructura: falta resumen");
  }
  for (const key of ["total_registros", "pendientes", "aceptados", "con_error", "atascados"]) {
    if (!Object.prototype.hasOwnProperty.call(queue.resumen, key)) {
      throw new Error(`cola fiscal resumen estructura: falta resumen.${key}`);
    }
  }
  if (!Array.isArray(queue.recientes) || !Array.isArray(queue.cola)) {
    throw new Error("cola fiscal resumen estructura: recientes/cola no son arrays");
  }
}

async function checkCashflowOperativo(auth) {
  const cobros = await request("control cobros estructura", "/api/v1/facturas/control-cobros", { headers: auth });
  if (!cobros?.resumen || !Array.isArray(cobros.proximas) || !Array.isArray(cobros.riesgo) || !cobros.config) {
    throw new Error("control cobros estructura: faltan resumen/proximas/riesgo/config");
  }
  for (const key of ["pendientes", "vencidas", "reclamadas", "sin_cobrar", "importe_pendiente", "revisar_hoy"]) {
    if (!Object.prototype.hasOwnProperty.call(cobros.resumen, key)) {
      throw new Error(`control cobros estructura: falta resumen.${key}`);
    }
  }
  const bloqueos = await request("bloqueos documental cobro estructura", "/api/v1/facturas/bloqueos-documentales", { headers: auth });
  if (!bloqueos?.resumen || !Array.isArray(bloqueos.pedidos) || !Array.isArray(bloqueos.facturas) || !Array.isArray(bloqueos.cobros)) {
    throw new Error("bloqueos documental cobro estructura: faltan resumen/listas");
  }
  for (const key of ["pedidos_sin_soporte", "facturas_con_soporte_pendiente", "cobros_en_riesgo_documental", "total_bloqueos"]) {
    if (!Object.prototype.hasOwnProperty.call(bloqueos.resumen, key)) {
      throw new Error(`bloqueos documental cobro estructura: falta resumen.${key}`);
    }
  }
  const pagos = await request("pagos colaborador pendientes estructura", "/api/v1/pedidos/colaborador-pagos/pendientes", { headers: auth });
  if (!Array.isArray(pagos)) {
    throw new Error("pagos colaborador pendientes estructura: respuesta no es array");
  }
  const pago = pagos.find(p => p?.pedido_id);
  if (!pago) {
    console.log("OK pagos colaborador sin pendientes para validar estructura");
    return;
  }
  for (const key of ["importe", "pagado", "documentacion_recibida", "pendiente_factura", "fecha_pago_calculada"]) {
    if (!Object.prototype.hasOwnProperty.call(pago, key)) {
      throw new Error(`pagos colaborador pendientes estructura: falta ${key}`);
    }
  }
}

async function checkGpsDiagnostico(auth) {
  const providers = await request("gps proveedores estructura", "/api/v1/vehiculos/gps/providers", { headers: auth });
  if (!Array.isArray(providers?.providers)) {
    throw new Error("gps proveedores estructura: providers no es array");
  }
  if (!providers.providers.some(p => p?.id === "manual")) {
    throw new Error("gps proveedores estructura: falta proveedor manual");
  }
  const status = await request("gps diagnostico estructura", "/api/v1/vehiculos/gps/status", { headers: auth });
  if (!status?.counts || typeof status.counts !== "object") {
    throw new Error("gps diagnostico estructura: falta counts");
  }
  for (const key of ["total", "activos", "enlazados", "pendientes", "senal_reciente", "sin_senal_reciente"]) {
    if (!Object.prototype.hasOwnProperty.call(status.counts, key)) {
      throw new Error(`gps diagnostico estructura: falta counts.${key}`);
    }
  }
  if (!Array.isArray(status.providers) || !Array.isArray(status.warnings) || !Array.isArray(status.duplicates) || !Array.isArray(status.stale_vehicles)) {
    throw new Error("gps diagnostico estructura: arrays de diagnostico incompletos");
  }
  if (!status.signal_help || typeof status.signal_help.recent_window_hours !== "number") {
    throw new Error("gps diagnostico estructura: falta ayuda de senal");
  }
}

function assertNoIntegrationSecrets(value, path = "integraciones") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (["api_key", "encrypted_key", "token_hash", "smtp_pass", "stripe_secret"].includes(lower)) {
      throw new Error(`${path}: expone campo sensible ${key}`);
    }
    assertNoIntegrationSecrets(child, `${path}.${key}`);
  }
}

async function checkIntegracionesEmpresa(auth) {
  const data = await request("integraciones empresa estructura", "/api/v1/empresa/integraciones/status", { headers: auth });
  for (const key of ["routing", "gps", "ia", "smtp", "stripe", "firma", "edi_api", "edi_feed", "resumen"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`integraciones empresa estructura: falta ${key}`);
    }
  }
  if (!data.routing.here || !data.routing.ors || typeof data.routing.ready !== "boolean") {
    throw new Error("integraciones empresa estructura: routing incompleto");
  }
  for (const provider of ["here", "ors"]) {
    for (const key of ["provider", "configured", "company_configured", "global_configured", "use_global", "activo", "limite_mensual", "usos_mes", "masked"]) {
      if (!Object.prototype.hasOwnProperty.call(data.routing[provider], key)) {
        throw new Error(`integraciones empresa estructura: falta routing.${provider}.${key}`);
      }
    }
  }
  if (!Array.isArray(data.gps.providers) || !Array.isArray(data.ia.providers)) {
    throw new Error("integraciones empresa estructura: gps/ia providers no son arrays");
  }
  if (!Array.isArray(data.firma.providers) || !Array.isArray(data.firma.checks) || !Array.isArray(data.firma.faltantes)) {
    throw new Error("integraciones empresa estructura: firma incompleta");
  }
  for (const key of ["target", "mode", "ready", "production_ready", "siguiente_accion", "legal_note"]) {
    if (!Object.prototype.hasOwnProperty.call(data.firma, key)) {
      throw new Error(`integraciones empresa estructura: falta firma.${key}`);
    }
  }
  if (typeof data.firma.ready !== "boolean" || typeof data.firma.production_ready !== "boolean") {
    throw new Error("integraciones empresa estructura: firma readiness invalido");
  }
  if (!Array.isArray(data.edi_api.checks) || !Array.isArray(data.edi_api.faltantes) || !Array.isArray(data.edi_api.recomendaciones)) {
    throw new Error("integraciones empresa estructura: edi_api incompleto");
  }
  for (const key of ["target", "mode", "ready", "production_ready", "score", "metrics", "siguiente_accion", "legal_note"]) {
    if (!Object.prototype.hasOwnProperty.call(data.edi_api, key)) {
      throw new Error(`integraciones empresa estructura: falta edi_api.${key}`);
    }
  }
  if (typeof data.edi_api.ready !== "boolean" || typeof data.edi_api.production_ready !== "boolean" || typeof data.edi_api.score !== "number") {
    throw new Error("integraciones empresa estructura: edi_api readiness invalido");
  }
  for (const key of ["target", "active", "total_exports_sample", "clientes_distintos_sample", "last_export_at", "recent", "governance"]) {
    if (!Object.prototype.hasOwnProperty.call(data.edi_feed || {}, key)) {
      throw new Error(`integraciones empresa estructura: falta edi_feed.${key}`);
    }
  }
  if (typeof data.edi_feed.active !== "boolean" || !Array.isArray(data.edi_feed.recent)) {
    throw new Error("integraciones empresa estructura: edi_feed invalido");
  }
  if (data.edi_feed.governance?.includes_binary_content !== false || data.edi_feed.governance?.includes_secrets !== false) {
    throw new Error("integraciones empresa estructura: edi_feed governance invalido");
  }
  const feedRow = data.edi_feed.recent[0];
  if (feedRow) {
    for (const key of ["export_id", "cliente_id", "created_at", "window_days", "shipments", "invoices", "documents", "integrity_hash_sha256", "status"]) {
      if (!Object.prototype.hasOwnProperty.call(feedRow, key)) {
        throw new Error(`integraciones empresa estructura: falta edi_feed.recent.${key}`);
      }
    }
  }
  if (typeof data.smtp.configured !== "boolean" || typeof data.stripe.configured !== "boolean") {
    throw new Error("integraciones empresa estructura: smtp/stripe incompletos");
  }
  for (const key of ["routing", "gps", "ia", "smtp", "stripe", "firma", "edi_api", "edi_feed"]) {
    if (typeof data.resumen[key] !== "boolean") {
      throw new Error(`integraciones empresa estructura: falta resumen.${key}`);
    }
  }
  assertNoIntegrationSecrets(data);
}

async function checkPuestaMarchaEmpresa(auth) {
  const data = await request("puesta marcha empresa estructura", "/api/v1/empresa/puesta-marcha", { headers: auth });
  for (const key of ["generated_at", "objetivo", "resumen", "metricas", "checks", "acciones_prioritarias", "backup"]) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw new Error(`puesta marcha empresa estructura: falta ${key}`);
    }
  }
  if (!Array.isArray(data.checks) || !Array.isArray(data.acciones_prioritarias)) {
    throw new Error("puesta marcha empresa estructura: checks/acciones no son arrays");
  }
  for (const key of ["score", "estado", "listo_para_operar", "bloqueantes", "avisos", "checks_ok", "checks_total", "producto_operativo_vendible_estimado"]) {
    if (!Object.prototype.hasOwnProperty.call(data.resumen || {}, key)) {
      throw new Error(`puesta marcha empresa estructura: falta resumen.${key}`);
    }
  }
  if (!["listo", "vigilancia", "bloqueado"].includes(String(data.resumen.estado || ""))) {
    throw new Error("puesta marcha empresa estructura: estado invalido");
  }
  if (typeof data.resumen.listo_para_operar !== "boolean") {
    throw new Error("puesta marcha empresa estructura: listo_para_operar invalido");
  }
  for (const key of ["usuarios", "gerentes", "clientes", "vehiculos", "choferes", "colaboradores", "pedidos_60d", "facturas", "entregados_sin_soporte", "backup_solicitudes", "backups_pendientes", "backups_resueltos"]) {
    if (!Object.prototype.hasOwnProperty.call(data.metricas || {}, key)) {
      throw new Error(`puesta marcha empresa estructura: falta metricas.${key}`);
    }
  }
  for (const key of ["solicitado", "solicitudes", "pendientes", "resueltos", "gestion"]) {
    if (!Object.prototype.hasOwnProperty.call(data.backup || {}, key)) {
      throw new Error(`puesta marcha empresa estructura: falta backup.${key}`);
    }
  }
  if (typeof data.backup.solicitado !== "boolean") {
    throw new Error("puesta marcha empresa estructura: backup.solicitado invalido");
  }
  if (!data.checks.some(c => c?.key === "backup_go_live")) {
    throw new Error("puesta marcha empresa estructura: falta check backup_go_live");
  }
  const check = data.checks[0];
  if (check) {
    for (const key of ["key", "area", "label", "ok", "required", "weight", "detail", "action"]) {
      if (!Object.prototype.hasOwnProperty.call(check || {}, key)) {
        throw new Error(`puesta marcha empresa estructura: falta check.${key}`);
      }
    }
  }
  const informe = await fetchRaw("puesta marcha empresa informe HTML", "/api/v1/empresa/puesta-marcha/informe", { headers: auth });
  const disposition = informe.res.headers.get("content-disposition") || "";
  if (!disposition.toLowerCase().includes("attachment") || !informe.text.includes("Informe de puesta en marcha") || !informe.text.includes("Checklist operativo")) {
    throw new Error("puesta marcha empresa informe HTML: descarga incompleta");
  }

  const jornada = await request("jornada diaria empresa estructura", "/api/v1/empresa/jornada-diaria", { headers: auth });
  for (const key of ["generated_at", "objetivo", "resumen", "metricas", "importes", "checks", "acciones_prioritarias"]) {
    if (!Object.prototype.hasOwnProperty.call(jornada || {}, key)) {
      throw new Error(`jornada diaria empresa estructura: falta ${key}`);
    }
  }
  for (const key of ["score", "estado", "listo_para_jornada", "bloqueantes", "avisos", "checks_ok", "checks_total"]) {
    if (!Object.prototype.hasOwnProperty.call(jornada.resumen || {}, key)) {
      throw new Error(`jornada diaria empresa estructura: falta resumen.${key}`);
    }
  }
  if (!["listo", "atencion", "bloqueado"].includes(String(jornada.resumen.estado || ""))) {
    throw new Error("jornada diaria empresa estructura: estado invalido");
  }
  if (typeof jornada.resumen.listo_para_jornada !== "boolean") {
    throw new Error("jornada diaria empresa estructura: listo_para_jornada invalido");
  }
  for (const key of ["cargas_hoy", "descargas_hoy", "viajes_activos", "vencidos", "incidencias", "sin_asignacion", "sin_precio", "margen_negativo", "entregados_sin_soporte", "cobros_riesgo", "cobros_revisar_hoy", "pagos_colaborador_vencidos", "facturas_colaborador_pendientes", "fiscal_atascado"]) {
    if (!Object.prototype.hasOwnProperty.call(jornada.metricas || {}, key)) {
      throw new Error(`jornada diaria empresa estructura: falta metricas.${key}`);
    }
  }
  for (const key of ["cobro_riesgo", "pago_colaborador_pendiente"]) {
    if (!Object.prototype.hasOwnProperty.call(jornada.importes || {}, key)) {
      throw new Error(`jornada diaria empresa estructura: falta importes.${key}`);
    }
  }
  if (!Array.isArray(jornada.checks) || !jornada.checks.some(c => c?.key === "trafico_vencido")) {
    throw new Error("jornada diaria empresa estructura: falta check trafico_vencido");
  }
  const informeJornada = await fetchRaw("jornada diaria empresa informe HTML", "/api/v1/empresa/jornada-diaria/informe", { headers: auth });
  const dispositionJornada = informeJornada.res.headers.get("content-disposition") || "";
  if (!dispositionJornada.toLowerCase().includes("attachment") || !informeJornada.text.includes("Informe de jornada diaria") || !informeJornada.text.includes("Checks diarios")) {
    throw new Error("jornada diaria empresa informe HTML: descarga incompleta");
  }
}

async function checkBackupSolicitudes(auth) {
  const solicitudes = await request("backup solicitudes estructura", "/api/v1/backup/solicitudes", { headers: auth });
  if (!Array.isArray(solicitudes)) {
    throw new Error("backup solicitudes estructura: respuesta no es array");
  }
  const solicitud = solicitudes.find(s => s?.id);
  if (solicitud) {
    for (const key of ["id", "motivo", "estado", "filename", "created_at", "resuelto_at"]) {
      if (!Object.prototype.hasOwnProperty.call(solicitud, key)) {
        throw new Error(`backup solicitudes estructura: falta ${key}`);
      }
    }
  } else {
    console.log("OK backup solicitudes sin registros para validar campos");
  }

  await expectStatus("backup raiz bloqueado empresa", "/api/v1/backup", 403, { headers: auth });
  await expectStatus("backup run bloqueado empresa", "/api/v1/backup/run", 403, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });
  await expectStatus("backup download bloqueado empresa", "/api/v1/backup/download/test.sql.gz", 403, { headers: auth });
}

async function checkActividadAuditoria(auth) {
  const actividad = await request("actividad auditoria estructura", "/api/v1/actividad?limit=10", { headers: auth });
  if (!Array.isArray(actividad?.data)) {
    throw new Error("actividad auditoria estructura: data no es array");
  }
  for (const key of ["resumen", "porModulo", "porCriticidad", "totales"]) {
    if (!actividad?.[key] || typeof actividad[key] !== "object") {
      throw new Error(`actividad auditoria estructura: falta ${key}`);
    }
  }
  for (const key of ["registros", "errores", "usuarios", "altas"]) {
    if (!Object.prototype.hasOwnProperty.call(actividad.totales, key)) {
      throw new Error(`actividad auditoria estructura: falta totales.${key}`);
    }
  }
  const row = actividad.data.find(item => item?.id);
  if (row) {
    for (const key of ["method", "path", "modulo", "status", "criticidad", "request_id", "created_at"]) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) {
        throw new Error(`actividad auditoria estructura: falta ${key}`);
      }
    }
  } else {
    console.log("OK actividad auditoria sin registros para validar fila");
  }

  const filtrada = await request("actividad auditoria filtro criticidad", "/api/v1/actividad?criticidad=alta&limit=5", { headers: auth });
  if (!Array.isArray(filtrada?.data) || !filtrada?.totales) {
    throw new Error("actividad auditoria filtro criticidad: respuesta incompleta");
  }
  if (filtrada.data.some(item => item?.criticidad !== "alta")) {
    throw new Error("actividad auditoria filtro criticidad: devuelve criticidad no solicitada");
  }
}

async function checkRouteOptimizer(auth) {
  const providers = await request("optimizador rutas proveedores estructura", "/api/v1/route-optimizer/providers", { headers: auth });
  if (!providers?.active || !providers?.providers || typeof providers.providers !== "object") {
    throw new Error("optimizador rutas proveedores estructura: faltan active/providers");
  }
  if (!providers.providers.local || providers.providers.local.needs_key !== false) {
    throw new Error("optimizador rutas proveedores estructura: falta proveedor local usable");
  }
  for (const [provider, meta] of Object.entries(providers.providers)) {
    for (const key of ["label", "tier", "needs_key", "truck_aware", "configured"]) {
      if (!Object.prototype.hasOwnProperty.call(meta, key)) {
        throw new Error(`optimizador rutas proveedores estructura: falta ${provider}.${key}`);
      }
    }
  }

  await expectStatus("optimizador rutas bloquea paradas insuficientes", "/api/v1/route-optimizer/optimize", 400, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ provider: "local", stops: [{ address: "Madrid" }] }),
  });

  const localMadridValencia = await request("optimizador rutas local gratuito km", "/api/v1/route-optimizer/optimize", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ provider: "local", stops: [{ address: "Madrid" }, { address: "Valencia" }] }),
  });
  if (localMadridValencia?.provider !== "local" || Number(localMadridValencia?.distance_km || 0) < 250) {
    throw new Error("optimizador rutas local gratuito km: no devuelve kilometros utiles");
  }

  const pedidos = asArray(await request("pedidos para rutas", "/api/v1/pedidos?limit=5", { headers: auth }));
  const pedido = pedidos.find(p => p?.id);
  if (!pedido) {
    console.log("OK rutas sin pedidos para validar latest/dispatches");
    return;
  }
  const latest = await request("optimizador rutas ultima por pedido", `/api/v1/route-optimizer/pedido/${encodeURIComponent(pedido.id)}/latest`, { headers: auth });
  if (latest !== null && (!latest.id || !latest.pedido_id)) {
    throw new Error("optimizador rutas ultima por pedido: respuesta inesperada");
  }
  const dispatches = await request("optimizador rutas envios por pedido", `/api/v1/route-optimizer/pedido/${encodeURIComponent(pedido.id)}/dispatches`, { headers: auth });
  if (!Array.isArray(dispatches)) {
    throw new Error("optimizador rutas envios por pedido: respuesta no es array");
  }
  const dispatch = dispatches.find(d => d?.id);
  if (dispatch) {
    for (const key of ["recipient_type", "recipient_email", "status", "route_url", "sent_at", "expires_at"]) {
      if (!Object.prototype.hasOwnProperty.call(dispatch, key)) {
        throw new Error(`optimizador rutas envios por pedido: falta ${key}`);
      }
    }
  }
}

async function checkEmailOperativo(auth) {
  const config = await request("email config estructura", "/api/v1/email/config", { headers: auth });
  for (const key of ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from", "smtp_from_nombre", "reply_to", "activo"]) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) {
      throw new Error(`email config estructura: falta ${key}`);
    }
  }
  if (String(config.smtp_pass || "")) {
    throw new Error("email config estructura: smtp_pass no debe exponerse");
  }
  if (Object.prototype.hasOwnProperty.call(config, "smtp_pass_encrypted")) {
    throw new Error("email config estructura: smtp_pass_encrypted no debe exponerse");
  }
  if (config.smtp_pass_masked && !String(config.smtp_pass_masked).includes("*")) {
    throw new Error("email config estructura: smtp_pass_masked no esta saneado");
  }

  const log = await request("email log estructura", "/api/v1/email/log", { headers: auth });
  if (!Array.isArray(log)) {
    throw new Error("email log estructura: respuesta no es array");
  }
  const item = log.find(row => row?.id);
  if (item) {
    for (const key of ["trigger", "destinatario", "asunto", "estado", "sent_at"]) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) {
        throw new Error(`email log estructura: falta ${key}`);
      }
    }
  }

  await expectStatus("email test bloquea destinatario vacio", "/api/v1/email/test", 400, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });

  const facturas = asArray(await request("facturas para email preflight", "/api/v1/facturas", { headers: auth }));
  const factura = facturas.find(f => f?.id);
  if (!factura) {
    console.log("OK email preflight sin facturas para validar");
    return;
  }
  const preflight = await request("email factura preflight estructura", `/api/v1/email/factura/${encodeURIComponent(factura.id)}/preflight`, { headers: auth });
  if (typeof preflight?.ok !== "boolean" || !Array.isArray(preflight.bloqueantes) || !Array.isArray(preflight.avisos)) {
    throw new Error("email factura preflight estructura: faltan ok/bloqueantes/avisos");
  }
  for (const key of ["adjuntos_estimados", "documentos", "pedidos", "destinatario"]) {
    if (!Object.prototype.hasOwnProperty.call(preflight, key)) {
      throw new Error(`email factura preflight estructura: falta ${key}`);
    }
  }
}

async function checkWhatsappOperativo(auth) {
  const status = await request("whatsapp status estructura", "/api/v1/whatsapp/status", { headers: auth });
  for (const key of ["provider", "configured", "ready", "activo", "mode", "next_action"]) {
    if (!Object.prototype.hasOwnProperty.call(status || {}, key)) {
      throw new Error(`whatsapp status estructura: falta ${key}`);
    }
  }
  if (String(status.access_token || "") || String(status.app_secret || "") || String(status.verify_token || "")) {
    throw new Error("whatsapp status estructura: no debe exponer secretos");
  }
  const log = await request("whatsapp log estructura", "/api/v1/whatsapp/log", { headers: auth });
  if (!Array.isArray(log)) {
    throw new Error("whatsapp log estructura: respuesta no es array");
  }
  const pedidos = asArray(await request("pedidos para whatsapp", "/api/v1/pedidos?limit=20", { headers: auth }));
  const pedido = pedidos.find(p => p?.id && p?.cliente_telefono);
  if (!pedido) {
    console.log("OK whatsapp pedido preflight sin pedido con telefono para validar");
    return;
  }
  const preflight = await request("whatsapp pedido preflight estructura", `/api/v1/whatsapp/pedido/${encodeURIComponent(pedido.id)}/preflight?target=cliente`, { headers: auth });
  if (typeof preflight?.ok !== "boolean" || !Array.isArray(preflight.bloqueantes) || !Array.isArray(preflight.avisos)) {
    throw new Error("whatsapp pedido preflight estructura: faltan ok/bloqueantes/avisos");
  }
  for (const key of ["destinatario", "destinatario_tipo", "has_credentials", "modo"]) {
    if (!Object.prototype.hasOwnProperty.call(preflight, key)) {
      throw new Error(`whatsapp pedido preflight estructura: falta ${key}`);
    }
  }
}

async function checkPuntosInteres(auth) {
  const stamp = Date.now();
  const nombre = `QA Punto ${stamp}`;
  const direccion = `Calle QA ${stamp}, Madrid`;
  const googleMapsUrl = "https://www.google.com/maps?q=40.4168,-3.7038";
  const created = await request("puntos interes crear", "/api/v1/puntos-interes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      nombre,
      direccion,
      ciudad: "Madrid",
      pais: "Espana",
      tipo: "carga",
      google_maps_url: googleMapsUrl,
      contacto_nombre: "QA",
      email: "qa@example.com",
    }),
  });
  if (!created?.id || created.nombre !== nombre || created.google_maps_url !== googleMapsUrl) {
    throw new Error("puntos interes crear: respuesta incompleta");
  }

  const duplicated = await request("puntos interes reutiliza duplicado", "/api/v1/puntos-interes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ nombre: `${nombre} duplicado`, direccion, tipo: "descarga" }),
  });
  if (duplicated?.id !== created.id) {
    throw new Error("puntos interes reutiliza duplicado: no devuelve el punto existente");
  }

  const filtered = await request("puntos interes filtro busqueda", `/api/v1/puntos-interes?q=${encodeURIComponent(nombre)}&tipo=carga`, { headers: auth });
  if (!Array.isArray(filtered) || !filtered.some(p => p.id === created.id && p.google_maps_url === googleMapsUrl)) {
    throw new Error("puntos interes filtro busqueda: no encuentra el punto creado");
  }

  await request("puntos interes borrar", `/api/v1/puntos-interes/${encodeURIComponent(created.id)}`, {
    method: "DELETE",
    headers: auth,
  });
  const afterDelete = await request("puntos interes oculto tras borrar", `/api/v1/puntos-interes?q=${encodeURIComponent(nombre)}`, { headers: auth });
  if (Array.isArray(afterDelete) && afterDelete.some(p => p.id === created.id)) {
    throw new Error("puntos interes oculto tras borrar: el punto sigue activo");
  }
}

async function checkNominasPersonas(auth) {
  const choferes = await request("choferes para nominas", "/api/v1/choferes", { headers: auth });
  const chofer = Array.isArray(choferes) ? choferes.find(c => c?.id) : null;
  if (!chofer) {
    console.log("OK nominas sin choferes para validar emision");
    return;
  }

  const config = await request("nominas config chofer estructura", `/api/v1/empresa/chofer-config/${encodeURIComponent(chofer.id)}`, { headers: auth });
  for (const key of ["salario_base", "precio_noche", "plus_actividad", "incentivo_pct", "irpf_pct", "ss_empresa_pct", "ss_trabajador_pct"]) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) {
      throw new Error(`nominas config chofer estructura: falta ${key}`);
    }
  }

  const actuales = await request("nominas emitidas por chofer", `/api/v1/empresa/nominas-emitidas?chofer_id=${encodeURIComponent(chofer.id)}`, { headers: auth });
  if (!Array.isArray(actuales)) {
    throw new Error("nominas emitidas por chofer: respuesta no es array");
  }
  const used = new Set(actuales.map(n => String(n.periodo || "")));
  const periodo = Array.from({ length: 12 }, (_, i) => `2099-${String(i + 1).padStart(2, "0")}`).find(p => !used.has(p));
  if (!periodo) {
    console.log("OK nominas QA sin periodo libre 2099 para crear");
    return;
  }

  const created = await request("nominas emitir QA", "/api/v1/empresa/nominas-emitidas", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      chofer_id: chofer.id,
      periodo,
      salario_base: 1200,
      plus_actividad: 100,
      horas_extra: 2,
      noches: 1,
      importe_noches: 40,
      ss_empresa: 390,
      ss_trabajador: 82,
      irpf: 95,
      liquido: 1163,
      total_empresa: 1730,
      notas: "QA nomina temporal",
    }),
  });
  if (!created?.id || created.periodo !== periodo || Number(created.liquido || 0) !== 1163) {
    throw new Error("nominas emitir QA: respuesta incompleta");
  }

  try {
    const refreshed = await request("nominas historial incluye QA", `/api/v1/empresa/nominas-emitidas?chofer_id=${encodeURIComponent(chofer.id)}`, { headers: auth });
    if (!Array.isArray(refreshed) || !refreshed.some(n => n.id === created.id && n.periodo === periodo)) {
      throw new Error("nominas historial incluye QA: no aparece la nomina creada");
    }
  } finally {
    await request("nominas borrar QA", `/api/v1/empresa/nominas-emitidas/${encodeURIComponent(created.id)}`, {
      method: "DELETE",
      headers: auth,
    }).catch(err => console.warn(`WARN nominas borrar QA: ${err.message}`));
  }

  const afterDelete = await request("nominas historial limpia QA", `/api/v1/empresa/nominas-emitidas?chofer_id=${encodeURIComponent(chofer.id)}`, { headers: auth });
  if (Array.isArray(afterDelete) && afterDelete.some(n => n.id === created.id)) {
    throw new Error("nominas historial limpia QA: la nomina temporal sigue visible");
  }
}

async function checkSuperadminSaas() {
  let login;
  try {
    login = await request("login superadmin", "/api/v1/superadmin/login", {
      method: "POST",
      body: JSON.stringify({ email: superadminUser, password: superadminPassword }),
    });
  } catch (err) {
    if (/401|403/.test(err.message)) {
      console.log("OK superadmin QA omitida sin credenciales validas");
      return;
    }
    throw err;
  }
  if (!login?.token) throw new Error("login superadmin: no devuelve token");
  const auth = { Authorization: `Bearer ${login.token}` };
  const empresas = await request("superadmin empresas estructura", "/api/v1/superadmin/empresas", { headers: auth });
  if (!Array.isArray(empresas)) throw new Error("superadmin empresas estructura: no devuelve array");
  const ccaa = await request("superadmin calendario ccaa estructura", "/api/v1/superadmin/calendario-laboral/ccaa", { headers: auth });
  if (!Array.isArray(ccaa) || !ccaa.some(c => c.code === "ES-MD")) {
    throw new Error("superadmin calendario ccaa estructura: falta ES-MD");
  }
  if (empresas[0]?.id) {
    const refresh = await request("superadmin calendario refresh estructura", "/api/v1/superadmin/calendario-laboral/refresh", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ year: new Date().getFullYear(), ccaa: "ES-MD", empresa_id: empresas[0].id }),
    });
    if (!refresh?.ok || !Array.isArray(refresh.results) || refresh.results[0]?.holidays_count <= 0) {
      throw new Error("superadmin calendario refresh estructura: respuesta incompleta");
    }
    if (!refresh.ccaa_label || refresh.results[0]?.ccaa_label !== refresh.ccaa_label) {
      throw new Error("superadmin calendario refresh estructura: falta etiqueta de comunidad");
    }
  }
  const salud = await request("superadmin salud estructura", "/api/v1/superadmin/salud", { headers: auth });
  if (!Array.isArray(salud)) {
    throw new Error("superadmin salud estructura: respuesta no es array");
  }
  const empresaSalud = salud.find(e => e?.id);
  if (empresaSalud) {
    for (const key of ["gerentes_activos", "clientes_activos", "vehiculos_activos", "backups_resueltos", "implantacion_score", "implantacion_estado", "implantacion_checks"]) {
      if (!Object.prototype.hasOwnProperty.call(empresaSalud, key)) {
        throw new Error(`superadmin salud estructura: falta ${key}`);
      }
    }
    if (!["critica", "vigilancia", "lista"].includes(String(empresaSalud.implantacion_estado || ""))) {
      throw new Error("superadmin salud estructura: implantacion_estado invalido");
    }
    if (!Array.isArray(empresaSalud.implantacion_checks)) {
      throw new Error("superadmin salud estructura: implantacion_checks no es array");
    }
  }
  const resumen = await request("superadmin salud resumen estructura", "/api/v1/superadmin/salud/resumen", { headers: auth });
  if (!resumen?.resumen || !Array.isArray(resumen.criticas) || !Array.isArray(resumen.avisos)) {
    throw new Error("superadmin salud resumen estructura: respuesta incompleta");
  }
  for (const key of ["total", "activas", "no_activas", "bloqueadas", "vencidas", "vencen_7d", "backups_pendientes", "backups_resueltos", "sin_gerente", "sin_usuarios", "sin_clientes", "sin_actividad_30d", "ia_agotada", "usuarios_activos", "gerentes_activos", "clientes_activos", "pedidos_30d", "por_color"]) {
    if (!Object.prototype.hasOwnProperty.call(resumen.resumen, key)) {
      throw new Error(`superadmin salud resumen estructura: falta resumen.${key}`);
    }
  }
  for (const color of ["verde", "amarillo", "rojo"]) {
    if (!Object.prototype.hasOwnProperty.call(resumen.resumen.por_color, color)) {
      throw new Error(`superadmin salud resumen estructura: falta por_color.${color}`);
    }
  }
  if (!resumen.generated_at) {
    throw new Error("superadmin salud resumen estructura: falta generated_at");
  }
  const informe = await fetchRaw("superadmin salud informe HTML", "/api/v1/superadmin/salud/informe", { headers: auth });
  const disposition = informe.res.headers.get("content-disposition") || "";
  if (!disposition.toLowerCase().includes("attachment") || !informe.text.includes("Informe salud SaaS TransGest") || !informe.text.includes("Implantacion")) {
    throw new Error("superadmin salud informe HTML: descarga incompleta");
  }

  const integracionesSalud = await request("superadmin integraciones salud estructura", "/api/v1/superadmin/integraciones/salud", { headers: auth });
  for (const key of ["generated_at", "app_meta", "resumen", "checks", "providers", "empresas", "acciones_prioritarias"]) {
    if (!Object.prototype.hasOwnProperty.call(integracionesSalud || {}, key)) {
      throw new Error(`superadmin integraciones salud estructura: falta ${key}`);
    }
  }
  for (const key of ["total", "ok", "warnings", "blocked", "score", "estado"]) {
    if (!Object.prototype.hasOwnProperty.call(integracionesSalud.resumen || {}, key)) {
      throw new Error(`superadmin integraciones salud estructura: falta resumen.${key}`);
    }
  }
  if (!Array.isArray(integracionesSalud.checks) || !Array.isArray(integracionesSalud.empresas) || !Array.isArray(integracionesSalud.acciones_prioritarias)) {
    throw new Error("superadmin integraciones salud estructura: arrays incompletos");
  }
  const integrationCheck = integracionesSalud.checks[0];
  if (integrationCheck) {
    for (const key of ["key", "area", "label", "ok", "required", "estado", "detail", "warnings", "action"]) {
      if (!Object.prototype.hasOwnProperty.call(integrationCheck, key)) {
        throw new Error(`superadmin integraciones salud estructura: falta check.${key}`);
      }
    }
  }
  if (!["lista", "vigilancia", "bloqueada"].includes(String(integracionesSalud.resumen.estado || ""))) {
    throw new Error("superadmin integraciones salud estructura: resumen.estado invalido");
  }
  assertNoIntegrationSecrets(integracionesSalud, "superadmin.integraciones.salud");
  const integraciones = await request("superadmin integraciones estructura", "/api/v1/superadmin/integraciones", { headers: auth });
  if (!Array.isArray(integraciones.empresas) || !Array.isArray(integraciones.configs) || !integraciones.ai || !integraciones.global) {
    throw new Error("superadmin integraciones estructura: respuesta incompleta");
  }
  const empresaIntegracion = integraciones.empresas.find(e => e?.id);
  if (empresaIntegracion) {
    for (const key of ["ia_limite_mensual", "ia_usos_mes", "ia_periodo_mes"]) {
      if (!Object.prototype.hasOwnProperty.call(empresaIntegracion, key)) {
        throw new Error(`superadmin integraciones estructura: falta empresa.${key}`);
      }
    }
  }
  assertNoIntegrationSecrets(integraciones, "superadmin.integraciones");
}

async function run() {
  await expectStatus("api protegida sin token", "/api/v1/pedidos?limit=1", 401);

  const login = await request("login gerente", "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: user, password }),
  });
  if (!login?.token) throw new Error("login gerente: no devuelve token");
  const auth = { Authorization: `Bearer ${login.token}` };

  const checks = [
    ["usuario actual", "/api/v1/auth/me"],
    ["pedidos", "/api/v1/pedidos?limit=5"],
    ["vehiculos alertas", "/api/v1/vehiculos/alertas-doc"],
    ["documentos por vencer", "/api/v1/docs/proximos-vencer"],
    ["facturas", "/api/v1/facturas"],
    ["nominas emitidas", "/api/v1/empresa/nominas-emitidas"],
    ["objetivos KPI", "/api/v1/empresa/objetivos"],
    ["estado taller", "/api/v1/taller/estado"],
    ["excepciones operativas", "/api/v1/informes/excepciones"],
    ["solicitudes portal admin", "/api/v1/portal-cliente/admin/solicitudes?estado=pendiente"],
    ["colaboradores pendientes revision", "/api/v1/colaboradores/pendientes-revision"],
    ["agenda", "/api/v1/agenda"],
    ["solicitudes backup", "/api/v1/backup/solicitudes"],
    ["actividad auditoria", "/api/v1/actividad?limit=5"],
    ["optimizador rutas proveedores", "/api/v1/route-optimizer/providers"],
    ["email config", "/api/v1/email/config"],
    ["email log", "/api/v1/email/log"],
    ["puntos interes", "/api/v1/puntos-interes"],
    ["choferes", "/api/v1/choferes"],
  ];

  for (const [name, path] of checks) {
    await request(name, path, { headers: auth });
  }

  await expectStatus("portal cliente bloqueado a gerente", "/api/v1/portal-cliente/pedidos", 403, { headers: auth });
  await expectStatus("capital tesoreria bloquea superadmin invalido", "/api/v1/empresa/config/tesoreria/capital", 403, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      capital_actual: 1,
      gerente_confirmacion: "CAMBIAR CAPITAL",
      superadmin_email: "nadie@example.com",
      superadmin_password: "x",
    }),
  });
  await checkExcepcionesOperativas(auth);
  await checkGestionKpi(auth);
  await checkControlTower(auth);
  await checkCopilotoOperativo(auth);
  await checkCalendarioLaboral(auth);
  await checkRutasTarifasMinimos(auth);
  await checkPedidoToneladaNormalizacion(auth);
  await checkPedidoKmRutaYSaneadoParadas(auth);
  await checkPedidoAiInbox(auth);
  await checkDocumentoControlDigital(auth);
  await checkRentabilidadPredictiva(auth);
  await checkIdaRetornoPedidos(auth);
  await checkUsuariosTraficoScope(auth);
  await checkColaboradorRevisionNotificaciones(auth);
  await checkAvisoClientePedido(auth);
  await checkFirmaEvidenciaPedido(auth);
  await checkRentabilidadOperativa(auth);
  await checkCargasRetorno(auth);
  await checkScoringOperativo(auth);
  await checkEmisionesOperativas(auth);
  await checkDatosMaestrosReadiness(auth);
  await checkCumplimientoEuropeo(auth);
  await checkFiscalConfig(auth);
  await checkCashflowOperativo(auth);
  await checkGpsDiagnostico(auth);
  await checkIntegracionesEmpresa(auth);
  await checkPuestaMarchaEmpresa(auth);
  await checkBackupSolicitudes(auth);
  await checkActividadAuditoria(auth);
  await checkRouteOptimizer(auth);
  await checkEmailOperativo(auth);
  await checkWhatsappOperativo(auth);
  await checkPuntosInteres(auth);
  await checkNominasPersonas(auth);
  await checkPortalSolicitudesAdmin(auth);
  await checkPortalClienteOperativo(auth);
  await checkAlmacenPalets(auth);
  await checkColaboradorPublicLink(auth);
  await checkSuperadminSaas();
}

run().catch(err => {
  console.error("FUNCTIONAL FAIL:", err.message);
  process.exitCode = 1;
});
