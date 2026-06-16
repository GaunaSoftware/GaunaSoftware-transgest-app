import { useEffect, useRef, useState } from "react";

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
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const lockedRef = useRef(false);
  const [manual, setManual] = useState("");
  const [status, setStatus] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    lockedRef.current = false;
    setStatus("Preparando camara...");
    setCameraReady(false);

    async function start() {
      if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
        setStatus("Camara no disponible. Introduce el codigo manualmente.");
        return;
      }
      if (!("BarcodeDetector" in window)) {
        setStatus("El navegador no detecta codigos automaticamente. Usa la entrada manual.");
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);

        if ("BarcodeDetector" in window) {
          const detector = new window.BarcodeDetector({
            formats: ["code_128", "code_39", "ean_13", "ean_8", "itf", "qr_code"],
          });
          timerRef.current = window.setInterval(async () => {
            if (!videoRef.current || lockedRef.current) return;
            if (videoRef.current.readyState < 2) return;
            try {
              const found = await detector.detect(videoRef.current);
              const code = found?.[0]?.rawValue?.trim();
              if (code) {
                lockedRef.current = true;
                onDetected(code);
                onClose();
              }
            } catch {
              setStatus("No se pudo leer automaticamente. Puedes escribir el codigo.");
            }
          }, 650);
        }
      } catch {
        setStatus("Permiso de camara denegado o no disponible. Introduce el codigo manualmente.");
      }
    }

    start();
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      streamRef.current?.getTracks?.().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, [open, onClose, onDetected]);

  if (!open) return null;

  function submitManual() {
    const code = manual.trim();
    if (!code) return;
    onDetected(code);
    onClose();
  }

  return (
    <div style={box} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={card}>
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

        {status && cameraReady && (
          <div style={{fontSize:12,color:"var(--text5)",marginBottom:10}}>{status}</div>
        )}

        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8}}>
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
        </div>
      </div>
    </div>
  );
}
