import { useState, useEffect, useCallback } from "react";
import {
  getClientes, crearFactura, crearCliente as crearClienteApi,
  getPaletMovimientos, crearPaletMovimiento, editarPaletMovimiento, confirmarSalidaPaletMovimiento, borrarPaletMovimiento,
  getAlmacenes, crearAlmacen,
  getAlmacenMercancias, crearAlmacenMercancia,
  getAlmacenMovimientos, crearAlmacenMovimiento, editarAlmacenMovimiento, borrarAlmacenMovimiento,
  getEmpresaConfig, setConfigPrecios,
} from "../services/api";
import { useEmpresaPerfil } from "../hooks/useEmpresaPerfil";
import { confirmDialog, notify, promptDialog } from "../services/notify";
import { GeoFields } from "../components/GeoFields";

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = n => Number(n||0).toLocaleString("es-ES",{maximumFractionDigits:0});
const escHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const DEFAULT_PALETS_CFG = { precio_devolucion: 5, precio_alquiler: 0 };
function normalizePaletsCfg(cfg){
  return {
    precio_devolucion: Number(cfg?.precio_devolucion || DEFAULT_PALETS_CFG.precio_devolucion),
    precio_alquiler: Number(cfg?.precio_alquiler || DEFAULT_PALETS_CFG.precio_alquiler),
  };
}

function salidaPaletsConfirmada(m){
  if (m.tipo !== "devolucion") return true;
  return String(m.estado_salida || "confirmada").toLowerCase() === "confirmada";
}

function esRectificativaDevolucion(m){
  return String(m?.tipo || "").toLowerCase() === "rectificativa_devolucion";
}

function signoPaletsMovimiento(m){
  if (m.tipo === "devolucion") return salidaPaletsConfirmada(m) ? -1 : 0;
  if (m.tipo === "salida_stock") return -1;
  return 1;
}

function getStockEmpresa(movimientos){
  return movimientos.reduce((s,m)=>{
    if(m.tipo==="entrega") return s+Number(m.cantidad||0);
    if(m.tipo==="rectificativa_devolucion") return s+Number(m.cantidad||0);
    if(m.tipo==="devolucion") return salidaPaletsConfirmada(m) ? s-Number(m.cantidad||0) : s;
    if(m.tipo==="entrada_stock") return s+Number(m.cantidad||0);
    if(m.tipo==="salida_stock") return s-Number(m.cantidad||0);
    return s;
  },0);
}

function direccionCliente(cliente){
  const parts = [
    cliente?.direccion,
    cliente?.direccion_completa,
    cliente?.domicilio,
    cliente?.codigo_postal,
    cliente?.poblacion,
    cliente?.provincia,
    cliente?.pais,
  ]
    .filter(Boolean)
    .map(v => String(v).trim())
    .filter(Boolean);
  return [...new Set(parts)].join(", ");
}

// Modal movimiento
function diasDesde(fecha){
  if (!fecha) return 0;
  const base = new Date(`${String(fecha).slice(0,10)}T12:00:00`);
  if (Number.isNaN(base.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - base.getTime()) / 86400000));
}

function toDateInputValue(value){
  const text = String(value || "").slice(0,10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0,10);
  return parsed.toISOString().slice(0,10);
}

function formatDateEs(value){
  const text = String(value || "").slice(0,10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [yy, mm, dd] = text.split("-");
    return `${dd}/${mm}/${yy}`;
  }
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return value || "-";
  return parsed.toLocaleDateString("es-ES");
}

