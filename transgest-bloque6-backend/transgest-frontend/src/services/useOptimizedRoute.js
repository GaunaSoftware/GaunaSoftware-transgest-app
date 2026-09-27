import { useEffect, useState } from 'react';
import { getRutaOptimizadaPedido, optimizarRuta } from './api';
import { routeGeometry } from '../utils/routeGeometry';

export function routeInputKey(input) {
  const coordinate = value => value == null || String(value).trim() === '' ? null : Number(value);
  return JSON.stringify({
    pedido_id: input.pedido_id, preference: input.preference || 'camion',
    stops: (input.stops || []).map(s => ({address: (s.address || '').trim(),
      lat: coordinate(s.lat), lng: coordinate(s.lng), google_maps_url: s.google_maps_url || ''})),
    truck: Object.fromEntries(['height_m','width_m','length_m','weight_t'].map(k => [k, Number(input.truck?.[k]) || null])),
  });
}

export default function useOptimizedRoute(input) {
  const key = input ? routeInputKey(input) : '';
  const payload = JSON.stringify(input);
  const [refresh, setRefresh] = useState({key: '', count: 0});
  const [state, setState] = useState({key: '', data: null, loading: false, error: ''});
  useEffect(() => {
    let active = true;
    if (!key) return undefined;
    const request = JSON.parse(payload);
    setState({key, data: null, loading: true, error: ''});
    (async () => {
      let saved;
      if (refresh.key !== key) {
        try { saved = await getRutaOptimizadaPedido(request.pedido_id); } catch (_) { /* Recalculate; display failure below. */ }
      }
      if (!active) return;
      const matches = saved && routeInputKey({...saved, pedido_id: request.pedido_id}) === key && routeGeometry(saved.geometry).length >= 2;
      const data = matches ? saved : await optimizarRuta(request);
      if (active) setState({key, data: {...data, pedido_id: request.pedido_id, preference: request.preference}, loading: false, error: ''});
    })().catch(error => {
      if (active) setState({key, data: null, loading: false, error: error.message || 'No se pudo calcular la ruta.'});
    });
    return () => { active = false; };
  }, [key, payload, refresh]);
  return {
    ...(state.key === key ? state : {data: null, loading: !!key, error: ''}),
    recalculate: () => setRefresh(previous => ({key, count: previous.count + 1})),
  };
}
