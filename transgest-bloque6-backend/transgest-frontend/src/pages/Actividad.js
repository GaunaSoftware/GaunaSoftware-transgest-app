import { useCallback, useEffect, useMemo, useState } from "react";
import { getActividad } from "../services/api";
import { notify } from "../services/notify";

const S = {
  page: { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif", minWidth:0, overflowX:"hidden" },
  title:{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:800, color:"var(--text)", marginBottom:4 },
  sub:  { fontSize:12, color:"var(--text4)", marginBottom:18 },
  card: { background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, padding:"13px 15px" },
  btn:  { padding:"7px 12px", borderRadius:7, border:"1px solid var(--border2)", background:"var(--bg4)", color:"var(--text)", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  inp:  { background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"7px 10px", borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:12, outline:"none" },
};

const MODULOS = [
  ["", "Todos los modulos"],
  ["pedidos", "Pedidos"],
  ["facturas", "Facturacion"],
  ["clientes", "Clientes"],
  ["vehiculos", "Vehiculos"],
  ["choferes", "Choferes"],
  ["colaboradores", "Colaboradores"],
  ["taller", "Taller"],
  ["palets", "Almacen"],
  ["informes", "Informes"],
  ["usuarios", "Usuarios"],
  ["portal-cliente", "Portal cliente"],
  ["superadmin", "Superadmin"],
];

function etiquetaAccion(accion) {
  const raw = String(accion || "");
  if (raw.includes("/pedidos")) return "Pedidos";
  if (raw.includes("/facturas")) return "Facturacion";
  if (raw.includes("/clientes")) return "Clientes";
  if (raw.includes("/vehiculos")) return "Vehiculos";
  if (raw.includes("/choferes")) return "Choferes";
  if (raw.includes("/colaboradores")) return "Colaboradores";
  if (raw.includes("/notificaciones")) return "Avisos";
  if (raw.includes("/informes/excepciones")) return "Excepciones";
  if (raw.includes("/taller")) return "Taller";
  if (raw.includes("/palets")) return "Almacen";
  if (raw.includes("/portal-cliente")) return "Portal cliente";
  if (raw.includes("/superadmin")) return "Soporte";
  return raw.split(" ")[0] || "Actividad";
}

function metodoColor(method) {
  if (method === "POST") return "var(--green)";
  if (method === "PUT" || method === "PATCH") return "#f59e0b";
  if (method === "DELETE") return "#ef4444";
  return "var(--accent-l)";
}

function metodoNegocio(method) {
  if (method === "POST") return "Alta";
  if (method === "PUT") return "Edicion";
  if (method === "PATCH") return "Cambio";
  if (method === "DELETE") return "Baja";
  return "Accion";
}

function criticidadColor(criticidad) {
  if (criticidad === "critica") return "#ef4444";
  if (criticidad === "alta") return "#f59e0b";
  if (criticidad === "media") return "var(--accent-xl)";
  return "var(--text5)";
}

function accionVisible(item = {}) {
  const method = item.method || String(item.accion || "").split(" ")[0] || "ACCION";
  const path = item.path || String(item.accion || "").replace(method, "").trim();
  const modulo = item.modulo || etiquetaAccion(item.accion);
  const verb = method === "POST" ? "Alta" : method === "PUT" ? "Edicion" : method === "PATCH" ? "Cambio" : method === "DELETE" ? "Baja" : "Accion";
  const body = item.detalle?.body && typeof item.detalle.body === "object" ? item.detalle.body : {};
  const ref = body.numero || body.referencia || body.referencia_cliente || body.nombre || body.razon_social || body.email || "";
  if (path.includes("/pedidos")) return `${verb} de pedido${ref ? ` ${ref}` : ""}`;
  if (path.includes("/facturas")) return `${verb} de factura${ref ? ` ${ref}` : ""}`;
  if (path.includes("/clientes")) return `${verb} de cliente${ref ? ` ${ref}` : ""}`;
  if (path.includes("/vehiculos")) return `${verb} de vehiculo${ref ? ` ${ref}` : ""}`;
  if (path.includes("/choferes")) return `${verb} de chofer${ref ? ` ${ref}` : ""}`;
  if (path.includes("/colaboradores")) return `${verb} de colaborador${ref ? ` ${ref}` : ""}`;
  if (path.includes("/taller")) return `${verb} en taller${ref ? ` ${ref}` : ""}`;
  if (path.includes("/palets")) return `${verb} en almacen${ref ? ` ${ref}` : ""}`;
  return `${verb} en ${modulo}`;
}

function detalleVisible(item = {}) {
  const body = item.detalle?.body && typeof item.detalle.body === "object" ? item.detalle.body : {};
  const keys = Object.keys(body).filter(k => !["password", "token", "file_base64", "firma"].some(bad => k.toLowerCase().includes(bad))).slice(0, 6);
  if (!keys.length) return "";
  return `Campos: ${keys.map(k => k.replace(/_/g, " ")).join(", ")}`;
}

function csvCell(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function parseStatus(item) {
  return Number(item?.detalle?.status || 0);
}

export default function Actividad() {
  const [items, setItems] = useState([]);
  const [porModulo, setPorModulo] = useState({});
  const [totales, setTotales] = useState({});
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState({
    accion:"",
    actor:"",
    modulo:"",
    criticidad:"",
    desde:"",
    hasta:"",
    limit:"120",
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const clean = Object.fromEntries(Object.entries(filtros).filter(([,v]) => v !== ""));
      const data = await getActividad(clean);
      setItems(Array.isArray(data?.data) ? data.data : []);
      setPorModulo(data?.porModulo || {});
      setTotales(data?.totales || {});
    } catch(e) {
      notify(e.message || "No se pudo cargar el registro de actividad", "error");
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  const moduloItems = useMemo(() => Object.entries(porModulo)
    .sort((a,b) => Number(b[1]) - Number(a[1]))
    .slice(0, 6), [porModulo]);

  const f = key => e => setFiltros(prev => ({ ...prev, [key]: e.target.value }));

  function exportarCsv() {
    const header = ["fecha", "usuario", "accion", "modulo", "criticidad", "detalle"];
    const rows = items.map(item => [
      item.created_at ? new Date(item.created_at).toLocaleString("es-ES") : "",
      item.actor_email || "",
      accionVisible(item),
      item.modulo || etiquetaAccion(item.accion),
      item.criticidad || "baja",
      detalleVisible(item),
    ]);
    const csv = [header, ...rows].map(row => row.map(csvCell).join(";")).join("\n");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `registro-actividad-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={S.page}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,marginBottom:16,flexWrap:"wrap"}}>
        <div style={{minWidth:0,flex:"1 1 360px"}}>
          <div style={S.title}>Trazabilidad</div>
          <div style={S.sub}>Vista de negocio para gerencia: quien cambio que, cuando y en que area. No se muestran IP, rutas tecnicas ni codigos internos.</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={exportarCsv} disabled={!items.length} style={{...S.btn,background:"rgba(59,130,246,.12)",borderColor:"rgba(59,130,246,.3)",color:"var(--accent-xl)",opacity:items.length?1:.55}}>
            Exportar CSV
          </button>
          <button onClick={cargar} style={{...S.btn,background:"rgba(34,211,160,.12)",borderColor:"rgba(34,211,160,.3)",color:"var(--green)"}}>
            Actualizar
          </button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:14}}>
        {[
          ["Registros", totales.registros || items.length || 0, "var(--text)"],
          ["Incidencias", totales.errores || 0, Number(totales.errores || 0) ? "#ef4444" : "var(--green)"],
          ["Usuarios", totales.usuarios || 0, "var(--accent-xl)"],
          ["Criticos/altos", totales.altas || 0, Number(totales.altas || 0) ? "#f59e0b" : "var(--green)"],
        ].map(([label, value, color]) => (
          <div key={label} style={S.card}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:800,color}}>{Number(value || 0).toLocaleString("es-ES")}</div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginTop:3}}>{label}</div>
          </div>
        ))}
      </div>

      {moduloItems.length > 0 && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
          {moduloItems.map(([label, value]) => (
            <button key={label} onClick={()=>setFiltros(prev=>({...prev, modulo:label}))} style={{...S.btn,padding:"5px 10px",fontSize:11,background:filtros.modulo===label?"rgba(34,211,160,.14)":"var(--bg4)",color:filtros.modulo===label?"var(--green)":"var(--text4)"}}>
              {label} - {Number(value || 0).toLocaleString("es-ES")}
            </button>
          ))}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,alignItems:"end",marginBottom:14}}>
        <div>
          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Accion</div>
          <input value={filtros.accion} onChange={f("accion")} placeholder="pedidos, facturas..." style={{...S.inp,width:"100%"}} />
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Usuario</div>
          <input value={filtros.actor} onChange={f("actor")} placeholder="email o usuario" style={{...S.inp,width:"100%"}} />
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Modulo</div>
          <select value={filtros.modulo} onChange={f("modulo")} style={{...S.inp,width:"100%"}}>
            {MODULOS.map(([id,label]) => <option key={id || "all"} value={id}>{label}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Criticidad</div>
          <select value={filtros.criticidad} onChange={f("criticidad")} style={{...S.inp,width:"100%"}}>
            <option value="">Todas</option>
            <option value="critica">Critica</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Desde</div>
          <input type="date" value={filtros.desde} onChange={f("desde")} style={{...S.inp,width:"100%"}} />
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4}}>Hasta</div>
          <input type="date" value={filtros.hasta} onChange={f("hasta")} style={{...S.inp,width:"100%"}} />
        </div>
        <button onClick={cargar} style={{...S.btn,width:"100%",justifyContent:"center"}}>Filtrar</button>
      </div>

      {loading ? (
        <div style={{...S.card,textAlign:"center",color:"var(--text5)",padding:28}}>Cargando actividad...</div>
      ) : items.length === 0 ? (
        <div style={{...S.card,textAlign:"center",color:"var(--text5)",padding:28}}>Sin actividad para estos filtros.</div>
      ) : (
        <div style={{display:"grid",gap:8}}>
          {items.map(item => {
            const method = item.method || String(item.accion || "").split(" ")[0] || "ACCION";
            const color = metodoColor(method);
            const status = item.status || parseStatus(item);
            const cColor = criticidadColor(item.criticidad);
            const estadoNegocio = status >= 400 ? "requiere revision" : "cambio registrado";
            return (
              <div key={item.id} style={{...S.card,display:"grid",gridTemplateColumns:"minmax(92px,.35fr) minmax(220px,1fr) minmax(150px,.45fr)",gap:12,alignItems:"center",borderColor:status >= 400 ? "rgba(239,68,68,.45)" : "var(--border)",overflow:"hidden"}}>
                <div style={{minWidth:0}}>
                  <div style={{display:"inline-flex",padding:"3px 9px",borderRadius:20,background:`${color}18`,color,fontSize:11,fontWeight:900}}>
                    {metodoNegocio(method)}
                  </div>
                  <div style={{fontSize:11,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",marginTop:7}}>
                    {item.modulo || etiquetaAccion(item.accion)}
                  </div>
                </div>
                <div style={{minWidth:0,overflow:"hidden"}}>
                  <div style={{fontSize:13,fontWeight:800,color:"var(--text)",marginBottom:3,overflowWrap:"anywhere",lineHeight:1.35}}>{accionVisible(item)}</div>
                  <div style={{fontSize:12,color:"var(--text4)",overflowWrap:"anywhere",lineHeight:1.35}}>
                    {item.actor_email || "usuario"} - {estadoNegocio}
                  </div>
                  {detalleVisible(item) && (
                    <div style={{fontSize:11,color:"var(--text5)",marginTop:4,overflowWrap:"anywhere"}}>{detalleVisible(item)}</div>
                  )}
                  <div style={{display:"inline-flex",marginTop:6,padding:"2px 8px",borderRadius:999,background:`${cColor}18`,border:`1px solid ${cColor}44`,color:cColor,fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".05em"}}>
                    {item.criticidad || "baja"}
                  </div>
                </div>
                <div style={{textAlign:"right",minWidth:0}}>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--text3)",overflowWrap:"anywhere"}}>
                    {item.created_at ? new Date(item.created_at).toLocaleString("es-ES") : ""}
                  </div>
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>{status >= 400 ? "Revisar" : "Completado"}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
