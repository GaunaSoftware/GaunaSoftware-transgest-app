import { useState, lazy, Suspense, useEffect, useRef } from "react";
import OnboardingWizard from "./components/OnboardingWizard";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import ToastProvider from "./components/ToastProvider";
import MojibakeFixer from "./components/MojibakeFixer";
import Login  from "./pages/Login";
import Layout from "./components/Layout";
import Bloqueado from "./pages/Bloqueado";
import { getAccountingLaunch, getDocsProximosVencer, getClientesPendientesRevision, getColaboradoresPendientesRevision, getAlertasDocVehiculos, getTallerEstado, getExcepcionesOperativas, getNotificaciones, getPortalSolicitudesAdmin, getAvisosOperativosColaboradores, crearAgendaAvisoOperativoColaborador, ignorarAvisoOperativoColaborador, getAgendaEventos, getEmpresaBackend, saveEmpresa, getDemoOptions, switchDemoPlan, switchDemoUser, cambiarPassword } from "./services/api";
import { clearRuntimeFocus, setRuntimeFocus } from "./services/runtimeFocus";
import { getEmpresaPlanLocal, normalizePlan } from "./utils/planFeatures";
import { saveCompanyPalette } from "./utils/companyPalette";

// Carga perezosa de todos los mÃƒÂ³dulos
const Dashboard    = lazy(() => import("./pages/Dashboard"));
const ControlTower = lazy(() => import("./pages/ControlTower"));
const Clientes     = lazy(() => import("./pages/Clientes"));
const Pedidos      = lazy(() => import("./pages/Pedidos"));
const Rutas        = lazy(() => import("./pages/Rutas"));
const CalculadorPortes = lazy(() => import("./pages/CalculadorPortes"));
const Vehiculos    = lazy(() => import("./pages/Vehiculos"));
const Choferes     = lazy(() => import("./pages/Choferes"));
const Colaboradores= lazy(() => import("./pages/Colaboradores"));
const Facturacion  = lazy(() => import("./pages/Facturacion"));
const Contabilidad = lazy(() => import("./pages/Contabilidad"));
const Informes     = lazy(() => import("./pages/Informes"));
const Excepciones  = lazy(() => import("./pages/Excepciones"));
const Documentos   = lazy(() => import("./pages/Documentos"));
const Avisos       = lazy(() => import("./pages/Avisos"));
const Actividad    = lazy(() => import("./pages/Actividad"));
const Usuarios     = lazy(() => import("./pages/Usuarios"));
const Taller              = lazy(() => import("./pages/Taller"));
const Explotacion         = lazy(() => import("./pages/Explotacion"));
const CuadranteVehiculos  = lazy(() => import("./pages/CuadranteVehiculos"));
const CuadranteChoferes   = lazy(() => import("./pages/CuadranteChoferes"));
const Empresa             = lazy(() => import("./pages/Empresa"));
const HojasRuta           = lazy(() => import("./pages/HojasRuta"));
const GastosEstructura    = lazy(() => import("./pages/GastosEstructura"));
const ControlHorario      = lazy(() => import("./pages/ControlHorario"));
const GestionTrafico      = lazy(() => import("./pages/GestionTrafico"));
const PlanificacionOperativa = lazy(() => import("./pages/PlanificacionOperativa"));
const Nominas             = lazy(() => import("./pages/Nominas"));
const AppChofer           = lazy(() => import("./pages/AppChofer"));
const AppMecanico         = lazy(() => import("./pages/AppMecanico"));
const PortalClientes      = lazy(() => import("./pages/PortalClientes"));
const Solicitudes         = lazy(() => import("./pages/Solicitudes"));
const MiCuenta            = lazy(() => import("./pages/MiCuenta"));
const Registro            = lazy(() => import("./pages/Registro"));
const Invitacion          = lazy(() => import("./pages/Invitacion"));
const SuperAdmin          = lazy(() => import("./pages/SuperAdmin"));
const Tarifas             = lazy(() => import("./pages/Tarifas"));
const Objetivos           = lazy(() => import("./pages/Objetivos"));
const Importacion         = lazy(() => import("./pages/Importacion"));
const Palets              = lazy(() => import("./pages/Palets"));
const WebPublica          = lazy(() => import("./pages/WebPublica"));
const Agenda             = lazy(() => import("./pages/Agenda"));
const transgestLogoWhite = require("./assets/brand/transgest_logo_white.svg").default;

function Spinner() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                  height:"100%", color:"#3d4f72", fontSize:13, fontFamily:"'DM Sans',sans-serif" }}>
      Cargando modulo...
    </div>
  );
}

