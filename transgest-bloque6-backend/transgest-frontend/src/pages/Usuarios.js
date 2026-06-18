import { useEffect, useState } from "react";
import { getUsuarios, crearUsuario, editarUsuario, resetPassword, getChoferes, getVehiculos } from "../services/api";
import { notify, promptDialog } from "../services/notify";
import { FormField, ModalShell, StatusBadge } from "../components/ui";

const ROLES = [
  "gerente",
  "contable",
  "trafico",
  "administrativo",
  "responsable_taller",
  "visualizador",
  "chofer",
  "cliente",
];

const LABEL = {
  gerente: "Gerente",
  contable: "Contable",
  trafico: "Tráfico",
  administrativo: "Administrativo",
  responsable_taller: "Resp. Taller",
  visualizador: "Visualizador",
  chofer: "Chófer",
  cliente: "Cliente",
};

const RC = {
  gerente:"#3b6ef5",
  contable:"var(--green)",
  trafico:"#fb8c3a",
  administrativo:"#60a5fa",
  responsable_taller:"#eab308",
  visualizador:"var(--text2)",
  chofer:"#a78bfa",
  cliente:"#14b8a6",
};

const MODULOS_PERM = [
  ["agenda", "Agenda"],
  ["dashboard", "Dashboard"],
  ["control_tower", "Control Tower"],
  ["pedidos", "Pedidos"],
  ["plan_diario", "Plan diario"],
  ["solicitudes", "Solicitudes clientes"],
  ["gestion_trafico", "Cuadrante tráfico"],
  ["calculador_portes", "Calculador de portes"],
  ["clientes", "Clientes"],
  ["rutas", "Rutas"],
  ["grupajes", "Grupajes"],
  ["palets", "Almacén / palets"],
  ["colaboradores", "Colaboradores"],
  ["vehiculos", "Vehículos"],
  ["choferes", "Chóferes"],
  ["taller", "Taller"],
  ["hojas_ruta", "Hojas de ruta"],
  ["facturacion", "Facturación"],
  ["contabilidad", "Contabilidad"],
  ["nominas", "Nóminas"],
  ["control_horario", "Control horario"],
  ["informes", "Informes KPI"],
  ["excepciones", "Excepciones operativas"],
  ["documentos", "Documentos"],
  ["avisos", "Avisos"],
  ["empresa", "Mi empresa"],
  ["usuarios", "Usuarios y roles"],
  ["actividad", "Registro de actividad"],
  ["importacion", "Importación"],
  ["portal_cliente", "Portal cliente"],
  ["app_chofer", "App chófer"],
  ["rutas_recomendadas_chofer", "Ruta recomendada chófer"],
  ["ia", "Asistente IA"],
  ["mi_cuenta", "Mi cuenta"],
].map(([id, label]) => ({ id, label }));

const ALL_MODULE_IDS = MODULOS_PERM.map(m => m.id);

const ROLE_PRESETS = {
  gerente: { ver: ALL_MODULE_IDS, editar: ALL_MODULE_IDS },
  contable: {
    ver: ["agenda","dashboard","pedidos","clientes","rutas","vehiculos","choferes","facturacion","contabilidad","nominas","control_horario","informes","documentos","avisos","empresa","mi_cuenta"],
    editar: ["agenda","clientes","facturacion","contabilidad","nominas","control_horario","documentos","avisos","mi_cuenta"],
  },
  trafico: {
    ver: ["agenda","dashboard","control_tower","pedidos","plan_diario","solicitudes","gestion_trafico","calculador_portes","clientes","rutas","grupajes","palets","colaboradores","vehiculos","choferes","taller","hojas_ruta","control_horario","documentos","avisos","mi_cuenta"],
    editar: ["agenda","control_tower","pedidos","plan_diario","solicitudes","gestion_trafico","clientes","rutas","grupajes","palets","colaboradores","vehiculos","choferes","hojas_ruta","control_horario","documentos","avisos","mi_cuenta"],
  },
  administrativo: {
    ver: ["agenda","dashboard","pedidos","plan_diario","solicitudes","clientes","rutas","vehiculos","choferes","palets","facturacion","contabilidad","nominas","control_horario","informes","documentos","avisos","empresa","mi_cuenta"],
    editar: ["agenda","pedidos","plan_diario","solicitudes","clientes","palets","facturacion","control_horario","documentos","avisos","mi_cuenta"],
  },
  responsable_taller: {
    ver: ["agenda","dashboard","vehiculos","choferes","taller","documentos","avisos","mi_cuenta"],
    editar: ["agenda","vehiculos","taller","documentos","avisos","mi_cuenta"],
  },
  visualizador: {
    ver: ["agenda","dashboard","control_tower","pedidos","plan_diario","gestion_trafico","clientes","rutas","vehiculos","choferes","hojas_ruta","informes","documentos","avisos","mi_cuenta"],
    editar: ["mi_cuenta"],
  },
  chofer: { ver: ["app_chofer","rutas_recomendadas_chofer","mi_cuenta"], editar: ["app_chofer","mi_cuenta"] },
  cliente: { ver: ["portal_cliente","mi_cuenta"], editar: ["portal_cliente","mi_cuenta"] },
};

