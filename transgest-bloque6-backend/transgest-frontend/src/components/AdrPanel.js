import { useCallback, useEffect, useRef, useState } from "react";
import { getAdrCatalogo } from "../services/api";
import {
  ADR_CLASSES, PACKING_GROUPS, TRANSPORT_CATEGORIES,
  emptyAdrItem, buildTransportDocumentLine, calcExencion1136,
} from "../utils/adr";

const S = {
  wrap: { border: "1px solid var(--border2,#e2e8f0)", borderRadius: 10, padding: 14, background: "var(--bg3,#f8fafc)", marginTop: 12 },
  head: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" },
  diamond: { width: 18, height: 18, background: "#f5b301", transform: "rotate(45deg)", border: "1.5px solid rgba(0,0,0,.4)", borderRadius: 3, flexShrink: 0, opacity: .9 },
  lbl: { display: "block", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text5)", margin: "8px 0 3px" },
  inp: { width: "100%", boxSizing: "border-box", background: "var(--bg4,#fff)", border: "1px solid var(--border2,#cfdbe5)", color: "var(--text,#0f172a)", padding: "8px 10px", borderRadius: 7, fontSize: 13, outline: "none" },
  item: { border: "1px solid var(--border2,#e2e8f0)", borderRadius: 8, padding: 12, background: "var(--bg3,#f8fafc)", marginTop: 10 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 },
  btn: { border: "1px solid var(--border2,#cfdbe5)", background: "var(--bg3,#f1f5f9)", color: "var(--text,#0f172a)", borderRadius: 7, padding: "7px 12px", fontWeight: 800, fontSize: 12, cursor: "pointer" },
  line: { fontFamily: "'JetBrains Mono',monospace", fontSize: 12, background: "#0f172a", color: "#e2e8f0", padding: "8px 10px", borderRadius: 6, marginTop: 8, wordBreak: "break-word" },
};

