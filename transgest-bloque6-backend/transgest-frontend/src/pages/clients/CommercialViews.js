import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { getRutasCliente } from "../../services/api";
import { Button, Card, Page, PageHeader, KpiCard, Badge, SearchInput, Select, FilterBar, DataTable, MobileDataCard, DropdownMenu, Tabs, Drawer } from "../../ui";
import "./clients.css";

const money = value => Number(value || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const status = c => c.activo === false ? "Inactivo" : c.bloqueado ? "Bloqueado" : "Activo";
const tone = c => c.activo === false ? "neutral" : c.bloqueado ? "danger" : "success";
export function ClientImage({ value, name }) {
  return /^data:image\/(png|jpeg|webp);base64,/.test(value || "") ? <img className="clients-photo" src={value} alt={`Foto de ${name}`} /> : null;
}

export function ClientPhotoInput({ value, onChange, disabled, onReadingChange }) {
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  async function select(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 256 * 1024) {
      setError("Selecciona un PNG, JPG o WebP de hasta 256 KB."); return;
    }
    setReading(true); onReadingChange?.(true);
    try {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      await new Promise((resolve, reject) => { const img = new Image(); img.onload = resolve; img.onerror = reject; img.src = data; });
      onChange(data);
    } catch { setError("No se ha podido leer la imagen. Prueba con otro archivo."); }
    finally { setReading(false); onReadingChange?.(false); }
  }
  return <div className="clients-photo-field">
    <ClientImage value={value} name="este cliente" />
    <div><strong>Foto o logo del cliente</strong><p>Opcional · PNG, JPG o WebP · Máximo 256 KB</p>
      {!disabled && <label className="clients-upload">{reading ? "Leyendo imagen…" : value ? "Cambiar imagen" : "Subir imagen"}<input aria-label="Foto o logo del cliente" type="file" accept="image/png,image/jpeg,image/webp" disabled={reading} onChange={select} /></label>}
      {!disabled && value && <Button disabled={reading} onClick={() => { onChange(null); setError(""); }}>Quitar imagen</Button>}
      {!value && <small>Sin imagen</small>}
      {error && <p role="alert" className="clients-error">{error}</p>}
    </div>
  </div>;
}

export function CommercialNav({ active }) {
  const { puedeVer } = useAuth();
  return <nav className="clients-nav" aria-label="Clientes y tarifas">
    {[["clientes", "Clientes"], ["rutas", "Rutas y tarifas"]].filter(([id]) => puedeVer(id)).map(([id, label]) => <Button key={id} aria-current={active === id ? "page" : undefined} onClick={() => active !== id && window.dispatchEvent(new CustomEvent("tms:navegar", { detail: id }))}>{label}</Button>)}
  </nav>;
}

