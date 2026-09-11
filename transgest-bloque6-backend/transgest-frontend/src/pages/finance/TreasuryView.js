import { CartesianGrid, Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { Button, DataTable, KpiCard, MobileDataCard, Section } from "../../ui";

export function TreasuryChart({ forecast, money }) {
  let accumulated = forecast.capitalActual;
  const evolution = [{ label: "Actual", saldo: accumulated }, ...forecast.buckets.map(bucket => {
    accumulated += bucket.cobros - bucket.pagos;
    return { label: bucket.label, saldo: accumulated };
  })];
  const color = forecast.saldoPrevisto30 < 0 ? "var(--red)" : "var(--accent-l)";
  return <div className="finance-chart" role="img" aria-label={`Evolución del saldo previsto por plazos: ${evolution.map(item => `${item.label}: ${money(item.saldo)} euros`).join('; ')}`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={evolution} margin={{ top: 12, right: 14, bottom: 0, left: 0 }} accessibilityLayer><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={{ fill: "var(--text3)", fontSize: 11 }} /><YAxis width={65} tick={{ fill: "var(--text3)", fontSize: 11 }} tickFormatter={value => `${Math.round(value / 1000)}k €`} /><Tooltip formatter={value => [`${money(value)} €`, "Saldo previsto"]} contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border)", color: "var(--text)" }} /><ReferenceLine y={0} stroke="var(--border2)" /><Area type="linear" dataKey="saldo" stroke={color} fill={color} fillOpacity={0.09} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>;
}

export default function TreasuryView({ forecast, money, date, onReport }) {
  return <Section title="Tesorería" actions={<Button onClick={onReport}>Informe tesorería</Button>}>
    <div className="finance-treasury-kpis"><KpiCard icon="wallet" label="Saldo actual" value={`${money(forecast.capitalActual)} €`} detail="Se modifica desde Mi Empresa > Tesorería" /><p>La curva muestra el saldo acumulado con los cobros y pagos previstos. El saldo a 30 días se consulta en la cabecera.</p></div>
    <TreasuryChart forecast={forecast} money={money} />
    <DataTable rows={forecast.buckets} rowKey={b => b.key} columns={[{ key: "label", label: "Vencimiento" }, { key: "cobros", label: "Cobros", render: b => `${money(b.cobros)} €` }, { key: "pagos", label: "Pagos", render: b => `${money(b.pagos)} €` }, { key: "neto", label: "Neto", render: b => <span className={b.cobros - b.pagos < 0 ? "tgui-tone--danger" : "tgui-number"}>{money(b.cobros - b.pagos)} €</span> }]} />
    {forecast.proximos.length > 0 && <div className="finance-upcoming"><h3>Próximos movimientos</h3>{forecast.proximos.map((item, idx) => <MobileDataCard key={`${item.tipo}-${item.id || item.pedido_id || idx}`} title={item.titulo} amount={`${item.tipo === "cobro" ? "+" : "−"}${money(item.importe)} €`} subtitle={item.subtitulo}>{date(item.fecha)} · {item.tipo === "cobro" ? "Cobro" : "Pago"}</MobileDataCard>)}</div>}
  </Section>;
}
