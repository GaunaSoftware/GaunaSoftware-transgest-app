export function madridDate(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// The choice updates the agreed date; actual timestamps remain independent.
export async function askOperationalDateChoice(order, nextState, role, confirmDialog, now = new Date()) {
  const state = String(nextState || "").toLowerCase();
  const current = String(order?.estado || "").toLowerCase();
  const load = ["espera_carga", "cargando", "en_curso"].includes(state);
  const delivery = ["espera_descarga", "descarga", "entregado"].includes(state);
  if (role === "chofer" || current === state || (!load && !delivery)) return {};
  const phase = load ? "carga" : "descarga";
  const key = load ? "fecha_carga_accion" : "fecha_descarga_accion";
  const planned = String(load
    ? order?.fecha_carga_planificada || order?.fecha_carga || ""
    : order?.fecha_descarga_planificada || order?.fecha_descarga || order?.fecha_entrega || "").slice(0, 10);
  const today = madridDate(now);
  if (!planned || planned === today) return {};
  const answer = await confirmDialog({
    title: `Fecha de ${phase} distinta de la prevista`,
    message: `La ${phase} estaba prevista para ${planned} y vas a marcar «${state.replaceAll("_", " ")}» hoy (${today}). ¿Quieres cambiar la fecha prevista del pedido a hoy o conservarla? El cambio de estado y la fecha real se registran por separado.`,
    confirmText: "Cambiar fecha a hoy",
    alternateText: "Conservar fecha prevista",
    tone: "warning",
  });
  if (!answer) return null;
  return { [key]: answer === "alternate" ? "conservar" : "hoy" };
}