function ClientSummary({ client, onClose, onEdit, canEdit, globalRoutes }) {
  const [tab, setTab] = useState("resumen");
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(false);
    getRutasCliente(client.id).then(data => { if (alive) setRoutes(Array.isArray(data) ? data : []); }).catch(() => {
      if (alive) { setRoutes(globalRoutes.filter(r => String(r.cliente_id) === String(client.id))); setError(true); }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [client.id, globalRoutes]);
  const info = tab === "contactos" ? [["Persona de contacto", client.contacto_nombre || client.contacto], ["Teléfono", client.contacto_telefono || client.telefono], ["Email", client.email], ["Email de facturación", client.email_facturacion], ["Albaranes", client.emails_albaranes]]
    : tab === "direcciones" ? [["Dirección social", [client.calle || client.direccion, client.num_ext, client.piso_puerta].filter(Boolean).join(" ")], ["Localidad", [client.cod_postal || client.cp, client.municipio || client.ciudad, client.provincia].filter(Boolean).join(" ")], ["País", client.pais_iso || client.pais], ["Dirección fiscal", client.dir_fiscal_distinta ? [client.fiscal_calle, client.fiscal_num_ext, client.fiscal_cod_postal, client.fiscal_municipio].filter(Boolean).join(" ") : "Igual que la dirección social"]]
      : tab === "condiciones" ? [["Forma de pago", client.forma_pago], ["Vencimiento", client.dias_pago || client.vencimiento], ["IVA", client.tipo_iva != null ? `${client.tipo_iva}%` : null], ["Límite de riesgo", money(client.limite_riesgo)], ["Modo de facturación", client.modo_facturacion?.replace(/_/g, " ")], ["Observaciones", client.notas]]
        : [["CIF / NIF", client.cif], ["Dirección", [client.calle || client.direccion, client.municipio || client.ciudad].filter(Boolean).join(", ")], ["Teléfono", client.telefono], ["Contacto", client.contacto_nombre || client.contacto], ["Email", client.email], ["Página web", client.web]];
  return <div className="clients-detail-content">
    <header className="clients-detail-heading"><ClientImage value={client.imagen_data} name={client.nombre} /><div><h2>{client.nombre}</h2><Badge tone={tone(client)}>{status(client)}</Badge>{client.pendiente_revision && <Badge tone="warning">Pendiente de revisión</Badge>}</div><Button aria-label="Cerrar resumen de cliente" onClick={onClose}>×</Button></header>
    <Tabs idPrefix="client-detail" label="Ficha del cliente" value={tab} onChange={setTab} items={[["resumen", "Resumen"], ["contactos", "Contactos"], ["direcciones", "Direcciones"], ["condiciones", "Condiciones"], ["rutas", "Rutas y tarifas"]].map(([value,label]) => ({value,label}))} />
    <div id="client-detail-panel" role="tabpanel" aria-labelledby={`client-detail-${tab}`}>
      {tab !== "rutas" && <Card className="clients-info"><header><h3>{tab === "resumen" ? "Información general" : tab === "contactos" ? "Contactos" : tab === "direcciones" ? "Direcciones" : "Condiciones comerciales"}</h3>{canEdit && <Button onClick={() => onEdit(tab === "condiciones" ? "facturacion" : "datos")}>Editar</Button>}</header><dl>{info.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || "Sin indicar"}</dd></div>)}</dl>{tab === "direcciones" && <Button onClick={() => onEdit("puntos")}>Gestionar puntos y direcciones</Button>}</Card>}
      {(tab === "resumen" || tab === "rutas") && <Card className="clients-info"><header><h3>Rutas y tarifas {!loading && `(${routes.length})`}</h3><Button onClick={() => onEdit("rutas")}>Ver todas</Button></header>
        {error && <p role="status">No se han podido actualizar las tarifas. Se muestran las rutas disponibles en el listado.</p>}
        <DataTable loading={loading} rows={routes.slice(0, tab === "rutas" ? 10 : 5)} emptyTitle="Sin rutas asociadas" columns={[{key:"origen",label:"Origen"},{key:"destino",label:"Destino"},{key:"precio",label:"Precio acordado",render:r => <span className="clients-price">{money(r.precio_base ?? r.precio)}<small> / {r.tarifa_tipo === "kg" ? "100 kg" : r.tarifa_tipo || "viaje"}</small></span>}]} />
        {canEdit && <Button onClick={() => onEdit("rutas")}>Gestionar / añadir ruta o tarifa</Button>}
      </Card>}
    </div>
    <footer className="clients-detail-footer"><Button onClick={() => onEdit("datos")}>{canEdit ? "Abrir ficha completa / subir imagen" : "Abrir ficha completa"}</Button><small>Historial de pedidos, portal del cliente y opciones avanzadas en la ficha completa.</small></footer>
  </div>;
}