function LaunchSplash({ rol = "" }) {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const show = () => {
      setStep(0);
      setLeaving(false);
      setVisible(true);
    };
    window.addEventListener("tms:launch-splash", show);
    return () => window.removeEventListener("tms:launch-splash", show);
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const steps = [
      setTimeout(() => setStep(1), 850),
      setTimeout(() => setStep(2), 1650),
    ];
    const t1 = setTimeout(() => setLeaving(true), 2600);
    const t2 = setTimeout(() => setVisible(false), 3050);
    return () => {
      steps.forEach(clearTimeout);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible]);

  if (!visible) return null;
  const messagesByRole = {
    chofer: ["Inicializando tacografo", "Cargando viajes asignados", "Preparando app del chofer"],
    gerente: ["Iniciando procesos", "Cargando control operativo", "Preparando dashboard"],
    trafico: ["Cargando trafico", "Sincronizando cuadrante", "Preparando plan diario"],
    contable: ["Iniciando contabilidad", "Revisando facturas y cobros", "Preparando dashboard"],
    administrativo: ["Iniciando administracion", "Revisando documentos", "Preparando agenda"],
    responsable_taller: ["Iniciando taller", "Revisando vehiculos y avisos", "Preparando agenda"],
  };
  const messages = messagesByRole[rol] || ["Iniciando modulos", "Cargando datos", "Preparando inicio"];
  return (
    <>
      <style>{`
        @keyframes tgSplashLogo {
          from { opacity:.72; transform:translateY(6px) scale(.98); }
          to { opacity:1; transform:translateY(0) scale(1); }
        }
      `}</style>
      <div style={{
        position:"fixed",
        inset:0,
        zIndex:9999,
        display:"flex",
        alignItems:"center",
        justifyContent:"center",
        background:"linear-gradient(180deg,#071411,#13231f)",
        opacity:leaving ? 0 : 1,
        transition:"opacity .45s ease",
        pointerEvents:"none",
      }}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,animation:"tgSplashLogo .55s ease both"}}>
          <img src={transgestLogoWhite} alt="TransGest" style={{width:260,maxWidth:"58vw",height:"auto",display:"block"}} />
          <div style={{minHeight:34,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
            <div style={{fontSize:11,fontWeight:900,letterSpacing:0,color:"rgba(204,251,241,.78)",fontFamily:"'DM Sans',sans-serif"}}>
              {messages[step] || messages[0]}...
            </div>
            <div style={{width:160,height:3,borderRadius:999,background:"rgba(204,251,241,.16)",overflow:"hidden"}}>
              <div style={{width:`${(step + 1) * 34}%`,height:"100%",borderRadius:999,background:"#14b8a6",transition:"width .45s ease"}} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
const IC = {
  dashboard:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  cuadrante:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  pedidos:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  rutas:       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>,
  clientes:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>,
  colabor:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  vehiculos:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  choferes:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
  taller:      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  explotacion: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  facturacion: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  rendimiento: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  docs:        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  avisos:      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  empresa:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="12"/></svg>,
  usuarios:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><circle cx="18" cy="8" r="3"/><path d="M21 13c1.6.7 3 2 3 3.5V20"/></svg>,
  agenda:      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><path d="M8 15h4M8 18h8"/></svg>,
  tower:       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8"/><path d="M12 12l5-5"/><path d="M12 4v2M20 12h-2M12 20v-2M4 12h2"/></svg>,
  almacen:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-5 9 5v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/><path d="M9 21v-8h6v8"/></svg>,
  calculadora: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 10h2M12 10h2M16 10h.01M8 14h2M12 14h2M16 14h.01M8 18h2M12 18h4"/></svg>,
  hojaRuta:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-12"/><path d="M6 6h.01M18 18h.01"/><path d="M7 6c5 0 5 12 10 12"/></svg>,
  nominas:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/></svg>,
  contabilidad:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18"/><path d="M4 10h16"/><path d="M5 10l7-7 7 7"/><path d="M7 10v8M12 10v8M17 10v8"/></svg>,
  importacion: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2"/></svg>,
  actividad:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h16M4 12h10M4 19h16"/><circle cx="18" cy="12" r="2"/></svg>,
};

// Ã¢â€â‚¬Ã¢â€â‚¬ MÃƒÂ³dulos permitidos por plan Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// basico: operaciones esenciales sin KPIs ni app chÃƒÂ³fer
// profesional: todo menos app chÃƒÂ³fer / portal
// enterprise (Fleet): todo
// basico: operaciones generales, sin IA, sin gestion/optimizacion de rutas ni KPIs avanzados
// profesional: incluye rutas/HERE y KPIs avanzados
// enterprise: incluye todo
// Matriz efectiva: Lite=minimo DCD, Basico=trafico core, Profesional=avanzado sin IA, Enterprise=todo.
const MODULOS_POR_PLAN = {
    lite: [
      "app_chofer",
      "clientes",
      "rutas",
      "pedidos",
      "mi_cuenta"
    ],
    basico: [
      "dashboard","control_tower","agenda","pedidos","plan_diario","gestion_trafico","calculador_portes","palets","app_chofer",
      "clientes","rutas","vehiculos","choferes","grupajes","solicitudes",
      "hojas_ruta","control_horario","documentos","avisos","facturacion","empresa",
      "usuarios","mi_cuenta",
      "cuadrante_grupo","cuadrante_vehiculos","cuadrante_choferes","cuadrante_semana",
      "facturacion_grupo"
    ],
    profesional: [
      "dashboard","control_tower","agenda","pedidos","plan_diario","gestion_trafico","rutas_recomendadas","calculador_portes","palets","app_chofer",
      "clientes","tarifas","colaboradores","vehiculos","choferes","taller","grupajes","rutas","solicitudes",
      "explotacion","hojas_ruta","gastos_estructura","nominas","control_horario",
      "documentos","avisos","facturacion","contabilidad","informes","excepciones",
    "empresa","usuarios","actividad","mi_cuenta",
    "cuadrante_grupo","cuadrante_vehiculos","cuadrante_choferes","cuadrante_semana",
    "facturacion_grupo","informes_grupo","rutas_recomendadas_chofer"
  ],
  enterprise: null,
};

function planPermite(plan, moduloId) {
  if (moduloId === "vehiculos_tractoras" || moduloId === "vehiculos_remolques") return planPermite(plan, "vehiculos");
  if (moduloId === "app_mecanico") return planPermite(plan, "taller");
  const permitidos = MODULOS_POR_PLAN[plan] || MODULOS_POR_PLAN.profesional;
  if (permitidos === null) return true; // enterprise: todo
  return permitidos.includes(moduloId);
}

function filtrarModulosPorPlan(modulos, plan) {
  if (!plan || plan === "enterprise") return modulos;
  const filtrar = (items) => items
    .filter(item => planPermite(plan, item.id))
    .map(item => ({
      ...item,
      children: item.children ? item.children.filter(c => planPermite(plan, c.id)) : undefined,
    }));
  return modulos.map(grupo => ({
    ...grupo,
    items: filtrar(grupo.items),
  })).filter(grupo => grupo.items.length > 0);
}

const ROLE_NAV_FALLBACK_PERMISSIONS = {
  gerente: ["contabilidad", "nominas", "hojas_ruta", "control_horario"],
  contable: ["contabilidad", "nominas", "hojas_ruta", "control_horario"],
  administrativo: ["contabilidad", "nominas", "hojas_ruta", "control_horario"],
  trafico: ["hojas_ruta"],
  colaborador: ["hojas_ruta"],
  visualizador: ["hojas_ruta"],
};

function filtrarModulosPorPermisos(modulos, permisos, rol) {
  const reglas = permisos?.modulos;
  if (!reglas || Object.keys(reglas).length === 0) return modulos;
  const fallbackPorRol = new Set(ROLE_NAV_FALLBACK_PERMISSIONS[rol] || []);

  const puedeVer = id => {
    const regla = reglas[id];
    if (!regla && fallbackPorRol.has(id)) return true;
    return regla ? regla.ver !== false : false;
  };
  const puedeVerCompat = id => {
    if (puedeVer(id)) return true;
    if (id === "vehiculos_tractoras" || id === "vehiculos_remolques") return puedeVer("vehiculos");
    if (id === "app_mecanico") return puedeVer("taller");
    if (id === "control_tower") {
      return reglas.dashboard?.ver !== false && (reglas.dashboard?.ver === true || reglas.gestion_trafico?.ver === true);
    }
    return false;
  };

  return modulos.map(grupo => {
    const items = (grupo.items || []).map(item => {
      if (item.children) {
        const children = item.children.filter(child => puedeVerCompat(child.id));
        return children.length ? { ...item, children } : null;
      }
      return puedeVerCompat(item.id) ? item : null;
    }).filter(Boolean);
    return items.length ? { ...grupo, items } : null;
  }).filter(Boolean);
}

const ROLES_PORTAL_CERRADO = new Set(["chofer", "cliente", "cliente_portal", "colaborador", "mecanico", "responsable_taller"]);

function modulosBaseParaUsuario(user) {
  const rol = String(user?.rol || "").toLowerCase();
  if (ROLES_PORTAL_CERRADO.has(rol)) return MODULOS_POR_ROL[rol] || MODULOS_COLABORADOR;
  const reglas = user?.permisos?.modulos;
  if (reglas && Object.keys(reglas).length > 0) return MODULOS_GERENTE;
  return MODULOS_POR_ROL[rol] || MODULOS_COLABORADOR;
}

const MODULOS_GERENTE = [
  { titulo:"Trabajo diario", items:[
    { id:"dashboard", icon:IC.dashboard, label:"Dashboard" },
    { id:"agenda", icon:IC.agenda, label:"Agenda" },
    { id:"pedidos", icon:IC.pedidos, label:"Pedidos / Trafico" },
    { id:"gestion_trafico", icon:IC.cuadrante, label:"Mesa de trafico" },
    { id:"control_tower", icon:IC.tower, label:"Control Tower" },
  ]},
  { titulo:"Trafico", items:[
    { id:"solicitudes", icon:IC.docs, label:"Peticiones viaje" },
    { id:"calculador_portes", icon:IC.calculadora, label:"Calculador de portes" },
    { id:"colaboradores", icon:IC.colabor, label:"Colaboradores" },
  ]},
  { titulo:"Comercial", items:[
    { id:"clientes", icon:IC.clientes, label:"Clientes" },
    { id:"rutas", icon:IC.rutas, label:"Rutas y tarifas" },
    { id:"tarifas", icon:IC.facturacion, label:"Tarifas" },
    { id:"objetivos", icon:IC.rendimiento, label:"Objetivos" },
  ]},
  { titulo:"Flota y almacen", items:[
    { id:"vehiculos", icon:IC.vehiculos, label:"Vehiculos", children:[
      { id:"vehiculos_tractoras", label:"Tractoras" },
      { id:"vehiculos_remolques", label:"Remolques" },
    ]},
    { id:"choferes", icon:IC.choferes, label:"Choferes" },
    { id:"taller", icon:IC.taller, label:"Taller" },
    { id:"palets", icon:IC.almacen, label:"Gestion de almacen" },
  ]},
  { titulo:"Administracion y finanzas", items:[
    { id:"facturacion_grupo", icon:IC.facturacion, label:"Facturacion y contabilidad", children:[
      { id:"facturacion", label:"Facturacion" },
      { id:"contabilidad", label:"Contabilidad" },
      { id:"gastos_estructura", label:"Gastos de estructura" },
      { id:"nominas", label:"Nominas" },
      { id:"hojas_ruta", label:"Hojas de ruta" },
    ]},
    { id:"informes_grupo", icon:IC.rendimiento, label:"Analisis y trazabilidad", children:[
      { id:"explotacion", label:"Explotacion" },
      { id:"informes", label:"Informes de gestion" },
      { id:"excepciones", label:"Excepciones operativas" },
      { id:"actividad", label:"Trazabilidad" },
    ]},
  ]},
  { titulo:"Gestion", items:[
    { id:"control_horario", icon:IC.agenda, label:"Control horario" },
    { id:"avisos", icon:IC.avisos, label:"Avisos" },
    { id:"empresa", icon:IC.empresa, label:"Mi Empresa" },
    { id:"usuarios", icon:IC.usuarios, label:"Usuarios y roles" },
    { id:"importacion", icon:IC.importacion, label:"Importacion" },
    { id:"mi_cuenta", icon:IC.usuarios, label:"Mi cuenta" },
  ]},
];

const MODULOS_CONTABLE = [
  { titulo:"Principal", items:[
    { id:"dashboard", icon:IC.dashboard, label:"Dashboard" },
  ]},
  { titulo:"Administracion", items:[
    { id:"agenda", icon:IC.agenda, label:"Agenda" },
    { id:"clientes", icon:IC.clientes, label:"Clientes" },
    { id:"pedidos", icon:IC.pedidos, label:"Pedidos" },
    { id:"facturacion", icon:IC.facturacion, label:"Gestión financiera" },
    { id:"contabilidad", icon:IC.contabilidad, label:"Contabilidad" },
    { id:"nominas", icon:IC.nominas, label:"Nóminas" },
    { id:"hojas_ruta", icon:IC.hojaRuta, label:"Hojas de ruta" },
    { id:"control_horario", icon:IC.agenda, label:"Control horario" },
    { id:"informes", icon:IC.rendimiento, label:"Informes" },
    { id:"empresa", icon:IC.empresa, label:"Mi Empresa" },
    { id:"avisos", icon:IC.avisos, label:"Avisos" },
  ]},
];

const MODULOS_RESPONSABLE_TALLER = [
  { titulo:"Taller", items:[
    { id:"app_mecanico", icon:IC.taller, label:"App mecanico" },
    { id:"mi_cuenta", icon:IC.usuarios, label:"Mi cuenta" },
  ]},
];

const MODULOS_TRAFICO = [
  { titulo:"Trabajo diario", items:[
    { id:"dashboard", icon:IC.dashboard, label:"Dashboard" },
    { id:"agenda", icon:IC.agenda, label:"Agenda" },
    { id:"pedidos", icon:IC.pedidos, label:"Pedidos / Trafico" },
    { id:"gestion_trafico", icon:IC.cuadrante, label:"Mesa de trafico" },
    { id:"control_tower", icon:IC.tower, label:"Control Tower" },
  ]},
  { titulo:"Comercial y red", items:[
    { id:"clientes", icon:IC.clientes, label:"Clientes" },
    { id:"rutas", icon:IC.rutas, label:"Rutas y tarifas" },
    { id:"tarifas", icon:IC.facturacion, label:"Tarifas" },
    { id:"solicitudes", icon:IC.docs, label:"Peticiones viaje" },
    { id:"calculador_portes", icon:IC.calculadora, label:"Calculador de portes" },
    { id:"colaboradores", icon:IC.colabor, label:"Colaboradores" },
  ]},
  { titulo:"Flota y almacen", items:[
    { id:"vehiculos", icon:IC.vehiculos, label:"Vehiculos", children:[
      { id:"vehiculos_tractoras", label:"Tractoras" },
      { id:"vehiculos_remolques", label:"Remolques" },
    ]},
    { id:"choferes", icon:IC.choferes, label:"Choferes" },
    { id:"taller", icon:IC.taller, label:"Taller" },
    { id:"palets", icon:IC.almacen, label:"Gestion de almacen" },
  ]},
  { titulo:"Gestion", items:[
    { id:"hojas_ruta", icon:IC.hojaRuta, label:"Hojas de ruta" },
    { id:"control_horario", icon:IC.agenda, label:"Control horario" },
    { id:"avisos", icon:IC.avisos, label:"Avisos" },
    { id:"excepciones", icon:IC.rendimiento, label:"Excepciones operativas" },
    { id:"actividad", icon:IC.actividad, label:"Trazabilidad" },
    { id:"empresa", icon:IC.empresa, label:"Mi Empresa" },
  ]},
];

const MODULOS_COLABORADOR = [
  { titulo:"Portal", items:[
    { id:"pedidos", icon:IC.pedidos, label:"Peticiones viaje" },
    { id:"documentos", icon:IC.docs, label:"Documentos" },
    { id:"mi_cuenta", icon:IC.usuarios, label:"Mi cuenta" },
  ]},
];

const MODULOS_VISUALIZADOR = [
  { titulo:"Consulta", items:[
    { id:"dashboard", icon:IC.dashboard, label:"Dashboard" },
    { id:"agenda", icon:IC.agenda, label:"Agenda" },
    { id:"pedidos", icon:IC.pedidos, label:"Pedidos" },
    { id:"plan_diario", icon:IC.cuadrante, label:"Plan diario" },
    { id:"gestion_trafico", icon:IC.cuadrante, label:"Mesa de trafico" },
    { id:"clientes", icon:IC.clientes, label:"Clientes" },
    { id:"rutas", icon:IC.rutas, label:"Rutas y Tarifas" },
    { id:"vehiculos", icon:IC.vehiculos, label:"Vehiculos", children:[
      { id:"vehiculos_tractoras", label:"Tractoras" },
      { id:"vehiculos_remolques", label:"Remolques" },
    ]},
    { id:"choferes", icon:IC.choferes, label:"Choferes" },
    { id:"documentos", icon:IC.docs, label:"Documentos" },
    { id:"mi_cuenta", icon:IC.usuarios, label:"Mi cuenta" },
  ]},
];

const MODULOS_CHOFER = [
  { titulo:"Mi jornada", items:[
    { id:"app_chofer", icon:IC.vehiculos, label:"App de choferes" },
    { id:"rutas_recomendadas_chofer", icon:IC.rutas, label:"Mi ruta recomendada" },
  ]},
];

const MODULOS_CLIENTE = [
  { titulo:"Mi cuenta", items:[
    { id:"portal_cliente", icon:IC.docs, label:"Mi portal" },
  ]},
];

const MODULOS_POR_ROL = {
  gerente:              MODULOS_GERENTE,
  contable:             MODULOS_CONTABLE,
  administrativo:       MODULOS_CONTABLE,
  trafico:              MODULOS_TRAFICO,
  responsable_taller:   MODULOS_RESPONSABLE_TALLER,
  mecanico:             MODULOS_RESPONSABLE_TALLER,
  colaborador:          MODULOS_COLABORADOR,
  visualizador:         MODULOS_VISUALIZADOR,
  chofer:               MODULOS_CHOFER,
  cliente:              MODULOS_CLIENTE,
  cliente_portal:       MODULOS_CLIENTE,
};

function VISTA_DEFAULT(rol) {
  if (rol === "chofer")  return "app_chofer";
  if (rol === "responsable_taller" || rol === "mecanico") return "app_mecanico";
  if (rol === "cliente" || rol === "cliente_portal") return "portal_cliente";
  if (rol === "gerente" || rol === "contable") return "dashboard";
  return "gestion_trafico";
}

// Mapa de ID de mÃƒÂ³dulo Ã¢â€ â€™ componente React
const VISTAS = {
  dashboard:    <Dashboard />,
  control_tower:<ControlTower />,
  agenda:       <Agenda />,
  clientes:     <Clientes />,
  pedidos:      <Pedidos />,
  rutas:        <Rutas />,
  calculador_portes: <CalculadorPortes />,
  vehiculos:    <Vehiculos />,
  vehiculos_tractoras: <Vehiculos initialTipo="tractoras" />,
  vehiculos_remolques: <Vehiculos initialTipo="remolques" />,
  choferes:     <Choferes />,
  colaboradores:<Colaboradores />,
  facturacion:  <Facturacion />,
  contabilidad: <Contabilidad />,
  informes:     <Informes />,
  excepciones:  <Excepciones />,
  documentos:   <Documentos />,
  avisos:       <Avisos />,
  actividad:    <Actividad />,
  usuarios:     <Usuarios />,
  taller:       <Taller />,
  grupajes:     <PlanificacionOperativa initialTab="grupajes" />,
  explotacion:  <Explotacion />,
  cuadrante_semana:    <PlanificacionOperativa initialTab="cuadrante" />,
  plan_diario:         <PlanificacionOperativa initialTab="plan_diario" />,
  cuadrante_vehiculos: <CuadranteVehiculos />,
  cuadrante_choferes:  <CuadranteChoferes />,
  empresa:             <Empresa />,
  hojas_ruta:          <HojasRuta />,
  control_horario:     <ControlHorario />,
  gestion_trafico:     <PlanificacionOperativa initialTab="cuadrante" />,
  rutas_recomendadas:  <PlanificacionOperativa initialTab="optimizacion" />,
  rutas_recomendadas_chofer: <GestionTrafico initialVista="optimizacion" soloOptimizacion />,
  nominas:             <Nominas />,
  app_chofer:          <AppChofer />,
  app_mecanico:        <AppMecanico />,
  portal_cliente:      <PortalClientes />,
  solicitudes:         <Solicitudes />,
  mi_cuenta:           <MiCuenta />,
  tarifas:             <Tarifas />,
  objetivos:           <Objetivos />,
  importacion:         <Importacion />,
  palets:              <Palets />,
  gastos_estructura:   <GastosEstructura />,
};

function toast(message, type = "success") {
  window.dispatchEvent(new CustomEvent("tms:notify", { detail:{ message, type } }));
}

function onboardingStorageKey(user) {
  const empresa = user?.empresa_id || user?.empresaId || user?.empresa || "empresa";
  const identity = user?.id || user?.email || user?.nombre || "usuario";
  const rol = user?.rol || "rol";
  return `tms_onboarding_done:${empresa}:${rol}:${identity}`;
}

const GUIDED_MODULE_LABELS = {
  dashboard: "Dashboard",
  control_tower: "Control Tower",
  agenda: "Agenda",
  pedidos: "Pedidos",
  plan_diario: "Plan diario",
  gestion_trafico: "Gestión de tráfico",
  rutas: "Rutas y tarifas",
  rutas_recomendadas: "Rutas recomendadas",
  calculador_portes: "Calculador de portes",
  clientes: "Clientes",
  tarifas: "Tarifas",
  colaboradores: "Colaboradores",
  vehiculos_tractoras: "Tractoras",
  vehiculos_remolques: "Remolques",
  vehiculos: "Vehículos",
  choferes: "Chóferes",
  taller: "Taller",
  explotacion: "Explotacion",
  hojas_ruta: "Hojas de ruta",
  gastos_estructura: "Gastos de estructura",
  nominas: "Nóminas",
  control_horario: "Control horario",
  facturacion: "Facturación",
  contabilidad: "Contabilidad",
  informes: "Informes",
  excepciones: "Excepciones",
  documentos: "Documentos",
  avisos: "Avisos",
  empresa: "Mi Empresa",
  usuarios: "Usuarios y roles",
  actividad: "Registro de actividad",
  importacion: "Importación",
  solicitudes: "Peticiones viaje",
  palets: "Gestión de almacén",
  app_mecanico: "App mecanico",
  app_chofer: "App chofer",
  portal_cliente: "Portal cliente",
  mi_cuenta: "Mi cuenta",
  objetivos: "Objetivos",
};

const GUIDED_MODULE_MISSIONS = {
  dashboard: [
    ["Vista general", "Revisa los indicadores principales y detecta desviaciones."],
    ["Avisos importantes", "Comprueba si hay bloqueos, vencimientos o viajes pendientes."],
    ["Acceso rapido", "Entra desde aqui a operaciones o facturacion si algo requiere accion."],
  ],
  control_tower: [
    ["Estado operativo", "Revisa viajes activos, retrasos y excepciones."],
    ["Separadores", "Comprueba cada bloque para entender que requiere accion."],
    ["Priorizar", "Abre la incidencia o pedido que tenga mayor impacto."],
  ],
  agenda: [
    ["Crear aviso", "Anade un recordatorio manual con fecha y responsable."],
    ["Revisar pendientes", "Comprueba avisos de hoy y proximos vencimientos."],
    ["Cerrar tarea", "Marca como completado lo que ya este resuelto."],
  ],
  gestion_trafico: [
    ["Filtro temporal", "Alterna mes en curso y semana actual."],
    ["Pedidos sin asignar", "Localiza viajes pendientes de vehiculo o colaborador."],
    ["Datos chofer", "Usa copiar datos para enviar instrucciones rapidamente."],
  ],
  plan_diario: [
    ["Dia de trabajo", "Comprueba manana o el dia operativo que quieras preparar."],
    ["Arrastrar viajes", "Asigna pedidos al camion o cambia el orden de ruta."],
    ["Enviar plan", "Prepara el texto o envio al chofer cuando el plan este cerrado."],
  ],
  clientes: [
    ["Alta cliente", "Crea o revisa datos fiscales y contacto operativo."],
    ["Tarifas", "Comprueba rutas, condiciones y tipos de IVA."],
    ["Revision", "Deja marcados los clientes incompletos para validar despues."],
  ],
  colaboradores: [
    ["Ficha proveedor", "Revisa CIF, email, telefono, vehiculos y condiciones."],
    ["Documentacion", "Comprueba facturas, albaranes y documentos pendientes."],
    ["Revision", "Completa pendientes antes de asignar viajes sensibles."],
  ],
  vehiculos: [
    ["Alta vehiculo", "Crea tractora, remolque o conjunto con matricula correcta."],
    ["Documentos", "Revisa ITV, seguro y vencimientos."],
    ["Asignacion", "Comprueba chofer y remolque habitual."],
  ],
  choferes: [
    ["Ficha chofer", "Revisa datos de contacto, permisos y estado."],
    ["Agenda", "Comprueba vacaciones, medico o restricciones."],
    ["Asignacion", "Valida que el conjunto habitual sea correcto."],
  ],
  taller: [
    ["Avisos taller", "Revisa revisiones, aceite, ITV y tareas abiertas."],
    ["Crear tarea", "Anade mantenimiento o reparacion pendiente."],
    ["Cerrar", "Marca como resuelto cuando la accion este documentada."],
  ],
  facturacion: [
    ["Viajes facturables", "Filtra realizados y revisa documentacion obligatoria."],
    ["IVA y conceptos", "Comprueba tipo de IVA, base y concepto antes de emitir."],
    ["Cobro", "Actualiza estado y vencimientos de facturas."],
  ],
  contabilidad: [
    ["Colas y fiscales", "Revisa configuracion fiscal y tareas pendientes."],
    ["Pagos", "Comprueba pagos a colaboradores y vencimientos."],
    ["Bloqueos", "Detecta documentos que impiden facturar o pagar."],
  ],
  documentos: [
    ["Subir documento", "Adjunta CMR, albaran, POD o soporte."],
    ["Clasificar", "Asocia el documento al pedido, vehiculo, cliente o colaborador."],
    ["Validar", "Comprueba que el documento queda visible para facturacion."],
  ],
  avisos: [
    ["Semaforo", "Revisa caducados, criticos y en plazo."],
    ["Filtrar", "Usa filtros por vehiculo, chofer o documentacion."],
    ["Agenda", "Convierte avisos relevantes en recordatorios."],
  ],
  rutas: [
    ["Crear ruta", "Define origen, destino, cliente y tarifa."],
    ["Tipo precio", "Selecciona viaje, tonelada, km, hora o unidad."],
    ["Validar", "Comprueba minimos y compatibilidad con vehiculo."],
  ],
  palets: [
    ["Entrada", "Registra movimientos de almacen o palets por cliente."],
    ["Devolucion", "Controla devoluciones pendientes y confirmadas."],
    ["Resumen", "Valida saldos antes de facturar o reclamar."],
  ],
  solicitudes: [
    ["Bandeja", "Revisa solicitudes pendientes de clientes."],
    ["Aceptar o descartar", "Convierte en pedido o manda a papelera."],
    ["Trazabilidad", "Comprueba actividad y documentos asociados."],
  ],
  informes: [
    ["Seleccionar informe", "Elige el bloque economico u operativo."],
    ["Filtrar", "Ajusta periodo, cliente o vehiculo."],
    ["Exportar", "Usa el resultado para tomar decisiones o revisar margen."],
  ],
  excepciones: [
    ["Criticas", "Revisa excepciones criticas y altas."],
    ["Resolver", "Marca la accion realizada y deja trazabilidad."],
    ["Reabrir", "Reabre solo si el problema sigue activo."],
  ],
  usuarios: [
    ["Crear usuario", "Da de alta usuario y rol."],
    ["Permisos", "Revisa modulos visibles y acciones permitidas."],
    ["Primer acceso", "Confirma que el onboarding del rol sea correcto."],
  ],
  actividad: [
    ["Auditoria", "Filtra por usuario, modulo o criticidad."],
    ["Trazabilidad", "Comprueba acciones sensibles o ignoradas."],
    ["Seguimiento", "Usa el registro para detectar problemas de uso."],
  ],
};

function getGuidedModuleSteps(route) {
  return GUIDED_MODULE_MISSIONS[route] || [
    ["Abrir modulo", `Entra en ${GUIDED_MODULE_LABELS[route] || "este modulo"} y revisa la pantalla principal.`],
    ["Revisar datos", "Comprueba filtros, listados y acciones disponibles."],
    ["Accion principal", "Ejecuta la accion mas habitual del modulo o deja marcada la revision."],
  ];
}

function isVisibleTourElement(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  return rect.width > 0 && rect.height > 0 && inViewport && style.visibility !== "hidden" && style.display !== "none";
}

function findTourElementByText(texts = []) {
  if (typeof document === "undefined") return null;
  const wanted = texts.map(t => String(t || "").toLowerCase().trim()).filter(Boolean);
  if (!wanted.length) return null;
  const nodes = Array.from(document.querySelectorAll("button,a,input,select,textarea,[role='button'],[data-tour]"));
  return nodes.find(el => {
    if (!isVisibleTourElement(el)) return false;
    const text = String(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "").toLowerCase();
    return wanted.some(w => text.includes(w));
  }) || null;
}

function getGuidedTarget(route, stepTitle, label) {
  if (typeof document === "undefined") return null;
  const selectors = [
    `[data-tour="guided-step-${String(stepTitle || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}"]`,
    stepTitle?.toLowerCase?.().includes("abrir") ? `[data-tour="tutorial-open-module"]` : "",
    `[data-tour="module-${route}"]`,
  ].filter(Boolean);
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (isVisibleTourElement(el)) return el;
  }
  return findTourElementByText([stepTitle, label]);
}

function GlobalGuidedModulePanel({ mission, onClose, onOpenModule }) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  useEffect(() => { setStep(0); }, [mission?.route, mission?.startedAt]);
  const route = mission?.route || "";
  const steps = getGuidedModuleSteps(route);
  const label = GUIDED_MODULE_LABELS[route] || route;
  const current = steps[Math.min(step, steps.length - 1)];
  const complete = !mission?.active || !route || step >= steps.length;
  const progress = Math.min(100, Math.round((Math.min(step, steps.length) / steps.length) * 100));
  useEffect(() => {
    if (!mission?.active || complete) {
      setTargetRect(null);
      return;
    }
    let raf = 0;
    function updateTarget() {
      const target = getGuidedTarget(route, current?.[0], label);
      if (!target) {
        setTargetRect(null);
        return;
      }
      target.scrollIntoView({ block:"center", inline:"center", behavior:"smooth" });
      raf = window.requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        setTargetRect({
          top: Math.max(8, rect.top - 7),
          left: Math.max(8, rect.left - 7),
          width: rect.width + 14,
          height: rect.height + 14,
        });
      });
    }
    const timer = window.setTimeout(updateTarget, 180);
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [complete, current, label, mission?.active, route, step]);
  if (!mission?.active || !route) return null;
  return (
    <>
    <style>{`
      .tg-guided-module-panel { position:fixed; right:18px; bottom:18px; z-index:9300; width:min(380px,calc(100vw - 36px)); background:var(--bg2); border:1px solid rgba(20,184,166,.34); border-radius:10px; box-shadow:0 20px 55px rgba(0,0,0,.28); padding:14px; font-family:'DM Sans',sans-serif; }
      .tg-guided-steps { display:grid; gap:6px; }
      @media (max-width: 640px) {
        .tg-guided-module-panel { left:0 !important; right:0 !important; bottom:0 !important; width:100vw !important; max-width:100vw !important; max-height:48dvh !important; overflow:auto !important; border-radius:14px 14px 0 0 !important; padding:12px 14px 16px !important; }
        .tg-guided-module-panel .tg-guided-steps { max-height:128px; overflow:auto; }
        .tg-guided-module-panel h3, .tg-guided-module-panel [data-guided-title] { font-size:20px !important; line-height:1.05 !important; }
        .tg-guided-module-panel button { min-height:42px; }
      }
    `}</style>
    {targetRect && (
      <div aria-hidden="true" style={{position:"fixed",zIndex:9290,top:targetRect.top,left:targetRect.left,width:targetRect.width,height:targetRect.height,border:"2px solid var(--accent)",borderRadius:10,boxShadow:"0 0 0 9999px rgba(2,6,23,.32), 0 0 0 6px rgba(20,184,166,.18)",pointerEvents:"none",transition:"all .18s ease"}} />
    )}
    <div className="tg-guided-module-panel">
      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
        <div style={{width:34,height:34,borderRadius:9,background:complete?"rgba(16,185,129,.16)":"rgba(20,184,166,.14)",color:complete?"#10b981":"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900}}>
          {complete ? "OK" : step + 1}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--accent-xl)"}}>Tutorial de módulo</div>
          <div data-guided-title style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:900,color:"var(--text)",marginTop:2}}>{label}</div>
          <div style={{fontSize:11,color:"var(--text5)",fontWeight:800,marginTop:3}}>{Math.min(step, steps.length)}/{steps.length} pasos</div>
        </div>
        <button type="button" onClick={onClose} title="Cerrar tutorial" style={{border:"none",background:"transparent",color:"var(--text5)",fontSize:18,fontWeight:900,cursor:"pointer",lineHeight:1}}>x</button>
      </div>
      <div style={{height:5,background:"var(--bg4)",borderRadius:999,overflow:"hidden",margin:"12px 0"}}>
        <div style={{height:"100%",width:`${progress}%`,background:complete?"#10b981":"var(--accent)",transition:"width .25s ease"}} />
      </div>
      <div style={{border:"1px solid var(--border)",background:"var(--bg)",borderRadius:8,padding:"10px 11px",marginBottom:10}}>
        <div style={{fontSize:12,fontWeight:900,color:complete?"#10b981":"var(--text)"}}>{complete ? "Tutorial completado" : current?.[0]}</div>
        <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.45,marginTop:3}}>{complete ? "Ya puedes seguir trabajando o abrir otro modulo desde la guia." : current?.[1]}</div>
      </div>
      <div className="tg-guided-steps">
        {steps.map(([title], idx) => {
          const done = idx < step;
          const isCurrent = idx === step && !complete;
          return (
            <div key={title} style={{display:"flex",gap:8,alignItems:"center",padding:"7px 8px",borderRadius:7,border:`1px solid ${isCurrent ? "rgba(20,184,166,.32)" : "var(--border)"}`,background:isCurrent ? "rgba(20,184,166,.08)" : "transparent"}}>
              <span style={{width:18,height:18,borderRadius:999,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,background:done?"rgba(16,185,129,.16)":"var(--bg4)",color:done?"#10b981":"var(--text5)"}}>{done ? "✓" : ""}</span>
              <span style={{fontSize:11,fontWeight:850,color:done?"#10b981":"var(--text3)"}}>{title}</span>
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
        <button type="button" data-tour="tutorial-open-module" onClick={() => onOpenModule?.(mission.route)} style={{padding:"9px 11px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",fontSize:12,fontWeight:900,cursor:"pointer"}}>
          Abrir modulo
        </button>
        <button type="button" data-tour="tutorial-next-step" onClick={() => complete ? onClose?.() : setStep(x => Math.min(steps.length, x + 1))} style={{flex:1,minWidth:130,padding:"9px 11px",borderRadius:8,border:"1px solid var(--accent)",background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:900,cursor:"pointer"}}>
          {complete ? "Cerrar" : "Completar paso"}
        </button>
      </div>
    </div>
    </>
  );
}

function avimStorageKey(user) {
  const scope = user?.empresa_id || user?.empresaId || user?.id || user?.email || "global";
  return `tms_avim_minimized:${scope}`;
}

function avimSeenStorageKey(user) {
  const scope = user?.empresa_id || user?.empresaId || user?.id || user?.email || "global";
  return `tms_avim_seen:${scope}`;
}

function readAvimMinimized(user) {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(avimStorageKey(user)) === "1"; }
  catch { return false; }
}

function writeAvimMinimized(user, value) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(avimStorageKey(user), value ? "1" : "0"); }
  catch {}
}

