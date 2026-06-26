import { useMemo, useState } from "react";
import { setRuntimeFocus } from "../services/runtimeFocus";

const ROLE_LABEL = {
  gerente: "gerencia",
  trafico: "tr\u00e1fico",
  administrativo: "administraci\u00f3n",
  contable: "contabilidad",
  responsable_taller: "taller",
  chofer: "chofer",
  visualizador: "consulta",
};

const ROLE_STEPS = {
  gerente: [
    ["dashboard", "Vista general del negocio", "Revisa de un vistazo camiones, pedidos, facturaci\u00f3n, incidencias y avisos importantes."],
    ["control_tower", "Control Tower", "Abre el seguimiento operativo separado del dashboard para ver viajes, estados y excepciones sin mezclarlo con KPIs."],
    ["pedidos", "Pedidos y \u00f3rdenes de carga", "Crea pedidos, asigna veh\u00edculo o colaborador, genera la orden de carga y controla el margen."],
    ["plan_diario", "Plan diario", "Comprueba qu\u00e9 har\u00e1 cada cami\u00f3n ma\u00f1ana, reordena viajes y prepara el env\u00edo al chofer."],
    ["facturacion", "Facturaci\u00f3n", "Revisa viajes realizados, documentaci\u00f3n pendiente, facturas emitidas y pagos a colaboradores."],
    ["avisos", "Avisos operativos", "Gestiona vencimientos, documentaci\u00f3n, alertas ignoradas y recordatorios importantes para gerencia."],
  ],
  trafico: [
    ["gestion_trafico", "Gesti\u00f3n de tr\u00e1fico", "Trabaja la semana y el mes en curso, localiza pedidos sin asignar y copia datos del chofer r\u00e1pido."],
    ["pedidos", "Crear pedidos", "Usa nuevo pedido o pedido r\u00e1pido, completa puntos, fechas, horas, precios y asignaciones."],
    ["plan_diario", "Plan diario", "Arrastra pedidos a veh\u00edculos o colaboradores, cambia el orden y prepara el plan diario."],
    ["colaboradores", "Colaboradores", "Asigna viajes subcontratados, revisa precios acordados, m\u00ednimos y documentaci\u00f3n pendiente."],
    ["documentos", "Documentos", "Adjunta CMR, POD, albaranes y soportes para dejar cada viaje listo para facturar."],
    ["avisos", "Avisos y agenda", "Convierte avisos en recordatorios y atiende alertas de carga, descarga o documentaci\u00f3n."],
  ],
  administrativo: [
    ["pedidos", "Pedidos administrativos", "Consulta viajes, completa documentaci\u00f3n y deja preparado lo necesario para facturar."],
    ["facturacion", "Facturas", "Revisa importes, IVA, documentos obligatorios y estado de cobro."],
    ["documentos", "Documentaci\u00f3n", "Sube albaranes, CMR, POD y archivos recibidos por correo o proveedor."],
    ["agenda", "Agenda y recordatorios", "Crea avisos manuales y recibe recordatorios visuales de tareas pendientes."],
    ["clientes", "Clientes", "Mant\u00e9n datos fiscales y contactos para pedidos, facturas y portal cliente."],
  ],
  contable: [
    ["facturacion", "Revisi\u00f3n de facturas", "Controla facturas emitidas, pendientes, cobros, pagos y documentaci\u00f3n bloqueante."],
    ["contabilidad", "Contabilidad", "Revisa datos fiscales, colas, vencimientos y estado de gesti\u00f3n contable."],
    ["pedidos", "Pedidos facturables", "Comprueba viajes realizados, albaranes y precios antes de cerrar la factura."],
    ["documentos", "Soportes documentales", "Valida albaranes, CMR, POD y facturas de proveedor."],
    ["informes", "Informes", "Consulta rentabilidad, incidencias y resumen econ\u00f3mico."],
  ],
  responsable_taller: [
    ["taller", "Taller", "Gestiona tareas, mantenimientos, revisiones, aceite, piezas y solicitudes mec\u00e1nicas."],
    ["vehiculos", "Veh\u00edculos", "Revisa documentaci\u00f3n, estado, vencimientos y asignaciones de la flota."],
    ["avisos", "Avisos de mantenimiento", "Atiende alertas de ITV, seguro, revisiones y tareas pendientes."],
    ["agenda", "Agenda", "Programa visitas, revisiones y recordatorios de taller."],
  ],
  chofer: [
    ["app_chofer", "App de chofer", "Consulta tus viajes, datos de carga y descarga, documentos y acciones pendientes."],
    ["agenda", "Agenda", "Revisa avisos internos, citas y recordatorios asignados."],
    ["documentos", "Documentos", "Consulta o adjunta documentaci\u00f3n operativa cuando est\u00e9 disponible para tu perfil."],
    ["rutas_recomendadas_chofer", "Rutas recomendadas", "Consulta rutas preparadas cuando tr\u00e1fico las haya enviado."],
  ],
  visualizador: [
    ["dashboard", "Dashboard", "Consulta el estado general sin modificar datos."],
    ["control_tower", "Control Tower", "Sigue viajes y excepciones operativas en modo consulta."],
    ["pedidos", "Pedidos", "Revisa pedidos, estados y documentaci\u00f3n disponible."],
    ["plan_diario", "Plan diario", "Consulta la planificaci\u00f3n diaria de camiones y choferes."],
  ],
};

