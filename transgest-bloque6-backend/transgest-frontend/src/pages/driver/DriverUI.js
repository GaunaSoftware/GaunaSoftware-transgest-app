import { useTheme } from "../../context/ThemeContext";
import logoDark from "../../assets/brand/transgest_logo_dark.svg";
import logoWhite from "../../assets/brand/transgest_logo_white.svg";
import "./driver.css";
import "./driver-redesign.css";

const paths = {
  activos: "M3 6h11v11H3z M14 10h4l3 4v3h-7 M7 17a2 2 0 1 0 0 .01 M18 17a2 2 0 1 0 0 .01",
  nuevo: "M12 5v14 M5 12h14",
  jornada: "M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  datos: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2",
  vacaciones: "M5 5h14v16H5z M8 3v4 M16 3v4 M5 10h14 M9 15l2 2 4-4",
  historial: "M3 4v5h5 M3 9a9 9 0 1 1 0 6 M12 7v5l3 2",
  solicitud: "m14 6 4-4a6 6 0 0 1-7 8L4 17a2 2 0 0 0 3 3l7-7a6 6 0 0 0 8-7l-4 4z",
  inicio: "m3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9",
  avisos: "M5 16h14l-2-3V8a5 5 0 0 0-10 0v5z M10 20h4",
  mas: "M4 6h16 M4 12h16 M4 18h16",
  salir: "M10 3H4v18h6 M9 12h12 M17 8l4 4-4 4",
  actualizar: "M20 4v5h-5 M4 20v-5h5 M20 9A8 8 0 0 0 6 5 M4 15a8 8 0 0 0 14 4",
  documento: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
  qr: "M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h2v2h-2z M20 14v3 M14 20h3 M20 20h1v1h-1z",
  compartir: "M12 16V3 M8 7l4-4 4 4 M7 11H4v10h16V11h-3",
};
export function DriverIcon({ name, size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.documento}/></svg>;
}
export function DriverHeading({ icon, title, children }) {
  return <div className="driver-section-heading"><span className="driver-icon-tile"><DriverIcon name={icon}/></span><div><h2>{title}</h2>{children && <p>{children}</p>}</div></div>;
}
const titles = { inicio:"Tu día, en un vistazo", activos:"Mis viajes", nuevo:"Nuevo viaje", jornada:"Mi jornada", datos:"Mis datos", vacaciones:"Mis vacaciones", historial:"Historial de viajes", solicitud:"Solicitudes de taller", avisos:"Avisos y rutas", mas:"Más opciones" };
export function DriverHeader({ user, tab, onNavigate, unread }) {
  const { isDark } = useTheme() || {};
  const initials = (user?.nombre || "Chófer").trim().split(/\s+/).slice(0,2).map(s=>s[0]).join("").toUpperCase();
  return <>
    <header className="driver-header"><img src={isDark ? logoWhite : logoDark} alt="TransGest"/><div className="driver-header-tools"><button aria-label="Avisos y rutas" onClick={()=>onNavigate("avisos")}><DriverIcon name="avisos"/>{unread > 0 && <span className="driver-notification-dot"/>}</button><button className="driver-avatar" aria-label="Mis datos" onClick={()=>onNavigate("datos")}>{initials}</button></div></header>
    <div className="driver-page-heading"><h1>{tab==="detalle" ? "Detalle de viaje" : titles[tab] || "Mis viajes"}</h1><span>{user?.nombre}</span></div>
  </>;
}
export function DriverNavigation({ tab, onNavigate }) {
  const active = ["activos","nuevo","historial"].includes(tab) ? "activos" : ["datos","vacaciones","solicitud"].includes(tab) ? "mas" : tab;
  return <nav className="driver-bottom-nav" aria-label="Navegación principal del chófer">{[["inicio","Inicio"],["activos","Mis viajes"],["jornada","Jornada"],["avisos","Avisos"],["mas","Más"]].map(([id,label])=><button key={id} aria-current={active===id ? "page" : undefined} onClick={()=>onNavigate(id)}><DriverIcon name={id}/><span>{label}</span></button>)}</nav>;
}
export function DriverHome({ pedidos, jornada, onNavigate, loading, offline, pending }) {
  const active=pedidos.filter(p=>!["entregado","facturado","cancelado"].includes(p.estado));
  return <div className="driver-section-shell">
    <div className="driver-summary-grid"><button onClick={()=>onNavigate("activos")}><DriverIcon name="activos"/><span>Viajes activos<strong>{loading ? "—" : active.length}</strong></span></button><button onClick={()=>onNavigate("jornada")}><DriverIcon name="jornada"/><span>Mi jornada<strong>{loading ? "—" : jornada ? "En curso" : "Sin iniciar"}</strong></span></button></div>
    <section className="driver-card"><DriverHeading icon="nuevo" title="Accesos rápidos">Lo que necesitas durante tu jornada.</DriverHeading><div className="driver-action-grid">{[["nuevo","Crear viaje"],["jornada","Ver jornada"],["datos","Datos y firma"],["historial","Consultar historial"]].map(([id,label])=><button key={id} onClick={()=>onNavigate(id)}><DriverIcon name={id}/>{label}</button>)}</div></section>
    <section className="driver-card"><DriverHeading icon="activos" title="Viajes asignados">Consulta las paradas y actualiza el estado de cada viaje.</DriverHeading>{loading ? <p>Cargando viajes…</p> : active.length ? active.slice(0,3).map(p=><button className="driver-trip-link" key={p.id} onClick={()=>onNavigate("activos")}><span><strong>{p.numero || "Viaje"}</strong><span>{p.cliente_nombre || ""}</span></span><span>{p.origen || "Origen pendiente"} → {p.destino || "Destino pendiente"}</span><span>Ver viaje →</span></button>) : <p className="driver-empty">No tienes viajes activos asignados.</p>}</section>
    <p className="driver-sync" role="status">{offline ? "Sin conexión" : "Conexión disponible"} · {pending ? `${pending} acciones pendientes de sincronizar` : "Sin acciones pendientes de sincronizar"}</p>
  </div>;
}
export function DriverMore({ tabs, onNavigate, onLogout, onNotifications, notificationPermission, onRefresh, loading }) {
  const { toggle, isDark } = useTheme() || {};
  return <div className="driver-section-shell"><section className="driver-card"><DriverHeading icon="mas" title="Tu espacio">Datos, documentos y preferencias de la app.</DriverHeading><div className="driver-menu"><button onClick={onRefresh} disabled={loading}><DriverIcon name="actualizar"/><span>Actualizar información</span></button>{tabs.map(([id,label])=><button key={id} onClick={()=>onNavigate(id)}><DriverIcon name={id}/><span>{label}</span><span aria-hidden="true">›</span></button>)}<button onClick={toggle}><DriverIcon name="inicio"/><span>{isDark ? "Usar tema claro" : "Usar tema oscuro"}</span></button>{notificationPermission==="default" && <button onClick={onNotifications}><DriverIcon name="avisos"/><span>Activar notificaciones</span></button>}<button className="driver-logout" onClick={onLogout}><DriverIcon name="salir"/><span>Cerrar sesión</span></button></div></section></div>;
}
