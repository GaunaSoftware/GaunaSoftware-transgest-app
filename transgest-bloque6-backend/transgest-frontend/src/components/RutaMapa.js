import { useEffect, useRef, useState } from "react";
import { calcularRutaGeo } from "../services/api";

// Carga Leaflet auto-alojado (same-origin) para cumplir la CSP `script-src 'self'`.
// No usa CDN (motivo por el que fallaban intentos anteriores) ni añade dependencias npm.
let leafletPromise = null;
function loadLeaflet() {
  if (typeof window === "undefined") return Promise.reject(new Error("sin ventana"));
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    try {
      if (!document.querySelector("link[data-leaflet]")) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/vendor/leaflet/leaflet.css";
        link.setAttribute("data-leaflet", "1");
        document.head.appendChild(link);
      }
      const existing = document.querySelector("script[data-leaflet]");
      if (existing) {
        existing.addEventListener("load", () => window.L ? resolve(window.L) : reject(new Error("Leaflet no disponible")));
        existing.addEventListener("error", () => reject(new Error("No se pudo cargar el mapa")));
        return;
      }
      const script = document.createElement("script");
      script.src = "/vendor/leaflet/leaflet.js";
      script.async = true;
      script.setAttribute("data-leaflet", "1");
      script.onload = () => window.L ? resolve(window.L) : reject(new Error("Leaflet no disponible"));
      script.onerror = () => { leafletPromise = null; reject(new Error("No se pudo cargar el mapa")); };
      document.body.appendChild(script);
    } catch (e) {
      leafletPromise = null;
      reject(e);
    }
  });
  return leafletPromise;
}

function markerIcon(L, texto, color) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid #fff;">
      <span style="transform:rotate(45deg);font-size:12px;font-weight:800;font-family:sans-serif;">${texto}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 24],
    popupAnchor: [0, -22],
  });
}

function formatDuracion(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return "";
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h > 0 ? `${h}h ${r}min` : `${r}min`;
}

export default function RutaMapa({ puntos = [], altura = 260 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [estado, setEstado] = useState("cargando"); // cargando | ok | vacio | error
  const [info, setInfo] = useState(null);

  const reqPuntos = (puntos || [])
    .map((p) => {
      const lat = Number(p?.lat);
      const lng = Number(p?.lng);
      const role = p?.role || (p?.tipo === "carga" ? "origen" : p?.tipo === "descarga" ? "destino" : "parada");
      return {
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        label: String(p?.label || p?.title || "").trim(),
        role,
      };
    })
    .filter((p) => (p.lat != null && p.lng != null) || p.label.length >= 2);

  const puntosKey = JSON.stringify(reqPuntos);

  useEffect(() => {
    let cancelled = false;
    if (reqPuntos.length < 2) { setEstado("vacio"); return; }
    setEstado("cargando");

    (async () => {
      let L;
      try {
        L = await loadLeaflet();
      } catch {
        if (!cancelled) { setEstado("error"); setInfo({ error: "No se pudo cargar el mapa." }); }
        return;
      }
      let data;
      try {
        data = await calcularRutaGeo({ puntos: reqPuntos });
      } catch {
        if (!cancelled) { setEstado("error"); setInfo({ error: "No se pudo trazar la ruta." }); }
        return;
      }
      if (cancelled) return;
      if (!data?.ok || !Array.isArray(data.puntos) || data.puntos.length < 2) {
        setEstado("error");
        setInfo({ error: data?.error || "No se pudieron localizar los puntos." });
        return;
      }

      try {
        if (!mapRef.current && containerRef.current) {
          mapRef.current = L.map(containerRef.current, {
            zoomControl: true,
            attributionControl: true,
            scrollWheelZoom: false,
          });
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 18,
            attribution: "© OpenStreetMap",
          }).addTo(mapRef.current);
        }
        const map = mapRef.current;
        if (!map) return;
        if (layerRef.current) { map.removeLayer(layerRef.current); }
        const group = L.layerGroup().addTo(map);
        layerRef.current = group;

        const linePts = Array.isArray(data.geometry) && data.geometry.length > 1
          ? data.geometry
          : data.puntos.map((p) => [p.lat, p.lng]);
        const line = L.polyline(linePts, { color: "#0f766e", weight: 4, opacity: 0.85 }).addTo(group);

        data.puntos.forEach((p, i) => {
          const isOrigen = i === 0;
          const isDestino = i === data.puntos.length - 1;
          const color = isOrigen ? "#10b981" : isDestino ? "#ef4444" : "#3b82f6";
          L.marker([p.lat, p.lng], { icon: markerIcon(L, String(i + 1), color) })
            .addTo(group)
            .bindPopup(`<b>${isOrigen ? "Carga" : isDestino ? "Descarga" : "Parada"}</b><br/>${(p.label || "").replace(/</g, "&lt;")}`);
        });

        try { map.fitBounds(line.getBounds().pad(0.2)); } catch { /* bounds vacíos */ }
        setTimeout(() => { try { map.invalidateSize(); map.fitBounds(line.getBounds().pad(0.2)); } catch {} }, 250);

        setInfo({ km: data.km, duration_min: data.duration_min, source: data.source, warning: data.warning });
        setEstado("ok");
      } catch {
        if (!cancelled) { setEstado("error"); setInfo({ error: "No se pudo dibujar el mapa." }); }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puntosKey]);

  useEffect(() => () => {
    try { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; } } catch {}
  }, []);

  if (estado === "vacio") return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
        <div ref={containerRef} style={{ height: altura, width: "100%", background: "var(--bg3)" }} />
        {estado !== "ok" && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--bg3)", color: "var(--text4)", fontSize: 12, textAlign: "center", padding: 12,
          }}>
            {estado === "cargando" ? "Cargando mapa de la ruta…" : (info?.error || "No se pudo mostrar el mapa.")}
          </div>
        )}
      </div>
      {estado === "ok" && (info?.km || info?.warning) && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 6, fontSize: 12, color: "var(--text4)" }}>
          {info?.km ? (
            <span style={{ fontWeight: 800, color: "var(--text2)" }}>
              {Number(info.km).toLocaleString("es-ES")} km{info.duration_min ? ` · ${formatDuracion(info.duration_min)}` : ""}
            </span>
          ) : null}
          {info?.source === "estimacion" && (
            <span style={{ color: "#f59e0b" }}>Distancia estimada (enrutador no disponible)</span>
          )}
          {info?.source === "osrm" && <span style={{ color: "var(--text5)" }}>Ruta orientativa por carretera · validar restricciones de camión</span>}
        </div>
      )}
    </div>
  );
}
