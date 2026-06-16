import { useState, useEffect, useMemo } from "react";
import { getRutas, crearRuta, editarRuta, borrarRuta, getRutaPrecios, editarRutaPrecios, getClientes, importarRutas } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";

const S={
  page:{padding:"24px 28px",minWidth:0},
  title:{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,marginBottom:16,color:"var(--text)"},
  card:{background:"var(--bg2)",border:"1px solid #181e2e",borderRadius:12,overflow:"hidden"},
  th:{textAlign:"left",padding:"9px 14px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",borderBottom:"1px solid #181e2e",background:"var(--bg3)"},
  td:{padding:"10px 14px",borderBottom:"1px solid #181e2e",fontSize:13,color:"var(--text)"},
  btn:{padding:"8px 16px",borderRadius:7,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  inp:{background:"var(--bg4)",border:"1px solid #28344f",color:"var(--text)",padding:"8px 12px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,width:"100%",boxSizing:"border-box"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"},
  mbox:{background:"var(--bg2)",border:"1px solid #28344f",borderRadius:16,padding:28,width:"min(600px,96vw)",maxHeight:"90vh",overflowY:"auto"},
  label:{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:12},
};

const TIPOS_VEHICULO=[
  {v:"cualquiera",l:"Cualquier vehículo"},
  {v:"tautliner",l:"Tautliner / Lona"},
  {v:"banera",l:"Banera"},
  {v:"frigorifico",l:"Frigorífico"},
  {v:"cisterna",l:"Cisterna"},
  {v:"portacoches",l:"Portacoches"},
  {v:"lowboy",l:"Lowboy / Góndola"},
  {v:"caja",l:"Caja cerrada"},
  {v:"adr",l:"ADR (mercancía peligrosa)"},
];

const TIPOS_TARIFA = [
  { v:"viaje", l:"Viaje cerrado" },
  { v:"kg", l:"Por 100 kg" },
  { v:"tonelada", l:"Por tonelada" },
  { v:"km", l:"Por km" },
  { v:"hora", l:"Por hora" },
  { v:"palet", l:"Por palet" },
];

const fmt2=n=>Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2});
const getClienteMinimoToneladas = (ruta) => {
  const value = Number(ruta?.cliente_minimo_facturable_toneladas ?? ruta?.minimo_facturable_toneladas ?? 0);
  return value > 0 ? value : 0;
};
const getMinimoUnidadesRuta = (ruta) => {
  const value = Number(ruta?.minimo_unidades || 0);
  return value > 0 ? value : 0;
};
const getMinimoDescriptor = (ruta) => {
  const tipo = String(ruta?.tarifa_tipo || "viaje");
  if (tipo === "viaje") {
    const minimo = Number(ruta?.minimo_facturable || 0);
    return minimo > 0 ? { value: minimo, unit: "EUR", fromClient: false } : null;
  }
  if (tipo === "tonelada") {
    const minimoRuta = getMinimoUnidadesRuta(ruta);
    const minimoCliente = getClienteMinimoToneladas(ruta);
    const value = minimoRuta || minimoCliente;
    return value > 0 ? { value, unit: "t", fromClient: !minimoRuta && minimoCliente > 0 } : null;
  }
  if (tipo === "kg") {
    const minimoRuta = getMinimoUnidadesRuta(ruta);
    const minimoCliente = getClienteMinimoToneladas(ruta);
    if (minimoRuta > 0) return { value: minimoRuta, unit: "100 kg", fromClient: false };
    if (minimoCliente > 0) return { value: minimoCliente * 10, unit: "100 kg", fromClient: true };
    return null;
  }
  if (tipo === "km") {
    const km = Number(ruta?.km || 0);
    return km > 0 ? { value: km, unit: "km", fromClient: false } : null;
  }
  const minimo = getMinimoUnidadesRuta(ruta);
  const unit = tipo === "hora" ? "h" : tipo === "palet" ? "palets" : "u.";
  return minimo > 0 ? { value: minimo, unit, fromClient: false } : null;
};
const getIngresoBaseRuta = (ruta, precioFinal) => {
  const tipo = String(ruta?.tarifa_tipo || "viaje");
  const minimo = getMinimoDescriptor(ruta);
  if (tipo === "km") return precioFinal * Number(ruta?.km || 0);
  if (tipo === "viaje") {
    const minimoFacturable = Number(ruta?.minimo_facturable || 0);
    return Math.max(precioFinal, minimoFacturable || 0);
  }
  if (["tonelada", "kg", "hora", "palet"].includes(tipo)) {
    return precioFinal * Number(minimo?.value || 1);
  }
  return precioFinal;
};
const fmtTarifa = (ruta) => {
  const tipo = TIPOS_TARIFA.find(t => t.v === (ruta.tarifa_tipo || "viaje"))?.l || (ruta.tarifa_tipo || "Viaje");
  const precio = fmt2(ruta.precio_base || 0);
  return `${tipo} · ${precio} €`;
};
const fmtMinimo = (ruta) => {
  if ((ruta.tarifa_tipo || "viaje") === "viaje") return ruta.minimo_facturable ? `${fmt2(ruta.minimo_facturable)} €` : "—";
  return ruta.minimo_unidades ? String(ruta.minimo_unidades) : "—";
};