const MODULE_LABEL = {
  dashboard: "Dashboard",
  control_tower: "Control Tower",
  agenda: "Agenda",
  pedidos: "Pedidos",
  plan_diario: "Plan diario",
  gestion_trafico: "Gesti\u00f3n de tr\u00e1fico",
  clientes: "Clientes",
  colaboradores: "Colaboradores",
  vehiculos: "Veh\u00edculos",
  choferes: "Choferes",
  taller: "Taller",
  facturacion: "Facturaci\u00f3n",
  contabilidad: "Contabilidad",
  documentos: "Documentos",
  avisos: "Avisos",
  informes: "Informes",
};

function buildSteps(user, visibleModules) {
  const visible = new Set(visibleModules || []);
  const role = user?.rol || "visualizador";
  const base = [
    {
      id: "bienvenida",
      step: "Inicio",
      title: `Gu\u00eda inicial de ${ROLE_LABEL[role] || "usuario"}`,
      route: "",
      body: "Te ense\u00f1o solo las zonas que tu usuario puede usar para que empieces sin ruido: operaciones, avisos, documentos y tareas principales.",
      tips: [
        "El men\u00fa lateral muestra tus m\u00f3dulos autorizados.",
        "Los avisos visuales aparecen arriba cuando hay viajes o documentos pendientes.",
        "Puedes cerrar esta gu\u00eda y no volver\u00e1 a salir para este usuario.",
      ],
    },
  ];
  const roleSteps = ROLE_STEPS[role] || ROLE_STEPS.visualizador;
  const allowed = roleSteps
    .filter(([route]) => visible.has(route))
    .map(([route, title, body], index) => ({
      id: `${role}-${route}-${index}`,
      step: MODULE_LABEL[route] || route,
      title,
      route,
      body,
      tips: getTipsFor(route),
    }));

  if (allowed.length) return [...base, ...allowed];

  return [
    ...base,
    {
      id: "modulos",
      step: "M\u00f3dulos",
      title: "Tus accesos disponibles",
      route: "",
      body: "Tu usuario tiene permisos limitados. Usa el men\u00fa lateral para entrar en las zonas activas y consulta con gerencia si necesitas m\u00e1s acceso.",
      tips: Array.from(visible).slice(0, 5).map(id => MODULE_LABEL[id] || id),
    },
  ];
}

