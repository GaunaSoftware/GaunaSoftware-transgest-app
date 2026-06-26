import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { BRAND_NAME, getBrandDisplayName, getBrandVersionLabel } from "../branding";
import { getPublicAppMeta } from "../services/api";
import { getEmpresaPlanLocal } from "../utils/planFeatures";
import transgestLogoWhite from "../assets/brand/transgest_logo_white.svg";

const ROL_LABEL = { gerente:"Gerente", contable:"Contable", trafico:"Tráfico", visualizador:"Visualizador", chofer:"Chófer", cliente:"Cliente" };
const ROL_COLOR = { gerente:"#0f766e", contable:"#10b981", trafico:"#f97316", visualizador:"#64746f", chofer:"#f97316", cliente:"#14b8a6" };

const GRUPO_COLOR = {
  Principal:     "#0f766e",
  Operaciones:   "#14b8a6",
  Flota:         "#f97316",
  Finanzas:      "#10b981",
  Comercial:     "#d97706",
  Gestión:       "#6b7280",
  "Gestión documental": "#6b7280",
  Administración:"#10b981",
  Consulta:      "#6b7280",
};

const CSS = `
  .tg-sidebar { width:252px; background:linear-gradient(180deg,var(--sidebar-bg),#14201d); border-right:1px solid rgba(255,255,255,.08); height:100vh; position:fixed; top:0; left:0; z-index:20; display:flex; flex-direction:column; font-family:'DM Sans',sans-serif; overflow:hidden; box-shadow:16px 0 42px rgba(0,0,0,.14); transition:width .18s ease, transform .2s ease; }
  .tg-sidebar.collapsed { width:76px; }
  .tg-sidebar::before { content:""; position:absolute; inset:0 0 auto 0; height:4px; background:linear-gradient(90deg,var(--accent),var(--green),var(--orange)); pointer-events:none; }
  .tg-sidebar-scroll { flex:1; overflow-y:auto; padding:10px 0 12px; }
  .tg-sidebar-scroll::-webkit-scrollbar { width:3px; }
  .tg-sidebar-scroll::-webkit-scrollbar-track { background:transparent; }
  .tg-sidebar-scroll::-webkit-scrollbar-thumb { background:var(--border2); border-radius:3px; }
  .tg-nav-group { font-size:9px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; padding:16px 18px 7px; color:rgba(255,255,255,.38); }
  .tg-nav-item { position:relative; display:flex; align-items:center; gap:10px; padding:9px 12px 9px 14px; margin:2px 10px; border-radius:8px; cursor:pointer; transition:background .12s, color .12s, transform .12s; font-size:13px; color:rgba(255,255,255,.67); font-weight:650; border:1px solid transparent; background:none; width:calc(100% - 20px); text-align:left; }
  .tg-nav-item, .tg-nav-subitem { text-decoration:none; box-sizing:border-box; }
  .tg-nav-item:hover { background:rgba(255,255,255,.07); color:#fff; transform:translateX(2px); }
  .tg-nav-item.active { background:rgba(20,184,166,.14); color:#fff; border-color:rgba(20,184,166,.22); box-shadow:inset 3px 0 0 var(--accent-l); }
  .tg-nav-item-icon { width:18px; height:18px; flex-shrink:0; display:flex; align-items:center; justify-content:center; opacity:.9; color:var(--accent-xl); }
  .tg-nav-item-label { flex:1; }
  .tg-sidebar.collapsed .tg-brand-wordmark, .tg-sidebar.collapsed .tg-brand-pill, .tg-sidebar.collapsed .tg-nav-group, .tg-sidebar.collapsed .tg-nav-item-label, .tg-sidebar.collapsed .tg-nav-badge, .tg-sidebar.collapsed .tg-nav-chevron, .tg-sidebar.collapsed .tg-nav-sub, .tg-sidebar.collapsed .tg-sidebar-user-copy { display:none !important; }
  .tg-sidebar.collapsed .tg-sidebar-brand { padding:18px 12px 12px !important; }
  .tg-sidebar.collapsed .tg-brand-mark { display:flex !important; }
  .tg-sidebar.collapsed .tg-nav-item { width:44px; height:42px; margin:4px auto; padding:0; justify-content:center; border-radius:10px; }
  .tg-sidebar.collapsed .tg-sidebar-footer { padding:12px 10px !important; }
  .tg-sidebar.collapsed .tg-sidebar-footer > div { justify-content:center; }
  .tg-sidebar.collapsed .tg-sidebar-footer button { display:none !important; }
  .tg-nav-badge { font-size:9px; font-weight:800; padding:1px 6px; border-radius:4px; background:var(--bg4); color:var(--text5); letter-spacing:.04em; flex-shrink:0; }
  .tg-nav-item.active .tg-nav-badge { background:var(--accent-dim); color:var(--accent-xl); }
  .tg-nav-chevron { width:14px; height:14px; flex-shrink:0; transition:transform .18s; opacity:.4; }
  .tg-nav-chevron.open { transform:rotate(90deg); }
  .tg-nav-sub { overflow:hidden; margin:1px 12px 4px 22px; padding-left:9px; border-left:1px solid rgba(255,255,255,.08); }
  .tg-nav-subitem { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:7px; cursor:pointer; font-size:12px; color:rgba(255,255,255,.52); font-weight:600; transition:background .12s, color .12s; border:none; background:none; width:100%; text-align:left; }
  .tg-nav-subitem:hover { background:rgba(255,255,255,.06); color:rgba(255,255,255,.82); }
  .tg-nav-subitem.active { color:var(--accent-xl); background:rgba(20,184,166,.11); }
  .tg-nav-dot { width:5px; height:5px; border-radius:50%; background:var(--border2); flex-shrink:0; transition:background .12s; }
  .tg-nav-subitem.active .tg-nav-dot { background:var(--accent-l); box-shadow:0 0 6px rgba(20,184,166,.45); }
  .tg-topbar { height:58px; background:var(--topbar-bg); border-bottom:1px solid var(--border); display:flex; align-items:center; padding:0 20px 0 18px; gap:12px; flex-shrink:0; font-family:'DM Sans',sans-serif; box-shadow:0 8px 24px rgba(10,20,18,.035); backdrop-filter:blur(14px); }
  .tg-sidebar-toggle, .tg-mobile-menu-btn { width:34px; height:34px; border:1px solid var(--border2); border-radius:8px; background:var(--bg2); color:var(--text3); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all .15s; flex-shrink:0; }
  .tg-sidebar-toggle { margin:0 16px 10px; }
  .tg-sidebar.collapsed > .tg-sidebar-toggle { margin:0 auto 10px; }
  .tg-sidebar-toggle:hover, .tg-mobile-menu-btn:hover { border-color:var(--accent-l); color:var(--accent-xl); background:var(--accent-dim); }
  .tg-mobile-menu-btn { display:none; }
  .tg-sidebar-backdrop { display:none; }
  .tg-main { margin-left:252px; width:calc(100% - 252px); display:flex; flex-direction:column; height:100vh; overflow:hidden; background:var(--bg); }
  .tg-main.sidebar-collapsed { margin-left:76px; width:calc(100% - 76px); }
  .tg-content { flex:1; overflow-y:auto; overflow-x:hidden; background:radial-gradient(circle at 14% 0%, rgba(20,184,166,.10), transparent 28%), linear-gradient(180deg,var(--bg),var(--bg3)); display:flex; flex-direction:column; overscroll-behavior:contain; }
  .tg-content * { box-sizing:border-box; }
  .tg-content img, .tg-content svg, .tg-content canvas { max-width:100%; }
  .tg-content::-webkit-scrollbar { width:5px; }
  .tg-content::-webkit-scrollbar-track { background:transparent; }
  .tg-content::-webkit-scrollbar-thumb { background:var(--border2); border-radius:3px; }
  .tg-notif-dot { position:absolute; top:3px; right:3px; width:7px; height:7px; background:var(--red); border-radius:50%; border:2px solid var(--topbar-bg); }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
  @media (max-width: 1180px) {
    .tg-topbar { padding:0 12px; gap:8px; }
    .tg-topbar-tabs { flex:1 1 auto !important; max-width:42vw; }
    .tg-content {
      overflow-x:hidden;
    }
    .tg-content > div {
      padding-left:18px !important;
      padding-right:18px !important;
      max-width:100% !important;
      min-width:0 !important;
    }
    .tg-content * {
      box-sizing:border-box;
      min-width:0;
    }
    .tg-content [style*="display: flex"],
    .tg-content [style*="display:flex"] {
      flex-wrap:wrap;
    }
    .tg-content [style*="margin-left: auto"],
    .tg-content [style*="marginLeft:auto"] {
      margin-left:0 !important;
    }
    .tg-content input,
    .tg-content select,
    .tg-content textarea {
      min-width:0 !important;
      max-width:100% !important;
    }
    .tg-content table {
      display:block;
      width:100% !important;
      max-width:100% !important;
      overflow-x:auto;
      white-space:nowrap;
    }
  }
  @media (max-width: 1024px) {
    .tg-mobile-menu-btn { display:flex; }
    .tg-sidebar-toggle { display:none; }
    .tg-sidebar, .tg-sidebar.collapsed { width:min(86vw, 316px); transform:translateX(-105%); z-index:80; }
    .tg-sidebar.mobile-open { transform:translateX(0); }
    .tg-sidebar.collapsed .tg-brand-wordmark, .tg-sidebar.collapsed .tg-brand-pill, .tg-sidebar.collapsed .tg-nav-group, .tg-sidebar.collapsed .tg-nav-item-label, .tg-sidebar.collapsed .tg-nav-badge, .tg-sidebar.collapsed .tg-nav-chevron, .tg-sidebar.collapsed .tg-sidebar-user-copy { display:flex !important; }
    .tg-sidebar.collapsed .tg-nav-group { display:block !important; }
    .tg-sidebar.collapsed .tg-nav-sub { display:block !important; }
    .tg-sidebar.collapsed .tg-sidebar-footer button { display:flex !important; }
    .tg-sidebar.collapsed .tg-brand-mark { display:none !important; }
    .tg-sidebar.collapsed .tg-sidebar-brand { padding:20px 16px 16px !important; }
    .tg-sidebar.collapsed .tg-nav-item { width:calc(100% - 20px); height:auto; margin:2px 10px; padding:9px 12px 9px 14px; justify-content:flex-start; }
    .tg-sidebar-backdrop.mobile-open { display:block; position:fixed; inset:0; z-index:70; background:rgba(6,12,10,.58); backdrop-filter:blur(2px); }
    .tg-main, .tg-main.sidebar-collapsed { margin-left:0; width:100%; }
    .tg-topbar-tabs { display:none !important; }
    .tg-topbar-breadcrumb { min-width:0; }
    .tg-topbar-breadcrumb .tg-brand-breadcrumb { display:none; }
    .tg-current-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tg-content { min-width:0; }
  }
  @media (max-width: 640px) {
    .tg-topbar { height:54px; }
    .tg-user-meta { display:none; }
    .tg-user-chip { padding:3px !important; }
    .tg-current-label { max-width:48vw; }
    .tg-main, .tg-main.sidebar-collapsed, .tg-content {
      width:100% !important;
      max-width:100vw !important;
      min-width:0 !important;
      overflow-x:hidden !important;
    }
    .tg-content {
      box-sizing:border-box;
      padding-bottom:84px;
    }
    .tg-content * {
      box-sizing:border-box;
      min-width:0;
    }
    .tg-content > * {
      width:100% !important;
      max-width:100vw !important;
    }
    .tg-content [style*="display: flex"],
    .tg-content [style*="display:flex"] {
      max-width:100%;
    }
    .tg-content [style*="width: min("],
    .tg-content [style*="width:min("] {
      width:100% !important;
      max-width:calc(100vw - 24px) !important;
    }
    .tg-content [style*="min-width"],
    .tg-content [style*="minWidth"] {
      min-width:0 !important;
    }
    .tg-content input,
    .tg-content select,
    .tg-content textarea {
      width:100% !important;
      max-width:100% !important;
      min-width:0 !important;
    }
    .tg-content button {
      max-width:100%;
      white-space:normal;
    }
    .tg-content table {
      display:block;
      width:100% !important;
      max-width:100% !important;
      overflow-x:auto;
      white-space:nowrap;
    }
    .tg-content th,
    .tg-content td {
      white-space:nowrap;
    }
  }
  @media (max-width: 860px) {
    .tg-agenda-page { padding:16px !important; }
    .tg-agenda-shell { grid-template-columns:1fr !important; }
    .tg-agenda-filters { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px !important; align-items:stretch !important; }
    .tg-agenda-filters > input,
    .tg-agenda-filters > select,
    .tg-agenda-filters > button,
    .tg-agenda-filters > label { width:100% !important; margin-left:0 !important; }
    .tg-agenda-calendar-head,
    .tg-agenda-calendar-grid { grid-template-columns:repeat(7,minmax(34px,1fr)) !important; gap:5px !important; }
    .tg-agenda-day { min-height:64px !important; padding:7px !important; }
    .tg-agenda-day-events { display:none !important; }
    .tg-agenda-detail { grid-template-columns:1fr !important; }
  }
  @media (max-width: 560px) {
    .tg-agenda-page { padding:14px 12px !important; }
    .tg-agenda-filters { grid-template-columns:1fr !important; }
    .tg-agenda-calendar-head,
    .tg-agenda-calendar-grid { gap:3px !important; }
    .tg-agenda-calendar-head > div { font-size:9px !important; letter-spacing:0 !important; }
    .tg-agenda-day { min-height:48px !important; padding:5px !important; border-radius:8px !important; }
    .tg-agenda-day-count { font-size:9px !important; padding:1px 5px !important; }
    .tg-agenda-title { font-size:20px !important; line-height:1.1 !important; }
  }
  @media (max-width: 900px) {
    .tg-traffic-page { height:auto !important; min-height:calc(100dvh - 54px); overflow:visible !important; }
    .tg-traffic-tabs,
    .tg-traffic-legend,
    .tg-traffic-weeknav { overflow-x:auto; overflow-y:hidden; flex-wrap:nowrap !important; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }
    .tg-traffic-tabs > *,
    .tg-traffic-legend > *,
    .tg-traffic-weeknav > * { flex:0 0 auto; }
    .tg-traffic-summary { grid-template-columns:repeat(2,minmax(142px,1fr)) !important; overflow-x:auto; }
    .tg-traffic-filters { display:grid !important; grid-template-columns:1fr !important; }
    .tg-traffic-filters input,
    .tg-traffic-filters select,
    .tg-traffic-filters button { width:100% !important; min-width:0 !important; }
    .tg-traffic-board { flex:0 0 auto !important; min-height:420px; max-height:calc(100dvh - 260px); overflow:auto !important; -webkit-overflow-scrolling:touch; }
    .tg-traffic-board table { display:table !important; width:max-content !important; min-width:1266px !important; max-width:none !important; }
  }
  .tg-responsive-page { width:100%; max-width:100%; min-width:0; overflow-x:hidden; }
  .tg-responsive-page > * { min-width:0; }
  .tg-responsive-scroll { overflow:auto; -webkit-overflow-scrolling:touch; }
  .tg-modal-backdrop { overscroll-behavior:contain; }
  .tg-control-map-card { max-width:calc(100% - 28px); }
  @media (max-width: 1100px) {
    .tg-responsive-page [style*="grid-template-columns: repeat(4"],
    .tg-responsive-page [style*="grid-template-columns:repeat(4"] {
      grid-template-columns:repeat(2,minmax(0,1fr)) !important;
    }
    .tg-responsive-page [style*="grid-template-columns: repeat(3"],
    .tg-responsive-page [style*="grid-template-columns:repeat(3"] {
      grid-template-columns:repeat(2,minmax(0,1fr)) !important;
    }
  }
  @media (max-width: 820px) {
    .tg-responsive-page {
      padding:16px !important;
      min-height:auto !important;
    }
    .tg-responsive-page h1,
    .tg-responsive-page [style*="font-size: 42"],
    .tg-responsive-page [style*="fontSize:42"] {
      font-size:clamp(24px, 9vw, 34px) !important;
      line-height:1.08 !important;
    }
    .tg-responsive-page [style*="grid-template-columns: 1fr 1fr"],
    .tg-responsive-page [style*="grid-template-columns:1fr 1fr"],
    .tg-responsive-page [style*="grid-template-columns: repeat(2"],
    .tg-responsive-page [style*="grid-template-columns:repeat(2"],
    .tg-responsive-page [style*="grid-template-columns: repeat(3"],
    .tg-responsive-page [style*="grid-template-columns:repeat(3"],
    .tg-responsive-page [style*="grid-template-columns: repeat(4"],
    .tg-responsive-page [style*="grid-template-columns:repeat(4"],
    .tg-responsive-page [style*="grid-template-columns: minmax(0,1fr) 360px"],
    .tg-responsive-page [style*="grid-template-columns: minmax(0, 1fr) 360px"],
    .tg-responsive-page [style*="grid-template-columns: minmax(0px, 1fr) 360px"] {
      grid-template-columns:1fr !important;
    }
    .tg-responsive-page [style*="display: flex"],
    .tg-responsive-page [style*="display:flex"] {
      flex-wrap:wrap;
    }
    .tg-responsive-page input,
    .tg-responsive-page select,
    .tg-responsive-page textarea,
    .tg-responsive-page button {
      max-width:100% !important;
    }
    .tg-responsive-page table {
      display:block !important;
      width:100% !important;
      max-width:100% !important;
      min-width:0 !important;
      overflow-x:auto;
      white-space:nowrap;
    }
    .tg-responsive-page table > thead,
    .tg-responsive-page table > tbody,
    .tg-responsive-page table > tfoot {
      display:table;
      width:100%;
      min-width:760px;
    }
    .tg-responsive-page [style*="overflow-x: auto"],
    .tg-responsive-page [style*="overflowX:auto"] {
      -webkit-overflow-scrolling:touch;
    }
    .tg-modal-backdrop {
      align-items:flex-start !important;
      justify-content:center !important;
      padding:10px !important;
      overflow:auto !important;
    }
    .tg-modal-shell {
      width:100% !important;
      max-width:calc(100vw - 20px) !important;
      max-height:calc(100dvh - 20px) !important;
      padding:18px !important;
    }
    .tg-responsive-page [style*="position: fixed"][style*="inset: 0"] {
      align-items:flex-start !important;
      justify-content:center !important;
      padding:10px !important;
      overflow:auto !important;
    }
    .tg-responsive-page [style*="position: fixed"][style*="inset: 0"] > div {
      width:100% !important;
      max-width:calc(100vw - 20px) !important;
      max-height:calc(100dvh - 20px) !important;
      overflow:auto !important;
    }
    .tg-rutas-filters {
      grid-template-columns:repeat(2,minmax(0,1fr)) !important;
    }
  }
  @media (max-width: 560px) {
    .tg-responsive-page {
      padding:14px 12px !important;
    }
    .tg-responsive-page [style*="gap: 18"],
    .tg-responsive-page [style*="gap:18"],
    .tg-responsive-page [style*="gap: 20"],
    .tg-responsive-page [style*="gap:20"],
    .tg-responsive-page [style*="gap: 24"],
    .tg-responsive-page [style*="gap:24"] {
      gap:10px !important;
    }
    .tg-responsive-page table {
      min-width:0 !important;
    }
    .tg-responsive-page table > thead,
    .tg-responsive-page table > tbody,
    .tg-responsive-page table > tfoot {
      min-width:680px;
    }
    .tg-control-map-card {
      left:10px !important;
      right:10px !important;
      bottom:10px !important;
      width:auto !important;
      max-width:none !important;
    }
    .tg-modal-shell {
      padding:14px !important;
    }
    .tg-rutas-filters {
      grid-template-columns:1fr !important;
    }
    .tg-rutas-filters > * {
      width:100% !important;
      min-width:0 !important;
    }
  }
`;

