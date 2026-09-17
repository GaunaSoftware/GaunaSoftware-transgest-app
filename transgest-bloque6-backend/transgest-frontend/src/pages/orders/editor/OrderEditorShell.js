import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Icon, Modal, Tabs } from "../../../ui";
import { useTheme } from "../../../context/ThemeContext";
import logoDark from "../../../assets/brand/transgest_logo_dark.svg";
import logoWhite from "../../../assets/brand/transgest_logo_white.svg";
import "./order-editor.css";

export function OrderSection({ title, icon = "invoice", children, actions, className = "" }) {
  return <Card as="section" className={`order-editor-section ${className}`}>
    <header><span className="order-editor-icon"><Icon name={icon}/></span><h3>{title}</h3>{actions}</header>
    {children}
  </Card>;
}

// Keep children mounted: changing steps/disclosure must not discard files, stop edits or API results.
export function OrderDisclosure({ title, children, initiallyOpen = false, summary, className = "" }) {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => { if (initiallyOpen) setOpen(true); }, [initiallyOpen]);
  return <div className={`order-editor-disclosure ${className}`}>
    <Button className="order-editor-disclosure-trigger" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span>{title}{summary && <small>{summary}</small>}</span><span aria-hidden="true">{open ? "−" : "+"}</span>
    </Button>
    <div hidden={!open} className="order-editor-disclosure-body">{children}</div>
  </div>;
}

export default function OrderEditorShell({ title, status, step, onStep, onClose, onSave, saving, saved, readonly, children }) {
  const { isDark } = useTheme();
  const anchor = useRef(null);
  useEffect(() => {
    document.body.classList.add("tg-order-editor-open");
    window.dispatchEvent(new CustomEvent("tms:order-editor", { detail: { anchor: anchor.current } }));
    return () => {
      document.body.classList.remove("tg-order-editor-open");
      window.dispatchEvent(new CustomEvent("tms:order-editor", { detail: null }));
    };
  }, []);
  function navigate(next) {
    onStep(next);
    anchor.current?.closest(".tgui-dialog")?.querySelector(".tgui-dialog-body")?.scrollTo({ top: 0 });
  }
  return <Modal width={1200} className="tg-order-editor-dialog" overlayClassName="tg-order-editor-overlay"
    onClose={onClose} closeOnBackdrop={false}
    title={<span className="order-editor-brand"><img src={isDark ? logoWhite : logoDark} alt="TransGest"/><span>{title}</span><Badge>{status}</Badge><span ref={anchor} className="order-editor-alert-slot"/></span>}
    footer={<div className="order-editor-footer"><Button onClick={step === 1 ? onClose : () => navigate(1)}>{step === 1 ? "Salir" : "← Volver"}</Button>
      <small>{step === 1 ? "Siguiente: ejecución y costes" : "Los cambios se guardan al confirmar"}</small>
      {step === 1 ? <Button variant="primary" onClick={() => navigate(2)}>Continuar →</Button>
        : !readonly && <Button variant="primary" disabled={saving} onClick={onSave}>{saving ? "Guardando…" : saved ? "Guardar cambios" : "Crear pedido"}</Button>}
    </div>}>
    <Tabs value={step} onChange={navigate} idPrefix="order-editor-step" label="Pasos del pedido" items={[
      { value: 1, label: "1 · Transporte y mercancía", icon: "route" },
      { value: 2, label: "2 · Ejecución y costes", icon: "coins" },
    ]}/>
    <div className="order-editor-content" role="tabpanel" id="order-editor-step-panel" aria-labelledby={`order-editor-step-${step}`}>{children}</div>
  </Modal>;
}