function getTipsFor(route) {
  const tips = {
    pedidos: ["Nuevo pedido crea un viaje completo.", "Pedido r\u00e1pido sirve para alta urgente.", "Al asignar veh\u00edculo o colaborador el pedido pasa a confirmado."],
    gestion_trafico: ["Usa mes en curso por defecto.", "Semana actual alterna la vista semanal.", "Copia datos del chofer para enviarlos r\u00e1pido."],
    plan_diario: ["Arrastra pedidos para asignar.", "Reordena cargas seg\u00fan la ruta real.", "Prepara el plan para WhatsApp o PDF."],
    facturacion: ["Verifica albaranes antes de facturar.", "Revisa IVA y vencimientos.", "Controla cobros y pagos pendientes."],
    contabilidad: ["Consulta colas fiscales.", "Revisa vencimientos.", "Comprueba bloqueos documentales."],
    avisos: ["Convierte avisos en agenda.", "Ignorar avisos queda trazado.", "Gerencia recibe resumen de importantes."],
    documentos: ["Adjunta albaranes y CMR.", "Valida soportes de proveedor.", "Deja el viaje listo para cobro."],
    taller: ["Crea tareas de mantenimiento.", "Controla aceite, ITV y piezas.", "Agenda revisiones futuras."],
    vehiculos: ["Mant\u00e9n matr\u00edculas y remolques.", "Controla vencimientos.", "Asigna conjuntos sin perder trazabilidad."],
    clientes: ["Guarda datos fiscales.", "Mant\u00e9n contactos.", "Facilita pedidos y facturas."],
    control_tower: ["Vista operativa separada.", "Detecta incidencias.", "Prioriza lo urgente."],
    dashboard: ["Resumen ejecutivo.", "Indicadores principales.", "Acceso r\u00e1pido a desviaciones."],
    agenda: ["Crea recordatorios.", "Consulta vencimientos.", "Recibe notificaciones visuales."],
    app_chofer: ["Consulta viajes.", "Revisa instrucciones.", "Adjunta soportes cuando proceda."],
  };
  return tips[route] || ["Consulta datos.", "Revisa pendientes.", "Usa el men\u00fa para volver cuando lo necesites."];
}