function buildAlertasAntiguedadPalets(movimientos, clientes, cfgPalets){
  const clientesById = new Map((clientes || []).map(c => [String(c.id), c]));
  const byCliente = new Map();
  (movimientos || []).forEach(m => {
    const clienteId = String(m.propietario_cliente_id || m.cliente_id || "");
    if (!clienteId) return;
    if (!byCliente.has(clienteId)) byCliente.set(clienteId, []);
    byCliente.get(clienteId).push(m);
  });
  const precioDia = Number(cfgPalets?.precio_alquiler || 0);
  const alertas = [];
  byCliente.forEach((items, clienteId) => {
    const entradas = items
      .filter(m => m.tipo === "entrega" || esRectificativaDevolucion(m))
      .map(m => ({ ...m, restante: Number(m.cantidad || 0) }))
      .filter(m => m.restante > 0)
      .sort((a,b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
    let salidas = items
      .filter(m => m.tipo === "devolucion" && salidaPaletsConfirmada(m))
      .reduce((s,m) => s + Number(m.cantidad || 0), 0);
    entradas.forEach(m => {
      if (salidas <= 0) return;
      const usado = Math.min(m.restante, salidas);
      m.restante -= usado;
      salidas -= usado;
    });
    entradas.forEach(m => {
      if (m.restante <= 0) return;
      const dias = diasDesde(m.fecha);
      if (dias < 14) return;
      const exceso = Math.max(0, dias - 14);
      const cliente = clientesById.get(clienteId);
      alertas.push({
        cliente_id: clienteId,
        cliente_nombre: cliente?.nombre || m.cliente_nombre || "Cliente sin identificar",
        obra_nombre: m.obra_nombre || m.cliente_movimiento_nombre || m.pedido_ref || m.notas || "Sin obra/ref",
        fecha: m.fecha,
        dias,
        palets: m.restante,
        nivel: dias >= 30 ? "critica" : "urgente",
        coste_estimado: precioDia > 0 ? m.restante * exceso * precioDia : 0,
      });
    });
  });
  return alertas.sort((a,b) => b.dias - a.dias || b.palets - a.palets);
}

function ModalMovimiento({ clientes, movimientos = [], onClose, onSaved, onServerSave, onServerUpdate, initial, cfgPalets }){
  const cfg = normalizePaletsCfg(cfgPalets);
  const editando = !!initial?.id;
  const [form,setForm]=useState(()=>{
    const base = {
      tipo:"entrega",cliente_id:"",propietario_cliente_id:"",cliente_movimiento_id:"",cantidad:"",
      fecha:new Date().toISOString().slice(0,10),
      pedido_ref:"",precio_unitario:cfg.precio_devolucion||5,notas:"",
      num_albaran:"",estado_salida:"confirmada"
    };
    if (!initial) return base;
    return {
      ...base,
      ...initial,
      cliente_id: initial.propietario_cliente_id || initial.cliente_id || "",
      propietario_cliente_id: initial.propietario_cliente_id || initial.cliente_id || "",
      cantidad: String(initial.cantidad ?? ""),
      precio_unitario: String(initial.precio_unitario ?? base.precio_unitario),
      estado_salida: initial.estado_salida || (initial.tipo === "devolucion" ? "pendiente" : "confirmada"),
    };
  });
  const [generandoFactura, setGenerandoFactura]=useState(false);
  const [facturaGenerada, setFacturaGenerada]=useState(null);
  const f=k=>e=>setForm(p=>({...p,[k]:e.target.value}));
  const cantidadNumerica = Number(form.cantidad || 0);
  const inp={background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl={display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:10};
  function actualizarImporteTotal(value){
    const total = Number(value || 0);
    if (!cantidadNumerica) {
      notify("Primero indica la cantidad de palets para calcular el importe total.", "warning");
      return;
    }
    setForm(p=>({
      ...p,
      precio_unitario: total > 0 ? String(total / cantidadNumerica) : "0",
    }));
  }

  async function guardar(){
    if(!form.cantidad||Number(form.cantidad)<=0){notify("Indica la cantidad de palets", "warning");return;}
    if((form.tipo==="entrega"||form.tipo==="devolucion"||form.tipo==="rectificativa_devolucion")&&!form.propietario_cliente_id&&!form.cliente_id){notify("Selecciona el propietario de los palets", "warning");return;}
    if(form.tipo==="devolucion"&&!form.num_albaran){notify("El numero de albaran es obligatorio para devoluciones", "warning");return;}
    if (editando) {
      const ok = await confirmDialog({
        title: "Guardar cambios en movimiento",
        message: "Se recalculara el historial y el stock de palets con los nuevos datos. Los movimientos con factura vinculada siguen bloqueados.",
        confirmText: "Guardar cambios",
        tone: "warning",
      });
      if (!ok) return;
    }
    const propietarioId = form.propietario_cliente_id || form.cliente_id;
    const movimientoNombre = clientes.find(c=>c.id===form.cliente_movimiento_id)?.nombre || form.pedido_ref || "";
    const mv={
      ...form,
      cliente_id:propietarioId,
      propietario_cliente_id:propietarioId,
      obra_nombre:movimientoNombre,
      id:editando ? initial.id : "pmv_"+Date.now(),
      cantidad:Number(form.cantidad),
      precio_unitario:Number(form.precio_unitario||0),
      estado_salida: form.tipo==="devolucion" ? (form.estado_salida || "pendiente") : "confirmada",
    };
    if (typeof (editando ? onServerUpdate : onServerSave) === "function") {
      try {
        await (editando ? onServerUpdate : onServerSave)(mv);
      } catch (e) {
        notify("No se pudo guardar el movimiento: " + e.message, "error");
        return;
      }
    }

    // Auto-generate factura de devolucion
    if(false&&form.tipo==="devolucion"&&Number(form.cantidad)>0&&Number(form.precio_unitario)>0){
      setGenerandoFactura(true);
      try {
        const factura=await crearFactura({
          cliente_id:propietarioId,
          serie:"A",
          fecha:form.fecha,
          estado:"borrador",
          lineas:[{
            concepto:`Devolucion de palets - Albaran ${form.num_albaran} - ${Number(form.cantidad)} palets`,
            cantidad:Number(form.cantidad),
            precio_unit:Number(form.precio_unitario)
          }],
          observaciones:`Albaran num.: ${form.num_albaran}${form.pedido_ref?"  -  Ref. pedido: "+form.pedido_ref:""}${form.notas?"  -  "+form.notas:""}`,
        });
        setFacturaGenerada(factura);
        return; // Don't call onSaved yet - show confirmation
      } catch(e){
        notify("Movimiento registrado. Error al generar factura: "+e.message, "error");
      } finally { setGenerandoFactura(false); }
    }
    if(form.tipo==="devolucion" && mv.estado_salida==="pendiente"){
      notify("Devolucion preparada. No descuenta stock hasta confirmar la salida.", "success");
    }
    onSaved();
  }

  const TIPOS=[
    {v:"entrega",    l:"Entrega al cliente (salen de empresa)"},
    {v:"devolucion", l:"Devolucion del cliente (entran a empresa)"},
    {v:"rectificativa_devolucion", l:"Rectificativa de devolucion"},
    {v:"entrada_stock",l:"Entrada a stock (compra, etc.)"},
    {v:"salida_stock",l:"Salida de stock (baja, perdida)"},
  ];
  const TIPO_FORM_LABEL = {
    entrega: "Entrada de palets del cliente/obra (entran a empresa)",
    devolucion: "Devolucion al cliente/propietario (salen de empresa)",
    rectificativa_devolucion: "Rectificativa de devolucion (vuelven palets al stock)",
    entrada_stock: "Entrada a stock (compra, etc.)",
    salida_stock: "Salida de stock (baja, perdida)",
  };
  const esCliente=form.tipo==="entrega"||form.tipo==="devolucion"||form.tipo==="rectificativa_devolucion";
  const totalImporte=form.tipo==="devolucion"?Number(form.cantidad||0)*Number(form.precio_unitario||0):0;
  const lotesDisponibles = (() => {
    const propietarioId = form.propietario_cliente_id || form.cliente_id || "";
    if (form.tipo !== "devolucion" || !propietarioId) return [];
    const entradas = movimientos
      .filter(m => (m.tipo === "entrega" || esRectificativaDevolucion(m)) && String(m.propietario_cliente_id || m.cliente_id || "") === String(propietarioId))
      .map(m => ({ ...m, restante: Number(m.cantidad || 0) }))
      .filter(m => m.restante > 0)
      .sort((a,b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
    let salidas = movimientos
      .filter(m => m.tipo === "devolucion" && String(m.propietario_cliente_id || m.cliente_id || "") === String(propietarioId))
      .reduce((s,m) => s + Number(m.cantidad || 0), 0);
    entradas.forEach(m => {
      if (salidas <= 0) return;
      const usado = Math.min(m.restante, salidas);
      m.restante -= usado;
      salidas -= usado;
    });
    return entradas.filter(m => m.restante > 0);
  })();

  function imprimirAlbaran() {
    const cliente = clientes.find(cl=>cl.id===form.cliente_id);
    const obra = clientes.find(cl=>cl.id===form.cliente_movimiento_id);
    const obraNombre = obra?.nombre || form.pedido_ref || "";
    const direccionDevolucion = direccionCliente(obra) || direccionCliente(cliente);
    const fecha   = new Date(form.fecha+"T12:00:00").toLocaleDateString("es-ES");
    const win = window.open("","_blank","width=800,height=600");
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Albaran ${form.num_albaran||"BORRADOR"}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:30px;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:14px;border-bottom:3px solid #1a3a6e;}
  .doc-num{font-size:22px;font-weight:700;color:#1a3a6e;text-align:right;}
  .doc-label{font-size:10px;color:#666;letter-spacing:1px;text-transform:uppercase;text-align:right;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;}
  .box{border:1px solid #ddd;border-radius:4px;padding:12px;}
  .box-title{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}
  .box-val{font-size:13px;font-weight:600;}
  table{width:100%;border-collapse:collapse;margin:16px 0;}
  th{background:#1a3a6e;color:#fff;padding:8px 10px;text-align:left;font-size:11px;}
  td{padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;}
  .total-row{background:#f5f5f5;font-weight:700;font-size:14px;}
  .firma{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:30px;}
  .firma-box{border:1px solid #ddd;border-radius:4px;padding:10px;min-height:70px;}
  .firma-label{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
  .firma-line{margin-top:50px;border-top:1px solid #999;font-size:9px;color:#666;padding-top:3px;}
  @media print{@page{margin:1cm}body{padding:0}}
</style></head><body>
<div class="header">
  <div>
    <div style="font-size:18px;font-weight:700;color:#1a3a6e;">TransGest TMS</div>
    <div style="color:#555;font-size:11px;margin-top:4px;">Gestion de Almacen - Palets</div>
  </div>
  <div>
    <div class="doc-label">Albaran de devolucion</div>
    <div class="doc-num">${form.num_albaran||"BORRADOR"}</div>
    <div style="font-size:10px;color:#555;text-align:right;margin-top:4px;">${fecha}</div>
  </div>
</div>

<div class="grid2">
  <div class="box">
    <div class="box-title">Cliente / Remitente</div>
    <div class="box-val">${escHtml(cliente?.nombre||"-")}</div>
    ${cliente?.cif?`<div style="font-size:11px;color:#555;">CIF: ${escHtml(cliente.cif)}</div>`:""}
    ${cliente?.telefono?`<div style="font-size:11px;color:#555;">Tel: ${escHtml(cliente.telefono)}</div>`:""}
    ${direccionCliente(cliente)?`<div style="font-size:11px;color:#555;margin-top:4px;">${escHtml(direccionCliente(cliente))}</div>`:""}
  </div>
  <div class="box">
    <div class="box-title">Obra / destino de devolucion</div>
    <div class="box-val">${escHtml(obraNombre || "-")}</div>
    ${direccionDevolucion?`<div style="font-size:11px;color:#555;margin-top:4px;">Direccion devolucion: <b>${escHtml(direccionDevolucion)}</b></div>`:""}
    <div class="box-title" style="margin-top:10px;">Datos del documento</div>
    <div style="font-size:11px;color:#555;margin-bottom:3px;">Fecha: <b>${fecha}</b></div>
    ${form.pedido_ref?`<div style="font-size:11px;color:#555;">Ref. pedido: <b>${escHtml(form.pedido_ref)}</b></div>`:""}
    ${form.notas?`<div style="font-size:11px;color:#555;margin-top:4px;">${escHtml(form.notas)}</div>`:""}
  </div>
</div>

<table>
  <thead><tr>
    <th>Descripcion</th><th style="text-align:right;">Cantidad</th>
  </tr></thead>
  <tbody>
    <tr>
      <td>Devolucion de palets europeos</td>
      <td style="text-align:right;font-weight:600;">${form.cantidad} uds</td>
    </tr>
  </tbody>
</table>

<div class="firma">
  <div class="firma-box">
    <div class="firma-label">Firma del cliente / entregador</div>
    <div class="firma-line">Nombre y DNI</div>
  </div>
  <div class="firma-box">
    <div class="firma-label">Sello y firma almacen receptor</div>
    <div class="firma-line">Fecha y firma</div>
  </div>
</div>

<div style="margin-top:20px;text-align:center;font-size:9px;color:#aaa;border-top:1px solid #eee;padding-top:8px;">
  Documento generado por TransGest TMS  -  ${new Date().toLocaleString("es-ES")}
</div>
</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(()=>win.print(), 400);
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:22,width:"min(500px,96vw)"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:14}}>
          {editando ? "Editar movimiento de palets" : "Registrar movimiento de palets"}
        </div>
        <label style={lbl}>Tipo de movimiento</label>
        <select style={inp} value={form.tipo} onChange={f("tipo")} disabled={editando}>
          {TIPOS.map(t=><option key={t.v} value={t.v}>{TIPO_FORM_LABEL[t.v] || t.l}</option>)}
        </select>
        {form.tipo==="devolucion"&&(
          <div style={{marginTop:8,padding:"8px 10px",borderRadius:7,background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",fontSize:12,color:"var(--text3)"}}>
            La devolucion queda preparada y editable. El stock solo baja cuando pulses "Confirmar salida" en el historial.
          </div>
        )}
        {esCliente&&(<>
          <label style={lbl}>Propietario de los palets</label>
          <select style={inp} value={form.propietario_cliente_id || form.cliente_id} onChange={e=>setForm(p=>({...p,propietario_cliente_id:e.target.value,cliente_id:e.target.value}))}>
            <option value="">Seleccionar propietario...</option>
            {clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          {form.tipo==="devolucion" && (
            <div style={{marginTop:8,padding:"8px 10px",borderRadius:7,background:"var(--bg3)",border:"1px solid var(--border)",display:"grid",gap:6}}>
              <div style={{fontSize:11,fontWeight:800,color:"var(--text3)"}}>Palets registrados pendientes de devolver</div>
              {lotesDisponibles.length === 0 ? (
                <div style={{fontSize:11,color:"var(--text5)"}}>No hay lotes pendientes para este cliente.</div>
              ) : lotesDisponibles.map(lote => {
                const ref = lote.obra_nombre || lote.pedido_ref || lote.cliente_movimiento_nombre || lote.notas || "Sin referencia";
                return (
                  <button key={lote.id || `${lote.fecha}-${ref}`} type="button"
                    onClick={() => setForm(p => ({
                      ...p,
                      cantidad: String(Number(p.cantidad || 0) + Number(lote.restante || 0)),
                      pedido_ref: p.pedido_ref && p.pedido_ref !== ref ? `${p.pedido_ref} | ${ref}` : ref,
                      cliente_movimiento_id: lote.cliente_movimiento_id || p.cliente_movimiento_id || "",
                    }))}
                    style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",textAlign:"left",padding:"7px 9px",borderRadius:7,border:"1px solid rgba(249,115,22,.24)",background:"rgba(249,115,22,.07)",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                    <span style={{fontSize:12,fontWeight:800}}>{ref}</span>
                    <span style={{fontSize:11,color:"#f97316",fontWeight:900}}>{fmtN(lote.restante)} palets</span>
                  </button>
                );
              })}
            </div>
          )}
          <label style={lbl}>Obra / cliente del movimiento</label>
          <select style={inp} value={form.cliente_movimiento_id || ""} onChange={f("cliente_movimiento_id")}>
            <option value="">Sin cliente asociado / usar obra escrita</option>
            {clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </>)}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
          <div>
            <label style={lbl}>Cantidad de palets</label>
            <input type="number" min="1" style={inp} value={form.cantidad} onChange={f("cantidad")}/>
          </div>
          <div>
            <label style={lbl}>Fecha</label>
            <input type="date" style={inp} value={form.fecha} onChange={f("fecha")}/>
          </div>
          {form.tipo==="devolucion"&&(
            <div>
              <label style={{...lbl,color:"var(--green)"}}>Precio por palet devuelto (EUR) *</label>
              <input type="number" step="0.01" style={inp} value={form.precio_unitario} onChange={f("precio_unitario")} onFocus={e=>e.target.select()}/>
            </div>
          )}
          {form.tipo==="devolucion"&&(
            <div>
              <label style={{...lbl,color:"#10b981"}}>Importe total devolucion (EUR)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                style={{...inp,opacity:cantidadNumerica>0?1:.7}}
                value={totalImporte>0 ? Number(totalImporte.toFixed(2)) : ""}
                onChange={e=>actualizarImporteTotal(e.target.value)}
                onFocus={e=>e.target.select()}
                placeholder={cantidadNumerica>0 ? "Importe total" : "Primero indica cantidad"}
                disabled={cantidadNumerica<=0}
              />
            </div>
          )}
          {form.tipo==="devolucion"&&(
            <div style={{gridColumn:"1/-1"}}>
              <label style={{...lbl,color:"var(--red)"}}>Num. Albaran * (obligatorio en devoluciones)</label>
              <input style={{...inp,borderColor:!form.num_albaran?"rgba(239,68,68,.5)":"var(--border2)"}}
                value={form.num_albaran} onChange={f("num_albaran")}
                placeholder="Ej: ALB-2026-0042"/>
            </div>
          )}
          <div>
            <label style={lbl}>Obra / Ref.</label>
            <input style={inp} value={form.pedido_ref} onChange={f("pedido_ref")} placeholder="Obra tal, P0001..."/>
          </div>
        </div>
        {form.tipo==="devolucion"&&Number(form.cantidad)>0&&Number(form.precio_unitario)>0&&(
          <div style={{marginTop:10,padding:"8px 14px",background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.2)",borderRadius:7,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:"var(--text4)"}}>Importe devolucion ({form.cantidad} x {fmt2(form.precio_unitario)} EUR)</span>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:15,color:"#10b981"}}>{fmt2(totalImporte)} EUR</span>
          </div>
        )}
        <label style={lbl}>Notas</label>
        <input style={inp} value={form.notas} onChange={f("notas")} placeholder="Opcional"/>
        {facturaGenerada&&(
          <div style={{marginTop:12,padding:"10px 14px",background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.25)",borderRadius:8}}>
            <div style={{fontWeight:700,color:"var(--green)",fontSize:13,marginBottom:4}}>Factura borrador generada: {facturaGenerada.numero}</div>
            <div style={{fontSize:12,color:"var(--text4)"}}>Ve a Facturacion para emitirla. El movimiento ya ha sido registrado.</div>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button onClick={imprimirAlbaran} style={{padding:"6px 14px",borderRadius:6,border:"none",
                background:"#f59e0b",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
                Imprimir albaran
              </button>
              <button onClick={onSaved} style={{padding:"6px 14px",borderRadius:6,border:"none",background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Aceptar y cerrar</button></div>
          </div>
        )}
        {!facturaGenerada&&<div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end",flexWrap:"wrap"}}>
          {form.tipo==="devolucion"&&form.num_albaran&&form.cliente_id&&(
            <button onClick={imprimirAlbaran}
              style={{padding:"7px 14px",borderRadius:7,border:"1px solid rgba(245,158,11,.4)",
                background:"rgba(245,158,11,.08)",color:"#f59e0b",cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600}}>
              Previsualizar albaran
            </button>
          )}
          <button onClick={onClose} style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
          <button onClick={guardar} disabled={generandoFactura} style={{padding:"7px 16px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>{generandoFactura?"Generando...":(editando?"Guardar cambios":"Registrar")}</button>
        </div>}
      </div>
    </div>
  );
}

// 

// Generar albaran desde historial
function generarHtmlAlbaran(mv, cliente, empresa, obraCliente) {
  const fecha = new Date((mv.fecha||"")+"T12:00:00").toLocaleDateString("es-ES");
  const empNombre = empresa?.razon_social || empresa?.nombre || "TransGest TMS";
  const empCif    = empresa?.cif || "";
  const empDir    = empresa?.domicilio || empresa?.direccion || "";
  const empTel    = empresa?.telefono || "";
  const obraNombre = obraCliente?.nombre || mv.obra_nombre || mv.cliente_movimiento_nombre || mv.pedido_ref || "";
  const direccionDevolucion = direccionCliente(obraCliente) || direccionCliente(cliente);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Albaran ${mv.num_albaran||"HISTORICO"}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:30px;}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:12px;border-bottom:2px solid #1a3a6e;}.doc-num{font-size:22px;font-weight:700;color:#1a3a6e;text-align:right;}.doc-label{font-size:10px;color:#666;letter-spacing:1px;text-transform:uppercase;text-align:right;}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;}.box{border:1px solid #ddd;border-radius:4px;padding:12px;}.box-title{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}.box-val{font-size:13px;font-weight:600;}table{width:100%;border-collapse:collapse;margin:16px 0;}th{background:#1a3a6e;color:#fff;padding:8px 10px;text-align:left;font-size:11px;}td{padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;}.total-row{background:#f5f5f5;font-weight:700;font-size:14px;}.firma{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:30px;}.firma-box{border:1px solid #ddd;border-radius:4px;padding:10px;min-height:70px;}.firma-label{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}.firma-line{margin-top:50px;border-top:1px solid #999;font-size:9px;color:#666;padding-top:3px;}@media print{@page{margin:1cm}body{padding:0}}</style></head><body>
<div class="header"><div><div style="font-size:18px;font-weight:700;color:#1a3a6e;">${escHtml(empNombre)}</div>${empCif?`<div style="color:#555;font-size:11px;">CIF: ${escHtml(empCif)}</div>`:""} ${empDir?`<div style="color:#555;font-size:11px;">${escHtml(empDir)}</div>`:""} ${empTel?`<div style="color:#555;font-size:11px;">Tel: ${escHtml(empTel)}</div>`:""}<div style="color:#555;font-size:11px;margin-top:4px;">Gestion de Almacen - Palets</div></div><div><div class="doc-label">Albaran de devolucion</div><div class="doc-num">${escHtml(mv.num_albaran||"HISTORICO")}</div><div style="font-size:10px;color:#555;text-align:right;margin-top:4px;">${fecha}</div></div></div>
<div class="grid2"><div class="box"><div class="box-title">Cliente</div><div class="box-val">${escHtml(cliente?.nombre||"-")}</div>${cliente?.cif?`<div style="font-size:11px;color:#555;">CIF: ${escHtml(cliente.cif)}</div>`:""}${direccionCliente(cliente)?`<div style="font-size:11px;color:#555;margin-top:4px;">${escHtml(direccionCliente(cliente))}</div>`:""}</div><div class="box"><div class="box-title">Obra / destino de devolucion</div><div class="box-val">${escHtml(obraNombre || "-")}</div>${direccionDevolucion?`<div style="font-size:11px;color:#555;margin-top:4px;">Direccion devolucion: <b>${escHtml(direccionDevolucion)}</b></div>`:""}<div class="box-title" style="margin-top:10px;">Documento</div><div style="font-size:11px;color:#555;">Fecha: <b>${fecha}</b></div>${mv.pedido_ref?`<div style="font-size:11px;color:#555;">Ref: <b>${escHtml(mv.pedido_ref)}</b></div>`:""} ${mv.notas?`<div style="font-size:11px;color:#555;">${escHtml(mv.notas)}</div>`:""}</div></div>
<table><thead><tr><th>Descripcion</th><th style="text-align:right;">Cantidad</th></tr></thead><tbody><tr><td>Devolucion de palets europeos</td><td style="text-align:right;font-weight:600;">${mv.cantidad} uds</td></tr></tbody></table>
<div class="firma"><div class="firma-box"><div class="firma-label">Firma cliente</div><div class="firma-line">Nombre y DNI</div></div><div class="firma-box"><div class="firma-label">Sello almacen</div><div class="firma-line">Fecha y firma</div></div></div>
</body></html>`;
}

function generarHtmlDevClienteInforme({ grupos, movimientos, empresa, filtroNombre, periodoTexto }) {
  const empNombre = empresa?.razon_social || empresa?.nombre || "TransGest TMS";
  const empCif = empresa?.cif || "";
  const empDir = empresa?.domicilio || empresa?.direccion || "";
  const empTel = empresa?.telefono || "";
  const fecha = new Date().toLocaleString("es-ES");
  const totalEntradas = grupos.reduce((s,g)=>s+Number(g.entradas||0),0);
  const totalDevueltas = grupos.reduce((s,g)=>s+Number(g.devoluciones||0),0);
  const totalPreparadas = grupos.reduce((s,g)=>s+Number(g.preparadas||0),0);
  const totalImporte = grupos.reduce((s,g)=>s+Number(g.importe||0),0);
  const rows = grupos.map(g => `
    <section class="cliente">
      <div class="cliente-head">
        <div>
          <h2>${escHtml(g.nombre)}</h2>
          <div class="muted">${fmtN(g.movimientos.length)} registros separados</div>
        </div>
        <div class="chips">
          <span>${fmtN(g.entradas)} entradas</span>
          <span>${fmtN(g.devoluciones)} devueltas</span>
          <span>${fmtN(g.preparadas)} preparadas</span>
          <strong>${fmt2(g.importe)} EUR</strong>
        </div>
      </div>
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Obra / origen</th><th>Albaran</th><th>Ref.</th><th>Importe</th><th>Estado</th></tr></thead>
        <tbody>
          ${g.movimientos.map(m => {
            const pendiente = m.tipo === "devolucion" && !salidaPaletsConfirmada(m);
            const importe = m.tipo === "devolucion" ? Number(m.cantidad || 0) * Number(m.precio_unitario || 0) : 0;
            const estado = pendiente ? "Preparada" : m.factura_id ? "Facturada" : "Registrada";
            const signoMov = signoPaletsMovimiento(m);
            const signo = signoMov > 0 ? "+" : signoMov < 0 ? "-" : "";
            const tipoInforme = m.tipo === "devolucion" ? "Devolucion" : esRectificativaDevolucion(m) ? "Rectificativa" : "Entrada";
            return `<tr>
              <td>${escHtml(String(m.fecha || "-").slice(0,10))}</td>
              <td>${escHtml(tipoInforme)}</td>
              <td class="num">${signo}${fmtN(m.cantidad)}</td>
              <td>${escHtml(m.obra_nombre || m.cliente_movimiento_nombre || m.notas || "-")}</td>
              <td>${escHtml(m.num_albaran || "-")}</td>
              <td>${escHtml(m.pedido_ref || "-")}</td>
              <td class="num">${importe > 0 ? `${fmt2(importe)} EUR` : "-"}</td>
              <td>${escHtml(estado)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </section>
  `).join("");

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Informe Dev. Cliente</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:30px;background:#fff}.header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:3px solid #1a3a6e;padding-bottom:14px;margin-bottom:18px}.brand{font-size:18px;font-weight:700;color:#1a3a6e}.doc{font-size:10px;color:#666;letter-spacing:1px;text-transform:uppercase;text-align:right}.doc-title{font-size:22px;font-weight:700;color:#1a3a6e;text-align:right}.muted{color:#666;font-size:11px}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:16px 0}.kpi{border:1px solid #ddd;border-radius:4px;padding:10px}.kpi strong{display:block;font-size:16px;color:#1a3a6e}.cliente{page-break-inside:avoid;margin-top:16px;border:1px solid #ddd;border-radius:4px;overflow:hidden}.cliente-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;background:#f7f9fc;border-bottom:1px solid #ddd;padding:10px 12px}.cliente h2{font-size:14px;color:#111}.chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.chips span,.chips strong{border:1px solid #ddd;border-radius:20px;background:#fff;padding:3px 8px;font-size:10px}table{width:100%;border-collapse:collapse}th{background:#1a3a6e;color:#fff;padding:7px 8px;text-align:left;font-size:10px}td{padding:7px 8px;border-bottom:1px solid #eee}.num{text-align:right;font-family:Consolas,monospace;font-weight:700}.footer{margin-top:20px;border-top:1px solid #eee;padding-top:8px;text-align:center;color:#999;font-size:9px}@media print{@page{margin:1cm}body{padding:0}.cliente{break-inside:avoid}}
</style></head><body>
<div class="header">
  <div>
    <div class="brand">${escHtml(empNombre)}</div>
    ${empCif ? `<div class="muted">CIF: ${escHtml(empCif)}</div>` : ""}
    ${empDir ? `<div class="muted">${escHtml(empDir)}</div>` : ""}
    ${empTel ? `<div class="muted">Tel: ${escHtml(empTel)}</div>` : ""}
  </div>
  <div>
    <div class="doc">Gestion de Almacen</div>
    <div class="doc-title">Informe Dev. Cliente</div>
    <div class="muted">${escHtml(fecha)}</div>
  </div>
</div>
<div class="muted">Filtro: <b>${escHtml(filtroNombre || "Todos los clientes")}</b>${periodoTexto ? ` · Periodo: <b>${escHtml(periodoTexto)}</b>` : ""}</div>
<div class="summary">
  <div class="kpi"><strong>${fmtN(grupos.length)}</strong> clientes</div>
  <div class="kpi"><strong>${fmtN(movimientos.length)}</strong> registros</div>
  <div class="kpi"><strong>${fmtN(totalEntradas)}</strong> entradas</div>
  <div class="kpi"><strong>${fmtN(totalDevueltas + totalPreparadas)}</strong> devoluciones</div>
  <div class="kpi"><strong>${fmt2(totalImporte)} EUR</strong> importe</div>
</div>
${rows || `<div class="muted">Sin movimientos de cliente registrados.</div>`}
<div class="footer">${escHtml(empNombre)} - Informe generado por TransGest TMS - ${escHtml(fecha)}</div>
</body></html>`;
}

export default function Palets(){
    const [movimientos,setMovimientos]=useState([]);
    const [clientes,setClientes]=useState([]);
    const [empresaCfg,setEmpresaCfg]=useState({});
    const [modal,setModal]=useState(false);
  const [movimientoEditando,setMovimientoEditando]=useState(null);
  const [tab,setTab]=useState("stock"); // stock | dev_cliente | historial | almacenes
    const [filtroCliente,setFiltroCliente]=useState("todos");
    const [devDesde,setDevDesde]=useState("");
    const [devHasta,setDevHasta]=useState("");
    const empresa = useEmpresaPerfil();
    const cfgPalets = normalizePaletsCfg(empresaCfg?.cfg_precios?.palets);

  function normalizarMovimientoApi(m){
    return {
      ...m,
      propietario_cliente_id: m.propietario_cliente_id || m.cliente_id || "",
      cliente_movimiento_id: m.cliente_movimiento_id || "",
      cliente_id: m.propietario_cliente_id || m.cliente_id || "",
      cliente_nombre: m.propietario_nombre || m.cliente_nombre || "",
      obra_nombre: m.obra_nombre || m.cliente_movimiento_nombre || m.pedido_ref || m.notas || "",
      cantidad: Number(m.cantidad || 0),
      precio_unitario: Number(m.precio_unitario || 0),
      estado_salida: m.estado_salida || (m.tipo === "devolucion" ? "confirmada" : "confirmada"),
    };
  }

  const cargarMovimientos = useCallback(async function cargarMovimientos(){
    try {
      const data = await getPaletMovimientos();
      const arr = Array.isArray(data) ? data : [];
      setMovimientos(arr.map(normalizarMovimientoApi));
    } catch {
      setMovimientos([]);
    }
  }, []);

    useEffect(()=>{
      getClientes().then(d=>setClientes(Array.isArray(d?.data)?d.data:Array.isArray(d)?d:[])).catch(()=>{});
      cargarMovimientos();
    },[cargarMovimientos]);

    useEffect(() => {
      let alive = true;
      async function cargarConfig() {
        try {
          let cfgEmpresaObj = await getEmpresaConfig().catch(() => ({}));
          cfgEmpresaObj = cfgEmpresaObj && typeof cfgEmpresaObj === "object" ? cfgEmpresaObj : {};
          if (alive) setEmpresaCfg(cfgEmpresaObj);
          if (!cfgEmpresaObj?.cfg_precios?.palets) {
            try {
              const legacyCfg = JSON.parse(localStorage.getItem("tms_palets_cfg") || "null");
              if (legacyCfg && typeof legacyCfg === "object") {
                const nextPrecios = {
                  ...(cfgEmpresaObj?.cfg_precios || {}),
                  palets: normalizePaletsCfg(legacyCfg),
                };
                await setConfigPrecios(nextPrecios);
                cfgEmpresaObj = { ...cfgEmpresaObj, cfg_precios: nextPrecios };
                if (alive) setEmpresaCfg(cfgEmpresaObj);
                localStorage.removeItem("tms_palets_cfg");
              }
            } catch {}
          }
        } catch {}
      }
      cargarConfig();
      return () => { alive = false; };
    }, []);

  async function guardarMovimientoServidor(mv){
    await crearPaletMovimiento({
      tipo: mv.tipo,
      cantidad: mv.cantidad,
      precio_unitario: mv.precio_unitario,
      cliente_movimiento_id: mv.cliente_movimiento_id || null,
      propietario_cliente_id: mv.propietario_cliente_id || mv.cliente_id || null,
      fecha: mv.fecha,
      pedido_ref: mv.pedido_ref,
      num_albaran: mv.num_albaran,
      notas: mv.notas,
      estado_salida: mv.estado_salida,
    });
    await cargarMovimientos();
  }

  async function editarMovimientoServidor(mv){
    await editarPaletMovimiento(mv.id, {
      tipo: mv.tipo,
      cantidad: mv.cantidad,
      precio_unitario: mv.precio_unitario,
      cliente_movimiento_id: mv.cliente_movimiento_id || null,
      propietario_cliente_id: mv.propietario_cliente_id || mv.cliente_id || null,
      fecha: mv.fecha,
      pedido_ref: mv.pedido_ref,
      num_albaran: mv.num_albaran,
      notas: mv.notas,
      estado_salida: mv.estado_salida,
    });
    await cargarMovimientos();
  }

  async function generarFacturaDevolucion(mv){
    if (mv.factura_id || mv.tipo !== "devolucion" || !Number(mv.precio_unitario || 0)) return null;
    return crearFactura({
      cliente_id: mv.propietario_cliente_id || mv.cliente_id,
      serie:"A",
      fecha: mv.fecha || new Date().toISOString().slice(0,10),
      estado:"borrador",
      lineas:[{
        concepto:`Devolucion de palets - Albaran ${mv.num_albaran || ""} - ${Number(mv.cantidad)} palets`,
        cantidad:Number(mv.cantidad),
        precio_unit:Number(mv.precio_unitario || 0),
      }],
      observaciones:`Albaran: ${mv.num_albaran || "-"}${mv.pedido_ref ? " - Ref: "+mv.pedido_ref : ""}${mv.notas ? " - "+mv.notas : ""}`,
    });
  }

  async function vincularFacturaMovimiento(mv, factura){
    if (!factura?.id) return;
    if (!String(mv.id || "").startsWith("pmv_")) {
      await editarPaletMovimiento(mv.id, {
        tipo: mv.tipo,
        cantidad: mv.cantidad,
        precio_unitario: mv.precio_unitario,
        cliente_movimiento_id: mv.cliente_movimiento_id || null,
        propietario_cliente_id: mv.propietario_cliente_id || mv.cliente_id || null,
        fecha: mv.fecha,
        pedido_ref: mv.pedido_ref,
        num_albaran: mv.num_albaran,
        notas: mv.notas,
        factura_id: factura.id,
        estado_salida: mv.estado_salida,
      });
      await cargarMovimientos();
      return;
    }
    setMovimientos(prev => prev.map(m => m.id===mv.id ? { ...m, factura_id: factura.id } : m));
  }

  async function generarFacturaManual(mv){
    try {
      const factura = await generarFacturaDevolucion(mv);
      if (!factura?.id) {
        notify("Esta devolucion ya tiene factura o no tiene importe para facturar.", "warning");
        return;
      }
      await vincularFacturaMovimiento(mv, factura);
      notify(`Factura borrador generada: ${factura.numero || factura.id}`, "success");
    } catch (e) {
      notify("No se pudo generar la factura borrador: " + e.message, "error");
    }
  }

  async function borrarDevolucionPreparada(mv){
    const ok = await confirmDialog({
      title: "Eliminar devolucion preparada",
      message: "Se eliminara esta devolucion pendiente. Podras volver a crearla despues si hace falta.",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      if (!String(mv.id || "").startsWith("pmv_")) {
        await borrarPaletMovimiento(mv.id);
        await cargarMovimientos();
      } else {
        setMovimientos(prev => prev.filter(m => m.id !== mv.id));
      }
      notify("Devolucion preparada eliminada.", "success");
    } catch (e) {
      notify("No se pudo eliminar la devolucion preparada: " + e.message, "error");
    }
  }

  async function confirmarSalida(mv){
    try {
      let factura = null;
      if (!String(mv.id || "").startsWith("pmv_")) {
        await confirmarSalidaPaletMovimiento(mv.id);
        try {
          factura = await generarFacturaDevolucion(mv);
          if (factura?.id) await confirmarSalidaPaletMovimiento(mv.id, { factura_id: factura.id });
        } catch (e) {
          notify("Salida confirmada, pero no se ha podido generar la factura borrador: " + e.message, "warning");
        }
        await cargarMovimientos();
      } else {
        try {
          factura = await generarFacturaDevolucion(mv);
        } catch (e) {
          notify("Salida confirmada, pero no se ha podido generar la factura borrador: " + e.message, "warning");
        }
        setMovimientos(prev => prev.map(m => m.id===mv.id ? {
          ...m,
          estado_salida:"confirmada",
          salida_confirmada_at:new Date().toISOString(),
          factura_id: factura?.id || m.factura_id,
        } : m));
      }
      if (factura?.numero) {
        notify(`Salida confirmada. Factura borrador ${factura.numero} generada y vinculada.`, "success");
      } else if (factura?.id) {
        notify("Salida confirmada. Factura borrador generada y vinculada.", "success");
      } else {
        notify("Salida de palets confirmada. Ahora descuenta del stock.", "success");
      }
    } catch (e) {
      notify("No se pudo confirmar la salida: " + e.message, "error");
    }
  }

  async function rectificarDevolucion(mv){
    if (mv.tipo !== "devolucion" || !salidaPaletsConfirmada(mv)) {
      notify("Solo se pueden rectificar devoluciones ya confirmadas.", "warning");
      return;
    }
    const yaRectificado = movimientos
      .filter(m => esRectificativaDevolucion(m) && String(m.notas || "").includes(String(mv.id || "")))
      .reduce((s,m) => s + Number(m.cantidad || 0), 0);
    const maximo = Math.max(0, Number(mv.cantidad || 0) - yaRectificado);
    if (maximo <= 0) {
      notify("Esta devolucion ya esta rectificada por completo.", "warning");
      return;
    }
    const respuesta = await promptDialog({
      title: "Rectificar devolucion de palets",
      message: `Indica cuantos palets vuelven al stock. Maximo disponible: ${fmtN(maximo)}.`,
      placeholder: `Max. ${fmtN(maximo)}`,
      defaultValue: String(maximo),
      inputType: "number",
      confirmText: "Rectificar",
      tone: "warning",
    });
    if (respuesta === null) return;
    const cantidad = Math.trunc(Number(respuesta));
    if (!cantidad || cantidad <= 0) {
      notify("Indica una cantidad valida de palets a rectificar.", "warning");
      return;
    }
    if (cantidad > maximo) {
      notify(`No puedes rectificar mas de ${fmtN(maximo)} palets en esta devolucion.`, "warning");
      return;
    }
    const ok = await confirmDialog({
      title: "Confirmar rectificativa",
      message: `Se devolveran ${fmtN(cantidad)} palets al stock manteniendo la devolucion original en el historial.`,
      confirmText: "Crear rectificativa",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await crearPaletMovimiento({
        tipo: "rectificativa_devolucion",
        cantidad,
        precio_unitario: 0,
        cliente_movimiento_id: mv.cliente_movimiento_id || null,
        propietario_cliente_id: mv.propietario_cliente_id || mv.cliente_id || null,
        fecha: new Date().toISOString().slice(0,10),
        pedido_ref: `Rectifica ${mv.num_albaran || mv.pedido_ref || String(mv.id || "").slice(0,8)}`,
        num_albaran: mv.num_albaran || "",
        notas: `Rectificativa de devolucion original ${mv.id || "-"}${mv.obra_nombre ? " | Obra: "+mv.obra_nombre : ""}${mv.notas ? " | "+mv.notas : ""}`,
        estado_salida: "confirmada",
      });
      await cargarMovimientos();
      notify("Rectificativa creada. Los palets vuelven a contar en stock.", "success");
    } catch (e) {
      notify("No se pudo crear la rectificativa: " + e.message, "error");
    }
  }

  function recargar(){ cargarMovimientos(); setModal(false); setMovimientoEditando(null); }

  function abrirNuevaDevolucion(cliente){
    const pendiente = Math.max(0, Number(cliente.entregas || 0) - Number(cliente.devoluciones || 0) - Number(cliente.pendientesSalida || 0));
    setMovimientoEditando({
      tipo: "devolucion",
      cliente_id: cliente.id,
      propietario_cliente_id: cliente.id,
      cliente_movimiento_id: "",
      cantidad: pendiente > 0 ? String(pendiente) : "",
      fecha: new Date().toISOString().slice(0,10),
      pedido_ref: "",
      precio_unitario: String(cfgPalets?.precio_devolucion || DEFAULT_PALETS_CFG.precio_devolucion),
      notas: "",
      num_albaran: "",
      estado_salida: "pendiente",
    });
    setModal(true);
  }

  const stockEmpresa = getStockEmpresa(movimientos);

  // Stock pendiente por cliente
  const clientesConPalets = clientes.map(c=>{
    const clienteNombre = String(c.nombre || "").toLowerCase().trim();
    const clienteNombreCorto = clienteNombre.slice(0, 12);
    const mvsCli = movimientos.filter(m=>
      clienteIdMovimiento(m)===c.id ||
      (m.propietario_nombre && clienteNombre &&
        m.propietario_nombre.toLowerCase().trim() === clienteNombre) ||
      (m.cliente_nombre && c.nombre &&
        m.cliente_nombre.toLowerCase().trim() === c.nombre.toLowerCase().trim()) ||
      (m.propietario_nombre && clienteNombreCorto &&
        m.propietario_nombre.toLowerCase().includes(clienteNombreCorto)) ||
      (m.cliente_nombre && clienteNombreCorto &&
        m.cliente_nombre.toLowerCase().includes(clienteNombreCorto))
    );
    const stock=mvsCli.reduce((s,m)=>{
      if(m.tipo==="entrega") return s+Number(m.cantidad||0);
      if(esRectificativaDevolucion(m)) return s+Number(m.cantidad||0);
      if(m.tipo==="devolucion") return salidaPaletsConfirmada(m) ? s-Number(m.cantidad||0) : s;
      return s;
    },0);
    const entregas=mvsCli.filter(m=>m.tipo==="entrega" || esRectificativaDevolucion(m)).reduce((s,m)=>s+Number(m.cantidad||0),0);
    const rectificadas=mvsCli.filter(esRectificativaDevolucion).reduce((s,m)=>s+Number(m.cantidad||0),0);
    const devolucionesConfirmadas = mvsCli.filter(m=>m.tipo==="devolucion" && salidaPaletsConfirmada(m));
    const devolucionesPendientesSalida = mvsCli.filter(m=>m.tipo==="devolucion" && !salidaPaletsConfirmada(m));
    const devoluciones=devolucionesConfirmadas.reduce((s,m)=>s+Number(m.cantidad||0),0);
    const pendientesSalida=devolucionesPendientesSalida.reduce((s,m)=>s+Number(m.cantidad||0),0);
    const importeDevoluciones=devolucionesConfirmadas.reduce((s,m)=>s+Number(m.cantidad||0)*Number(m.precio_unitario||0),0);
    const devolucionesDetalle = Object.values(devolucionesConfirmadas.reduce((acc,m)=>{
      const key = m.obra_nombre || m.pedido_ref || m.cliente_movimiento_nombre || m.notas || "Sin obra/ref";
      if(!acc[key]) acc[key] = { nombre:key, cantidad:0, importe:0 };
      acc[key].cantidad += Number(m.cantidad||0);
      acc[key].importe += Number(m.cantidad||0)*Number(m.precio_unitario||0);
      return acc;
    },{}));
    const pendientesSalidaDetalle = Object.values(devolucionesPendientesSalida.reduce((acc,m)=>{
      const key = m.obra_nombre || m.pedido_ref || m.cliente_movimiento_nombre || m.notas || "Sin obra/ref";
      if(!acc[key]) acc[key] = { nombre:key, cantidad:0, movimientos:[] };
      acc[key].cantidad += Number(m.cantidad||0);
      acc[key].movimientos.push(m);
      return acc;
    },{}));
    return{...c,stock,entregas,rectificadas,devoluciones,pendientesSalida,importeDevoluciones,devolucionesDetalle,pendientesSalidaDetalle};
  }).filter(c=>c.entregas>0||c.devoluciones>0||c.stock!==0||c.pendientesSalida>0);

  const totalPendiente=clientesConPalets.reduce((s,c)=>s+Math.max(0,c.entregas-c.devoluciones),0);
  const totalDevuelto=clientesConPalets.reduce((s,c)=>s+Number(c.devoluciones||0),0);
  const totalSalidasPreparadas=clientesConPalets.reduce((s,c)=>s+Number(c.pendientesSalida||0),0);
  const alertasAntiguedad = buildAlertasAntiguedadPalets(movimientos, clientes, cfgPalets);
  const alertasCriticas = alertasAntiguedad.filter(a => a.nivel === "critica");
  const totalPaletsEnAlerta = alertasAntiguedad.reduce((s,a)=>s+Number(a.palets||0),0);
  const costeAlmacenajeEstimado = alertasAntiguedad.reduce((s,a)=>s+Number(a.coste_estimado||0),0);

  const mvsFiltrados = filtroCliente==="todos"
    ? movimientos
    : movimientos.filter(m=>
        clienteIdMovimiento(m)===filtroCliente ||
        (m.propietario_nombre && clientes.find(c=>c.id===filtroCliente)?.nombre &&
         m.propietario_nombre.toLowerCase().includes(clientes.find(c=>c.id===filtroCliente).nombre.toLowerCase().slice(0,8))) ||
        (m.cliente_nombre && clientes.find(c=>c.id===filtroCliente)?.nombre &&
         m.cliente_nombre.toLowerCase().includes(clientes.find(c=>c.id===filtroCliente).nombre.toLowerCase().slice(0,8)))
      );

  function clienteIdMovimiento(m) {
    return m.propietario_cliente_id || m.cliente_id || "";
  }

  function clienteNombreMovimiento(m) {
    const id = clienteIdMovimiento(m);
    return clientes.find(c => c.id === id)?.nombre || m.cliente_nombre || m.propietario_nombre || "Cliente sin identificar";
  }

  const movimientosCliente = movimientos
    .filter(m => ["entrega", "devolucion", "rectificativa_devolucion"].includes(m.tipo))
    .filter(m => filtroCliente === "todos" || clienteIdMovimiento(m) === filtroCliente)
    .filter(m => !devDesde || String(m.fecha || "").slice(0,10) >= devDesde)
    .filter(m => !devHasta || String(m.fecha || "").slice(0,10) <= devHasta)
    .slice()
    .sort((a,b) => String(b.fecha || "").localeCompare(String(a.fecha || "")) || String(b.created_at || "").localeCompare(String(a.created_at || "")));

  const movimientosPorCliente = Object.values(movimientosCliente.reduce((acc, m) => {
    const key = clienteIdMovimiento(m) || `sin_cliente_${clienteNombreMovimiento(m)}`;
    if (!acc[key]) {
      acc[key] = {
        id: key,
        nombre: clienteNombreMovimiento(m),
        entradas: 0,
        devoluciones: 0,
        preparadas: 0,
        importe: 0,
        movimientos: [],
      };
    }
    if (m.tipo === "entrega" || esRectificativaDevolucion(m)) acc[key].entradas += Number(m.cantidad || 0);
    if (m.tipo === "devolucion" && salidaPaletsConfirmada(m)) {
      acc[key].devoluciones += Number(m.cantidad || 0);
      acc[key].importe += Number(m.cantidad || 0) * Number(m.precio_unitario || 0);
    }
    if (m.tipo === "devolucion" && !salidaPaletsConfirmada(m)) acc[key].preparadas += Number(m.cantidad || 0);
    acc[key].movimientos.push(m);
    return acc;
  }, {})).sort((a,b) => a.nombre.localeCompare(b.nombre, "es"));

  function abrirInformeDevCliente() {
    const filtroNombre = filtroCliente === "todos"
      ? "Todos los clientes"
      : clientes.find(c => c.id === filtroCliente)?.nombre || "Cliente seleccionado";
    const periodoTexto = devDesde || devHasta
      ? `${devDesde || "inicio"} - ${devHasta || "hoy"}`
      : "";
    const win = window.open("", "_blank", "width=1000,height=700");
    if (!win) {
      notify("No se pudo abrir el informe. Revisa el bloqueador de ventanas emergentes.", "warning");
      return;
    }
    win.document.write(generarHtmlDevClienteInforme({
      grupos: movimientosPorCliente,
      movimientos: movimientosCliente,
      empresa,
      filtroNombre,
      periodoTexto,
    }));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  const TIPO_COLOR={entrega:"#f97316",devolucion:"#10b981",rectificativa_devolucion:"#8b5cf6",entrada_stock:"#3b82f6",salida_stock:"#ef4444"};
  const TIPO_LABEL={entrega:"Entrada cliente/obra",devolucion:"Devolucion propietario",rectificativa_devolucion:"Rectificativa devolucion",entrada_stock:"Entrada stock",salida_stock:"Salida stock"};
  const TIPO_ICON={entrega:"ENT",devolucion:"DEV",rectificativa_devolucion:"REC",entrada_stock:"ALT",salida_stock:"SAL"};

  const S={
    card:{background:"rgba(255,255,255,.96)",border:"1px solid #dbe5ec",borderRadius:12,padding:"18px 20px",marginBottom:16,boxShadow:"0 12px 30px rgba(15,23,42,.055)"},
    btn:{padding:"10px 15px",borderRadius:8,border:"1px solid #dbe5ec",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:7,background:"#fff",color:"#0f172a"},
    th:{textAlign:"left",padding:"12px 12px",fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".07em",color:"#64748b",borderBottom:"1px solid #dbe5ec",background:"#f8fbfd"},
    td:{padding:"13px 12px",borderBottom:"1px solid #e2e8f0",fontSize:13,color:"#334155"},
    inp:{background:"#fff",border:"1px solid #cfdbe5",color:"#0f172a",padding:"10px 12px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box"},
    lbl:{display:"block",fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".07em",color:"#64748b",marginBottom:5,marginTop:10},
  };

  return(
    <div style={{flex:1, padding:"30px 36px",fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",background:"linear-gradient(180deg,#f8fbfd 0%,#ffffff 44%,#f7fafc 100%)"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:26,flexWrap:"wrap"}}>
        <div style={{width:44,height:44,borderRadius:10,border:"1px solid #dbe5ec",background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>⌂</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:34,fontWeight:900,color:"#0f172a"}}>Gestion de almacen</div>
        <button onClick={()=>{setMovimientoEditando(null);setModal(true);}} style={{...S.btn,background:"linear-gradient(180deg,#008b82,#006f68)",color:"#fff",fontSize:15,fontWeight:800,marginLeft:"auto",border:"1px solid #007f78",padding:"13px 22px",boxShadow:"0 12px 22px rgba(0,111,104,.18)"}}>
          + Registrar movimiento
        </button>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:14,marginBottom:24}}>
        {[
          ["Stock empresa",stockEmpresa,"palets",stockEmpresa>0?"#10b981":"#f59e0b","□"],
          ["Pendientes devolucion",totalPendiente,"palets",totalPendiente>0?"#f97316":"#10b981","↶"],
          ["Salidas preparadas",totalSalidasPreparadas,"palets",totalSalidasPreparadas>0?"#f59e0b":"#10b981","↑"],
          ["Alertas antiguedad",alertasAntiguedad.length,"lotes",alertasCriticas.length>0?"#ef4444":alertasAntiguedad.length>0?"#f59e0b":"#10b981","!"],
          ["Devueltos registrados",totalDevuelto,"palets","#10b981","▣"],
          ["Clientes con palets",clientesConPalets.filter(c=>c.stock>0).length,"clientes","#3b82f6","☷"],
          ["Total movimientos",movimientos.length,"registros","#64748b","⌁"],
        ].map(([l,v,u,c,icon])=>(
          <div key={l} style={{...S.card,padding:"18px 16px",marginBottom:0,display:"flex",alignItems:"center",gap:13,minHeight:92}}>
            <div style={{width:50,height:50,borderRadius:"50%",background:`${c}18`,color:c,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:900,flex:"0 0 auto"}}>
              {icon}
            </div>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:24,color:c,lineHeight:1}}>{fmtN(v)}</div>
              <div style={{fontSize:11,color:"#334155",textTransform:"uppercase",letterSpacing:".05em",fontWeight:900,marginTop:6}}>{l}</div>
              <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{u}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:22,borderBottom:"1px solid #dbe5ec",marginBottom:18}}>
        {[["stock","Palets / cliente"],["dev_cliente","Dev. Cliente"],["almacen_propio","Mercancia propia"],["almacen_cliente","Almacen cliente"],["historial","Historial"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)} style={{...S.btn,border:"none",borderRadius:0,borderBottom:`2px solid ${tab===id?"#008b82":"transparent"}`,color:tab===id?"#006f68":"#64748b",background:"transparent",padding:"0 0 13px",fontSize:14,fontWeight:800,boxShadow:"none"}}>
            {l}
          </button>
        ))}
      </div>

      {/* Stock empresa */}
      {tab==="stock"&&(
        <div style={S.card}>
          <div style={{fontWeight:900,fontSize:18,color:"#0f172a",marginBottom:16}}>Estado actual del almacen de palets</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:18}}>
            <div style={{background:"linear-gradient(90deg,rgba(16,185,129,.11),rgba(255,255,255,.9))",borderRadius:10,padding:"22px",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:24}}>
              <div style={{width:58,height:58,borderRadius:"50%",background:"rgba(16,185,129,.13)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,color:"#009b7d"}}>□</div>
              <div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:36,color:stockEmpresa>0?"#10b981":"#f59e0b"}}>{fmtN(stockEmpresa)}</div>
              <div style={{fontSize:14,color:"#64748b",marginTop:4}}>Palets disponibles en empresa</div>
              </div>
            </div>
            <div style={{background:"linear-gradient(90deg,rgba(249,115,22,.12),rgba(255,255,255,.9))",borderRadius:10,padding:"22px",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:24}}>
              <div style={{width:58,height:58,borderRadius:"50%",background:"rgba(249,115,22,.13)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,color:"#f97316"}}>↶</div>
              <div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:36,color:"#f97316"}}>{fmtN(totalPendiente)}</div>
              <div style={{fontSize:14,color:"#64748b",marginTop:4}}>Palets pendientes de devolucion de clientes</div>
              </div>
            </div>
          </div>
          <div style={{marginTop:14,padding:"16px 18px",borderRadius:10,background:alertasAntiguedad.length?"rgba(249,115,22,.07)":"rgba(16,185,129,.07)",border:`1px solid ${alertasAntiguedad.length?"#fed7aa":"rgba(16,185,129,.20)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:alertasAntiguedad.length?10:0}}>
              <div>
                <div style={{fontWeight:900,fontSize:16,color:"#0f172a"}}>Alertas de antiguedad y almacenaje</div>
                <div style={{fontSize:13,color:"#64748b",marginTop:3}}>
                  Detecta palets de cliente/obra pendientes de devolver con 14 dias o mas. A partir de 30 dias se marcan como criticos.
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <span style={{...S.btn,background:alertasCriticas.length?"rgba(239,68,68,.12)":"#fff",color:alertasCriticas.length?"#ef4444":"#64748b",border:"1px solid #fecaca",cursor:"default"}}>
                  {alertasCriticas.length} criticas
                </span>
                <span style={{...S.btn,background:alertasAntiguedad.length?"rgba(249,115,22,.12)":"#fff",color:alertasAntiguedad.length?"#f97316":"#64748b",border:"1px solid #fed7aa",cursor:"default"}}>
                  {fmtN(totalPaletsEnAlerta)} palets
                </span>
                <span style={{...S.btn,background:"#fff",color:"#64748b",border:"1px solid #dbe5ec",cursor:"default"}}>
                  {costeAlmacenajeEstimado>0 ? `${fmt2(costeAlmacenajeEstimado)} EUR estimados` : "Sin coste configurado"}
                </span>
              </div>
            </div>
            {alertasAntiguedad.length ? (
              <div style={{display:"grid",gridTemplateColumns:"1fr",gap:10}}>
                {alertasAntiguedad.slice(0,6).map((a,idx)=>(
                  <div key={`${a.cliente_id}-${a.fecha}-${idx}`} style={{border:"1px solid #fed7aa",borderRadius:8,padding:"14px 16px",background:"#fff",display:"grid",gridTemplateColumns:"48px 1fr auto",alignItems:"center",gap:16}}>
                    <div style={{width:48,height:48,borderRadius:"50%",background:"rgba(249,115,22,.12)",display:"flex",alignItems:"center",justifyContent:"center",color:"#ef4444",fontWeight:900,fontSize:22}}>!</div>
                    <div>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                      <span style={{fontWeight:900,fontSize:13,color:"#0f172a"}}>{a.cliente_nombre}</span>
                    </div>
                    <div style={{fontSize:12,color:"#64748b",marginTop:3}}>{a.obra_nombre}</div>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,marginTop:7,fontSize:12,color:"#64748b"}}>
                      <span>{fmtN(a.palets)} palets desde {a.fecha || "-"}</span>
                      {a.coste_estimado>0 && <strong style={{color:"#f59e0b"}}>{fmt2(a.coste_estimado)} EUR</strong>}
                    </div>
                    </div>
                    <span style={{fontSize:13,fontWeight:900,color:a.nivel==="critica"?"#ef4444":"#f59e0b",textTransform:"uppercase"}}>{a.dias} dias</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{fontSize:12,color:"#10b981",fontWeight:700}}>Sin palets envejecidos pendientes de devolver.</div>
            )}
          </div>
        </div>
      )}

      {/* Por cliente */}
      {tab==="stock"&&(
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:12}}>
            <div style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>Palets por cliente y obra</div>
            <div style={{fontSize:11,color:"var(--text5)"}}>Las devoluciones preparadas se pueden editar hasta confirmar salida.</div>
          </div>
          {clientesConPalets.length===0?(
            <div style={{padding:30,textAlign:"center",color:"var(--text5)"}}>Sin movimientos de palets registrados. Haz clic en "Registrar movimiento" para empezar.</div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>
                <th style={S.th}>Cliente</th>
                <th style={S.th}>Entregados</th>
                <th style={S.th}>Devueltos</th>
                <th style={S.th}>Preparados</th>
                <th style={{...S.th,color:"#f97316"}}>Pendientes devolucion</th>
                <th style={S.th}>Importe devuelto</th>
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                {clientesConPalets.map(c=>(
                  <tr key={c.id} style={{background:(c.entregas-c.devoluciones)>0?"rgba(249,115,22,.03)":"transparent"}}>
                    <td style={{...S.td,fontWeight:600,color:"var(--text)"}}>
                      <div>{c.nombre}</div>
                      {c.devolucionesDetalle?.length>0 && (
                        <div style={{marginTop:5,display:"flex",gap:5,flexWrap:"wrap"}}>
                          {c.devolucionesDetalle.map(d=>(
                            <span key={d.nombre} style={{fontSize:10,fontWeight:700,color:"#10b981",background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.2)",borderRadius:6,padding:"2px 6px"}}>
                              {d.nombre}: {fmtN(d.cantidad)} palets
                            </span>
                          ))}
                        </div>
                      )}
                      {c.pendientesSalidaDetalle?.length>0 && (
                        <div style={{marginTop:5,display:"flex",gap:5,flexWrap:"wrap"}}>
                          {c.pendientesSalidaDetalle.map(d=>(
                            <button
                              key={d.nombre}
                              type="button"
                              onClick={()=>{ const mv=d.movimientos?.[0]; if(mv){ setMovimientoEditando(mv); setModal(true); } }}
                              title="Editar devolucion preparada"
                              style={{fontSize:10,fontWeight:700,color:"#f59e0b",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.25)",borderRadius:6,padding:"2px 6px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                              Preparado: {d.nombre}: {fmtN(d.cantidad)} palets
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#f97316"}}>{fmtN(c.entregas)}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#10b981"}}>{fmtN(c.devoluciones)}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:c.pendientesSalida>0?"#f59e0b":"var(--text5)"}}>
                      {c.pendientesSalida>0?fmtN(c.pendientesSalida):"0"}
                    </td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:(c.entregas-c.devoluciones)>0?"#f97316":"#10b981"}}>
                      {(c.entregas-c.devoluciones)>0
                        ? <span style={{color:"#f97316",fontWeight:700}}>{fmtN(c.entregas-c.devoluciones)} pendientes</span>
                        : <span style={{color:"#10b981"}}>OK Al dia (0 pendientes)</span>}
                    </td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#10b981"}}>{c.importeDevoluciones>0?fmt2(c.importeDevoluciones)+" EUR":"-"}</td>
                    <td style={S.td}>
                      {c.stock>0&&(
                        <button onClick={()=>abrirNuevaDevolucion(c)} style={{...S.btn,background:"rgba(16,185,129,.1)",color:"#10b981",border:"1px solid rgba(16,185,129,.25)",padding:"3px 9px",fontSize:11}}>
                           Registrar devolucion
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Dev. Cliente */}
      {tab==="dev_cliente"&&(
        <div style={S.card}>
          <div style={{display:"flex",gap:10,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:900,fontSize:14,color:"var(--text)"}}>Devoluciones por cliente</div>
              <div style={{fontSize:12,color:"var(--text5)",marginTop:2}}>Registros separados por fecha, cliente y albaran.</div>
            </div>
            <select value={filtroCliente} onChange={e=>setFiltroCliente(e.target.value)} style={{...S.inp,width:240,marginLeft:"auto"}}>
              <option value="todos">Todos los clientes</option>
              {clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input
              type="date"
              value={devDesde}
              onChange={e=>setDevDesde(e.target.value)}
              title="Desde"
              style={{...S.inp,width:145}}
            />
            <input
              type="date"
              value={devHasta}
              onChange={e=>setDevHasta(e.target.value)}
              title="Hasta"
              style={{...S.inp,width:145}}
            />
            {(devDesde||devHasta)&&(
              <button
                onClick={()=>{setDevDesde("");setDevHasta("");}}
                style={{...S.btn,background:"var(--bg3)",color:"var(--text4)",border:"1px solid var(--border2)"}}>
                Limpiar fechas
              </button>
            )}
            <button
              onClick={abrirInformeDevCliente}
              disabled={movimientosCliente.length===0}
              style={{...S.btn,background:"rgba(59,130,246,.10)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)",opacity:movimientosCliente.length===0 ? .55 : 1,cursor:movimientosCliente.length===0?"not-allowed":"pointer"}}>
              Informe HTML
            </button>
            <span style={{fontSize:12,color:"var(--text5)"}}>{movimientosCliente.length} registros</span>
          </div>
          {movimientosPorCliente.length===0?(
            <div style={{padding:30,textAlign:"center",color:"var(--text5)"}}>Sin movimientos de cliente registrados.</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {movimientosPorCliente.map(grupo=>(
                <div key={grupo.id} style={{border:"1px solid var(--border2)",borderRadius:10,overflow:"hidden",background:"var(--bg3)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,justifyContent:"space-between",padding:"10px 12px",borderBottom:"1px solid var(--border2)",flexWrap:"wrap"}}>
                    <div>
                      <div style={{fontWeight:900,color:"var(--text)",fontSize:13}}>{grupo.nombre}</div>
                      <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>{grupo.movimientos.length} registros separados</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <span style={{...S.btn,background:"rgba(249,115,22,.10)",color:"#f97316",border:"1px solid rgba(249,115,22,.25)",cursor:"default",padding:"4px 9px"}}>{fmtN(grupo.entradas)} entradas</span>
                      <span style={{...S.btn,background:"rgba(16,185,129,.10)",color:"#10b981",border:"1px solid rgba(16,185,129,.25)",cursor:"default",padding:"4px 9px"}}>{fmtN(grupo.devoluciones)} devueltas</span>
                      <span style={{...S.btn,background:"rgba(245,158,11,.10)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.25)",cursor:"default",padding:"4px 9px"}}>{fmtN(grupo.preparadas)} preparadas</span>
                      <span style={{...S.btn,background:"var(--bg2)",color:"var(--text4)",border:"1px solid var(--border2)",cursor:"default",padding:"4px 9px"}}>{fmt2(grupo.importe)} EUR</span>
                    </div>
                  </div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>
                        <th style={S.th}>Fecha</th>
                        <th style={S.th}>Tipo</th>
                        <th style={S.th}>Cantidad</th>
                        <th style={S.th}>Obra / origen</th>
                        <th style={S.th}>Albaran</th>
                        <th style={S.th}>Ref.</th>
                        <th style={S.th}>Importe</th>
                        <th style={S.th}>Estado</th>
                        <th style={S.th}></th>
                      </tr></thead>
                      <tbody>
                        {grupo.movimientos.map(m=>{
                          const importe=m.tipo==="devolucion"?Number(m.cantidad||0)*Number(m.precio_unitario||0):0;
                          const salidaPendiente=m.tipo==="devolucion"&&!salidaPaletsConfirmada(m);
                          const puedeFacturarDevolucion = m.tipo==="devolucion" && !salidaPendiente && !m.factura_id && Number(m.precio_unitario||0)>0;
                          const puedeRectificarDevolucion = m.tipo==="devolucion" && !salidaPendiente;
                          return (
                            <tr key={m.id} style={{background:salidaPendiente?"rgba(245,158,11,.05)":"transparent"}}>
                              <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{formatDateEs(m.fecha)}</td>
                              <td style={S.td}>
                                <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,
                                  background:`${TIPO_COLOR[m.tipo]}15`,color:TIPO_COLOR[m.tipo],border:`1px solid ${TIPO_COLOR[m.tipo]}30`}}>
                                  {TIPO_ICON[m.tipo]} {TIPO_LABEL[m.tipo]}
                                </span>
                              </td>
                              <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:TIPO_COLOR[m.tipo]}}>
                                {signoPaletsMovimiento(m) > 0 ? "+" : signoPaletsMovimiento(m) < 0 ? "-" : ""}{fmtN(m.cantidad)}
                              </td>
                              <td style={{...S.td,fontSize:11,color:"var(--text4)"}}>{m.obra_nombre || m.cliente_movimiento_nombre || m.notas || "-"}</td>
                              <td style={{...S.td,fontSize:11,color:"var(--text4)"}}>{m.num_albaran || "-"}</td>
                              <td style={{...S.td,fontSize:11,color:"var(--text5)"}}>{m.pedido_ref || "-"}</td>
                              <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#10b981"}}>{importe>0?fmt2(importe)+" EUR":"-"}</td>
                              <td style={S.td}>
                                {salidaPendiente ? (
                                  <span style={{display:"inline-flex",padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,background:"rgba(245,158,11,.12)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.28)"}}>Preparada</span>
                                ) : m.factura_id ? (
                                  <span style={{display:"inline-flex",padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,background:"rgba(16,185,129,.10)",color:"#10b981",border:"1px solid rgba(16,185,129,.25)"}}>Facturada</span>
                                ) : (
                                  <span style={{display:"inline-flex",padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,background:"var(--bg2)",color:"var(--text5)",border:"1px solid var(--border2)"}}>Registrada</span>
                                )}
                              </td>
                              <td style={S.td}>
                                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                                  {!m.factura_id && (m.tipo!=="devolucion" || salidaPendiente)&&(
                                    <button onClick={()=>{setMovimientoEditando(m);setModal(true);}} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(59,130,246,.30)",background:"rgba(59,130,246,.08)",color:"#60a5fa",cursor:"pointer",whiteSpace:"nowrap"}}>
                                      Editar
                                    </button>
                                  )}
                                  {salidaPendiente&&(
                                    <button onClick={()=>confirmarSalida(m)} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(16,185,129,.35)",background:"rgba(16,185,129,.08)",color:"#10b981",cursor:"pointer",whiteSpace:"nowrap"}}>
                                      Confirmar salida
                                    </button>
                                  )}
                                  {salidaPendiente&&(
                                    <button onClick={()=>borrarDevolucionPreparada(m)} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(239,68,68,.35)",background:"rgba(239,68,68,.08)",color:"#ef4444",cursor:"pointer",whiteSpace:"nowrap"}}>
                                      Eliminar
                                    </button>
                                  )}
                                  {puedeRectificarDevolucion&&(
                                    <button onClick={()=>rectificarDevolucion(m)} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(139,92,246,.35)",background:"rgba(139,92,246,.08)",color:"#8b5cf6",cursor:"pointer",whiteSpace:"nowrap"}}>
                                      Rectificar
                                    </button>
                                  )}
                                  {(m.tipo==="devolucion"||m.tipo==="entrega")&&m.num_albaran&&(
                                    <button
                                      onClick={()=>{
                                        const win=window.open("","_blank","width=800,height=600");
                                        win.document.write(generarHtmlAlbaran(m,clientes.find(c=>c.id===clienteIdMovimiento(m)),empresa,clientes.find(c=>c.id===m.cliente_movimiento_id)));
                                        win.document.close();
                                        win.focus();
                                        setTimeout(()=>win.print(),400);
                                      }}
                                      style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--text3)",cursor:"pointer",whiteSpace:"nowrap"}}>
                                      Albaran
                                    </button>
                                  )}
                                  {puedeFacturarDevolucion&&(
                                    <button onClick={()=>generarFacturaManual(m)} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(16,185,129,.35)",background:"rgba(16,185,129,.08)",color:"#10b981",cursor:"pointer",whiteSpace:"nowrap"}}>
                                      Generar factura
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Historial */}
      {tab==="historial"&&(
        <div style={S.card}>
          <div style={{display:"flex",gap:10,marginBottom:12,alignItems:"center"}}>
            <select value={filtroCliente} onChange={e=>setFiltroCliente(e.target.value)} style={{...S.inp,width:220}}>
              <option value="todos">Todos los clientes</option>
              {clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <span style={{fontSize:12,color:"var(--text5)"}}>{mvsFiltrados.length} movimientos</span>
          </div>
          <div style={{maxHeight:400,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead style={{position:"sticky",top:0,zIndex:2}}>
                <tr>
                  <th style={S.th}>Fecha</th>
                  <th style={S.th}>Tipo</th>
                  <th style={S.th}>Cliente</th>
                  <th style={S.th}>Obra / origen</th>
                  <th style={S.th}>Cantidad</th>
                  <th style={S.th}>Importe</th>
                  <th style={S.th}>Ref.</th>
                  <th style={S.th}>Notas</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {mvsFiltrados.length===0?(
                  <tr><td colSpan={9} style={{...S.td,textAlign:"center",color:"var(--text5)"}}>Sin movimientos</td></tr>
                ):mvsFiltrados.map(m=>{
                  const cli=clientes.find(c=>c.id===clienteIdMovimiento(m));
                  const importe=m.tipo==="devolucion"?Number(m.cantidad||0)*Number(m.precio_unitario||0):0;
                  const salidaPendiente=m.tipo==="devolucion"&&!salidaPaletsConfirmada(m);
                  const puedeFacturarDevolucion = m.tipo==="devolucion" && !salidaPendiente && !m.factura_id && Number(m.precio_unitario||0)>0;
                  const puedeRectificarDevolucion = m.tipo==="devolucion" && !salidaPendiente;
                  const movimientoEditable = !m.factura_id && (m.tipo!=="devolucion" || salidaPendiente);
                  return(
                    <tr key={m.id} style={{background:salidaPendiente?"rgba(245,158,11,.05)":"transparent"}}>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{formatDateEs(m.fecha)}</td>
                      <td style={S.td}>
                        <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,
                          background:`${TIPO_COLOR[m.tipo]}15`,color:TIPO_COLOR[m.tipo],border:`1px solid ${TIPO_COLOR[m.tipo]}30`}}>
                          {TIPO_ICON[m.tipo]} {TIPO_LABEL[m.tipo]}
                        </span>
                        {salidaPendiente&&(
                          <span style={{display:"inline-flex",marginTop:4,padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,background:"rgba(245,158,11,.12)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.28)"}}>
                            Preparada
                          </span>
                        )}
                        {salidaPendiente&&(
                          <div style={{display:"flex",gap:5,marginTop:5,flexWrap:"wrap"}}>
                            <button
                              onClick={()=>{setMovimientoEditando(m);setModal(true);}}
                              style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(245,158,11,.35)",background:"rgba(245,158,11,.08)",color:"#f59e0b",cursor:"pointer",whiteSpace:"nowrap"}}>
                              Editar
                            </button>
                            <button
                              onClick={()=>confirmarSalida(m)}
                              style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(16,185,129,.35)",background:"rgba(16,185,129,.08)",color:"#10b981",cursor:"pointer",whiteSpace:"nowrap"}}>
                              Confirmar salida + factura
                            </button>
                            <button
                              onClick={()=>borrarDevolucionPreparada(m)}
                              style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(239,68,68,.35)",background:"rgba(239,68,68,.08)",color:"#ef4444",cursor:"pointer",whiteSpace:"nowrap"}}>
                              Eliminar
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={S.td}>{cli?.nombre||"-"}</td>
                      <td style={{...S.td,fontSize:11,color:"var(--text4)"}}>{m.obra_nombre || m.cliente_movimiento_nombre || "-"}</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:TIPO_COLOR[m.tipo]}}>
                        {signoPaletsMovimiento(m) > 0 ? "+" : signoPaletsMovimiento(m) < 0 ? "-" : ""}
                        {fmtN(m.cantidad)}
                      </td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#10b981"}}>{importe>0?fmt2(importe)+" EUR":"-"}</td>
                      <td style={{...S.td,fontSize:11,color:"var(--text5)"}}>{m.pedido_ref||"-"}</td>
                      <td style={{...S.td,fontSize:11,color:"var(--text5)"}}>
                        <div>{m.notas||"-"}</div>
                        {m.factura_id&&(
                          <div style={{marginTop:4,display:"inline-flex",padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,background:"rgba(16,185,129,.10)",color:"#10b981",border:"1px solid rgba(16,185,129,.25)"}}>
                            Factura borrador vinculada
                          </div>
                        )}
                      </td>
                      <td style={S.td}>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          {movimientoEditable && !salidaPendiente && (
                            <button
                              onClick={()=>{setMovimientoEditando(m);setModal(true);}}
                              style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(59,130,246,.30)",
                                background:"rgba(59,130,246,.08)",color:"#60a5fa",cursor:"pointer",whiteSpace:"nowrap"}}>
                              Editar
                            </button>
                          )}
                          {(m.tipo==="devolucion"||m.tipo==="entrega")&&m.num_albaran&&(
                            <button
                              onClick={()=>{
                                const win=window.open("","_blank","width=800,height=600");
                                win.document.write(generarHtmlAlbaran(m,clientes.find(c=>c.id===clienteIdMovimiento(m)),empresa,clientes.find(c=>c.id===m.cliente_movimiento_id)));
                                win.document.close();
                                win.focus();
                                setTimeout(()=>win.print(),400);
                              }}
                              style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid var(--border2)",
                                background:"var(--bg3)",color:"var(--text3)",cursor:"pointer",whiteSpace:"nowrap"}}>
                              Albaran
                            </button>
                          )}
                          {puedeRectificarDevolucion&&(
                            <button
                              onClick={()=>rectificarDevolucion(m)}
                              style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(139,92,246,.35)",background:"rgba(139,92,246,.08)",color:"#8b5cf6",cursor:"pointer",whiteSpace:"nowrap"}}>
                              Rectificar
                            </button>
                          )}
                          {puedeFacturarDevolucion&&(
                            <button
                              onClick={()=>generarFacturaManual(m)}
                              style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(16,185,129,.35)",background:"rgba(16,185,129,.08)",color:"#10b981",cursor:"pointer",whiteSpace:"nowrap"}}>
                              Generar factura
                            </button>
                          )}
                          {!movimientoEditable && (
                            <span style={{fontSize:10,color:"var(--text5)",display:"inline-flex",alignItems:"center"}}>
                              Bloqueado por factura vinculada
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Almacen propio / cliente */}
      {tab==="almacen_propio"&&<AlmacenPropio/>}
      {tab==="almacen_cliente"&&<AlmacenCliente/>}
        {modal&&<ModalMovimiento
          clientes={clientes}
          movimientos={movimientos}
          initial={movimientoEditando}
          cfgPalets={cfgPalets}
          onClose={()=>{setModal(false);setMovimientoEditando(null);}}
          onSaved={recargar}
          onServerSave={guardarMovimientoServidor}
        onServerUpdate={editarMovimientoServidor}
      />}
    </div>
  );
}

// 
// ALMACEN MERCANCIA PROPIA - articulos propios de venta
// 

function mercanciaApiToLocal(m) {
  return {
    ...m,
    id: m.id,
    nombre: m.nombre,
    sku: m.sku || "",
    unidad: m.unidad || "ud",
    precio_venta: Number(m.precio_venta || 0),
    precio_coste: Number(m.precio_compra || m.precio_coste || 0),
    stock: Number(m.stock_actual ?? m.stock ?? 0),
    stock_minimo: Number(m.stock_minimo || 0),
    categoria: m.categoria || "",
    notas: m.notas || "",
  };
}

function movimientoApiToLocal(m) {
  return {
    ...m,
    mercan_id: m.mercancia_id || m.mercan_id,
    mercan_nombre: m.mercancia_nombre || m.mercan_nombre,
    cliente_nombre: m.cliente_nombre || "",
    precio_unitario: Number(m.precio_unitario || 0),
    cantidad: Number(m.cantidad || 0),
    metadata: m.metadata && typeof m.metadata === "object" ? m.metadata : {},
  };
}

function AlmacenPropio() {
  const [mercancias, setMercancias] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [almacenes, setAlmacenes] = useState([]);
  const [almacenId, setAlmacenId] = useState("");
  const [modal, setModal] = useState(false); // 'nueva_mercan' | 'movimiento' | null
  const [selMercan, setSelMercan] = useState(null);
  const [movEditando, setMovEditando] = useState(null);
  const [form, setForm] = useState({});
  const [clientes, setClientes] = useState([]);
  const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2});
  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--text5)",marginBottom:3,marginTop:8};

  const cargarAlmacenes = useCallback(async () => {
    try {
      const data = await getAlmacenes();
      const arr = Array.isArray(data) ? data : [];
      setAlmacenes(arr);
      if (!almacenId && arr[0]) setAlmacenId(arr[0].id);
      return arr;
    } catch {
      return [];
    }
  }, [almacenId]);

  const cargarMercancias = useCallback(async () => {
    try {
      const params = { origen:"propia" };
      if (almacenId) params.almacen_id = almacenId;
      const data = await getAlmacenMercancias(params);
      const arr = Array.isArray(data) ? data.map(mercanciaApiToLocal) : [];
      setMercancias(arr);
    } catch {
      setMercancias([]);
    }
  }, [almacenId]);

  const cargarMovimientos = useCallback(async () => {
    try {
      const params = { origen:"propia" };
      if (almacenId) params.almacen_id = almacenId;
      const data = await getAlmacenMovimientos(params);
      const arr = Array.isArray(data) ? data.map(movimientoApiToLocal) : [];
      setMovimientos(arr);
    } catch {
      setMovimientos([]);
    }
  }, [almacenId]);

  useEffect(()=>{
    getClientes().then(d=>setClientes(Array.isArray(d?.data)?d.data:Array.isArray(d)?d:[])).catch(()=>{});
    cargarAlmacenes();
    cargarMovimientos();
  },[cargarAlmacenes, cargarMovimientos]);

  useEffect(()=>{ cargarMercancias(); }, [cargarMercancias]);

  async function nuevoAlmacen() {
    const nombre = await promptDialog({
      title: "Nuevo almacen",
      message: "Nombre del almacen que quieres crear",
      placeholder: "Ej: Almacen principal, Taller, Ropa...",
      confirmText: "Crear almacen",
    });
    if (!nombre?.trim()) return;
    try {
      const creado = await crearAlmacen({ nombre:nombre.trim(), tipo:"general" });
      const arr = await cargarAlmacenes();
      setAlmacenId(creado?.id || arr[0]?.id || "");
    } catch (e) {
      notify("No se pudo crear el almacen: " + e.message, "error");
    }
  }

  async function guardarMercan() {
    if (!form.nombre) { notify("El nombre es obligatorio", "warning"); return; }
    try {
      await crearAlmacenMercancia({
        almacen_id: almacenId || null,
        origen: "propia",
        nombre: form.nombre,
        sku: form.sku || "",
        unidad: form.unidad || "ud",
        precio_compra: Number(form.precio_coste || 0),
        precio_venta: Number(form.precio_venta || 0),
        stock_actual: Number(form.stock || 0),
        stock_minimo: Number(form.stock_minimo || 0),
        notas: form.notas || "",
      });
      await cargarMercancias();
      setModal(false); setForm({});
    } catch (e) {
      notify("No se pudo guardar la mercancia: " + e.message, "error");
    }
  }

  async function registrarMovimiento() {
    if (!selMercan || !form.tipo || !form.cantidad) { notify("Completa todos los campos", "warning"); return; }
    if (form.tipo==="salida" && !form.cliente_id) { notify("Para una salida de stock, selecciona el cliente al que se vende", "warning"); return; }
    const cli = clientes.find(c=>c.id===form.cliente_id);
    try {
      const payload = {
        almacen_id: form.almacen_id || almacenId || selMercan.almacen_id || null,
        mercancia_id: selMercan.id,
        cliente_id: form.cliente_id || null,
        tipo: form.tipo,
        cantidad: Number(form.cantidad),
        unidad: selMercan.unidad || "ud",
        precio_unitario: Number(form.precio_unitario || 0),
        num_albaran: form.num_albaran || "",
        pedido_ref: form.pedido_ref || "",
        fecha: form.fecha || new Date().toISOString().slice(0,10),
        notas: form.notas || "",
        metadata: form.metadata && typeof form.metadata === "object" ? form.metadata : (movEditando?.metadata || {}),
      };
      if (movEditando?.id) await editarAlmacenMovimiento(movEditando.id, payload);
      else await crearAlmacenMovimiento(payload);
      await cargarMercancias();
      await cargarMovimientos();
      setModal(false); setSelMercan(null); setMovEditando(null); setForm({});
    } catch (e) {
      notify("No se pudo registrar el movimiento: " + e.message, "error");
      return;
    }
    if (!movEditando?.id && form.tipo==="salida" && form.cliente_id && Number(form.precio_unitario||0)>0) {
      try {
        await crearFactura({
          cliente_id: form.cliente_id,
          serie:"A", fecha:form.fecha||new Date().toISOString().slice(0,10),
          estado: form.pago_contado ? "cobrada" : "borrador",
          lineas:[{ concepto:`${selMercan.nombre} - ${Number(form.cantidad)} ${selMercan.unidad||"ud"}`,
                    cantidad:Number(form.cantidad), precio_unit:Number(form.precio_unitario) }],
          observaciones: form.notas||"",
        });
        notify(`Salida registrada. Factura ${form.pago_contado?"cobrada":"en borrador"} creada para ${cli?.nombre||"cliente"}`, "success");
      } catch(e) { notify("Salida registrada. Error al crear factura: "+e.message, "error"); }
    }
  }

  async function eliminarMovimientoAlmacen(mv) {
    const ok = await confirmDialog({
      title: "Eliminar movimiento",
      message: "Eliminar este movimiento y recalcular el stock?",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await borrarAlmacenMovimiento(mv.id);
      await cargarMercancias();
      await cargarMovimientos();
    } catch (e) {
      notify("No se pudo eliminar el movimiento: " + e.message, "error");
    }
  }

  function abrirEditarMovimiento(mv) {
    const mercan = mercancias.find(m => m.id === (mv.mercan_id || mv.mercancia_id));
    if (!mercan) { notify("No se encontro la mercancia del movimiento", "warning"); return; }
    setSelMercan(mercan);
    setMovEditando(mv);
    setForm({
      tipo: mv.tipo || "entrada",
      cantidad: String(Math.abs(Number(mv.cantidad || 0)) || ""),
      precio_unitario: String(mv.precio_unitario || ""),
      fecha: toDateInputValue(mv.fecha),
      notas: mv.notas || "",
      cliente_id: mv.cliente_id || "",
      almacen_id: mv.almacen_id || mercan.almacen_id || almacenId || "",
      num_albaran: mv.num_albaran || "",
      pedido_ref: mv.pedido_ref || "",
      metadata: mv.metadata && typeof mv.metadata === "object" ? mv.metadata : {},
      pago_contado: false,
    });
    setModal("movimiento");
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:13,color:"var(--text4)"}}>
          {mercancias.length} articulo{mercancias.length!==1?"s":""} - Stock total: {mercancias.reduce((s,m)=>s+m.stock,0)} unidades
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginLeft:"auto",marginRight:10}}>
          <select value={almacenId} onChange={e=>setAlmacenId(e.target.value)} style={{...inp,width:220,padding:"6px 9px",fontSize:12}}>
            <option value="">Todos los almacenes</option>
            {almacenes.map(a=><option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          <button onClick={nuevoAlmacen} style={{padding:"6px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text3)",fontSize:12,fontWeight:700,cursor:"pointer"}}>
            + Nuevo almacen
          </button>
        </div>
        <button onClick={()=>{setModal("nueva_mercan");setForm({});}} style={{padding:"7px 14px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          + Nueva mercancia
        </button>
      </div>

      {mercancias.length===0 ? (
        <div style={{textAlign:"center",padding:40,color:"var(--text5)"}}>
          <div style={{fontSize:20,marginBottom:8,fontWeight:800,color:"var(--text4)"}}>Stock</div>
          <div style={{fontWeight:700,color:"var(--text)"}}>Sin articulos</div>
          <div style={{fontSize:12,marginTop:4}}>Da de alta articulos propios de venta para gestionar su stock</div>
        </div>
      ) : (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              {["Articulo","SKU","Unidad","Stock","Minimo","P.Coste","P.Venta","% Margen","Acciones"].map(h=>(
                <th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--text5)",borderBottom:"1px solid var(--border2)",background:"var(--bg3)"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {mercancias.map(m=>(
                <tr key={m.id} style={{borderBottom:"1px solid var(--border2)"}}>
                  <td style={{padding:"8px 12px",fontWeight:700,color:"var(--text)",fontSize:13}}>{m.nombre}</td>
                  <td style={{padding:"8px 12px",fontSize:12,color:"var(--text5)",fontFamily:"monospace"}}>{m.sku||"-"}</td>
                  <td style={{padding:"8px 12px",fontSize:12,color:"var(--text4)"}}>{m.unidad}</td>
                  <td style={{padding:"8px 12px"}}>
                    <span style={{fontWeight:800,fontSize:14,color:m.stock<=m.stock_minimo?"var(--red)":"var(--green)"}}>{m.stock}</span>
                    {m.stock<=m.stock_minimo&&<span style={{fontSize:10,color:"var(--red)",marginLeft:4}}>Atencion:</span>}
                  </td>
                  <td style={{padding:"8px 12px",fontSize:12,color:"var(--text5)"}}>{m.stock_minimo}</td>
                  <td style={{padding:"8px 12px",fontSize:12,color:"var(--text3)"}}>{fmt2(m.precio_coste)} EUR</td>
                  <td style={{padding:"8px 12px",fontSize:12,fontWeight:700,color:"var(--green)"}}>{fmt2(m.precio_venta)} EUR</td>
                  <td style={{padding:"8px 12px",fontSize:12,fontWeight:800}}>
                    {(()=>{
                      const coste = Number(m.precio_coste||0);
                      const venta = Number(m.precio_venta||0);
                      if (!coste || !venta || venta <= coste) return <span style={{color:"var(--text5)"}}>-</span>;
                      const margen = ((venta - coste) / venta * 100);
                      return (
                        <span style={{color: margen >= 20 ? "var(--green)" : margen >= 10 ? "#f59e0b" : "#ef4444"}}>
                          {margen.toFixed(1)}%
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{padding:"8px 12px"}}>
                    <div style={{display:"flex",gap:4}}>
                      <button onClick={()=>{setSelMercan(m);setMovEditando(null);setForm({tipo:"entrada",fecha:new Date().toISOString().slice(0,10),almacen_id:m.almacen_id || almacenId || "",num_albaran:"",pedido_ref:"",notas:""});setModal("movimiento");}}
                        style={{padding:"3px 8px",borderRadius:5,border:"none",background:"rgba(16,185,129,.15)",color:"var(--green)",fontSize:11,cursor:"pointer",fontWeight:700}}>+ Entrada</button>
                      <button onClick={()=>{setSelMercan(m);setMovEditando(null);setForm({tipo:"salida",fecha:new Date().toISOString().slice(0,10),almacen_id:m.almacen_id || almacenId || "",num_albaran:"",pedido_ref:"",notas:""});setModal("movimiento");}}
                        style={{padding:"3px 8px",borderRadius:5,border:"none",background:"rgba(239,68,68,.1)",color:"var(--red)",fontSize:11,cursor:"pointer",fontWeight:700}}>- Salida</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {movimientos.length > 0 && (
        <div style={{marginTop:14,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderBottom:"1px solid var(--border2)"}}>
            <div style={{fontWeight:800,color:"var(--text)",fontSize:13}}>Ultimos movimientos de mercancia propia</div>
            <div style={{fontSize:11,color:"var(--text5)"}}>{movimientos.length} registros</div>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              {["Fecha","Articulo","Almacen","Tipo","Cantidad","Cliente","Importe","Acciones"].map(h=>(
                <th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--text5)",borderBottom:"1px solid var(--border2)",background:"var(--bg3)"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {movimientos.slice(0,8).map(mv=>(
                <tr key={mv.id} style={{borderBottom:"1px solid var(--border2)"}}>
                  <td style={{padding:"8px 12px",fontSize:11,color:"var(--text4)"}}>{formatDateEs(mv.fecha)}</td>
                  <td style={{padding:"8px 12px",fontWeight:700,color:"var(--text)",fontSize:12}}>{mv.mercan_nombre || mv.mercancia_nombre || "-"}</td>
                  <td style={{padding:"8px 12px",fontSize:12,color:"var(--text4)"}}>{mv.almacen_nombre || "-"}</td>
                  <td style={{padding:"8px 12px",fontSize:12,color:mv.tipo==="entrada"?"var(--green)":"var(--red)",fontWeight:800}}>{mv.tipo}</td>
                  <td style={{padding:"8px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{Number(mv.cantidad||0).toLocaleString("es-ES")} {mv.unidad||"ud"}</td>
                  <td style={{padding:"8px 12px",fontSize:12,color:"var(--text4)"}}>{mv.cliente_nombre || "-"}</td>
                  <td style={{padding:"8px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--text)"}}>{fmt2(Number(mv.cantidad||0)*Number(mv.precio_unitario||0))} EUR</td>
                  <td style={{padding:"8px 12px"}}>
                    <div style={{display:"flex",gap:5}}>
                      <button onClick={()=>abrirEditarMovimiento(mv)} style={{padding:"3px 8px",borderRadius:5,border:"1px solid rgba(59,130,246,.25)",background:"rgba(59,130,246,.10)",color:"var(--accent)",fontSize:11,fontWeight:700,cursor:"pointer"}}>Editar</button>
                      <button onClick={()=>eliminarMovimientoAlmacen(mv)} style={{padding:"3px 8px",borderRadius:5,border:"1px solid rgba(239,68,68,.25)",background:"rgba(239,68,68,.08)",color:"var(--red)",fontSize:11,fontWeight:700,cursor:"pointer"}}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nueva mercancia */}
      {modal==="nueva_mercan" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{ if(e.target===e.currentTarget){ setModal(false); setMovEditando(null); setSelMercan(null); setForm({}); } }}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:22,width:"min(500px,96vw)",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:14}}>Nueva mercancia</div>
            {[["nombre","Nombre del articulo *","Ej: Palet europeo"],["sku","Referencia / SKU","REF-001"],["categoria","Categoria","Embalaje"],["unidad","Unidad de medida","ud, kg, m3..."]].map(([k,l,ph])=>(
              <div key={k}><label style={lbl}>{l}</label><input style={inp} value={form[k]||""} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} placeholder={ph}/></div>
            ))}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[["precio_coste","Precio coste (EUR)","0"],["precio_venta","Precio venta (EUR)","0"],["stock","Stock inicial","0"],["stock_minimo","Stock minimo","5"]].map(([k,l,ph])=>(
                <div key={k}><label style={lbl}>{l}</label><input type="number" step="0.01" style={inp} value={form[k]||""} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} onFocus={e=>e.target.select()} placeholder={ph}/></div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
              <button onClick={()=>setModal(false)} style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontSize:13,cursor:"pointer"}}>Cancelar</button>
              <button onClick={guardarMercan} style={{padding:"7px 16px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}> Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal movimiento */}
      {modal==="movimiento" && selMercan && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:22,width:"min(560px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:14}}>
              {movEditando?.id ? "Editar movimiento" : form.tipo==="entrada" ? "Entrada" : "Salida"} - {selMercan.nombre}
            </div>
            <div>
              <label style={lbl}>Almacen</label>
              <select style={inp} value={form.almacen_id||almacenId||""} onChange={e=>setForm(p=>({...p,almacen_id:e.target.value}))}>
                <option value="">Seleccionar almacen...</option>
                {almacenes.map(a=><option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Cantidad</label><input type="number" min="1" style={inp} value={form.cantidad||""} onChange={e=>setForm(p=>({...p,cantidad:e.target.value}))} onFocus={e=>e.target.select()}/></div>
            <div><label style={lbl}>Precio unitario (EUR)</label><input type="number" step="0.01" style={inp} value={form.precio_unitario||""} onChange={e=>setForm(p=>({...p,precio_unitario:e.target.value}))} placeholder={String(selMercan.precio_venta)} onFocus={e=>e.target.select()}/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div><label style={lbl}>Fecha</label><input type="date" style={inp} value={form.fecha||""} onChange={e=>setForm(p=>({...p,fecha:e.target.value}))}/></div>
              <div><label style={lbl}>Albaran</label><input style={inp} value={form.num_albaran||""} onChange={e=>setForm(p=>({...p,num_albaran:e.target.value}))} placeholder="Opcional"/></div>
            </div>
            <div><label style={lbl}>Ref. movimiento</label><input style={inp} value={form.pedido_ref||""} onChange={e=>setForm(p=>({...p,pedido_ref:e.target.value}))} placeholder="Pedido, obra o referencia"/></div>
            <div><label style={lbl}>Notas</label><input style={inp} value={form.notas||""} onChange={e=>setForm(p=>({...p,notas:e.target.value}))} placeholder="Opcional"/></div>
            {form.tipo==="salida"&&(<div style={{marginTop:6}}>
              <label style={lbl}>Cliente que compra *</label>
              <select style={inp} value={form.cliente_id||""} onChange={e=>setForm(p=>({...p,cliente_id:e.target.value}))}>
                <option value="">Seleccionar cliente...</option>
                {clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>)}
            {form.tipo==="salida"&&(<div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
              <input type="checkbox" id="pago_contado_p" checked={!!form.pago_contado} onChange={e=>setForm(p=>({...p,pago_contado:e.target.checked}))}/>
              <label htmlFor="pago_contado_p" style={{fontSize:12,color:"var(--text3)",cursor:"pointer"}}> Pago al contado</label>
            </div>)}
            <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
              <button onClick={()=>{setModal(false);setMovEditando(null);setSelMercan(null);setForm({});}} style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontSize:13,cursor:"pointer"}}>Cancelar</button>
              <button onClick={registrarMovimiento} style={{padding:"7px 16px",borderRadius:7,border:"none",background:form.tipo==="entrada"?"var(--green)":"var(--red)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Registrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 
// ALMACEN CLIENTE - mercancia de terceros (precio/dia)
// 

function AlmacenCliente() {
  const [depositos,   setDepositos]   = useState([]);
  const [almacenes,   setAlmacenes]   = useState([]);
  const [almacenId,   setAlmacenId]   = useState("");
  const [modal,       setModal]       = useState(false);  // 'entrada' | false
  const [form,        setForm]        = useState({});
  const [clientes,    setClientes]    = useState([]);
  const [crearCliente,setCrearCliente]= useState(false);  // inline new-client form
  const [formCli,     setFormCli]     = useState({});
  const [savingCli,   setSavingCli]   = useState(false);
  const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2});
  const hoy = new Date().toISOString().slice(0,10);
  const empresa = useEmpresaPerfil();
  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",
    padding:"7px 10px",borderRadius:7,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",
    color:"var(--text5)",marginBottom:3,marginTop:8};

  const depositoApiToLocal = useCallback((m) => ({
    ...m,
    id: m.id,
    cliente_id: m.cliente_id || "",
    cliente_nombre: m.cliente_nombre || "",
    descripcion: m.nombre || m.descripcion || "",
    fecha_entrada: String(m.created_at || "").slice(0,10) || hoy,
    cantidad: Number(m.stock_actual ?? m.cantidad ?? 1),
    precio_dia: Number(m.precio_venta || m.precio_dia || 0),
    estado: Number(m.stock_actual ?? 0) > 0 ? "activo" : "entregado",
  }), [hoy]);

  const cargarAlmacenesCliente = useCallback(async () => {
    try {
      const data = await getAlmacenes();
      const arr = Array.isArray(data) ? data : [];
      setAlmacenes(arr);
      if (!almacenId && arr[0]) setAlmacenId(arr[0].id);
      return arr;
    } catch {
      return [];
    }
  }, [almacenId]);

  const cargarDepositos = useCallback(async () => {
    try {
      const params = { origen:"cliente" };
      if (almacenId) params.almacen_id = almacenId;
      const data = await getAlmacenMercancias(params);
      const arr = Array.isArray(data) ? data.map(depositoApiToLocal) : [];
      setDepositos(arr);
    } catch {
      setDepositos([]);
    }
  }, [almacenId, depositoApiToLocal]);

  useEffect(()=>{
    getClientes()
      .then(d=>setClientes(Array.isArray(d?.data)?d.data:Array.isArray(d)?d:[]))
      .catch(()=>{});
    cargarAlmacenesCliente();
  },[cargarAlmacenesCliente]);

  useEffect(()=>{ cargarDepositos(); }, [cargarDepositos]);

  async function nuevoAlmacenCliente() {
    const nombre = await promptDialog({
      title: "Nuevo almacen",
      message: "Nombre del almacen que quieres crear",
      placeholder: "Ej: Nave 2, Deposito clientes...",
      confirmText: "Crear almacen",
    });
    if (!nombre?.trim()) return;
    try {
      const creado = await crearAlmacen({ nombre:nombre.trim(), tipo:"clientes" });
      const arr = await cargarAlmacenesCliente();
      setAlmacenId(creado?.id || arr[0]?.id || "");
    } catch (e) {
      notify("No se pudo crear el almacen: " + e.message, "error");
    }
  }

  function calcDias(dep) {
    const start = new Date(dep.fecha_entrada);
    const end = dep.fecha_salida ? new Date(dep.fecha_salida) : new Date();
    return Math.max(1, Math.ceil((end-start)/(1000*3600*24)));
  }
  function calcImporte(dep) { return calcDias(dep) * Number(dep.precio_dia||0) * Number(dep.cantidad||1); }

  // Create new client inline then continue with entry
  async function crearClienteInline() {
    if (!formCli.nombre?.trim()) { notify("El nombre del cliente es obligatorio", "warning"); return; }
    setSavingCli(true);
    try {
      const nuevo = await crearClienteApi({
        nombre: formCli.nombre.trim(),
        cif:    formCli.cif||"",
        telefono: formCli.telefono||"",
        email:  formCli.email||"",
        ciudad: formCli.ciudad||"",
        provincia: formCli.provincia||"",
        pais:   formCli.pais||"España",
        tipo_iva: "21",
        activo: true,
      });
      // Refresh client list and select the new one
      const nuevos = await getClientes();
      const lista = Array.isArray(nuevos?.data)?nuevos.data:Array.isArray(nuevos)?nuevos:[];
      setClientes(lista);
      const recienCreado = lista.find(c=>c.nombre===formCli.nombre.trim()) || nuevo;
      setForm(prev=>({...prev,
        cliente_id: recienCreado?.id || "",
        cliente_nombre: recienCreado?.nombre || formCli.nombre.trim()
      }));
      setCrearCliente(false);
      setFormCli({});
    } catch(e) {
      notify("Error al crear cliente: " + e.message, "error");
    } finally {
      setSavingCli(false);
    }
  }

  async function guardar() {
    if (!form.cliente_id) { notify("Selecciona un cliente o crea uno nuevo.", "warning"); return; }
    if (!form.descripcion?.trim()||!form.fecha_entrada) {
      notify("Descripcion y fecha de entrada son obligatorios", "warning"); return;
    }
    try {
      await crearAlmacenMercancia({
        almacen_id: almacenId || null,
        cliente_id: form.cliente_id,
        origen: "cliente",
        nombre: form.descripcion,
        unidad: "unidad",
        stock_actual: Number(form.cantidad || 1),
        precio_venta: Number(form.precio_dia || 0),
        notas: form.notas || "",
      });
      await cargarDepositos();
      setModal(false); setForm({}); setCrearCliente(false);
    } catch (e) {
      notify("No se pudo guardar la entrada de deposito: " + e.message, "error");
    }
  }

  async function registrarSalida(id) {
    const dep = depositos.find(d => d.id === id);
        if (dep?.id && !String(dep.id).startsWith("ac_")) {
      try {
        await crearAlmacenMovimiento({
          almacen_id: almacenId || dep.almacen_id || null,
          mercancia_id: dep.id,
          cliente_id: dep.cliente_id || null,
          tipo: "salida",
          cantidad: Number(dep.cantidad || 1),
          unidad: "unidad",
          precio_unitario: Number(dep.precio_dia || 0),
          fecha: hoy,
          notas: "Salida de mercancia de cliente",
        });
        await cargarDepositos();
      } catch (e) {
        notify("No se pudo registrar la salida del deposito: " + e.message, "error");
      }
      return;
    }
    setDepositos(prev => prev.map(d => d.id===id ? {...d, fecha_salida:hoy, estado:"entregado"} : d));
  }

  const activos    = depositos.filter(d=>d.estado==="activo");
  const entregados = depositos.filter(d=>d.estado!=="activo");
  const ingresosMes = activos.reduce((s,d)=>s+calcImporte(d),0);

  return (
    <div>
      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
        {[
          ["Depositos activos",   activos.length,           "var(--accent)"],
          ["Ingresos acumulados", `${fmt2(ingresosMes)} EUR`, "var(--green)"],
          ["Total depositos",     depositos.length,          "var(--text3)"],
        ].map(([l,v,c])=>(
          <div key={l} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:"12px 16px"}}>
            <div style={{fontWeight:800,fontSize:18,color:c}}>{v}</div>
            <div style={{fontSize:11,color:"var(--text5)",textTransform:"uppercase",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>
          Mercancia en deposito ({activos.length} activos)
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginLeft:"auto",marginRight:10}}>
          <select value={almacenId} onChange={e=>setAlmacenId(e.target.value)} style={{...inp,width:220,padding:"6px 9px",fontSize:12}}>
            <option value="">Todos los almacenes</option>
            {almacenes.map(a=><option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          <button onClick={nuevoAlmacenCliente} style={{padding:"6px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text3)",fontSize:12,fontWeight:700,cursor:"pointer"}}>
            + Nuevo almacen
          </button>
        </div>
        <button
          onClick={()=>{ setModal(true); setForm({fecha_entrada:hoy,precio_dia:5,cantidad:1}); setCrearCliente(false); }}
          style={{padding:"7px 14px",borderRadius:7,border:"none",background:"var(--accent)",
            color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          + Nueva entrada
        </button>
      </div>

      {depositos.length===0 ? (
        <div style={{textAlign:"center",padding:40,color:"var(--text5)"}}>
          <div style={{fontSize:20,marginBottom:8,fontWeight:800,color:"var(--text4)"}}>Deposito</div>
          <div style={{fontWeight:700,color:"var(--text)"}}>Sin depositos activos</div>
          <div style={{fontSize:12,marginTop:4}}>Registra la mercancia de clientes que entra al almacen</div>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[...activos,...entregados.slice(0,5)].map(dep=>{
            const dias = calcDias(dep);
            const importe = calcImporte(dep);
            return (
              <div key={dep.id} style={{background:"var(--bg2)",
                border:`1px solid ${dep.estado==="activo"?"var(--border2)":"#1a1f2e"}`,
                borderRadius:10,padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:6}}>
                  <div>
                    <span style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>{dep.cliente_nombre}</span>
                    <span style={{marginLeft:8,fontSize:11,padding:"2px 8px",borderRadius:10,fontWeight:700,
                      background:dep.estado==="activo"?"rgba(16,185,129,.15)":"rgba(100,100,100,.15)",
                      color:dep.estado==="activo"?"var(--green)":"var(--text5)"}}>
                      {dep.estado}
                    </span>
                  </div>
                  <span style={{fontFamily:"monospace",fontWeight:800,fontSize:15,color:"var(--green)"}}>
                    {fmt2(importe)} EUR
                  </span>
                </div>
                <div style={{fontSize:12,color:"var(--text4)",marginBottom:4}}>{dep.descripcion}</div>
                <div style={{fontSize:11,color:"var(--text5)",display:"flex",gap:12,flexWrap:"wrap"}}>
                  <span>Entrada: {dep.fecha_entrada}</span>
                  {dep.fecha_salida&&<span> Salida: {dep.fecha_salida}</span>}
                  <span> {dep.cantidad} ud  -  {fmt2(dep.precio_dia)} EUR/dia  -  {dias} dias</span>
                  {dep.m2>0&&<span> {dep.m2} m2</span>}
                </div>
                {(dep.estado==="activo"||dep.estado==="entregado")&&(
                  <div style={{display:"flex",gap:8,marginTop:10}}>
                    {dep.estado==="activo"&&<button onClick={()=>registrarSalida(dep.id)}
                      style={{padding:"4px 12px",borderRadius:6,border:"none",
                        background:"rgba(16,185,129,.12)",color:"var(--green)",
                        cursor:"pointer",fontSize:12,fontWeight:600}}>
                      OK Registrar salida
                    </button>}
                    <button onClick={()=>{
                      const imp=calcImporte(dep);
                      const fechaEm=new Date().toLocaleDateString("es-ES");
                      const fechaEnt=new Date(dep.fecha_entrada+"T12:00:00").toLocaleDateString("es-ES");
                      const win=window.open("","_blank","width=800,height=600");
                      // empresa is in scope
          const empNom = empresa?.razon_social||empresa?.nombre||"TransGest TMS";
          const empCif = empresa?.cif||"";
          const empDir = empresa?.domicilio||empresa?.direccion||"";
          const empTel = empresa?.telefono||"";
          const empEmail = empresa?.email||"";
          win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Factura almacenaje</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:32px}
h1{font-size:22px;color:#1a3a6e;margin-bottom:4px}.sub{color:#666;font-size:11px;margin-bottom:24px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
.box{border:1px solid #ddd;border-radius:4px;padding:12px}.box-title{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
table{width:100%;border-collapse:collapse;margin:16px 0}
th{background:#1a3a6e;color:#fff;padding:8px 12px;text-align:left;font-size:11px}
td{padding:8px 12px;border-bottom:1px solid #eee}.total{background:#f5f5f5;font-weight:700}
.footer{margin-top:24px;text-align:center;font-size:9px;color:#aaa;border-top:1px solid #eee;padding-top:8px}
@media print{@page{margin:1cm}body{padding:0}}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #1a3a6e">
  <div>
    <div style="font-size:18px;font-weight:700;color:#1a3a6e">${empNom}</div>
    ${empCif?`<div style="font-size:11px;color:#555">CIF: ${empCif}</div>`:""}
    ${empDir?`<div style="font-size:11px;color:#555">${empDir}</div>`:""}
    ${empTel?`<div style="font-size:11px;color:#555">Tel: ${empTel} ${empEmail?" -  "+empEmail:""}</div>`:""}
  </div>
  <div style="text-align:right">
    <div style="font-size:10px;color:#666;letter-spacing:1px;text-transform:uppercase">Factura de Almacenaje</div>
    <div style="font-size:22px;font-weight:700;color:#1a3a6e">ALM-${dep.id.slice(-6).toUpperCase()}</div>
    <div style="font-size:11px;color:#555">Fecha: ${fechaEm}</div>
  </div>
</div>
<div class="grid">
<div class="box"><div class="box-title">Facturado a</div><div style="font-weight:700;font-size:14px">${dep.cliente_nombre}</div></div>
<div class="box"><div class="box-title">Periodo</div>
<div>Entrada: <b>${fechaEnt}</b></div><div style="margin-top:4px">Dias: <b>${dias}</b></div></div></div>
<table><thead><tr><th>Descripcion</th><th>Cant.</th><th>Dias</th><th>EUR/dia</th><th style="text-align:right">Total</th></tr></thead>
<tbody><tr>
<td>${dep.descripcion}</td><td>${dep.cantidad} ud</td><td>${dias}</td>
<td>${fmt2(dep.precio_dia)} EUR</td>
<td style="text-align:right;font-weight:700">${fmt2(imp)} EUR</td>
</tr></tbody>
<tfoot><tr class="total">
<td colspan="4" style="text-align:right;padding:10px">TOTAL</td>
<td style="text-align:right;color:#1a3a6e;font-size:16px;padding:10px">${fmt2(imp)} EUR</td>
</tr></tfoot></table>
${dep.notas?`<div style="font-size:11px;color:#555;margin-top:8px">Notas: ${dep.notas}</div>`:""}
<div class="footer">${empNom}${empCif?"  -  CIF: "+empCif:""}  -  Generado: ${fechaEm}</div>
</body></html>`);
                      win.document.close(); win.focus(); setTimeout(()=>win.print(),400);
                    }} style={{padding:"4px 12px",borderRadius:6,border:"none",
                      background:"rgba(59,130,246,.12)",color:"var(--accent)",
                      cursor:"pointer",fontSize:12,fontWeight:600}}>
                       Factura PDF
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal nueva entrada */}
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:200,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,
            padding:22,width:"min(520px,96vw)",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,
              color:"var(--text)",marginBottom:14}}>
              Nueva entrada de mercancia cliente
            </div>

            {/* CLIENT SELECTION - same flow as Pedidos */}
            {!crearCliente ? (
              <div style={{marginBottom:10}}>
                <label style={lbl}>Cliente *</label>
                <div style={{display:"flex",gap:8}}>
                  <select value={form.cliente_id||""}
                    onChange={e=>{
                      const cli=clientes.find(c=>c.id===e.target.value);
                      setForm(prev=>({...prev,
                        cliente_id:e.target.value,
                        cliente_nombre:cli?.nombre||""
                      }));
                    }}
                    style={{...inp,flex:1}}>
                    <option value="">Seleccionar cliente...</option>
                    {clientes.map(cl=><option key={cl.id} value={cl.id}>{cl.nombre}</option>)}
                  </select>
                  <button onClick={()=>setCrearCliente(true)}
                    style={{padding:"7px 12px",borderRadius:7,border:"1px solid var(--accent)",
                      background:"transparent",color:"var(--accent)",fontSize:12,
                      fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",
                      fontFamily:"'DM Sans',sans-serif"}}>
                    + Nuevo
                  </button>
                </div>
                {clientes.length===0&&(
                  <div style={{fontSize:11,color:"#f59e0b",marginTop:4}}>
                    Atencion: Sin clientes en el sistema. Crea uno con el boton "+ Nuevo".
                  </div>
                )}
              </div>
            ) : (
              /* INLINE NEW CLIENT FORM */
              <div style={{background:"rgba(59,130,246,.06)",border:"1px solid rgba(59,130,246,.2)",
                borderRadius:10,padding:14,marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:12,color:"var(--accent-xl)",marginBottom:10}}>
                   Crear nuevo cliente
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[
                    ["nombre","Nombre / Razon social *","Empresa S.L."],
                    ["cif","CIF / NIF","B12345678"],
                    ["telefono","Telefono","+34 91 000 00 00"],
                    ["email","Email","info@empresa.com"],
                    ["ciudad","Ciudad","Madrid"],
                  ].map(([k,l,ph])=>(
                    <div key={k} style={k==="nombre"?{gridColumn:"1/-1"}:{}}>
                      <label style={lbl}>{l}</label>
                      <input style={inp} value={formCli[k]||""}
                        onChange={e=>setFormCli(prev=>({...prev,[k]:e.target.value}))}
                        placeholder={ph}/>
                    </div>
                  ))}
                  <GeoFields
                    values={formCli}
                    onChange={(campo, valor) => setFormCli(prev => ({ ...prev, [campo]: valor }))}
                    inputStyle={inp}
                    labelStyle={lbl}
                  />
                </div>
                <div style={{display:"flex",gap:8,marginTop:12,justifyContent:"flex-end"}}>
                  <button onClick={()=>setCrearCliente(false)}
                    style={{padding:"6px 12px",borderRadius:7,border:"1px solid var(--border2)",
                      background:"transparent",color:"var(--text3)",fontSize:12,cursor:"pointer"}}>
                    Cancelar
                  </button>
                  <button onClick={crearClienteInline} disabled={savingCli}
                    style={{padding:"6px 14px",borderRadius:7,border:"none",
                      background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:700,
                      cursor:"pointer",opacity:savingCli?.7:1}}>
                    {savingCli?"Creando...":"OK Crear y seleccionar"}
                  </button>
                </div>
              </div>
            )}

            {/* Entry details */}
            <div>
              <label style={lbl}>Descripcion de la mercancia *</label>
              <input style={inp} value={form.descripcion||""}
                onChange={e=>setForm(prev=>({...prev,descripcion:e.target.value}))}
                placeholder="Paletas de ceramica, maquinaria, cajas..."/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                ["cantidad","Cantidad (ud)","1"],
                ["m2","M2 ocupados","10"],
                ["precio_dia","Precio EUR/dia","5"],
                ["fecha_entrada","Fecha entrada",""],
              ].map(([k,l,ph])=>(
                <div key={k}>
                  <label style={lbl}>{l}</label>
                  <input type={k.includes("fecha")?"date":"number"} step="0.01"
                    style={inp} value={form[k]||""}
                    onChange={e=>setForm(prev=>({...prev,[k]:e.target.value}))}
                    placeholder={ph} onFocus={e=>e.target.select()}/>
                </div>
              ))}
            </div>
            {form.precio_dia&&form.cantidad&&(
              <div style={{padding:"8px 12px",background:"rgba(16,185,129,.08)",
                border:"1px solid rgba(16,185,129,.2)",borderRadius:7,marginTop:8,
                display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:12,color:"var(--text4)"}}>Precio/dia estimado</span>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,
                  color:"var(--green)",fontSize:15}}>
                  {fmt2(Number(form.precio_dia)*Number(form.cantidad))} EUR/dia
                </span>
              </div>
            )}
            <div style={{marginTop:8}}>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas||""}
                onChange={e=>setForm(prev=>({...prev,notas:e.target.value}))}
                placeholder="Referencia pedido, condiciones especiales..."/>
            </div>
            <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
              <button onClick={()=>{setModal(false);setCrearCliente(false);}}
                style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",
                  background:"transparent",color:"var(--text3)",fontSize:13,cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif"}}>
                Cancelar
              </button>
              <button onClick={guardar}
                style={{padding:"7px 16px",borderRadius:7,border:"none",background:"var(--accent)",
                  color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif"}}>
                 Registrar entrada
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
