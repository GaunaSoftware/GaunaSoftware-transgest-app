import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

const box = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.82)",
  zIndex: 300,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
};

const card = {
  width: "min(520px, 96vw)",
  background: "var(--bg2)",
  border: "1px solid #1e2d45",
  borderRadius: 8,
  padding: 18,
  color: "var(--text)",
  boxShadow: "0 20px 70px rgba(0,0,0,.45)",
};

const btn = {
  padding: "8px 14px",
  borderRadius: 7,
  border: "1px solid #1e2d45",
  background: "var(--bg3)",
  color: "var(--text2)",
  fontFamily: "'DM Sans',sans-serif",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const input = {
  width: "100%",
  background: "var(--bg4)",
  border: "1px solid #1e2d45",
  color: "var(--text)",
  padding: "9px 11px",
  borderRadius: 7,
  outline: "none",
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 13,
};

export default function BarcodeScanner({ open, title = "Escanear codigo", onDetected, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const lockedRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  const [manual, setManual] = useState("");
  const [status, setStatus] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  function emitirCodigo(code) {
    const value = String(code || "").trim();
    if (!value || lockedRef.current) return;
    lockedRef.current = true;
    try { controlsRef.current?.stop?.(); } catch {}
    onDetectedRef.current?.(value);
    onCloseRef.current?.();
  }

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    lockedRef.current = false;
    setStatus("Preparando camara...");
    setCameraReady(false);
    controlsRef.current = null;

    async function start() {
      if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
        setStatus("Camara no disponible. Introduce el codigo manualmente.");
        return;
      }
      try {
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 180,
          delayBetweenScanSuccess: 500,
        });
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          const code = result?.getText?.() || result?.text || "";
          if (code) emitirCodigo(code);
        });
        if (cancelled) { controls?.stop?.(); return; }
        controlsRef.current = controls;
        setCameraReady(true);
        setStatus("Camara activa. Acerca el codigo al recuadro.");
      } catch (error) {
        const msg = String(error?.message || error || "").toLowerCase();
        setStatus(msg.includes("permission") || msg.includes("denied")
          ? "Permiso de camara denegado. Introduce el codigo manualmente."
          : "No se pudo abrir la camara. Revisa HTTPS/permisos o introduce el codigo manualmente.");
      }
    }

    start();
    return () => {
      cancelled = true;
      try { controlsRef.current?.stop?.(); } catch {}
      controlsRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  function submitManual() {
    const code = manual.trim();
    if (!code) return;
    emitirCodigo(code);
  }

  return (
    <div className="tg-barcode-scanner" style={box} onClick={e => e.target === e.currentTarget && onClose()}>
      <style>{`
        .tg-barcode-scanner, .tg-barcode-scanner * { box-sizing:border-box; }
        @media (max-width: 520px) {
          .tg-barcode-scanner {
            align-items:flex-start !important;
            padding:10px !important;
            overflow:auto !important;
          }
          .tg-barcode-card {
            width:100% !important;
            max-width:calc(100vw - 20px) !important;
            padding:14px !important;
          }
          .tg-barcode-actions {
            grid-template-columns:1fr !important;
          }
        }
      `}</style>
      <div className="tg-barcode-card" style={card}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800}}>{title}</div>
            <div style={{fontSize:12,color:"var(--text5)",marginTop:3}}>
              Apunta al codigo de barras o escribe el codigo manualmente.
            </div>
          </div>
          <button style={{...btn,background:"transparent"}} onClick={onClose}>Cerrar</button>
        </div>

        <div style={{
          position:"relative",
          aspectRatio:"16 / 10",
          borderRadius:8,
          overflow:"hidden",
          background:"var(--bg4)",
          border:"1px solid #1e2d45",
          marginBottom:12,
        }}>
          <video ref={videoRef} muted playsInline style={{width:"100%",height:"100%",objectFit:"cover",display:cameraReady?"block":"none"}} />
          <div style={{
            position:"absolute",
            inset:"22% 12%",
            border:"2px solid rgba(16,185,129,.85)",
            borderRadius:8,
            boxShadow:"0 0 0 999px rgba(0,0,0,.24)",
            pointerEvents:"none",
            display:cameraReady?"block":"none",
          }} />
          {!cameraReady && (
            <div style={{position:"absolute",inset:0,display:"grid",placeItems:"center",fontSize:13,color:"var(--text4)",textAlign:"center",padding:18}}>
              {status || "Esperando camara..."}
            </div>
          )}
        </div>

        {status && (
          <div style={{fontSize:12,color:"var(--text5)",marginBottom:10}}>{status}</div>
        )}

        <div className="tg-barcode-actions" style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8}}>
          <input
            style={input}
            value={manual}
            onChange={e => setManual(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitManual()}
            placeholder="Codigo manual"
            autoFocus
          />
          <button style={{...btn,background:"var(--accent)",borderColor:"var(--accent)",color:"#fff"}} onClick={submitManual}>
            Usar
          </button>
          {cameraReady && (
            <div style={{gridColumn:"1/-1",fontSize:11,color:"var(--text5)",lineHeight:1.4}}>
              Si no lee a la primera, mejora la luz, aleja un poco la cámara y mantén el código horizontal dentro del recuadro.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