function permisosDesdeListas(ver = [], editar = []) {
  const v = new Set(ver);
  const e = new Set(editar);
  return {
    modulos: Object.fromEntries(MODULOS_PERM.map(m => [
      m.id,
      { ver: v.has(m.id), editar: e.has(m.id) },
    ])),
  };
}

function presetRol(rol) {
  const preset = ROLE_PRESETS[rol] || ROLE_PRESETS.visualizador;
  return permisosDesdeListas(preset.ver, preset.editar);
}

function normalizarPermisosUI(permisos, rol) {
  let parsed = {};
  if (typeof permisos === "string") {
    try { parsed = JSON.parse(permisos || "{}"); } catch { parsed = {}; }
  } else if (permisos && typeof permisos === "object" && !Array.isArray(permisos)) {
    parsed = permisos;
  }
  const base = presetRol(rol);
  const modulos = parsed.modulos && typeof parsed.modulos === "object" ? parsed.modulos : parsed;
  for (const m of MODULOS_PERM) {
    const actual = modulos[m.id] || {};
    if (typeof actual === "object") {
      base.modulos[m.id] = {
        ver: Boolean(actual.ver),
        editar: Boolean(actual.editar),
      };
    }
  }
  return base;
}

function normalizarTraficoConfigUI(config) {
  const raw = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const vehiculo_ids = Array.isArray(raw.vehiculo_ids) ? raw.vehiculo_ids.map(String).filter(Boolean) : [];
  const tipos = Array.isArray(raw.tipos_viaje) ? raw.tipos_viaje.map(v => String(v).toLowerCase()).filter(Boolean) : [];
  return {
    vehiculo_ids: [...new Set(vehiculo_ids)],
    tipos_viaje: tipos.length ? [...new Set(tipos)] : ["normal", "salida", "retorno"],
  };
}

function traficoScopeLabel(config, vehiculos = []) {
  const cfg = normalizarTraficoConfigUI(config);
  const tipos = cfg.tipos_viaje.map(t => t === "salida" ? "salidas" : t === "retorno" ? "retornos" : "sin clasificar");
  const vehTxt = cfg.vehiculo_ids.length
    ? `${cfg.vehiculo_ids.length} matricula${cfg.vehiculo_ids.length !== 1 ? "s" : ""}`
    : "todas las matriculas";
  const primeras = cfg.vehiculo_ids.slice(0, 3).map(id => vehiculos.find(v => String(v.id) === String(id))?.matricula).filter(Boolean);
  return `${vehTxt}${primeras.length ? ` (${primeras.join(", ")}${cfg.vehiculo_ids.length > 3 ? "..." : ""})` : ""} · ${tipos.join(", ")}`;
}

