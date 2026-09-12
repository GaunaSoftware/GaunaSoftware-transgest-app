import { useEffect, useState } from "react";
import { Modal, Button, Select, EmptyState } from "../../ui";
import { getPedidosTodos, vincularPaletTransporte, generarPedidoDocumentoControl, getPedidoDocumentoControl } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { setRuntimeFocus } from "../../services/runtimeFocus";

export default function TransportDocuments({ movement, onClose, onSaved, albaran }) {
  const {user}=useAuth();
  const canGenerate=['gerente','trafico'].includes(user?.rol);
  const [orders,setOrders]=useState([]),[selected,setSelected]=useState(movement.pedido_transporte_id||''),[saved,setSaved]=useState(movement.pedido_transporte_id||''),[doc,setDoc]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let alive=true;getPedidosTodos().then(rows=>{if(alive)setOrders((Array.isArray(rows)?rows:rows?.data||[]).filter(p=>p.estado!=='cancelado'));}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false};},[]);
  useEffect(()=>{let alive=true;setDoc(null);if(saved)getPedidoDocumentoControl(saved).then(d=>{if(alive)setDoc(d);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false};},[saved]);
  const order=orders.find(p=>p.id===selected);
  const goOrder=(id)=>{setRuntimeFocus('tms_pedidos_focus',id?{pedido_id:id}:{action:'nuevo',source:'almacen_palets',defaults:{fecha_carga:String(movement.fecha||'').slice(0,10),cliente_id:movement.propietario_cliente_id||movement.cliente_id,mercancia:`Devolución de ${Number(movement.cantidad)||0} palets · Albarán ${movement.num_albaran||''}`}});window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'}));onClose();};
  async function save(){setBusy(true);setError('');try{const m=await vincularPaletTransporte(movement.id,selected);setSaved(m.pedido_transporte_id);onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function generate(){setBusy(true);setError('');try{setDoc(await generarPedidoDocumentoControl(saved));}catch(e){setError(e.message);}finally{setBusy(false);}}
  const missing=doc?.status?.faltantes||[];
  const url=doc?.documento?.soporte_url;
  const safeUrl=typeof url==='string'&&/^https?:\/\//i.test(url)?url:null;
  return <Modal title="Documentos de devolución" onClose={onClose} width={760}>
    <p><strong>{movement.num_albaran||'Sin número de albarán'}</strong> · {Number(movement.cantidad)||0} palets · {String(movement.fecha||'').slice(0,10)}</p>
    <Button onClick={albaran}>Abrir albarán de devolución</Button>
    <h3>Carta de porte / DCD</h3><p>Vincula el pedido que transporta estos palets. Puede utilizar camión propio o colaborador. El DCD toma del pedido el cargador, transportista, matrícula, origen, destino y mercancía.</p>
    {error&&<p role="alert">{error}</p>}
    {loading?<EmptyState title="Cargando transportes…"/>:<label>Pedido de transporte<Select label="Pedido de transporte" value={selected} onChange={e=>{setSelected(e.target.value);setError('')}}><option value="">Selecciona el transporte de la devolución</option>{orders.map(p=><option key={p.id} value={p.id}>{p.numero} · {p.origen||'—'} → {p.destino||'—'} · {p.vehiculo_matricula||'Sin matrícula'} · {p.cliente_nombre||''}</option>)}</Select></label>}
    {order&&<div className="warehouse-document-summary"><strong>{order.numero}</strong><p>{order.cliente_nombre} · {order.origen} → {order.destino}<br/>{order.vehiculo_matricula||'Sin vehículo asignado'} · {order.chofer_nombre||'Sin conductor'}<br/>Carga: {String(order.fecha_carga||'').slice(0,10)} · Mercancía: {order.mercancia||order.descripcion_mercancia||'Revisar en el pedido'}</p><Button onClick={()=>goOrder(order.id)}>Revisar datos del transporte</Button></div>}
    <div className="warehouse-actions"><Button onClick={()=>goOrder()}>Crear pedido de transporte</Button><Button variant="primary" disabled={!selected||busy||selected===saved} onClick={save}>{busy?'Guardando…':'Vincular transporte'}</Button></div>
    {saved&&<><p>Transporte vinculado. Revisa que la mercancía, los palets y los puntos de carga/descarga correspondan a esta devolución.</p>{missing.length>0&&<div role="status"><strong>DCD pendiente de completar</strong><ul>{missing.map((m,i)=><li key={i}>{typeof m==='string'?m:m.label||m.message||JSON.stringify(m)}</li>)}</ul></div>}<div className="warehouse-actions">{canGenerate&&<Button disabled={busy||selected!==saved} onClick={generate}>Generar / actualizar DCD</Button>}{safeUrl&&<a className="tgui-button" href={safeUrl} target="_blank" rel="noreferrer">Abrir documento del transporte</a>}</div>{!canGenerate&&<p>La generación del DCD corresponde a Gerencia o Tráfico.</p>}</>}
    <p className="warehouse-caption">Emitir documentación no confirma la salida ni crea una factura de palets. Al crear un pedido nuevo, vuelve a esta devolución para vincularlo.</p>
  </Modal>;
}
