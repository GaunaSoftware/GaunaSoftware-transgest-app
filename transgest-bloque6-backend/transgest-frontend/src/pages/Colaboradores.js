import React, { useState, useEffect, useCallback } from "react";
import { getColaboradores, crearColaborador, editarColaborador,
         borrarColaborador,
         getColaboradorVehiculos, crearColaboradorVehiculo, editarColaboradorVehiculo, borrarColaboradorVehiculo,
         getColaboradorHistorial, getColaboradorFacturas, crearColaboradorFactura, editarColaboradorFactura,
         getColaboradorPagos, crearColaboradorPago, borrarColaboradorPago,
         getColaboradorDocumentos, crearColaboradorDocumento, borrarColaboradorDocumento,
         getColaboradorAccionesPendientes, descargarColaboradorInformeAcciones,
         marcarColaboradorRevisado, crearColaboradorLiquidacionToken, getColaboradorLiquidacionTokens,
         revocarColaboradorLiquidacionToken, enviarColaboradorLiquidacionEmail,
         revisarAlertasLiquidacionesColaboradores } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";
import { readRuntimeFocus, clearRuntimeFocus } from "../services/runtimeFocus";
import { GeoFields } from "../components/GeoFields";

const S={
  page:{flex:1,padding:"24px 28px"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,marginBottom:16,color:"var(--text)"},
  btn:{padding:"8px 16px",borderRadius:7,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  inp:{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"8px 12px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
  lbl:{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:12},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16},
  mbox:{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:24,width:"min(600px,96vw)",maxHeight:"92vh",overflowY:"auto"},
  card:{background:"var(--card-bg, var(--bg2))",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"},
  th:{textAlign:"left",padding:"9px 14px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text4)",borderBottom:"1px solid var(--border)",background:"var(--bg3)"},
  td:{padding:"10px 14px",borderBottom:"1px solid var(--border)",fontSize:13,color:"var(--text)"},
};

const estVenc = (fecha) => {
  if (!fecha) return null;
  const dias = Math.ceil((new Date(fecha) - new Date()) / 86400000);
  if (dias < 0)  return { color:"#ef4444", label:"CADUCADO" };
  if (dias < 30) return { color:"#f97316", label:`${dias}d` };
  if (dias < 90) return { color:"#fbbf24", label:`${dias}d` };
  return { color:"#10b981", label:`${dias}d` };
};

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtDate = fecha => fecha ? new Date(fecha + (String(fecha).includes("T") ? "" : "T12:00:00")).toLocaleDateString("es-ES") : "-";
const orderRef = p => p?.referencia_orden || p?.referencia_busqueda || p?.referencia_cliente || (p?.id ? String(p.id).slice(0,8).toUpperCase() : "");
const IVA_OPCIONES = [
  { value:"general", label:"IVA 21%", pct:21 },
  { value:"reducido", label:"IVA reducido 10%", pct:10 },
  { value:"superreducido", label:"IVA superreducido 4%", pct:4 },
  { value:"cero", label:"IVA 0%", pct:0 },
  { value:"exento", label:"Exento de IVA", pct:0 },
];
const ivaOption = (tipoIva, regimen) => {
  const reg = String(regimen || "").toLowerCase();
  if (IVA_OPCIONES.some(o => o.value === reg)) return IVA_OPCIONES.find(o => o.value === reg);
  const pct = Number(tipoIva);
  return IVA_OPCIONES.find(o => o.pct === pct && o.value !== "exento") || IVA_OPCIONES[0];
};
const ivaLabel = (tipoIva, regimen) => ivaOption(tipoIva, regimen).label;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function facturaNumero(f) {
  return f?.numero_factura || f?.["n\u00famero_factura"] || f?.num_factura || "";
}

function diasHasta(fecha) {
  if (!fecha) return null;
  const d = new Date(String(fecha).slice(0,10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const hoy = new Date();
  hoy.setHours(12,0,0,0);
  return Math.ceil((d.getTime() - hoy.getTime()) / 86400000);
}

function estadoPagosProveedor({ facturas = [], pagos = [] } = {}) {
  const pendientes = facturas.filter(f => !["pagada","pagado"].includes(String(f.estado || "").toLowerCase()));
  const totalFacturasPendientes = pendientes.reduce((s,f)=>s+Number(f.total || 0),0);
  const totalPagosPendientes = pagos.filter(p => String(p.estado || "") !== "pagado").reduce((s,p)=>s+Number(p.importe || 0),0);
  const vencidas = pendientes.filter(f => {
    const dias = diasHasta(f.vencimiento);
    return dias !== null && dias < 0;
  });
  const proximas = pendientes.filter(f => {
    const dias = diasHasta(f.vencimiento);
    return dias !== null && dias >= 0 && dias <= 7;
  });
  const sinVencimiento = pendientes.filter(f => !f.vencimiento);
  const sinNumero = facturas.filter(f => !facturaNumero(f));
  return { pendientes, vencidas, proximas, sinVencimiento, sinNumero, totalFacturasPendientes, totalPagosPendientes, totalRiesgo: totalFacturasPendientes + totalPagosPendientes };
}

function estadoDocumentoColaborador(doc = {}) {
  const dias = diasHasta(doc.caducidad);
  if (dias === null) return { label:"Sin caducidad", color:"#b45309", cls:"amber", dias:null };
  if (dias < 0) return { label:"Caducado", color:"#dc2626", cls:"red", dias };
  if (dias <= 30) return { label:`${dias} dias`, color:"#b45309", cls:"amber", dias };
  return { label:`${dias} dias`, color:"#047857", cls:"green", dias };
}

function buildLiquidacionColaboradorHtml({ colaborador = {}, viajes = [], facturas = [], pagos = [], documentos = [] } = {}) {
  const generated = new Date().toLocaleString("es-ES");
  const money = value => `${Number(value || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
  const totalViajes = viajes.reduce((s, p) => s + Number(p.importe_colaborador || p.precio_colaborador || 0), 0);
  const totalFacturado = facturas.reduce((s, f) => s + Number(f.total || 0), 0);
  const totalPagado = pagos.filter(p => String(p.estado || "") === "pagado").reduce((s, p) => s + Number(p.importe || 0), 0);
  const pendientePago = Math.max(0, totalFacturado - totalPagado);
  const pendienteFactura = Math.max(0, totalViajes - totalFacturado);
  const estadoProveedor = estadoPagosProveedor({ facturas, pagos });
  const docsCaducados = documentos.filter(d => estadoDocumentoColaborador(d).dias !== null && estadoDocumentoColaborador(d).dias < 0);
  const docsProximos = documentos.filter(d => {
    const dias = estadoDocumentoColaborador(d).dias;
    return dias !== null && dias >= 0 && dias <= 30;
  });
  const viajeRows = viajes.map(v => `<tr>
    <td>${escapeHtml(orderRef(v) || "-")}</td>
    <td>${escapeHtml(fmtDate(v.fecha_carga))}</td>
    <td>${escapeHtml([v.origen, v.destino].filter(Boolean).join(" -> ") || "-")}</td>
    <td>${escapeHtml(v.cliente_nombre || "-")}</td>
    <td class="money">${escapeHtml(money(v.importe_colaborador || v.precio_colaborador))}</td>
  </tr>`).join("");
  const facturaRows = facturas.map(f => `<tr>
    <td>${escapeHtml(facturaNumero(f) || "Sin numero")}</td>
    <td>${escapeHtml(f.referencia_orden || f.referencia_cliente || "-")}</td>
    <td>${escapeHtml(fmtDate(f.fecha))}</td>
    <td>${escapeHtml(fmtDate(f.vencimiento))}</td>
    <td>${escapeHtml(f.estado || "-")}</td>
    <td class="money">${escapeHtml(money(f.total))}</td>
  </tr>`).join("");
  const pagoRows = pagos.map(p => `<tr>
    <td>${escapeHtml(fmtDate(p.fecha))}</td>
    <td>${escapeHtml(p.concepto || "-")}</td>
    <td>${escapeHtml(p.estado || "-")}</td>
    <td>${escapeHtml(p.notas || "")}</td>
    <td class="money">${escapeHtml(money(p.importe))}</td>
  </tr>`).join("");
  const documentoRows = documentos.map(d => {
    const estado = estadoDocumentoColaborador(d);
    return `<tr>
      <td>${escapeHtml(d.nombre || "-")}</td>
      <td>${escapeHtml(d.tipo || "-")}</td>
      <td>${escapeHtml(fmtDate(d.caducidad))}</td>
      <td class="${estado.cls}">${escapeHtml(estado.label)}</td>
      <td>${escapeHtml(d.notas || "")}</td>
    </tr>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Liquidacion colaborador</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:1080px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      h2{font-size:16px;margin:22px 0 8px}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:16px 0}
      .box{border:1px solid #e5e7eb;border-radius:9px;background:#f8fafc;padding:12px}.metric{font-size:20px;font-weight:800}.muted{font-size:11px;color:#64748b;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}.money{text-align:right;font-weight:800}
      .green{color:#047857}.amber{color:#b45309}.red{color:#dc2626}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Liquidacion de colaborador</h1>
      <div class="sub">${escapeHtml(colaborador.nombre || "Colaborador")} - generado el ${escapeHtml(generated)} desde TransGest.</div>
      <div class="grid">
        <div class="box"><div class="metric amber">${escapeHtml(money(totalViajes))}</div><div class="muted">A pagar por viajes</div></div>
        <div class="box"><div class="metric green">${escapeHtml(money(totalFacturado))}</div><div class="muted">Facturas recibidas</div></div>
        <div class="box"><div class="metric green">${escapeHtml(money(totalPagado))}</div><div class="muted">Pagado registrado</div></div>
        <div class="box"><div class="metric ${pendientePago > 0 ? "red" : "green"}">${escapeHtml(money(pendientePago))}</div><div class="muted">Pendiente de pago</div></div>
        <div class="box"><div class="metric ${pendienteFactura > 0 ? "amber" : "green"}">${escapeHtml(money(pendienteFactura))}</div><div class="muted">Pendiente de factura</div></div>
        <div class="box"><div class="metric ${estadoProveedor.vencidas.length ? "red" : "green"}">${estadoProveedor.vencidas.length}</div><div class="muted">Facturas vencidas proveedor</div></div>
        <div class="box"><div class="metric ${estadoProveedor.proximas.length ? "amber" : "green"}">${estadoProveedor.proximas.length}</div><div class="muted">Vencen en 7 dias</div></div>
        <div class="box"><div class="metric ${docsCaducados.length ? "red" : docsProximos.length ? "amber" : "green"}">${documentos.length}</div><div class="muted">Documentos registrados</div></div>
        <div class="box"><div class="metric ${docsCaducados.length ? "red" : "green"}">${docsCaducados.length}</div><div class="muted">Documentos caducados</div></div>
      </div>
      <h2>Viajes del periodo/listado</h2>
      <table><thead><tr><th>Referencia</th><th>Fecha</th><th>Ruta</th><th>Cliente</th><th class="money">Importe</th></tr></thead><tbody>${viajeRows || "<tr><td colspan='5'>Sin viajes.</td></tr>"}</tbody></table>
      <h2>Facturas recibidas</h2>
      <table><thead><tr><th>Factura</th><th>Referencia</th><th>Fecha</th><th>Vencimiento</th><th>Estado</th><th class="money">Total</th></tr></thead><tbody>${facturaRows || "<tr><td colspan='6'>Sin facturas recibidas.</td></tr>"}</tbody></table>
      <h2>Pagos registrados</h2>
      <table><thead><tr><th>Fecha</th><th>Concepto</th><th>Estado</th><th>Notas</th><th class="money">Importe</th></tr></thead><tbody>${pagoRows || "<tr><td colspan='5'>Sin pagos registrados.</td></tr>"}</tbody></table>
      <h2>Documentacion registrada</h2>
      <table><thead><tr><th>Documento</th><th>Tipo</th><th>Caducidad</th><th>Estado</th><th>Notas</th></tr></thead><tbody>${documentoRows || "<tr><td colspan='5'>Sin documentacion registrada.</td></tr>"}</tbody></table>
    </main></body></html>`;
}

function ModalFacturaColab({ colaborador, viaje, factura, onClose, onSaved }) {
  const importe = Number(factura?.base || viaje?.importe_colaborador || viaje?.precio_colaborador || 0);
  const ivaInicial = ivaOption(factura?.iva_pct ?? colaborador?.tipo_iva, factura?.iva_regimen ?? colaborador?.iva_regimen);
  const [form, setForm] = useState({
    pedido_id: viaje?.id || "",
    referencia_orden: factura?.referencia_orden || orderRef(viaje),
    número_factura: factura?.número_factura || "",
    fecha: factura?.fecha ? String(factura.fecha).slice(0,10) : new Date().toISOString().slice(0,10),
    vencimiento: factura?.vencimiento ? String(factura.vencimiento).slice(0,10) : "",
    base: importe ? importe.toFixed(2) : "",
    iva_pct: String(ivaInicial.pct),
    iva_regimen: ivaInicial.value,
    total: factura?.total ? Number(factura.total).toFixed(2) : (importe ? (importe * (1 + ivaInicial.pct / 100)).toFixed(2) : ""),
    estado: factura?.estado || "pendiente",
    notas: factura?.notas || "",
  });
  const [saving, setSaving] = useState(false);
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const recalcular = (base, iva) => {
    const b = Number(base || 0);
    const pct = Number(iva || 0);
    return Number.isFinite(b) ? (b * (1 + pct / 100)).toFixed(2) : "";
  };

  function onBase(e) {
    const base = e.target.value;
    setForm(p=>({...p,base,total:recalcular(base,p.iva_pct)}));
  }
  function onIva(e) {
    const opt = IVA_OPCIONES.find(o => o.value === e.target.value) || IVA_OPCIONES[0];
    setForm(p=>({...p,iva_regimen:opt.value,iva_pct:String(opt.pct),total:recalcular(p.base,opt.pct)}));
  }

  async function guardar() {
    if (!form.referencia_orden) { notify("Referencia de orden obligatoria", "warning"); return; }
    if (!form.número_factura) { notify("Número de factura obligatorio", "warning"); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        pedido_id: form.pedido_id || null,
        base: Number(form.base || 0),
        iva_pct: Number(form.iva_pct || 0),
        iva_regimen: form.iva_regimen || "general",
        total: Number(form.total || 0),
      };
      if (factura?.id) await editarColaboradorFactura(colaborador.id, factura.id, payload);
      else await crearColaboradorFactura(colaborador.id, payload);
      onSaved();
    } catch(e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{...S.mbox,width:"min(640px,96vw)"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:17,color:"var(--text)",marginBottom:4}}>
          {factura?.id ? "Completar factura recibida" : "Registrar factura recibida"}
        </div>
        <div style={{fontSize:12,color:"var(--text4)",marginBottom:16}}>
          {colaborador.nombre} - {form.referencia_orden}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <div><label style={S.lbl}>Referencia orden</label><input style={S.inp} value={form.referencia_orden} onChange={f("referencia_orden")}/></div>
          <div><label style={S.lbl}>Número factura proveedor *</label><input style={S.inp} value={form.número_factura} onChange={f("número_factura")} placeholder="FAC-2026-001"/></div>
          <div><label style={S.lbl}>Fecha factura</label><input type="date" style={S.inp} value={form.fecha} onChange={f("fecha")}/></div>
          <div><label style={S.lbl}>Vencimiento</label><input type="date" style={S.inp} value={form.vencimiento||""} onChange={f("vencimiento")}/></div>
          <div><label style={S.lbl}>Base imponible</label><input type="number" step="0.01" style={S.inp} value={form.base} onChange={onBase}/></div>
          <div><label style={S.lbl}>IVA colaborador</label><select style={S.inp} value={form.iva_regimen || "general"} onChange={onIva}>{IVA_OPCIONES.map(opt=><option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
          <div><label style={S.lbl}>Total factura</label><input type="number" step="0.01" style={S.inp} value={form.total} onChange={f("total")}/></div>
          <div><label style={S.lbl}>Estado</label><select style={S.inp} value={form.estado} onChange={f("estado")}><option value="pendiente">Pendiente</option><option value="recibida">Recibida</option><option value="pagada">Pagada</option><option value="incidencia">Incidencia</option></select></div>
          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Notas</label><textarea style={{...S.inp,minHeight:70,resize:"vertical"}} value={form.notas} onChange={f("notas")} placeholder="Observaciones de pago, albaranes o incidencia"/></div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text4)"}}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:saving?.7:1}}>
            {saving ? "Guardando..." : "Guardar factura"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal vehiculo colaborador ────────────────────────────────────────────
function ModalVehiculoColab({ colaboradorId, editando, onClose, onSaved }) {
  const [form, setForm] = useState(editando ? {...editando} : {
    matricula:"", marca:"", modelo:"", año:"", tipo:"Camión",
    tara_kg:"", carga_max_kg:"", bastidor:"", num_ejes:2, longitud_m:"", notas:"",
    doc_tarjeta_transp:"", doc_tarjeta_exp:"", doc_seguro_venc:"", doc_itv_venc:"", doc_tacografo_venc:"",
  });
  const [saving, setSaving] = useState(false);
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));

  async function guardar() {
    if (!form.matricula.trim()) { notify("La matricula es obligatoria", "warning"); return; }
    setSaving(true);
    try {
      if (editando) await editarColaboradorVehiculo(colaboradorId, editando.id, form);
      else          await crearColaboradorVehiculo(colaboradorId, form);
      onSaved();
    } catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  const Sec = ({titulo}) => <div style={{gridColumn:"1/-1",borderTop:"1px solid var(--border2)",paddingTop:4,marginTop:8,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--accent)"}}>{titulo}</div>;

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.mbox}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:17,color:"var(--text)",marginBottom:4}}>
          {editando?"Editar vehiculo":"Añadir vehiculo al colaborador"}
        </div>
        <div style={{fontSize:12,color:"var(--text4)",marginBottom:16}}>Los datos quedan guardados en la ficha del colaborador.</div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <Sec titulo="Identificación"/>
          <div><label style={S.lbl}>Matricula *</label><input style={S.inp} value={form.matricula} onChange={f("matricula")} placeholder="1234-ABC"/></div>
          <div><label style={S.lbl}>Tipo</label>
            <select style={S.inp} value={form.tipo} onChange={f("tipo")}>
              {["Camión","Tractora","Remolque","Semirremolque","Furgón","Furgoneta"].map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label style={S.lbl}>Marca</label><input style={S.inp} value={form.marca} onChange={f("marca")}/></div>
          <div><label style={S.lbl}>Modelo</label><input style={S.inp} value={form.modelo} onChange={f("modelo")}/></div>
          <div><label style={S.lbl}>Año</label><input type="number" style={S.inp} value={form.año} onChange={f("año")} min="1990" max="2030"/></div>
          <div><label style={S.lbl}>Bastidor (VIN)</label><input style={S.inp} value={form.bastidor} onChange={f("bastidor")}/></div>

          <Sec titulo="Especificaciones"/>
          <div><label style={S.lbl}>Tara (kg)</label><input type="number" style={S.inp} value={form.tara_kg} onChange={f("tara_kg")}/></div>
          <div><label style={S.lbl}>Carga máxima (kg)</label><input type="number" style={S.inp} value={form.carga_max_kg} onChange={f("carga_max_kg")}/></div>
          <div><label style={S.lbl}>Nº ejes</label><input type="number" style={S.inp} value={form.num_ejes} onChange={f("num_ejes")} min="1" max="6"/></div>
          <div><label style={S.lbl}>Longitud (m)</label><input type="number" step="0.1" style={S.inp} value={form.longitud_m} onChange={f("longitud_m")}/></div>

          <Sec titulo="Documentación - fechas de vencimiento"/>
          <div><label style={S.lbl}>Tarjeta transporte nº</label><input style={S.inp} value={form.doc_tarjeta_transp} onChange={f("doc_tarjeta_transp")}/></div>
          <div><label style={S.lbl}>Tarjeta transp. vence</label><input type="date" style={S.inp} value={form.doc_tarjeta_exp||""} onChange={f("doc_tarjeta_exp")}/></div>
          <div><label style={S.lbl}>Seguro vence</label><input type="date" style={S.inp} value={form.doc_seguro_venc||""} onChange={f("doc_seguro_venc")}/></div>
          <div><label style={S.lbl}>ITV vence</label><input type="date" style={S.inp} value={form.doc_itv_venc||""} onChange={f("doc_itv_venc")}/></div>
          <div><label style={S.lbl}>Tacógrafo vence</label><input type="date" style={S.inp} value={form.doc_tacografo_venc||""} onChange={f("doc_tacografo_venc")}/></div>
          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Notas</label><textarea style={{...S.inp,resize:"vertical",minHeight:60}} value={form.notas} onChange={f("notas")}/></div>
        </div>

        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text4)"}}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:saving?.7:1}}>
            {saving?"Guardando...":"Guardar vehiculo"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab vehiculos del colaborador ─────────────────────────────────────────
function TabVehiculos({ colaborador, canEdit }) {
  const [vehiculos, setVehiculos] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(false);
  const [editando, setEditando] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const _t = (p,ms=8000) => Promise.race([p, new Promise(r=>setTimeout(()=>r([]),ms))]);
      const d = await _t(getColaboradorVehiculos(colaborador.id).catch(()=>[]));
      setVehiculos(Array.isArray(d)?d:[]);
    }
    catch(e) { setVehiculos([]); }
    finally { setLoading(false); }
  }, [colaborador.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const DOCS = [
    ["Tarjeta transp.", "doc_tarjeta_exp"],
    ["Seguro",          "doc_seguro_venc"],
    ["ITV",             "doc_itv_venc"],
    ["Tacógrafo",       "doc_tacografo_venc"],
  ];

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:13,color:"var(--text3)"}}>{vehiculos.length} vehiculo{vehiculos.length!==1?"s":""} registrado{vehiculos.length!==1?"s":""}</div>
        {canEdit && <button style={{...S.btn,background:"var(--accent)",color:"#fff",padding:"6px 14px",fontSize:12}} onClick={()=>{setEditando(null);setModal(true);}}>+ Añadir vehiculo</button>}
      </div>

      {loading ? <div style={{color:"var(--text4)",fontSize:13,padding:20}}>Cargando...</div>
      : vehiculos.length === 0 ? (
        <div style={{textAlign:"center",padding:"30px 0",color:"var(--text4)"}}>
          <div style={{fontSize:13}}>Sin vehiculos registrados</div>
          {canEdit && <div style={{fontSize:12,marginTop:4}}>Añade el primero con el botón de arriba</div>}
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {vehiculos.map(v => {
            return (
              <div key={v.id} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:15,color:"var(--text)"}}>{v.matricula}</span>
                      <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:600,background:"rgba(59,130,246,.12)",color:"var(--accent)"}}>{v.tipo}</span>
                    </div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{v.marca} {v.modelo} {v.año?`(${v.año})`:""}</div>
                    {v.carga_max_kg && <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>Carga máx: {Number(v.carga_max_kg).toLocaleString("es-ES")} kg - {v.num_ejes} ejes{v.longitud_m?` - ${v.longitud_m}m`:""}</div>}
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    {canEdit && (
                      <>
                        <button onClick={()=>{setEditando(v);setModal(true);}} style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",padding:"4px 10px",fontSize:11,border:"1px solid var(--border2)"}}>Editar</button>
                        <button onClick={async()=>{ if(await confirmDialog({title:"Dar de baja vehiculo",message:`Dar de baja ${v.matricula}?`,confirmText:"Dar de baja",tone:"warning"})){ await borrarColaboradorVehiculo(colaborador.id,v.id); cargar(); }}} style={{...S.btn,background:"rgba(239,68,68,.08)",color:"var(--red)",padding:"4px 10px",fontSize:11,border:"1px solid rgba(239,68,68,.2)"}}>Eliminar</button>
                      </>
                    )}
                  </div>
                </div>
                {/* Documentación */}
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                  {DOCS.map(([label,key]) => {
                    const est = estVenc(v[key]);
                    if (!est) return <span key={key} style={{fontSize:10,color:"var(--text5)",padding:"2px 7px",borderRadius:4,background:"var(--bg4)",border:"1px solid var(--border)"}}>{label}: -</span>;
                    return (
                      <span key={key} style={{fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:4,background:`${est.color}18`,border:`1px solid ${est.color}40`,color:est.color}}>
                        {label}: {est.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <ModalVehiculoColab colaboradorId={colaborador.id} editando={editando} onClose={()=>{setModal(false);setEditando(null);}} onSaved={()=>{setModal(false);setEditando(null);cargar();}}/>}
    </div>
  );
}

// ── Detalle colaborador ───────────────────────────────────────────────────
// ── Tab Documentos Colaborador ───────────────────────────────────────────
const TIPOS_DOC_COLAB = [
  {id:"seguro_rc",    l:"Seguro RC",           icon:""},
  {id:"seguro_cargo", l:"Seguro de cargo",      icon:""},
  {id:"ss",           l:"Seguridad Social",     icon:""},
  {id:"autonomo",     l:"Alta autónomo",        icon:""},
  {id:"licencia",     l:"Licencia de transporte",icon:""},
  {id:"otro",         l:"Otro documento",       icon:""},
];

function TabDocumentosColab({ colaborador, canEdit }) {
  const [docs, setDocs] = React.useState([]);
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState({tipo:"seguro_rc",nombre:"",caducidad:"",notas:""});
  const hoy = new Date().toISOString().slice(0,10);
  const en30 = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const en90 = new Date(Date.now()+90*86400000).toISOString().slice(0,10);

  useEffect(() => {
    let alive = true;
    getColaboradorDocumentos(colaborador.id)
      .then((rows) => { if (alive) setDocs(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setDocs([]); });
    return () => { alive = false; };
  }, [colaborador.id]);

  async function addDoc() {
    if (!form.nombre.trim()) { notify("El nombre del documento es obligatorio", "warning"); return; }
    const saved = await crearColaboradorDocumento(colaborador.id, form).catch((e) => {
      notify(e.message || "No se pudo guardar el documento", "error");
      return null;
    });
    if (!saved) return;
    setDocs(prev => [...prev, saved]);
    setForm({tipo:"seguro_rc",nombre:"",caducidad:"",notas:""});
    setShowForm(false);
  }

  async function deleteDoc(id) {
    const ok = await confirmDialog({
      title: "Eliminar documento",
      message: "Eliminar este documento?",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    await borrarColaboradorDocumento(colaborador.id, id).catch((e) => {
      notify(e.message || "No se pudo eliminar el documento", "error");
      return null;
    });
    setDocs(prev => prev.filter(d=>d.id!==id));
  }

  function getAlerta(caducidad) {
    if (!caducidad) return null;
    if (caducidad < hoy)  return {color:"#ef4444", text:"VENCIDO", bg:"rgba(239,68,68,.1)"};
    if (caducidad < en30) return {color:"#ef4444", text:"Vence en menos de 30 días", bg:"rgba(239,68,68,.08)"};
    if (caducidad < en90) return {color:"#f59e0b", text:"Vence en menos de 90 días", bg:"rgba(245,158,11,.08)"};
    return {color:"var(--green)", text:"Vigente", bg:"rgba(16,185,129,.08)"};
  }

  const docsSorted = [...docs].sort((a,b) => {
    // Expired first, then by expiry date
    if (!a.caducidad && !b.caducidad) return 0;
    if (!a.caducidad) return 1;
    if (!b.caducidad) return -1;
    return a.caducidad.localeCompare(b.caducidad);
  });

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div style={{fontSize:12,color:"var(--text4)"}}>
          {docs.length} documento{docs.length!==1?"s":""}
          {docs.filter(d=>d.caducidad&&d.caducidad<en30).length>0&&(
            <span style={{marginLeft:8,padding:"2px 8px",borderRadius:20,fontSize:11,
              background:"rgba(239,68,68,.1)",color:"#ef4444",fontWeight:700}}>
              {docs.filter(d=>d.caducidad&&d.caducidad<en30).length} próximo{docs.filter(d=>d.caducidad&&d.caducidad<en30).length>1?"s":""} a vencer
            </span>
          )}
        </div>
        {canEdit && (
          <button onClick={()=>setShowForm(v=>!v)}
            style={{padding:"6px 14px",borderRadius:7,border:"none",background:"var(--accent)",
              color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            + Añadir documento
          </button>
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <div style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:10,
          padding:16,marginBottom:16}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div>
              <label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",
                letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Tipo</label>
              <select value={form.tipo} onChange={e=>setForm(p=>({...p,tipo:e.target.value}))}
                style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",
                  padding:"7px 10px",borderRadius:7,width:"100%",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>
                {TIPOS_DOC_COLAB.map(t=><option key={t.id} value={t.id}>{t.icon} {t.l}</option>)}
              </select>
            </div>
            <div>
              <label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",
                letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Nombre / referencia *</label>
              <input value={form.nombre} onChange={e=>setForm(p=>({...p,nombre:e.target.value}))}
                placeholder="Ej: Póliza nº 12345678"
                style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",
                  padding:"7px 10px",borderRadius:7,width:"100%",boxSizing:"border-box",
                  fontFamily:"'DM Sans',sans-serif",fontSize:13}}/>
            </div>
            <div>
              <label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",
                letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Fecha de caducidad</label>
              <input type="date" value={form.caducidad} onChange={e=>setForm(p=>({...p,caducidad:e.target.value}))}
                style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",
                  padding:"7px 10px",borderRadius:7,width:"100%",boxSizing:"border-box",
                  fontFamily:"'DM Sans',sans-serif",fontSize:13}}/>
            </div>
            <div>
              <label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",
                letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Notas</label>
              <input value={form.notas} onChange={e=>setForm(p=>({...p,notas:e.target.value}))}
                placeholder="Observaciones opcionales"
                style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",
                  padding:"7px 10px",borderRadius:7,width:"100%",boxSizing:"border-box",
                  fontFamily:"'DM Sans',sans-serif",fontSize:13}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>setShowForm(false)}
              style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",
                background:"transparent",color:"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>
              Cancelar
            </button>
            <button onClick={addDoc}
              style={{padding:"7px 14px",borderRadius:7,border:"none",
                background:"var(--accent)",color:"#fff",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600}}>
              Guardar documento
            </button>
          </div>
        </div>
      )}

      {/* Documents list */}
      {docsSorted.length === 0 ? (
        <div style={{padding:"32px 20px",textAlign:"center",color:"var(--text5)",
          background:"var(--bg3)",borderRadius:10,fontSize:13}}>
          Sin documentos registrados.<br/>
          <span style={{fontSize:11,color:"var(--text5)"}}>
            Añade seguros, alta de autónomo, licencias y sus fechas de caducidad.
          </span>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {docsSorted.map(doc => {
            const alerta = getAlerta(doc.caducidad);
            const tipo = TIPOS_DOC_COLAB.find(t=>t.id===doc.tipo);
            return (
              <div key={doc.id}
                style={{border:`1px solid ${alerta?alerta.color+"33":"var(--border2)"}`,
                  borderRadius:10,padding:"12px 16px",
                  background:alerta?.bg||"var(--bg3)"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                  
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:2}}>
                      {doc.nombre}
                      <span style={{marginLeft:8,fontSize:11,color:"var(--text4)",fontWeight:400}}>
                        {tipo?.l||doc.tipo}
                      </span>
                    </div>
                    {doc.caducidad && (
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:doc.notas?4:0}}>
                        <span style={{fontSize:11,color:"var(--text4)"}}>
                          Caduca: {new Date(doc.caducidad+"T12:00:00").toLocaleDateString("es-ES")}
                        </span>
                        {alerta && (
                          <span style={{padding:"1px 7px",borderRadius:20,fontSize:10,fontWeight:700,
                            color:alerta.color,background:alerta.color+"22"}}>
                            {alerta.text}
                          </span>
                        )}
                      </div>
                    )}
                    {doc.notas && (
                      <div style={{fontSize:11,color:"var(--text4)"}}>{doc.notas}</div>
                    )}
                  </div>
                  {canEdit && (
                    <button onClick={()=>deleteDoc(doc.id)}
                      style={{background:"none",border:"none",color:"var(--text5)",cursor:"pointer",
                        fontSize:16,padding:"2px 4px",flexShrink:0}}>
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function TabPagosColab({ colaborador }) {
  const [pagos, setPagos] = React.useState([]);
  const [form, setForm] = React.useState({fecha:new Date().toISOString().slice(0,10),concepto:"Pago colaboración",importe:"",estado:"pagado",notas:""});
  const [show, setShow] = React.useState(false);
  const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2});
  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--text5)",marginBottom:3};
  useEffect(() => {
    let alive = true;
    getColaboradorPagos(colaborador.id)
      .then((rows) => { if (alive) setPagos(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setPagos([]); });
    return () => { alive = false; };
  }, [colaborador.id]);
  async function guardar() {
    if (!form.importe||!form.fecha) { notify("Fecha e importe obligatorios", "warning"); return; }
    const saved = await crearColaboradorPago(colaborador.id,{...form,importe:Number(form.importe)}).catch((e)=>{ notify(e.message || "No se pudo guardar el pago", "error"); return null; });
    if (!saved) return;
    setPagos(prev => [saved, ...prev]);
    setForm({fecha:new Date().toISOString().slice(0,10),concepto:"Pago colaboración",importe:"",estado:"pagado",notas:""});
    setShow(false);
  }
  async function del(id) {
    if(!await confirmDialog({title:"Eliminar pago",message:"Eliminar este pago?",confirmText:"Eliminar",tone:"danger"})) return;
    const ok = await borrarColaboradorPago(colaborador.id,id).catch((e)=>{ notify(e.message || "No se pudo eliminar el pago", "error"); return null; });
    if (ok === null) return;
    setPagos(prev => prev.filter(p=>p.id!==id));
  }
  const totalPag=pagos.filter(p=>p.estado==="pagado").reduce((s,p)=>s+Number(p.importe||0),0);
  const totalPend=pagos.filter(p=>p.estado==="pendiente").reduce((s,p)=>s+Number(p.importe||0),0);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
        {[["Total pagado",fmt2(totalPag)+" EUR","#10b981"],["Pendiente",fmt2(totalPend)+" EUR",totalPend>0?"#f97316":"var(--text5)"],["Nº pagos",pagos.length,"var(--accent)"]].map(([l,v,c])=>(
          <div key={l} style={{background:"var(--bg3)",borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
            <div style={{fontWeight:800,fontSize:18,color:c}}>{v}</div>
            <div style={{fontSize:11,color:"var(--text5)",textTransform:"uppercase",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>
      <button onClick={()=>setShow(s=>!s)} style={{padding:"7px 16px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",marginBottom:show?0:12}}>{show?"Cancelar":"+ Registrar pago"}</button>
      {show&&(<div style={{background:"var(--bg3)",borderRadius:10,padding:16,marginBottom:14,marginTop:10}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div><label style={lbl}>Fecha</label><input type="date" style={inp} value={form.fecha} onChange={e=>setForm(p=>({...p,fecha:e.target.value}))}/></div>
          <div><label style={lbl}>Importe EUR</label><input type="number" step="0.01" style={inp} value={form.importe} onChange={e=>setForm(p=>({...p,importe:e.target.value}))}/></div>
          <div><label style={lbl}>Concepto</label><input style={inp} value={form.concepto} onChange={e=>setForm(p=>({...p,concepto:e.target.value}))}/></div>
          <div><label style={lbl}>Estado</label><select style={inp} value={form.estado} onChange={e=>setForm(p=>({...p,estado:e.target.value}))}><option value="pagado">Pagado</option><option value="pendiente">Pendiente</option><option value="parcial">Parcial</option></select></div>
        </div>
        <div><label style={lbl}>Notas</label><input style={inp} value={form.notas} onChange={e=>setForm(p=>({...p,notas:e.target.value}))} placeholder="Factura nº, referencia..."/></div>
        <button onClick={guardar} style={{marginTop:12,padding:"7px 18px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Guardar</button>
      </div>)}
      {pagos.length===0?<div style={{textAlign:"center",padding:30,color:"var(--text5)"}}>Sin pagos registrados</div>
        :<div style={{display:"flex",flexDirection:"column",gap:6}}>{pagos.map(p=>(
          <div key={p.id} style={{background:"var(--bg3)",borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text5)",minWidth:80}}>{p.fecha}</span>
            <span style={{flex:1,fontSize:13,color:"var(--text)"}}>{p.concepto}</span>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:14,color:p.estado==="pagado"?"#10b981":"#f97316"}}>{fmt2(p.importe)} EUR</span>
            <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,background:p.estado==="pagado"?"rgba(16,185,129,.15)":"rgba(249,115,22,.15)",color:p.estado==="pagado"?"#10b981":"#f97316",fontWeight:600}}>{p.estado}</span>
            {p.notas&&<span style={{fontSize:11,color:"var(--text5)"}}>{p.notas}</span>}
            <button onClick={()=>del(p.id)} style={{padding:"2px 8px",borderRadius:5,border:"none",background:"rgba(239,68,68,.1)",color:"#ef4444",cursor:"pointer",fontSize:11}}>X</button>
          </div>
        ))}</div>}
    </div>
  );
}

function MiniRiskList({ title, rows = [] }) {
  return (
    <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:9,padding:10}}>
      <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".07em",fontWeight:900,color:"var(--text5)",marginBottom:7}}>{title}</div>
      <div style={{display:"grid",gap:6}}>
        {rows.map((r, idx) => (
          <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"start",fontSize:11}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:800,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.a || "-"}</div>
              <div style={{color:"var(--text4)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.b || "-"}</div>
            </div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:"var(--text3)",whiteSpace:"nowrap"}}>{r.c || "-"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabViajesFacturasColab({ colaborador, canEdit }) {
  const [referencia, setReferencia] = useState("");
  const [viajes, setViajes] = useState([]);
  const [facturas, setFacturas] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [accionesPendientes, setAccionesPendientes] = useState(null);
  const [tokensLiquidacion, setTokensLiquidacion] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalViaje, setModalViaje] = useState(null);
  const [modalFactura, setModalFactura] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = referencia.trim() ? { referencia: referencia.trim() } : {};
      const [hist, facs, pays, docs, tokens] = await Promise.all([
        getColaboradorHistorial(colaborador.id, params).catch(()=>[]),
        getColaboradorFacturas(colaborador.id, params).catch(()=>[]),
        getColaboradorPagos(colaborador.id).catch(()=>[]),
        getColaboradorDocumentos(colaborador.id).catch(()=>[]),
        getColaboradorLiquidacionTokens(colaborador.id).catch(()=>[]),
      ]);
      setViajes(Array.isArray(hist) ? hist : []);
      setFacturas(Array.isArray(facs) ? facs : []);
      setPagos(Array.isArray(pays) ? pays : []);
      setDocumentos(Array.isArray(docs) ? docs : []);
      setTokensLiquidacion(Array.isArray(tokens) ? tokens : []);
      getColaboradorAccionesPendientes(colaborador.id, params)
        .then(d => setAccionesPendientes(d && typeof d === "object" ? d : null))
        .catch(() => setAccionesPendientes(null));
    } finally {
      setLoading(false);
    }
  }, [colaborador.id, referencia]);

  useEffect(() => { cargar(); }, [cargar]);

  const totalViajes = viajes.reduce((s,p)=>s+Number(p.importe_colaborador || p.precio_colaborador || 0),0);
  const totalFacturado = facturas.reduce((s,f)=>s+Number(f.total || 0),0);
  const totalPagado = pagos.filter(p=>p.estado==="pagado").reduce((s,p)=>s+Number(p.importe || 0),0);
  const totalPendienteFactura = facturas
    .filter(f=>!f.número_factura || f.estado==="pendiente")
    .reduce((s,f)=>s+Number(f.total || 0),0);
  const estadoProveedor = estadoPagosProveedor({ facturas, pagos });
  const docsCaducados = documentos.filter(d => estadoDocumentoColaborador(d).dias !== null && estadoDocumentoColaborador(d).dias < 0);
  const docsProximos = documentos.filter(d => {
    const dias = estadoDocumentoColaborador(d).dias;
    return dias !== null && dias >= 0 && dias <= 30;
  });
  const facturasByRef = facturas.reduce((acc,f)=>{
    const ref = String(f.referencia_orden || f.referencia_cliente || "").toLowerCase();
    if (ref) acc[ref] = f;
    if (f.pedido_id) acc[String(f.pedido_id).toLowerCase()] = f;
    if (f.número) acc[String(f.número).toLowerCase()] = f;
    return acc;
  }, {});
  const acciones = Array.isArray(accionesPendientes?.acciones) ? accionesPendientes.acciones : [];
  const viajesSinSoporte = Array.isArray(accionesPendientes?.viajes_sin_soporte) ? accionesPendientes.viajes_sin_soporte : [];
  const facturasRiesgo = Array.isArray(accionesPendientes?.facturas_en_riesgo) ? accionesPendientes.facturas_en_riesgo : [];
  const docsRiesgo = Array.isArray(accionesPendientes?.documentos_en_riesgo) ? accionesPendientes.documentos_en_riesgo : [];
  const vehRiesgo = Array.isArray(accionesPendientes?.vehiculos_en_riesgo) ? accionesPendientes.vehiculos_en_riesgo : [];

  function descargarLiquidacion() {
    try {
      const html = buildLiquidacionColaboradorHtml({ colaborador, viajes, facturas, pagos, documentos });
      const blob = new Blob([html], { type:"text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const nombre = String(colaborador.nombre || "colaborador").replace(/[^\w.-]+/g, "_");
      a.href = url;
      a.download = `liquidacion-${nombre}-${new Date().toISOString().slice(0,10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Liquidacion descargada.", "success");
    } catch (e) {
      notify(e.message || "No se pudo generar la liquidacion.", "error");
    }
  }

  async function descargarInformeAcciones() {
    try {
      const params = referencia.trim() ? { referencia: referencia.trim() } : {};
      const { blob, filename } = await descargarColaboradorInformeAcciones(colaborador.id, params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Informe de acciones descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo descargar el informe de acciones.", "error");
    }
  }

  async function crearAccesoColaborador(mode = "portal") {
    if (!canEdit) return;
    try {
      const data = await crearColaboradorLiquidacionToken(colaborador.id, { dias: 30 });
      setTokensLiquidacion(prev => [{ ...data, caducado: false, abierto: false }, ...prev].slice(0, 12));
      const targetUrl = mode === "operativa"
        ? (data?.operativa_url || data?.portal_url || data?.url || "")
        : (data?.portal_url || data?.url || "");
      if (navigator.clipboard && targetUrl) {
        await navigator.clipboard.writeText(targetUrl).catch(() => {});
      }
      const ok = await confirmDialog({
        title: mode === "operativa" ? "Acceso operativo creado" : "Portal proveedor creado",
        message: `El enlace caduca en 30 dias y se ha intentado copiar al portapapeles.\n\n${targetUrl}`,
        confirmText: mode === "operativa" ? "Abrir acceso" : "Abrir portal",
        cancelText: "Cerrar",
        tone: "success",
      });
      if (ok && targetUrl) window.open(targetUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      notify(e.message || "No se pudo crear el acceso del colaborador.", "error");
    }
  }

  async function crearEnlaceLiquidacion() {
    return crearAccesoColaborador("portal");
  }

  async function crearAccesoOperativo() {
    return crearAccesoColaborador("operativa");
  }

  async function enviarLiquidacionEmail() {
    if (!canEdit) return;
    if (!String(colaborador.email || "").trim()) {
      notify("El colaborador no tiene email configurado.", "error");
      return;
    }
    const ok = await confirmDialog({
      title: "Enviar portal proveedor",
      message: `Se enviara un enlace seguro del portal proveedor a ${colaborador.email}. Caducara en 30 dias y quedara registrado en el log de emails.`,
      confirmText: "Enviar email",
      cancelText: "Cancelar",
      tone: "success",
    });
    if (!ok) return;
    try {
      const data = await enviarColaboradorLiquidacionEmail(colaborador.id, { dias: 30 });
      setTokensLiquidacion(prev => [{ ...data, caducado: false, abierto: false }, ...prev].slice(0, 12));
      notify(data?.simulado ? "Email simulado y portal generado." : "Email enviado y portal generado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo enviar la liquidacion.", "error");
    }
  }

  async function revocarEnlaceLiquidacion(token) {
    if (!canEdit || !token?.id || token.caducado) return;
    const ok = await confirmDialog({
      title: "Revocar enlace",
      message: "El colaborador dejara de poder abrir esta liquidacion desde el enlace publico. El historial de creacion y apertura se conserva.",
      confirmText: "Revocar",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const data = await revocarColaboradorLiquidacionToken(colaborador.id, token.id);
      setTokensLiquidacion(prev => prev.map(t => t.id === token.id ? { ...t, ...data, caducado: true } : t));
      notify("Enlace revocado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo revocar el enlace.", "error");
    }
  }

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
        {[["Viajes",viajes.length,"var(--accent)"],["A pagar estimado",fmt2(totalViajes)+" EUR","#f59e0b"],["Facturas recibidas",fmt2(totalFacturado)+" EUR","#10b981"],["Pagado",fmt2(totalPagado)+" EUR","#22d3ee"]].map(([l,v,c])=>(
          <div key={l} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontWeight:900,fontSize:18,color:c}}>{v}</div>
            <div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",fontWeight:700,marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      {accionesPendientes && (
        <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:800,color:"var(--text)"}}>Acciones pendientes del proveedor</div>
              <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>Misma lectura que verá el colaborador en su portal seguro.</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <button onClick={descargarInformeAcciones} style={{...S.btn,background:"rgba(51,65,85,.14)",color:"var(--text2)",border:"1px solid var(--border2)",fontSize:12,padding:"7px 10px"}}>
                Informe acciones
              </button>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {[
                  ["Prioridades", acciones.length, acciones.length?"#f59e0b":"#10b981"],
                  ["Sin soporte", viajesSinSoporte.length, viajesSinSoporte.length?"#f59e0b":"#10b981"],
                  ["Facturas riesgo", facturasRiesgo.length, facturasRiesgo.length?"#ef4444":"#10b981"],
                  ["Docs riesgo", docsRiesgo.length + vehRiesgo.length, (docsRiesgo.length+vehRiesgo.length)?"#f59e0b":"#10b981"],
                ].map(([label,value,color]) => (
                  <div key={label} style={{minWidth:92,padding:"7px 9px",borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border2)"}}>
                    <div style={{fontSize:16,fontWeight:900,color}}>{value}</div>
                    <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",fontWeight:800}}>{label}</div>
                  </div>
                ))}
                </div>
            </div>
          </div>
          {acciones.length === 0 ? (
            <div style={{fontSize:12,color:"var(--green)",fontWeight:800}}>Sin bloqueos destacados para este colaborador.</div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
              {acciones.slice(0,6).map(a => (
                <div key={`${a.tipo}-${a.tab}`} style={{border:`1px solid ${a.prioridad==="alta"?"rgba(239,68,68,.28)":"rgba(245,158,11,.3)"}`,background:a.prioridad==="alta"?"rgba(239,68,68,.08)":"rgba(245,158,11,.08)",borderRadius:9,padding:"9px 10px"}}>
                  <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:".08em",fontWeight:900,color:a.prioridad==="alta"?"#ef4444":"#f59e0b"}}>{a.prioridad} - {a.tab}</div>
                  <div style={{fontSize:12,fontWeight:800,color:"var(--text)",marginTop:2}}>{a.titulo}</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>{a.detalle}</div>
                </div>
              ))}
            </div>
          )}
          {(viajesSinSoporte.length || facturasRiesgo.length || docsRiesgo.length || vehRiesgo.length) > 0 && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:10,marginTop:12}}>
              {viajesSinSoporte.length > 0 && <MiniRiskList title="Viajes sin soporte" rows={viajesSinSoporte.slice(0,4).map(v=>({a:v.numero,b:[v.origen,v.destino].filter(Boolean).join(" -> "),c:fmt2(v.importe_colaborador)+" EUR"}))}/>}
              {facturasRiesgo.length > 0 && <MiniRiskList title="Facturas en riesgo" rows={facturasRiesgo.slice(0,4).map(f=>({a:f.numero_factura||"Sin numero",b:f.situacion,c:fmt2(f.total)+" EUR"}))}/>}
              {docsRiesgo.length > 0 && <MiniRiskList title="Documentos proveedor" rows={docsRiesgo.slice(0,4).map(d=>({a:d.nombre,b:d.estado,c:d.caducidad||"-"}))}/>}
              {vehRiesgo.length > 0 && <MiniRiskList title="Vehiculos proveedor" rows={vehRiesgo.slice(0,4).map(v=>({a:v.matricula,b:v.documento,c:v.estado}))}/>}
            </div>
          )}
        </div>
      )}

      {tokensLiquidacion.length > 0 && (
        <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 12px",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:8}}>
            Enlaces de liquidacion
          </div>
          <div style={{display:"grid",gap:6}}>
            {tokensLiquidacion.slice(0,4).map(t => (
              <div key={t.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto auto",gap:10,alignItems:"center",fontSize:12,color:"var(--text3)"}}>
                <span>
                  Creado {fmtDate(t.created_at)}{t.created_by_nombre ? ` por ${t.created_by_nombre}` : ""} - caduca {fmtDate(t.expires_at)}
                </span>
                <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:800,background:t.confirmado?"rgba(16,185,129,.16)":t.abierto?"rgba(16,185,129,.12)":t.caducado?"rgba(239,68,68,.10)":"rgba(59,130,246,.12)",color:t.confirmado?"#047857":t.abierto?"#10b981":t.caducado?"#ef4444":"var(--accent)"}}>
                  {t.confirmado ? "Confirmado" : t.abierto ? "Abierto" : t.caducado ? "Caducado" : "Pendiente"}
                </span>
                <span style={{fontSize:11,color:"var(--text5)"}}>{t.acknowledged_at ? `Revisado ${fmtDate(t.acknowledged_at)}` : t.opened_at ? `Visto ${fmtDate(t.opened_at)}` : "-"}</span>
                <span style={{fontSize:11,color:t.downloaded_at ? "var(--accent)" : "var(--text5)",fontWeight:t.downloaded_at ? 800 : 600}}>
                  {t.downloaded_at ? `Descargado ${fmtDate(t.downloaded_at)}${Number(t.download_count||0)>1 ? ` x${t.download_count}` : ""}` : "Sin descarga"}
                </span>
                {canEdit && !t.caducado ? (
                  <button onClick={()=>revocarEnlaceLiquidacion(t)} style={{padding:"3px 8px",borderRadius:6,border:"1px solid rgba(239,68,68,.25)",background:"rgba(239,68,68,.08)",color:"#ef4444",fontSize:11,fontWeight:800,cursor:"pointer"}}>
                    Revocar
                  </button>
                ) : <span />}
              </div>
            ))}
          </div>
        </div>
      )}

      {totalPendienteFactura > 0 && (
        <div style={{background:"rgba(249,115,22,.08)",border:"1px solid rgba(249,115,22,.22)",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#f97316",fontWeight:700}}>
          Hay {fmt2(totalPendienteFactura)} EUR en previsiones o facturas pendientes de completar.
        </div>
      )}

      {(estadoProveedor.vencidas.length || estadoProveedor.proximas.length || estadoProveedor.sinVencimiento.length || estadoProveedor.sinNumero.length) > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          {[
            ["Vencidas", estadoProveedor.vencidas.length, "#ef4444", "Facturas proveedor fuera de plazo"],
            ["Vencen 7d", estadoProveedor.proximas.length, "#f59e0b", "Pagos a revisar esta semana"],
            ["Sin vcto.", estadoProveedor.sinVencimiento.length, "#60a5fa", "Falta fecha de vencimiento"],
            ["Sin numero", estadoProveedor.sinNumero.length, "#a78bfa", "Factura recibida incompleta"],
          ].map(([label,value,color,help])=>(
            <div key={label} title={help} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px"}}>
              <div style={{fontSize:16,fontWeight:900,color}}>{value}</div>
              <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {(docsCaducados.length || docsProximos.length) > 0 && (
        <div style={{background:docsCaducados.length ? "rgba(239,68,68,.08)" : "rgba(245,158,11,.08)",border:`1px solid ${docsCaducados.length ? "rgba(239,68,68,.24)" : "rgba(245,158,11,.24)"}`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:docsCaducados.length ? "#ef4444" : "#f59e0b",fontWeight:700}}>
          Documentacion del colaborador: {docsCaducados.length} caducada(s) y {docsProximos.length} con vencimiento en 30 dias. Se incluye en el informe y en el enlace del colaborador.
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr auto auto auto auto",gap:8,marginBottom:14}}>
        <input
          style={S.inp}
          value={referencia}
          onChange={e=>setReferencia(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&cargar()}
          placeholder="Buscar por referencia de orden, pedido o referencia de cliente"
        />
        <button onClick={cargar} style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",border:"1px solid var(--border2)"}}>
          Buscar
        </button>
        <button onClick={descargarLiquidacion} style={{...S.btn,background:"rgba(34,211,160,.12)",color:"var(--green)",border:"1px solid rgba(34,211,160,.25)"}}>
          Informe liquidacion
        </button>
        {canEdit && (
          <button onClick={crearEnlaceLiquidacion} style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)"}}>
          Portal proveedor
          </button>
        )}
        {canEdit && (
          <button onClick={crearAccesoOperativo} style={{...S.btn,background:"rgba(15,118,110,.12)",color:"#0f766e",border:"1px solid rgba(15,118,110,.25)"}}>
            Acceso operativo
          </button>
        )}
        {canEdit && (
          <button onClick={enviarLiquidacionEmail} disabled={!String(colaborador.email || "").trim()} style={{...S.btn,background:"rgba(16,185,129,.12)",color:"#10b981",border:"1px solid rgba(16,185,129,.25)",opacity:String(colaborador.email || "").trim()?1:.55}}>
            Enviar email
          </button>
        )}
      </div>

      {loading ? <div style={{padding:24,color:"var(--text4)"}}>Cargando historico...</div>
      : viajes.length === 0 ? (
        <div style={{padding:30,textAlign:"center",color:"var(--text5)",background:"var(--bg3)",borderRadius:10}}>
          Sin viajes encontrados para este colaborador.
        </div>
      ) : (
        <div style={S.card}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Referencia","Fecha","Ruta","Cliente","Precio acordado","Factura","Acciones"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {viajes.map(v=>{
                const ref = orderRef(v);
                const factura = facturasByRef[String(ref).toLowerCase()] || facturasByRef[String(v.id).toLowerCase()];
                const precio = Number(v.importe_colaborador || v.precio_colaborador || 0);
                return (
                  <tr key={v.id}>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--accent-xl)"}}>{ref || "-"}</td>
                    <td style={S.td}>{fmtDate(v.fecha_carga)}</td>
                    <td style={{...S.td,maxWidth:260}}>
                      <div style={{fontWeight:700,color:"var(--text)"}}>{v.origen || "-"}</div>
                      <div style={{fontSize:11,color:"var(--text4)"}}>-> {v.destino || "-"}</div>
                    </td>
                    <td style={S.td}>{v.cliente_nombre || "-"}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:"#f59e0b"}}>{fmt2(precio)} EUR</td>
                    <td style={S.td}>
                      {factura ? (
                        <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,background:"rgba(16,185,129,.12)",color:"#10b981"}}>
                          {factura.número_factura || "Registrada"}
                        </span>
                      ) : (
                        <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,background:"rgba(245,158,11,.12)",color:"#f59e0b"}}>
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td style={S.td}>
                      {canEdit && (
                        <button onClick={()=>{setModalViaje(v);setModalFactura(factura || null);}} style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",padding:"4px 10px",fontSize:11,border:"1px solid var(--border2)"}}>
                          {factura ? "Completar factura" : "Registrar factura recibida"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {facturas.length > 0 && (
        <div style={{marginTop:16}}>
          <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:8}}>
            Facturas recibidas
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {facturas.map(f=>(
              <div key={f.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr auto auto auto",gap:10,alignItems:"center",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 12px"}}>
                <div style={{fontWeight:700,color:"var(--text)"}}>{f.número_factura || "Sin número"}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text4)"}}>{f.referencia_orden || f.referencia_cliente || "-"}</div>
                <div style={{fontSize:12,color:"var(--text4)"}}>{fmtDate(f.fecha)}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:"#10b981"}}>{fmt2(f.total)} EUR</div>
                {canEdit && (
                  <button onClick={()=>{
                    const viaje = viajes.find(v=>String(v.id)===String(f.pedido_id)) || { id:f.pedido_id, referencia_busqueda:f.referencia_orden };
                    setModalViaje(viaje);
                    setModalFactura(f);
                  }} style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",padding:"4px 10px",fontSize:11,border:"1px solid var(--border2)"}}>
                    Editar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {modalViaje && (
        <ModalFacturaColab
          colaborador={colaborador}
          viaje={modalViaje}
          factura={modalFactura}
          onClose={()=>{setModalViaje(null);setModalFactura(null);}}
          onSaved={()=>{setModalViaje(null);setModalFactura(null);cargar();}}
        />
      )}
    </div>
  );
}

function DetalleColaborador({ colaborador, canEdit, onEditar, onBaja, onVolver }) {
  const [tab, setTab] = useState("datos");

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button onClick={onVolver} style={{...S.btn,background:"var(--bg4)",color:"var(--text3)",padding:"6px 12px",fontSize:12,border:"1px solid var(--border2)"}}>← Volver</button>
        <div>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:18,color:"var(--text)"}}>{colaborador.nombre}</div>
          <div style={{fontSize:12,color:"var(--text4)"}}>{colaborador.tipo==="empresa"?"Empresa colaboradora":"Autónomo"}{colaborador.cif?" - "+colaborador.cif:""}</div>
        </div>
        {canEdit && <div style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={onEditar} style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",padding:"6px 12px",fontSize:12,border:"1px solid var(--border2)"}}>Editar datos</button>
          <button onClick={()=>onBaja?.(colaborador)} style={{...S.btn,background:"rgba(239,68,68,.08)",color:"#ef4444",padding:"6px 12px",fontSize:12,border:"1px solid rgba(239,68,68,.25)"}}>Dar de baja</button>
        </div>}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:2,borderBottom:"1px solid var(--border)",marginBottom:20}}>
        {[["datos"," Datos"],["vehiculos","Vehiculos"],["pagos","Pagos"],["documentos","Documentos"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{...S.btn,background:"transparent",border:"none",borderBottom:`2px solid ${tab===id?"var(--accent)":"transparent"}`,borderRadius:0,
              color:tab===id?"var(--accent)":"var(--text4)",padding:"8px 16px",fontSize:13}}>
            {l}
          </button>
        ))}
        <button onClick={()=>setTab("viajes")}
          style={{...S.btn,background:"transparent",border:"none",borderBottom:`2px solid ${tab==="viajes"?"var(--accent)":"transparent"}`,borderRadius:0,
            color:tab==="viajes"?"var(--accent)":"var(--text4)",padding:"8px 16px",fontSize:13}}>
          Viajes y facturas
        </button>
      </div>

      {tab==="datos" && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{background:"var(--bg3)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--accent)",marginBottom:10}}>Identificación</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[["Tipo",colaborador.tipo==="empresa"?"Empresa":"Autónomo"],["CIF/NIF",colaborador.cif||"-"],].map(([k,v])=>(
                <div key={k}><div style={{fontSize:10,fontWeight:700,color:"var(--text5)",marginBottom:2}}>{k}</div><div style={{fontSize:13,color:"var(--text)",fontWeight:600}}>{v}</div></div>
              ))}
            </div>
          </div>
          <div style={{background:"var(--bg3)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--accent)",marginBottom:10}}>Contacto</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[["Teléfono",colaborador.telefono||"-"],["Email",colaborador.email||"-"]].map(([k,v])=>(
                <div key={k}><div style={{fontSize:10,fontWeight:700,color:"var(--text5)",marginBottom:2}}>{k}</div><div style={{fontSize:13,color:"var(--text)"}}>{v}</div></div>
              ))}
              {(colaborador.contacto_nombre||colaborador.contacto_telefono)&&(<div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,fontWeight:700,color:"var(--text5)",marginBottom:2}}>Persona de contacto</div><div style={{fontSize:13,color:"var(--text)"}}>{[colaborador.contacto_nombre,colaborador.contacto_telefono].filter(Boolean).join(" - ")}</div></div>)}
            </div>
          </div>
          {(colaborador.calle||colaborador.ciudad||colaborador.codigo_postal)&&(<div style={{background:"var(--bg3)",borderRadius:10,padding:"14px 16px"}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--accent)",marginBottom:6}}>Dirección</div><div style={{fontSize:13,color:"var(--text)"}}>{[colaborador.calle,colaborador.num_ext].filter(Boolean).join(" ")}{(colaborador.calle||colaborador.num_ext)&&(colaborador.codigo_postal||colaborador.ciudad)?", ":""}{[colaborador.codigo_postal,colaborador.ciudad,colaborador.provincia].filter(Boolean).join(", ")}{colaborador.pais&&colaborador.pais!=="España"?(" - "+colaborador.pais):""}</div></div>)}
          <div style={{background:"var(--bg3)",borderRadius:10,padding:"14px 16px"}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--accent)",marginBottom:10}}>Pago</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>{[["IBAN",colaborador.iban||"-"],["Forma de pago",colaborador.forma_pago||"-"],["IVA",ivaLabel(colaborador.tipo_iva,colaborador.iva_regimen)]].map(([k,v])=>(<div key={k}><div style={{fontSize:10,fontWeight:700,color:"var(--text5)",marginBottom:2}}>{k}</div><div style={{fontSize:13,color:"var(--text)"}}>{v}</div></div>))}</div></div>
          {colaborador.notas&&(<div style={{background:"var(--bg3)",borderRadius:10,padding:"14px 16px"}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--accent)",marginBottom:6}}>Notas</div><div style={{fontSize:13,color:"var(--text3)",lineHeight:1.5}}>{colaborador.notas}</div></div>)}
        </div>
      )}

      {tab==="vehiculos" && <TabVehiculos colaborador={colaborador} canEdit={canEdit}/>}
      {tab==="viajes" && <TabViajesFacturasColab colaborador={colaborador} canEdit={canEdit}/>}
      {tab==="pagos" && <TabPagosColab colaborador={colaborador}/>}

      {tab==="documentos" && (
        <TabDocumentosColab
          colaborador={colaborador}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

// ── Modal colaborador ─────────────────────────────────────────────────────
function ModalColaborador({ editando, onClose, onSaved }) {
  const [form, setForm] = useState(editando ? {...editando} : {
    tipo:"autonomo",nombre:"",cif:"",email:"",telefono:"",iban:"",notas:"",
    contacto_nombre:"",contacto_telefono:"",
    calle:"",num_ext:"",codigo_postal:"",ciudad:"",provincia:"",pais:"España",
    forma_pago:"Transferencia bancaria", tipo_iva:21, iva_regimen:"general",
  });
  const [saving, setSaving] = useState(false);
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const fb = k => e => setForm(p=>({...p,[k]:e.target.checked}));
  const fIva = e => {
    const opt = IVA_OPCIONES.find(o => o.value === e.target.value) || IVA_OPCIONES[0];
    setForm(p=>({...p,tipo_iva:opt.pct,iva_regimen:opt.value}));
  };

  async function guardar() {
    if (!form.nombre.trim()) { notify("El nombre es obligatorio", "warning"); return; }
    setSaving(true);
    try {
      if (editando) await editarColaborador(editando.id, form);
      else          await crearColaborador(form);
      onSaved();
    } catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.mbox}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:17,color:"var(--text)",marginBottom:16}}>
          {editando?"Editar colaborador":"Nuevo colaborador"}
        </div>
        {editando?.pendiente_revision && (
          <div style={{marginBottom:14,padding:"10px 12px",borderRadius:8,background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.28)",color:"#f59e0b",fontSize:12,fontWeight:700}}>
            Pendiente de revision administrativa: completa datos fiscales, contacto, pago y documentacion antes de marcarlo como revisado.
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <div style={{gridColumn:"1/-1"}}>
            <label style={S.lbl}>Nombre *</label>
            <input style={S.inp} value={form.nombre} onChange={f("nombre")} placeholder="Transportes García"/>
          </div>
          <div><label style={S.lbl}>Tipo</label>
            <select style={S.inp} value={form.tipo} onChange={f("tipo")}>
              <option value="autonomo">Autónomo</option>
              <option value="empresa">Empresa</option>
            </select>
          </div>
          <div><label style={S.lbl}>CIF / NIF</label><input style={S.inp} value={form.cif||""} onChange={f("cif")}/></div>
          <div><label style={S.lbl}>Teléfono</label><input style={S.inp} value={form.telefono||""} onChange={f("telefono")}/></div>
          <div><label style={S.lbl}>Email</label><input type="email" style={S.inp} value={form.email||""} onChange={f("email")}/></div>
          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>IBAN</label><input style={S.inp} value={form.iban||""} onChange={f("iban")} placeholder="ES00 0000 0000 0000 0000 0000"/></div>

          <div style={{gridColumn:"1/-1",paddingTop:8,borderTop:"1px solid var(--border)",marginTop:4}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:6,textTransform:"uppercase",letterSpacing:".06em"}}>Dirección fiscal</div>
          </div>
          <div><label style={S.lbl}>Calle / Av.</label><input style={S.inp} value={form.calle||""} onChange={f("calle")} placeholder="Calle Mayor"/></div>
          <div><label style={S.lbl}>Nº / Piso</label><input style={S.inp} value={form.num_ext||""} onChange={f("num_ext")} placeholder="12, 3ºB"/></div>
          <div><label style={S.lbl}>Código postal</label><input style={S.inp} value={form.codigo_postal||""} onChange={f("codigo_postal")} placeholder="28001"/></div>
          <div><label style={S.lbl}>Ciudad</label><input style={S.inp} value={form.ciudad||""} onChange={f("ciudad")}/></div>
          <GeoFields
            values={form}
            onChange={(campo, valor) => setForm(p => ({ ...p, [campo]: valor }))}
            inputStyle={S.inp}
            labelStyle={S.lbl}
          />
          <div><label style={S.lbl}>Persona de contacto</label><input style={S.inp} value={form.contacto_nombre||""} onChange={f("contacto_nombre")}/></div>
          <div><label style={S.lbl}>Tel. contacto</label><input style={S.inp} value={form.contacto_telefono||""} onChange={f("contacto_telefono")}/></div>
          <div><label style={S.lbl}>Forma de pago</label>
            <select style={S.inp} value={form.forma_pago||"Transferencia bancaria"} onChange={f("forma_pago")}>
              {["Transferencia bancaria","Contado","Cheque","Confirming","Pagaré"].map(fp=><option key={fp} value={fp}>{fp}</option>)}
            </select>
          </div>
          <div><label style={S.lbl}>IVA aplicable</label>
            <select style={S.inp} value={ivaOption(form.tipo_iva, form.iva_regimen).value} onChange={fIva}>
              {IVA_OPCIONES.map(opt=><option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>

          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Notas</label><textarea style={{...S.inp,resize:"vertical",minHeight:70}} value={form.notas||""} onChange={f("notas")}/></div>
          {editando && (
            <label style={{gridColumn:"1/-1",display:"flex",alignItems:"center",gap:8,marginTop:10,fontSize:12,color:"var(--text3)"}}>
              <input type="checkbox" checked={!!form.pendiente_revision} onChange={fb("pendiente_revision")}/>
              Pendiente de revisión administrativa
            </label>
          )}
        </div>
        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text4)"}}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:saving?.7:1}}>
            {saving?"Guardando...":"Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Principal ─────────────────────────────────────────────────────────────
export default function Colaboradores() {
  const { puedeEditar } = useAuth();
  const canEdit = puedeEditar("colaboradores");
  const [colaboradores, setColaboradores] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(false);
  const [editando, setEditando] = useState(null);
  const [detalle, setDetalle]   = useState(null);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [revisandoLiquidaciones, setRevisandoLiquidaciones] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try { const d = await getColaboradores(); setColaboradores(Array.isArray(d)?d:[]); }
    catch(e) {}
    finally { setLoading(false); }
  };
  useEffect(() => { cargar(); }, []);
  useEffect(() => {
    if (loading || !colaboradores.length) return;
    const focus = readRuntimeFocus("tms_colaborador_focus");
    const colaboradorId = focus?.colaborador_id;
    if (!colaboradorId) return;
    const encontrado = colaboradores.find(c => String(c.id) === String(colaboradorId));
    if (encontrado) {
      setDetalle(encontrado);
      if (encontrado.pendiente_revision) setSoloPendientes(true);
      clearRuntimeFocus("tms_colaborador_focus");
    }
  }, [colaboradores, loading]);
  const refrescarBadges = () => {
    window.dispatchEvent(new CustomEvent("tms:colaboradores-refresh"));
    window.dispatchEvent(new CustomEvent("tms:notificaciones-refresh"));
  };
  const pendientesRevision = colaboradores.filter(c => c.pendiente_revision);
  const colaboradoresVisibles = soloPendientes ? pendientesRevision : colaboradores;

  const revisarColaborador = async (colaborador) => {
    const ok = await confirmDialog({
      title: "Marcar colaborador como revisado",
      message: `Confirma que ${colaborador.nombre} ya tiene revisados datos fiscales, contacto, pago y documentacion.`,
      confirmText: "Marcar revisado",
      cancelText: "Cancelar",
      tone: "info",
    });
    if (!ok) return;
    await marcarColaboradorRevisado(colaborador.id);
    notify("Colaborador marcado como revisado", "success");
    refrescarBadges();
    cargar();
  };

  const darBajaColaborador = async (colaborador) => {
    const ok = await confirmDialog({
      title: "Dar de baja colaborador",
      message: `${colaborador.nombre} dejara de aparecer como colaborador activo. El historial de viajes, facturas, pagos y documentos se conserva.`,
      confirmText: "Dar de baja",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await borrarColaborador(colaborador.id);
      notify("Colaborador dado de baja.", "success");
      setDetalle(null);
      refrescarBadges();
      cargar();
    } catch (e) {
      notify(e.message || "No se pudo dar de baja el colaborador.", "error");
    }
  };

  const revisarLiquidaciones = async () => {
    if (!canEdit || revisandoLiquidaciones) return;
    setRevisandoLiquidaciones(true);
    try {
      const result = await revisarAlertasLiquidacionesColaboradores();
      notify(result?.mensaje || "Liquidaciones revisadas.", result?.total ? "warning" : "success");
      if (result?.total) window.dispatchEvent(new CustomEvent("tms:notificaciones-refresh"));
    } catch (e) {
      notify(e.message || "No se pudieron revisar las liquidaciones.", "error");
    } finally {
      setRevisandoLiquidaciones(false);
    }
  };

  // Si hay detalle abierto, mostrarlo
  if (detalle) {
    const colaboradorActual = colaboradores.find(c=>c.id===detalle.id) || detalle;
    return (
      <div style={S.page}>
        <DetalleColaborador
          colaborador={colaboradorActual}
          canEdit={canEdit}
          onEditar={() => { setEditando(colaboradorActual); setModal(true); }}
          onBaja={darBajaColaborador}
          onVolver={() => setDetalle(null)}
        />
        {modal && <ModalColaborador editando={editando} onClose={()=>{setModal(false);setEditando(null);}} onSaved={()=>{setModal(false);setEditando(null);refrescarBadges();cargar();}}/>}
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{...S.title,marginBottom:0}}>Colaboradores</div>
          {pendientesRevision.length > 0 && (
            <button
              onClick={()=>setSoloPendientes(v=>!v)}
              style={{...S.btn,padding:"5px 10px",fontSize:11,background:soloPendientes?"rgba(245,158,11,.18)":"rgba(245,158,11,.1)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.3)"}}
            >
              {pendientesRevision.length} pendiente{pendientesRevision.length!==1?"s":""} de revisar
            </button>
          )}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {soloPendientes && <button style={{...S.btn,background:"var(--bg4)",color:"var(--text3)",padding:"6px 10px",fontSize:12,border:"1px solid var(--border2)"}} onClick={()=>setSoloPendientes(false)}>Ver todos</button>}
          {canEdit && (
            <button
              style={{...S.btn,background:"rgba(59,130,246,.1)",color:"var(--accent)",padding:"7px 12px",fontSize:12,border:"1px solid rgba(59,130,246,.25)",opacity:revisandoLiquidaciones?.65:1}}
              disabled={revisandoLiquidaciones}
              onClick={revisarLiquidaciones}
            >
              {revisandoLiquidaciones ? "Revisando..." : "Revisar liquidaciones"}
            </button>
          )}
          {canEdit && <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={()=>{setEditando(null);setModal(true);}}>+ Nuevo colaborador</button>}
        </div>
      </div>

      <div style={S.card}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>
            {["Nombre","CIF","Tipo","IVA","Teléfono","Estado","Acciones"].map(h=><th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Cargando...</td></tr>
            : colaboradores.length===0 ? <tr><td colSpan={7} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Sin colaboradores.{canEdit?" Añade el primero.":""}</td></tr>
            : colaboradoresVisibles.map(c=>(
              <tr key={c.id} style={{cursor:"pointer",background:c.pendiente_revision?"rgba(245,158,11,.06)":"transparent",borderLeft:c.pendiente_revision?"3px solid #f59e0b":"3px solid transparent"}} onClick={()=>setDetalle(c)}>
                <td style={{...S.td,fontWeight:600}}>{c.nombre}</td>
                <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--text2)"}}>{c.cif||"-"}</td>
                <td style={S.td}><span style={{padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:"rgba(59,110,245,.14)",color:"var(--accent-xl)"}}>{c.tipo==="empresa"?"Empresa":"Autónomo"}</span></td>
                <td style={{...S.td,fontSize:12,color:"var(--text2)"}}>{ivaLabel(c.tipo_iva,c.iva_regimen)}</td>
                <td style={{...S.td,fontSize:12,color:"var(--text2)"}}>{c.telefono||"-"}</td>
                <td style={S.td}>
                  {c.pendiente_revision
                    ? <span style={{padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:800,background:"rgba(245,158,11,.12)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.25)"}}>Pendiente revisión</span>
                    : <span style={{fontSize:11,color:"var(--text5)"}}>Revisado</span>}
                </td>

                <td style={S.td} onClick={e=>e.stopPropagation()}>
                  <div style={{display:"flex",gap:6}}>
                    <button style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",padding:"4px 10px",fontSize:11}} onClick={()=>setDetalle(c)}>Ver -></button>
                    {c.pendiente_revision && canEdit && (
                      <button
                        style={{...S.btn,background:"rgba(16,185,129,.1)",color:"#10b981",padding:"4px 10px",fontSize:11,border:"1px solid rgba(16,185,129,.25)"}}
                        onClick={()=>revisarColaborador(c)}
                      >
                        Revisado
                      </button>
                    )}
                    {canEdit && <button style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",padding:"4px 10px",fontSize:11}} onClick={()=>{setEditando(c);setModal(true);}}>Editar</button>}
                    {canEdit && <button style={{...S.btn,background:"rgba(239,68,68,.08)",color:"#ef4444",padding:"4px 10px",fontSize:11,border:"1px solid rgba(239,68,68,.22)"}} onClick={()=>darBajaColaborador(c)}>Baja</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <ModalColaborador editando={editando} onClose={()=>{setModal(false);setEditando(null);}} onSaved={()=>{setModal(false);setEditando(null);refrescarBadges();cargar();}}/>}
    </div>
  );
}
