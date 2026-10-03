import {Badge,Button,Card,Icon} from '../../ui';
const text=value=>value===undefined||value===null||value===''?'Sin detectar':String(value);
const points=value=>{try{const parsed=Array.isArray(value)?value:JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
export default function OrderAiReview({preview,onEdit}){
 if(!preview)return null;
 const order=preview.pedido||{},confidence=Number(preview.confidence),hasConfidence=preview.confidence!==undefined&&Number.isFinite(confidence);
 const fields=[
  {label:'Cliente',icon:'clients',value:order.cliente_nombre,extra:order.cliente_cif},
  {label:'Ruta',icon:'route',value:[order.origen,order.destino].filter(Boolean).join(' → ')},
  {label:'Fechas',icon:'clock',value:order.fecha_carga&&`Carga: ${order.fecha_carga} ${order.hora_carga||''}`,extra:order.fecha_descarga&&`Entrega: ${order.fecha_descarga} ${order.hora_descarga||''}`},
  {label:'Mercancía',icon:'cargo',value:order.mercancia,extra:[order.peso_kg!=null&&`${Number(order.peso_kg).toLocaleString('es-ES')} kg`,order.bultos!=null&&`${order.bultos} bultos`].filter(Boolean).join(' · ')},
  {label:'Vehículo',icon:'truck',value:order.matricula_detectada||order.tipo_vehiculo||order.tipo_remolque,extra:order.transportista_detectado},
  {label:'Observaciones',icon:'invoice',value:order.notas||order.observaciones||order.referencia_cliente},
 ];
 const more=['importe','tipo_precio','precio_unitario','referencia_cliente','km_ruta'].filter(key=>order[key]!==undefined&&order[key]!==null&&order[key]!=='');
 return <section className="ai-inbox-summary" aria-label="Información detectada por la IA">
  <header className="ai-inbox-summary-heading"><span className="ai-inbox-icon"><Icon name="sparkles" size={22}/></span><div><strong>Información detectada por la IA</strong><p>Revisa los datos antes de crear el pedido. Puedes corregirlos en su formulario.</p></div>{hasConfidence&&<Badge tone={confidence>=70?'success':'warning'}>Confianza {Math.round(Math.min(100,confidence))}%</Badge>}</header>
  <div className="ai-inbox-extracted-grid">{fields.map(field=><Card key={field.label} className="ai-inbox-extracted"><span className="ai-inbox-icon"><Icon name={field.icon} size={21}/></span><div><strong>{field.label}</strong><p>{text(field.value)}</p>{field.extra&&<small>{field.extra}</small>}</div>{onEdit&&<Button className="ai-inbox-edit" aria-label={`Editar ${field.label.toLowerCase()} en el pedido`} title="Editar en el formulario del pedido" onClick={onEdit}><Icon name="edit" size={15}/></Button>}</Card>)}</div>
  <p className="ai-inbox-note"><Icon name="info" size={16}/>La IA ha extraído esta información del correo y sus adjuntos. Revisa y completa los datos antes de crear el pedido.</p>
  {['suggestions','warnings','issues'].map((key,index)=>preview[key]?.length>0&&<section key={key} className={`ai-inbox-findings ai-inbox-findings-${key}`}><strong>{['Sugerencias','Avisos','Pendiente de completar'][index]}</strong><ul>{preview[key].map((item,i)=><li key={i}>{item.message||item.detail||item.label||String(item)}</li>)}</ul></section>)}
  {preview.source?.ai_visual&&<details className="ai-inbox-disclosure"><summary>Detalle del análisis documental</summary><p>{preview.source.ai_visual.ok?`Documento analizado con ${preview.source.ai_visual.provider||'el proveedor configurado'}${preview.source.ai_visual.model?` · ${preview.source.ai_visual.model}`:''}`:preview.source.ai_visual.reason==='sin_api_key'?'Las imágenes y los PDF escaneados requieren configurar la IA visual en SuperAdmin.':'Se conserva la extracción local disponible.'}</p></details>}
  {(more.length>0||points(order.puntos_carga).length>0||points(order.puntos_descarga).length>0)&&<details className="ai-inbox-disclosure"><summary>Referencias, tarifas y puntos detectados</summary><dl>{more.map(key=><div key={key}><dt>{key.replace(/_/g,' ')}</dt><dd>{text(order[key])}</dd></div>)}</dl>{[['Recogidas',order.puntos_carga],['Entregas',order.puntos_descarga]].map(([label,value])=>points(value).length>0&&<section key={label}><strong>{label}</strong>{points(value).map((point,index)=><p key={index}>{index+1}. {[point.cliente_nombre||point.nombre||point.ciudad,point.direccion,point.fecha,point.ventana||point.hora].filter(Boolean).join(' · ')}</p>)}</section>)}</details>}
  <p className="ai-inbox-next">{preview.next_action||'Se abrirá el formulario con estos datos para revisarlos y guardar el pedido.'}</p>
 </section>;
}
