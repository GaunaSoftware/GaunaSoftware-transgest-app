import { useState, useEffect, useCallback } from "react";
import { getChoferHistorialVehiculos, getTractoraPeriodos } from "../services/api";
import { asignarRemolque } from "../services/api";
import { getChoferes, crearChofer, editarChofer, getVehiculos, getNominasEmitidas, getTallerEstado, guardarTallerEstado, getChoferJornadas } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";
import { clearRuntimeFocus, readRuntimeFocus } from "../services/runtimeFocus";
import { GeoFields } from "../components/GeoFields";

// ---------------------------------------------------------------------------
const EMPTY_TALLER_CHOFER = Object.freeze({ stock: [], entregas_equipos_choferes: {} });
function semaforo(fecha) {
  if (!fecha) return { color:"var(--text5)", label:"Sin fecha", nivel:0 };
  const dias = Math.ceil((new Date(fecha) - new Date()) / 86400000);
  if (dias > 90) return { color:"var(--green)", label:`${dias}d`, nivel:3 };
  if (dias > 30) return { color:"#f59e0b",     label:`${dias}d`, nivel:2 };
  if (dias > 0)  return { color:"var(--orange)",label:`${dias}d`, nivel:1 };
  return { color:"var(--red)", label:"CADUCADO", nivel:0 };
}

