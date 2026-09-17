import { useState } from "react";
import { OrderSection, OrderDisclosure } from "./OrderEditorShell";
import { Button } from "../../../ui";

export default function OrderDocumentFields({editando, seleccionarDocsPendientes, TabDocsPedido, pendingDocs, setPendingDocs}) {
 const [count,setCount]=useState(null);
 return <OrderSection title="Documentación" icon="invoice">
  {editando?.id ? <OrderDisclosure title="Ver / adjuntar documentos" summary={count == null ? "Cargando documentos…" : count ? count + " documentos adjuntos" : "Sin documentos adjuntos"}>
    <TabDocsPedido compact pedido={editando} onCount={setCount}/>
  </OrderDisclosure> : <>
   <div className="order-editor-document-summary"><span>{pendingDocs.length ? pendingDocs.length + " documentos preparados" : "Sin documentos adjuntos"}</span><label className="tg-attachment-trigger tgui-button tgui-button--secondary">Añadir documentos<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:"none"}} onChange={seleccionarDocsPendientes}/></label></div>
   {pendingDocs.length > 0 && <OrderDisclosure title="Ver documentos preparados">{pendingDocs.map((d,idx)=><div className="order-editor-document-summary" key={d.nombre+idx}><div><strong>{d.nombre}</strong><small>{d.tipo} · {d.file_size_kb} KB · se subirá al guardar</small></div><Button onClick={()=>setPendingDocs(prev=>prev.filter((_,i)=>i!==idx))}>Quitar</Button></div>)}</OrderDisclosure>}
  </>}
 </OrderSection>;
}
