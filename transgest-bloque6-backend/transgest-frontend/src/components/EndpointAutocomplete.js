import { useState, useRef, useEffect } from "react";

// Autocompletado propio para Origen/Destino: sustituye al datalist nativo (cuya
// flecha no se puede cerrar por codigo). Se cierra al pulsar la flecha, al elegir
// una sugerencia, al pulsar fuera o con Escape.
export default function EndpointAutocomplete({
  value,
  onChange,
  onBlur,
  placeholder,
  inputStyle,
  suggestions = [],
  getValue = (s) => s,
  getLabel = () => "",
  onPick,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const q = String(value || "").trim().toLowerCase();
  const lista = Array.isArray(suggestions) ? suggestions : [];
  const filtradas = q
    ? lista.filter((s) => {
        const v = String(getValue(s) || "").toLowerCase();
        const l = String(getLabel(s) || "").toLowerCase();
        return v.includes(q) || l.includes(q);
      })
    : lista;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        style={{ ...(inputStyle || {}), paddingRight: 30, boxSizing: "border-box" }}
        value={value || ""}
        disabled={disabled}
        onChange={(e) => { onChange && onChange(e); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); e.stopPropagation(); } }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {!disabled && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Ocultar sugerencias" : "Mostrar sugerencias"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          style={{
            position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
            width: 24, height: 24, border: "none", background: "transparent",
            cursor: "pointer", color: "var(--text4)", fontSize: 10, lineHeight: 1,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {open ? "▲" : "▼"}
        </button>
      )}
      {open && filtradas.length > 0 && (
        <div
          style={{
            position: "absolute", zIndex: 40, top: "calc(100% + 2px)", left: 0, right: 0,
            maxHeight: 240, overflowY: "auto",
            background: "var(--card-bg, var(--bg2))", border: "1px solid var(--border2)",
            borderRadius: 8, boxShadow: "0 14px 34px rgba(0,0,0,.28)",
          }}
        >
          {filtradas.slice(0, 50).map((s, i) => {
            const val = getValue(s);
            const lab = getLabel(s);
            return (
              <div
                key={`${val || "op"}-${i}`}
                onMouseDown={(e) => { e.preventDefault(); onPick && onPick(s); setOpen(false); }}
                style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--border2)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg4)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ fontWeight: 700, color: "var(--text)" }}>{val || lab || "-"}</div>
                {lab && lab !== val && (
                  <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 1 }}>{lab}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