function avimAlertKey(item = {}) {
  return String(item.key || item.id || [item.kind, item.pedido_id, item.colaborador_id, item.fecha_carga, item.fecha_descarga].filter(Boolean).join(":"));
}

function readAvimSeen(user) {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = JSON.parse(window.localStorage.getItem(avimSeenStorageKey(user)) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeAvimSeen(user, keys) {
  if (typeof window === "undefined") return;
  try {
    const unique = Array.from(new Set(Array.from(keys || []).map(String))).slice(-500);
    window.localStorage.setItem(avimSeenStorageKey(user), JSON.stringify(unique));
  } catch {}
}

function OperativeAlertsPanel({ user, data, open, onToggle, onRefresh, onRemove, onMarkRead, hidden = false }) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const pageSize = 12;
  const minimizedKey = avimStorageKey(user);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [minimized, setMinimized] = useState(() => readAvimMinimized(user));
  const [position, setPosition] = useState(() => {
    if (typeof window === "undefined") return { x: 18, y: 62 };
    return { x: Math.max(12, window.innerWidth - 448), y: 62 };
  });
  const dragRef = useRef(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { setMinimized(window.localStorage.getItem(minimizedKey) === "1"); }
    catch { setMinimized(false); }
  }, [minimizedKey]);
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [open, items.length]);
  if (!items.length || hidden) return null;
  const resumen = data?.resumen || {};
  const esGerente = user?.rol === "gerente";
  const importantes = items.filter(i => i.severity === "alta");
  const visibleItems = items.slice(0, visibleCount);
  const remainingItems = Math.max(0, items.length - visibleItems.length);
  const totalAvisos = resumen.total || items.length;

  function clampPanelPosition(x, y) {
    if (typeof window === "undefined") return { x, y };
    const width = open ? 430 : 300;
    const height = open ? 560 : 78;
    return {
      x: Math.min(Math.max(10, x), Math.max(10, window.innerWidth - width - 10)),
      y: Math.min(Math.max(10, y), Math.max(10, window.innerHeight - height - 10)),
    };
  }

  function startDrag(e) {
    if (e.button !== 0) return;
    dragRef.current = { pointerId:e.pointerId, dx:e.clientX - position.x, dy:e.clientY - position.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function moveDrag(e) {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    setPosition(clampPanelPosition(e.clientX - dragRef.current.dx, e.clientY - dragRef.current.dy));
  }

  function endDrag(e) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  function setPanelMinimized(value) {
    writeAvimMinimized(user, value);
    setMinimized(value);
  }

  function abrirPedido(item) {
    setRuntimeFocus("tms_pedidos_focus", { pedido_id:item.pedido_id, numero:item.pedido_numero || "", source:"avisos_operativos_colaborador" });
    window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"pedidos" }));
    onToggle(false);
  }

  async function crearAgenda(item) {
    try {
      await crearAgendaAvisoOperativoColaborador(item);
      toast("Recordatorio creado en agenda.", "success");
      window.dispatchEvent(new CustomEvent("tms:agenda-refresh"));
      onRefresh?.();
    } catch (e) {
      toast(e.message || "No se pudo crear el recordatorio.", "error");
    }
  }

  async function ignorar(item) {
    try {
      await ignorarAvisoOperativoColaborador(item);
      toast(user?.rol === "gerente" ? "Aviso ignorado." : "Aviso ignorado. Gerencia queda notificada.", "success");
      onRemove?.(item.key);
      window.dispatchEvent(new CustomEvent("tms:notificaciones-refresh"));
    } catch (e) {
      toast(e.message || "No se pudo ignorar el aviso.", "error");
    }
  }

  if (minimized) {
    return (
      <button
        type="button"
        title="Avisos importantes"
        onClick={() => { setPanelMinimized(false); onToggle(true); }}
        style={{position:"fixed",right:18,bottom:18,zIndex:9000,width:58,height:58,borderRadius:999,border:"1px solid rgba(245,158,11,.38)",background:"rgba(17,24,39,.96)",color:"#f8fafc",boxShadow:"0 16px 40px rgba(0,0,0,.24)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:950,display:"inline-flex",alignItems:"center",justifyContent:"center"}}
      >
        AvIm
        <span style={{position:"absolute",right:-4,top:-4,minWidth:20,height:20,padding:"0 5px",borderRadius:999,background:importantes.length?"#ef4444":"#f59e0b",color:"#fff",fontSize:10,fontWeight:900,display:"inline-flex",alignItems:"center",justifyContent:"center",border:"2px solid var(--bg)"}}>
          {totalAvisos > 99 ? "99+" : totalAvisos}
        </span>
      </button>
    );
  }

  return (
    <div style={{position:"fixed",left:position.x,top:position.y,zIndex:9000,width:open?430:300,maxWidth:"calc(100vw - 32px)",fontFamily:"'DM Sans',sans-serif"}}>
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,border:"1px solid rgba(245,158,11,.32)",background:"rgba(17,24,39,.96)",color:"#f8fafc",borderRadius:10,padding:"10px 12px",boxShadow:"0 16px 40px rgba(0,0,0,.22)",cursor:"grab",userSelect:"none",touchAction:"none"}}
      >
        <span style={{display:"grid",textAlign:"left",minWidth:0}}>
          <span style={{fontSize:12,fontWeight:900}}>Avisos importantes</span>
          <span style={{fontSize:10,color:"rgba(226,232,240,.75)"}}>
            {resumen.total || items.length} pendiente(s){esGerente && importantes.length ? ` · ${importantes.length} importante(s)` : ""}
          </span>
        </span>
        <span style={{marginLeft:"auto",display:"inline-flex",gap:6,alignItems:"center"}}>
          <button
            type="button"
            title={open ? "Contraer avisos" : "Expandir avisos"}
            onPointerDown={e=>e.stopPropagation()}
            onClick={() => onToggle(!open)}
            style={{width:28,height:28,borderRadius:999,border:"1px solid rgba(255,255,255,.18)",background:"rgba(255,255,255,.08)",color:"#fff",fontWeight:900,fontSize:14,cursor:"pointer"}}
          >
            {open ? "-" : "+"}
          </button>
          <button
            type="button"
            title="Minimizar avisos importantes"
            onPointerDown={e=>e.stopPropagation()}
            onClick={() => setPanelMinimized(true)}
            style={{width:28,height:28,borderRadius:999,border:"1px solid rgba(255,255,255,.18)",background:"rgba(255,255,255,.08)",color:"#fff",fontWeight:900,fontSize:12,cursor:"pointer"}}
          >
            Av
          </button>
          <button
            type="button"
            title="Marcar avisos como leidos"
            onPointerDown={e=>e.stopPropagation()}
            onClick={() => onMarkRead?.(items)}
            style={{height:28,padding:"0 8px",borderRadius:999,border:"1px solid rgba(255,255,255,.18)",background:"rgba(255,255,255,.08)",color:"#fff",fontWeight:900,fontSize:11,cursor:"pointer"}}
          >
            Leido
          </button>
          <span style={{minWidth:28,height:28,borderRadius:999,display:"inline-flex",alignItems:"center",justifyContent:"center",background:importantes.length?"#ef4444":"#f59e0b",color:"#fff",fontWeight:900,fontSize:12}}>
            {totalAvisos}
          </span>
        </span>
      </div>
      {open && (
        <div style={{marginTop:8,border:"1px solid var(--border)",background:"var(--bg2)",borderRadius:10,boxShadow:"0 18px 50px rgba(0,0,0,.24)",overflow:"hidden"}}>
          {esGerente && (
            <div style={{padding:"11px 12px",borderBottom:"1px solid var(--border)",background:"rgba(239,68,68,.06)"}}>
              <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"#ef4444"}}>Resumen gerencia</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                <span style={{fontSize:11,fontWeight:900,color:"#ef4444"}}>{resumen.alta || 0} importantes</span>
                <span style={{fontSize:11,fontWeight:900,color:"#f59e0b"}}>{resumen.albaranes_pendientes || 0} albaranes/POD</span>
                <span style={{fontSize:11,fontWeight:900,color:"var(--accent-xl)"}}>{resumen.colaboradores || 0} colaborador(es)</span>
              </div>
            </div>
          )}
          <div style={{maxHeight:430,overflowY:"auto",padding:10,display:"grid",gap:8}}>
            {visibleItems.map(item => (
              <div key={item.key} style={{border:`1px solid ${item.severity === "alta" ? "rgba(239,68,68,.28)" : "rgba(245,158,11,.25)"}`,background:item.severity === "alta" ? "rgba(239,68,68,.07)" : "rgba(245,158,11,.07)",borderRadius:8,padding:"9px 10px"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                  <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{item.title}</div>
                  <span style={{fontSize:10,fontWeight:900,color:item.severity === "alta" ? "#ef4444" : "#f59e0b",textTransform:"uppercase"}}>{item.severity}</span>
                </div>
                <div style={{fontSize:11,color:"var(--text4)",marginTop:3,lineHeight:1.35}}>{item.detail}</div>
                <div style={{fontSize:10,color:"var(--text5)",marginTop:5}}>
                  {item.colaborador_nombre} · {item.fecha_carga || "-"} → {item.fecha_descarga || "-"}
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                  <button onClick={() => abrirPedido(item)} style={{padding:"5px 8px",borderRadius:7,border:"1px solid rgba(59,130,246,.25)",background:"rgba(59,130,246,.10)",color:"#60a5fa",fontSize:11,fontWeight:800,cursor:"pointer"}}>Abrir pedido</button>
                  <button onClick={() => crearAgenda(item)} style={{padding:"5px 8px",borderRadius:7,border:"1px solid rgba(16,185,129,.25)",background:"rgba(16,185,129,.10)",color:"#10b981",fontSize:11,fontWeight:800,cursor:"pointer"}}>Añadir agenda</button>
                  <button onClick={() => ignorar(item)} style={{padding:"5px 8px",borderRadius:7,border:"1px solid rgba(148,163,184,.25)",background:"rgba(148,163,184,.10)",color:"var(--text3)",fontSize:11,fontWeight:800,cursor:"pointer"}}>Ignorar</button>
                </div>
              </div>
            ))}
            {remainingItems > 0 && (
              <div style={{display:"grid",gap:6,justifyItems:"center",padding:"6px 4px 2px"}}>
                <button
                  onClick={() => setVisibleCount(count => Math.min(items.length, count + pageSize))}
                  style={{padding:"7px 12px",borderRadius:8,border:"1px solid rgba(20,184,166,.28)",background:"rgba(20,184,166,.10)",color:"#0f766e",fontSize:11,fontWeight:900,cursor:"pointer"}}
                >
                  {"Cargar m\u00e1s avisos"}
                </button>
                <div style={{fontSize:10,color:"var(--text5)",textAlign:"center"}}>
                  Mostrando {visibleItems.length} de {items.length}. Quedan {remainingItems}.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function dateKey(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysKey(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

function StartupTasksPanel({ data, onClose, onOpenAgenda }) {
  if (!data?.visible) return null;
  const sections = [
    ["pasadas", "Pasadas", data.pasadas || [], "#ef4444"],
    ["hoy", "Hoy", data.hoy || [], "#0f766e"],
    ["manana", "Mañana", data.manana || [], "#f59e0b"],
  ].filter(([, , items]) => items.length);
  if (!sections.length) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:9200,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"72px 16px 16px",background:"rgba(15,23,42,.22)",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{width:"min(560px,100%)",maxHeight:"calc(100vh - 110px)",overflow:"auto",border:"1px solid var(--border)",borderRadius:14,background:"var(--bg2)",boxShadow:"0 22px 70px rgba(15,23,42,.22)"}}>
        <div style={{position:"sticky",top:0,background:"var(--bg2)",borderBottom:"1px solid var(--border)",padding:"16px 18px",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:900,color:"var(--text)"}}>Tareas pendientes</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Resumen operativo al iniciar sesión.</div>
          </div>
          <button onClick={onClose} style={{width:34,height:34,borderRadius:9,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontWeight:900,cursor:"pointer"}}>×</button>
        </div>
        <div style={{padding:16,display:"grid",gap:12}}>
          {sections.map(([key, label, items, color]) => (
            <div key={key} style={{border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",background:"var(--bg)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:12,fontWeight:950,textTransform:"uppercase",letterSpacing:".05em",color}}>{label}</span>
                <span style={{fontSize:11,fontWeight:900,color:"var(--text4)"}}>{items.length}</span>
              </div>
              <div style={{display:"grid"}}>
                {items.slice(0, 6).map(ev => (
                  <button key={ev.id || `${key}-${ev.titulo}-${ev.fecha_inicio}`} onClick={onOpenAgenda} style={{textAlign:"left",padding:"10px 12px",border:"none",borderBottom:"1px solid var(--border)",background:"transparent",cursor:"pointer"}}>
                    <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>{ev.titulo || ev.title || "Tarea"}</div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>
                      {dateKey(ev.fecha_inicio || ev.start || ev.fecha)} · {ev.estado || "pendiente"}{ev.asignado_nombre ? ` · ${ev.asignado_nombre}` : ""}
                    </div>
                  </button>
                ))}
                {items.length > 6 && <div style={{padding:"8px 12px",fontSize:11,color:"var(--text5)"}}>Y {items.length - 6} más en Agenda.</div>}
              </div>
            </div>
          ))}
          <div style={{display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
            <button onClick={onClose} style={{height:40,padding:"0 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontWeight:900,cursor:"pointer"}}>Cerrar</button>
            <button onClick={onOpenAgenda} style={{height:40,padding:"0 16px",borderRadius:8,border:"1px solid #008577",background:"#008577",color:"#fff",fontWeight:900,cursor:"pointer"}}>Abrir agenda</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const DEMO_PLAN_META = {
  lite: {
    label: "TransGest Lite",
    detail: "DCD, app chofer, pedidos, clientes, rutas/tarifas y tacografo. Sin IA ni modulos avanzados.",
  },
  basico: {
    label: "Basico",
    detail: "Trafico core con documentos y facturacion basica. Sin IA, KPIs avanzados, taller ni contabilidad.",
  },
  profesional: {
    label: "Profesional",
    detail: "KPIs, informes, rutas avanzadas, taller y contabilidad. IA desactivada.",
  },
  enterprise: {
    label: "Enterprise",
    detail: "Suite completa con IA, KPIs avanzados y todos los modulos.",
  },
};

const DEMO_ROLE_LABELS = {
  gerente: "Gerencia",
  trafico: "Trafico",
  contable: "Contabilidad",
  chofer: "Chofer",
  administrativo: "Administrativo",
  responsable_taller: "Taller",
  mecanico: "Mecanico",
  colaborador: "Colaborador",
  visualizador: "Visualizador",
};

function emitDemoToast(type, message) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tms:notify", { detail:{ type, message } }));
}

function isDemoLikeUser(user = {}) {
  if (!user) return false;
  const cfg = user.cfg_precios || user.config || {};
  const values = [
    user.demo_mode,
    cfg.demo_mode,
    user.email,
    user.username,
    user.nombre,
    user.empresa_nombre,
    user.empresa,
    user.dominio,
  ].map(v => String(v || "").trim().toLowerCase());
  return values.some(v => (
    v === "true" ||
    v === "demo" ||
    v === "gerente@demo.com" ||
    v === "gerente@empresa.com" ||
    v.startsWith("demo-") ||
    v.includes("transgest demo") ||
    v.includes("cuenta demo")
  ));
}

function DemoShowcasePanel({ user, currentPlan, onSessionChanged }) {
  const [options, setOptions] = useState(null);
  const [busy, setBusy] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const plan = normalizePlan(user?.plan || currentPlan);
  const demoEnabled = isDemoLikeUser(user);

  useEffect(() => {
    let active = true;
    if (!demoEnabled) {
      setOptions(null);
      return () => { active = false; };
    }
    getDemoOptions()
      .then(data => { if (active) setOptions(data); })
      .catch(() => { if (active) setOptions(null); });
    return () => { active = false; };
  }, [user?.id, user?.empresa_id, demoEnabled]);

  if (!demoEnabled) return null;

  const plans = (Array.isArray(options?.plans) && options.plans.length ? options.plans : Object.keys(DEMO_PLAN_META))
    .map(item => normalizePlan(item?.id || item?.plan || item))
    .filter((value, index, arr) => value && arr.indexOf(value) === index);
  const usuarios = Array.isArray(options?.usuarios) ? options.usuarios : [];
  const activeUserId = String(user?.id || "");

  async function handlePlanChange(nextPlan) {
    const normalized = normalizePlan(nextPlan);
    if (!normalized || normalized === plan || busy) return;
    setBusy("plan");
    try {
      await switchDemoPlan(normalized);
      setOptions(prev => prev ? { ...prev, empresa:{ ...(prev.empresa || {}), plan:normalized } } : prev);
      await onSessionChanged?.({ resetVista:false });
      emitDemoToast("success", `Demo cambiada a ${DEMO_PLAN_META[normalized]?.label || normalized}.`);
    } catch (err) {
      emitDemoToast("error", err?.message || "No se pudo cambiar la version demo.");
    } finally {
      setBusy("");
    }
  }

  async function handleUserChange(nextUserId) {
    if (!nextUserId || String(nextUserId) === activeUserId || busy) return;
    setBusy("user");
    try {
      await switchDemoUser(nextUserId);
      const nextUser = await onSessionChanged?.({ resetVista:true });
      emitDemoToast("success", `Sesion demo cambiada a ${DEMO_ROLE_LABELS[nextUser?.rol] || nextUser?.rol || "usuario"}.`);
    } catch (err) {
      emitDemoToast("error", err?.message || "No se pudo cambiar el usuario demo.");
    } finally {
      setBusy("");
    }
  }

  const currentUserLabel = `${DEMO_ROLE_LABELS[user?.rol] || user?.rol || "Usuario"} - ${user?.nombre || user?.email || ""}`;

  return (
    <div style={{
      margin:"0 0 14px 0",
      padding:"12px 14px",
      border:"1px solid rgba(22,163,74,.22)",
      background:"linear-gradient(135deg, rgba(240,253,244,.96), rgba(239,246,255,.96))",
      borderRadius:8,
      boxShadow:"0 10px 28px rgba(15,23,42,.08)",
      color:"#0f172a",
      fontFamily:"'DM Sans',sans-serif",
    }}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div style={{minWidth:220}}>
          <div style={{fontSize:11,fontWeight:900,letterSpacing:.4,textTransform:"uppercase",color:"#15803d"}}>
            Cuenta demo TransGest
          </div>
          <div style={{fontSize:13,fontWeight:900,color:"#102033"}}>
            {currentUserLabel}
          </div>
          {!collapsed && (
            <div style={{fontSize:11,color:"#475569",marginTop:2}}>
              Cambia de version y de perfil para comprobar limitaciones reales sin salir de la pantalla principal.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          style={{border:"1px solid rgba(15,23,42,.12)",background:"#fff",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:800,color:"#334155",cursor:"pointer"}}
        >
          {collapsed ? "Mostrar demo" : "Ocultar"}
        </button>
      </div>
      {!collapsed && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:10,marginTop:12}}>
          <label style={{display:"grid",gap:5,fontSize:11,fontWeight:800,color:"#334155"}}>
            Version del programa
            <select
              value={plan}
              disabled={busy === "plan"}
              onChange={(event) => handlePlanChange(event.target.value)}
              style={{height:36,borderRadius:7,border:"1px solid rgba(15,23,42,.16)",padding:"0 10px",fontSize:13,fontWeight:800,background:"#fff",color:"#0f172a"}}
            >
              {plans.map(item => (
                <option key={item} value={item}>{DEMO_PLAN_META[item]?.label || item}</option>
              ))}
            </select>
            <span style={{fontSize:10,fontWeight:600,color:"#64748b",lineHeight:1.35}}>
              {DEMO_PLAN_META[plan]?.detail || "Limitaciones aplicadas por plan."}
            </span>
          </label>
          <label style={{display:"grid",gap:5,fontSize:11,fontWeight:800,color:"#334155"}}>
            Usuario demo
            <select
              value={activeUserId}
              disabled={busy === "user" || !usuarios.length}
              onChange={(event) => handleUserChange(event.target.value)}
              style={{height:36,borderRadius:7,border:"1px solid rgba(15,23,42,.16)",padding:"0 10px",fontSize:13,fontWeight:800,background:"#fff",color:"#0f172a"}}
            >
              {usuarios.length ? usuarios.map(item => (
                <option key={item.id} value={item.id}>
                  {(DEMO_ROLE_LABELS[item.rol] || item.rol)} - {item.nombre || item.email}
                </option>
              )) : (
                <option value={activeUserId}>{currentUserLabel}</option>
              )}
            </select>
            <span style={{fontSize:10,fontWeight:600,color:"#64748b",lineHeight:1.35}}>
              El backend entrega un token nuevo, asi que permisos, menu y vistas se recalculan como una cuenta real.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

function PasswordChangeRequired({ user, onChanged, onLogout }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!actual || !nueva || !repetir) {
      setError("Completa la contrasena actual y la nueva contrasena.");
      return;
    }
    if (nueva.length < 8) {
      setError("La nueva contrasena debe tener al menos 8 caracteres.");
      return;
    }
    if (nueva !== repetir) {
      setError("La nueva contrasena y su repeticion no coinciden.");
      return;
    }
    if (actual === nueva) {
      setError("La nueva contrasena debe ser distinta a la provisional.");
      return;
    }
    try {
      setSaving(true);
      await cambiarPassword(actual, nueva);
      await onChanged?.();
      window.dispatchEvent(new CustomEvent("tms:notify", { detail:{ type:"success", message:"Contrasena actualizada correctamente." } }));
    } catch (err) {
      setError(err?.message || "No se pudo cambiar la contrasena.");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width:"100%",
    height:46,
    border:"1px solid var(--border)",
    borderRadius:8,
    padding:"0 12px",
    background:"var(--bg2)",
    color:"var(--text)",
    fontSize:14,
    boxSizing:"border-box",
  };

  return (
    <div style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:20,background:"var(--bg)",color:"var(--text)",fontFamily:"'DM Sans',sans-serif"}}>
      <form onSubmit={handleSubmit} style={{width:"min(460px,100%)",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,boxShadow:"0 18px 50px rgba(15,23,42,.14)",padding:24}}>
        <div style={{fontSize:12,fontWeight:900,letterSpacing:.8,textTransform:"uppercase",color:"var(--muted)",marginBottom:8}}>Primer acceso</div>
        <h1 style={{fontSize:28,margin:"0 0 8px",lineHeight:1.1,color:"var(--text)"}}>Cambia tu contrasena</h1>
        <p style={{margin:"0 0 20px",color:"var(--muted)",fontSize:14,lineHeight:1.5}}>
          Hola{user?.nombre ? `, ${user.nombre}` : ""}. Para entrar en TransGest tienes que guardar una contrasena propia.
        </p>
        <label style={{display:"grid",gap:6,marginBottom:12,fontSize:12,fontWeight:900,color:"var(--muted)",textTransform:"uppercase"}}>
          Contrasena actual
          <input style={inputStyle} type="password" value={actual} onChange={e=>setActual(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        <label style={{display:"grid",gap:6,marginBottom:12,fontSize:12,fontWeight:900,color:"var(--muted)",textTransform:"uppercase"}}>
          Nueva contrasena
          <input style={inputStyle} type="password" value={nueva} onChange={e=>setNueva(e.target.value)} autoComplete="new-password" />
        </label>
        <label style={{display:"grid",gap:6,marginBottom:12,fontSize:12,fontWeight:900,color:"var(--muted)",textTransform:"uppercase"}}>
          Repetir nueva contrasena
          <input style={inputStyle} type="password" value={repetir} onChange={e=>setRepetir(e.target.value)} autoComplete="new-password" />
        </label>
        {error ? <div style={{margin:"8px 0 14px",padding:"10px 12px",borderRadius:8,background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.35)",color:"#b91c1c",fontSize:13,fontWeight:800}}>{error}</div> : null}
        <div style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"center",marginTop:16,flexWrap:"wrap"}}>
          <button type="button" onClick={onLogout} style={{height:42,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontWeight:900,padding:"0 14px",cursor:"pointer"}}>
            Salir
          </button>
          <button type="submit" disabled={saving} style={{height:42,borderRadius:8,border:"1px solid #008577",background:"#008577",color:"#fff",fontWeight:900,padding:"0 18px",cursor:saving?"wait":"pointer",opacity:saving ? .8 : 1}}>
            {saving ? "Guardando..." : "Guardar y entrar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AppInner() {
  const { user, loading, refreshUser, logout } = useAuth();
  const [vista, setVista] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [avisosCriticos,   setAvisosCriticos]   = useState(0);
  const [clientesPendientes, setClientesPendientes] = useState(0);
  const [tallerPendientes, setTallerPendientes] = useState(0);
  const [vehiculoAlertas,  setVehiculoAlertas]  = useState(0);
  const [excepcionesPendientes, setExcepcionesPendientes] = useState(0);
  const [notificacionesNoLeidas, setNotificacionesNoLeidas] = useState(0);
  const [solicitudesPendientes, setSolicitudesPendientes] = useState(0);
  const [colaboradoresPendientes, setColaboradoresPendientes] = useState(0);
  const [avisosOperativosColaboradores, setAvisosOperativosColaboradores] = useState({ items: [], resumen: {} });
  const [avisosOperativosOpen, setAvisosOperativosOpen] = useState(false);
  const [startupTasks, setStartupTasks] = useState({ visible:false, pasadas:[], hoy:[], manana:[] });
  const [pedidoActionMenuOpen, setPedidoActionMenuOpen] = useState(false);
  const [guidedModule, setGuidedModule] = useState(null);

  // Ã¢â€â‚¬Ã¢â€â‚¬ Estado de bloqueo por suscripciÃƒÂ³n Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const [bloqueado, setBloqueado] = useState(() => {
    try {
      if (typeof window !== "undefined" && window.__TMS_BLOQUEADO && typeof window.__TMS_BLOQUEADO === "object") {
        return window.__TMS_BLOQUEADO;
      }
      return JSON.parse(localStorage.getItem("tms_bloqueado")||"null");
    } catch { return null; }
  });
  const [avisoSuscripcion, setAvisoSuscripcion] = useState(() => {
    try {
      const s = (typeof window !== "undefined" && window.__TMS_SUSCRIPCION && typeof window.__TMS_SUSCRIPCION === "object")
        ? window.__TMS_SUSCRIPCION
        : JSON.parse(localStorage.getItem("tms_suscripcion")||"null");
      return s?.aviso ? s : null;
    } catch { return null; }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePedidoActionMenu = (event) => setPedidoActionMenuOpen(Boolean(event?.detail?.open));
    window.addEventListener("tms:pedido-action-menu", handlePedidoActionMenu);
    return () => window.removeEventListener("tms:pedido-action-menu", handlePedidoActionMenu);
  }, []);

  useEffect(() => {
    const handleBloqueado = (e) => setBloqueado(e.detail);
    window.addEventListener("tms:bloqueado", handleBloqueado);
    return () => window.removeEventListener("tms:bloqueado", handleBloqueado);
  }, []);

  useEffect(() => {
    const handleNavegar = (e) => {
      if (typeof e.detail === "string" && e.detail) setVista(e.detail);
    };
    window.addEventListener("tms:navegar", handleNavegar);
    return () => window.removeEventListener("tms:navegar", handleNavegar);
  }, []);

  useEffect(() => {
    const handleGuidedStart = (e) => {
      const detail = e?.detail || {};
      if (detail.type !== "module_walkthrough" || !detail.route) return;
      setGuidedModule({ active:true, route:detail.route, source:detail.source || "onboarding", startedAt:detail.startedAt || new Date().toISOString() });
    };
    window.addEventListener("tms:guided-tutorial-start", handleGuidedStart);
    return () => window.removeEventListener("tms:guided-tutorial-start", handleGuidedStart);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user?.debe_cambiar_password) return;
    setVista(VISTA_DEFAULT(user.rol));
    const isChoferAppOnly = user?.rol === "chofer";
    if (!isChoferAppOnly) {
      getEmpresaBackend({ silentError:true, timeoutMs:12000 })
        .then(perfil => {
          if (!perfil || typeof perfil !== "object") return;
          saveEmpresa(perfil);
          if (perfil.paleta_colores) saveCompanyPalette(perfil.paleta_colores);
        })
        .catch(() => {});
    }
    if (isChoferAppOnly) return;
    // Badges: defer 3s so dashboard renders first, then load in background
    function calcTallerBadge() {
      getTallerEstado().then(t => {
        const solicitudes = Array.isArray(t?.solicitudes_mecanico) ? t.solicitudes_mecanico : [];
        const tareas = Array.isArray(t?.tareas_mecanicos) ? t.tareas_mecanicos : [];
        const stock = Array.isArray(t?.stock) ? t.stock : [];
        const avisos = Array.isArray(t?.avisos_mant) ? t.avisos_mant : [];
        setTallerPendientes(
          solicitudes.filter(s=>s.estado==="pendiente").length +
          tareas.filter(t=>["pendiente","en_curso"].includes(t.estado)).length +
          stock.filter(s=>Number(s.stock_actual||0)<=Number(s.stock_minimo||0)).length +
          avisos.filter(a=>a.activo!==false && a.estado!=="resuelto").length
        );
      }).catch(()=>{});
    }
    function calcNotificacionesBadge(extraAvisos = null) {
      return getNotificaciones(20)
        .then(d => {
          const noLeidas = Number(d?.no_leidas || 0);
          setNotificacionesNoLeidas(noLeidas);
          setAvisosCriticos(noLeidas);
          return noLeidas;
        })
        .catch(() => 0);
    }
    function calcColaboradoresBadge() {
      if (!["gerente","trafico","administrativo","contable"].includes(user?.rol)) return Promise.resolve(0);
      return getColaboradoresPendientesRevision()
        .then(d => {
          const count = Number(d?.count || 0);
          setColaboradoresPendientes(count);
          return count;
        })
        .catch(() => 0);
    }
    function calcAvisosOperativosColaboradores() {
      if (!["gerente","trafico","administrativo","contable"].includes(user?.rol)) return Promise.resolve({ items: [], resumen: {} });
      return getAvisosOperativosColaboradores()
        .then(d => {
          const next = d && Array.isArray(d.items) ? d : { items: [], resumen: {} };
          setAvisosOperativosColaboradores(next);
          const vistos = readAvimSeen(user);
          const nuevos = (next.items || []).filter(item => !vistos.has(avimAlertKey(item)));
          if (nuevos.length > 0 && !readAvimMinimized(user)) setAvisosOperativosOpen(true);
          return next;
        })
        .catch(() => ({ items: [], resumen: {} }));
    }
    function calcStartupTasks() {
      if (!["gerente","trafico","administrativo","contable","responsable_taller"].includes(user?.rol)) return Promise.resolve(null);
      const key = `tms_startup_tasks_seen_${user?.empresa_id || "empresa"}_${user?.id || "user"}_${dateKey(new Date())}`;
      try {
        if (window.sessionStorage.getItem(key) === "1") return Promise.resolve(null);
      } catch {}
      const desde = addDaysKey(-14);
      const hasta = addDaysKey(1);
      return getAgendaEventos({ desde, hasta, estado:"pendiente" })
        .then(payload => {
          const arr = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.eventos) ? payload.eventos : [];
          const today = addDaysKey(0);
          const tomorrow = addDaysKey(1);
          const abiertas = arr.filter(ev => !["completada","cancelada","cerrada"].includes(String(ev.estado || "").toLowerCase()));
          const next = {
            visible: false,
            pasadas: abiertas.filter(ev => dateKey(ev.fecha_inicio || ev.start || ev.fecha) && dateKey(ev.fecha_inicio || ev.start || ev.fecha) < today),
            hoy: abiertas.filter(ev => dateKey(ev.fecha_inicio || ev.start || ev.fecha) === today),
            manana: abiertas.filter(ev => dateKey(ev.fecha_inicio || ev.start || ev.fecha) === tomorrow),
          };
          next.visible = next.pasadas.length + next.hoy.length + next.manana.length > 0;
          if (next.visible) {
            setStartupTasks(next);
            try { window.sessionStorage.setItem(key, "1"); } catch {}
          }
          return next;
        })
        .catch(() => null);
    }
    function calcSolicitudesBadge() {
      if (!["gerente","trafico","administrativo","contable"].includes(user?.rol)) return Promise.resolve(0);
      return getPortalSolicitudesAdmin({ estado:"pendiente" })
        .then(d => {
          const count = Array.isArray(d) ? d.length : 0;
          setSolicitudesPendientes(count);
          return count;
        })
        .catch(() => 0);
    }
    const puedeVerBadgeTaller = ["gerente","contable","responsable_taller","trafico"].includes(user?.rol);
    const puedeVerAlertasVehiculos = ["gerente","trafico","responsable_taller","contable"].includes(user?.rol);
    calcNotificacionesBadge();
    const notifRefresh = () => calcNotificacionesBadge();
    const solicitudesRefresh = () => calcSolicitudesBadge();
    const colaboradoresRefresh = () => calcColaboradoresBadge();
    const avisosOperativosRefresh = () => calcAvisosOperativosColaboradores();
    window.addEventListener("tms:notificaciones-refresh", notifRefresh);
    window.addEventListener("tms:solicitudes-refresh", solicitudesRefresh);
    window.addEventListener("tms:colaboradores-refresh", colaboradoresRefresh);
    window.addEventListener("tms:agenda-refresh", avisosOperativosRefresh);
    window.addEventListener("tms:pedidos-changed", avisosOperativosRefresh);
    const tallerIv = puedeVerBadgeTaller ? setInterval(calcTallerBadge, 30000) : null;

    const earlyBadgeTimer = setTimeout(() => {
      if (puedeVerBadgeTaller) calcTallerBadge();
      calcSolicitudesBadge();
      calcColaboradoresBadge();
      calcAvisosOperativosColaboradores();
      calcStartupTasks();
    }, 6000);

    // Delay non-critical badge requests so they don't block page render
    const badgeTimer = setTimeout(() => {
      // Single combined fetch for alertas (docs + vehiculos)
      Promise.all([
        getDocsProximosVencer().catch(()=>[]),
        puedeVerAlertasVehiculos ? getAlertasDocVehiculos().catch(()=>[]) : Promise.resolve([]),
      ]).then(([docs, alertasVeh]) => {
        const docsCount = Array.isArray(docs)
          ? docs.filter(d => Math.ceil((new Date(d.fecha_vencimiento)-new Date())/86400000) <= 30).length
          : 0;
        const vehCount = Array.isArray(alertasVeh) ? alertasVeh.length : 0;
        setVehiculoAlertas(vehCount);
        calcNotificacionesBadge(docsCount + vehCount);
      }).catch(()=>{});

      // Clientes pendientes (solo gerente/contable)
      if (["gerente","contable"].includes(user?.rol)) {
        getClientesPendientesRevision()
          .then(d => setClientesPendientes(d?.count || 0))
          .catch(() => {});
        getExcepcionesOperativas()
          .then(d => setExcepcionesPendientes(Number(d?.resumen?.critica || 0) + Number(d?.resumen?.alta || 0)))
          .catch(() => {});
      }
      calcSolicitudesBadge();
      calcColaboradoresBadge();
      calcAvisosOperativosColaboradores();
    }, 12000); // 12s delay: avoid saturating small production instances on first paint

    // Refresh badges every 5 minutes
    const refreshIv = setInterval(() => {
      if (puedeVerAlertasVehiculos) {
        getAlertasDocVehiculos().catch(()=>[])
          .then(d => { if(Array.isArray(d)) setVehiculoAlertas(d.length); });
      }
      calcNotificacionesBadge();
      calcSolicitudesBadge();
      calcColaboradoresBadge();
      calcAvisosOperativosColaboradores();
      if (["gerente","contable"].includes(user?.rol)) {
        getClientesPendientesRevision()
          .then(d => setClientesPendientes(d?.count || 0)).catch(()=>{});
        getExcepcionesOperativas()
          .then(d => setExcepcionesPendientes(Number(d?.resumen?.critica || 0) + Number(d?.resumen?.alta || 0)))
          .catch(()=>{});
      }
    }, 300000); // 5 min refresh

    return () => {
      clearTimeout(earlyBadgeTimer);
      clearTimeout(badgeTimer);
      window.removeEventListener("tms:notificaciones-refresh", notifRefresh);
      window.removeEventListener("tms:solicitudes-refresh", solicitudesRefresh);
      window.removeEventListener("tms:colaboradores-refresh", colaboradoresRefresh);
      window.removeEventListener("tms:agenda-refresh", avisosOperativosRefresh);
      window.removeEventListener("tms:pedidos-changed", avisosOperativosRefresh);
      if (tallerIv) clearInterval(tallerIv);
      clearInterval(refreshIv);
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setShowOnboarding(false);
      return;
    }
    if (user?.debe_cambiar_password) {
      setShowOnboarding(false);
      return;
    }
    const key = onboardingStorageKey(user);
    setShowOnboarding(!localStorage.getItem(key));
  }, [user]);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                  height:"100vh", background:"var(--bg)", color:"#3d4f72",
                  fontFamily:"'DM Sans',sans-serif", fontSize:13 }}>
      Iniciando TransGest...
    </div>
  );
  if (!user) return <Login />;
  if (user?.debe_cambiar_password) return <PasswordChangeRequired user={user} onChanged={refreshUser} onLogout={logout} />;
  if (bloqueado) return <Bloqueado motivo={bloqueado.motivo} mensaje={bloqueado.mensaje} user={user} />;

  // Obtener plan de la empresa del usuario
  const empresaPlan = normalizePlan(user?.plan || getEmpresaPlanLocal());

  const modulosBase = modulosBaseParaUsuario(user);
  const modulosPlan = empresaPlan ? filtrarModulosPorPlan(modulosBase, empresaPlan) : modulosBase;
  const modulos = filtrarModulosPorPermisos(modulosPlan, user.permisos, user.rol);
  const modulosVisibles = new Set(
    modulos.flatMap(grupo => (grupo.items || []).flatMap(item => item.children ? item.children.map(child => child.id) : [item.id]))
  );
  const vistaPreferida = vista || VISTA_DEFAULT(user.rol);
  const primeraVista = modulos.flatMap(grupo => (grupo.items || []).flatMap(item => item.children ? item.children.map(child => child.id) : [item.id]))[0];
  const vistaId = modulosVisibles.has(vistaPreferida) ? vistaPreferida : (primeraVista || VISTA_DEFAULT(user.rol));
  const contenido = VISTAS[vistaId] || (
    <div style={{ padding:40, color:"#3d4f72", fontFamily:"'DM Sans',sans-serif", textAlign:"center" }}>
      MÃƒÂ³dulo en desarrollo
    </div>
  );

  // Resolver IDs de grupos que no tienen vista propia
  function handleSetVista(id) {
    // Si es un grupo sin vista propia, ignorar (el Layout maneja el expand/collapse)
    const GRUPOS_SIN_VISTA = ["cuadrante_grupo","facturacion_grupo","informes_grupo"];
    if (GRUPOS_SIN_VISTA.includes(id)) return;
    if (!modulosVisibles.has(id)) return;
    setVista(id);
  }

  function handleStartTutorial(payload = {}) {
    const route = payload.route;
    if (!route || !modulosVisibles.has(route)) return;
    setRuntimeFocus("tms_guided_tutorial", payload);
    setVista(route);
    if (payload.type === "pedido_create") {
      setGuidedModule(null);
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("tms:guided-tutorial-start", { detail:payload }));
      }, 80);
      return;
    }
    setGuidedModule({
      active:true,
      route,
      source:payload.source || "onboarding",
      startedAt:payload.startedAt || new Date().toISOString(),
    });
  }

  async function handleDemoSessionChanged({ resetVista = false } = {}) {
    const nextUser = await refreshUser();
    if (resetVista) setVista(VISTA_DEFAULT(nextUser?.rol));
    setGuidedModule(null);
    return nextUser;
  }

  return (
    <>
    <LaunchSplash rol={user?.rol} />
    {avisoSuscripcion && (
      <div style={{
        position:"fixed",bottom:0,left:0,right:0,zIndex:1000,
        background:avisoSuscripcion.motivo==="gracia"?"rgba(239,68,68,.95)":"rgba(245,158,11,.95)",
        color:"#fff",padding:"10px 20px",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        fontFamily:"'DM Sans',sans-serif",fontSize:13,gap:12,flexWrap:"wrap",
      }}>
        <span>
          {avisoSuscripcion.motivo==="gracia"
            ? `Ã¢Å¡Â  Tu suscripciÃƒÂ³n venciÃƒÂ³. Tienes ${avisoSuscripcion.dias_gracia_restantes} dÃƒÂ­as de gracia para renovar.`
            : `Ã¢ÂÂ° Tu suscripciÃƒÂ³n vence en ${avisoSuscripcion.dias_restantes} dÃƒÂ­as. Renueva para no perder el acceso.`}
        </span>
        <div style={{display:"flex",gap:8}}>
          <a href="mailto:soporte@transgest.com?subject=RenovaciÃƒÂ³n"
            style={{padding:"5px 14px",borderRadius:6,background:"rgba(255,255,255,.25)",color:"#fff",fontSize:12,fontWeight:700,textDecoration:"none"}}>
            Renovar ahora
          </a>
          <button onClick={()=>setAvisoSuscripcion(null)}
            style={{background:"none",border:"none",color:"rgba(255,255,255,.7)",fontSize:18,cursor:"pointer",padding:"0 4px",lineHeight:1}}>
            Ã¢Å“â€¢
          </button>
        </div>
      </div>
    )}
    <Layout
      vistaActiva={vistaId}
      setVista={handleSetVista}
      modulos={modulos}
      avisosCriticos={avisosCriticos}
      clientesPendientes={clientesPendientes}
      tallerPendientes={tallerPendientes}
      vehiculoAlertas={vehiculoAlertas}
      notificacionesNoLeidas={notificacionesNoLeidas}
      solicitudesPendientes={solicitudesPendientes}
      excepcionesPendientes={excepcionesPendientes}
      colaboradoresPendientes={colaboradoresPendientes}>
      <DemoShowcasePanel
        user={user}
        currentPlan={empresaPlan}
        onSessionChanged={handleDemoSessionChanged}
      />
      <Suspense fallback={<Spinner />}>
        {contenido}
      </Suspense>
    </Layout>
    {user?.rol !== "chofer" && (
      <OperativeAlertsPanel
        user={user}
        data={avisosOperativosColaboradores}
        open={avisosOperativosOpen}
        hidden={pedidoActionMenuOpen}
        onToggle={setAvisosOperativosOpen}
        onRefresh={() => getAvisosOperativosColaboradores().then(d => setAvisosOperativosColaboradores(d && Array.isArray(d.items) ? d : { items: [], resumen: {} })).catch(()=>{})}
        onMarkRead={(items) => {
          const next = readAvimSeen(user);
          (Array.isArray(items) ? items : []).forEach(item => next.add(avimAlertKey(item)));
          writeAvimSeen(user, next);
          setAvisosOperativosOpen(false);
          toast("Avisos marcados como leidos. El indicador pequeno se mantiene mientras haya avisos pendientes.", "success");
        }}
        onRemove={(key) => setAvisosOperativosColaboradores(prev => {
          const items = (prev.items || []).filter(item => item.key !== key);
          return { ...prev, items, resumen:{ ...(prev.resumen || {}), total:items.length, alta:items.filter(i=>i.severity==="alta").length, media:items.filter(i=>i.severity==="media").length, albaranes_pendientes:items.filter(i=>i.kind==="albaran_pendiente").length } };
        })}
      />
    )}
    <StartupTasksPanel
      data={startupTasks}
      onClose={() => setStartupTasks(prev => ({ ...prev, visible:false }))}
      onOpenAgenda={() => {
        setStartupTasks(prev => ({ ...prev, visible:false }));
        if (modulosVisibles.has("agenda")) setVista("agenda");
      }}
    />
    <GlobalGuidedModulePanel
      mission={guidedModule}
      onOpenModule={(route) => {
        if (modulosVisibles.has(route)) setVista(route);
      }}
      onClose={() => {
        setGuidedModule(null);
        clearRuntimeFocus("tms_guided_tutorial");
      }}
    />

    {/* Onboarding wizard */}
    {showOnboarding && user && (
      <OnboardingWizard
        user={user}
        visibleModules={Array.from(modulosVisibles)}
        storageKey={onboardingStorageKey(user)}
        onClose={()=>setShowOnboarding(false)}
        onNavegar={(v)=>setVista(v)}
        onStartTutorial={handleStartTutorial}
      />
    )}
    </>
  );
}

function AccountingLaunchRoute() {
  const { user, loading } = useAuth();
  const [message, setMessage] = useState("Preparando sesion segura de empresa...");
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setError("La sesion no esta activa. Vuelve a entrar en TransGest e intenta abrir Contabilidad de nuevo.");
      return;
    }

    let cancelled = false;
    getAccountingLaunch()
      .then(data => {
        if (cancelled) return;
        if (!data?.launch_url) throw new Error("El backend no devolvio una URL de Contabilidad.");
        setMessage("Abriendo TransGest Contabilidad...");
        window.location.replace(data.launch_url);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err?.message || "No se pudo abrir TransGest Contabilidad.");
      });

    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  return (
    <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f5f7f6",color:"#17211d",fontFamily:"'DM Sans',Arial,sans-serif",padding:24}}>
      <main style={{width:"min(440px,100%)",textAlign:"center"}}>
        <h1 style={{fontSize:22,margin:"0 0 8px"}}>TransGest Contabilidad</h1>
        <p style={{margin:"0 0 18px",color:"#60706b",lineHeight:1.5}}>{error || message}</p>
        {error && (
          <button
            type="button"
            onClick={() => window.location.replace("/")}
            style={{border:"1px solid #0f766e",background:"#0f766e",color:"#fff",borderRadius:6,padding:"10px 14px",fontWeight:800,cursor:"pointer"}}
          >
            Volver a TransGest
          </button>
        )}
      </main>
    </div>
  );
}

export default function App() {
  // Special standalone routes (no auth needed)
  const path = window.location.pathname;
  if (path === "/registro" || path.startsWith("/registro/")) {
    return <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0f1420",color:"#e2e8f0",fontFamily:"DM Sans,sans-serif"}}>Cargando...</div>}><Registro /></Suspense>;
  }
  if (path === "/invitacion" || path.startsWith("/invitacion/")) {
    return <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0f1420",color:"#e2e8f0",fontFamily:"DM Sans,sans-serif"}}>Cargando...</div>}><Invitacion /></Suspense>;
  }
  if (path === "/superadmin" || path.startsWith("/superadmin/")) {
    return (
      <ThemeProvider>
        <ToastProvider>
          <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0f1420",color:"#e2e8f0",fontFamily:"DM Sans,sans-serif"}}>Cargando...</div>}>
            <SuperAdmin />
          </Suspense>
        </ToastProvider>
      </ThemeProvider>
    );
  }
  if (path === "/web" || path.startsWith("/web/")) {
    return <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#f8faf8",color:"#17211d",fontFamily:"DM Sans,sans-serif"}}>Cargando...</div>}><WebPublica /></Suspense>;
  }
  if (path === "/contabilidad-launch" || path.startsWith("/contabilidad-launch/")) {
    return (
      <ThemeProvider>
        <MojibakeFixer />
        <ToastProvider>
          <AuthProvider>
            <AccountingLaunchRoute />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <MojibakeFixer />
      <ToastProvider>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

