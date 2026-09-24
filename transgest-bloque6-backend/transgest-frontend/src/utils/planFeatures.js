const PLAN_ALIAS = {
  planner: "profesional",
  pro_planner: "profesional",
  lite: "lite",
  mini: "lite",
  transgest_lite: "lite",
  transgest_mini: "lite",
  basic: "basico",
  basico: "basico",
  profesional: "profesional",
  professional: "profesional",
  pro: "profesional",
  transgest_pro: "profesional",
  control: "basico",
  transgest_control: "basico",
  go: "lite",
  transgest_go: "lite",
  pro_intelligence: "enterprise",
  transgest_pro_intelligence: "enterprise",
  enterprise: "enterprise",
};

export function normalizePlan(plan) {
  return PLAN_ALIAS[String(plan || "").trim().toLowerCase()] || "unknown";
}

export function getEmpresaPlanLocal() {
  try {
    const token = (typeof window !== "undefined" && typeof window.__TMS_TOKEN === "string")
      ? window.__TMS_TOKEN
      : localStorage.getItem("tms_token");
    if (token) {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload?.plan) return normalizePlan(payload.plan);
    }
  } catch {}
  try {
    const sub = (typeof window !== "undefined" && window.__TMS_SUSCRIPCION && typeof window.__TMS_SUSCRIPCION === "object")
      ? window.__TMS_SUSCRIPCION
      : JSON.parse(localStorage.getItem("tms_suscripcion") || "null");
    if (sub?.plan) return normalizePlan(sub.plan);
  } catch {}
  return "unknown";
}

const PLAN_FEATURES = {
  lite: {
    ai: false,
    kpis_avanzados: false,
    here_routing: false,
    optimizacion_rutas: false,
    gestion_rutas: true,
    contabilidad: false,
    taller: false,
    importacion: true,
    objetivos: false,
  },
  basico: {
    ai: false,
    kpis_avanzados: false,
    here_routing: false,
    optimizacion_rutas: false,
    gestion_rutas: true,
    contabilidad: false,
    taller: false,
    importacion: true,
    objetivos: false,
  },
  profesional: {
    ai: false,
    kpis_avanzados: true,
    here_routing: true,
    optimizacion_rutas: true,
    gestion_rutas: true,
    contabilidad: true,
    taller: true,
    importacion: true,
    objetivos: false,
  },
  enterprise: {
    ai: true,
    kpis_avanzados: true,
    here_routing: true,
    optimizacion_rutas: true,
    gestion_rutas: true,
    contabilidad: true,
    taller: true,
    importacion: true,
    objetivos: true,
  },
};

export function planHasFeature(plan, feature) {
  const normalized = normalizePlan(plan);
  return Boolean(PLAN_FEATURES[normalized]?.[feature]);
}
