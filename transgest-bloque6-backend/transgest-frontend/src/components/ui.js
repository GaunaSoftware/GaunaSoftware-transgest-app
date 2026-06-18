export function FieldError({ children }) {
  if (!children) return null;
  return (
    <div style={{
      color: "#ef4444",
      fontSize: 11,
      fontWeight: 700,
      marginTop: 5,
      lineHeight: 1.35,
    }}>
      {children}
    </div>
  );
}

export function FormField({ label, required, error, children, hint }) {
  return (
    <div style={{ marginTop: 12 }}>
      {label && (
        <label style={{
          display: "block",
          fontSize: 10,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: ".07em",
          color: error ? "#ef4444" : "var(--text4)",
          marginBottom: 5,
        }}>
          {label}{required ? " *" : ""}
        </label>
      )}
      {children}
      {hint && !error && (
        <div style={{ color: "var(--text5)", fontSize: 11, marginTop: 5, lineHeight: 1.35 }}>
          {hint}
        </div>
      )}
      <FieldError>{error}</FieldError>
    </div>
  );
}

export function EmptyState({ title = "Sin datos", text, action }) {
  return (
    <div style={{
      border: "1px solid var(--border)",
      background: "var(--bg3)",
      borderRadius: 8,
      padding: 18,
      color: "var(--text3)",
      textAlign: "center",
    }}>
      <div style={{ fontWeight: 900, color: "var(--text)", marginBottom: text ? 5 : 0 }}>{title}</div>
      {text && <div style={{ fontSize: 13, color: "var(--text4)", lineHeight: 1.45 }}>{text}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function LoadingState({ text = "Cargando..." }) {
  return (
    <div style={{ padding: 18, color: "var(--text4)", textAlign: "center", fontWeight: 700 }}>
      {text}
    </div>
  );
}

export function StatusBadge({ children, tone = "neutral" }) {
  const palette = {
    success: ["rgba(16,185,129,.12)", "#10b981"],
    warning: ["rgba(245,158,11,.14)", "#f59e0b"],
    danger: ["rgba(239,68,68,.12)", "#ef4444"],
    info: ["rgba(59,130,246,.12)", "#60a5fa"],
    neutral: ["var(--bg4)", "var(--text3)"],
  }[tone] || ["var(--bg4)", "var(--text3)"];
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      minHeight: 22,
      padding: "2px 9px",
      borderRadius: 8,
      fontSize: 11,
      fontWeight: 800,
      background: palette[0],
      color: palette[1],
    }}>
      {children}
    </span>
  );
}

export function ModalShell({ title, children, footer, onClose, width = 560 }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onMouseDown={e => e.target === e.currentTarget && onClose?.()}
    >
      <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 24, width: `min(${width}px,96vw)`, maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--shadow)" }}>
        {title && <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 17, fontWeight: 800, marginBottom: 14, color: "var(--text)" }}>{title}</div>}
        {children}
        {footer && <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}