export default function OnboardingWizard({ user, visibleModules, storageKey, onClose, onNavegar, onStartTutorial }) {
  const [paso, setPaso] = useState(0);
  const [compact, setCompact] = useState(false);
  const pasos = useMemo(() => buildSteps(user, visibleModules), [user, visibleModules]);
  const p = pasos[Math.min(paso, pasos.length - 1)];
  const isLast = paso >= pasos.length - 1;

  function finish() {
    if (storageKey) localStorage.setItem(storageKey, "1");
    onClose?.();
  }

  function next() {
    if (isLast) finish();
    else setPaso(current => Math.min(current + 1, pasos.length - 1));
  }

  function goToModule() {
    if (p.route) {
      const payload = {
        type: p.route === "pedidos" ? "pedido_create" : "module_walkthrough",
        route: p.route,
        source: "onboarding",
        startedAt: new Date().toISOString(),
      };
      setRuntimeFocus("tms_guided_tutorial", payload);
      onStartTutorial?.(payload);
      window.dispatchEvent(new CustomEvent("tms:guided-tutorial-start", { detail: payload }));
    }
    if (p.route) onNavegar?.(p.route);
    setCompact(true);
  }

  const S = {
    overlay: {
      position: "fixed",
      inset: 0,
      background: compact ? "transparent" : "rgba(3,7,18,.72)",
      zIndex: 9200,
      display: "flex",
      alignItems: compact ? "flex-start" : "center",
      justifyContent: compact ? "flex-end" : "center",
      backdropFilter: compact ? "none" : "blur(4px)",
      padding: compact ? "74px 18px 18px" : 18,
      pointerEvents: "none",
    },
    card: {
      background: "var(--bg2)", borderRadius: 10, padding: compact ? "16px 18px" : "28px 30px",
      width: compact ? "min(390px, calc(100vw - 36px))" : "min(620px, 96vw)", border: "1px solid var(--border)",
      boxShadow: compact ? "0 16px 44px rgba(0,0,0,.24)" : "0 28px 70px rgba(0,0,0,.42)", position: "relative",
      color: "var(--text)", fontFamily: "'DM Sans', sans-serif",
      pointerEvents: "auto",
    },
    label: {
      fontSize: 11, fontWeight: 900, textTransform: "uppercase",
      letterSpacing: ".06em", color: "var(--accent-xl)", marginBottom: 8,
    },
    title: {
      fontFamily: "'Syne', sans-serif", fontSize: compact ? 18 : 24, fontWeight: 900,
      color: "var(--text)", marginBottom: 8, letterSpacing: 0,
    },
    body: {
      fontSize: compact ? 12 : 14, color: "var(--text2)", lineHeight: 1.55,
      marginBottom: compact ? 12 : 18,
    },
    tips: {
      display: "grid", gap: 8, margin: "0 0 22px", padding: 0,
      listStyle: "none",
    },
    tip: {
      border: "1px solid var(--border)", borderRadius: 8,
      padding: compact ? "7px 9px" : "9px 11px", background: "var(--bg)", fontSize: compact ? 11 : 12,
      color: "var(--text3)", fontWeight: 700,
    },
    actions: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
    btnPrimary: {
      padding: "10px 16px", background: "var(--accent)", color: "#fff",
      border: "1px solid var(--accent)", borderRadius: 8, fontSize: 13,
      fontWeight: 900, cursor: "pointer",
    },
    btnSecondary: {
      padding: "10px 14px", background: "var(--bg)", color: "var(--text2)",
      border: "1px solid var(--border)", borderRadius: 8, fontSize: 13,
      fontWeight: 850, cursor: "pointer",
    },
    skip: {
      marginLeft: "auto", background: "none", border: "none",
      color: "var(--text5)", fontSize: 12, fontWeight: 800, cursor: "pointer",
      padding: "8px 4px",
    },
    restore: {
      background: "none", border: "none", color: "var(--accent-xl)",
      fontSize: 11, fontWeight: 900, cursor: "pointer", padding: "7px 2px",
    },
    progress: {
      height: 4, borderRadius: 999, background: "var(--bg4)",
      overflow: "hidden", marginBottom: 18,
    },
    progressBar: {
      height: "100%", width: `${((paso + 1) / pasos.length) * 100}%`,
      background: "var(--accent)", transition: "width .25s ease",
    },
    count: { position: "absolute", top: 18, right: 22, fontSize: 11, color: "var(--text5)", fontWeight: 900 },
  };

  return (
    <div className="tg-onboarding-overlay" style={S.overlay}>
      <style>{`
        @media (max-width: 520px) {
          .tg-onboarding-overlay {
            align-items:flex-start !important;
            justify-content:center !important;
            padding:12px !important;
            overflow:auto !important;
          }
          .tg-onboarding-card {
            width:100% !important;
            max-width:calc(100vw - 24px) !important;
            padding:22px 18px !important;
            max-height:calc(100dvh - 24px) !important;
            overflow:auto !important;
          }
          .tg-onboarding-card [style*="position: absolute"] {
            top:14px !important;
            right:16px !important;
          }
        }
      `}</style>
      <div className="tg-onboarding-card" style={S.card}>
        <div style={S.count}>{paso + 1}/{pasos.length}</div>
        <div style={S.progress}><div style={S.progressBar}/></div>
        <div style={S.label}>{p.step}</div>
        <div style={S.title}>{p.title}</div>
        <div style={S.body}>{p.body}</div>
        <ul style={S.tips}>
          {(p.tips || []).map((tip, idx) => <li key={idx} style={S.tip}>{tip}</li>)}
        </ul>
        <div style={S.actions}>
          {p.route && (
            <button type="button" style={S.btnSecondary} onClick={goToModule}>
              {p.route === "pedidos" ? "Iniciar pedido guiado" : `Iniciar tutorial de ${MODULE_LABEL[p.route] || "m\u00f3dulo"}`}
            </button>
          )}
          {compact && (
            <button type="button" style={S.restore} onClick={() => setCompact(false)}>
              Ampliar tutorial
            </button>
          )}
          <button type="button" style={S.btnPrimary} onClick={next}>
            {isLast ? "Terminar gu\u00eda" : "Siguiente"}
          </button>
          <button type="button" style={S.skip} onClick={finish}>
            No volver a mostrar
          </button>
        </div>
      </div>
    </div>
  );
}
