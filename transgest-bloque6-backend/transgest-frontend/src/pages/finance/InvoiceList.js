import { Badge, Button, DataTable, DropdownMenu, MobileDataCard } from "../../ui";

const tone = state => ({ cobrada: "success", vencida: "danger", sin_cobrar: "danger", reclamada: "warning", rectificada: "warning", emitida: "info", enviada: "info" }[state] || "neutral");
export default function InvoiceList({ rows, loading, canEdit, states, stateLabel, money, date, fiscalMeta, openInvoice, rowClick, changeState, sendInvoice, rectify, remove, retryFiscal, openStates, openGroups, toggleGroup, focusedId }) {
  const status = f => <Badge tone={tone(f.estado)}>{stateLabel(f.estado)}</Badge>;
  const fiscal = f => <Badge title={`${fiscalMeta(f).label}: ${fiscalMeta(f).detail}`} tone={!f.fiscal_modo ? "neutral" : f.fiscal_estado_envio === "aceptado" ? "success" : f.fiscal_estado_envio === "error" ? "danger" : "warning"}>{f.fiscal_modo ? `${String(f.fiscal_modo).toUpperCase()} · ${f.fiscal_estado_envio || "pendiente"}` : "Sin registro fiscal"}</Badge>;
  const number = f => <span className="finance-invoice-number">{f.numero}{(f.estado === "rectificada" || (f.serie && !["A", "B"].includes(f.serie))) && <small> RECT.</small>}{Number(f.num_pedidos || 0) === 0 && <small title="Sin pedidos vinculados"> · Revisar</small>}</span>;
  const actions = f => {
    const items = [];
    // Preserve the original state conditions and handlers, including draft state selection.
    if (canEdit && f.estado !== "rectificada") {
      if (f.estado === "borrador") {
        items.push({ label: "Emitir", onClick: () => changeState(f.id, "emitida") });
        items.push({ label: "Cambiar estado…", onClick: () => openStates(f, states) });
      } else {
        if (["emitida", "enviada"].includes(f.estado)) items.push({ label: f.estado === "enviada" ? "Reenviar" : "Enviar", onClick: () => sendInvoice(f) });
        if (f.estado !== "cobrada") items.push({ label: "Marcar cobrada", onClick: () => changeState(f.id, "cobrada") });
        if (!["reclamada", "sin_cobrar", "cobrada", "rectificada"].includes(f.estado)) items.push({ label: "Reclamar", onClick: () => changeState(f.id, "reclamada") });
        if (f.estado === "reclamada") items.push({ label: "Sin cobrar", onClick: () => changeState(f.id, "sin_cobrar") });
      }
      items.push({ label: "Rectificar", onClick: () => rectify(f) });
      if (f.estado !== "borrador" && f.fiscal_modo) items.push({ label: "Fiscal · reencolar", onClick: () => retryFiscal(f.id) });
      if (f.estado === "borrador") items.push({ label: "Eliminar borrador", danger: true, onClick: () => remove(f.id) });
    }
    return <div className="tgui-actions" onClick={e => e.stopPropagation()}><Button onClick={() => openInvoice(f.id, f)} aria-label={`Ver factura ${f.numero}`}>Ver</Button><DropdownMenu label={`Acciones de ${f.numero}`} items={items} /></div>;
  };
  return <DataTable rowId={f => `factura-row-${f.id}`} rows={rows} loading={loading} emptyTitle="Sin facturas" rowKey={f => f.__group ? `cliente-${f.key}` : f.id} onRowClick={rowClick} rowClassName={f => String(focusedId || "") === String(f.id) ? "finance-row-focused" : undefined} renderGroup={group => <Button className="finance-client-group" aria-expanded={!!openGroups[group.key]} onClick={() => toggleGroup(group.key)}><span>{openGroups[group.key] ? "⌄" : "›"} {group.cliente}</span><span>{group.facturas.length} facturas · <span className="tgui-number">{money(group.total)} €</span></span></Button>} columns={[
    { key: "numero", label: "Factura", render: number },
    { key: "cliente_nombre", label: "Cliente" },
    { key: "fecha", label: "Fecha", className: "tgui-table-secondary", render: f => date(f.fecha) },
    { key: "vencimiento", label: "Vencimiento", render: f => date(f.fecha_vencimiento) },
    { key: "base_imponible", label: "Base", className: "finance-tax-column", render: f => f.base_imponible == null ? "—" : `${money(f.base_imponible)} €` },
    { key: "tipo_iva", label: "IVA", className: "finance-tax-column", render: f => f.tipo_iva == null ? "—" : `${Number(f.tipo_iva)}%` },
    { key: "total", label: "Total", render: f => <strong className="tgui-number">{money(f.total)} €</strong> },
    { key: "estado", label: "Estado", render: status },
    { key: "fiscal", label: "Fiscal", render: fiscal },
    { key: "acciones", label: "Acciones", render: actions },
  ]} renderMobile={f => <MobileDataCard title={number(f)} amount={`${money(f.total)} €`} subtitle={f.cliente_nombre} actions={actions(f)}>{status(f)}{fiscal(f)}<div className="finance-invoice-dates">{date(f.fecha)} → {date(f.fecha_vencimiento)}</div></MobileDataCard>} />;
}
