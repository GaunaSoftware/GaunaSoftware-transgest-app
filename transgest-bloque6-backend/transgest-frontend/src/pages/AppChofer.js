import DriverExpenses from "./driver/DriverExpenses";
import { useState, useEffect, useRef, useCallback } from "react";
import { getPedidos, cambiarEstadoPedido, editarPedido, guardarFirmaEntrega, actualizarGpsPedido, registrarGpsChoferApp, getTallerSolicitudes, crearTallerSolicitud, subirPedidoDocChofer, guardarPedidoChoferPasos, getToken, getChoferJornadaApp, guardarChoferFirmaBaseApp, getChoferVacacionesApp, getNotificaciones, marcarNotificacionLeida } from "../services/api";
import { useAuth } from "../context/AuthContext";

import { confirmDialog, notify } from "../services/notify";
import { requestForegroundLocationPermission, watchForegroundLocation, isNativeMobileApp, listenNativeBack, exitMobileApp } from "../services/mobileRuntime";
import { getOfflineOwner, writeOfflineQueue, markOfflineAttempt, queueSummary, readyOfflineItems } from "../services/offlineQueue";

import { DriverHeader, DriverNavigation, DriverHome, DriverMore, DriverIcon, DriverHeading } from "./driver/DriverUI";

import { leerOfflineQueue, prepararArchivoEscaner, capturarUbicacionActual, buildUploadEvidence, FirmaLaboralCanvas } from "./driver/driverSupport";
import { TarjetaViaje } from "./driver/DriverTrip";
import { SolicitudMecanico } from "./driver/DriverWorkshop";
import { JornadaChofer, ConjuntoChofer } from "./driver/DriverWorkday";
import { VacacionesChofer, DatosChofer } from "./driver/DriverProfile";
import { NuevoViajeChofer } from "./driver/DriverNewTrip";
export default function AppChofer(){
  const { user, logout } = useAuth();
  const planNorm = String(user?.plan || "").toLowerCase();
  const isLitePlan = ["lite", "mini", "transgest_lite", "transgest_mini"].includes(planNorm);
  const [pedidos,   setPedidos]   = useState([]);
  const [solicitudesChofer, setSolicitudesChofer] = useState([]);
  const [vacacionesChofer, setVacacionesChofer] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [tab,       updateTab]       = useState("activos");
  function setTab(next){setExpandedPedidoId(null);updateTab(next);} // activos | nuevo | historial | solicitud

  // PWA state
  const [offline,        setOffline]        = useState(!navigator.onLine);
  const [installPrompt,  setInstallPrompt]  = useState(null);
  const [showInstall,    setShowInstall]    = useState(false);
  const [notifPerm,      setNotifPerm]      = useState(() => ("Notification" in window ? Notification.permission : "default"));
  const [cameraModal,    setCameraModal]    = useState(null); // pedido for photo
  const [offlineQueue,   setOfflineQueue]   = useState(() => leerOfflineQueue());
  const [jornadaInfo, setJornadaInfo] = useState(null);
  const [expandedPedidoId, setExpandedPedidoId] = useState(null);
  const [routeNotifications, setRouteNotifications] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [firmaBaseOpen, setFirmaBaseOpen] = useState(false);
  const [firmaBaseForzada, setFirmaBaseForzada] = useState(false);
  useEffect(()=>{
    let disposed=false,remove=null;
    listenNativeBack(async()=>{
      const event=new Event("tms:driver-back",{cancelable:true});
      if(!window.dispatchEvent(event))return;
      if(expandedPedidoId){setExpandedPedidoId(null);return;}
      if(tab!=="activos"){setTab("activos");return;}
      if(await confirmDialog({title:"Salir de la app",message:"¿Quieres cerrar TransGest? Tu jornada seguirá registrada.",confirmText:"Salir"}))await exitMobileApp();
    }).then(fn=>{if(disposed)fn();else remove=fn;});
    return()=>{disposed=true;remove?.();};
  },[tab,expandedPedidoId]);
  const gpsSeguimientoRef = useRef({ lastSent: 0 });
  const offlineSyncRef = useRef(false);
  const cargaInicialRef = useRef(false);
  const [gpsSeguimientoEstado, setGpsSeguimientoEstado] = useState({
    active: false,
    text: "Ubicación en espera hasta iniciar jornada.",
  });

  const cargar = useCallback(async (options = {}) => {
    const mostrarCarga = !!options.forceLoading || !cargaInicialRef.current;
    if (mostrarCarga) setLoading(true);
    setLoadError("");
    try{
      const p = await getPedidos({chofer_id:user?.chofer_id || user?.id});
      const arr = Array.isArray(p) ? p : Array.isArray(p?.data) ? p.data : [];
      setPedidos(arr);
      const jornada = await getChoferJornadaApp().catch(() => null);
      setJornadaInfo(jornada);
      const puedeLeerAvisos = user?.rol !== "chofer" || user?.permisos?.modulos?.avisos?.ver === true || user?.permisos?.avisos?.ver === true;
      if (puedeLeerAvisos) {
        const avisos = await getNotificaciones(20).catch(() => ({ data: [] }));
        setRouteNotifications((Array.isArray(avisos?.data) ? avisos.data : [])
          .filter(n => ['ruta_chofer_app','plan_diario','pedido_app_chofer'].includes(String(n.tipo || '')))
          .slice(0, 3));
      } else {
        setRouteNotifications([]);
      }
      if (isLitePlan) {
        setSolicitudesChofer([]);
        setVacacionesChofer([]);
      } else {
        const solicitudes = await getTallerSolicitudes().catch(() => []);
        const nextSolicitudes = Array.isArray(solicitudes) ? solicitudes.slice(0, 50) : [];
        setSolicitudesChofer(nextSolicitudes);
        const vacaciones = await getChoferVacacionesApp().catch(() => []);
        const vacacionesArr = Array.isArray(vacaciones) ? vacaciones : Array.isArray(vacaciones?.solicitudes) ? vacaciones.solicitudes : [];
        setVacacionesChofer(vacacionesArr.slice(0, 50));
      }
      cargaInicialRef.current = true;
    }catch(e){ setLoadError(e.message || "No se pudo actualizar la información. Reintenta la conexión."); }
    finally{ if (mostrarCarga) setLoading(false); }
  }, [user?.id, user?.chofer_id, user?.rol, user?.permisos?.modulos?.avisos?.ver, user?.permisos?.avisos?.ver, isLitePlan]);

  useEffect(()=>{ cargar(); },[cargar]);
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)getChoferJornadaApp().then(setJornadaInfo).catch(()=>{});},60000);return()=>clearInterval(timer);},[user?.id]);

  useEffect(() => {
    const chofer = jornadaInfo?.chofer;
    if (user?.rol === "chofer" && chofer?.id && !chofer?.firma_base) {
      setFirmaBaseForzada(true);
      setFirmaBaseOpen(true);
    } else if (chofer?.firma_base) {
      setFirmaBaseForzada(false);
    }
  }, [jornadaInfo?.chofer, user?.rol]);

  async function guardarFirmaBaseChofer(firma) {
    try {
      await guardarChoferFirmaBaseApp(firma);
      setFirmaBaseOpen(false);
      setFirmaBaseForzada(false);
      notify("Firma guardada en tu ficha de chófer.", "success");
      await cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar la firma", "error");
    }
  }

  useEffect(() => {
    if (isLitePlan && ["solicitud", "vacaciones"].includes(tab)) setTab("activos");
  }, [isLitePlan, tab]);

  useEffect(() => {
    const refreshQueue = (event) => {
      if (Array.isArray(event?.detail)) {
        setOfflineQueue(event.detail);
        return;
      }
      setOfflineQueue(leerOfflineQueue());
    };
    window.addEventListener("tms:offline-queue-changed", refreshQueue);
    return () => window.removeEventListener("tms:offline-queue-changed", refreshQueue);
  }, []);

  // PWA: offline detection
  useEffect(()=>{
    const goOnline  = () => { setOffline(false); syncOfflineQueue(); };
    const goOffline = () => setOffline(true);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  // syncOfflineQueue intentionally stays stable enough for the browser online event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PWA: install prompt
  useEffect(()=>{
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); setShowInstall(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const gpsJornadaId = jornadaInfo?.jornada?.id || null;
  const gpsJornadaEstado = jornadaInfo?.jornada?.estado || "";
  const gpsJornadaActividad = jornadaInfo?.jornada?.actividad_actual || "";
  const gpsChoferVehiculoId = jornadaInfo?.chofer?.vehiculo_id || null;
  const gpsChoferProvider = jornadaInfo?.chofer?.gps_provider || "";
  const gpsChoferExternalId = jornadaInfo?.chofer?.gps_external_id || "";
  const externalGpsTime = Date.parse(jornadaInfo?.chofer?.external_gps_at || "");
  const gpsHasFreshExternal = externalGpsTime >= Date.now()-300000 && externalGpsTime <= Date.now()+60000;

  // GPS app: se activa con jornada abierta y se pausa en descanso, pausa o fin.
  useEffect(()=>{
    const actividad = String(gpsJornadaActividad || "").toLowerCase();
    const provider = String(gpsChoferProvider || "").trim().toLowerCase();
    const externalId = String(gpsChoferExternalId || "").trim();
    const hasExternalGps = provider && provider !== "manual" && provider !== "app_chofer" && externalId && gpsHasFreshExternal;
    const nativeApp = isNativeMobileApp();
    const hasWebGps = typeof navigator !== "undefined" && !!navigator.geolocation;
    if (!nativeApp && !hasWebGps) {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: false, text: "GPS no disponible en este dispositivo." });
      return;
    }
    if (!gpsJornadaId || gpsJornadaEstado !== "abierta") {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: false, text: "Ubicación en espera hasta iniciar jornada." });
      return;
    }
    if (["pausa", "descanso", "fin"].includes(actividad)) {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: false, text: "Ubicación pausada durante pausa, descanso o fin de jornada." });
      return;
    }
    if (hasExternalGps) {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: true, text: "Ubicación gestionada por GPS del vehículo." });
      return;
    }
    if (!gpsChoferVehiculoId) {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: false, text: "Asigna una tractora para registrar ubicación desde la app." });
      return;
    }
    gpsSeguimientoRef.current.lastSent = 0;
    let cancelled = false;
    let stopWatch = null;
    setGpsSeguimientoEstado({ active: false, text: "Solicitando permiso de ubicación para jornada activa..." });
    (async () => {
      const granted = await requestForegroundLocationPermission().catch(() => false);
      if (cancelled) return;
      if (!granted) {
        setGpsSeguimientoEstado({ active: false, text: "Permiso de ubicación denegado. Activalo para registrar posicion durante la jornada." });
        return;
      }
      stopWatch = await watchForegroundLocation(
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 },
        pos => {
          if (!pos) return;
        const now = Date.now();
        setGpsSeguimientoEstado({
          active: true,
          text: `Ubicacion activa con app abierta. Ultima senal ${new Date(now).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}.`,
        });
        if (gpsSeguimientoRef.current.lastSent && gpsSeguimientoRef.current.lastSent + 60000 > now) return;
        gpsSeguimientoRef.current.lastSent = now;
        registrarGpsChoferApp({
          vehiculo_id: gpsChoferVehiculoId,
          lat: pos.lat,
          lng: pos.lng,
          accuracy_m: Number.isFinite(pos.accuracy_m) ? Number(pos.accuracy_m.toFixed(1)) : null,
          velocidad_kmh: Number.isFinite(pos.speed_mps) && pos.speed_mps >= 0 ? Number((pos.speed_mps * 3.6).toFixed(1)) : null,
          recorded_at: new Date().toISOString(),
        }).then(result=>{if(result?.ok && !result?.skipped) setJornadaInfo(prev=>prev?{...prev,chofer:{...prev.chofer,gps_lat:pos.lat,gps_lng:pos.lng,ubicacion_ts:new Date().toISOString()}}:prev);}).catch(()=>setGpsSeguimientoEstado({active:false,text:"No se pudo enviar la ubicación. Revisa la conexión."}));
        },
        () => {
          setGpsSeguimientoEstado({ active: false, text: "Permiso de ubicación denegado o no disponible." });
        }
      );
      if(cancelled) stopWatch?.();
    })();
    return () => {
      cancelled = true;
      try { stopWatch?.(); } catch {}
    };
  }, [
    gpsJornadaId,
    gpsJornadaEstado,
    gpsJornadaActividad,
    gpsChoferVehiculoId,
    gpsChoferProvider,
    gpsChoferExternalId, gpsHasFreshExternal,
  ]);

  const ORDEN_ESTADO = {en_curso:0,descarga:1,confirmado:2,pendiente:3,entregado:4,facturado:5,cancelado:6};
  const filtrados = pedidos.filter(p=>{
    const activo=!["entregado","cancelado","facturado"].includes(p.estado);
    if(tab==="activos") return activo;
    if(tab==="historial") return !activo;
    return true;
  }).sort((a,b)=>(ORDEN_ESTADO[a.estado]??99)-(ORDEN_ESTADO[b.estado]??99));

  // Mark the next confirmed trip after any en_curso
  const enCursoIds = new Set(pedidos.filter(p=>["en_curso","descarga"].includes(p.estado)).map(p=>p.vehiculo_id));
  // Los pedidos de un mismo grupaje van en el MISMO camion: el chofer no debe
  // verlos como viajes sueltos sino como un viaje con varias cargas y descargas
  // que ir confirmando. Cada parada sigue confirmandose en su propia tarjeta.
  function agruparPorGrupaje(lista = []) {
    const bloques = [];
    const porGrupaje = new Map();
    lista.forEach(p => {
      const gid = p.grupaje_id ? String(p.grupaje_id) : "";
      if (!gid) { bloques.push({ key: `p:${p.id}`, grupaje: false, pedidos: [p] }); return; }
      if (!porGrupaje.has(gid)) {
        const bloque = { key: `g:${gid}`, grupaje: true, pedidos: [], borrador: false };
        porGrupaje.set(gid, bloque);
        bloques.push(bloque);
      }
      const bloque = porGrupaje.get(gid);
      bloque.pedidos.push(p);
      if (p.grupaje_borrador) bloque.borrador = true;
    });
    // Un grupaje con un solo viaje se muestra como viaje normal.
    return bloques.map(b => (b.grupaje && b.pedidos.length < 2 ? { ...b, grupaje: false } : b));
  }

  const filtradosConProxima = filtrados.map((p,i)=>{
    if(p.estado==="confirmado" && enCursoIds.size>0) return {...p, es_proxima_carga:true};
    return p;
  });

  const offlineQueueSummary = queueSummary(offlineQueue);
  const solicitudesAbiertas = solicitudesChofer.filter(s => !["resuelto","cerrado","cancelado"].includes(String(s.estado || "").toLowerCase())).length;
  const vacacionesFirmaPendiente = vacacionesChofer.filter(v => v.estado === "aprobada_pendiente_firma").length;
  const solicitudCritica = solicitudesChofer.find(s => String(s.urgencia || "").toLowerCase() === "critica" && !["resuelto","cerrado","cancelado"].includes(String(s.estado || "").toLowerCase()));
  const vehiculoSolicitud = pedidos.find(p=>p.vehiculo_id&&["en_curso","confirmado"].includes(p.estado))
    || (jornadaInfo?.chofer?.vehiculo_id ? {
      id: jornadaInfo.chofer.vehiculo_id,
      vehiculo_id: jornadaInfo.chofer.vehiculo_id,
      matricula: jornadaInfo.chofer.matricula || jornadaInfo.chofer.vehiculo_matricula || "",
    } : null);
  const baseTabsChofer = isLitePlan
    ? [["activos","Activos"],["nuevo","Nuevo"],["jornada","Jornada"],["datos","Datos"],["historial","Historial"]]
    : [["activos","Activos"],["nuevo","Nuevo"],["jornada","Jornada"],["datos","Datos"],["vacaciones","Vacaciones"],["historial","Historial"],["solicitud","Taller"]];

  const tabsChofer = [...baseTabsChofer,["conjunto","Conjunto"],...(!user?.colaborador_id?[["repostajes","Repostajes y dietas"]]:[])];

  useEffect(() => {
    const app = document.querySelector(".tg-app-chofer-page");
    app?.scrollIntoView({ block:"start", behavior:"auto" });
    const nav = app?.querySelector(".tg-chofer-tabs");
    const active = nav?.querySelector('[aria-current="page"]');
    if (nav && active) {
      const item = active.getBoundingClientRect(), container = nav.getBoundingClientRect();
      if (item.left < container.left || item.right > container.right) nav.scrollLeft += item.left - container.left - 12;
    }
  }, [tab]);

  // PWA helpers
  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setShowInstall(false);
  }

  async function pedirNotificaciones() {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    if (perm === "granted") {
      new Notification("TransGest", {
        body: "Las notificaciones estan activadas. Te avisaremos de nuevos pedidos.",
        icon: "/favicon.ico",
      });
    }
  }

  async function marcarRutaNotificacionLeida(id) {
    try { await marcarNotificacionLeida(id); } catch (e) { notify(e.message || "No se pudo marcar el aviso como leído.", "error"); return; }
    setRouteNotifications(prev => prev.filter(n => String(n.id) !== String(id)));
  }

  function syncOfflineQueue() {
    if (offlineSyncRef.current) return;
    const owner = getOfflineOwner();
    const all = leerOfflineQueue();
    const ready = readyOfflineItems().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (!ready.length) return;
    offlineSyncRef.current = true;
    (async () => {
      const results = [];
      for (const item of ready) {
        if(owner!==getOfflineOwner()) break;
        try {
          if ((item.tipo === "solicitud_mecanico" || item.tipo === "solicitud_taller") && item.solicitud) {
            await crearTallerSolicitud(item.solicitud);
          } else if (item.tipo === "pedido_chofer_pasos" && item.pedido_id && item.patch) {
            await guardarPedidoChoferPasos(item.pedido_id, item.patch);
          } else if (item.tipo === "pedido_doc_chofer" && item.pedido_id && item.body) {
            await subirPedidoDocChofer(item.pedido_id, item.body);
          } else if (item.tipo === "pedido_doc_empresa" && item.pedido_id && item.body) {
            await subirPedidoDocChofer(item.pedido_id, {...item.body, tipo:String(item.body.tipo || '').startsWith('incidencia_') ? 'incidencia_chofer' : item.body.tipo});
          } else if (item.tipo === "pedido_firma" && item.pedido_id && item.body) {
            await guardarFirmaEntrega(item.pedido_id, item.body);
          } else if (item.tipo === "pedido_estado" && item.pedido_id && item.estado) {
            await cambiarEstadoPedido(item.pedido_id, item.estado, item.body || {});
          } else if (item.tipo === "pedido_gps" && item.pedido_id && item.body) {
            await actualizarGpsPedido(item.pedido_id, item.body);
          } else if (item.tipo === "pedido_editar" && item.pedido_id && item.body) {
            await editarPedido(item.pedido_id, item.body);
          } else if (item.url) {
            const res = await fetch(item.url, {
              method: item.method || "PUT",
              headers: { "Content-Type":"application/json", "Authorization":"Bearer "+getToken() },
              body: JSON.stringify(item.body || {}),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          }
          results.push({ id: item.id, ok: true });
        } catch (error) {
          results.push({ id: item.id, ok: false, error: error?.message || "No se pudo sincronizar" });
        }
      }
      const okIds = new Set(results.filter(r => r.ok).map(r => r.id));
      const failed = new Map(results.filter(r => !r.ok).map(r => [r.id, r.error]));
      const next = all
        .filter(item => !okIds.has(item.id))
        .map(item => failed.has(item.id) ? markOfflineAttempt(item, failed.get(item.id)) : item);
      const saved = writeOfflineQueue(next,owner);
      if(owner!==getOfflineOwner()) return;
      setOfflineQueue(saved);
      const okCount = okIds.size;
      if (okCount) {
        const summary = queueSummary(saved);
        notify(`Sincronizadas ${okCount} accion(es) pendientes${summary.blocked ? `. ${summary.blocked} bloqueada(s)` : ""}.`, "success");
        cargar();
      }
    })().finally(() => {
      offlineSyncRef.current = false;
    });
  }


  return(
    <>
    <div className="tg-app-chofer-page">
      <DriverHeader user={user} tab={expandedPedidoId ? "detalle" : tab} onNavigate={setTab} onRefresh={()=>cargar({forceLoading:true})} unread={routeNotifications.length} loading={loading}/>
      {loadError && <div className="driver-load-error" role="alert"><span>{loadError}</span><button onClick={()=>cargar({forceLoading:true})}>Reintentar</button></div>}

      {/* Banner offline */}
      {offline && (
        <div style={{background:"rgba(239,68,68,.15)",border:"1px solid rgba(239,68,68,.3)",
          padding:"8px 16px",display:"flex",alignItems:"center",gap:8,
          fontSize:14,color:"#ef4444",fontWeight:600}}>
          <span>Offline</span>
          <span>Sin conexión - los cambios se sincronizarán cuando vuelvas a conectarte
            {offlineQueueSummary.total>0?` (${offlineQueueSummary.pending} pendiente${offlineQueueSummary.pending===1?"":"s"})`:""}</span>
        </div>
      )}

      {!offline && offlineQueueSummary.total > 0 && (
        <div style={{background:"rgba(245,158,11,.14)",border:"1px solid rgba(245,158,11,.34)",
          padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,
          fontSize:14,color:"#d97706",fontWeight:700}}>
          <span>
            {offlineQueueSummary.pending} acción{offlineQueueSummary.pending===1?"":"es"} pendiente{offlineQueueSummary.pending===1?"":"s"} de sincronizar
            {offlineQueueSummary.blocked ? ` · ${offlineQueueSummary.blocked} bloqueada${offlineQueueSummary.blocked===1?"":"s"}` : ""}
          </span>
          <button onClick={syncOfflineQueue}
            style={{border:"1px solid rgba(245,158,11,.45)",background:"rgba(255,255,255,.12)",color:"#d97706",borderRadius:8,padding:"5px 8px",fontSize:14,fontWeight:900,cursor:"pointer"}}>
            Reintentar
          </button>
        </div>
      )}

      {tab==="avisos" && routeNotifications.length > 0 && (
        <div style={{padding:"10px 14px",display:"grid",gap:8}}>
          {routeNotifications.map(n => {
            const rutaUrl = n?.data?.route_url || n?.data?.maps_url || "";
            return (
              <div key={n.id} style={{background:"var(--accent-a10)",border:"1px solid var(--accent-a28)",borderRadius:10,padding:"10px 12px"}}>
                <div style={{fontSize:14,fontWeight:900,color:"#2dd4bf"}}>{n.titulo || "Ruta enviada"}</div>
                <div style={{fontSize:14,color:"var(--text4)",lineHeight:1.4,marginTop:3,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{n.mensaje || "Tienes una ruta recomendada pendiente de revisar."}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginTop:9}}>
                  <button onClick={()=>rutaUrl && window.open(rutaUrl, "_blank", "noopener,noreferrer")} disabled={!rutaUrl}
                    style={{padding:"9px 10px",borderRadius:8,border:"1px solid var(--accent-a36)",background:rutaUrl ? "var(--accent)" : "var(--border2)",color:"#fff",fontSize:14,fontWeight:900,cursor:rutaUrl?"pointer":"not-allowed",fontFamily:"'DM Sans',sans-serif"}}>
                    Abrir ruta
                  </button>
                  <button onClick={()=>marcarRutaNotificacionLeida(n.id)}
                    style={{padding:"9px 10px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text3)",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                    Leída
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Banner instalar PWA */}
      {showInstall && (
        <div style={{background:"rgba(59,130,246,.12)",border:"1px solid rgba(59,130,246,.25)",
          padding:"10px 16px",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>App</span>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--accent-xl)"}}>Instala la app</div>
            <div style={{fontSize:14,color:"var(--text3)"}}>Acceso rápido desde tu móvil, sin abrir el navegador</div>
          </div>
          <button onClick={installApp}
            style={{background:"var(--accent)",color:"#fff",border:"none",borderRadius:7,
              padding:"6px 12px",fontSize:14,fontWeight:700,cursor:"pointer",
              fontFamily:"'DM Sans',sans-serif"}}>Instalar</button>
          <button onClick={()=>setShowInstall(false)}
            style={{background:"none",border:"none",color:"var(--text4)",cursor:"pointer",fontSize:16}}>x</button>
        </div>
      )}

      {/* Tabs */}
      {["activos","nuevo","historial"].includes(tab) && !expandedPedidoId && <nav className="tg-chofer-tabs" aria-label="Apartados del chófer">
        {tabsChofer.filter(([id])=>["activos","nuevo","historial"].includes(id)).map(([id,l])=>(
          <button className="tg-chofer-tab" key={id} onClick={()=>setTab(id)} aria-current={tab===id ? "page" : undefined}>
            <DriverIcon name={id} size={20}/>{l}
            {id==="vacaciones" && vacacionesFirmaPendiente > 0 && (
              <span style={{marginLeft:6,padding:"1px 6px",borderRadius:20,background:"rgba(59,130,246,.16)",color:"#60a5fa",fontSize:12,fontWeight:900}}>
                {vacacionesFirmaPendiente}
              </span>
            )}
            {id==="solicitud" && solicitudesAbiertas > 0 && (
              <span style={{marginLeft:6,padding:"1px 6px",borderRadius:20,background:"rgba(239,68,68,.16)",color:"#ef4444",fontSize:12,fontWeight:900}}>
                {solicitudesAbiertas}
              </span>
            )}
          </button>
        ))}
      </nav>}

      {vacacionesFirmaPendiente > 0 && tab !== "vacaciones" && (
        <button onClick={()=>setTab("vacaciones")}
          style={{width:"100%",textAlign:"left",background:"rgba(59,130,246,.12)",border:"none",borderBottom:"1px solid rgba(59,130,246,.25)",padding:"9px 16px",color:"#60a5fa",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          Tienes vacaciones aprobadas pendientes de firma. Toca para firmar la hoja.
        </button>
      )}

      {solicitudCritica && tab !== "solicitud" && (
        <button onClick={()=>setTab("solicitud")}
          style={{width:"100%",textAlign:"left",background:"rgba(239,68,68,.12)",border:"none",borderBottom:"1px solid rgba(239,68,68,.25)",padding:"9px 16px",color:"#ef4444",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          Taller tiene una solicitud crítica abierta: {solicitudCritica.motivo_label || solicitudCritica.motivo}. Toca para verla.
        </button>
      )}

      {tab==="inicio" && <DriverHome externalDriver={!!user?.colaborador_id} pedidos={pedidos} jornada={jornadaInfo?.jornada} onNavigate={setTab} loading={loading} offline={offline} pending={offlineQueueSummary.total}/>}
      {tab==="mas" && <DriverMore onRefresh={()=>cargar({forceLoading:true})} loading={loading} tabs={tabsChofer.filter(([id])=>!["activos","jornada"].includes(id))} onNavigate={setTab} onLogout={logout} onNotifications={pedirNotificaciones} notificationPermission={notifPerm}/>}
      {tab==="avisos" && routeNotifications.length===0 && <div className="driver-section-shell"><section className="driver-card"><DriverHeading icon="avisos" title="Avisos y rutas">Aquí encontrarás las rutas y avisos de tráfico disponibles para tu cuenta.</DriverHeading><p className="driver-empty">No hay avisos disponibles.</p></section></div>}
      {/* Lista viajes */}
      {["activos","historial"].includes(tab) && (
        <div style={{padding:"12px 16px"}}>
          {loading?(
            <div style={{padding:40,textAlign:"center",color:"var(--text5)"}}>Cargando viajes...</div>
          ):filtrados.length===0?(
            <div style={{padding:40,textAlign:"center",color:"var(--text5)"}}>
              {tab==="activos"?"No tienes viajes activos para esta fecha":"Sin historial para esta fecha"}
            </div>
          ):(
            <>
              {filtradosConProxima.filter(p => ["en_curso","descarga"].includes(String(p.estado || "").toLowerCase())).length > 1 && (
                <div style={{marginBottom:10,padding:"10px 12px",borderRadius:10,border:"1px solid rgba(239,68,68,.25)",background:"rgba(239,68,68,.08)",color:"#b91c1c",fontSize:14,fontWeight:800}}>
                  Hay mas de un viaje activo asignado. Finaliza o corrige el viaje anterior antes de iniciar nuevos estados.
                </div>
              )}
              {expandedPedidoId && <button className="driver-back" onClick={()=>setExpandedPedidoId(null)}>← Volver a mis viajes</button>}
              {agruparPorGrupaje(expandedPedidoId ? filtradosConProxima.filter(p=>String(p.id)===String(expandedPedidoId)) : filtradosConProxima).map(bloque => {
                const tarjetas = bloque.pedidos.map(p=><TarjetaViaje
                  key={p.id}
                  pedido={p}
                  featured={String(p.id)===String(filtradosConProxima[0]?.id)}
                  onActualizar={cargar}
                  jornadaInfo={jornadaInfo}
                  onAbrirJornada={()=>setTab("jornada")}
                  expanded={String(expandedPedidoId || "") === String(p.id)}
                  onExpandedChange={(open)=>{setExpandedPedidoId(open ? p.id : null);window.scrollTo({top:0,behavior:"auto"});}}
                  onFoto={()=>setCameraModal(p.id)}
                />);
                if (!bloque.grupaje) return tarjetas;
                const hechas = bloque.pedidos.filter(p => ["entregado","facturado"].includes(String(p.estado||"").toLowerCase())).length;
                return (
                  <div key={bloque.key} style={{marginBottom:14,border:"2px solid rgba(16,185,129,.35)",borderRadius:14,overflow:"hidden",background:"rgba(16,185,129,.05)"}}>
                    <div style={{padding:"10px 12px",background:"rgba(16,185,129,.12)",borderBottom:"1px solid rgba(16,185,129,.25)"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:14,fontWeight:900,color:"#0f766e"}}>GRUPAJE - un solo viaje</span>
                        {bloque.borrador && (
                          <span style={{fontSize:12,fontWeight:900,color:"#b45309",border:"1px dashed rgba(245,158,11,.5)",borderRadius:999,padding:"1px 7px"}}>Sin confirmar</span>
                        )}
                        <span style={{marginLeft:"auto",fontSize:14,fontWeight:800,color:"#0f766e"}}>
                          {hechas}/{bloque.pedidos.length} entregas
                        </span>
                      </div>
                      <div style={{fontSize:14,color:"var(--text4,#64748b)",marginTop:4,lineHeight:1.5}}>
                        {bloque.pedidos.length} cargas y {bloque.pedidos.length} descargas que confirmar, una por parada:
                        {" "}{bloque.pedidos.map(p => `${p.origen || "?"} > ${p.destino || "?"}`).join("  |  ")}
                      </div>
                    </div>
                    <div style={{padding:"10px 8px 4px"}}>{tarjetas}</div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab==="nuevo" && (
        <NuevoViajeChofer jornadaAbierta={jornadaInfo?.jornada?.estado==="abierta"} onAbrirJornada={()=>setTab("jornada")} onCreado={()=>{ cargar(); }} />
      )}

      {/* Solicitud taller */}
      {tab==="solicitud" && (
        <SolicitudMecanico
          chofer={user}
          vehiculo={vehiculoSolicitud}
          solicitudes={solicitudesChofer}
          onSolicitudesSync={setSolicitudesChofer}
          onEnviado={cargar}
        />
      )}

      {tab==="conjunto" && <ConjuntoChofer jornadaInfo={jornadaInfo} onRefresh={cargar}/>}
      {tab==="repostajes" && !user?.colaborador_id && <DriverExpenses jornadaInfo={jornadaInfo}/>}
      {tab==="jornada" && (
        <JornadaChofer jornadaInfo={jornadaInfo} gpsSeguimientoEstado={gpsSeguimientoEstado} onRefresh={cargar} />
      )}

      {tab==="datos" && (
        <DatosChofer
          chofer={jornadaInfo?.chofer || {}}
          user={user || {}}
          onCambiarFirma={() => {
            setFirmaBaseForzada(!jornadaInfo?.chofer?.firma_base);
            setFirmaBaseOpen(true);
          }}
        />
      )}

      {tab==="vacaciones" && (
        <VacacionesChofer items={vacacionesChofer} chofer={jornadaInfo?.chofer || user} onRefresh={cargar} />
      )}

      {firmaBaseOpen && (
        <FirmaLaboralCanvas
          title="Firma del chófer"
          detail="Firma en la pantalla para guardar tu firma base en la ficha de chofer. Se usara en documentos internos cuando corresponda."
          defaultName={`${jornadaInfo?.chofer?.nombre || user?.nombre || ""} ${jornadaInfo?.chofer?.apellidos || ""}`.trim()}
          onFirma={guardarFirmaBaseChofer}
          onCancel={()=>setFirmaBaseOpen(false)}
          required={firmaBaseForzada}
        />
      )}

    {/* Modal camara */}
    {cameraModal && (
      <div className="driver-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",zIndex:600,
        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{color:"var(--text2)",fontSize:14,marginBottom:16,textAlign:"center"}}>
          Haz una foto de la entrega o incidencia. Se recortara y limpiara automáticamente como escáner.
        </div>
        <input type="file" accept="image/*" capture="environment"
          style={{display:"none"}} id="cam-input"
          onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) { setCameraModal(null); return; }
            try {
              const preparado = await prepararArchivoEscaner(file);
              const location = await capturarUbicacionActual().catch(() => null);
              const uploadEvidence = buildUploadEvidence("foto_entrega", location);
              await subirPedidoDocChofer(cameraModal, {
                nombre: `Foto entrega/incidencia ${new Date().toLocaleString("es-ES")}`,
                tipo: "foto_entrega",
                file_base64: preparado.base64,
                file_mime: preparado.mime,
                file_size_kb: preparado.sizeKb,
                notas: `Subido desde app chofer\n${uploadEvidence.note}`,
                metadata: {
                  ...uploadEvidence.evidence,
                  scan: {
                    detected: !!preparado.scan_detected,
                    crop: preparado.scan_crop || null,
                    quality: preparado.scan_quality || null,
                    size_kb: preparado.sizeKb || null,
                  },
                },
              });
              await editarPedido(cameraModal, { foto_entrega: `data:${preparado.mime};base64,${preparado.base64}` }).catch(() => {});
              notify("Foto guardada en el viaje.", "success");
              cargar();
            } catch(err) {
              notify(err.message || "Foto no guardada", "error");
            } finally {
              try { e.target.value = ""; } catch {}
              setCameraModal(null);
            }
          }}
        />
        <button onClick={()=>document.getElementById("cam-input").click()}
          style={{background:"#3b6ef5",color:"#fff",border:"none",borderRadius:12,
            padding:"16px 32px",fontSize:16,fontWeight:700,cursor:"pointer",
            fontFamily:"'DM Sans',sans-serif",marginBottom:12}}>
          Abrir cámara
        </button>
        <button onClick={()=>setCameraModal(null)}
          style={{background:"var(--bg3)",color:"var(--text3)",border:"1px solid var(--border)",
            borderRadius:8,padding:"10px 24px",fontSize:14,cursor:"pointer",
            fontFamily:"'DM Sans',sans-serif"}}>
          Cancelar
        </button>
      </div>
    )}
      <DriverNavigation tab={tab} onNavigate={setTab}/>
    </div>
    </>
  );
}