const S = {
  page:{flex:1,padding:"24px 28px"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,marginBottom:16,color:"var(--text)"},
  btn:{padding:"8px 16px",borderRadius:7,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
  input:{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"8px 12px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
  sel:{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"8px 12px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  mbox:{background:"var(--card-bg, var(--bg2))",border:"1px solid var(--border2)",borderRadius:8,padding:28,width:"min(520px,96vw)",maxHeight:"90vh",overflowY:"auto"},
  label:{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text4)",marginBottom:5,marginTop:12},
  card:{background:"var(--card-bg, var(--bg2))",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"},
  th:{textAlign:"left",padding:"9px 14px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text4)",borderBottom:"1px solid var(--border)",background:"var(--bg3)"},
  td:{padding:"10px 14px",borderBottom:"1px solid var(--border)",fontSize:13,color:"var(--text)"},
};

export default function Usuarios() {
  const [usuarios,setUsuarios]=useState([]);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(false);
  const [editando,setEditando]=useState(null);
  const [form,setForm]=useState({});
  const [choferes,setChoferes]=useState([]);
  const [vehiculos,setVehiculos]=useState([]);
  const [errors,setErrors]=useState({});
  const [saving,setSaving]=useState(false);

  const cargar=async()=>{setLoading(true);try{const [d,c,v]=await Promise.all([getUsuarios(), getChoferes().catch(()=>[]), getVehiculos().catch(()=>[])]);setUsuarios(Array.isArray(d)?d:[]);setChoferes(Array.isArray(c)?c:[]);setVehiculos(Array.isArray(v)?v:[]);}catch(e){}finally{setLoading(false);}};
  useEffect(()=>{cargar();},[]);
  const f=k=>e=>{
    const value = e.target.value;
    setForm(p=>({...p,[k]:value}));
    setErrors(prev => prev[k] ? { ...prev, [k]: "" } : prev);
  };
  const cambiarRol = e => {
    const rol = e.target.value;
    setForm(p => ({
      ...p,
      rol,
      permisos: presetRol(rol),
      cliente_id: rol === "cliente" ? p.cliente_id : null,
      chofer_id: rol === "chofer" ? p.chofer_id : null,
      trafico_config: normalizarTraficoConfigUI(p.trafico_config),
    }));
    setErrors(prev => prev.rol ? { ...prev, rol: "" } : prev);
  };

  function abrirNuevo() {
    setEditando(null);
    setForm({rol:"trafico",activo:true,permisos:presetRol("trafico"),trafico_config:{ vehiculo_ids: [], tipos_viaje: ["normal","salida","retorno"] }});
    setErrors({});
    setModal(true);
  }

  function abrirEditar(u) {
    setEditando(u);
    setForm({...u, permisos: normalizarPermisosUI(u.permisos, u.rol), trafico_config: normalizarTraficoConfigUI(u.trafico_config)});
    setErrors({});
    setModal(true);
  }

  function permisosJson() {
    if (!form.permisos) return presetRol(form.rol);
    if (typeof form.permisos !== "string") return normalizarPermisosUI(form.permisos, form.rol);
    try { return normalizarPermisosUI(JSON.parse(form.permisos), form.rol); }
    catch { throw new Error("Los permisos deben ser JSON valido"); }
  }

  function togglePermiso(modulo, tipo) {
    setForm(p => {
      const permisos = normalizarPermisosUI(p.permisos, p.rol);
      const actual = permisos.modulos[modulo] || { ver:false, editar:false };
      const next = { ...actual, [tipo]: !actual[tipo] };
      if (tipo === "editar" && next.editar) next.ver = true;
      if (tipo === "ver" && !next.ver) next.editar = false;
      return {
        ...p,
        permisos: {
          ...permisos,
          modulos: {
            ...permisos.modulos,
            [modulo]: next,
          },
        },
      };
    });
  }

  function toggleTipoViaje(tipo) {
    setForm(p => {
      const cfg = normalizarTraficoConfigUI(p.trafico_config);
      const set = new Set(cfg.tipos_viaje);
      if (set.has(tipo)) set.delete(tipo); else set.add(tipo);
      const next = [...set];
      return { ...p, trafico_config: { ...cfg, tipos_viaje: next.length ? next : [tipo] } };
    });
  }

  function toggleVehiculoScope(id) {
    setForm(p => {
      const cfg = normalizarTraficoConfigUI(p.trafico_config);
      const set = new Set(cfg.vehiculo_ids);
      if (set.has(String(id))) set.delete(String(id)); else set.add(String(id));
      return { ...p, trafico_config: { ...cfg, vehiculo_ids: [...set] } };
    });
  }

  async function guardar(){
    const nextErrors = {};
    if(!String(form.nombre||"").trim()) nextErrors.nombre = "Indica el nombre del usuario.";
    if(!String(form.username||"").trim()) nextErrors.username = "Indica un usuario de acceso.";
    if(!form.rol) nextErrors.rol = "Selecciona un rol.";
    if(form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.email))) nextErrors.email = "Email no valido.";
    if(!editando && !form.password) nextErrors.password = "Indica una contrasena temporal.";
    if(!editando && form.password && String(form.password).length < 8) nextErrors.password = "Minimo 8 caracteres.";
    if(form.rol === "chofer" && !form.chofer_id) nextErrors.chofer_id = "Vincula esta cuenta a una ficha de chofer.";
    if(Object.keys(nextErrors).length){
      setErrors(nextErrors);
      notify("Revisa los campos marcados", "warning");
      return;
    }
    setSaving(true);
    try{
      const body = {
        nombre: form.nombre,
        username: form.username,
        email: form.email || null,
        rol: form.rol,
        perfil: form.perfil || null,
        permisos: permisosJson(),
        trafico_config: normalizarTraficoConfigUI(form.trafico_config),
        activo: form.activo !== false,
        chofer_id: form.rol === "chofer" ? (form.chofer_id || null) : null,
      };
      if(!editando) body.password = form.password;
      if(editando) await editarUsuario(editando.id, body);
      else await crearUsuario(body);
      setModal(false);
      cargar();
    }catch(e){notify(e.message, "error");}finally{setSaving(false);}
  }

  async function resetPw(u){
    const pw=await promptDialog({
      title: "Nueva contrasena temporal",
      message: `Usuario: ${u.nombre}\nMinimo 8 caracteres.`,
      inputType: "password",
      placeholder: "Contraseña temporal",
      confirmText: "Actualizar",
    });
    if(!pw||pw.length<8){notify("Contraseña demasiado corta", "warning");return;}
    try{await resetPassword(u.id,pw);notify("Contraseña actualizada", "success");}catch(e){notify(e.message, "error");}
  }

  return (
    <div style={S.page}>
      <div style={S.title}>Usuarios y roles</div>
      <div style={{marginBottom:16}}>
        <button style={{...S.btn,background:"#3b6ef5",color:"#fff"}} onClick={abrirNuevo}>+ Nuevo usuario</button>
      </div>
      <div style={S.card}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>{["Nombre","Usuario","Email","Rol","Vinculo","Alcance trafico","Estado","Ultimo acceso","Acciones"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading?<tr><td colSpan={9} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Cargando...</td></tr>
            :usuarios.length===0?<tr><td colSpan={9} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Sin usuarios.</td></tr>
            :usuarios.map(u=>(
              <tr key={u.id}>
                <td style={{...S.td,fontWeight:600}}>{u.nombre}</td>
                <td style={{...S.td,fontSize:12,color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace"}}>{u.username || "-"}</td>
                <td style={{...S.td,fontSize:12,color:"var(--text2)"}}>{u.email || "-"}</td>
                <td style={S.td}><span style={{display:"inline-flex",padding:"2px 9px",borderRadius:8,fontSize:11,fontWeight:700,background:`${RC[u.rol]||"var(--text2)"}1a`,color:RC[u.rol]||"var(--text2)"}}>{LABEL[u.rol]||u.rol}</span></td>
                <td style={{...S.td,fontSize:12,color:"var(--text3)"}}>
                  {u.rol === "chofer"
                    ? (u.chofer_nombre ? `${u.chofer_nombre} ${u.chofer_apellidos || ""}`.trim() + (u.vehiculo_matricula ? ` - ${u.vehiculo_matricula}` : "") : <span style={{color:"#f59e0b"}}>Sin chofer vinculado</span>)
                    : "-"}
                </td>
                <td style={{...S.td,fontSize:11,color:"var(--text3)",maxWidth:260}}>
                  {u.rol === "trafico" ? traficoScopeLabel(u.trafico_config, vehiculos) : "-"}
                </td>
                <td style={S.td}><StatusBadge tone={u.activo?"success":"danger"}>{u.activo?"Activo":"Inactivo"}</StatusBadge></td>
                <td style={{...S.td,fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>{u.ultimo_acceso?new Date(u.ultimo_acceso).toLocaleDateString("es-ES"):"-"}</td>
                <td style={S.td}>
                  <div style={{display:"flex",gap:6}}>
                    <button style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",padding:"4px 10px",fontSize:11}} onClick={()=>abrirEditar(u)}>Editar</button>
                    <button style={{...S.btn,background:"rgba(251,191,36,.1)",color:"#fbbf24",padding:"4px 10px",fontSize:11}} onClick={()=>resetPw(u)}>Reset pw</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal&&(
        <ModalShell
          title={editando?"Editar usuario":"Nuevo usuario"}
          onClose={()=>setModal(false)}
          width={560}
          footer={<>
            <button style={{...S.btn,background:"transparent",color:"var(--text2)",border:"1px solid var(--border2)"}} onClick={()=>setModal(false)}>Cancelar</button>
            <button style={{...S.btn,background:"#3b6ef5",color:"#fff"}} onClick={guardar} disabled={saving}>{saving?"Guardando...":editando?"Guardar":"Crear usuario"}</button>
          </>}
        >
            <FormField label="Nombre" required error={errors.nombre}>
              <input style={{...S.input,borderColor:errors.nombre?"#ef4444":"var(--border2)"}} value={form.nombre||""} onChange={f("nombre")}/>
            </FormField>
            <FormField label="Usuario" required error={errors.username}>
              <input style={{...S.input,borderColor:errors.username?"#ef4444":"var(--border2)"}} value={form.username||""} onChange={f("username")} placeholder="nombre.usuario"/>
            </FormField>
            <FormField label="Email" error={errors.email} hint="Opcional. Se usara para invitaciones y recuperacion si esta informado.">
              <input style={{...S.input,borderColor:errors.email?"#ef4444":"var(--border2)"}} type="email" value={form.email||""} onChange={f("email")} placeholder="correo@empresa.com"/>
            </FormField>
            {!editando&&<>
              <FormField label="Contraseña temporal" required error={errors.password} hint="Mínimo 8 caracteres.">
                <input style={{...S.input,borderColor:errors.password?"#ef4444":"var(--border2)"}} type="password" value={form.password||""} onChange={f("password")}/>
              </FormField>
            </>}
            <FormField label="Perfil">
              <input style={S.input} value={form.perfil||""} onChange={f("perfil")} placeholder="Operaciones, Administracion..."/>
            </FormField>
            <FormField label="Rol" required error={errors.rol}>
              <select value={form.rol||"trafico"} onChange={cambiarRol} style={{...S.sel,borderColor:errors.rol?"#ef4444":"var(--border2)"}}>
                {ROLES.map(r=><option key={r} value={r}>{LABEL[r]||r}</option>)}
              </select>
            </FormField>
            {form.rol === "chofer" && (
              <FormField label="Ficha de chofer y matricula" required error={errors.chofer_id} hint="La app mostrara los viajes asignados a este chofer o a su vehiculo/matricula habitual.">
                <select value={form.chofer_id || ""} onChange={f("chofer_id")} style={{...S.sel,borderColor:errors.chofer_id?"#ef4444":"var(--border2)"}}>
                  <option value="">Selecciona chofer...</option>
                  {choferes.map(c => (
                    <option key={c.id} value={c.id}>
                      {`${c.nombre || ""} ${c.apellidos || ""}`.trim() || "Chofer"}{c.vehiculo_matricula ? ` - ${c.vehiculo_matricula}` : " - sin matricula"}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            {form.rol === "trafico" && (
              <div style={{border:"1px solid var(--border2)",borderRadius:8,padding:12,marginTop:12,background:"rgba(20,184,166,.06)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:10}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:900,color:"var(--accent-xl)"}}>Alcance operativo de trafico</div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>Define que matriculas y que tipo de viajes vera este usuario.</div>
                  </div>
                  <button
                    type="button"
                    style={{...S.btn,background:"rgba(20,184,166,.12)",color:"var(--accent-xl)",border:"1px solid rgba(20,184,166,.35)",padding:"5px 9px",fontSize:11}}
                    onClick={()=>setForm(p=>({...p,trafico_config:{ vehiculo_ids: [], tipos_viaje: ["normal","salida","retorno"] }}))}
                  >
                    Ver todo
                  </button>
                </div>
                <label style={{...S.label,marginTop:0}}>Tipo de viaje</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                  {[
                    ["salida", "Salidas"],
                    ["retorno", "Retornos"],
                    ["normal", "Sin clasificar"],
                  ].map(([key,label]) => {
                    const cfg = normalizarTraficoConfigUI(form.trafico_config);
                    const active = cfg.tipos_viaje.includes(key);
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={()=>toggleTipoViaje(key)}
                        style={{padding:"6px 10px",borderRadius:7,border:`1px solid ${active ? "rgba(20,184,166,.35)" : "var(--border2)"}`,background:active ? "rgba(20,184,166,.14)" : "var(--bg4)",color:active ? "var(--accent-xl)" : "var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer"}}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <label style={{...S.label,marginTop:0}}>Matriculas</label>
                  <div style={{display:"flex",gap:6}}>
                    <button type="button" onClick={()=>setForm(p=>({...p,trafico_config:{...normalizarTraficoConfigUI(p.trafico_config),vehiculo_ids:vehiculos.map(v=>String(v.id))}}))}
                      style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",border:"1px solid var(--border2)",padding:"4px 8px",fontSize:10}}>
                      Todas
                    </button>
                    <button type="button" onClick={()=>setForm(p=>({...p,trafico_config:{...normalizarTraficoConfigUI(p.trafico_config),vehiculo_ids:[]}}))}
                      style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",border:"1px solid var(--border2)",padding:"4px 8px",fontSize:10}}>
                      Sin limite
                    </button>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(132px,1fr))",gap:6,maxHeight:180,overflowY:"auto",paddingRight:4}}>
                  {vehiculos.filter(v => !String(v.clase || v.tipo || "").toLowerCase().includes("remolque")).map(v => {
                    const cfg = normalizarTraficoConfigUI(form.trafico_config);
                    const active = cfg.vehiculo_ids.includes(String(v.id));
                    return (
                      <label key={v.id} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 8px",borderRadius:7,border:`1px solid ${active ? "rgba(20,184,166,.35)" : "var(--border2)"}`,background:active ? "rgba(20,184,166,.10)" : "var(--bg4)",fontSize:11,color:"var(--text2)",cursor:"pointer"}}>
                        <input type="checkbox" checked={active} onChange={()=>toggleVehiculoScope(v.id)} />
                        <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800}}>{v.matricula || "Sin matricula"}</span>
                      </label>
                    );
                  })}
                  {vehiculos.length === 0 && <div style={{fontSize:11,color:"var(--text5)"}}>No hay matriculas cargadas.</div>}
                </div>
                <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.45,marginTop:8}}>
                  Si no seleccionas matriculas, el usuario ve todas. Si seleccionas algunas, solo vera esas y recibira avisos de ida/retorno para esas matriculas.
                </div>
              </div>
            )}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginTop:12}}>
              <label style={{...S.label,marginTop:0,marginBottom:0}}>Permisos por modulo</label>
              <button
                type="button"
                style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",border:"1px solid var(--border2)",padding:"5px 9px",fontSize:11}}
                onClick={()=>setForm(p=>({...p,permisos:presetRol(p.rol||"trafico")}))}
              >
                Aplicar rol
              </button>
            </div>
            <div style={{border:"1px solid var(--border2)",borderRadius:8,overflow:"hidden",marginTop:8}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 64px 64px",gap:0,background:"var(--bg3)",color:"var(--text4)",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em"}}>
                <div style={{padding:"8px 10px"}}>Modulo</div>
                <div style={{padding:"8px 10px",textAlign:"center"}}>Ver</div>
                <div style={{padding:"8px 10px",textAlign:"center"}}>Editar</div>
              </div>
              {MODULOS_PERM.map(m => {
                const permisos = normalizarPermisosUI(form.permisos, form.rol).modulos[m.id] || {};
                return (
                  <div key={m.id} style={{display:"grid",gridTemplateColumns:"1fr 64px 64px",alignItems:"center",borderTop:"1px solid #1d2840"}}>
                    <div style={{padding:"8px 10px",fontSize:12,color:"var(--text2)"}}>{m.label}</div>
                    <label style={{display:"flex",justifyContent:"center",padding:8}}>
                      <input type="checkbox" checked={!!permisos.ver} onChange={()=>togglePermiso(m.id,"ver")}/>
                    </label>
                    <label style={{display:"flex",justifyContent:"center",padding:8}}>
                      <input type="checkbox" checked={!!permisos.editar} onChange={()=>togglePermiso(m.id,"editar")}/>
                    </label>
                  </div>
                );
              })}
            </div>
            {editando&&<>
              <FormField label="Estado">
                <select value={form.activo===false?"false":"true"} onChange={e=>setForm(p=>({...p,activo:e.target.value==="true"}))} style={S.sel}>
                  <option value="true">Activo</option><option value="false">Inactivo</option>
                </select>
              </FormField>
            </>}
        </ModalShell>
      )}
    </div>
  );
}
