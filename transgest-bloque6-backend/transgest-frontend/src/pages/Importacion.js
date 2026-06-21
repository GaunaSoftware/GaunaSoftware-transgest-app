import { useEffect, useRef, useState } from "react";
import { crearCliente, editarCliente, crearVehiculo, crearChofer, crearPedido, crearColaborador, crearFactura, getClientes, crearRutaCliente, getDatosMaestrosReadiness } from "../services/api";
import { notify } from "../services/notify";

let clientesImportCachePromise = null;

async function getClientesImportCache() {
  if (!clientesImportCachePromise) {
    clientesImportCachePromise = getClientes()
      .then((rows) => Array.isArray(rows) ? rows : [])
      .catch((error) => {
        clientesImportCachePromise = null;
        throw error;
      });
  }
  return clientesImportCachePromise;
}

function clearClientesImportCache() {
  clientesImportCachePromise = null;
}

// ── Plantillas de columnas por tipo ───────────────────────────────────────
function parseImportNumber(value, fallback = 0) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  let normalized = raw.replace(/\s/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function parseImportBool(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return ["1", "si", "sí", "true", "x", "bloqueado", "bloqueada"].includes(raw);
}

async function findClienteForImport(data, label = "registro") {
  const clientes = await getClientesImportCache();
  const nombre = String(data.cliente_nombre || data.nombre || "").trim().toLowerCase();
  const cif = String(data.cliente_cif || data.cif || "").trim().toLowerCase();
  const cliente = clientes.find((c) => {
    const sameCif = cif && String(c.cif || "").trim().toLowerCase() === cif;
    const sameName = nombre && String(c.nombre || "").trim().toLowerCase() === nombre;
    return sameCif || sameName;
  });
  if (!cliente?.id) {
    throw new Error(`Cliente no encontrado para ${label}: ${data.cliente_nombre || data.cliente_cif || data.nombre || "sin identificar"}`);
  }
  return cliente;
}

const TEMPLATES = {
  clientes: {
    nombre: "Clientes",
    icon: "",
    columns: [
      { k:"nombre",        l:"Nombre / Razón social", req:true,  example:"Transportes García S.L." },
      { k:"cif",           l:"CIF / NIF",             req:false, example:"B12345678" },
      { k:"email",         l:"Email",                 req:false, example:"info@garcia.com" },
      { k:"telefono",      l:"Teléfono",              req:false, example:"912345678" },
      { k:"direccion",     l:"Dirección fiscal",      req:false, example:"Calle Mayor 1, Madrid" },
      { k:"pais",          l:"País",                  req:false, example:"ES" },
      { k:"forma_pago",    l:"Forma de pago",         req:false, example:"transferencia" },
      { k:"dias_pago",     l:"Días de pago",          req:false, example:"30" },
      { k:"tipo_iva",      l:"Tipo IVA (%)",          req:false, example:"21" },
      { k:"limite_riesgo", l:"Limite de riesgo EUR",  req:false, example:"5000" },
      { k:"bloqueado",     l:"Bloqueado (si/no)",     req:false, example:"no" },
      { k:"bloqueo_motivo",l:"Motivo bloqueo",        req:false, example:"Impagos pendientes" },
      { k:"notas",         l:"Notas",                 req:false, example:"Cliente VIP" },
    ],
    apiFn: (data) => crearCliente({
      ...data,
      limite_riesgo: parseImportNumber(data.limite_riesgo, 0),
      bloqueado: parseImportBool(data.bloqueado),
    }),
  },
  clientes_situacion: {
    nombre: "Situacion de clientes",
    icon: "",
    columns: [
      { k:"cliente_nombre", l:"Nombre cliente",       req:false, example:"Transportes Garcia S.L." },
      { k:"cliente_cif",    l:"CIF cliente",          req:false, example:"B12345678" },
      { k:"limite_riesgo",  l:"Limite riesgo EUR",    req:false, example:"5000" },
      { k:"bloqueado",      l:"Bloqueado (si/no)",    req:false, example:"no" },
      { k:"bloqueo_motivo", l:"Motivo bloqueo",       req:false, example:"Impago o riesgo excedido" },
      { k:"saldo_pendiente",l:"Saldo pendiente EUR",  req:false, example:"1250.50" },
      { k:"notas",          l:"Notas internas",       req:false, example:"Saldo inicial importado desde ERP anterior" },
    ],
    apiFn: async (data) => {
      const cliente = await findClienteForImport(data, "situacion de cliente");
      const notas = [
        data.notas,
        data.saldo_pendiente ? `Saldo pendiente inicial/importado: ${data.saldo_pendiente} EUR` : "",
      ].filter(Boolean).join(" | ");
      return editarCliente(cliente.id, {
        ...cliente,
        limite_riesgo: parseImportNumber(data.limite_riesgo, cliente.limite_riesgo || 0),
        bloqueado: parseImportBool(data.bloqueado),
        bloqueo_motivo: data.bloqueo_motivo || cliente.bloqueo_motivo || "",
        notas: notas || cliente.notas || "",
      });
    },
  },
  colaboradores: {
    nombre: "Colaboradores",
    icon: "",
    columns: [
      { k:"nombre",           l:"Razon social / nombre",  req:true,  example:"Servitrans Yaiza S.L." },
      { k:"cif",              l:"CIF / NIF",              req:false, example:"B12345678" },
      { k:"email",            l:"Email",                  req:false, example:"trafico@servitrans.com" },
      { k:"telefono",         l:"Telefono",               req:false, example:"612345678" },
      { k:"iban",             l:"IBAN",                   req:false, example:"ES0012341234123412341234" },
      { k:"calle",            l:"Direccion",              req:false, example:"Calle Mayor 1" },
      { k:"codigo_postal",    l:"Codigo postal",          req:false, example:"28001" },
      { k:"ciudad",           l:"Ciudad",                 req:false, example:"Madrid" },
      { k:"provincia",        l:"Provincia",              req:false, example:"Madrid" },
      { k:"pais",             l:"Pais",                   req:false, example:"España" },
      { k:"contacto_nombre",  l:"Contacto",               req:false, example:"Laura Garcia" },
      { k:"contacto_telefono",l:"Telefono contacto",      req:false, example:"612345679" },
      { k:"forma_pago",       l:"Forma de pago",          req:false, example:"Transferencia 30 dias" },
      { k:"notas",            l:"Notas",                  req:false, example:"Colaborador habitual" },
    ],
    apiFn: (data) => crearColaborador({ ...data, pendiente_revision: false, origen_creacion: "importacion" }),
  },
  vehiculos: {
    nombre: "Vehículos",
    icon: "",
    columns: [
      { k:"matricula",     l:"Matrícula",             req:true,  example:"1234-ABC" },
      { k:"marca",         l:"Marca",                 req:false, example:"Volvo" },
      { k:"modelo",        l:"Modelo",                req:false, example:"FH 460" },
      { k:"clase",         l:"Clase (Tráiler/Rígido/Furgón)", req:false, example:"Tráiler" },
      { k:"ano",           l:"Año",                   req:false, example:"2020" },
      { k:"km_actuales",   l:"KM actuales",           req:false, example:"150000" },
      { k:"bastidor",      l:"Nº bastidor",           req:false, example:"VF1AA..." },
      { k:"fecha_itv",     l:"Fecha ITV",             req:false, example:"2026-12-31" },
      { k:"fecha_seguro",  l:"Fecha seguro",          req:false, example:"2026-12-31" },
      { k:"carga_max_kg",  l:"Carga maxima kg",       req:false, example:"25000" },
      { k:"tara_kg",       l:"Tara kg",               req:false, example:"7800" },
      { k:"estado",        l:"Estado",                req:false, example:"disponible" },
    ],
    apiFn: (data) => crearVehiculo({
      ...data,
      anio: data.ano || data.anio || null,
      numero_bastidor: data.bastidor || data.numero_bastidor || null,
    }),
  },
  choferes: {
    nombre: "Chóferes",
    icon: "",
    columns: [
      { k:"nombre",        l:"Nombre",                req:true,  example:"Juan" },
      { k:"apellidos",     l:"Apellidos",             req:false, example:"García López" },
      { k:"email",         l:"Email",                 req:false, example:"juan@empresa.com" },
      { k:"telefono",      l:"Teléfono",              req:false, example:"612345678" },
      { k:"dni",           l:"DNI / NIE",             req:false, example:"12345678A" },
      { k:"tipo_contrato", l:"Tipo contrato",         req:false, example:"Indefinido" },
      { k:"categoria_carnet",l:"Categoria carnet",    req:false, example:"C+E" },
    ],
    apiFn: crearChofer,
  },
  pedidos: {
    nombre: "Pedidos / Viajes históricos",
    icon: "",
    columns: [
      { k:"origen",        l:"Origen (ciudad carga)", req:true,  example:"Madrid" },
      { k:"destino",       l:"Destino (ciudad entrega)",req:true, example:"Barcelona" },
      { k:"fecha_carga",   l:"Fecha carga (YYYY-MM-DD)",req:true, example:"2025-01-15" },
      { k:"fecha_descarga",l:"Fecha descarga",        req:false, example:"2025-01-16" },
      { k:"cliente_nombre",l:"Nombre cliente",        req:false, example:"Transportes García" },
      { k:"importe",       l:"Importe (€)",           req:false, example:"850.00" },
      { k:"vehiculo_matricula",l:"Matrícula vehículo",req:false, example:"1234-ABC" },
      { k:"chofer_nombre", l:"Nombre chófer",         req:false, example:"Juan García" },
      { k:"peso_kg",       l:"Peso (kg)",             req:false, example:"5000" },
      { k:"bultos",        l:"Bultos / Pallets",      req:false, example:"20" },
      { k:"estado",        l:"Estado",                req:false, example:"entregado" },
      { k:"notas",         l:"Notas",                 req:false, example:"Urgente" },
    ],
    apiFn: crearPedido,
  },
  viajes_pendientes: {
    nombre: "Viajes pendientes",
    icon: "",
    columns: [
      { k:"origen",        l:"Origen (ciudad carga)", req:true,  example:"Madrid" },
      { k:"destino",       l:"Destino (ciudad entrega)",req:true, example:"Barcelona" },
      { k:"fecha_carga",   l:"Fecha carga (YYYY-MM-DD)",req:true, example:"2026-07-01" },
      { k:"fecha_descarga",l:"Fecha descarga",        req:false, example:"2026-07-02" },
      { k:"cliente_nombre",l:"Nombre cliente",        req:false, example:"Transportes Garcia" },
      { k:"cliente_cif",   l:"CIF cliente",           req:false, example:"B12345678" },
      { k:"importe",       l:"Importe (EUR)",         req:false, example:"850.00" },
      { k:"vehiculo_matricula",l:"Matricula vehiculo",req:false, example:"1234-ABC" },
      { k:"chofer_nombre", l:"Nombre chofer",         req:false, example:"Juan Garcia" },
      { k:"peso_kg",       l:"Peso (kg)",             req:false, example:"24000" },
      { k:"bultos",        l:"Bultos / Pallets",      req:false, example:"20" },
      { k:"estado",        l:"Estado",                req:false, example:"pendiente" },
      { k:"notas",         l:"Notas",                 req:false, example:"Pendiente de asignar" },
    ],
    apiFn: (data) => crearPedido({
      ...data,
      estado: data.estado || "pendiente",
      importe: parseImportNumber(data.importe, 0),
      peso_kg: parseImportNumber(data.peso_kg, 0),
      bultos: parseImportNumber(data.bultos, 0),
    }),
  },
  facturas_pendientes: {
    nombre: "Facturas pendientes",
    icon: "",
    columns: [
      { k:"cliente_nombre",    l:"Nombre cliente",              req:false, example:"Transportes Garcia S.L." },
      { k:"cliente_cif",       l:"CIF cliente",                 req:false, example:"B12345678" },
      { k:"numero_origen",     l:"Numero factura origen",       req:false, example:"ERP-2026-0012" },
      { k:"fecha",             l:"Fecha factura",               req:false, example:"2026-06-01" },
      { k:"fecha_vencimiento", l:"Fecha vencimiento",           req:false, example:"2026-07-01" },
      { k:"base",              l:"Base imponible EUR",          req:false, example:"1000" },
      { k:"tipo_iva",          l:"IVA %",                       req:false, example:"21" },
      { k:"total",             l:"Total pendiente EUR",         req:true,  example:"1210" },
      { k:"estado",            l:"Estado",                      req:false, example:"emitida" },
      { k:"forma_pago",        l:"Forma de pago",               req:false, example:"transferencia" },
      { k:"notas",             l:"Notas",                       req:false, example:"Pendiente de cobro en ERP anterior" },
    ],
    apiFn: async (data) => {
      const cliente = await findClienteForImport(data, "factura pendiente");
      const total = parseImportNumber(data.total, 0);
      const tipoIva = parseImportNumber(data.tipo_iva, cliente.tipo_iva ?? 21);
      const base = data.base ? parseImportNumber(data.base, 0) : (tipoIva ? total / (1 + tipoIva / 100) : total);
      const estados = ["borrador", "emitida", "enviada", "vencida", "reclamada", "sin_cobrar"];
      const estado = estados.includes(String(data.estado || "").toLowerCase()) ? String(data.estado).toLowerCase() : "emitida";
      return crearFactura({
        cliente_id: cliente.id,
        serie: "A",
        fecha: data.fecha || undefined,
        fecha_vencimiento: data.fecha_vencimiento || undefined,
        estado,
        forma_pago: data.forma_pago || cliente.forma_pago || "transferencia",
        observaciones: [
          data.numero_origen ? `Factura origen importada: ${data.numero_origen}` : "",
          data.notas || "",
        ].filter(Boolean).join(" | "),
        notas_internas: "Importada como factura pendiente inicial. Revisar conciliacion/cobro en gestion financiera.",
        lineas: [{
          concepto: data.numero_origen ? `Saldo pendiente factura ${data.numero_origen}` : "Saldo pendiente importado",
          cantidad: 1,
          precio_unit: Math.round(base * 100) / 100,
        }],
      });
    },
  },
  tarifas: {
    nombre: "Tarifas de clientes",
    icon: "",
    columns: [
      { k:"cliente_nombre",l:"Nombre cliente",        req:true,  example:"Transportes García" },
      { k:"cliente_cif",   l:"CIF cliente",           req:false, example:"B12345678" },
      { k:"origen",        l:"Origen",                req:false, example:"Madrid" },
      { k:"destino",       l:"Destino",               req:false, example:"Barcelona" },
      { k:"tipo_precio",   l:"Tipo (viaje/kg/km)",    req:true,  example:"viaje" },
      { k:"precio",        l:"Precio (€)",            req:true,  example:"850.00" },
      { k:"vigencia_desde",l:"Vigencia desde",        req:false, example:"2025-01-01" },
      { k:"vigencia_hasta",l:"Vigencia hasta",        req:false, example:"2025-12-31" },
    ],
    apiFn: async (data) => {
      const cliente = await findClienteForImport(data, "tarifa");
      return crearRutaCliente(cliente.id, {
        origen: data.origen || "",
        destino: data.destino || "",
        tarifa_tipo: data.tipo_precio || "viaje",
        precio_base: Number(data.precio || 0),
        minimo_facturable: Number(data.minimo_facturable || 0) || null,
        minimo_unidades: Number(data.minimo_unidades || 0) || null,
        recargo_combustible_pct: Number(data.recargo_combustible_pct || 0) || 0,
        notas: [data.vigencia_desde ? `Vigencia desde: ${data.vigencia_desde}` : "", data.vigencia_hasta ? `Vigencia hasta: ${data.vigencia_hasta}` : ""].filter(Boolean).join(" | ") || null,
      });
    },
  },
};

const READINESS_SECTIONS = [
  { key:"clientes", label:"Clientes", view:"clientes" },
  { key:"clientes_situacion", label:"Situacion clientes", view:"clientes" },
  { key:"colaboradores", label:"Colaboradores", view:"colaboradores" },
  { key:"choferes", label:"Choferes", view:"choferes" },
  { key:"vehiculos", label:"Vehiculos", view:"vehiculos" },
  { key:"viajes_pendientes", label:"Viajes pendientes", view:"pedidos" },
  { key:"facturas_pendientes", label:"Facturas pendientes", view:"facturacion" },
];

// ── Parse CSV / TSV ────────────────────────────────────────────────────────
function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  if(lines.length < 2) return { headers:[], rows:[] };
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const parseRow = row => {
    const cells=[]; let cur="", inQ=false;
    for(const ch of row){
      if(ch==='"'){inQ=!inQ;}
      else if(ch===sep&&!inQ){cells.push(cur.trim());cur="";}
      else cur+=ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  const headers = parseRow(lines[0]).map(h=>h.replace(/['"]/g,"").trim());
  const rows = lines.slice(1).map(l=>parseRow(l));
  return { headers, rows };
}

// ── Match column headers to template keys ─────────────────────────────────
function matchHeaders(fileHeaders, templateCols){
  const map = {};
  fileHeaders.forEach((fh,i)=>{
    const fhN = fh.toLowerCase().replace(/[^a-z0-9]/g,"");
    const match = templateCols.find(c=>{
      const cN = c.l.toLowerCase().replace(/[^a-z0-9]/g,"");
      const kN = c.k.toLowerCase().replace(/[^a-z0-9]/g,"");
      return cN===fhN || kN===fhN || fhN.includes(kN) || kN.includes(fhN);
    });
    if(match) map[match.k] = i;
  });
  return map;
}

// ── Generar plantilla Excel CSV ───────────────────────────────────────────
function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadTemplate(tipo){
  const tpl = TEMPLATES[tipo];
  downloadCsv(`plantilla_${tipo}_transgest.csv`, [
    tpl.columns.map(c=>c.l),
    tpl.columns.map(c=>c.example||""),
  ]);
}

function downloadCoreTemplates(){
  ["clientes","clientes_situacion","vehiculos","choferes","colaboradores","viajes_pendientes","facturas_pendientes","tarifas"].forEach((tipo, index) => {
    setTimeout(() => downloadTemplate(tipo), index * 180);
  });
}

function scoreColor(estadoOrScore) {
  if (typeof estadoOrScore === "number") {
    if (estadoOrScore >= 90) return "var(--green)";
    if (estadoOrScore >= 70) return "#f59e0b";
    return "var(--red)";
  }
  if (estadoOrScore === "verde") return "var(--green)";
  if (estadoOrScore === "amarillo") return "#f59e0b";
  return "var(--red)";
}

function flattenPendientes(readiness) {
  const secciones = readiness?.secciones || {};
  return READINESS_SECTIONS.flatMap(sec => {
    const items = Array.isArray(secciones[sec.key]?.items) ? secciones[sec.key].items : [];
    return items
      .filter(item => Number(item.missing_required || 0) > 0 || Number(item.score || 0) < 90)
      .map(item => ({ ...item, sectionKey: sec.key, sectionLabel: sec.label, view: sec.view }));
  });
}

function navegar(view) {
  window.dispatchEvent(new CustomEvent("tms:navegar", { detail: view }));
}

// ═══════════════════════════════════════════════════════════════════════════
export default function Importacion(){
  const [tipoSel, setTipoSel] = useState("clientes");
  const [step,    setStep]    = useState("upload"); // upload | preview | importing | done
  const [preview, setPreview] = useState(null); // { headers, rows, mapping, parsed }
  const [errores, setErrores] = useState([]);
  const [progreso,setProgreso]= useState({done:0,total:0,errores:0});
  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessTab, setReadinessTab] = useState("clientes");
  const fileRef = useRef();

  const tpl = TEMPLATES[tipoSel];

  async function cargarReadiness({ silent = false } = {}) {
    setReadinessLoading(true);
    try {
      const data = await getDatosMaestrosReadiness();
      setReadiness(data || null);
      if (!silent) notify("Diagnostico de datos maestros actualizado", "success");
    } catch (e) {
      if (!silent) notify(e.message || "No se pudo cargar el diagnostico de datos maestros", "error");
    } finally {
      setReadinessLoading(false);
    }
  }

  useEffect(() => {
    cargarReadiness({ silent: true });
  }, []);

  function handleFile(e){
    const file = e.target.files?.[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const {headers,rows} = parseCSV(text);
      const mapping = matchHeaders(headers, tpl.columns);
      // Parse rows into objects
      const parsed = rows.filter(r=>r.some(c=>c.trim())).map((row,ri)=>{
        const obj = {};
        tpl.columns.forEach(col=>{
          const idx = mapping[col.k];
          if(idx!==undefined && row[idx]!==undefined) obj[col.k]=row[idx].trim();
        });
        return obj;
      });
      setPreview({headers,rows,mapping,parsed});
      setStep("preview");
    };
    reader.readAsText(file, "UTF-8");
  }

  function validar(row){
    return tpl.columns.filter(c=>c.req).filter(c=>!row[c.k]||!row[c.k].trim()).map(c=>c.l);
  }

  async function importar(){
    if(!preview) return;
    const invalidas = preview.parsed.map((row,i)=>({row,i,missing:validar(row)})).filter(v=>v.missing.length);
    if(invalidas.length>0){
      notify(`Hay ${invalidas.length} filas con errores. Corrige el archivo antes de importar.`, "warning");
      return;
    }
    if (["tarifas","clientes_situacion","facturas_pendientes"].includes(tipoSel)) clearClientesImportCache();
    setStep("importing");
    const errs=[];
    let done=0;
    for(const row of preview.parsed){
      const missing=validar(row);
      if(missing.length>0){ errs.push({row,error:"Campos obligatorios: "+missing.join(", ")}); continue; }
      try{
        await tpl.apiFn(row);
        done++;
        setProgreso({done,total:preview.parsed.length,errores:errs.length});
      }catch(e){
        errs.push({row,error:e.message||"Error desconocido"});
        setProgreso({done,total:preview.parsed.length,errores:errs.length});
      }
    }
    if (["clientes","clientes_situacion"].includes(tipoSel) && done > 0) clearClientesImportCache();
    setErrores(errs);
    setStep("done");
    if (done > 0 && ["clientes","colaboradores","choferes","vehiculos"].includes(tipoSel)) {
      cargarReadiness({ silent: true });
    }
  }

  const S={
    card:{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"16px 18px",marginBottom:14},
    btn:{padding:"7px 14px",borderRadius:7,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:5},
    th:{textAlign:"left",padding:"7px 10px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",borderBottom:"1px solid var(--border)",background:"var(--bg3)"},
    td:{padding:"7px 10px",borderBottom:"1px solid var(--border2)",fontSize:12,color:"var(--text2)"},
  };

  const validacionPreview = preview ? preview.parsed.map((row, i) => ({
    index: i + 1,
    row,
    missing: validar(row),
  })) : [];
  const filasInvalidas = validacionPreview.filter(v => v.missing.length);
  const filasValidas = validacionPreview.length - filasInvalidas.length;
  const resumenReadiness = readiness?.resumen || {};
  const pendientesReadiness = flattenPendientes(readiness);
  const activeReadinessDef = READINESS_SECTIONS.find(s => s.key === readinessTab) || READINESS_SECTIONS[0];
  const activeReadinessSection = readiness?.secciones?.[activeReadinessDef.key] || {};
  const activeReadinessItems = Array.isArray(activeReadinessSection.items) ? activeReadinessSection.items : [];
  const activePendientes = activeReadinessItems.filter(item => Number(item.missing_required || 0) > 0 || Number(item.score || 0) < 90);

  function descargarPendientesReadiness() {
    if (!pendientesReadiness.length) {
      notify("No hay pendientes de datos maestros para descargar", "info");
      return;
    }
    downloadCsv("pendientes_datos_maestros_transgest.csv", [
      ["Modulo","Registro","Score","Faltantes obligatorios","Faltantes opcionales","Campos pendientes","Contacto"],
      ...pendientesReadiness.map(item => [
        item.sectionLabel,
        item.nombre || "",
        `${item.score ?? 0}%`,
        item.missing_required || 0,
        item.missing_optional || 0,
        (item.missing || []).map(m => `${m.label}${m.required ? " (obligatorio)" : ""}`).join(" | "),
        item.contacto || "",
      ]),
    ]);
  }

  return(
    <div style={{flex:1, padding:"22px 26px",fontFamily:"'DM Sans',sans-serif",minHeight:"100vh"}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:900,color:"var(--text)",marginBottom:20}}>Importación de datos</div>

      <div style={{...S.card,background:"linear-gradient(135deg, rgba(0,145,125,.08), rgba(245,158,11,.05))",border:"1px solid rgba(0,145,125,.18)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,flexWrap:"wrap",marginBottom:12}}>
          <div>
            <div style={{fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--accent)",marginBottom:4}}>Datos maestros para operar</div>
            <div style={{fontSize:14,fontWeight:800,color:"var(--text)"}}>Clientes, colaboradores, choferes y vehiculos listos para pedidos, documentos y facturacion.</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:4}}>Usa este panel para localizar datos incompletos antes de que bloqueen el trabajo diario.</div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>cargarReadiness()} disabled={readinessLoading} style={{...S.btn,background:"var(--bg2)",border:"1px solid var(--border)",color:"var(--text3)",opacity:readinessLoading ? .6 : 1}}>
              {readinessLoading ? "Actualizando..." : "Actualizar"}
            </button>
            <button onClick={descargarPendientesReadiness} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>
              Descargar pendientes CSV
            </button>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10,marginBottom:12}}>
          {[
            { l:"Score medio", v:`${resumenReadiness.score_medio ?? 100}%`, c:scoreColor(resumenReadiness.score_medio ?? 100) },
            { l:"Revisados", v:resumenReadiness.total || 0, c:"var(--text)" },
            { l:"Completos", v:resumenReadiness.completos || 0, c:"var(--green)" },
            { l:"Incompletos", v:resumenReadiness.incompletos || 0, c:Number(resumenReadiness.incompletos||0)>0?"#f59e0b":"var(--green)" },
            { l:"Faltan obligatorios", v:resumenReadiness.faltantes_obligatorios || 0, c:Number(resumenReadiness.faltantes_obligatorios||0)>0?"var(--red)":"var(--green)" },
          ].map(k=>(
            <div key={k.l} style={{background:"rgba(255,255,255,.72)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 11px"}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color:k.c}}>{k.v}</div>
              <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:3}}>{k.l}</div>
            </div>
          ))}
        </div>

        <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:10}}>
          {READINESS_SECTIONS.map(sec => {
            const sr = readiness?.secciones?.[sec.key]?.resumen || {};
            const active = readinessTab === sec.key;
            const faltan = Number(sr.faltantes_obligatorios || 0);
            return (
              <button key={sec.key} onClick={()=>setReadinessTab(sec.key)} style={{...S.btn,background:active?"var(--accent)":"rgba(255,255,255,.72)",color:active?"#fff":"var(--text3)",border:`1px solid ${active?"transparent":"var(--border)"}`}}>
                {sec.label}
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:900,color:active?"#fff":faltan>0?"var(--red)":"var(--green)"}}>
                  {sr.score_medio ?? 100}%
                </span>
              </button>
            );
          })}
        </div>

        <div style={{background:"rgba(255,255,255,.74)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"10px 12px",borderBottom:"1px solid var(--border)",flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{activeReadinessDef.label}</div>
              <div style={{fontSize:11,color:"var(--text5)"}}>
                {activePendientes.length ? `${activePendientes.length} registros necesitan revision` : "Sin pendientes relevantes en este modulo"}
              </div>
            </div>
            <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
              {TEMPLATES[activeReadinessDef.key] && (
                <button onClick={()=>downloadTemplate(activeReadinessDef.key)} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text3)"}}>Plantilla</button>
              )}
              <button onClick={()=>navegar(activeReadinessDef.view)} style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)"}}>Abrir modulo</button>
            </div>
          </div>
          {readinessLoading && !readiness ? (
            <div style={{padding:18,fontSize:12,color:"var(--text4)"}}>Cargando diagnostico...</div>
          ) : activePendientes.length === 0 ? (
            <div style={{padding:18,fontSize:12,color:"var(--green)",fontWeight:800}}>Todo correcto para este filtro.</div>
          ) : (
            <div style={{maxHeight:260,overflowY:"auto"}}>
              {activePendientes.slice(0,10).map(item => (
                <div key={`${activeReadinessDef.key}-${item.id}`} style={{display:"grid",gridTemplateColumns:"minmax(160px,1.2fr) 72px minmax(220px,2fr)",gap:10,alignItems:"center",padding:"10px 12px",borderBottom:"1px solid var(--border2)"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>{item.nombre || "Sin nombre"}</div>
                    {item.contacto && <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>{item.contacto}</div>}
                  </div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:900,color:scoreColor(item.score || 0)}}>{item.score || 0}%</div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {(item.missing || []).slice(0,6).map(m => (
                      <span key={`${item.id}-${m.key}`} style={{fontSize:10,fontWeight:800,color:m.required?"var(--red)":"var(--accent)",background:m.required?"rgba(239,68,68,.08)":"rgba(0,145,125,.08)",border:`1px solid ${m.required?"rgba(239,68,68,.22)":"rgba(0,145,125,.22)"}`,borderRadius:999,padding:"2px 7px"}}>
                        {m.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Selector de tipo */}
      <div style={{...S.card}}>
        <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text4)",marginBottom:12}}>¿Qué quieres importar?</div>
        <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
          <div style={{fontSize:12,color:"var(--text5)"}}>Orden sugerido: clientes, situacion, vehiculos/choferes, colaboradores, tarifas, viajes pendientes y facturas pendientes.</div>
          <button onClick={downloadCoreTemplates} style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)"}}>Descargar pack de plantillas</button>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {Object.entries(TEMPLATES).map(([k,t])=>(
            <button key={k} onClick={()=>{setTipoSel(k);setStep("upload");setPreview(null);setErrores([]);}}
              style={{...S.btn,background:tipoSel===k?"var(--accent)":"var(--bg4)",color:tipoSel===k?"#fff":"var(--text3)",border:`1px solid ${tipoSel===k?"transparent":"var(--border2)"}`}}>
              {t.icon} {t.nombre}
            </button>
          ))}
        </div>
      </div>

      {/* Plantilla descargable */}
      <div style={{...S.card,background:"rgba(59,130,246,.05)",border:"1px solid rgba(59,130,246,.2)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>1. Descarga la plantilla CSV para {tpl.nombre}</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>
              Rellénala con tus datos. Puedes reordenar columnas — el sistema las detecta automáticamente.
              Las columnas marcadas con * son obligatorias.
            </div>
          </div>
          <button onClick={()=>downloadTemplate(tipoSel)} style={{...S.btn,background:"var(--accent)",color:"#fff",fontSize:13,fontWeight:700}}>
            Descargar plantilla
          </button>
        </div>
        {/* Columnas */}
        <div style={{marginTop:12,display:"flex",gap:6,flexWrap:"wrap"}}>
          {tpl.columns.map(c=>(
            <span key={c.k} style={{padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:600,
              background:c.req?"rgba(59,130,246,.15)":"var(--bg3)",
              color:c.req?"var(--accent)":"var(--text4)",
              border:`1px solid ${c.req?"rgba(59,130,246,.3)":"var(--border)"}`}}>
              {c.req?"*":""}{c.l}
            </span>
          ))}
        </div>
      </div>

      {/* Upload */}
      {step==="upload"&&(
        <div style={S.card}>
          <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:10}}>2. Sube tu archivo CSV o Excel exportado como CSV</div>
          <div style={{border:"2px dashed var(--border2)",borderRadius:10,padding:"30px",textAlign:"center",background:"var(--bg3)"}}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:8,color:"var(--accent)"}}>Archivo</div>
            <div style={{fontWeight:600,color:"var(--text)",fontSize:13,marginBottom:4}}>Arrastra o haz clic para seleccionar</div>
            <div style={{fontSize:11,color:"var(--text5)",marginBottom:12}}>CSV, TSV — exportado desde Excel, Google Sheets, cualquier ERP</div>
            <label style={{...S.btn,background:"var(--accent)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              Seleccionar archivo
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFile} style={{display:"none"}}/>
            </label>
          </div>
        </div>
      )}

      {/* Preview */}
      {step==="preview"&&preview&&(
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>3. Previsualización — {preview.parsed.length} filas detectadas</div>
              <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                Columnas mapeadas: {Object.keys(preview.mapping).length} de {tpl.columns.length}.
                {Object.keys(preview.mapping).length<tpl.columns.filter(c=>c.req).length&&(
                  <span style={{color:"var(--red)",marginLeft:4}}>Faltan columnas obligatorias</span>
                )}
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setStep("upload");setPreview(null);}} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text3)"}}>
                ← Volver
              </button>
              <button onClick={importar} disabled={filasInvalidas.length>0 || preview.parsed.length===0} style={{...S.btn,background:"var(--green)",color:"#fff",fontSize:13,fontWeight:700,opacity:(filasInvalidas.length>0||preview.parsed.length===0) ? .5 : 1}}>
                Importar {preview.parsed.length} registros
              </button>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
            <div style={{background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.22)",borderRadius:8,padding:10}}>
              <div style={{fontSize:18,fontWeight:900,color:"#10b981"}}>{filasValidas}</div>
              <div style={{fontSize:11,color:"var(--text4)"}}>filas listas</div>
            </div>
            <div style={{background:filasInvalidas.length?"rgba(239,68,68,.08)":"var(--bg3)",border:`1px solid ${filasInvalidas.length?"rgba(239,68,68,.22)":"var(--border)"}`,borderRadius:8,padding:10}}>
              <div style={{fontSize:18,fontWeight:900,color:filasInvalidas.length?"var(--red)":"var(--text4)"}}>{filasInvalidas.length}</div>
              <div style={{fontSize:11,color:"var(--text4)"}}>filas con errores</div>
            </div>
            <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:10}}>
              <div style={{fontSize:18,fontWeight:900,color:"var(--accent)"}}>{Object.keys(preview.mapping).length}</div>
              <div style={{fontSize:11,color:"var(--text4)"}}>columnas detectadas</div>
            </div>
          </div>
          {filasInvalidas.length>0 && (
            <div style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,padding:"10px 12px",fontSize:12,color:"var(--red)",marginBottom:12}}>
              Corrige las filas marcadas antes de importar. La importacion queda bloqueada para evitar datos incompletos.
            </div>
          )}

          {/* Mapeo de columnas */}
          <div style={{background:"var(--bg3)",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12}}>
            <div style={{fontWeight:700,color:"var(--text4)",marginBottom:6,fontSize:11,textTransform:"uppercase",letterSpacing:".06em"}}>Mapeo de columnas detectado</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {tpl.columns.map(c=>{
                const mapped = preview.mapping[c.k]!==undefined;
                return(
                  <span key={c.k} style={{padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:600,
                    background:mapped?"rgba(16,185,129,.12)":"rgba(239,68,68,.1)",
                    color:mapped?"#10b981":"var(--red)",
                    border:`1px solid ${mapped?"rgba(16,185,129,.3)":"rgba(239,68,68,.3)"}`}}>
                    {mapped?"Asignada":"Pendiente"} {c.l}
                    {mapped&&<span style={{opacity:.6}}> ← {preview.headers[preview.mapping[c.k]]}</span>}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Tabla preview */}
          <div style={{overflowX:"auto",maxHeight:320,overflowY:"auto",border:"1px solid var(--border)",borderRadius:8}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
              <thead style={{position:"sticky",top:0,zIndex:2}}>
                <tr>
                  {tpl.columns.filter(c=>preview.mapping[c.k]!==undefined).map(c=>(
                    <th key={c.k} style={S.th}>{c.l}</th>
                  ))}
                  <th style={S.th}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {preview.parsed.slice(0,20).map((row,i)=>{
                  const missing=validar(row);
                  return(
                    <tr key={i} style={{background:missing.length?"rgba(239,68,68,.04)":"transparent"}}>
                      {tpl.columns.filter(c=>preview.mapping[c.k]!==undefined).map(c=>(
                        <td key={c.k} style={{...S.td,color:!row[c.k]&&c.req?"var(--red)":"var(--text2)"}}>{row[c.k]||"—"}</td>
                      ))}
                      <td style={S.td}>
                        {missing.length?(<span style={{color:"var(--red)",fontSize:11}}>Falta: {missing.join(", ")}</span>)
                          :(<span style={{color:"#10b981",fontSize:11}}>OK</span>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.parsed.length>20&&<div style={{fontSize:11,color:"var(--text5)",textAlign:"center",marginTop:6}}>Mostrando primeras 20 de {preview.parsed.length} filas</div>}
        </div>
      )}

      {/* Progreso */}
      {(step==="importing"||step==="done")&&(
        <div style={S.card}>
          <div style={{fontWeight:700,fontSize:14,color:"var(--text)",marginBottom:12}}>
            {step==="importing"?"Importando...":"Importación completada"}
          </div>
          <div style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
              <span style={{color:"var(--text4)"}}>Progreso</span>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--text)"}}>{progreso.done} / {progreso.total}</span>
            </div>
            <div style={{height:8,background:"var(--bg4)",borderRadius:4}}>
              <div style={{height:"100%",width:(progreso.total>0?(progreso.done/progreso.total)*100:0)+"%",background:"var(--green)",borderRadius:4,transition:"width .2s"}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:16,fontSize:13}}>
            <span style={{color:"#10b981"}}>{progreso.done} importados correctamente</span>
            {progreso.errores>0&&<span style={{color:"var(--red)"}}>{progreso.errores} con errores</span>}
          </div>
          {errores.length>0&&(
            <div style={{marginTop:12,maxHeight:200,overflowY:"auto"}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--red)",marginBottom:6,textTransform:"uppercase"}}>Filas con error:</div>
              {errores.map((e,i)=>(
                <div key={i} style={{fontSize:11,color:"var(--red)",padding:"4px 0",borderBottom:"1px solid rgba(239,68,68,.1)"}}>
                  Fila {i+1}: {e.error}
                </div>
              ))}
            </div>
          )}
          {step==="done"&&(
            <button onClick={()=>{setStep("upload");setPreview(null);setErrores([]);setProgreso({done:0,total:0,errores:0});}}
              style={{...S.btn,background:"var(--accent)",color:"#fff",marginTop:12,fontSize:13,fontWeight:700}}>
              ← Nueva importación
            </button>
          )}
        </div>
      )}
    </div>
  );
}
