import {Button} from '../ui';
import {money,quantity} from './PlannerUI';
export default function PlannerCosts({detail,action,canEdit,busy}){
 const data=detail.reparto_coste;
 return <section><h3>Coste operativo imputado a la mercancía</h3>
  {data?<><p>{money(data.total)} · Repartido por {data.criterio}. Registrado: {new Date(data.registrado_at).toLocaleString('es-ES')}.</p><p>Incluye transporte, combustible, peajes, dietas y otros costes guardados en la carga. El precio del artículo conserva su coste de compra.</p><div className="planner-table"><table><thead><tr><th>Referencia</th><th>Cantidad</th><th>Coste del producto</th><th>Coste operativo</th><th>Coste total</th></tr></thead><tbody>{data.lineas.map(l=><tr key={l.linea_id}><td>{l.referencia}</td><td>{quantity(l.cantidad)}</td><td>{money(l.coste_producto)}</td><td>{money(l.coste_operativo)}</td><td>{money(l.coste_producto+l.coste_operativo)}</td></tr>)}</tbody></table></div></>:<p>No hay reparto registrado para esta preparación.</p>}
  {canEdit&&!['expedida','cancelada'].includes(detail.estado)&&<div className="pl-action-row">{[['peso','Repartir por peso'],['unidades','Repartir por unidades'],['venta','Repartir por valor de venta']].map(([criterio,label])=><Button key={criterio} disabled={busy} onClick={()=>action({accion:'repartir_coste',criterio})}>{label}</Button>)}</div>}
  <small>Si no hay peso, se reparte por unidades. Al expedir se registra el coste definitivo con el criterio elegido.</small>
 </section>;
}
