import { useState, useEffect } from "react";
import { crearPedidoChofer, getChoferClientes, getChoferClientePuntosCarga, getChoferClientePuntosDescarga, crearChoferClientePuntoCarga, getChoferClienteRutas, crearChoferRuta } from "../../services/api";


import { notify } from "../../services/notify";



import { DriverHeading } from "./DriverUI";

import { direccionCompletaPuntoChofer, puntoCargaToPedidoStop } from "./driverSupport";
function NuevoViajeChofer({ onCreado, jornadaAbierta, onAbrirJornada }) {
  const [step,setStep]=useState(0);
  const [puntosDescarga,setPuntosDescarga]=useState([]);
  useEffect(()=>{const back=e=>{if(step>0){e.preventDefault();setStep(step-1);}};window.addEventListener("tms:driver-back",back);return()=>window.removeEventListener("tms:driver-back",back);},[step]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    cliente_id: "",
    cliente_nombre: "",
    ruta_id: "",
    origen: "",
    destino: "",
    fecha_carga: today,
    hora_carga: "",
    fecha_descarga: today,
    hora_descarga: "",
    mercancia: "",
    peso_kg: "",
    bultos: "",
    referencia_cliente: "",
    notas: "",
    puntos_carga: [], puntos_descarga: [],
  });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [rutas, setRutas] = useState([]);
  const [puntosCarga, setPuntosCarga] = useState([]);
  const [loadingRutas, setLoadingRutas] = useState(false);
  const [loadingPuntos, setLoadingPuntos] = useState(false);
  const [creatingRuta, setCreatingRuta] = useState(false);
  const [creatingPunto, setCreatingPunto] = useState(false);
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const inputStyle = {width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",borderRadius:8,padding:"10px 11px",fontSize:14,fontFamily:"'DM Sans',sans-serif",outline:"none"};

  useEffect(() => {
    const q = form.cliente_nombre.trim();
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const data = await getChoferClientes(q);
        if(alive) setClientes(Array.isArray(data) ? data : []);
      } catch {
        if(alive) setClientes([]);
      }
    }, 260);
    return () => { alive=false; clearTimeout(timer); };
  }, [form.cliente_nombre]);

  useEffect(() => {
    if (!form.cliente_id) {
      setRutas([]);
      setPuntosCarga([]);
      setPuntosDescarga([]);
      return;
    }
    let alive=true;
    setLoadingRutas(true);
    getChoferClienteRutas(form.cliente_id)
      .then(data => {if(alive)setRutas(Array.isArray(data) ? data : []);})
      .catch(() => {if(alive)setRutas([]);})
      .finally(() => {if(alive)setLoadingRutas(false);});
    setLoadingPuntos(true);
    getChoferClientePuntosDescarga(form.cliente_id).then(data=>{if(alive)setPuntosDescarga(Array.isArray(data)?data:[]);}).catch(()=>{if(alive)setPuntosDescarga([]);});
    getChoferClientePuntosCarga(form.cliente_id)
      .then(data => {
        const lista = Array.isArray(data) ? data : [];
        if(alive)setPuntosCarga(lista);

      })
      .catch(() => {if(alive)setPuntosCarga([]);})
      .finally(() => {if(alive)setLoadingPuntos(false);});
    return ()=>{alive=false;};
  }, [form.cliente_id]);

  function cambiarClienteNombre(value) {
    setForm(prev => ({
      ...prev,
      cliente_nombre: value,
      cliente_id: value.trim() === prev.cliente_nombre.trim() ? prev.cliente_id : "",
      ruta_id: "", origen:"", destino:"",
      puntos_carga: [],
      puntos_descarga: [],
    }));
  }

  function seleccionarCliente(cliente) {
    setForm(prev => ({
      ...prev,
      cliente_id: cliente.id,
      cliente_nombre: cliente.nombre || prev.cliente_nombre,
      ruta_id: "", origen:"", destino:"",
      puntos_carga: [],
      puntos_descarga: [],
    }));
  }

  function seleccionarPuntoCarga(punto) {
    setForm(prev => {
      const stop = puntoCargaToPedidoStop(punto, prev.fecha_carga, prev.hora_carga);
      return {
        ...prev,
        origen: punto.nombre || punto.direccion || prev.origen,
        puntos_carga: [stop],
      };
    });
    if (punto?.pendiente_revision || punto?.metadata?.pending_review) {
      notify("Punto de carga pendiente de revisión por tráfico.", "warning");
    }
  }

  function seleccionarRuta(rutaId) {
    const ruta = rutas.find(r => String(r.id) === String(rutaId));
    setForm(prev => ({
      ...prev,
      ruta_id: rutaId,
      origen: ruta?.origen || prev.origen,
      destino: ruta?.destino || prev.destino,
    }));
  }

  async function crearRutaPendiente() {
    if (!form.cliente_id || !form.origen.trim() || !form.destino.trim()) {
      notify("Selecciona cliente e indica origen y destino para crear la ruta.", "warning");
      return;
    }
    setCreatingRuta(true);
    try {
      const ruta = await crearChoferRuta({
        cliente_id: form.cliente_id,
        origen: form.origen,
        destino: form.destino,
        notas: "Propuesta desde nuevo viaje DCD.",
      });
      notify("Ruta creada y enviada a tráfico para revisar tarifa.", "success");
      const fresh = await getChoferClienteRutas(form.cliente_id).catch(() => []);
      setRutas(Array.isArray(fresh) ? fresh : []);
      setForm(prev => ({ ...prev, ruta_id: ruta?.ruta_id || prev.ruta_id }));
    } catch (err) {
      notify(err.message || "No se pudo crear la ruta", "error");
    } finally {
      setCreatingRuta(false);
    }
  }

  async function crearPuntoCargaPendiente() {
    if (!form.cliente_id) {
      notify("Selecciona primero un cliente.", "warning");
      return;
    }
    const direccion = String(form.origen || "").trim();
    if (!direccion) {
      notify("Indica el punto de carga antes de guardarlo.", "warning");
      return;
    }
    setCreatingPunto(true);
    try {
      const result = await crearChoferClientePuntoCarga(form.cliente_id, {
        nombre: direccion,
        direccion,
        ventana: form.hora_carga ? `Hora indicada por chofer: ${form.hora_carga}` : "",
        notas: "Alta rapida desde nuevo viaje del chófer.",
      });
      const punto = result?.punto || result;
      const fresh = await getChoferClientePuntosCarga(form.cliente_id).catch(() => []);
      setPuntosCarga(Array.isArray(fresh) ? fresh : []);
      if (punto?.id) seleccionarPuntoCarga(punto);
      notify("Punto de carga creado y enviado a tráfico para revisar.", "success");
    } catch (err) {
      notify(err.message || "No se pudo crear el punto de carga", "error");
    } finally {
      setCreatingPunto(false);
    }
  }

  async function guardar() {
    if (!form.cliente_nombre.trim() || !form.origen.trim() || !form.destino.trim() || !form.mercancia.trim()) {
      notify("Completa cliente, origen, destino y mercancía.", "warning");
      return;
    }
    if(!jornadaAbierta){notify("Abre tu jornada antes de crear el viaje.","warning");onAbrirJornada?.();return;}
    setSaving(true);
    try {
      const res = await crearPedidoChofer({...form,
        puntos_carga:form.puntos_carga.map(p=>({...p,fecha:form.fecha_carga,hora:form.hora_carga})),
        puntos_descarga:(form.puntos_descarga||[]).map(p=>({...p,fecha:form.fecha_descarga,hora:form.hora_descarga})),
      });
      setCreated(res);
      notify("Viaje creado con DCD y QR.", "success");
      setForm(prev => ({
        ...prev,
        ruta_id: "",
        cliente_nombre: "",
        cliente_id: "",
        origen: "",
        destino: "",
        mercancia: "",
        peso_kg: "",
        bultos: "",
        referencia_cliente: "",
        notas: "",
        puntos_carga: [],
        puntos_descarga: [],
      }));
      setPuntosCarga([]);setPuntosDescarga([]);setStep(0);
      onCreado?.();
    } catch (err) {
      notify(err.message || "No se pudo crear el viaje", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tg-chofer-section-shell" style={{padding:"12px 16px"}}>
      <div className="tg-chofer-card" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
        <DriverHeading icon="nuevo" title="Nuevo viaje DCD"/>
        <div style={{fontSize:14,color:"var(--text5)",lineHeight:1.4,marginBottom:12}}>Crea un viaje propio para disponer del documento de control digital y su QR.</div>
        <ol className="driver-wizard-steps" aria-label="Pasos del nuevo viaje">{["Datos básicos","Carga y horarios","Revisión"].map((label,i)=><li key={label} aria-current={step===i?"step":undefined}><span>{i+1}</span>{label}</li>)}</ol>
        {!jornadaAbierta && <p className="driver-workday-required" role="status">Para crear el viaje necesitas abrir tu jornada. <button onClick={onAbrirJornada}>Abrir jornada</button></p>}
        <div className="driver-wizard-body" style={{display:"grid",gap:10}}>
        <fieldset hidden={step!==0} className="driver-wizard-fields"><legend>Cliente y puntos del viaje</legend>
          <label className="driver-field"><span>Cliente o destinatario</span><input aria-label="Cliente / destinatario" value={form.cliente_nombre} onChange={e=>cambiarClienteNombre(e.target.value)} placeholder="Cliente / destinatario" style={inputStyle}/></label>
          {clientes.length > 0 && (
            <div style={{display:"grid",gap:6}}>
              <div style={{fontSize:12,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>
                {form.cliente_nombre.trim() ? "Coincidencias" : "Clientes de tu empresa"}
              </div>
              {clientes.slice(0, form.cliente_nombre.trim() ? 8 : 5).map(cliente => (
                <button key={cliente.id} type="button" onClick={()=>seleccionarCliente(cliente)}
                  style={{textAlign:"left",padding:"8px 10px",borderRadius:8,border:`1px solid ${form.cliente_id===cliente.id ? "var(--accent-a45)" : "var(--border2)"}`,background:form.cliente_id===cliente.id ? "var(--accent-a10)" : "var(--bg3)",color:"var(--text)",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  {cliente.nombre}
                  {cliente.cif ? <span style={{fontWeight:600,color:"var(--text5)"}}> · {cliente.cif}</span> : null}
                </button>
              ))}
            </div>
          )}
          {form.cliente_id && (
            <div style={{display:"grid",gap:6}}>
              <select value={form.ruta_id || ""} onChange={e=>seleccionarRuta(e.target.value)} style={inputStyle}>
                <option value="">{loadingRutas ? "Cargando rutas..." : "Sin ruta / crear manual"}</option>
                {rutas.map(r => (
                  <option key={r.id} value={r.id}>{r.origen} -> {r.destino}</option>
                ))}
              </select>
            </div>
          )}
          <label className="driver-field"><span>Origen / punto de carga</span><input aria-label="Origen / punto de carga" value={form.origen} onChange={e=>setForm(prev=>({...prev,origen:e.target.value,puntos_carga:[]}))} placeholder="Origen / punto de carga" style={inputStyle}/></label>
          {form.cliente_id && (
            <div style={{display:"grid",gap:7,background:"var(--accent-a06)",border:"1px solid var(--accent-a18)",borderRadius:8,padding:9}}>
              <div style={{fontSize:14,color:"var(--text4)",fontWeight:800}}>
                {loadingPuntos ? "Cargando puntos de carga..." : puntosCarga.length ? "Puntos de carga del cliente" : "Este cliente no tiene puntos de carga guardados."}
              </div>
              {puntosCarga.slice(0, 6).map(punto => (
                <button key={punto.id} type="button" onClick={()=>seleccionarPuntoCarga(punto)}
                  style={{textAlign:"left",padding:"8px 9px",borderRadius:8,border:`1px solid ${String(form.puntos_carga?.[0]?.punto_interes_id || "") === String(punto.id) ? "var(--accent-a45)" : "var(--accent-a18)"}`,background:String(form.puntos_carga?.[0]?.punto_interes_id || "") === String(punto.id) ? "var(--accent-a12)" : "var(--bg3)",color:"var(--text)",fontSize:14,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  {punto.nombre || punto.direccion}
                  <span style={{display:"block",fontSize:12,fontWeight:700,color:"var(--text5)",marginTop:2}}>{direccionCompletaPuntoChofer(punto) || punto.direccion}</span>
                  {punto.pendiente_revision ? <span style={{display:"inline-block",fontSize:12,fontWeight:900,color:"#f59e0b",marginTop:4}}>Pendiente de revisión tráfico</span> : null}
                </button>
              ))}
              {form.origen.trim() && (
                <button type="button" onClick={crearPuntoCargaPendiente} disabled={creatingPunto}
                  style={{padding:"10px",borderRadius:8,border:"1px solid var(--accent-a30)",background:"var(--accent-a10)",color:"var(--accent-l)",fontSize:14,fontWeight:900,cursor:creatingPunto?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  {creatingPunto ? "Creando punto..." : "Crear punto de carga para revisar"}
                </button>
              )}
            </div>
          )}
          {puntosDescarga.length>0 && <label className="driver-field"><span>Puntos de descarga del cliente</span><select aria-label="Punto de descarga guardado" value={form.puntos_descarga?.[0]?.punto_interes_id || ""} onChange={e=>{const punto=puntosDescarga.find(p=>String(p.id)===e.target.value);if(punto)setForm(prev=>({...prev,destino:punto.nombre||punto.direccion,puntos_descarga:[{...puntoCargaToPedidoStop(punto,prev.fecha_descarga,prev.hora_descarga),tipo:"descarga"}]}));else setForm(prev=>({...prev,destino:"",puntos_descarga:[]}));}}><option value="">Selecciona un punto</option>{puntosDescarga.map(p=><option key={p.id} value={p.id}>{p.nombre} · {p.ciudad||p.direccion}</option>)}</select></label>}
          <label className="driver-field"><span>Destino / punto de descarga</span><input aria-label="Destino / punto de descarga" value={form.destino} onChange={e=>setForm(prev=>({...prev,destino:e.target.value,puntos_descarga:[]}))} placeholder="Destino / punto de descarga" style={inputStyle}/></label>
          {form.cliente_id && form.origen.trim() && form.destino.trim() && !form.ruta_id && (
            <button type="button" onClick={crearRutaPendiente} disabled={creatingRuta}
              style={{padding:"10px",borderRadius:8,border:"1px solid rgba(59,130,246,.3)",background:"rgba(59,130,246,.08)",color:"#60a5fa",fontSize:14,fontWeight:900,cursor:creatingRuta?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              {creatingRuta ? "Creando ruta..." : "Crear ruta para revisar"}
            </button>
          )}
          </fieldset><fieldset hidden={step!==1} className="driver-wizard-fields"><legend>Carga y horarios</legend>
          <div className="tg-chofer-nuevo-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <label className="driver-field"><span>Fecha de carga</span><input type="date" value={form.fecha_carga} onChange={e=>set("fecha_carga", e.target.value)} style={inputStyle}/></label>
            <label className="driver-field"><span>Hora de carga</span><input type="time" value={form.hora_carga} onChange={e=>set("hora_carga", e.target.value)} style={inputStyle}/></label>
          </div>
          <div className="tg-chofer-nuevo-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <label className="driver-field"><span>Fecha de descarga</span><input type="date" value={form.fecha_descarga} onChange={e=>set("fecha_descarga", e.target.value)} style={inputStyle}/></label>
            <label className="driver-field"><span>Hora de descarga</span><input type="time" value={form.hora_descarga} onChange={e=>set("hora_descarga", e.target.value)} style={inputStyle}/></label>
          </div>
          <label className="driver-field"><span>Mercancía</span><input aria-label="Mercancía" value={form.mercancia} onChange={e=>set("mercancia", e.target.value)} placeholder="Mercancía" style={inputStyle}/></label>
          <div className="tg-chofer-nuevo-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <label className="driver-field"><span>Peso (kg)</span><input aria-label="Peso kg" inputMode="decimal" value={form.peso_kg} onChange={e=>set("peso_kg", e.target.value)} placeholder="Peso kg" style={inputStyle}/></label>
            <label className="driver-field"><span>Bultos</span><input aria-label="Bultos" inputMode="numeric" value={form.bultos} onChange={e=>set("bultos", e.target.value)} placeholder="Bultos" style={inputStyle}/></label>
          </div>
          <label className="driver-field"><span>Referencia del cliente</span><input aria-label="Referencia cliente" value={form.referencia_cliente} onChange={e=>set("referencia_cliente", e.target.value)} placeholder="Referencia cliente" style={inputStyle}/></label>
          <label className="driver-field"><span>Notas del viaje</span><textarea aria-label="Notas" value={form.notas} onChange={e=>set("notas", e.target.value)} placeholder="Notas" rows={3} style={{...inputStyle,resize:"none"}}/></label>
        </fieldset>
        {step===2 && <section className="driver-review"><h3>Revisa el viaje</h3><dl>{[["Cliente",form.cliente_nombre],["Origen",form.origen],["Destino",form.destino],["Carga",[form.fecha_carga,form.hora_carga].filter(Boolean).join(" · ")],["Descarga",[form.fecha_descarga,form.hora_descarga].filter(Boolean).join(" · ")],["Mercancía",form.mercancia],["Peso (kg)",form.peso_kg],["Bultos",form.bultos],["Referencia",form.referencia_cliente],["Notas",form.notas]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||"—"}</dd></div>)}</dl></section>}
        <div className="driver-wizard-actions">{step>0 && <button type="button" onClick={()=>setStep(step-1)} disabled={saving}>Anterior</button>}{step<2 && <button type="button" className="driver-primary" onClick={()=>{if(step===0&&(!form.cliente_id||!form.origen.trim()||!form.destino.trim())){notify("Selecciona un cliente e indica origen y destino.","warning");return;}if(step===1&&(!form.mercancia.trim()||!form.fecha_carga||!form.fecha_descarga||form.fecha_descarga<form.fecha_carga)){notify("Completa mercancía y fechas válidas.","warning");return;}setStep(step+1);}}>Siguiente: {step===0?"Carga y horarios":"Revisión"}</button>}</div>
          <button hidden={step!==2} onClick={guardar} disabled={saving||!jornadaAbierta} style={{padding:"13px",borderRadius:8,border:"none",background:"var(--accent)",color:"#fff",fontSize:14,fontWeight:900,cursor:saving?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            {saving ? "Creando..." : "Crear viaje y DCD"}
          </button>
        </div>
        {created?.documento_control?.qr?.data_url && (
          <div style={{marginTop:14,background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.22)",borderRadius:10,padding:12,textAlign:"center"}}>
            <div style={{fontSize:14,fontWeight:900,color:"#10b981",marginBottom:8}}>QR generado</div>
            <img src={created.documento_control.qr.data_url} alt="QR DCD creado" style={{width:190,height:190,objectFit:"contain",background:"#fff",borderRadius:8,padding:8}}/>
            <div style={{fontSize:14,color:"var(--text5)",marginTop:8}}>El viaje aparece ya en Activos.</div>
          </div>
        )}
      </div>
    </div>
  );
}


export { NuevoViajeChofer };