function NavItem({ item, vistaActiva, setVista, avisosCriticos, clientesPendientes = 0, tallerPendientes = 0, vehiculoAlertas = 0, solicitudesPendientes = 0, excepcionesPendientes = 0, colaboradoresPendientes = 0 }) {
  const hasChildren = item.children?.length > 0;
  const childActive = hasChildren && item.children.some(c => c.id === vistaActiva);
  const isActive    = vistaActiva === item.id;
  const [open, setOpen] = useState(childActive || isActive);

  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  function handleClick() {
    if (hasChildren) {
      setOpen(o => !o);
    } else if (item.href) {
      return;
    } else {
      setVista(item.id);
    }
  }

  const isAvisos    = item.id === "avisos";
  const isClientes  = item.id === "clientes";
  const isTaller    = item.id === "taller";
  const isVehiculos = item.id === "vehiculos";
  const isSolicitudes = item.id === "solicitudes";
  const isExcepciones = item.id === "excepciones";
  const isColaboradores = item.id === "colaboradores";
  const showBadge         = isAvisos    && avisosCriticos > 0;
  const showClientesBadge = isClientes  && clientesPendientes > 0;
  const showTallerBadge   = isTaller    && tallerPendientes > 0;
  const showVehBadge      = isVehiculos && vehiculoAlertas > 0;
  const showSolicitudesBadge = isSolicitudes && solicitudesPendientes > 0;
  const showExcepcionesBadge = isExcepciones && excepcionesPendientes > 0;
  const showColaboradoresBadge = isColaboradores && colaboradoresPendientes > 0;

  return (
    <>
      {item.href && !hasChildren ? (
        <a
          className={`tg-nav-item ${(isActive || (hasChildren && childActive)) ? "active" : ""}`}
          href={item.href}
          title={item.label}
          target={item.external ? "_blank" : undefined}
          rel={item.external ? "noopener noreferrer" : undefined}
        >
          <span className="tg-nav-item-icon">{item.icon}</span>
          <span className="tg-nav-item-label">{item.label}</span>
        </a>
      ) : (
      <button
        className={`tg-nav-item ${(isActive || (hasChildren && childActive)) ? "active" : ""}`}
        onClick={handleClick}
        title={item.label}
      >
        <span className="tg-nav-item-icon">{item.icon}</span>
        <span className="tg-nav-item-label">{item.label}</span>
        {showBadge && (
          <span style={{ fontSize:9, fontWeight:800, padding:"1px 6px", borderRadius:20,
                         background:"rgba(240,82,82,.15)", color:"#f05252", flexShrink:0 }}>
            {avisosCriticos}
          </span>
        )}
        {showClientesBadge && (
          <span style={{ fontSize:9, fontWeight:800, padding:"2px 6px", borderRadius:20,
                         background:"rgba(251,191,36,.2)", color:"#f59e0b",
                         flexShrink:0, animation:"pulse 2s infinite" }}>
            {clientesPendientes}
          </span>
        )}
        {showTallerBadge && (
          <span style={{ fontSize:9, fontWeight:800, padding:"2px 6px", borderRadius:20,
                         background:"rgba(239,68,68,.15)", color:"#ef4444", flexShrink:0 }}>
            {tallerPendientes}
          </span>
        )}
        {showVehBadge && (
          <span style={{ fontSize:9, fontWeight:800, padding:"2px 6px", borderRadius:20,
                         background:"rgba(245,158,11,.2)", color:"#f59e0b", flexShrink:0 }}>
            {vehiculoAlertas}
          </span>
        )}
        {showSolicitudesBadge && (
          <span style={{ fontSize:9, fontWeight:900, padding:"2px 6px", borderRadius:20,
                         background:"rgba(20,184,166,.18)", color:"#5eead4",
                         flexShrink:0, animation:"pulse 2s infinite" }}>
            {solicitudesPendientes}
          </span>
        )}
        {showExcepcionesBadge && (
          <span style={{ fontSize:9, fontWeight:900, padding:"2px 6px", borderRadius:20,
                         background:"rgba(239,68,68,.18)", color:"#ef4444", flexShrink:0 }}>
            {excepcionesPendientes}
          </span>
        )}
        {showColaboradoresBadge && (
          <span style={{ fontSize:9, fontWeight:900, padding:"2px 6px", borderRadius:20,
                         background:"rgba(245,158,11,.2)", color:"#f59e0b",
                         flexShrink:0, animation:"pulse 2s infinite" }}>
            {colaboradoresPendientes}
          </span>
        )}
        {item.badge && !showBadge && !showClientesBadge && !showSolicitudesBadge && !showExcepcionesBadge && !showColaboradoresBadge && (
          <span className="tg-nav-badge">B{item.badge}</span>
        )}
        {hasChildren && (
          <svg className={`tg-nav-chevron ${open?"open":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </button>
      )}

      {hasChildren && open && (
        <div className="tg-nav-sub">
          {item.children.map(sub => (
            sub.href ? (
            <a
              key={sub.id}
              className={`tg-nav-subitem ${vistaActiva === sub.id ? "active" : ""}`}
              href={sub.href}
              target={sub.external ? "_blank" : undefined}
              rel={sub.external ? "noopener noreferrer" : undefined}
            >
              <span className="tg-nav-dot"/>
              <span style={{flex:1}}>{sub.label}</span>
            </a>
            ) : (
            <button
              key={sub.id}
              className={`tg-nav-subitem ${vistaActiva === sub.id ? "active" : ""}`}
              onClick={() => setVista(sub.id)}
            >
              <span className="tg-nav-dot"/>
              <span style={{flex:1}}>{sub.label}</span>
                {sub.id === "excepciones" && excepcionesPendientes > 0 && (
                  <span style={{ fontSize:9, fontWeight:900, padding:"1px 6px", borderRadius:20,
                                 background:"rgba(239,68,68,.18)", color:"#ef4444", flexShrink:0 }}>
                    {excepcionesPendientes}
                  </span>
                )}
            </button>
            )
          ))}
        </div>
      )}
    </>
  );
}

export default function Layout({ children, vistaActiva, setVista, modulos, avisosCriticos = 0, clientesPendientes = 0, tallerPendientes = 0, vehiculoAlertas = 0, solicitudesPendientes = 0, excepcionesPendientes = 0, colaboradoresPendientes = 0 }) {
  // Roles que usan pantalla completa sin sidebar (móvil-first)
  const { user, logout } = useAuth();
  const { toggle, isDark } = useTheme();
  const brandDisplayName = getBrandDisplayName(getEmpresaPlanLocal());
  const [appMeta, setAppMeta] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("tg_sidebar_collapsed") === "1"; } catch { return false; }
  });
  const versionLabel = getBrandVersionLabel(appMeta);
  const [tabs, setTabs] = useState(() => {
    const defaultId = vistaActiva || "dashboard";
    return [{ id: defaultId, label: getLabelForId(defaultId, modulos) }];
  });
  const [activeTab, setActiveTab] = useState(vistaActiva);
  const FULLSCREEN_ROLES = ["chofer", "cliente"];
  // Sync tabs when vista changes externally
  useEffect(() => {
    if (!vistaActiva) return;
    setActiveTab(vistaActiva);
    setTabs(prev => {
      if (prev.some(t => t.id === vistaActiva)) return prev;
      const label = getLabelForId(vistaActiva, modulos);
      return [...prev, { id: vistaActiva, label }];
    });
  }, [vistaActiva, modulos]);

  useEffect(() => {
    getPublicAppMeta().then(setAppMeta).catch(() => {});
  }, []);

  useEffect(() => {
    try { localStorage.setItem("tg_sidebar_collapsed", sidebarCollapsed ? "1" : "0"); } catch {}
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [vistaActiva]);

  if (user && FULLSCREEN_ROLES.includes(user.rol)) {
    return (
      <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Sans',sans-serif" }}>
        {children}
      </div>
    );
  }

  function getLabelForId(id, mods) {
    for (const g of (mods || [])) {
      for (const item of g.items) {
        if (item.id === id) return item.label;
        if (item.children) {
          const sub = item.children.find(c => c.id === id);
          if (sub) return sub.label;
        }
      }
    }
    return id;
  }

  function handleSetVista(id) {
    setVista(id);
    setMobileMenuOpen(false);
  }

  function closeTab(tabId) {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId);
      if (activeTab === tabId && next.length > 0) {
        const lastTab = next[next.length - 1];
        setActiveTab(lastTab.id);
        setVista(lastTab.id);
      }
      return next;
    });
  }

  function activateTab(tabId) {
    setActiveTab(tabId);
    setVista(tabId);
    setMobileMenuOpen(false);
  }

  // Get current label for breadcrumb
  const currentLabel = getLabelForId(vistaActiva, modulos);

  return (
    <>
      <style>{CSS}</style>
      <div style={{ height:"100vh", overflow:"hidden" }}>

        {/* ══════════ SIDEBAR ══════════ */}
        <div className={`tg-sidebar-backdrop ${mobileMenuOpen ? "mobile-open" : ""}`} onClick={() => setMobileMenuOpen(false)} />
        <div className={`tg-sidebar ${sidebarCollapsed ? "collapsed" : ""} ${mobileMenuOpen ? "mobile-open" : ""}`}>
          {/* Logo */}
          <div className="tg-sidebar-brand" style={{ padding:"20px 16px 16px", borderBottom:"1px solid rgba(255,255,255,.08)", flexShrink:0 }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:5 }}>
              <div className="tg-brand-mark" style={{
                display:"none",
                width:38,
                height:38,
                borderRadius:10,
                background:"rgba(20,184,166,.18)",
                border:"1px solid rgba(94,234,212,.18)",
                alignItems:"center",
                justifyContent:"center",
                color:"#ccfbf1",
                fontSize:15,
                fontWeight:900,
                fontFamily:"'Syne',sans-serif",
              }}>
                TG
              </div>
              <img
                className="tg-brand-wordmark"
                src={transgestLogoWhite}
                alt={brandDisplayName}
                style={{ width:"100%", maxWidth:182, height:"auto", display:"block" }}
              />
              <div className="tg-brand-pill" style={{
                display:"inline-flex",
                alignItems:"center",
                minHeight:24,
                padding:"0 10px",
                borderRadius:999,
                background:"rgba(20,184,166,.14)",
                border:"1px solid rgba(94,234,212,.18)",
                color:"rgba(204,251,241,.9)",
                fontSize:10,
                fontWeight:900,
                letterSpacing:0,
              }}>
                {brandDisplayName} · {versionLabel}
              </div>
            </div>
          </div>

              <button
                className="tg-sidebar-toggle"
                type="button"
                title={sidebarCollapsed ? "Expandir menu" : "Plegar menu"}
                onClick={() => setSidebarCollapsed(v => !v)}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {sidebarCollapsed
                    ? <><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></>
                    : <><line x1="5" y1="6" x2="19" y2="6"/><line x1="5" y1="12" x2="15" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/></>
                  }
                </svg>
              </button>

          {/* Nav */}
          <div className="tg-sidebar-scroll">
            {modulos.map(grupo => (
              <div key={grupo.titulo}>
                <div className="tg-nav-group" style={{ color: GRUPO_COLOR[grupo.titulo] ? `${GRUPO_COLOR[grupo.titulo]}99` : "var(--text5)" }}>
                  {grupo.titulo}
                </div>
                {grupo.items.map(item => (
                  <NavItem
                    key={item.id}
                    item={item}
                    vistaActiva={vistaActiva}
                    setVista={handleSetVista}
                    avisosCriticos={avisosCriticos}
                    clientesPendientes={clientesPendientes}
                    tallerPendientes={tallerPendientes}
                    vehiculoAlertas={vehiculoAlertas}
                    solicitudesPendientes={solicitudesPendientes}
                    excepcionesPendientes={excepcionesPendientes}
                    colaboradoresPendientes={colaboradoresPendientes}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* User footer */}
          <div className="tg-sidebar-footer" style={{ padding:"12px 14px", borderTop:"1px solid rgba(255,255,255,.08)", flexShrink:0, background:"rgba(255,255,255,.025)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:9 }}>
              <div style={{
                width:30, height:30, borderRadius:7, flexShrink:0,
                background: ROL_COLOR[user?.rol] || "#0f766e",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:11, fontWeight:800, color:"#fff", fontFamily:"'Syne',sans-serif",
              }}>
                {user?.nombre?.slice(0,2)?.toUpperCase() || "??"}
              </div>
              <div className="tg-sidebar-user-copy" style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:"#ffffff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {user?.nombre?.split(" ")[0]}
                </div>
                <div style={{ fontSize:10, color:ROL_COLOR[user?.rol]||"#14b8a6", fontWeight:700 }}>{ROL_LABEL[user?.rol]}</div>
              </div>
              <button onClick={logout} title="Cerrar sesión"
                style={{ background:"none", border:"none", padding:4, cursor:"pointer", color:"rgba(255,255,255,0.5)",
                         borderRadius:5, transition:"color .15s" }}
                onMouseEnter={e=>e.currentTarget.style.color="#f05252"}
                onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.5)"}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ══════════ MAIN AREA ══════════ */}
        <div className={`tg-main ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>

          {/* Topbar */}
          <div className="tg-topbar">
            <button
              className="tg-mobile-menu-btn"
              type="button"
              title="Abrir menu"
              onClick={() => setMobileMenuOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
              </svg>
            </button>
            {/* Breadcrumb */}
            <div className="tg-topbar-breadcrumb" style={{ flex:1, display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--text4)" }}>
              <span className="tg-brand-breadcrumb" style={{ color:"var(--text4)" }}>{BRAND_NAME}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              <span className="tg-current-label" style={{ color:"var(--accent-xl)", fontWeight:600 }}>{currentLabel}</span>
            </div>

            {/* Tabs de navegación rápida */}
            <div className="tg-topbar-tabs" style={{ display:"flex", gap:2, alignItems:"center", flex:2, overflowX:"auto", padding:"0 4px" }}>
              {tabs.map(tab => (
                <div key={tab.id} style={{ display:"flex", alignItems:"center", flexShrink:0 }}>
                  <button
                    onClick={() => activateTab(tab.id)}
                    style={{
                      padding:"4px 10px", borderRadius:"5px 5px 0 0", border:"none",
                      background: activeTab===tab.id ? "var(--accent-dim)" : "transparent",
                      color: activeTab===tab.id ? "var(--accent-xl)" : "var(--text4)",
                      fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"'DM Sans',sans-serif",
                      display:"flex", alignItems:"center", gap:5, transition:"all .12s",
                    }}>
                    {tab.label}
                    {tab.id !== "dashboard" && (
                      <span
                        onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                        style={{ width:14, height:14, display:"flex", alignItems:"center", justifyContent:"center",
                                 borderRadius:3, color:"var(--text4)", cursor:"pointer", fontSize:10,
                                 lineHeight:1 }}
                        onMouseEnter={e=>e.currentTarget.style.color="#f05252"}
                        onMouseLeave={e=>e.currentTarget.style.color="var(--text4)"}>
                        ✕
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>

            {/* Bell + user */}
            <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
              {/* Theme toggle */}
              <button
                onClick={toggle}
                title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                style={{
                  background:"none", border:"1px solid var(--border2)", borderRadius:7,
                  width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center",
                  cursor:"pointer", color:"var(--text3)", transition:"all .15s", flexShrink:0,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor="var(--accent-l)"; e.currentTarget.style.color="var(--accent-xl)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border2)"; e.currentTarget.style.color="var(--text3)"; }}
              >
                {isDark
                  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                  : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                }
              </button>
              <div style={{ position:"relative", cursor:"pointer", padding:5 }} onClick={() => setVista("avisos")}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color:"var(--text4)" }}>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {avisosCriticos > 0 && <div className="tg-notif-dot"/>}
              </div>
              <div className="tg-user-chip" style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer", padding:"3px 6px",
                            borderRadius:7, border:"1px solid var(--border)" }}>
                <div style={{
                  width:24, height:24, borderRadius:6, flexShrink:0,
                  background: ROL_COLOR[user?.rol] || "#0f766e",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:9, fontWeight:800, color:"#fff", fontFamily:"'Syne',sans-serif",
                }}>
                  {user?.nombre?.slice(0,2)?.toUpperCase() || "??"}
                </div>
                <div className="tg-user-meta">
                  <div style={{ fontSize:12, fontWeight:600, color:"var(--text)", lineHeight:1.2 }}>{user?.nombre?.split(" ")[0]}</div>
                  <div style={{ fontSize:9, color:"var(--text5)", textTransform:"capitalize" }}>{ROL_LABEL[user?.rol]}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="tg-content">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