const margenRuta = (ruta) => {
  const precio = Number(ruta?.precio_base || 0);
  const recargo = Number(ruta?.recargo_combustible_pct || 0) || 0;
  const km = Number(ruta?.km || 0);
  const peajes = Number(ruta?.peajes || 0);
  const tipo = String(ruta?.tarifa_tipo || "viaje");
  const costeKm = 0.42 + (km > 0 ? peajes / km : 0);
  const precioFinal = precio * (1 + recargo / 100);
  const ingresoTotal = tipo === "km" ? precioFinal * km : precioFinal;
  const ingresoKm = km > 0 ? (tipo === "km" ? precioFinal : ingresoTotal / km) : 0;
  const margenKm = km > 0 ? ingresoKm - costeKm : 0;
  const margen = km > 0 ? margenKm * km : ingresoTotal - peajes;
  const pct = ingresoKm > 0 ? (margenKm / ingresoKm) * 100 : 0;
  return { margen, pct, margenKm, ingresoKm, costeKm };
};

const calcularMargenRuta = (ruta) => {
  const precio = Number(ruta?.precio_base || 0);
  const recargo = Number(ruta?.recargo_combustible_pct || 0) || 0;
  const km = Number(ruta?.km || 0);
  const peajes = Number(ruta?.peajes || 0);
  const costeKm = 0.42 + (km > 0 ? peajes / km : 0);
  const precioFinal = precio * (1 + recargo / 100);
  const ingresoTotal = getIngresoBaseRuta(ruta, precioFinal);
  const ingresoKm = km > 0 ? ingresoTotal / km : 0;
  const margenKm = km > 0 ? ingresoKm - costeKm : 0;
  const margen = km > 0 ? margenKm * km : ingresoTotal - peajes;
  const pct = ingresoKm > 0 ? (margenKm / ingresoKm) * 100 : 0;
  return { margen, pct, margenKm, ingresoKm, ingresoTotal, costeKm };
};