function UnBuscador({ value, onPick }) {
  const [q, setQ] = useState(value || "");
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  useEffect(() => { setQ(value || ""); }, [value]);
  const buscar = useCallback((texto) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!String(texto || "").trim()) { setRes([]); return; }
      try {
        const r = await getAdrCatalogo(texto);
        setRes(Array.isArray(r?.resultados) ? r.resultados : []);
        setOpen(true);
      } catch { setRes([]); }
    }, 220);
  }, []);
  return (
    <div style={{ position: "relative" }}>
      <input
        style={S.inp}
        value={q}
        placeholder="Nº ONU o nombre (ej: 1202 o gasoleo)"
        onChange={e => { setQ(e.target.value); onPick({ un: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) }); buscar(e.target.value); }}
        onFocus={() => res.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
      />
      {open && res.length > 0 && (
        <div style={{ position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, background: "var(--bg,#fff)", border: "1px solid var(--border2,#cfdbe5)", borderRadius: 8, marginTop: 3, maxHeight: 220, overflowY: "auto", boxShadow: "0 12px 30px rgba(15,23,42,.18)" }}>
          {res.map(r => (
            <div key={r.un} onMouseDown={() => { onPick({ un: r.un, nombre: r.nombre, clase: r.clase, grupo_embalaje: r.grupo, codigo_tunel: r.tunel, categoria_transporte: r.cat, peligro_ambiente: r.ambiente }); setQ(r.un); setOpen(false); }}
              style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid var(--border2,#eef2f7)", fontSize: 12 }}>
              <strong style={{ color: "var(--accent,#0f766e)" }}>UN {r.un}</strong> · {r.nombre}
              <div style={{ color: "var(--text5,#94a3b8)", fontSize: 11 }}>Clase {r.clase}{r.grupo ? ` · GE ${r.grupo}` : ""}{r.tunel && r.tunel !== "-" ? ` · túnel ${r.tunel}` : ""} · cat {r.cat}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdrPanel({ adr = false, items = [], onChange }) {
  const list = Array.isArray(items) ? items : [];
  const setAdr = (on) => onChange({ adr: on, adr_items: on ? (list.length ? list : [emptyAdrItem()]) : [] });
  const setItems = (next) => onChange({ adr: true, adr_items: next });
  const patchItem = (idx, patch) => setItems(list.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const addItem = () => setItems([...list, emptyAdrItem()]);
  const removeItem = (idx) => { const next = list.filter((_, i) => i !== idx); onChange({ adr: next.length > 0, adr_items: next }); };

  const ex = calcExencion1136(list);

  return (
    <div style={S.wrap}>
      <label style={S.head}>
        <span style={S.diamond} />
        <input type="checkbox" checked={!!adr} onChange={e => setAdr(e.target.checked)} style={{ width: 18, height: 18 }} />
        <span style={{ fontWeight: 900, fontSize: 14, color: "var(--text,#0f172a)" }}>Mercancía peligrosa (ADR)</span>
        {adr && (
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: ex.exento ? "rgba(16,185,129,.13)" : "rgba(245,158,11,.14)", color: ex.exento ? "#0f9f77" : "#b45309" }}>
            {ex.aplica ? (ex.exento ? "Exención 1.1.3.6" : "ADR completo") : "Sin datos"}
          </span>
        )}
      </label>

      {adr && (
        <>
          {list.map((it, idx) => {
            const linea = buildTransportDocumentLine(it);
            const claseNoGE = ["1", "2", "2.1", "2.2", "2.3", "7"].includes(String(it.clase));
            return (
              <div key={idx} style={S.item}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 12, color: "var(--text3,#475569)" }}>Mercancía {idx + 1}</strong>
                  <button type="button" style={{ ...S.btn, color: "#ef4444", borderColor: "rgba(239,68,68,.3)", padding: "4px 9px" }} onClick={() => removeItem(idx)}>Quitar</button>
                </div>
                <div style={{ marginTop: 6 }}>
                  <label style={S.lbl}>Nº ONU / búsqueda</label>
                  <UnBuscador value={it.un} onPick={patch => patchItem(idx, patch)} />
                </div>
                <div style={{ marginTop: 4 }}>
                  <label style={S.lbl}>Designación oficial de transporte</label>
                  <input style={S.inp} value={it.nombre || ""} onChange={e => patchItem(idx, { nombre: e.target.value })} placeholder="Ej: GASÓLEO" />
                </div>
                <div style={S.grid}>
                  <div>
                    <label style={S.lbl}>Clase</label>
                    <select style={S.inp} value={it.clase || ""} onChange={e => patchItem(idx, { clase: e.target.value })}>
                      <option value="">—</option>
                      {Object.entries(ADR_CLASSES).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={S.lbl}>Grupo embalaje</label>
                    <select style={S.inp} value={it.grupo_embalaje || ""} onChange={e => patchItem(idx, { grupo_embalaje: e.target.value })} disabled={claseNoGE}>
                      <option value="">{claseNoGE ? "n/a" : "—"}</option>
                      {PACKING_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={S.lbl}>Cód. túnel</label>
                    <input style={S.inp} value={it.codigo_tunel || ""} onChange={e => patchItem(idx, { codigo_tunel: e.target.value })} placeholder="D/E, B/D, -" />
                  </div>
                  <div>
                    <label style={S.lbl}>Cat. transporte</label>
                    <select style={S.inp} value={it.categoria_transporte === 0 ? "0" : (it.categoria_transporte ?? "")} onChange={e => patchItem(idx, { categoria_transporte: e.target.value === "" ? "" : Number(e.target.value) })}>
                      <option value="">—</option>
                      {Object.entries(TRANSPORT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={S.lbl}>Cantidad</label>
                    <input style={S.inp} inputMode="decimal" value={it.cantidad ?? ""} onChange={e => patchItem(idx, { cantidad: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label style={S.lbl}>Unidad</label>
                    <select style={S.inp} value={it.unidad || "L"} onChange={e => patchItem(idx, { unidad: e.target.value })}>
                      <option value="L">L</option>
                      <option value="kg">kg</option>
                    </select>
                  </div>
                  <div>
                    <label style={S.lbl}>Nº bultos</label>
                    <input style={S.inp} inputMode="numeric" value={it.num_bultos ?? ""} onChange={e => patchItem(idx, { num_bultos: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label style={S.lbl}>Tipo bulto</label>
                    <input style={S.inp} value={it.tipo_bulto || ""} onChange={e => patchItem(idx, { tipo_bulto: e.target.value })} placeholder="bidones, GRG, cisterna..." />
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "var(--text3,#475569)" }}>
                  <input type="checkbox" checked={!!it.peligro_ambiente} onChange={e => patchItem(idx, { peligro_ambiente: e.target.checked })} />
                  Peligroso para el medio ambiente
                </label>
                {linea && <div style={S.line}>{linea}</div>}
              </div>
            );
          })}

          <button type="button" style={{ ...S.btn, marginTop: 10 }} onClick={addItem}>+ Añadir mercancía peligrosa</button>

          <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: ex.exento ? "rgba(16,185,129,.07)" : "rgba(245,158,11,.07)", border: `1px solid ${ex.exento ? "rgba(16,185,129,.22)" : "rgba(245,158,11,.28)"}` }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "var(--text,#0f172a)" }}>Exención 1.1.3.6 (regla de los 1000 puntos)</div>
            <div style={{ fontSize: 12, color: "var(--text3,#475569)", marginTop: 3 }}>{ex.resumen}</div>
            <div style={{ fontSize: 11, color: "var(--text5,#94a3b8)", marginTop: 4 }}>
              Puntos: <strong style={{ color: ex.puntos > 1000 ? "#ef4444" : "#10b981" }}>{ex.puntos}</strong> / {ex.limite}.
              {!ex.exento && ex.aplica && " Se exigen carné ADR, placas naranja, instrucciones escritas y equipo de a bordo."}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
