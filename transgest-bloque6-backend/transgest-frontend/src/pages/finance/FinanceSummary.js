import { useEffect, useState } from "react";
import { Button, Card, Icon } from "../../ui";
import { TreasuryChart } from "./TreasuryView";

export function FinanceIncidents({ reviews, documents, fiscal, fiscalAvailable, onCollections, onDocuments, onFiscal }) {
  return <Card className="finance-incidents"><h2><Icon name="invoice" size={18} />Incidencias</h2>
    <button type="button" onClick={onCollections}><strong className="tgui-tone--warning">{reviews}</strong><span>Cobros a revisar</span></button>
    <button type="button" onClick={onDocuments}><strong className="tgui-tone--warning">{documents}</strong><span>Riesgo documental</span></button>
    <button type="button" onClick={onFiscal}><strong className={fiscal ? "tgui-tone--danger" : "tgui-tone--success"}>{fiscalAvailable ? fiscal : "—"}</strong><span>{fiscalAvailable ? "Incidencias fiscales" : "Fiscal no disponible"}</span></button>
  </Card>;
}

export default function FinanceSummary({ forecast, money, backlogCount, backlogAmount, invoices, totalCount, filters, renderInvoices, canEdit, onBacklog, onInvoice, onAllInvoices, onExport, documents, reviews, pending, fiscalLabel, fiscalMode, onDocuments, onCollections, onFiscal }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  useEffect(() => { setPage(1); }, [invoices]);
  const pages = Math.max(1, Math.ceil(invoices.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  const rows = invoices.slice(start, start + pageSize);
  return <div className="finance-summary">
    <div className="finance-summary-middle">
      <Card as="section" className="finance-summary-chart"><h2><Icon name="wallet" />Evolución de tesorería <small>(próximos 60 días)</small></h2><TreasuryChart forecast={forecast} money={money} /></Card>
      <Card as="section" className="finance-summary-backlog"><div className="finance-summary-card-heading"><span className="finance-summary-icon tgui-tone--warning"><Icon name="truck" size={26} /></span><h2>Viajes pendientes de facturar</h2></div>
        <p className="finance-summary-backlog-value"><strong>{backlogCount}</strong> viajes <span>·</span> <strong>{money(backlogAmount)} €</strong></p>
        <p>Viajes entregados sin factura · Todos los períodos.</p>
        <div className="tgui-actions"><Button variant="primary" onClick={onBacklog}>Revisar viajes</Button>{canEdit && <Button onClick={onInvoice}>Facturar pedidos</Button>}</div>
      </Card>
    </div>
    <Card as="section" className="finance-invoices finance-summary-invoices" aria-label="Facturas de clientes">
      <header className="finance-invoices-header"><div className="finance-summary-card-heading"><span className="finance-summary-icon"><Icon name="invoice" /></span><div><h2>Facturas de clientes</h2><p>Emisión, fiscalidad y control de facturas.</p></div></div>{canEdit && <Button onClick={onExport}>Exportar</Button>}</header>
      {filters}
      {renderInvoices(rows)}
      <footer className="finance-summary-pagination"><span>Mostrando {rows.length ? start + 1 : 0}–{start + rows.length} de {invoices.length} facturas cargadas <small>· {totalCount} en el período</small></span><div className="tgui-actions"><Button aria-label="Página anterior del resumen" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</Button><span>{currentPage} / {pages}</span><Button aria-label="Página siguiente del resumen" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>›</Button><select className="tgui-input" aria-label="Facturas por página en resumen" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={5}>5 por página</option><option value={10}>10 por página</option></select><Button onClick={onAllInvoices}>Ver todas</Button></div></footer>
    </Card>
    <div className="finance-summary-followup">
      <Card as="section"><div className="finance-summary-card-heading"><span className="finance-summary-icon tgui-tone--warning"><Icon name="invoice" /></span><div><h2>Bloqueos documental-cobro</h2><p>{documents} pedidos sin soporte documental</p></div></div><Button onClick={onDocuments}>Revisar documentos</Button></Card>
      <Card as="section"><div className="finance-summary-card-heading"><span className="finance-summary-icon"><Icon name="coins" /></span><div><h2>Control de cobros</h2><p>{reviews} facturas a revisar · {money(pending)} € pendientes</p></div></div><Button onClick={onCollections}>Ver cobros pendientes</Button></Card>
      <Card as="section"><div className="finance-summary-card-heading"><span className="finance-summary-icon"><Icon name="shield" /></span><div><h2>Bloque fiscal AEAT</h2><p>{fiscalMode}</p></div></div><div className="finance-summary-fiscal"><span>{fiscalLabel}</span><Button onClick={onFiscal}>Revisar fiscalidad</Button></div></Card>
    </div>
  </div>;
}
