import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibrePackage from "maplibre-gl/package.json";

// Match the worker bundle to the installed MapLibre major version.
const publicRoot = (process.env.PUBLIC_URL || "").replace(/^\.$/, "").replace(/\/$/, "");
const workerFile = Number(maplibrePackage.version.split('.')[0]) >= 6 ? 'maplibre-gl-worker.mjs' : 'maplibre-gl-csp-worker.js';
maplibregl.setWorkerUrl(`${publicRoot}/vendor/maplibre/${maplibrePackage.version}/${workerFile}`);

const key = process.env.REACT_APP_MAPTILER_KEY || "";
const style = key
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`
  : "https://tiles.openfreemap.org/styles/liberty";
const empty = { type: "FeatureCollection", features: [] };

export default function RouteMapCanvas({ points = [], geometry = [], vehicle, stableFrame = false, compact = false, fleet = false }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const fitRef = useRef(() => {});
  const fittedRef = useRef("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let map;
    let observer;
    setLoaded(false);
    fittedRef.current = "";
    setError("");
    try {
      map = new maplibregl.Map({ container: container.current, style, center: [-3.7, 40.2], zoom: 5, attributionControl: { compact: true }, cooperativeGestures: true });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      // Route overlays need the style, not every remote basemap tile to finish.
      map.on("style.load", () => { setLoaded(true); setError(""); });
      map.on("idle", () => { if (container.current) container.current.dataset.mapIdle = "true"; });
      map.on("movestart", () => { if (container.current) container.current.dataset.mapIdle = "false"; });
      map.on("error", () => setError("No se ha podido cargar parte del mapa. Comprueba la conexion."));
      observer = new ResizeObserver(() => { map.resize(); fitRef.current(); });
      observer.observe(container.current);
    } catch (_) {
      setError("Mapa no disponible. Comprueba la aceleracion grafica del navegador.");
    }
    return () => { observer?.disconnect(); mapRef.current = null; map?.remove(); };
  }, [retry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const line = geometry.map(point => [point.lng, point.lat]);
    const route = line.length >= 2 ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } } : empty;
    const markers = { type: "FeatureCollection", features: points.map((point, index) => ({
      type: "Feature", properties: {
        number: String(point.stopNumber || index + 1), label: `${point.label || "Parada"}${point.tone?.label ? ` · ${point.tone.label}` : ""}`,
        color: point.tone?.color || (/descarga|destino/.test(point.role || point.tipo || "") ? "#c25616" : "#0f766e"),
      }, geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    })) };
    if (vehicle) markers.features.push({ type: "Feature", properties: { number: "V", label: "Vehiculo", color: "#2563eb" }, geometry: { type: "Point", coordinates: [vehicle.lng, vehicle.lat] } });
    if (!map.getSource("pedido-ruta")) {
      map.addSource("pedido-ruta", { type: "geojson", data: route });
      map.addLayer({ id: "pedido-ruta-borde", type: "line", source: "pedido-ruta", paint: { "line-color": "#ffffff", "line-width": 8 } });
      map.addLayer({ id: "pedido-ruta-linea", type: "line", source: "pedido-ruta", paint: { "line-color": "#0f766e", "line-width": 4 } });
    } else {
      map.getSource("pedido-ruta").setData(route);
    }
    let removeFleetListeners = () => {};
    if (fleet) {
      if (!map.getSource('fleet-vehicles')) {
        map.addSource('fleet-vehicles', { type:'geojson', data:markers, cluster:true, clusterRadius:35, clusterMaxZoom:16 });
        map.addLayer({id:'fleet-clusters',type:'circle',source:'fleet-vehicles',filter:['has','point_count'],paint:{'circle-color':'#0f766e','circle-radius':16,'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
        map.addLayer({id:'fleet-cluster-count',type:'symbol',source:'fleet-vehicles',filter:['has','point_count'],layout:{'text-field':['to-string',['get','point_count_abbreviated']],'text-size':12,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#fff'}});
        map.addLayer({id:'fleet-vehicle-pins',type:'circle',source:'fleet-vehicles',filter:['!', ['has','point_count']],paint:{'circle-color':['get','color'],'circle-radius':7,'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
        map.addLayer({id:'fleet-vehicle-labels',type:'symbol',source:'fleet-vehicles',filter:['!', ['has','point_count']],layout:{'text-field':['get','number'],'text-size':11,'text-offset':[0,1.5],'text-anchor':'top'},paint:{'text-color':'#163438','text-halo-color':'#fff','text-halo-width':2}});
      } else map.getSource('fleet-vehicles').setData(markers);
      const onCluster = async event => {
        const feature=event.features?.[0];
        if (!feature) return;
        const source=map.getSource('fleet-vehicles');
        try {
          const leaves=await source.getClusterLeaves(feature.properties.cluster_id, Math.min(feature.properties.point_count,500),0);
          const content=document.createElement('div'),heading=document.createElement('strong');
          heading.textContent=`${feature.properties.point_count} vehículos en esta zona`;
          content.append(heading);
          leaves.forEach(leaf=>{const line=document.createElement('div');line.textContent=leaf.properties.number;content.append(line);});
          const zoom=document.createElement('button');zoom.type='button';zoom.textContent='Ampliar grupo';content.append(zoom);
          const popup=new maplibregl.Popup({offset:18}).setLngLat(feature.geometry.coordinates).setDOMContent(content).addTo(map);
          zoom.addEventListener('click',async()=>{const level=await source.getClusterExpansionZoom(feature.properties.cluster_id);map.easeTo({center:feature.geometry.coordinates,zoom:level});popup.remove();});
        } catch (_) { setError('No se ha podido abrir el grupo de vehículos. Vuelve a intentarlo.'); }
      };
      const onVehicle=event=>{const feature=event.features?.[0];if(feature)new maplibregl.Popup({offset:12}).setLngLat(feature.geometry.coordinates).setText(feature.properties.label).addTo(map);};
      map.on('click','fleet-clusters',onCluster);map.on('click','fleet-vehicle-pins',onVehicle);map.on('click','fleet-vehicle-labels',onVehicle);
      removeFleetListeners=()=>{map.off('click','fleet-clusters',onCluster);map.off('click','fleet-vehicle-pins',onVehicle);map.off('click','fleet-vehicle-labels',onVehicle);};
    }
    const stopMarkers = (fleet ? [] : markers.features).map(feature => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tg-route-stop-marker";
      button.textContent = feature.properties.number;
      button.title = feature.properties.label;
      button.setAttribute("aria-label", `${feature.properties.number}: ${feature.properties.label}`);
      Object.assign(button.style, { minWidth: "34px", width: feature.properties.number.length > 3 ? "auto" : "34px", height: "34px", padding: feature.properties.number.length > 3 ? "0 6px" : "0", borderRadius: "50%", border: "3px solid white", background: feature.properties.color, color: "white", fontSize: "14px", fontWeight: "700", cursor: "pointer", boxShadow: "0 1px 4px #0005" });
      return new maplibregl.Marker({ element: button })
        .setLngLat(feature.geometry.coordinates)
        .setPopup(new maplibregl.Popup({ offset: 20 }).setText(feature.properties.label))
        .addTo(map);
    });
    const positions = [...line, ...markers.features.map(feature => feature.geometry.coordinates)];
    fitRef.current = () => {
      if (!positions.length) return;
      const bounds = positions.reduce((result, point) => result.extend(point), new maplibregl.LngLatBounds(positions[0], positions[0]));
      const padding=Math.min(55,map.getContainer().clientWidth/6);
      map.fitBounds(bounds, { padding: fleet ? {top:padding,left:padding,right:padding,bottom:85} : padding, maxZoom: 14, duration: 0 });
    };
    const frameKey = JSON.stringify(positions);
    if (positions.length && (!stableFrame || !fittedRef.current)) {
      if (fittedRef.current !== frameKey) fitRef.current();
      // Wait for the complete route before freezing its frame.
      if (line.length >= 2 || !stableFrame) fittedRef.current = frameKey;
    }
    return () => {stopMarkers.forEach(marker => marker.remove());removeFleetListeners();};
  }, [loaded, points, geometry, vehicle, stableFrame, fleet]);

  return (
    <div data-map-engine="maplibre">
      <div style={{ position: "relative", height: compact ? "180px" : "clamp(280px, 38vh, 440px)" }}>
        <div ref={container} aria-label={fleet ? 'Mapa de vehículos' : 'Mapa de la ruta del pedido'} style={{ position: "absolute", inset: 0 }} />
        <button type="button" title="Centrar ruta" aria-label="Centrar ruta" onClick={() => fitRef.current()} style={{ position: "absolute", top: 10, left: 10, width: 34, height: 34, background: "white", color: "#20252b", border: "1px solid #bbc5ca", borderRadius: 4, cursor: "pointer", fontSize: 22 }}>&#8982;</button>
      </div>
      {error && <div role="alert" style={{ padding: 10, fontSize: 12 }}>{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Reintentar mapa</button></div>}
    </div>
  );
}
