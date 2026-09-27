import { setRuntimeFocus } from './runtimeFocus';
export function openNotice(item = {}) {
  const data = item.data || item;
  let view = data.view;
  let key = data.focusKey, focus = data.focus;
  if (data.factura_id) { view = 'facturacion'; key = 'tms_facturacion_focus'; focus = { factura_id:data.factura_id, open:true }; }
  else if (data.vehiculo_id) { view = 'vehiculos'; key = 'tms_vehiculos_focus'; focus = { vehiculo_id:data.vehiculo_id, section:'documentacion', open:true }; }
  else if (data.chofer_id && !data.pedido_id) { view = 'choferes'; key = 'tms_choferes_focus'; focus = { chofer_id:data.chofer_id, section:'documentacion', open:true }; }
  if (key && focus) setRuntimeFocus(key, { ...focus, open:true });
  if (key === 'tms_pedidos_focus' && focus) window.dispatchEvent(new CustomEvent('tms:pedidos-focus', { detail:focus }));
  if (view) window.dispatchEvent(new CustomEvent('tms:navegar', { detail:view }));
}
