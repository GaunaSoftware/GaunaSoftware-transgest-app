// Definiciones BI v1: importes netos para servicios; total con impuestos para cobros.
const INVALID_INVOICE_STATES = ['borrador', 'cancelada', 'anulada'];
const isValidInvoice = f => !!f && !!f.estado && !INVALID_INVOICE_STATES.includes(String(f.estado).toLowerCase());
const validInvoiceSql = alias => `${alias ? alias + '.' : ''}estado::text NOT IN ('borrador','cancelada','anulada')`;
const money = n => n == null || n === '' || !Number.isFinite(Number(n)) ? null : Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ratio = (numerator, denominator, scale = 1) => numerator == null || denominator == null || !Number.isFinite(Number(numerator)) || !(Number(denominator) > 0) ? null : money(Number(numerator) / Number(denominator) * scale);
const madridDay = instant => new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(instant).reduce((parts,item) => {if(['year','month','day'].includes(item.type))parts[item.type]=item.value;return parts;},{});
const day = v => {
  if(v instanceof Date || /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(v||''))) {
    const d=new Date(v);if(Number.isNaN(d.getTime()))return '';
    const parts=madridDay(d);return `${parts.year}-${parts.month}-${parts.day}`;
  }
  return String(v||'').slice(0,10);
};
function periodRange(period = '30d', now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = name => today.find(p => p.type === name).value;
  const hasta = `${part('year')}-${part('month')}-${part('day')}`;
  const y = Number(part('year')), m = Number(part('month'));
  if (['all','todo'].includes(period)) return { desde: '1970-01-01', hasta };
  if (period === 'hoy') return { desde: hasta, hasta };
  if (period === 'semana_anterior') {
    const civil=new Date(`${hasta}T12:00:00Z`);
    const weekday=(civil.getUTCDay()+6)%7;
    civil.setUTCDate(civil.getUTCDate()-weekday-7);
    const desde=day(civil);
    civil.setUTCDate(civil.getUTCDate()+6);
    return {desde,hasta:day(civil)};
  }
  if (['mes','mensual'].includes(period)) return { desde: `${part('year')}-${part('month')}-01`, hasta };
  if (['anual','anio','año'].includes(period)) return { desde: `${part('year')}-01-01`, hasta };
  if (['trimestre','semestre'].includes(period)) {
    const size = period === 'trimestre' ? 3 : 6;
    return { desde: `${y}-${String(Math.floor((m - 1) / size) * size + 1).padStart(2, '0')}-01`, hasta };
  }
  const days = { '7d':7, '30d':30, '90d':90, '3m':90, '180d':180, '6m':180, '365d':365, '1y':365 }[period];
  if (!days) throw Object.assign(new Error('Periodo de análisis no válido'), { status: 400 });
  const start = new Date(hasta + 'T12:00:00Z');
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { desde: day(start), hasta };
}
function reportRange(query = {}, now) {
  if (!query.desde && !query.hasta) return periodRange(query.periodo || query.period || '30d', now);
  const valid = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(Date.parse(v)) && day(new Date(v)) === v;
  if (!valid(query.desde) || !valid(query.hasta) || query.desde > query.hasta) throw Object.assign(new Error('Rango de fechas no válido'), { status: 400 });
  return { desde: query.desde, hasta: query.hasta };
}
// El llamante debe aportar un importe de cobro contrastado. Nunca usa la base neta.
function collectionAmounts(total, collected) {
  const gross = money(total), cash = money(collected);
  return { total: gross, cobrado: cash, saldo: gross == null || cash == null ? null : money(gross - cash), porcentaje: ratio(cash, gross, 100) };
}
function metric(value, definition, { unit = 'EUR', status, total = 0, known = total, taxes = 'sin impuestos', denominator = null } = {}) {
  return { valor: value, definicion: definition, unidad: unit, impuestos: taxes, denominador: denominator,
    estado: status || (value == null || total === 0 ? 'sin_datos' : known < total ? 'parcial' : 'completo'),
    cobertura: { evaluables: known, total } };
}
function reportMetadata(range, metrics = {}) {
  return { version: 'bi.v1', periodo: range, fecha_corte: range.hasta, zona_horaria: 'Europe/Madrid',
    alcance: 'empresa autenticada; agregados antes de paginación', generado_en: new Date().toISOString(), metricas: metrics,
    advertencias: ['Los estados de factura no son un registro de movimientos de cobro ni permiten reconstruir un saldo histórico exacto.',
      'Los costes registrados pueden estar incompletos. Un cero por defecto no confirma ausencia de costes.'] };
}
// Periodo economico y costes registrados, sin alterar las fechas operativas.
const financialPedidosCte = `pedidos_bi AS (
  SELECT p.*,
    CASE WHEN p.estado::text IN ('entregado','facturado')
      THEN COALESCE(p.facturacion_mes, NULLIF(to_jsonb(p)->>'entregado_at','')::date, (p.firma_fecha AT TIME ZONE 'Europe/Madrid')::date, p.fecha_descarga, p.fecha_carga, p.fecha_pedido, p.created_at::date)
      ELSE COALESCE(p.fecha_descarga, p.fecha_carga, p.fecha_pedido, p.created_at::date)
    END AS fecha_bi,
    COALESCE(p.precio_colaborador,0) + COALESCE(p.coste_gasoil,0)
      + COALESCE(p.coste_peajes,0) + COALESCE(p.coste_dietas,0) + COALESCE(p.coste_otros,0)
      + COALESCE((SELECT SUM(pe.importe) FROM pedido_extracostes pe WHERE pe.pedido_id=p.id),0) AS coste_operativo,
    NOT EXISTS (SELECT 1 FROM facturas f WHERE f.empresa_id=p.empresa_id
      AND (f.id=p.factura_id OR EXISTS (SELECT 1 FROM factura_pedidos fp WHERE fp.factura_id=f.id AND fp.pedido_id=p.id))
      AND f.fecha <= $3 AND ${validInvoiceSql('f')}) AS pendiente_factura
  FROM pedidos p WHERE p.empresa_id=$1
)`;



module.exports = { financialPedidosCte, INVALID_INVOICE_STATES, isValidInvoice, validInvoiceSql, money, ratio, day, periodRange, reportRange, collectionAmounts, metric, reportMetadata };