const S = {
  page:  { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif" },
  title: { fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:"var(--text)", marginBottom:20 },
  btn:   { padding:"7px 14px", borderRadius:7, border:"none", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", display:"inline-flex", alignItems:"center", gap:5 },
  inp:   { background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"8px 11px", borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" },
  sel:   { background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"8px 11px", borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" },
  lbl:   { display:"block", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text4)", marginBottom:4, marginTop:10 },
  card:  { background:"var(--card-bg)", border:"1px solid var(--border)", borderRadius:12, overflow:"hidden" },
  th:    { textAlign:"left", padding:"8px 13px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", color:"var(--text4)", borderBottom:"1px solid var(--border)", background:"var(--bg3)", whiteSpace:"nowrap" },
  td:    { padding:"10px 13px", borderBottom:"1px solid var(--border)", fontSize:13, color:"var(--text)", verticalAlign:"middle" },
  modal: { position:"fixed", inset:0, background:"rgba(0,0,0,.8)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:12 },
  sec:   { fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:12, color:"var(--text3)", marginTop:20, marginBottom:8, paddingBottom:6, borderBottom:"1px solid var(--border)" },
  grid2: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0px 12px" },
  grid3: { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0px 12px" },
  badge: { display:"inline-flex", alignItems:"center", padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700 },
};

// ---------------------------------------------------------------------------
function TabDocumentacion({ chofer }) {
  const docs = [
    { key:"dni",       label:"DNI / NIE",                        vKey:"dni_vencimiento" },
    { key:"cap",       label:"CAP (Cert. Aptitud Profesional)",  vKey:"cap_vencimiento" },
    { key:"carnet",    label:"Carnet de conducir",               vKey:"carnet_vencimiento" },
    { key:"tarjeta",   label:"Tarjeta de conductor (tacógrafo)", vKey:"tarjeta_vencimiento" },
    { key:"adr",       label:"ADR (mercancías peligrosas)",      vKey:"adr_vencimiento" },
    { key:"medico",    label:"Reconocimiento médico",            vKey:"medico_vencimiento" },
  ];
  return (
    <div>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr>{["Documento","Número","Vencimiento","Estado"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {docs.map(d => {
            const sem = semaforo(chofer[d.vKey]);
            return (
              <tr key={d.key}>
                <td style={{ ...S.td, fontWeight:600 }}>{d.label}</td>
                <td style={{ ...S.td, fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"var(--text2)" }}>
                  {chofer[d.key] || <span style={{ color:"var(--text5)" }}>-</span>}
                </td>
                <td style={{ ...S.td, fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"var(--text3)" }}>
                  {chofer[d.vKey] ? new Date(chofer[d.vKey]).toLocaleDateString("es-ES") : "-"}
                </td>
                <td style={S.td}>
                  {chofer[d.vKey]
                    ? <span style={{ ...S.badge, background:`${sem.color}18`, color:sem.color }}>{sem.label}</span>
                    : <span style={{ color:"var(--text5)", fontSize:11 }}>Sin registro</span>
                  }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TabNominas({ chofer }) {
  const [nominas, setNominas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getNominasEmitidas({ chofer_id: chofer.id })
      .then(rows => { if (alive) setNominas(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setNominas([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [chofer.id]);

  function enviarEmail(n) {
    const mail = chofer.email || "";
    if (!mail) { notify("El chofer no tiene email registrado.", "warning"); return; }
    const liquido = Number(n.liquido || 0);
    const asunto = encodeURIComponent(`Nómina ${n.periodo || ""} - ${chofer.nombre}`);
    const cuerpo = encodeURIComponent(`Estimado/a ${chofer.nombre},\n\nSe ha generado su nómina correspondiente al período ${n.periodo || ""}${liquido ? ` por importe neto de ${liquido.toLocaleString("es-ES",{minimumFractionDigits:2})} EUR` : ""}.\n\nAtentamente,\nRRHH`);
    window.open(`mailto:${mail}?subject=${asunto}&body=${cuerpo}`);
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:10, flexWrap:"wrap" }}>
        <span style={{ fontSize:12, color:"var(--text4)" }}>{nominas.length} nómina{nominas.length!==1?"s":""} registrada{nominas.length!==1?"s":""}</span>
        <div style={{ fontSize:11, color:"var(--text5)" }}>Las nóminas se generan desde el módulo Nóminas.</div>
      </div>

      {loading ? (
        <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Cargando nóminas...</div>
      ) : nominas.length === 0 ? (
        <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin nóminas registradas</div>
      ) : (
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr>{["Período","Líquido","Creada","Notas",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {nominas.map(n => (
              <tr key={n.id}>
                <td style={{ ...S.td, fontWeight:600 }}>{n.periodo || "—"}</td>
                <td style={{ ...S.td, fontFamily:"'JetBrains Mono',monospace" }}>{Number(n.liquido || 0).toLocaleString("es-ES",{minimumFractionDigits:2})} €</td>
                <td style={{ ...S.td, fontSize:11, color:"var(--text4)" }}>{n.created_at ? new Date(n.created_at).toLocaleDateString("es-ES") : "—"}</td>
                <td style={{ ...S.td, fontSize:11, color:"var(--text4)" }}>{n.notas || "—"}</td>
                <td style={S.td}>
                  <button title="Enviar por email" onClick={() => enviarEmail(n)}
                    style={{ ...S.btn, padding:"3px 8px", background:"var(--bg4)", color:"var(--text2)", border:"1px solid var(--border2)" }}>
                    ??
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
function TabEquipos({ chofer, tallerState, onPersistTallerState }) {
  const stock = (Array.isArray(tallerState?.stock) ? tallerState.stock : []).filter(item => String(item.categoria || "").toUpperCase() === "EPIS");
  const [entregas, setEntregas] = useState(() => {
    const map = tallerState?.entregas_equipos_choferes || {};
    return Array.isArray(map?.[chofer.id]) ? map[chofer.id] : [];
  });
  const [selItems,  setSelItems] = useState([]);
  const [formando,  setFormando] = useState(false);
  const [obs,       setObs]      = useState("");
  const [firmaNombre, setFirmaNombre] = useState(() => chofer.nombre || "");
  const [firmaAceptada, setFirmaAceptada] = useState(false);

  useEffect(() => {
    const map = tallerState?.entregas_equipos_choferes || {};
    const next = Array.isArray(map?.[chofer.id]) ? map[chofer.id] : [];
    setEntregas(next);
  }, [chofer.id, tallerState]);

  function toggleItem(item) {
    setSelItems(prev => prev.find(i=>i.id===item.id) ? prev.filter(i=>i.id!==item.id) : [...prev, {...item, cantidad_entregada:1}]);
  }
  function setCantidad(id, val) {
    setSelItems(prev => prev.map(i => {
      if (i.id !== id) return i;
      const max = Math.max(0, Number(i.stock_actual || 0));
      const qty = Math.max(1, Math.min(Number(val) || 1, max || 1));
      return { ...i, cantidad_entregada: qty };
    }));
  }

  function registrarEntrega() {
    if (selItems.length === 0) { notify("Selecciona al menos un articulo", "warning"); return; }
    if (!String(firmaNombre || "").trim()) { notify("Indica quien recibe el material", "warning"); return; }
    if (!firmaAceptada) { notify("Confirma la entrega para generar el documento", "warning"); return; }
    const stockActual = Array.isArray(tallerState?.stock) ? tallerState.stock : [];
    const erroresStock = selItems
      .map(sel => {
        const item = stockActual.find(x => String(x.id) === String(sel.id));
        const disponible = Number(item?.stock_actual || 0);
        const cantidad = Number(sel.cantidad_entregada || 0);
        if (!item) return `${sel.nombre || "Articulo"} no existe ya en stock`;
        if (cantidad <= 0) return `${sel.nombre || "Articulo"} tiene cantidad invalida`;
        if (cantidad > disponible) return `${sel.nombre || "Articulo"} solo tiene ${disponible} ud. disponibles`;
        return "";
      })
      .filter(Boolean);
    if (erroresStock.length) {
      notify(erroresStock[0], "warning");
      return;
    }
    const actualizado = stockActual.map(item => {
      const entregaItem = selItems.find(sel => sel.id === item.id);
      if (!entregaItem) return item;
      return { ...item, stock_actual: Math.max(0, Number(item.stock_actual || 0) - Number(entregaItem.cantidad_entregada || 0)) };
    });
    const entregaId = `eq_${Date.now()}`;
    const entrega = {
      id:        entregaId,
      documento_numero: `EPI-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
      fecha:     new Date().toISOString(),
      items:     selItems,
      chofer_nombre: chofer.nombre,
      chofer_id: chofer.id,
      firma_nombre: String(firmaNombre || "").trim(),
      firma_confirmada_at: new Date().toISOString(),
      observaciones: obs,
    };
    const upd = [entrega, ...entregas];
    const entregasMap = {
      ...(tallerState?.entregas_equipos_choferes || {}),
      [chofer.id]: upd,
    };
    onPersistTallerState?.({
      ...(tallerState || {}),
      stock: actualizado,
      entregas_equipos_choferes: entregasMap,
    });
    setEntregas(upd);
    setSelItems([]); setObs(""); setFirmaAceptada(false); setFormando(false);
  }

  function imprimirEntrega(e) {
    const fecha = new Date(e.fecha);
    const txt = `
DOCUMENTO DE ENTREGA DE EQUIPOS
================================
Documento: ${e.documento_numero || e.id}
Fecha:    ${fecha.toLocaleDateString("es-ES")} ${fecha.toLocaleTimeString("es-ES")}
Receptor: ${e.chofer_nombre}
Firmado por: ${e.firma_nombre || e.chofer_nombre}

ARTICULOS ENTREGADOS:
${e.items.map(i=>`  - ${i.nombre} (${i.referencia||i.codigo_barras||""}) x ${i.cantidad_entregada} ud.`).join("\n")}

${e.observaciones ? `Observaciones: ${e.observaciones}` : ""}

_________________________      _________________________
      Firma empresa                  Firma trabajador
`;
    const w = window.open("", "_blank", "width=600,height=700");
    w.document.write(`<pre style="font-family:monospace;padding:40px;white-space:pre">${txt}</pre>`);
    w.print();
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <span style={{ fontSize:12, color:"var(--text4)" }}>{entregas.length} entrega{entregas.length!==1?"s":""} registrada{entregas.length!==1?"s":""}</span>
        <button
          style={{
            ...S.btn,
            background: stock.length ? "var(--accent)" : "var(--bg4)",
            color: stock.length ? "#fff" : "var(--text5)",
            border: stock.length ? "none" : "1px solid var(--border2)",
            cursor: stock.length ? "pointer" : "not-allowed",
          }}
          onClick={() => stock.length && setFormando(true)}
          disabled={!stock.length}
          title={stock.length ? "Registrar nueva entrega de EPIs" : "Primero crea artículos de categoría EPIS en Taller"}
        >
          + Nueva entrega
        </button>
      </div>

      {formando && (
        <div style={{ background:"var(--bg4)", border:"1px solid var(--border2)", borderRadius:10, padding:16, marginBottom:16 }}>
          <div style={{ fontWeight:700, fontSize:13, color:"var(--text)", marginBottom:12 }}>Selecciona los artículos a entregar:</div>

          {stock.length === 0 && (
            <div style={{ fontSize:12, color:"var(--text5)", padding:"8px 0" }}>No hay artículos EPIS en el stock. Crea antes artículos con la categoría EPIS desde Taller.</div>
          )}

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:8, marginBottom:12 }}>
            {stock.map(item => {
              const sel = selItems.find(i=>i.id===item.id);
              return (
                <div key={item.id}
                  onClick={() => toggleItem(item)}
                  style={{ padding:"9px 12px", borderRadius:8, border:`2px solid ${sel?"var(--accent-l)":"var(--border)"}`,
                           background: sel ? "var(--accent-dim)" : "var(--bg3)", cursor:"pointer",
                           transition:"all .12s" }}>
                  <div style={{ fontWeight:600, fontSize:12, color: sel?"var(--accent-xl)":"var(--text)" }}>{item.nombre}</div>
                  <div style={{ fontSize:10, color:"var(--text4)" }}>{item.categoria} - Ref: {item.referencia||"-"}</div>
                  <div style={{ fontSize:10, color:"var(--text5)" }}>Stock: {item.stock_actual} ud.</div>
                  {sel && (
                    <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:6 }} onClick={e=>e.stopPropagation()}>
                      <span style={{ fontSize:10, color:"var(--text3)" }}>Entregar:</span>
                      <input type="number" min="1" max={Number(item.stock_actual || 0)} value={Math.min(Number(sel.cantidad_entregada || 1), Number(item.stock_actual || 0) || 1)}
                        onChange={e=>setCantidad(item.id, parseInt(e.target.value)||1)}
                        style={{ ...S.inp, width:60, padding:"3px 6px", fontSize:12 }}/>
                      <span style={{ fontSize:10, color:"var(--text3)" }}>ud.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {selItems.length > 0 && (
            <div>
              <label style={S.lbl}>Observaciones (opcional)</label>
              <input style={S.inp} value={obs} onChange={e=>setObs(e.target.value)} placeholder="Notas sobre la entrega..."/>
              <label style={S.lbl}>Nombre del receptor / firma</label>
              <input style={S.inp} value={firmaNombre} onChange={e=>setFirmaNombre(e.target.value)} placeholder="Nombre y apellidos"/>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text3)",marginTop:10}}>
                <input type="checkbox" checked={firmaAceptada} onChange={e=>setFirmaAceptada(e.target.checked)} />
                Confirmo la entrega de los articulos seleccionados
              </label>
            </div>
          )}

          <div style={{ display:"flex", gap:8, marginTop:14 }}>
            <button style={{ ...S.btn, background:"var(--green)", color:"#fff" }} onClick={registrarEntrega}>
               Registrar entrega y generar documento
            </button>
            <button style={{ ...S.btn, background:"transparent", color:"var(--text3)", border:"1px solid var(--border2)" }} onClick={()=>{setFormando(false);setSelItems([]);}}>Cancelar</button>
          </div>
        </div>
      )}

      {entregas.length === 0
        ? <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin entregas registradas</div>
        : entregas.map(e => (
          <div key={e.id} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:"var(--text)", marginBottom:4 }}>
                  {new Date(e.fecha).toLocaleDateString("es-ES")} a las {new Date(e.fecha).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}
                </div>
                <div style={{ fontSize:11, color:"var(--text4)" }}>
                  {e.items.map(i => `${i.nombre} x${i.cantidad_entregada}`).join(" - ")}
                </div>
                {e.observaciones && <div style={{ fontSize:11, color:"var(--text5)", marginTop:3 }}>{e.observaciones}</div>}
              </div>
              <button style={{ ...S.btn, background:"var(--bg4)", color:"var(--text2)", border:"1px solid var(--border2)", fontSize:11 }}
                onClick={() => imprimirEntrega(e)}>
                Imprimir
              </button>
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
function TabHistorialVehiculos({ chofer }) {
  const [historial, setHistorial] = useState([]);
  const [periodos, setPeriodos] = useState([]);
  const [vista, setVista] = useState("historial");
  const [loading, setLoading]    = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getChoferHistorialVehiculos(chofer.id).catch(() => []),
      getTractoraPeriodos(chofer.id).catch(() => []),
    ])
      .then(([hist, per]) => {
        setHistorial(Array.isArray(hist) ? hist : []);
        setPeriodos(Array.isArray(per) ? per : []);
      })
      .finally(() => setLoading(false));
  }, [chofer.id]);

  const fmtDate = d => d ? new Date(d).toLocaleDateString("es-ES", {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "-";

  return (
    <div>
      {loading ? (
        <div style={{color:"var(--text4)",fontSize:13,padding:20,textAlign:"center"}}>Cargando...</div>
      ) : historial.length === 0 ? (
        <div style={{textAlign:"center",padding:"30px 0",color:"var(--text4)"}}>
          <div style={{fontSize:32,marginBottom:8}}></div>
          <div style={{fontSize:13}}>Sin historial de vehículos registrado</div>
          <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Se registra automáticamente al crear pedidos</div>
        </div>
      ) : (
        <>
          {/* Vista selector */}
          <div style={{display:"flex",gap:6,marginBottom:14}}>
            {[["historial","Por pedido"],["periodos","Períodos tractora"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setVista(id)}
                style={{padding:"4px 12px",borderRadius:6,border:"1px solid var(--border2)",fontSize:12,cursor:"pointer",
                  background:vista===id?"var(--accent)":"transparent",color:vista===id?"#fff":"var(--text4)"}}>
                {lbl}
              </button>
            ))}
          </div>

          {vista === "periodos" ? (
            <div>
              {periodos.length === 0 ? (
                <div style={{textAlign:"center",padding:"24px 0",color:"var(--text5)",fontSize:12}}>
                  Sin períodos de tractora registrados.<br/>
                  <span style={{fontSize:11}}>Se registran al asignar un chófer a un vehículo.</span>
                </div>
              ) : (
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr>
                      {["Tractora","Remolque","Desde","Hasta","Estado"].map(h=>(
                        <th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",borderBottom:"1px solid var(--border)"}}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {periodos.map((p,i)=>(
                      <tr key={p.id} style={{borderBottom:"1px solid var(--border)",background:i%2===0?"transparent":"var(--bg3)"}}>
                        <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"var(--text)"}}>{p.veh_matricula||p.matricula||"-"}</td>
                        <td style={{padding:"9px 12px",fontSize:12,color:"#a78bfa"}}>{p.rem_matricula||p.remolque_mat ? ""+(p.rem_matricula||p.remolque_mat) : "-"}</td>
                        <td style={{padding:"9px 12px",fontSize:12,color:"var(--text3)"}}>{p.fecha_inicio ? new Date(p.fecha_inicio).toLocaleDateString("es-ES") : "-"}</td>
                        <td style={{padding:"9px 12px",fontSize:12,color:"var(--text3)"}}>{p.fecha_fin ? new Date(p.fecha_fin).toLocaleDateString("es-ES") : <span style={{color:"#10b981",fontWeight:700}}>Actual</span>}</td>
                        <td style={{padding:"9px 12px"}}>
                          {!p.fecha_fin
                            ? <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(16,185,129,.1)",color:"#10b981",border:"1px solid rgba(16,185,129,.25)"}}>Activo</span>
                            : <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"var(--bg4)",color:"var(--text5)"}}>Finalizado</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              {["Fecha","Tractora","Remolque","Pedido","Ruta"].map(h=>(
                <th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",borderBottom:"1px solid var(--border)"}}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {historial.map((h,i) => (
              <tr key={h.id} style={{borderBottom:"1px solid var(--border)",background:i%2===0?"transparent":"var(--bg3)"}}>
                <td style={{padding:"9px 12px",fontSize:12,color:"var(--text3)"}}>{fmtDate(h.fecha)}</td>
                <td style={{padding:"9px 12px"}}>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13,color:"var(--text)"}}>
                    {h.matricula||"-"}
                  </span>
                </td>
                <td style={{padding:"9px 12px"}}>
                  {h.remolque_mat ? (
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#a78bfa"}}>
                      {h.remolque_mat}
                    </span>
                  ) : <span style={{color:"var(--text5)",fontSize:12}}>-</span>}
                </td>
                <td style={{padding:"9px 12px",fontSize:12,color:"var(--accent)"}}>
                  {h.pedido_numero||"-"}
                </td>
                <td style={{padding:"9px 12px",fontSize:12,color:"var(--text3)"}}>
                  {h.origen&&h.destino ? `${h.origen} -> ${h.destino}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          )}
        </>
      )}
    </div>
  );
}

function TabJornadas({ chofer }) {
  const [jornadas, setJornadas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getChoferJornadas(chofer.id, {})
      .then(rows => { if (alive) setJornadas(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setJornadas([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [chofer.id]);

  const fmtDate = (v) => v ? new Date(v).toLocaleString("es-ES", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "-";
  const fmtMin = (m=0) => {
    const mins = Math.max(0, Number(m || 0));
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return h ? `${h}h ${String(r).padStart(2,"0")}m` : `${r}m`;
  };
  const diffMin = (a,b) => {
    const start = new Date(a).getTime();
    const end = new Date(b || Date.now()).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  };
  const eventos = (j) => Array.isArray(j.eventos) ? j.eventos : [];
  const totalTipo = (j, tipos) => {
    const evs = eventos(j);
    return evs.reduce((sum, ev, idx) => {
      if (!tipos.includes(ev.tipo)) return sum;
      const nextAt = evs[idx + 1]?.at || j.fin_at || new Date().toISOString();
      return sum + diffMin(ev.at, nextAt);
    }, 0);
  };
  const alertasJornada = (j) => {
    const evs = eventos(j);
    const out = [];
    evs.forEach((ev, idx) => {
      const nextAt = evs[idx + 1]?.at || j.fin_at;
      const mins = diffMin(ev.at, nextAt);
      const objetivo = Number(ev.objetivo_descanso_min || 0);
      if (ev.tipo === "descanso" && objetivo === 540 && mins > 550 && mins < 660) out.push(`Descanso reducido incorrecto: ${fmtMin(mins)}`);
      else if (ev.tipo === "descanso" && ((objetivo === 540 && mins > 550) || (objetivo === 660 && mins > 670))) out.push(`Descanso excedido: ${fmtMin(mins)}`);
      if (ev.tipo === "pausa" && mins >= 15 && mins < 45) {
        const later30 = evs.slice(idx + 1).some(x => ["pausa","descanso"].includes(x.tipo) && diffMin(x.at, evs[evs.indexOf(x) + 1]?.at || j.fin_at) >= 30);
        if (!later30) out.push(`Pausa partida incompleta: ${fmtMin(mins)}`);
      }
    });
    return out;
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, gap:10 }}>
        <span style={{ fontSize:12, color:"var(--text4)" }}>{jornadas.length} jornada{jornadas.length!==1?"s":""} registrada{jornadas.length!==1?"s":""}</span>
        <span style={{ fontSize:11, color:"var(--text5)" }}>Datos alimentados desde la app de choferes.</span>
      </div>
      {loading ? (
        <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Cargando jornadas...</div>
      ) : jornadas.length === 0 ? (
        <div style={{ color:"var(--text5)", fontSize:12, padding:"16px 0", textAlign:"center" }}>Sin jornadas registradas</div>
      ) : (
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr>{["Inicio","Fin","Vehiculo","Km","Conduccion","Pausas","Noche","Eventos"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {jornadas.map(j => (
              <tr key={j.id}>
                <td style={S.td}>{fmtDate(j.inicio_at)}</td>
                <td style={S.td}>{j.estado === "abierta" ? <span style={{ color:"#10b981", fontWeight:800 }}>Abierta</span> : fmtDate(j.fin_at)}</td>
                <td style={{ ...S.td, fontFamily:"'JetBrains Mono',monospace" }}>{j.vehiculo_matricula || "-"}</td>
                <td style={{ ...S.td, fontFamily:"'JetBrains Mono',monospace" }}>{j.km_jornada != null ? Number(j.km_jornada).toLocaleString("es-ES") : "-"}</td>
                <td style={S.td}>{fmtMin(totalTipo(j, ["conduccion"]))}</td>
                <td style={S.td}>{fmtMin(totalTipo(j, ["pausa","descanso"]))}</td>
                <td style={S.td}>{j.hace_noche ? (j.noche_lugar || "Si") : "-"}</td>
                <td style={{ ...S.td, fontSize:11, color:"var(--text4)" }}>
                  {alertasJornada(j).length > 0 && (
                    <div style={{color:"#ef4444",fontWeight:800,marginBottom:4}}>
                      {alertasJornada(j).slice(0,2).join(" | ")}
                    </div>
                  )}
                  {eventos(j).slice(-4).map(ev => `${fmtDate(ev.at)} ${ev.tipo}`).join(" | ") || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ModalChofer({ editando, onClose, onSaved, vehiculos, tallerState, persistTallerState }) {
  const { puedeEditar } = useAuth();
  const canEdit = puedeEditar("choferes");
  const [tab,    setTab]    = useState("datos");
  const [form,   setForm]   = useState(editando ? { ...editando, remolque_id: editando.remolque_id || editando.vehiculo_remolque_id || "" } : {
    activo:true, nombre:"", apellidos:"", dni:"", telefono:"", email:"",
    direccion:"", poblacion:"", cp:"", provincia:"", pais:"España",
    fecha_alta: new Date().toISOString().slice(0,10), fecha_baja:"", motivo_baja:"",
    carta_renuncia_nombre:"", carta_renuncia_mime:"", carta_renuncia_base64:"",
    vehiculo_id:"", remolque_id:"", tipo_contrato:"", salario:"",
    sexo:"", puesto_valor:"",
    // Carnets
    dni_vencimiento:"", carnet:"", carnet_vencimiento:"", carnet_tipo:"B+E",
    cap_vencimiento:"", tarjeta_tg:"", tarjeta_vencimiento:"",
    adr_numero:"", adr_vencimiento:"", medico_vencimiento:"",
    // Notas
    notas:"",
  });
  const [saving, setSaving] = useState(false);
  const esRemolque = v => {
    const clase = String(v?.clase || v?.tipo || "").toLowerCase();
    const mat = String(v?.matricula || "").toUpperCase();
    return clase.includes("remolque") || clase.includes("semirremolque") || clase.includes("dolly") || mat.startsWith("R-") || mat.endsWith("-R") || vehiculos.some(t => String(t.remolque_id || "") === String(v?.id || ""));
  };
  const tractoras = vehiculos.filter(v => !esRemolque(v) && v.activo !== false && v.estado !== "baja");
  const remolques = vehiculos.filter(v => esRemolque(v) && v.activo !== false && v.estado !== "baja");

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.type==="checkbox" ? e.target.checked : e.target.value }));
  const onActivoChange = e => {
    const checked = e.target.checked;
    setForm(p => ({
      ...p,
      activo: checked,
      estado: checked ? (p.estado === "baja" ? "disponible" : p.estado) : "baja",
      fecha_baja: checked ? p.fecha_baja : (p.fecha_baja || new Date().toISOString().slice(0,10)),
    }));
  };
  const onCartaRenuncia = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      setForm(p => ({
        ...p,
        carta_renuncia_nombre: file.name,
        carta_renuncia_mime: file.type || "application/octet-stream",
        carta_renuncia_base64: raw.includes(",") ? raw.split(",").pop() : raw,
      }));
    };
    reader.readAsDataURL(file);
  };

  async function guardar() {
    if (!form.nombre) { notify("El nombre es obligatorio", "warning"); return; }
    if (form.activo === false) {
      if (!form.fecha_baja) { notify("Indica la fecha de baja del chofer.", "warning"); return; }
      if (!String(form.motivo_baja || "").trim()) { notify("Indica el motivo de la baja.", "warning"); return; }
      if (!form.carta_renuncia_base64) { notify("Sube la carta de renuncia o documento de baja.", "warning"); return; }
    }
    setSaving(true);
    try {
      if (editando?.id) await editarChofer(editando.id, form);
      else              await crearChofer(form);
      // Update conjunto if remolque changed
      if (form.vehiculo_id && form.remolque_id !== undefined) {
        const veh = vehiculos?.find(v=>v.id===form.vehiculo_id);
        const currentRemolque = veh?.remolque_id || "";
        const newRemolque = form.remolque_id || "";
        if (newRemolque !== currentRemolque) {
          try { await asignarRemolque(form.vehiculo_id, newRemolque||null); }
          catch(e) {
            if (e.status === 409 && e.data?.requiere_confirmacion) {
              const ok = await confirmDialog({
                title: "Mover remolque",
                message: e.message || e.data?.error || "Este remolque ya esta asignado. Quieres moverlo a este conjunto?",
                confirmText: "Mover al conjunto",
                cancelText: "Cancelar",
                tone: "warning",
              });
              if (!ok) throw e;
              await asignarRemolque(form.vehiculo_id, newRemolque||null, {
                confirmar_reasignacion_remolque: true,
                force_reassign_remolque: true,
              });
            } else {
              throw e;
            }
          }
        }
      }
      onSaved();
    } catch(e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  }

  const TABS = [
    { id:"datos",       l:"Datos personales" },
    { id:"contrato",    l:"Contrato & Carnets" },
    { id:"nominas",  l:"Nóminas" },
    { id:"equipos",     l:"Equipos / EPIs" },
    { id:"jornadas",    l:"Jornadas" },
    { id:"historial_veh", l:"Historial vehículos" },
  ];

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:14,
                    width:"min(780px,98vw)", maxHeight:"97vh", display:"flex", flexDirection:"column" }}>

        {/* Header */}
        <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <div style={{ width:42, height:42, borderRadius:"50%", background:"var(--accent-dim)",
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>CH</div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:"var(--text)" }}>
              {editando ? (editando.nombre + (editando.apellidos ? " " + editando.apellidos : "")) : "Nuevo chofer"}
            </div>
            {editando && <div style={{ fontSize:11, color:"var(--text4)" }}>ID: {editando.id?.slice(0,8)}</div>}
          </div>
          {canEdit && tab !== "nominas" && tab !== "equipos" && (
            <button style={{ ...S.btn, background:"var(--accent)", color:"#fff" }} onClick={guardar} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          )}
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text4)", fontSize:18, cursor:"pointer" }}>Cerrar</button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:0, borderBottom:"1px solid var(--border)", flexShrink:0 }}>
          {TABS.filter(t => !editando ? t.id === "datos" || t.id === "contrato" : true).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:"8px 14px", border:"none", borderBottom:`2px solid ${tab===t.id?"var(--accent-l)":"transparent"}`,
                       background:"none", fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:600,
                       cursor:"pointer", color: tab===t.id?"var(--accent-xl)":"var(--text4)" }}>
              {t.l}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 20px" }}>

          {/* Datos personales */}
          {tab === "datos" && (
            <div>
              <div style={S.sec}>Datos personales</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Nombre *</label>
                  <input style={S.inp} value={form.nombre||""} onChange={f("nombre")} placeholder="José"/>
                </div>
                <div>
                  <label style={S.lbl}>Apellidos</label>
                  <input style={S.inp} value={form.apellidos||""} onChange={f("apellidos")} placeholder="García Pérez"/>
                </div>
                <div>
                  <label style={S.lbl}>DNI / NIE</label>
                  <input style={S.inp} value={form.dni||""} onChange={f("dni")} placeholder="12345678A"/>
                </div>
                <div>
                  <label style={S.lbl}>Sexo / género para informes retributivos</label>
                  <select value={form.sexo||""} onChange={f("sexo")} style={S.sel}>
                    <option value="">No indicado</option>
                    <option value="mujer">Mujer</option>
                    <option value="hombre">Hombre</option>
                    <option value="no_binario">No binario / otro</option>
                    <option value="no_consta">Prefiere no indicar</option>
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>Teléfono *</label>
                  <input style={S.inp} value={form.telefono||""} onChange={f("telefono")} placeholder="+34 600 000 000"/>
                </div>
                <div>
                  <label style={S.lbl}>Email</label>
                  <input type="email" style={S.inp} value={form.email||""} onChange={f("email")} placeholder="chofer@email.com"/>
                </div>
                <div>
                  <label style={S.lbl}>Tractora asignada</label>
                  <select value={form.vehiculo_id||""} onChange={e => setForm(p => ({ ...p, vehiculo_id:e.target.value, remolque_id:e.target.value ? p.remolque_id : "" }))} style={S.sel}>
                    <option value="">Sin asignar</option>
                    {tractoras.map(v => <option key={v.id} value={v.id}>{v.matricula} - {v.marca||""} {v.modelo||""}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>Remolque del conjunto</label>
                  <select value={form.remolque_id||""} onChange={f("remolque_id")} style={S.sel} disabled={!form.vehiculo_id}>
                    <option value="">Sin remolque</option>
                    {remolques.map(v => <option key={v.id} value={v.id}>{v.matricula} - {v.clase||""}</option>)}
                  </select>
                </div>
              </div>

              <div style={S.sec}>Domicilio</div>
              <div style={S.grid2}>
                <div style={{ gridColumn:"1/-1" }}>
                  <label style={S.lbl}>Dirección (calle y número)</label>
                  <input style={S.inp} value={form.direccion||""} onChange={f("direccion")} placeholder="Calle Mayor, 10, 3º B"/>
                </div>
                <div>
                  <label style={S.lbl}>Población *</label>
                  <input style={S.inp} value={form.poblacion||""} onChange={f("poblacion")} placeholder="Madrid"/>
                </div>
                <div>
                  <label style={S.lbl}>Código Postal *</label>
                  <input style={S.inp} value={form.cp||""} onChange={f("cp")} placeholder="28001"/>
                </div>
                <GeoFields
                  values={form}
                  onChange={(campo, valor) => setForm(p => ({ ...p, [campo]: valor }))}
                  inputStyle={S.inp}
                  labelStyle={S.lbl}
                />
              </div>

              <div style={S.sec}>Alta / Baja</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Fecha de alta *</label>
                  <input type="date" style={S.inp} value={form.fecha_alta||""} onChange={f("fecha_alta")}/>
                </div>
                <div>
                  <label style={S.lbl}>Fecha de baja (si procede)</label>
                  <input type="date" style={S.inp} value={form.fecha_baja||""} onChange={f("fecha_baja")}/>
                </div>
                <div>
                  <label style={S.lbl}>Estado</label>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10 }}>
                    <input type="checkbox" id="activo_check" checked={form.activo!==false} onChange={onActivoChange} style={{ width:16, height:16, accentColor:"var(--green)" }}/>
                    <label htmlFor="activo_check" style={{ fontSize:13, color:"var(--text2)", cursor:"pointer" }}>Activo (en plantilla)</label>
                  </div>
                </div>
                <div>
                  <label style={S.lbl}>Tipo de contrato</label>
                  <select value={form.tipo_contrato||""} onChange={f("tipo_contrato")} style={S.sel}>
                    <option value="">Seleccionar...</option>
                    {["Indefinido","Temporal","Por obra","A tiempo parcial","Autónomo"].map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>Puesto / trabajo de igual valor</label>
                  <input style={S.inp} value={form.puesto_valor||""} onChange={f("puesto_valor")} placeholder="Conductor ruta nacional, tráfico local..."/>
                </div>
                {form.activo === false && (
                  <>
                    <div style={{ gridColumn:"1/-1" }}>
                      <label style={S.lbl}>Motivo de baja *</label>
                      <textarea style={{ ...S.inp, height:64, resize:"vertical" }} value={form.motivo_baja||""} onChange={f("motivo_baja")} placeholder="Renuncia voluntaria, fin de contrato, baja empresa..."/>
                    </div>
                    <div style={{ gridColumn:"1/-1" }}>
                      <label style={S.lbl}>Carta de renuncia / documento de baja *</label>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" style={S.inp} onChange={onCartaRenuncia}/>
                      <div style={{fontSize:11,color:form.carta_renuncia_base64 ? "var(--green)" : "var(--text5)",marginTop:5}}>
                        {form.carta_renuncia_nombre || "Documento pendiente"}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div style={S.sec}>Notas</div>
              <textarea style={{ ...S.inp, height:70, resize:"vertical" }}
                value={form.notas||""} onChange={f("notas")} placeholder="Observaciones del chofer..."/>
            </div>
          )}

          {/* Contrato y Carnets */}
          {tab === "contrato" && (
            <div>
              <div style={S.sec}>DNI / NIE</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Número DNI / NIE</label>
                  <input style={S.inp} value={form.dni||""} onChange={f("dni")} placeholder="12345678A"/>
                </div>
                <div>
                  <label style={S.lbl}>Vencimiento DNI</label>
                  <input type="date" style={S.inp} value={form.dni_vencimiento||""} onChange={f("dni_vencimiento")}/>
                </div>
              </div>

              <div style={S.sec}>Carnet de conducir</div>
              <div style={S.grid3}>
                <div>
                  <label style={S.lbl}>Número carnet</label>
                  <input style={S.inp} value={form.carnet||""} onChange={f("carnet")} placeholder="12345678"/>
                </div>
                <div>
                  <label style={S.lbl}>Categoría(s)</label>
                  <input style={S.inp} value={form.carnet_tipo||""} onChange={f("carnet_tipo")} placeholder="B, C, C+E, D..."/>
                </div>
                <div>
                  <label style={S.lbl}>Vencimiento</label>
                  <input type="date" style={S.inp} value={form.carnet_vencimiento||""} onChange={f("carnet_vencimiento")}/>
                </div>
              </div>

              <div style={S.sec}>CAP - Certificado de Aptitud Profesional</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Fecha vencimiento CAP</label>
                  <input type="date" style={S.inp} value={form.cap_vencimiento||""} onChange={f("cap_vencimiento")}/>
                </div>
              </div>

              <div style={S.sec}>Tarjeta de conductor (tacógrafo digital)</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Número tarjeta</label>
                  <input style={S.inp} value={form.tarjeta_tg||""} onChange={f("tarjeta_tg")} placeholder="ES1234567890"/>
                </div>
                <div>
                  <label style={S.lbl}>Vencimiento tarjeta</label>
                  <input type="date" style={S.inp} value={form.tarjeta_vencimiento||""} onChange={f("tarjeta_vencimiento")}/>
                </div>
              </div>

              <div style={S.sec}>ADR - Mercancías peligrosas (si aplica)</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Número certificado ADR</label>
                  <input style={S.inp} value={form.adr_numero||""} onChange={f("adr_numero")} placeholder="Opcional"/>
                </div>
                <div>
                  <label style={S.lbl}>Vencimiento ADR</label>
                  <input type="date" style={S.inp} value={form.adr_vencimiento||""} onChange={f("adr_vencimiento")}/>
                </div>
              </div>

              <div style={S.sec}>Reconocimiento médico</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Vencimiento reconocimiento médico</label>
                  <input type="date" style={S.inp} value={form.medico_vencimiento||""} onChange={f("medico_vencimiento")}/>
                </div>
              </div>

              {/* Vista de vencimientos */}
              <div style={S.sec}>Estado de documentación</div>
              <TabDocumentacion chofer={form} />
            </div>
          )}

          {/* Nóminas */}
          {tab === "nominas" && editando && <TabNominas chofer={editando} />}

          {/* Equipos / EPIs */}
          {tab === "equipos" && editando && <TabEquipos chofer={editando} tallerState={tallerState} onPersistTallerState={persistTallerState} />}
          {tab === "jornadas" && editando && <TabJornadas chofer={editando} />}
          {tab === "historial_veh" && editando && <TabHistorialVehiculos chofer={editando} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function readChoferesFocus() {
  return readRuntimeFocus("tms_choferes_focus");
}

export default function Choferes() {
  const { puedeEditar }  = useAuth();
  const canEdit          = puedeEditar("choferes");
  const [focusChofer]    = useState(() => readChoferesFocus());
  const [choferes,  setChoferes]  = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [tallerState, setTallerState] = useState(() => ({ ...EMPTY_TALLER_CHOFER }));
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [filtro,    setFiltro]    = useState("todos");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [c, v, taller] = await Promise.all([getChoferes("todos").catch(()=>[]), getVehiculos().catch(()=>[]), getTallerEstado().catch(()=>null)]);
      setChoferes(Array.isArray(c) ? c : []);
      setVehiculos(Array.isArray(v) ? v : []);
      if (taller && typeof taller === "object") {
        const nextTallerState = {
          ...taller,
          stock: Array.isArray(taller.stock) ? taller.stock : [],
          entregas_equipos_choferes: taller.entregas_equipos_choferes || {},
        };
        setTallerState(nextTallerState);
      }
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const persistTallerState = useCallback(async (nextState) => {
    setTallerState({
      ...(nextState || {}),
      stock: Array.isArray(nextState?.stock) ? nextState.stock : [],
      entregas_equipos_choferes: nextState?.entregas_equipos_choferes || {},
    });
    try {
      await guardarTallerEstado(nextState);
    } catch (e) {
      notify("La entrega se ha actualizado en pantalla, pero no se pudo sincronizar con la base de datos: " + e.message, "warning");
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (!focusChofer?.chofer_id || loading) return;
    const found = choferes.find(c => String(c.id) === String(focusChofer.chofer_id));
    if (!found) return;
    const t = window.setTimeout(() => {
      document.getElementById(`chofer-row-${focusChofer.chofer_id}`)?.scrollIntoView({ behavior:"smooth", block:"center" });
      clearRuntimeFocus("tms_choferes_focus");
    }, 180);
    return () => window.clearTimeout(t);
  }, [choferes, focusChofer, loading]);

  const filtrados = choferes.filter(c => {
    if (filtro === "activos")  return c.activo !== false;
    if (filtro === "baja")     return c.activo === false;
    return true;
  });

  // Badge de docs próximos a caducar
  function alertasDocs(c) {
    const keys = ["dni_vencimiento","carnet_vencimiento","cap_vencimiento","tarjeta_vencimiento","adr_vencimiento","medico_vencimiento"];
    return keys.some(k => c[k] && semaforo(c[k]).nivel <= 1);
  }

  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <div style={S.title}>Chóferes</div>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          {["todos","activos","baja"].map(v => (
            <button key={v} onClick={() => setFiltro(v)}
              style={{ ...S.btn, background: filtro===v ? "var(--accent)" : "var(--bg4)",
                       color: filtro===v ? "#fff" : "var(--text3)", border:"1px solid var(--border2)" }}>
              {v==="todos"?"Todos":v==="activos"?"Activos":"De baja"}
            </button>
          ))}
          {canEdit && (
            <button style={{ ...S.btn, background:"var(--accent)", color:"#fff" }}
              onClick={() => { setEditando(null); setModal(true); }}>
              + Nuevo chofer
            </button>
          )}
        </div>
      </div>

      <div style={S.card}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>{["Nombre","DNI/NIE","Teléfono","Población","Alta","Carnet","Estado",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading
              ? <tr><td colSpan={8} style={{ ...S.td, textAlign:"center", color:"var(--text5)" }}>Cargando...</td></tr>
              : filtrados.length === 0
              ? <tr><td colSpan={8} style={{ ...S.td, textAlign:"center", color:"var(--text5)", padding:32 }}>Sin choferes registrados</td></tr>
              : filtrados.map(c => {
                const alerta = alertasDocs(c);
                const veh    = vehiculos.find(v => v.id === c.vehiculo_id);
                return (
                  <tr key={c.id} id={`chofer-row-${c.id}`} onClick={() => { setEditando(c); setModal(true); }}
                    style={{
                      cursor:"pointer",
                      background:String(focusChofer?.chofer_id || "") === String(c.id) ? "rgba(34,211,160,.10)" : undefined,
                      boxShadow:String(focusChofer?.chofer_id || "") === String(c.id) ? "inset 3px 0 0 var(--green)" : undefined,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background="var(--row-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background=String(focusChofer?.chofer_id || "") === String(c.id) ? "rgba(34,211,160,.10)" : "transparent"}>
                    <td style={{ ...S.td, fontWeight:700 }}>
                      {c.nombre} {c.apellidos||""}
                      {alerta && <span title="Documentación próxima a caducar" style={{ marginLeft:6, color:"var(--orange)" }}>Aviso</span>}
                    </td>
                    <td style={{ ...S.td, fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"var(--text2)" }}>{c.dni||"-"}</td>
                    <td style={{ ...S.td, fontSize:12 }}>{c.telefono||"-"}</td>
                    <td style={{ ...S.td, fontSize:12, color:"var(--text3)" }}>{c.poblacion||"-"}</td>
                    <td style={{ ...S.td, fontSize:11, color:"var(--text4)", fontFamily:"'JetBrains Mono',monospace" }}>
                      {c.fecha_alta ? new Date(c.fecha_alta).toLocaleDateString("es-ES") : "-"}
                    </td>
                    <td style={{ ...S.td, fontSize:11, color:"var(--text3)", fontFamily:"'JetBrains Mono',monospace" }}>
                      {c.carnet_tipo || c.carnet || "-"}
                      {c.carnet_vencimiento && (
                        <span style={{ marginLeft:6, ...S.badge, background:`${semaforo(c.carnet_vencimiento).color}15`, color:semaforo(c.carnet_vencimiento).color, fontSize:10 }}>
                          {semaforo(c.carnet_vencimiento).label}
                        </span>
                      )}
                    </td>
                    <td style={S.td}>
                      <span style={{ ...S.badge, background: c.activo!==false ? "var(--green-dim)" : "rgba(239,68,68,.1)", color: c.activo!==false ? "var(--green)" : "var(--red)" }}>
                        {c.activo!==false ? "Activo" : "Baja"}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontSize:11, color:"var(--text4)" }}>
                      {veh ? <span>{veh.matricula}</span> : <span style={{ color:"var(--text5)" }}>Sin vehículo</span>}
                    </td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </div>

      {modal && (
        <ModalChofer
          editando={editando}
          vehiculos={vehiculos}
          tallerState={tallerState}
          persistTallerState={persistTallerState}
          onClose={() => { setModal(false); setEditando(null); }}
          onSaved={() => { setModal(false); setEditando(null); cargar(); }}
        />
      )}
    </div>
  );
}

