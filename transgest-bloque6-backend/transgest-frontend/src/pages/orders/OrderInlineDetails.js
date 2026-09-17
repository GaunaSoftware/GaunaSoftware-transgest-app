import { Button } from "../../ui";
import { cargoCount } from "../../utils/cargoDimensions";
import { driverName, orderRig, incidentDescription } from "./quickInfo";

// Presentation shared by the table and responsive cards; the parent loads once.
export default function OrderInlineDetails({ pedido, data, error, onRetry, vehicles, drivers, labels, describe }) {
  const p = { ...pedido, ...data };
  const route = describe(p);
  const driver = drivers.find(d => String(d.id) === String(p.chofer_id));
  const effectiveDriver = [p.conductor_efectivo_nombre, p.conductor_efectivo_apellidos].filter(Boolean).join(" ");
  const fields = [
    ["Cliente", p.cliente_nombre], ["Referencia del cliente", p.referencia_cliente],
    ["Estado", labels[p.estado] || p.estado], ["Colaborador", p.colaborador_nombre || (p.colaborador_id ? "Asignado" : "Flota propia / sin colaborador")],
    ["Conjunto", orderRig(p, vehicles)], ["Conductor", effectiveDriver || driverName(driver || {}, p)],
    ["Mercancía", p.mercancia], ["Peso", p.peso_kg != null && p.peso_kg !== "" ? `${Number(p.peso_kg).toLocaleString('es-ES')} kg` : null],
    ["Palets / bultos", cargoCount(p) || null], ["Tipo de carga", p.tipo_carga === "grupaje" ? "Grupaje" : p.tipo_carga === "completa" ? "Carga completa" : null],
    ["Kilómetros en ruta", p.km_ruta], ["Incidencia", incidentDescription(p)],
  ];
  return <section className="orders-inline-details" aria-label={`Resumen completo de ${p.numero}`}>
    <header><strong>Información del pedido · {p.numero}</strong>{!data && !error && <span role="status">Cargando detalles…</span>}</header>
    {error && <div role="alert">No se han podido cargar todos los detalles. <Button onClick={onRetry}>Reintentar</Button></div>}
    <dl>{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value == null || value === "" ? "—" : value}</dd></div>)}</dl>
    <div className="orders-inline-stops"><div><h3>Cargas y horarios</h3><p>{route.loadDetails || route.origin || p.origen || "—"}</p></div><div><h3>Descargas y horarios</h3><p>{route.unloadDetails || route.destination || p.destino || "—"}</p></div></div>
    {(p.notas || p.condiciones_adicionales) && <div className="orders-inline-stops">{p.notas && <div><h3>Notas internas</h3><p>{p.notas}</p></div>}{p.condiciones_adicionales && <div><h3>Condiciones del encargo</h3><p>{p.condiciones_adicionales}</p></div>}</div>}
  </section>;
}