export default function ClientsWorkspace({ clientes, rutas, loading, error, reload, q, setQ, mostrarBaja, setMostrarBaja, soloPendientes, setSoloPendientes, onEdit, onDelete, onReviewed, canEdit }) {
  const [selectedId, setSelectedId] = useState(null);
  const [state, setState] = useState("");
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(1);
  const [mobile, setMobile] = useState(() => window.innerWidth < 1100);
  useEffect(() => { const m = window.matchMedia("(max-width: 1099px)"); const update = () => setMobile(m.matches); m.addEventListener("change", update); return () => m.removeEventListener("change", update); }, []);
  useEffect(() => setPage(1), [q, mostrarBaja, soloPendientes, state, size]);
  const visible = clientes.filter(c => (!soloPendientes || c.pendiente_revision) && (!state || (state === "blocked" ? c.bloqueado : !c.bloqueado)));
  const selected = clientes.find(c => c.id === selectedId);
  const totalPages = Math.max(1, Math.ceil(visible.length / size));
  const current = Math.min(page, totalPages);
  const rows = visible.slice((current - 1) * size, current * size);
  function exportList() {
    const safe = v => `"${String(v ?? "").replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const csv = [["Cliente","CIF","Ciudad","Teléfono","Email","Estado"], ...visible.map(c => [c.nombre,c.cif,c.municipio || c.ciudad,c.telefono,c.email,status(c)])].map(row => row.map(safe).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff",csv], {type:"text/csv;charset=utf-8"}));
    const a = document.createElement("a"); a.href=url; a.download="clientes-listado.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const actions = c => <DropdownMenu label={`Acciones de ${c.nombre}`} items={[{label:"Ver resumen",onClick:()=>setSelectedId(c.id)},{label:"Abrir ficha",onClick:()=>onEdit(c,"datos")}, ...(canEdit ? [{label:"Editar cliente",onClick:()=>onEdit(c,"datos")}, ...(c.pendiente_revision ? [{label:"Marcar revisado",onClick:()=>onReviewed(c)}] : []), {label:"Dar de baja",danger:true,onClick:()=>onDelete(c)}] : [])]} />;
  const columns = [{key:"nombre",label:"Cliente",render:c => <button className="clients-name" onClick={() => setSelectedId(c.id)}><ClientImage value={c.imagen_data} name={c.nombre} />{c.nombre}</button>},{key:"cif",label:"CIF",render:c=>c.cif || "—"},{key:"ciudad",label:"Ciudad",render:c=>c.municipio || c.ciudad || "—"},{key:"contacto",label:"Contacto",render:c=>c.contacto_nombre || c.contacto || c.telefono || "—"},{key:"estado",label:"Estado",render:c=><Badge tone={tone(c)}>{status(c)}</Badge>},{key:"revision",label:"Revisión",render:c=><Badge tone={c.pendiente_revision ? "warning" : "neutral"}>{c.pendiente_revision ? "Pendiente" : "Revisado"}</Badge>},{key:"actions",label:"Acciones",render:actions}];
  const detail = selected && <ClientSummary key={selected.id} client={selected} globalRoutes={rutas} canEdit={canEdit} onClose={() => setSelectedId(null)} onEdit={tab => onEdit(selected,tab)} />;
  return <Page className="clients-page"><PageHeader title="Clientes" description="Gestiona tu cartera de clientes, sus datos, rutas, tarifas y condiciones comerciales." actions={<><Button onClick={exportList} disabled={loading || !visible.length}>Exportar</Button>{canEdit && <Button variant="primary" onClick={() => onEdit(null,"datos")}>+ Nuevo cliente</Button>}</>} />
    <CommercialNav active="clientes" />
    <div className={`clients-workspace${selected && !mobile ? " clients-workspace--selected" : ""}`}>
      <div className="clients-list">
        <div className="clients-kpis"><KpiCard label={mostrarBaja ? "Clientes de baja" : "Clientes activos"} value={loading ? "—" : clientes.length} detail="En el listado cargado" icon="clients" tone="success" /><KpiCard label="Bloqueados" value={loading ? "—" : clientes.filter(c=>c.bloqueado).length} detail="No admiten viajes" icon="alert" tone="danger" /><KpiCard label="Pendientes de revisión" value={loading ? "—" : clientes.filter(c=>c.pendiente_revision).length} detail="Datos por validar" icon="invoice" tone="warning" /><KpiCard label="Rutas y tarifas" value={rutas.length} detail="Rutas cargadas" icon="route" tone="success" /></div>
        <Card className="clients-table"><FilterBar search={<SearchInput label="Buscar clientes" placeholder="Buscar por nombre, CIF…" value={q} onChange={e=>setQ(e.target.value)} />} advanced={<label><input type="checkbox" checked={soloPendientes} onChange={e=>setSoloPendientes(e.target.checked)} /> Pendientes de revisión</label>}><Select label="Estado de clientes" value={state} onChange={e=>setState(e.target.value)}><option value="">Todos los estados</option><option value="available">Sin bloqueo</option><option value="blocked">Bloqueados</option></Select><Select label="Altas y bajas" value={mostrarBaja ? "inactive" : "active"} onChange={e=>setMostrarBaja(e.target.value === "inactive")}><option value="active">Clientes activos</option><option value="inactive">Dados de baja</option></Select></FilterBar>
          {error ? <div className="clients-error" role="alert"><p>{error}</p><Button onClick={reload}>Reintentar</Button></div> : <DataTable loading={loading} rows={rows} columns={columns} rowClassName={c=>c.id === selectedId ? "clients-selected" : ""} onRowClick={c=>setSelectedId(c.id)} emptyTitle="No hay clientes con estos filtros" renderMobile={c=><MobileDataCard title={<button className="clients-name" onClick={()=>setSelectedId(c.id)}><ClientImage value={c.imagen_data} name={c.nombre} />{c.nombre}</button>} subtitle={[c.cif,c.municipio || c.ciudad].filter(Boolean).join(" · ")} actions={<><Button onClick={()=>setSelectedId(c.id)}>Ver resumen</Button>{actions(c)}</>}><Badge tone={tone(c)}>{status(c)}</Badge><span>{c.telefono || "Sin teléfono"}</span>{c.pendiente_revision && <Badge tone="warning">Pendiente de revisión</Badge>}</MobileDataCard>} />}
          <footer className="clients-pagination"><small>{visible.length ? `${(current-1)*size+1}–${Math.min(current*size,visible.length)} de ${visible.length}` : "0"} clientes del listado cargado (máximo 100)</small><div><Button aria-label="Página anterior de clientes" disabled={current===1} onClick={()=>setPage(current-1)}>‹</Button><span>{current} / {totalPages}</span><Button aria-label="Página siguiente de clientes" disabled={current===totalPages} onClick={()=>setPage(current+1)}>›</Button><Select label="Clientes por página" value={size} onChange={e=>setSize(Number(e.target.value))}><option value={10}>10 por página</option><option value={25}>25 por página</option><option value={50}>50 por página</option></Select></div></footer>
        </Card>
      </div>
      {selected && !mobile && <Card as="aside" className="clients-detail" aria-label="Resumen del cliente">{detail}</Card>}
      {selected && mobile && <Drawer title="Resumen del cliente" onClose={()=>setSelectedId(null)} width={560}>{detail}</Drawer>}
    </div>
  </Page>;
}
