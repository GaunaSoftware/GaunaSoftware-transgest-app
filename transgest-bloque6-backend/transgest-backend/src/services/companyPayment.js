// Transport B2B payment settings. Keep this pure module identical in frontend/backend.
const PAYMENT_METHODS = ['Transferencia bancaria', 'Pagaré', 'Domiciliación bancaria', 'Confirming', 'Cheque'];
const clean = value => String(value ?? '').trim();
function paymentDays(profile, party) {
  const raw = profile[`plazo_pago_${party}`];
  return raw === undefined || raw === null || raw === '' ? 30 : Number(raw);
}
function validateCompanyPaymentSettings(profile = {}) {
  for (const party of ['clientes', 'colaboradores']) {
    const days = paymentDays(profile, party);
    if (!Number.isInteger(days) || days < 0 || days > 60) return `El plazo de pago de ${party} debe estar entre 0 y 60 días naturales.`;
    const fixed = clean(profile[`dias_pago_${party}`]);
    if (fixed && fixed.split(',').some(day => !/^\d{1,2}$/.test(day.trim()) || Number(day) < 1 || Number(day) > 31)) return `Los días de pago de ${party} deben ser números del 1 al 31 separados por comas.`;
    const basis = profile[`forma_pago_${party}`];
    if (basis && !['recepcion_factura', 'dias_fijos', 'fin_mes', 'transferencia_inmediata', 'contado'].includes(basis)) return `Selecciona un criterio de vencimiento válido para ${party}.`;
    if (clean(profile[`medio_pago_${party}`]).length > 120) return `El medio de pago de ${party} admite un máximo de 120 caracteres.`;
    const note = clean(profile[`texto_pago_${party}`]);
    if (note.length > 500) return `Las condiciones de ${party} admiten un máximo de 500 caracteres.`;
    if ([...note.matchAll(/(\d+)\s*d[ií]as/gi)].some(match => Number(match[1]) > 60)) return `Las condiciones de ${party} no pueden indicar un plazo superior a 60 días naturales.`;
  }
  return '';
}
function formatCompanyPaymentTerms(profile = {}, party = 'clientes') {
  const custom = clean(profile[`texto_pago_${party}`]);
  if (custom) return custom;
  const basis = profile[`forma_pago_${party}`] || 'recepcion_factura';
  const method = clean(profile[`medio_pago_${party}`]) || 'Transferencia bancaria';
  if (basis === 'transferencia_inmediata' || basis === 'contado') return `${method} · al contado`;
  const days = paymentDays(profile, party);
  const fixed = clean(profile[`dias_pago_${party}`]);
  const adjustment = basis === 'fin_mes' ? ' · fin de mes' : basis === 'dias_fijos' && fixed ? ` · días de pago: ${fixed}` : '';
  return `${method} · ${days} días naturales desde recepción de factura (plazo pactado)${adjustment}${adjustment ? '; sin superar 60 días naturales desde el inicio del cómputo' : ''}`;
}
function calculateCompanyPaymentDate(date, profile = {}, party = 'colaboradores') {
  const raw = clean(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const start = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== raw) return null;
  const basis = profile[`forma_pago_${party}`] || 'recepcion_factura';
  const days = basis === 'transferencia_inmediata' || basis === 'contado' ? 0 : Math.min(60, Math.max(0, paymentDays(profile, party)));
  if (!Number.isFinite(days)) return null;
  const limit = new Date(start); limit.setUTCDate(limit.getUTCDate() + 60);
  let due = new Date(start); due.setUTCDate(due.getUTCDate() + days);
  if (basis === 'fin_mes') due = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0));
  if (basis === 'dias_fijos') {
    const fixed = clean(profile[`dias_pago_${party}`]).split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 31).sort((a,b) => a-b);
    if (fixed.length) {
      const year = due.getUTCFullYear(), month = due.getUTCMonth();
      const candidates = [0,1].flatMap(offset => fixed.map(day => new Date(Date.UTC(year, month + offset, Math.min(day, new Date(Date.UTC(year, month + offset + 1, 0)).getUTCDate())))));
      due = candidates.find(candidate => candidate >= due) || due;
    }
  }
  return new Date(Math.min(due.getTime(), limit.getTime())).toISOString().slice(0, 10);
}
module.exports = { PAYMENT_METHODS, validateCompanyPaymentSettings, formatCompanyPaymentTerms, calculateCompanyPaymentDate };
