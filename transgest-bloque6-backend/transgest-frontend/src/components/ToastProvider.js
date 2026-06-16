import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { rememberFrontendIncident } from "../services/incidents";

const ToastContext = createContext({ notify: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

function colorFor(type) {
  if (type === "error") return { bg:"#fee2e2", border:"#fecaca", text:"#991b1b" };
  if (type === "success") return { bg:"#dcfce7", border:"#bbf7d0", text:"#166534" };
  if (type === "warning") return { bg:"#fef3c7", border:"#fde68a", text:"#92400e" };
  return { bg:"#e0f2fe", border:"#bae6fd", text:"#075985" };
}

function typeFromMessage(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("error") || text.includes("no se pudo") || text.includes("fall")) return "error";
  if (text.includes("obligator") || text.includes("selecciona") || text.includes("indica") || text.includes("revisa")) return "warning";
  if (text.includes("ok") || text.includes("cread") || text.includes("guardad") || text.includes("enviado") || text.includes("actualiz")) return "success";
  return "info";
}

export default function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [promptState, setPromptState] = useState(null);
  const [promptValue, setPromptValue] = useState("");

  const notify = useCallback((message, type = "info", timeout = 5200) => {
    const text = String(message || "").trim();
    if (!text) return null;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setItems(prev => [...prev.slice(-4), { id, message:text, type }]);
    if (timeout) {
      window.setTimeout(() => setItems(prev => prev.filter(item => item.id !== id)), timeout);
    }
    return id;
  }, []);

  useEffect(() => {
    const originalAlert = window.alert;
    const onNotify = (event) => {
      const detail = event.detail || {};
      notify(detail.message, detail.type || "info", detail.timeout);
    };
    const onConfirm = (event) => {
      const detail = event.detail || {};
      setConfirmState({
        title: detail.title || "Confirmar accion",
        message: detail.message || "",
        confirmText: detail.confirmText || "Confirmar",
        cancelText: detail.cancelText || "Cancelar",
        tone: detail.tone || "default",
        resolve: typeof detail.resolve === "function" ? detail.resolve : () => {},
      });
    };
    const onPrompt = (event) => {
      const detail = event.detail || {};
      setPromptValue(String(detail.defaultValue || ""));
      setPromptState({
        title: detail.title || "Introducir dato",
        message: detail.message || "",
        placeholder: detail.placeholder || "",
        inputType: detail.inputType || "text",
        confirmText: detail.confirmText || "Aceptar",
        cancelText: detail.cancelText || "Cancelar",
        tone: detail.tone || "default",
        resolve: typeof detail.resolve === "function" ? detail.resolve : () => {},
      });
    };
    const onUnhandled = (event) => {
      const message = event.reason?.message || event.message || "Se ha producido un error inesperado.";
      const error = event.reason instanceof Error ? event.reason : new Error(message);
      rememberFrontendIncident(error, {}, { source: event.type || "window_error" });
      notify(message, "error", 7000);
    };
    window.alert = (message) => {
      notify(message, typeFromMessage(message), 6200);
    };
    window.addEventListener("tms:notify", onNotify);
    window.addEventListener("tms:confirm", onConfirm);
    window.addEventListener("tms:prompt", onPrompt);
    window.addEventListener("unhandledrejection", onUnhandled);
    window.addEventListener("error", onUnhandled);
    return () => {
      window.removeEventListener("tms:notify", onNotify);
      window.removeEventListener("tms:confirm", onConfirm);
      window.removeEventListener("tms:prompt", onPrompt);
      window.removeEventListener("unhandledrejection", onUnhandled);
      window.removeEventListener("error", onUnhandled);
      window.alert = originalAlert;
    };
  }, [notify]);

  const value = useMemo(() => ({ notify }), [notify]);
  const closeConfirm = useCallback((accepted) => {
    setConfirmState(current => {
      if (current?.resolve) current.resolve(accepted);
      return null;
    });
  }, []);
  const closePrompt = useCallback((value) => {
    setPromptState(current => {
      if (current?.resolve) current.resolve(value);
      return null;
    });
    setPromptValue("");
  }, []);
  const confirmColor = confirmState?.tone === "danger"
    ? "#dc2626"
    : confirmState?.tone === "warning"
      ? "#d97706"
      : "#0f766e";

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div style={{
        position:"fixed",
        right:18,
        bottom:18,
        zIndex:5000,
        display:"flex",
        flexDirection:"column",
        gap:10,
        width:"min(380px,calc(100vw - 28px))",
        pointerEvents:"none",
      }}>
        {items.map(item => {
          const c = colorFor(item.type);
          return (
            <div key={item.id} style={{
              pointerEvents:"auto",
              background:c.bg,
              border:`1px solid ${c.border}`,
              color:c.text,
              borderRadius:8,
              padding:"11px 13px",
              boxShadow:"0 14px 40px rgba(15,23,42,.16)",
              fontFamily:"'DM Sans',Arial,sans-serif",
              fontSize:13,
              fontWeight:700,
              lineHeight:1.35,
              display:"flex",
              gap:10,
              alignItems:"flex-start",
            }}>
              <div style={{flex:1}}>{item.message}</div>
              <button
                type="button"
                onClick={() => setItems(prev => prev.filter(x => x.id !== item.id))}
                style={{border:0,background:"transparent",color:c.text,cursor:"pointer",fontSize:16,lineHeight:1,padding:0,fontWeight:900}}
                aria-label="Cerrar aviso"
              >
                x
              </button>
            </div>
          );
        })}
      </div>
      {confirmState && (
        <div
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeConfirm(false);
          }}
          style={{
            position:"fixed",
            inset:0,
            zIndex:6000,
            background:"rgba(15,23,42,.42)",
            backdropFilter:"blur(4px)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            padding:18,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tms-confirm-title"
            style={{
              width:"min(430px,calc(100vw - 28px))",
              background:"var(--bg2,#fff)",
              color:"var(--text,#0f172a)",
              border:"1px solid var(--border2,#cbd5e1)",
              borderRadius:8,
              boxShadow:"0 24px 70px rgba(15,23,42,.28)",
              padding:18,
              fontFamily:"'DM Sans',Arial,sans-serif",
            }}
          >
            <div id="tms-confirm-title" style={{fontSize:16,fontWeight:800,marginBottom:8}}>
              {confirmState.title}
            </div>
            {confirmState.message && (
              <div style={{
                color:"var(--text3,#475569)",
                fontSize:13,
                lineHeight:1.5,
                whiteSpace:"pre-wrap",
                marginBottom:16,
              }}>
                {confirmState.message}
              </div>
            )}
            <div style={{display:"flex",justifyContent:"flex-end",gap:10,flexWrap:"wrap"}}>
              {confirmState.cancelText && (
                <button
                  type="button"
                  onClick={() => closeConfirm(false)}
                  style={{
                    border:"1px solid var(--border2,#cbd5e1)",
                    background:"var(--bg3,#f8fafc)",
                    color:"var(--text2,#334155)",
                    borderRadius:8,
                    padding:"8px 13px",
                    fontWeight:800,
                    cursor:"pointer",
                  }}
                >
                  {confirmState.cancelText}
                </button>
              )}
              <button
                type="button"
                onClick={() => closeConfirm(true)}
                style={{
                  border:`1px solid ${confirmColor}`,
                  background:confirmColor,
                  color:"#fff",
                  borderRadius:8,
                  padding:"8px 13px",
                  fontWeight:800,
                  cursor:"pointer",
                }}
              >
                {confirmState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
      {promptState && (
        <div
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closePrompt(null);
          }}
          style={{
            position:"fixed",
            inset:0,
            zIndex:6000,
            background:"rgba(15,23,42,.42)",
            backdropFilter:"blur(4px)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            padding:18,
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="tms-prompt-title"
            onSubmit={event => {
              event.preventDefault();
              closePrompt(promptValue);
            }}
            style={{
              width:"min(430px,calc(100vw - 28px))",
              background:"var(--bg2,#fff)",
              color:"var(--text,#0f172a)",
              border:"1px solid var(--border2,#cbd5e1)",
              borderRadius:8,
              boxShadow:"0 24px 70px rgba(15,23,42,.28)",
              padding:18,
              fontFamily:"'DM Sans',Arial,sans-serif",
            }}
          >
            <div id="tms-prompt-title" style={{fontSize:16,fontWeight:800,marginBottom:8}}>
              {promptState.title}
            </div>
            {promptState.message && (
              <div style={{
                color:"var(--text3,#475569)",
                fontSize:13,
                lineHeight:1.5,
                whiteSpace:"pre-wrap",
                marginBottom:12,
              }}>
                {promptState.message}
              </div>
            )}
            <input
              autoFocus
              type={promptState.inputType}
              value={promptValue}
              placeholder={promptState.placeholder}
              onChange={event => setPromptValue(event.target.value)}
              style={{
                width:"100%",
                boxSizing:"border-box",
                border:"1px solid var(--border2,#cbd5e1)",
                background:"var(--bg3,#f8fafc)",
                color:"var(--text,#0f172a)",
                borderRadius:8,
                padding:"10px 12px",
                fontSize:14,
                outline:"none",
                marginBottom:16,
              }}
            />
            <div style={{display:"flex",justifyContent:"flex-end",gap:10,flexWrap:"wrap"}}>
              <button
                type="button"
                onClick={() => closePrompt(null)}
                style={{
                  border:"1px solid var(--border2,#cbd5e1)",
                  background:"var(--bg3,#f8fafc)",
                  color:"var(--text2,#334155)",
                  borderRadius:8,
                  padding:"8px 13px",
                  fontWeight:800,
                  cursor:"pointer",
                }}
              >
                {promptState.cancelText}
              </button>
              <button
                type="submit"
                style={{
                  border:"1px solid #0f766e",
                  background:"#0f766e",
                  color:"#fff",
                  borderRadius:8,
                  padding:"8px 13px",
                  fontWeight:800,
                  cursor:"pointer",
                }}
              >
                {promptState.confirmText}
              </button>
            </div>
          </form>
        </div>
      )}
    </ToastContext.Provider>
  );
}
