import { useState } from "react";
import { crearCliente } from "../../services/api";
import { GeoFields } from "../../components/GeoFields";

export default function ModalNuevoClienteRapido({ datosIniciales, onClose, onCreado }) {
  const [form, setForm] = useState({
    nombre: datosIniciales?.nombre || "",
    cif: "", email: "", telefono: "",
    calle: "", num_ext: "", codigo_postal: "", ciudad: "", provincia: "", pais: "España",
    forma_pago: "Transferencia bancaria", vencimiento: "", iban: "", notas: "",
    tipo_iva: 21, iva_regimen: "general",
    contacto_nombre: "", contacto_telefono: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fk = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"8px 12px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:12};

  // Detect incomplete fields
  const camposFaltantes = [
    !form.cif?.trim() && "CIF/NIF",
    !form.email?.trim() && "Email",
    !form.telefono?.trim() && "Telefono",
    !form.codigo_postal?.trim() && "Codigo postal",
    !form.ciudad?.trim() && "Ciudad",
  ].filter(Boolean);

  async function crear() {
    setError("");
    if (!form.nombre.trim()) { setError("El nombre / razon social es obligatorio."); return; }
    setSaving(true);
    try {
      const nuevo = await crearCliente({
        ...form,
        direccion: form.calle ? (form.calle + (form.num_ext?" "+form.num_ext:"")) : "",
        cp: form.codigo_postal,
        pendiente_revision: camposFaltantes.length > 0,
      });
      onCreado(nuevo);
    } catch(e) { setError(e.message || "No se pudo crear el cliente."); }
    finally { setSaving(false); }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:24,width:"min(600px,96vw)",maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:17,color:"var(--text)",marginBottom:4}}>Nuevo cliente</div>
        <div style={{fontSize:12,color:"var(--text4)",marginBottom:16}}>
          Puedes crear el cliente y continuar con el pedido. Administración podrá completar después los datos pendientes de su ficha.
        </div>

        {/* Datos basicos */}
        <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:6,marginTop:4,textTransform:"uppercase",letterSpacing:".06em"}}>Datos de empresa</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Nombre / Razon social *</label><input style={inp} value={form.nombre} onChange={fk("nombre")} autoFocus/></div>
          <div><label style={lbl}>CIF / NIF</label><input style={inp} value={form.cif} onChange={fk("cif")} placeholder="B12345678"/></div>
          <div><label style={lbl}>Telefono</label><input style={inp} value={form.telefono} onChange={fk("telefono")}/></div>
          <div><label style={lbl}>Email</label><input type="email" style={inp} value={form.email} onChange={fk("email")}/></div>
          <div><label style={lbl}>Forma de pago</label>
            <select style={inp} value={form.forma_pago} onChange={fk("forma_pago")}>
              {["Transferencia bancaria","Contado","Domiciliacion","Pagare","Confirming","Cheque"].map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Condicion de pago (dias)</label>
            <select style={inp} value={form.vencimiento} onChange={fk("vencimiento")}>
              <option value="">Sin definir</option>
              {["Contado","15 dias","30 dias","45 dias","60 dias","90 dias"].map(o=><option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div><label style={lbl}>IBAN</label><input style={inp} value={form.iban} onChange={fk("iban")} placeholder="ES00 0000 0000 0000 0000 0000"/></div>
        </div>

        {/* Direccion */}
        <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:6,marginTop:16,textTransform:"uppercase",letterSpacing:".06em"}}>Direccion fiscal</div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:"0 14px",alignItems:"end"}}>
          <div><label style={lbl}>Calle / Avenida</label><input style={inp} value={form.calle} onChange={fk("calle")} placeholder="Calle Mayor"/></div>
          <div><label style={lbl}>N. / Piso / Pta</label><input style={inp} value={form.num_ext} onChange={fk("num_ext")} placeholder="12, 3oB"/></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1.4fr 2fr 2fr 1.6fr",gap:"0 14px",alignItems:"end"}}>
          <div><label style={lbl}>Codigo postal</label><input style={inp} value={form.codigo_postal} onChange={fk("codigo_postal")} placeholder="28001"/></div>
          <div><label style={lbl}>Ciudad</label><input style={inp} value={form.ciudad} onChange={fk("ciudad")}/></div>
          <GeoFields
            values={form}
            onChange={(campo, valor) => setForm(p => ({ ...p, [campo]: valor }))}
            inputStyle={inp}
            labelStyle={lbl}
          />
        </div>

        {/* Contacto */}
        <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:6,marginTop:16,textTransform:"uppercase",letterSpacing:".06em"}}>Contacto</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
          <div><label style={lbl}>Nombre contacto</label><input style={inp} value={form.contacto_nombre} onChange={fk("contacto_nombre")}/></div>
          <div><label style={lbl}>Tel. contacto</label><input style={inp} value={form.contacto_telefono} onChange={fk("contacto_telefono")}/></div>
          <div style={{gridColumn:"1/-1"}}><label style={lbl}>Notas</label>
            <textarea style={{...inp,minHeight:56,resize:"vertical",fontFamily:"'DM Sans',sans-serif"}} value={form.notas} onChange={fk("notas")} placeholder="Indicaciones, horarios, referencias..."/>
          </div>
        </div>

        {/* Warning if incomplete */}
        {camposFaltantes.length > 0 && (
          <div style={{marginTop:14,padding:"10px 14px",background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.25)",borderRadius:8,fontSize:12,color:"#fbbf24",display:"flex",gap:8,alignItems:"flex-start"}}>
            <span style={{flexShrink:0}}>Aviso</span>
            <div>
              <div style={{fontWeight:700,marginBottom:3}}>Ficha pendiente de completar · puedes continuar con el pedido</div>
              <div style={{color:"var(--text4)"}}>Faltan: {camposFaltantes.join(", ")}. Administracion recibira una notificacion para completarlos.</div>
            </div>
          </div>
        )}
        {error && (
          <div style={{marginTop:14,padding:"10px 14px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,fontSize:12,color:"#ef4444",fontWeight:700}}>
            {error}
          </div>
        )}

        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"8px 16px",borderRadius:8,border:"1px solid var(--border2)",background:"transparent",color:"var(--text4)",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>
            Cancelar
          </button>
          <button onClick={crear} disabled={saving}
            style={{padding:"8px 20px",borderRadius:8,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer",opacity:saving?0.7:1}}>
            {saving?"Creando...":"Crear cliente y continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
