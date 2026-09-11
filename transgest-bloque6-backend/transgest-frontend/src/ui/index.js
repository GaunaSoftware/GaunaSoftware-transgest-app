import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./transgest-ui.css";

const cx = (...parts) => parts.filter(Boolean).join(" ");
export const Button = forwardRef(function Button({ variant = "secondary", className, ...props }, ref) {
  return <button ref={ref} type="button" className={cx("tgui-button", `tgui-button--${variant}`, className)} {...props} />;
});
export function Card({ as: Tag = "div", className, ...props }) { return <Tag className={cx("tgui-card", className)} {...props} />; }
export function Page({ className, ...props }) { return <div className={cx("tgui-page", className)} {...props} />; }
export function PageHeader({ title, description, actions }) {
  return <header className="tgui-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div><div className="tgui-actions">{actions}</div></header>;
}
export function Section({ title, actions, children, ...props }) {
  return <Card as="section" {...props}><header className="tgui-section-header"><h2>{title}</h2><div className="tgui-actions">{actions}</div></header>{children}</Card>;
}
export function Badge({ tone = "neutral", className, ...props }) { return <span className={cx("tgui-badge", `tgui-tone--${tone}`, className)} {...props} />; }
export function Icon({ name, size = 20 }) {
  const paths = {
    invoice: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 12h8 M8 16h6",
    clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    coins: "M15 7a5 5 0 1 0 0 10 M6 10h8 M6 14h8 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    wallet: "M20 8V5H5a2 2 0 0 1 0-4h13v4 M3 3v16a2 2 0 0 0 2 2h16V8H5 M21 12h-5v5h5",
    shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z M8 12l3 3 5-6",
    truck: "M1 3h13v14H1Z M14 8h4l4 5v4h-8 M8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    headset: "M3 14v-3a9 9 0 0 1 18 0v3 M3 12h3v7H3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2 M21 12h-3v7h3a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2 M21 19v1a2 2 0 0 1-2 2h-5",
    logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
    chevron: "m9 5 7 7-7 7",
  };
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.invoice} /></svg>;
}
export function KpiCard({ label, value, detail, tone = "neutral", icon }) {
  return <Card className={cx("tgui-kpi", icon && "tgui-kpi--icon")}>
    {icon && <span className={cx("tgui-kpi-icon", `tgui-tone--${tone}`)}><Icon name={icon} size={24} /></span>}
    <div className="tgui-kpi-copy"><div className="tgui-kpi-label">{label}</div><strong className={cx("tgui-number", `tgui-tone--${tone}`)}>{value}</strong>{detail && <small>{detail}</small>}</div>
  </Card>;
}
export function AlertCard({ icon, title, description, tone = "neutral", onClick }) {
  return <Button className={cx("tgui-alert", `tgui-alert--${tone}`)} onClick={onClick}>
    <span className={cx("tgui-alert-icon", `tgui-tone--${tone}`)}><Icon name={icon} /></span>
    <span className="tgui-alert-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
    <Icon name="chevron" size={16} />
  </Button>;
}
export function Tabs({ items, value, onChange, label = "Secciones", idPrefix = "tabs" }) {
  const refs = useRef([]);
  return <div className="tgui-tabs" role="tablist" aria-label={label}>{items.map((item, index) => <button key={item.value} ref={el => { refs.current[index] = el; }} type="button" role="tab" id={`${idPrefix}-${item.value}`} aria-controls={`${idPrefix}-panel`} aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1} onClick={() => onChange(item.value)} onKeyDown={e => {
    const next = e.key === "ArrowRight" ? (index + 1) % items.length : e.key === "ArrowLeft" ? (index + items.length - 1) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (next !== null) { e.preventDefault(); onChange(items[next].value); refs.current[next]?.focus(); refs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }}>{item.icon && <Icon name={item.icon} size={18} />}{item.label}</button>)}</div>;
}
export const SearchInput = forwardRef(function SearchInput({ label = "Buscar", className, ...props }, ref) { return <input ref={ref} type="search" aria-label={label} className={cx("tgui-input", className)} {...props} />; });
export const Select = forwardRef(function Select({ label, className, ...props }, ref) { return <select ref={ref} aria-label={label} className={cx("tgui-input", className)} {...props} />; });
export function EmptyState({ title = "Sin datos", text, action }) { return <div className="tgui-empty"><strong>{title}</strong>{text && <p>{text}</p>}{action}</div>; }
export function MobileDataCard({ title, amount, subtitle, children, actions }) {
  return <Card className="tgui-mobile-card"><div className="tgui-mobile-card-heading"><strong>{title}</strong><strong className="tgui-number">{amount}</strong></div>{subtitle && <p>{subtitle}</p>}<div className="tgui-mobile-card-body">{children}</div>{actions && <footer className="tgui-actions">{actions}</footer>}</Card>;
}
export function DataTable({ rows, columns, renderMobile, rowKey = row => row.id, loading, emptyTitle = "Sin datos", onRowClick, renderGroup, rowClassName, rowId }) {
  if (loading) return <div className="tgui-empty" role="status">Cargando…</div>;
  if (!rows.length) return <EmptyState title={emptyTitle} />;
  return (
    <div className="tgui-data">
      <div className={cx("tgui-table-wrap", renderMobile && "tgui-desktop-data")}>
        <table className="tgui-table">
          <thead>
            <tr>{columns.map(col => <th key={col.key} scope="col" className={col.className}>{col.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(row => row.__group && renderGroup ? (
              <tr key={rowKey(row)}><td colSpan={columns.length}>{renderGroup(row)}</td></tr>
            ) : (
              <tr key={rowKey(row)} id={rowId?.(row)} className={rowClassName?.(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map(col => <td key={col.key} className={col.className}>{col.render ? col.render(row) : row[col.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {renderMobile && (
        <div className="tgui-mobile-data">
          {rows.map(row => (
            <div key={rowKey(row)} id={!row.__group && rowId ? `${rowId(row)}-mobile` : undefined} className={rowClassName?.(row)}>
              {row.__group && renderGroup ? renderGroup(row) : renderMobile(row)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shared focus and scroll handling for nested modal/drawer surfaces.
const overlayStack = [];
let bodyOverflowBeforeOverlays = "";
const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
function Overlay({ title, children, footer, onClose, width = 560, drawer, closeOnBackdrop = true }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const panel = ref.current;
    if (!overlayStack.length) bodyOverflowBeforeOverlays = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlayStack.push(panel);
    panel.focus();
    const keydown = e => {
      if (overlayStack[overlayStack.length - 1] !== panel) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current?.(); }
      if (e.key === "Tab") {
        const elements = [...panel.querySelectorAll(focusable)].filter(el => el.getClientRects().length);
        const first = elements[0], last = elements[elements.length - 1];
        if (!first) { e.preventDefault(); panel.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { overlayStack.splice(overlayStack.indexOf(panel), 1); if (!overlayStack.length) document.body.style.overflow = bodyOverflowBeforeOverlays; document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(
    <div className={cx("tgui-overlay", drawer && "tgui-overlay--drawer")} onMouseDown={e => closeOnBackdrop && e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={cx("tgui-dialog", drawer && "tgui-drawer")} style={{ "--dialog-width": `${width}px` }} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="tgui-dialog-header">
          <h2 id={titleId}>{title || "Detalle"}</h2>
          {onClose && <Button aria-label="Cerrar" onClick={onClose}>×</Button>}
        </header>
        <div className="tgui-dialog-body">{children}</div>
        {footer && <footer className="tgui-dialog-footer">{footer}</footer>}
      </div>
    </div>, document.body
  );
}
export function Drawer({ open = true, ...props }) { return open ? <Overlay drawer {...props} /> : null; }
export function Modal({ open = true, ...props }) { return open ? <Overlay {...props} /> : null; }
export function FilterBar({ search, children, advanced }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tgui-filterbar">
      <div className="tgui-filter-search">{search}</div>
      <div className="tgui-filter-desktop">
        {children}{advanced && <Button onClick={() => setOpen(true)}>Más filtros</Button>}
      </div>
      <Button className="tgui-filter-toggle" onClick={() => setOpen(true)}>Filtros</Button>
      <Drawer open={open} title="Filtros" onClose={() => setOpen(false)} footer={<Button variant="primary" onClick={() => setOpen(false)}>Ver resultados</Button>}>
        <div className="tgui-filter-fields">{children}{advanced}</div>
      </Drawer>
    </div>
  );
}
export function DropdownMenu({ label = "Más acciones", items }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({});
  const trigger = useRef(null), menu = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const el = menu.current;
    const rect = trigger.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - el.offsetHeight - 8)) });
    el.querySelector('[role="menuitem"]')?.focus();
    const close = e => { if (!el.contains(e.target) && !trigger.current.contains(e.target)) setOpen(false); };
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", close); window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("resize", resize); };
  }, [open]);
  if (!items.length) return null;
  return <><Button ref={trigger} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={e => { e.stopPropagation(); setOpen(v => !v); }}>···</Button>{open && createPortal(<div ref={menu} id={id} role="menu" aria-label={label} className="tgui-menu" style={position} onClick={e => e.stopPropagation()} onKeyDown={e => {
    if (e.key === "Escape" || e.key === "Tab") { e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) { e.preventDefault(); const list = [...menu.current.querySelectorAll('[role="menuitem"]')]; const index = list.indexOf(document.activeElement); list[e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus(); }
  }}>{items.map(item => <button key={item.id || item.label} type="button" role="menuitem" className={item.danger ? "tgui-tone--danger" : undefined} onClick={() => { setOpen(false); trigger.current?.focus(); item.onClick(); }}>{item.label}</button>)}</div>, document.body)}</>;
}