export default function Rutas(){
  void fmtTarifa;
  void fmtMinimo;
  void margenRuta;
  const {puedeEditar}=useAuth();
  const canEdit=puedeEditar("rutas");
  const [rutas,setRutas]=useState([]);
  const [clientes,setClientes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(false);
  const [editando,setEditando]=useState(null);
  const [form,setForm]=useState({});
  const [saving,setSaving]=useState(false);
  const [showPrecios,setShowPrecios]=useState(null);
  const [preciosData,setPreciosData]=useState(null);
  const [expandedClientes,setExpandedClientes]=useState({});
  const [expandedVehiculos,setExpandedVehiculos]=useState({});
  const [filtroCliente,setFiltroCliente]=useState("todos");
  const [filtroTexto,setFiltroTexto]=useState("");
  const [filtroTipo,setFiltroTipo]=useState("todos");
  const [filtroTarifa,setFiltroTarifa]=useState("todos");
  const [soloMargenNegativo,setSoloMargenNegativo]=useState(false);
  const [importando,setImportando]=useState(false);
  const [importFile,setImportFile]=useState(null);
  const fmtTarifaVista = (ruta) => {
    const tipo = TIPOS_TARIFA.find(t => t.v === (ruta.tarifa_tipo || "viaje"))?.l || (ruta.tarifa_tipo || "Viaje");
    const precio = fmt2(ruta.precio_base || 0);
    const recargo = Number(ruta.recargo_combustible_pct || 0) || 0;
    const precioFinal = Number(ruta.precio_base || 0) * (1 + recargo / 100);
    return recargo > 0
      ? `${tipo} - ${precio} EUR base - ${fmt2(precioFinal)} EUR final`
      : `${tipo} - ${precio} EUR`;
  };
  const fmtMinimoVista = (ruta) => {
    const minimo = getMinimoDescriptor(ruta);
    if (!minimo) return "-";
    return `${fmt2(minimo.value)} ${minimo.unit}${minimo.fromClient ? " (cliente)" : ""}`;
  };

  const cargar=async()=>{
    setLoading(true);
    try {
      const [r,c]=await Promise.all([getRutas(), getClientes()]);
      setRutas(Array.isArray(r)?r:[]);
      setClientes(Array.isArray(c)?c:Array.isArray(c?.data)?c.data:[]);
    } catch(e){}
    finally{setLoading(false);}
  };
  useEffect(()=>{cargar();},[]);

  const f=k=>e=>setForm(p=>({...p,[k]:e.target.value}));

  function leerArchivoBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function importarArchivo() {
    if (!filtroCliente || ["todos","generales"].includes(filtroCliente)) {
      notify("Selecciona un cliente concreto antes de importar rutas.", "warning");
      return;
    }
    if (!importFile) {
      notify("Selecciona un Excel, CSV, TXT o PDF con las rutas.", "warning");
      return;
    }
    setImportando(true);
    try {
      const file_base64 = await leerArchivoBase64(importFile);
      const result = await importarRutas({
        cliente_id: filtroCliente,
        nombre: importFile.name,
        file_mime: importFile.type || "application/octet-stream",
        file_base64,
      });
      notify(`Importacion completada: ${result.total || 0} rutas (${result.creadas || 0} nuevas, ${result.actualizadas || 0} actualizadas).`, "success");
      setImportFile(null);
      cargar();
    } catch (e) {
      notify(e.message || "No se pudieron importar las rutas.", "error");
    } finally {
      setImportando(false);
    }
  }

  async function guardar(){
    if(!form.cliente_id){notify("Selecciona el cliente de la ruta.", "warning");return;}
    if(!form.origen?.trim()||!form.destino?.trim()){notify("Origen y destino son obligatorios", "warning");return;}
    setSaving(true);
    try{
      const payload={...form,
        origen:form.origen.trim().toUpperCase(),
        destino:form.destino.trim().toUpperCase(),
        km:form.km||null,peajes:form.peajes||0,
        tipo_vehiculo:form.tipo_vehiculo||"cualquiera",
        pct_subida:Number(form.pct_subida)||0,
        cliente_id:form.cliente_id||null,
        tarifa_tipo:form.tarifa_tipo||"viaje",
        precio_base:form.precio_base||0,
        minimo_facturable:form.tarifa_tipo==="viaje" ? (form.minimo_facturable||null) : null,
        minimo_unidades:form.tarifa_tipo!=="viaje" ? (form.minimo_unidades||null) : null,
        recargo_combustible_pct:form.recargo_combustible_pct||0,
      };
      if(editando) await editarRuta(editando.id,payload);
      else         await crearRuta(payload);
      setModal(false); cargar();
    }catch(e){notify(e.message, "error");}
    finally{setSaving(false);}
  }

  async function eliminarRuta(ruta){
    const ok = await confirmDialog({
      title: "Desactivar ruta",
      message: `La ruta ${ruta.origen} -> ${ruta.destino} dejara de aparecer en el listado. No se borran pedidos historicos.`,
      confirmText: "Desactivar",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if(!ok) return;
    try{
      await borrarRuta(ruta.id);
      if(showPrecios?.id===ruta.id) setShowPrecios(null);
      cargar();
    }catch(e){notify(e.message, "error");}
  }

  async function verPrecios(ruta){
    setShowPrecios(ruta);
    try{const d=await getRutaPrecios(ruta.id);setPreciosData(d);}
    catch(e){setPreciosData(null);}
  }

  function abrirModal(ruta=null){
    setEditando(ruta);
    setForm(ruta||{cliente_id:(!["todos","generales"].includes(filtroCliente)?filtroCliente:""),tipo_vehiculo:"cualquiera",pct_subida:0,tarifa_tipo:"viaje",precio_base:"",minimo_facturable:"",minimo_unidades:"",recargo_combustible_pct:0});
    setModal(true);
  }

  function toggleCliente(cid){
    setExpandedClientes(p=>({...p,[cid]:!p[cid]}));
  }
  function toggleVehiculo(key){
    setExpandedVehiculos(p=>({...p,[key]:!p[key]}));
  }

  // Group rutas by cliente, then by tipo_vehiculo
  const grouped=useMemo(()=>{
    const q = filtroTexto.trim().toLowerCase();
    const filtered=(filtroCliente==="todos" ? rutas : rutas.filter(r=>r.cliente_id===filtroCliente))
      .filter(r=>r.cliente_id)
      .filter(r=>!q || [r.origen,r.destino,r.cliente_nombre,r.notas].some(v=>String(v||"").toLowerCase().includes(q)))
      .filter(r=>filtroTipo==="todos" || String(r.tipo_vehiculo||"cualquiera")===filtroTipo)
      .filter(r=>filtroTarifa==="todos" || String(r.tarifa_tipo||"viaje")===filtroTarifa)
      .filter(r=>!soloMargenNegativo || calcularMargenRuta(r).margen < 0);

    const byCliente={};
    filtered.forEach(r=>{
              const ckey=r.cliente_id;
              if(!byCliente[ckey]) byCliente[ckey]={
                id:ckey,
                nombre:r.cliente_nombre||clientes.find(c=>c.id===r.cliente_id)?.nombre||"Cliente sin nombre",
        rutas:[],
      };
      byCliente[ckey].rutas.push(r);
    });

    // Sort by client
    return Object.values(byCliente).sort((a,b)=>{
      return a.nombre.localeCompare(b.nombre);
    });
  },[rutas,filtroCliente,filtroTexto,filtroTipo,filtroTarifa,soloMargenNegativo,clientes]);

  return(
    <div style={S.page}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={S.title}>Rutas y tarifas</div>
          <div style={{fontSize:12,color:"var(--text4)",maxWidth:720,lineHeight:1.45}}>
            Configura rutas por cliente, minimos facturables, recargo de combustible y compatibilidad por tipo de remolque. En Pedidos solo aparecen las rutas del cliente seleccionado.
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={filtroCliente} onChange={e=>setFiltroCliente(e.target.value)}
            style={{...S.inp,width:"auto",minWidth:160,padding:"7px 10px"}}>
            <option value="todos">Todos los clientes</option>
            {clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <input value={filtroTexto} onChange={e=>setFiltroTexto(e.target.value)} placeholder="Buscar ruta..."
            style={{...S.inp,width:150,padding:"7px 10px"}}/>
          <select value={filtroTipo} onChange={e=>setFiltroTipo(e.target.value)}
            style={{...S.inp,width:"auto",minWidth:135,padding:"7px 10px"}}>
            <option value="todos">Todos los tipos</option>
            {TIPOS_VEHICULO.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <select value={filtroTarifa} onChange={e=>setFiltroTarifa(e.target.value)}
            style={{...S.inp,width:"auto",minWidth:125,padding:"7px 10px"}}>
            <option value="todos">Todas tarifas</option>
            {TIPOS_TARIFA.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <button onClick={()=>setSoloMargenNegativo(v=>!v)}
            style={{...S.btn,background:soloMargenNegativo?"rgba(239,68,68,.12)":"var(--bg3)",color:soloMargenNegativo?"#ef4444":"var(--text3)",border:"1px solid var(--border2)",padding:"7px 10px"}}>
            Margen negativo
          </button>
          <input type="file" accept=".xlsx,.csv,.txt,.pdf" onChange={e=>setImportFile(e.target.files?.[0] || null)}
            style={{...S.inp,width:230,padding:"7px 10px"}}/>
          <button style={{...S.btn,background:"var(--bg3)",color:"var(--text3)",border:"1px solid var(--border2)",opacity:importando?.7:1}}
            onClick={importarArchivo} disabled={importando}>
            {importando ? "Importando..." : "Importar rutas"}
          </button>
          <span style={{fontSize:11,color:"var(--text4)",maxWidth:340}}>
            Excel/CSV: cabeceras Origen, Destino, Tipo, Precio, Km, Minimo o formato origen;destino;precio;km;tipo_vehiculo;tarifa_tipo;minimo;recargo. Admite 22,00 EUR y columnas de cliente/CIF.
          </span>
          {canEdit&&(
            <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={()=>abrirModal()}>
              + Nueva ruta
            </button>
          )}
        </div>
      </div>

      {loading
        ?<div style={{color:"var(--text4)",padding:40,textAlign:"center"}}>Cargando rutas...</div>
        :grouped.length===0
          ?<div style={{color:"var(--text4)",padding:40,textAlign:"center"}}>No hay rutas. Crea la primera.</div>
          :grouped.map(grupo=>{
            const cid=grupo.id;
            const isExpanded=expandedClientes[cid]!==false; // default expanded

            // Sub-group by tipo_vehiculo
            const porVehiculo={};
            grupo.rutas.forEach(r=>{
              const tv=r.tipo_vehiculo||"cualquiera";
              if(!porVehiculo[tv]) porVehiculo[tv]=[];
              porVehiculo[tv].push(r);
            });
            const tiposOrdenados=Object.keys(porVehiculo).sort((a,b)=>{
              if(a==="cualquiera") return -1;
              if(b==="cualquiera") return 1;
              return a.localeCompare(b);
            });
            const esGeneral=false;

            return(
              <div key={cid} style={{marginBottom:16}}>
                {/* Client header */}
                <div
                  onClick={()=>toggleCliente(cid)}
                  style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",
                    padding:"10px 16px",borderRadius:isExpanded?"10px 10px 0 0":"10px",
                    background:esGeneral?"var(--bg3)":"rgba(59,130,246,.08)",
                    border:esGeneral?"1px solid var(--border2)":"1px solid rgba(59,130,246,.2)",
                    borderBottom:isExpanded?"none":"undefined",
                  }}>
                  <span style={{fontWeight:800,fontSize:14,
                    color:esGeneral?"var(--text3)":"var(--accent-xl)"}}>
                    {grupo.nombre}
                  </span>
                  <span style={{fontSize:11,color:"var(--text4)",marginLeft:4}}>
                    {grupo.rutas.length} ruta{grupo.rutas.length!==1?"s":""}
                  </span>
                  <span style={{marginLeft:"auto",fontSize:11,color:"var(--text5)"}}>
                    {isExpanded?"▲":"▼"}
                  </span>
                </div>

                {isExpanded&&(
                  <div style={{border:"1px solid var(--border2)",borderTop:"none",borderRadius:"0 0 10px 10px",overflow:"hidden"}}>
                    {tiposOrdenados.map((tv,tvIdx)=>{
                      const tvKey=cid+"_"+tv;
                      const tvExpanded=expandedVehiculos[tvKey]!==false;
                      const tvLabel=TIPOS_VEHICULO.find(t=>t.v===tv)?.l||tv;
                      const tieneMultiplesVehiculos=tiposOrdenados.length>1;

                      return(
                        <div key={tv}>
                          {/* Vehicle type sub-header (only if multiple types) */}
                          {tieneMultiplesVehiculos&&(
                            <div onClick={()=>toggleVehiculo(tvKey)}
                              style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",
                                padding:"7px 16px",background:"var(--bg3)",
                                borderTop:tvIdx>0?"1px solid var(--border2)":"none"}}>
                              <span style={{fontSize:11,fontWeight:700,color:"var(--text3)",textTransform:"uppercase",letterSpacing:".06em"}}>
                                Tipo {tvLabel}
                              </span>
                              <span style={{fontSize:10,color:"var(--text5)"}}>
                                ({porVehiculo[tv].length} ruta{porVehiculo[tv].length!==1?"s":""})
                              </span>
                              <span style={{marginLeft:"auto",fontSize:10,color:"var(--text5)"}}>
                                {tvExpanded?"^":"v"}
                              </span>
                            </div>
                          )}

                          {tvExpanded&&(
                            <div style={{overflowX:"auto",maxWidth:"100%"}}>
                            <table style={{width:"100%",minWidth:980,borderCollapse:"collapse"}}>
                              <thead><tr>
                                {["Origen -> Destino","Km","Tarifa","Minimo","Combustible","EUR/km","Tipo vehiculo",""].map(h=>(
                                  <th key={h} style={S.th}>{h}</th>
                                ))}
                              </tr></thead>
                              <tbody>
                                {porVehiculo[tv].map(r=>(
                                  <tr key={r.id} style={{cursor:"pointer"}}
                                    onClick={()=>verPrecios(r)}>
                                    <td style={{...S.td,fontWeight:600}}>
                                      {r.origen} -> {r.destino}
                                    </td>
                                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace"}}>
                                      {r.km?`${r.km} km`:"—"}
                                    </td>
                                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace"}}>
                                      {fmtTarifaVista(r)}
                                    </td>
                                    <td style={S.td}>
                                      {fmtMinimoVista(r)}
                                    </td>
                                    <td style={S.td}>
                                      {Number(r.recargo_combustible_pct||0)>0 ? `+${Number(r.recargo_combustible_pct).toLocaleString("es-ES")} %` : "-"}
                                    </td>
                                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace"}}
                                      title={`Ingreso total ${fmt2(calcularMargenRuta(r).ingresoTotal)} EUR - ingreso ${fmt2(calcularMargenRuta(r).ingresoKm)} EUR/km - coste ${fmt2(calcularMargenRuta(r).costeKm)} EUR/km - margen total ${fmt2(calcularMargenRuta(r).margen)} EUR`}>
                                      {r.km ? (() => {
                                        const m = calcularMargenRuta(r);
                                        return (
                                          <div style={{display:"grid",gap:2}}>
                                            <span style={{fontSize:11,color:"var(--text4)"}}>Ing. {fmt2(m.ingresoKm)}</span>
                                            <span style={{fontSize:11,color:"var(--text5)"}}>Coste {fmt2(m.costeKm)}</span>
                                            <span style={{fontWeight:900,color:m.margenKm>=0?"var(--green)":"#ef4444"}}>Margen {fmt2(m.margenKm)}</span>
                                          </div>
                                        );
                                      })() : "-"}
                                    </td>
                                    <td style={S.td}>
                                      <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,
                                        background:"var(--bg4)",color:"var(--text3)"}}>
                                        {TIPOS_VEHICULO.find(t=>t.v===r.tipo_vehiculo)?.l||r.tipo_vehiculo||"Cualquiera"}
                                      </span>
                                    </td>
                                    <td style={S.td} onClick={e=>e.stopPropagation()}>
                                      {canEdit&&(
                                        <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap"}}>
                                          <button style={{...S.btn,background:"var(--bg3)",color:"var(--text3)",
                                            border:"1px solid var(--border2)",padding:"4px 10px",fontSize:12}}
                                            onClick={()=>abrirModal(r)}>
                                            Editar
                                          </button>
                                          <button style={{...S.btn,background:"rgba(239,68,68,.10)",color:"#ef4444",
                                            border:"1px solid rgba(239,68,68,.25)",padding:"4px 10px",fontSize:12}}
                                            onClick={()=>eliminarRuta(r)}>
                                            Desactivar
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
      }

      {/* Modal Ruta */}
      {modal&&(
        <div style={S.modal} onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div style={S.mbox}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:20}}>
              {editando?"Editar ruta":"Nueva ruta"}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={S.label}>Cliente (opcional)</label>
                <select value={form.cliente_id||""} onChange={f("cliente_id")} style={{...S.inp}}>
                  <option value="">Selecciona cliente</option>
                  {clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Tipo de vehículo</label>
                <select value={form.tipo_vehiculo||"cualquiera"} onChange={f("tipo_vehiculo")} style={S.inp}>
                  {TIPOS_VEHICULO.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Tipo de tarifa</label>
                <select value={form.tarifa_tipo||"viaje"} onChange={f("tarifa_tipo")} style={S.inp}>
                  {TIPOS_TARIFA.map(t=> <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Origen *</label>
                <input style={S.inp} value={form.origen||""} onChange={f("origen")} placeholder="MADRID"/>
              </div>
              <div>
                <label style={S.label}>Destino *</label>
                <input style={S.inp} value={form.destino||""} onChange={f("destino")} placeholder="BARCELONA"/>
              </div>
              <div>
                <label style={S.label}>Kilómetros</label>
                <input type="number" style={S.inp} value={form.km||""} onChange={f("km")} placeholder="620"/>
              </div>
              <div>
                <label style={S.label}>Peajes (€)</label>
                <input type="number" step="0.01" style={S.inp} value={form.peajes||""} onChange={f("peajes")} placeholder="0"/>
              </div>
              <div>
                <label style={S.label}>Tiempo estimado (h)</label>
                <input type="number" step="0.5" style={S.inp} value={form.tiempo_h||""} onChange={f("tiempo_h")} placeholder="6"/>
              </div>
              <div>
                <label style={S.label}>Precio base</label>
                <input type="number" step="0.01" style={S.inp} value={form.precio_base||""} onChange={f("precio_base")} placeholder="0"/>
              </div>
              <div>
                <label style={S.label}>{(form.tarifa_tipo||"viaje") === "viaje" ? "Minimo facturable (EUR)" : "Minimo de unidades"}</label>
                <input type="number" step="0.01" style={S.inp} value={(form.tarifa_tipo||"viaje") === "viaje" ? (form.minimo_facturable||"") : (form.minimo_unidades||"")} onChange={(form.tarifa_tipo||"viaje") === "viaje" ? f("minimo_facturable") : f("minimo_unidades")} placeholder="Opcional"/>
              </div>
              <div>
                <label style={S.label}>Recargo combustible (%)</label>
                <input type="number" step="0.01" style={S.inp} value={form.recargo_combustible_pct||""} onChange={f("recargo_combustible_pct")} placeholder="0"/>
              </div>
              <div>
                <label style={S.label}>% Subida sobre base</label>
                <input type="number" step="1" style={S.inp} value={form.pct_subida||""} onChange={f("pct_subida")} placeholder="0"/>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={S.label}>Notas</label>
                <input style={S.inp} value={form.notas||""} onChange={f("notas")} placeholder="Obs opcionales"/>
              </div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
              <button style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid #28344f"}}
                onClick={()=>setModal(false)}>Cancelar</button>
              <button style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:saving?.7:1}}
                onClick={guardar} disabled={saving}>
                {saving?"Guardando...":editando?"Guardar cambios":"Crear ruta"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Precios */}
      {showPrecios&&(
        <div style={S.modal} onClick={e=>e.target===e.currentTarget&&setShowPrecios(null)}>
          <div style={{...S.mbox,width:"min(1080px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700,marginBottom:4}}>
              Tarifa de ruta - {showPrecios.origen} -> {showPrecios.destino}
            </div>
            <div style={{fontSize:12,color:"var(--text4)",marginBottom:20}}>
              {showPrecios.km?`${showPrecios.km} km`:""}{showPrecios.peajes>0?` · Peajes: ${fmt2(showPrecios.peajes)} €`:""}
              {showPrecios.tipo_vehiculo&&showPrecios.tipo_vehiculo!=="cualquiera"
                ?` · ${TIPOS_VEHICULO.find(t=>t.v===showPrecios.tipo_vehiculo)?.l}`:""
              }
              {showPrecios.cliente_nombre?` · Cliente: ${showPrecios.cliente_nombre}`:""}
            </div>
            {!preciosData
              ?<div style={{color:"var(--text4)",textAlign:"center",padding:20}}>Cargando...</div>
              :<PreciosEditor ruta={showPrecios} data={preciosData} clientes={clientes} canEdit={canEdit} onClose={()=>{setShowPrecios(null);cargar();}}/>
            }
          </div>
        </div>
      )}
    </div>
  );
}

function PreciosEditor({ruta,data,clientes=[],canEdit,onClose}){
  const [precios,setPrecios]=useState(data.precios||[]);
  const [saving,setSaving]=useState(false);
  const clientesDisponibles = clientes.filter(c => !precios.some(p => String(p.cliente_id) === String(c.id)));
  function addPrecioCliente(clienteId) {
    const cliente = clientes.find(c => String(c.id) === String(clienteId));
    if (!cliente) return;
    setPrecios(prev => ([
      ...prev,
      {
        cliente_id: cliente.id,
        cliente_nombre: cliente.nombre,
        precio: ruta.precio_base || "",
        tarifa_tipo: ruta.tarifa_tipo || "viaje",
        minimo_facturable: ruta.minimo_facturable || "",
        minimo_unidades: ruta.minimo_unidades || "",
        recargo_combustible_pct: ruta.recargo_combustible_pct || "",
        iva_pct: 21,
        notas: "",
      },
    ]));
  }
  async function guardar(){
    setSaving(true);
    try{
      await editarRutaPrecios(ruta.id,{precios});
      onClose();
    }catch(e){notify(e.message, "error");}
    finally{setSaving(false);}
  }

  return(
    <div>
      {precios.length===0
        ?<div style={{color:"var(--text4)",marginBottom:16,fontSize:13}}>
          No hay reglas tarifarias especificas por cliente para esta ruta.
        </div>
        :<div style={{overflowX:"auto",maxWidth:"100%",marginBottom:16}}>
        <table style={{width:"100%",minWidth:920,borderCollapse:"collapse"}}>
          <thead><tr>
            {["Cliente","Precio (EUR)","Tipo","Minimo","Combustible","IVA","Notas",""].map(h=>(
              <th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,
                textTransform:"uppercase",color:"var(--text4)",borderBottom:"1px solid #181e2e",background:"var(--bg3)"}}>
                {h}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {precios.map((p,i)=>(
              <tr key={i}>
                <td style={{padding:"9px 12px",borderBottom:"1px solid #0f1520",fontSize:13}}>
                  {p.cliente_nombre||"—"}
                </td>
                <td style={{padding:"9px 12px",borderBottom:"1px solid #0f1520"}}>
                  <input type="number" step="0.01" value={p.precio||""}
                    onChange={e=>setPrecios(prev=>prev.map((x,j)=>j===i?{...x,precio:e.target.value}:x))}
                    disabled={!canEdit}
                    style={{background:"var(--bg4)",border:"1px solid #28344f",color:"var(--text)",
                      padding:"5px 8px",borderRadius:6,width:100,fontFamily:"'DM Sans',sans-serif",fontSize:13}}/>
                  <span style={{marginLeft:4,color:"var(--text4)",fontSize:12}}>EUR</span>
                </td>
                <td style={{padding:"9px 12px",borderBottom:"1px solid #0f1520"}}>
                  <select value={p.tarifa_tipo||"viaje"} onChange={e=>setPrecios(prev=>prev.map((x,j)=>j===i?{...x,tarifa_tipo:e.target.value}:x))} disabled={!canEdit} style={{background:"var(--bg4)",border:"1px solid #28344f",color:"var(--text)",padding:"5px 8px",borderRadius:6,width:"100%",fontFamily:"'DM Sans',sans-serif",fontSize:12}}>
                    {TIPOS_TARIFA.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                </td>
                <td style={{padding:"9px 12px",borderBottom:"1px solid #0f1520"}}>
                  <input type="number" step="0.01" value={(p.tarifa_tipo||"viaje") === "viaje" ? (p.minimo_facturable||"") : (p.minimo_unidades||"")}
                    onChange={e=>setPrecios(prev=>prev.map((x,j)=>j===i?{...x,[(x.tarifa_tipo||"viaje") === "viaje" ? "minimo_facturable" : "minimo_unidades"]:e.target.value}:x))}
                    disabled={!canEdit}
                    style={{background:"var(--bg4)",border:"1px solid #28344f",color:"var(--text)",padding:"5px 8px",borderRadius:6,width:110,fontFamily:"'DM Sans',sans-serif",fontSize:12}}/>
                </td>
                <td style={{padding:"9px 12px",borderBottom:"1px solid #0f1520"}}>
                  <input type="number" step="0.01" value={p.recargo_combustible_pct||""}
                    onChange={e=>setPrecios(prev=>prev.map((x,j)=>j===i?{...x,recargo_combustible_pct:e.target.value}:x))}
                    disabled={!canEdit}
                    style={{background:"var(--bg4)",border:"1px solid #28344f",color:"var(--text)",padding:"5px 8px",borderRadius:6,width:90,fontFamily:"'DM Sans',sans-serif",fontSize:12}}/>
                </td>
                <td style={{padding:"9px 12px",borderBottom:"1px solid #0f1520",fontSize:13,color:"var(--text3)"}}>
                  {p.iva_pct||21}%
                </td>
                <td style={{padding:"9px 12px",borderBottom:"1px solid #0f1520"}}>
                  <input value={p.notas||""}
                    onChange={e=>setPrecios(prev=>prev.map((x,j)=>j===i?{...x,notas:e.target.value}:x))}
                    disabled={!canEdit}
                    style={{background:"var(--bg4)",border:"1px solid #28344f",color:"var(--text)",
                      padding:"5px 8px",borderRadius:6,width:"100%",fontFamily:"'DM Sans',sans-serif",fontSize:12}}/>
                </td>
                <td style={{padding:"9px 12px",borderBottom:"1px solid #0f1520"}}>
                  {canEdit&&(
                    <button onClick={()=>setPrecios(prev=>prev.filter((_,j)=>j!==i))}
                      style={{background:"rgba(239,68,68,.1)",color:"#ef4444",border:"none",
                        borderRadius:6,padding:"3px 8px",fontSize:12,cursor:"pointer"}}>Quitar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      }
      {canEdit&&(
        <div style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
          <select
            value=""
            onChange={e=>addPrecioCliente(e.target.value)}
            style={{background:"var(--bg4)",border:"1px solid #28344f",color:"var(--text)",padding:"8px 10px",borderRadius:7,minWidth:220,fontFamily:"'DM Sans',sans-serif",fontSize:13}}
          >
            <option value="">+ Anadir tarifa por cliente</option>
            {clientesDisponibles.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onClose}
            style={{padding:"8px 16px",borderRadius:7,border:"1px solid #28344f",
              background:"transparent",color:"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={saving}
            style={{padding:"8px 16px",borderRadius:7,border:"none",
              background:"var(--accent)",color:"#fff",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",
              fontSize:13,fontWeight:600,opacity:saving?.7:1}}>
            {saving?"Guardando...":"Guardar tarifas"}
          </button>
          </div>
        </div>
      )}
    </div>
  );
}
