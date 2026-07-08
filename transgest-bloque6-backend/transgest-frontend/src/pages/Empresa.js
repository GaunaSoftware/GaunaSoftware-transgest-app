import { useState, useEffect, useCallback } from "react";
import { getEmpresa, saveEmpresa, getEmpresaBackend, saveEmpresaBackend, getEmailConfig, saveEmailConfig, getEmailConfigBackend, saveEmailConfigBackend, getEmailLogBackend, getEmpresaConfig, setConfigTrafico, setConfigPrecios, setConfigAlertas, getLogo, subirLogo, eliminarLogo, getEmpresaFiscalConfig, saveEmpresaFiscalConfig, testEmpresaFiscalConfig, getEmpresaFiscalQueueSummary, getEmpresaIntegracionesStatus, getPuestaMarchaComercial, descargarPuestaMarchaInforme, getJornadaDiariaOperativa, descargarJornadaDiariaInforme, solicitarBackupEmpresa, getControlCobrosConfig, guardarControlCobrosConfig, actualizarCapitalTesoreria, getCalendarioLaboral, getCalendarioLaboralCcaa, getToken, getWhatsappConfig, guardarWhatsappConfig, getWhatsappLog } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify, promptDialog } from "../services/notify";
import { getEmpresaPlanLocal, normalizePlan } from "../utils/planFeatures";
import { COMPANY_PALETTES, canUseCompanyPalette, normalizePaletteConfig, saveCompanyPalette } from "../utils/companyPalette";
import { EUROPE_COUNTRIES, canonicalCountry, getEnabledEuropeCountries } from "../utils/europeGeo";
import { GeoFields } from "../components/GeoFields";

const S = {
  page:   { padding:"22px 26px", fontFamily:"'DM Sans',sans-serif", width:"100%", maxWidth:"none", boxSizing:"border-box" },
  title:  { fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:"var(--text)", marginBottom:4 },
  sub:    { fontSize:12, color:"var(--text4)", marginBottom:24 },
  section:{ background:"var(--card-bg)", border:"1px solid var(--border)", borderRadius:12, padding:"20px 22px", marginBottom:16, boxShadow:"var(--shadow-card)" },
  secTitle:{ fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:700, color:"var(--text)", marginBottom:16, display:"flex", alignItems:"center", gap:8 },
  grid2:  { display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 14px" },
  grid3:  { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"6px 14px" },
  lbl:    { display:"block", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text5)", marginBottom:4, marginTop:10 },
  inp:    { background:"var(--input-bg)", border:"1px solid var(--border2)", color:"var(--text)", padding:"8px 12px", borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" },
  btn:    { padding:"8px 18px", borderRadius:7, border:"none", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", display:"inline-flex", alignItems:"center", gap:6 },
  info:   { background:"rgba(59,130,246,.07)", border:"1px solid rgba(59,130,246,.15)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#5a7ab8", marginBottom:14 },
  saved:  { background:"rgba(16,185,129,.1)", border:"1px solid rgba(16,185,129,.25)", borderRadius:7, padding:"6px 14px", fontSize:12, color:"var(--green)", display:"inline-flex", alignItems:"center", gap:6 },
};

const REGIMENES = [
  "Régimen general",
  "Régimen simplificado",
  "Régimen especial del recargo de equivalencia",
  "Régimen especial de la agricultura, ganadería y pesca",
  "Operaciones exentas de IVA (art. 20 LIVA)",
];

const CCAA_FALLBACK = [
  { code:"ES-AN", label:"Andalucia" },
  { code:"ES-AR", label:"Aragon" },
  { code:"ES-AS", label:"Asturias" },
  { code:"ES-CN", label:"Canarias" },
  { code:"ES-CB", label:"Cantabria" },
  { code:"ES-CM", label:"Castilla-La Mancha" },
  { code:"ES-CL", label:"Castilla y Leon" },
  { code:"ES-CT", label:"Cataluna" },
  { code:"ES-EX", label:"Extremadura" },
  { code:"ES-GA", label:"Galicia" },
  { code:"ES-IB", label:"Illes Balears" },
  { code:"ES-RI", label:"La Rioja" },
  { code:"ES-MD", label:"Comunidad de Madrid" },
  { code:"ES-MC", label:"Region de Murcia" },
  { code:"ES-NC", label:"Navarra" },
  { code:"ES-PV", label:"Pais Vasco" },
  { code:"ES-VC", label:"Comunitat Valenciana" },
  { code:"ES-CE", label:"Ceuta" },
  { code:"ES-ML", label:"Melilla" },
];

function readLegacyAvisosEmpresa() {
  try {
    const parsed = JSON.parse(localStorage.getItem("tms_avisos_empresa") || "[]");
    if (Array.isArray(parsed) && parsed.length) {
      localStorage.removeItem("tms_avisos_empresa");
      return parsed;
    }
  } catch {}
  return [];
}

function getFiscalTestFreshness(test) {
  const testedAt = test?.tested_at ? new Date(test.tested_at) : null;
  if (!testedAt || Number.isNaN(testedAt.getTime())) return { label: "Sin probar", color: "#f59e0b" };
  const diffDays = Math.floor((Date.now() - testedAt.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return { label: "Reciente", color: "var(--green)" };
  if (diffDays <= 30) return { label: "Conviene revisar", color: "#f59e0b" };
  return { label: "Caducada", color: "#ef4444" };
}

const fmt2 = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits:2, maximumFractionDigits:2 });

function parseMoney(value) {
  if (value === "" || value === null || value === undefined) return 0;
  let raw = String(value).trim().replace(/\s+/g, "");
  if (!raw) return 0;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  if (hasComma && hasDot) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (hasComma) raw = raw.replace(",", ".");
  else if (hasDot && /^\d{1,3}(\.\d{3})+(\.\d+)?$/.test(raw)) raw = raw.replace(/\./g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export default function Empresa() {
  const { user } = useAuth();
  const [logo, setLogo]             = useState(null);  // base64
  const [logoMime, setLogoMime]     = useState("image/png");
  const [logoUploading, setLogoUploading] = useState(false);
  const esGerente = user?.rol === "gerente";
  const empresaPlan = normalizePlan(user?.plan || getEmpresaPlanLocal());
  const puedePersonalizarColores = canUseCompanyPalette(empresaPlan);

  const [empresa, setEmpresa]         = useState(() => ({
    razon_social:"", cif:"", domicilio:"", cp:"", municipio:"",
    provincia:"", pais:"España", telefono:"", email:"", web:"",
    iban:"", bic:"", banco:"", regimen_iva:"Régimen general",
    forma_pago_colaboradores:"dias_fijos", dias_pago_colaboradores:"15", plazo_pago_colaboradores:60,
    forma_pago_clientes:"recepcion_factura", dias_pago_clientes:"", plazo_pago_clientes:60,
    texto_pago_clientes:"Transferencia 60 dias fecha recepcion factura",
    tipo_iva_defecto:"21", serie_facturas:"A", serie_rectificativas:"R",
    texto_pie:"", logo_url:"",
    documento_control:{ habilitado:false, sistema:"codigo_numerico", dominio_url:"", dominio_comunicado:false, usar_orden_carga_como_soporte:true, observaciones:"" },
    ...getEmpresa(),
  }));

  const [emailCfg, setEmailCfg]       = useState(() => ({
    smtp_host:"", smtp_port:"587", smtp_user:"", smtp_pass:"",
    smtp_from:"", smtp_from_nombre:"TransGest TMS",
    envio_facturas_auto: false,
    envio_avisos_carga_auto: false,
    ai_inbox_enabled: false,
    ai_inbox_email: "",
    asunto_factura:"Factura {numero} - {empresa}",
    cuerpo_factura:"Estimado/a {cliente},\n\nAdjunto encontrará la factura número {numero} con fecha {fecha} por importe de {total} €.\n\nQuedamos a su disposición para cualquier consulta.\n\nAtentamente,\n{empresa}",
    asunto_carga:"Nuevo pedido asignado - {numero}",
    cuerpo_carga:"Estimado/a {cliente},\n\nLe confirmamos la recogida de su mercancía:\n\nPedido: {numero}\nOrigen: {origen}\nDestino: {destino}\nFecha carga: {fecha_carga}\n\nAtentamente,\n{empresa}",
    ...getEmailConfig(),
  }));
  const [cobrosCfg, setCobrosCfg]     = useState({
    dias_revision_post_vencimiento: 1,
    dias_entre_reclamaciones: 7,
    max_envios_reclamacion: 6,
    dias_hasta_juridico: 45,
    envio_email_auto: true,
  });

  const [tab,     setTab]             = useState("empresa");
  const [saved,   setSaved]           = useState("");
  const [testEmail, setTestEmail]     = useState("");
  const [testing, setTesting]         = useState(false);
  const [emailLog, setEmailLog]       = useState([]);
  const [whatsappCfg, setWhatsappCfg] = useState({
    phone_number_id:"",
    waba_id:"",
    access_token:"",
    app_secret:"",
    verify_token:"",
    activo:true,
    simular_sin_credenciales:true,
    templates:{
      pedido_cliente:"pedido_confirmacion_cliente",
      orden_colaborador:"orden_carga_colaborador",
      docs_pendientes:"documentacion_pendiente",
      entrega_recordatorio:"recordatorio_entrega_albaran",
    },
  });
  const [whatsappLog, setWhatsappLog] = useState([]);
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [avisosCfg, setAvisosCfg]     = useState([]);
  const [modalAviso, setModalAviso]   = useState(false);
  const [editAviso,  setEditAviso]    = useState(null);
  const TIPOS_AVISO = ["Factura vencida sin cobrar","Stock bajo","ITV","Seguro","CAP","Carnet","Médico","Mantenimiento","Otro"];
  const [empresaCfg, setEmpresaCfg]   = useState({});
  const [capitalActual, setCapitalActual] = useState(0);
  const [capitalDraft, setCapitalDraft] = useState("0");
  const [capitalMotivo, setCapitalMotivo] = useState("");
  const [capitalOrigen, setCapitalOrigen] = useState("");
  const [capitalSoporte, setCapitalSoporte] = useState("");
  const [savingCapital, setSavingCapital] = useState(false);
  const [savingSostenibilidad, setSavingSostenibilidad] = useState(false);
  const [sostenibilidadCfg, setSostenibilidadCfg] = useState({
    consumo_l_100km: 32,
    factor_kg_co2_litro: 2.68,
    metodologia: "Estimacion preparatoria ISO 14083/GLEC basada en km operativos y factor diesel.",
  });
  const [cfgTrafico, setCfgTrafico]   = useState({});
  const [fiscalCfg, setFiscalCfg]     = useState({
    modo:"ninguno",
    entorno:"pruebas",
    nif_declarante:"",
    razon_social_declarante:"",
    email_alertas:"",
    notas:"",
    ultima_prueba:null,
    historial_pruebas:[],
    verifactu:{
      habilitado:false,
      envio_automatico:true,
      proveedor:"directo",
      endpoint_url:"",
      certificado_alias:"",
      provider_base_url:"",
      provider_api_key:"",
      provider_webhook_secret:"",
      software_nombre:"TransGest",
      software_id:"transgest-tms",
      software_version:"1.0.0",
    },
    sii:{
      habilitado:false,
      envio_automatico:true,
      endpoint_url:"",
      certificado_alias:"",
      incluir_emitidas:true,
      incluir_recibidas:false,
    },
  });
  const [fiscalStatus, setFiscalStatus] = useState(null);
  const [fiscalMeta, setFiscalMeta] = useState(null);
  const [fiscalTesting, setFiscalTesting] = useState(false);
  const [fiscalTestResult, setFiscalTestResult] = useState(null);
  const [fiscalQueueSummary, setFiscalQueueSummary] = useState(null);
  const [integracionesStatus, setIntegracionesStatus] = useState(null);
  const [puestaMarcha, setPuestaMarcha] = useState(null);
  const [jornadaDiaria, setJornadaDiaria] = useState(null);
  const [backupSolicitando, setBackupSolicitando] = useState(false);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calCcaa, setCalCcaa] = useState("ES-AN");
  const [calCcaaOptions, setCalCcaaOptions] = useState(CCAA_FALLBACK);
  const [calendarioLaboral, setCalendarioLaboral] = useState(null);
  const [calLoading, setCalLoading] = useState(false);
  const fiscalTestFreshness = getFiscalTestFreshness(fiscalTestResult);
  useEffect(()=>{
    getLogo().then(d=>{
      if(d?.logo_base64){
        setLogo(d.logo_base64);
        setLogoMime(d.logo_mime||"image/png");
        if (typeof window !== "undefined") window.__TMS_LOGO_CACHE = { b64:d.logo_base64, mime:d.logo_mime||"image/png" };
        try {
          localStorage.removeItem("tms_logo_b64");
          localStorage.removeItem("tms_logo_mime");
        } catch {}
      }
    }).catch(()=>{});
    getEmpresaBackend().then(async perfil => {
      if (perfil && Object.keys(perfil).length) {
        setEmpresa(prev => ({ ...prev, ...perfil }));
        saveEmpresa({ ...getEmpresa(), ...perfil });
        if (perfil.paleta_colores) saveCompanyPalette(perfil.paleta_colores);
        try { localStorage.removeItem("tms_empresa"); } catch {}
        return;
      }
      const legacyEmpresa = getEmpresa();
      if (legacyEmpresa && Object.keys(legacyEmpresa).length) {
        try { await saveEmpresaBackend(legacyEmpresa); } catch {}
      }
    }).catch(()=>{});
    getEmailConfigBackend().then(d=>{
      if (d && Object.keys(d).length) {
        setEmailCfg(prev => {
          const next = { ...prev, ...d, smtp_pass:"" };
          saveEmailConfig(next);
          return next;
        });
        try { localStorage.removeItem("tms_email_cfg"); } catch {}
      }
    }).catch(()=>{});
    getEmailLogBackend().then(rows=>setEmailLog(Array.isArray(rows) ? rows : [])).catch(()=>setEmailLog([]));
    getWhatsappConfig().then(d=>{
      if (d && typeof d === "object") {
        setWhatsappCfg(prev => ({
          ...prev,
          ...d,
          access_token:"",
          app_secret:"",
          verify_token:"",
          templates:{ ...(prev.templates || {}), ...(d.templates || {}) },
        }));
      }
    }).catch(()=>{});
    getWhatsappLog().then(rows=>setWhatsappLog(Array.isArray(rows) ? rows : [])).catch(()=>setWhatsappLog([]));
    getControlCobrosConfig().then(d=>{
      if (d && typeof d === "object") setCobrosCfg(prev => ({ ...prev, ...d }));
    }).catch(()=>{});
    getEmpresaFiscalConfig().then(res=>{
      const cfg = res?.config || res;
      if (cfg && typeof cfg === "object") setFiscalCfg(prev => ({ ...prev, ...cfg }));
      if (res?.status) setFiscalStatus(res.status);
      if (res?.meta) setFiscalMeta(res.meta);
      if (cfg?.ultima_prueba) setFiscalTestResult(cfg.ultima_prueba);
    }).catch(()=>{});
    getEmpresaFiscalQueueSummary().then(setFiscalQueueSummary).catch(()=>{});
    getEmpresaIntegracionesStatus().then(setIntegracionesStatus).catch(()=>{});
    getEmpresaConfig()
      .then(async d=>{
        const safeCfg = d && typeof d === "object" ? d : {};
        setEmpresaCfg(safeCfg);
        const capital = Number(safeCfg?.cfg_precios?.tesoreria?.capital_actual || 0);
        setCapitalActual(capital);
        setCapitalDraft(String(capital));
        if (safeCfg?.cfg_precios?.sostenibilidad && typeof safeCfg.cfg_precios.sostenibilidad === "object") {
          setSostenibilidadCfg(prev => ({ ...prev, ...safeCfg.cfg_precios.sostenibilidad }));
        }
        if(d?.cfg_trafico && Object.keys(d.cfg_trafico).length) setCfgTrafico(d.cfg_trafico);
        if (d?.cfg_alertas && Array.isArray(d.cfg_alertas) && d.cfg_alertas.length) {
          setAvisosCfg(d.cfg_alertas);
          return;
        }
        const legacy = readLegacyAvisosEmpresa();
        if (legacy.length) {
          try {
            await setConfigAlertas(legacy);
            setAvisosCfg(legacy);
          } catch {
            setAvisosCfg(legacy);
          }
        } else {
          setAvisosCfg([]);
        }
      })
      .catch(()=>{}); // silently fail if backend not yet updated
  },[]);

  useEffect(() => {
    getCalendarioLaboralCcaa()
      .then(rows => setCalCcaaOptions(Array.isArray(rows) && rows.length ? rows : CCAA_FALLBACK))
      .catch(() => setCalCcaaOptions(CCAA_FALLBACK));
  }, []);

  const cargarCalendarioLaboral = useCallback(async (force = false) => {
    setCalLoading(true);
    try {
      const params = { year: calYear, ccaa: calCcaa };
      if (force) params.force = "1";
      const res = await getCalendarioLaboral(params);
      setCalendarioLaboral(res && typeof res === "object" ? res : null);
    } catch(e) {
      notify(e.message || "No se pudo cargar el calendario laboral.", "error");
    } finally {
      setCalLoading(false);
    }
  }, [calYear, calCcaa]);

  useEffect(() => {
    if (tab !== "calendario") return;
    cargarCalendarioLaboral(false);
  }, [tab, cargarCalendarioLaboral]);

  async function guardarTrafico() {
    try {
      const next = {...cfgTrafico,paises_trabajo:getEnabledEuropeCountries({cfg_trafico:cfgTrafico})};
      await setConfigTrafico(next);
      setCfgTrafico(next);
      if (typeof window !== "undefined") window.__TMS_EMPRESA_CONFIG = {...(window.__TMS_EMPRESA_CONFIG || {}), cfg_trafico:next};
      setSaved("trafico");
      setTimeout(()=>setSaved(""),3000);
    }
    catch(e) { notify("Error al guardar: "+e.message, "error"); }
  }

  const fe = k => e => setEmpresa(p => ({ ...p, [k]: e.target.value }));
  const fdc = k => e => setEmpresa(p => ({ ...p, documento_control:{ ...(p.documento_control||{}), [k]: e.target.type==="checkbox" ? e.target.checked : e.target.value } }));
  const fc = k => e => setEmailCfg(p => ({ ...p, [k]: e.target.type==="checkbox" ? e.target.checked : e.target.value }));
  const fw = k => e => setWhatsappCfg(p => ({ ...p, [k]: e.target.type==="checkbox" ? e.target.checked : e.target.value }));
  const fwt = k => e => setWhatsappCfg(p => ({ ...p, templates:{ ...(p.templates || {}), [k]:e.target.value } }));
  const fcobro = k => e => setCobrosCfg(p => ({ ...p, [k]: e.target.type==="checkbox" ? e.target.checked : e.target.value }));
  const ff = k => e => setFiscalCfg(p => ({ ...p, [k]: e.target.type==="checkbox" ? e.target.checked : e.target.value }));
  const ffv = k => e => setFiscalCfg(p => ({ ...p, verifactu:{ ...p.verifactu, [k]: e.target.type==="checkbox" ? e.target.checked : e.target.value } }));
  const ffs = k => e => setFiscalCfg(p => ({ ...p, sii:{ ...p.sii, [k]: e.target.type==="checkbox" ? e.target.checked : e.target.value } }));

  async function guardarEmpresa() {
    const empresaToSave = {
      ...empresa,
      paleta_colores: puedePersonalizarColores ? normalizePaletteConfig(empresa.paleta_colores) : normalizePaletteConfig(),
    };
    saveEmpresa(empresaToSave);
    saveCompanyPalette(empresaToSave.paleta_colores);
    try {
      const res = await saveEmpresaBackend(empresaToSave);
      if (res?.perfil) {
        setEmpresa(prev => ({ ...prev, ...res.perfil }));
        saveEmpresa({ ...getEmpresa(), ...res.perfil });
        if (res.perfil.paleta_colores) saveCompanyPalette(res.perfil.paleta_colores);
      }
      getEmpresaIntegracionesStatus().then(setIntegracionesStatus).catch(()=>{});
      setSaved("empresa");
      setTimeout(() => setSaved(""), 3000);
    } catch(e) {
      notify("No se pudo guardar la empresa en servidor: " + e.message, "error");
    }
  }

  async function guardarFiscal() {
    try {
      const payload = {
        ...fiscalCfg,
        verifactu: {
          ...fiscalCfg.verifactu,
          habilitado: fiscalCfg.modo === "verifactu",
        },
        sii: {
          ...fiscalCfg.sii,
          habilitado: fiscalCfg.modo === "sii",
        },
      };
      const res = await saveEmpresaFiscalConfig(payload);
      if (res?.config) setFiscalCfg(prev => ({ ...prev, ...res.config }));
      if (res?.status) setFiscalStatus(res.status);
      if (res?.meta) setFiscalMeta(res.meta);
      if (res?.config?.ultima_prueba) setFiscalTestResult(res.config.ultima_prueba);
      getEmpresaFiscalQueueSummary().then(setFiscalQueueSummary).catch(()=>{});
      getEmpresaIntegracionesStatus().then(setIntegracionesStatus).catch(()=>{});
      setSaved("fiscal");
      setTimeout(()=>setSaved(""), 3000);
    } catch(e) {
      notify("Error al guardar la configuracion fiscal: " + e.message, "error");
    }
  }

  async function probarFiscal() {
    setFiscalTesting(true);
    try {
      const res = await testEmpresaFiscalConfig();
      if (res?.config) setFiscalCfg(prev => ({ ...prev, ...res.config }));
      if (res?.status) setFiscalStatus(res.status);
      if (res?.meta) setFiscalMeta(res.meta);
      setFiscalTestResult(res?.test || null);
      getEmpresaFiscalQueueSummary().then(setFiscalQueueSummary).catch(()=>{});
      notify(res?.test?.message || "Prueba fiscal completada.", res?.test?.ok ? "success" : "warning");
    } catch(e) {
      setFiscalTestResult({ ok:false, message:e.message || "No se pudo probar la conexion fiscal." });
      notify(e.message || "No se pudo probar la conexion fiscal.", "error");
    } finally {
      setFiscalTesting(false);
    }
  }

  async function guardarEmail() {
    saveEmailConfig(emailCfg);
    try {
      const res = await saveEmailConfigBackend(emailCfg);
      if (res?.config) setEmailCfg(p => ({ ...p, ...res.config, smtp_pass:"" }));
      setSaved("email");
      setTimeout(() => setSaved(""), 3000);
    } catch(e) {
      notify("No se pudo guardar el SMTP en servidor: " + e.message, "error");
    }
  }

  async function guardarWhatsapp() {
    setSavingWhatsapp(true);
    try {
      const res = await guardarWhatsappConfig(whatsappCfg);
      if (res?.config) {
        setWhatsappCfg(prev => ({
          ...prev,
          ...res.config,
          access_token:"",
          app_secret:"",
          verify_token:"",
          templates:{ ...(prev.templates || {}), ...(res.config.templates || {}) },
        }));
      }
      getEmpresaIntegracionesStatus().then(setIntegracionesStatus).catch(()=>{});
      getWhatsappLog().then(rows=>setWhatsappLog(Array.isArray(rows) ? rows : [])).catch(()=>{});
      setSaved("whatsapp");
      setTimeout(() => setSaved(""), 3000);
    } catch(e) {
      notify("No se pudo guardar WhatsApp: " + e.message, "error");
    } finally {
      setSavingWhatsapp(false);
    }
  }

  async function guardarCobros() {
    if (!esGerente) return;
    try {
      const savedCfg = await guardarControlCobrosConfig(cobrosCfg);
      if (savedCfg && typeof savedCfg === "object") setCobrosCfg(prev => ({ ...prev, ...savedCfg }));
      setSaved("cobros");
      notify("Politica de cobros actualizada", "success");
      setTimeout(() => setSaved(""), 3000);
    } catch(e) {
      notify("Error al guardar la politica de cobros: " + e.message, "error");
    }
  }

  async function guardarCapitalTesoreria() {
    if (!esGerente) return;
    const capital = parseMoney(capitalDraft);
    if (!Number.isFinite(capital) || capital < 0) {
      notify("Indica un saldo operativo valido.", "warning");
      return;
    }
    if (capitalMotivo.trim().length < 12 || capitalOrigen.trim().length < 4 || capitalSoporte.trim().length < 4) {
      notify("Completa motivo, origen/naturaleza del saldo y soporte documental antes de solicitar el cambio.", "warning");
      return;
    }
    const okGerente1 = await confirmDialog({
      title: "Confirmacion del gerente",
      message: `Vas a cambiar el saldo operativo de tesoreria de ${fmt2(capitalActual)} EUR a ${fmt2(capital)} EUR.\n\nEste dato es interno para prevision de caja/bancos: no modifica el capital social legal ni sustituye la contabilidad oficial.`,
      confirmText: "Soy gerente y confirmo",
      tone: "warning",
    });
    if (!okGerente1) return;
    const frase = await promptDialog({
      title: "Segunda confirmacion del gerente",
      message: "Escribe CAMBIAR CAPITAL para continuar.",
      placeholder: "CAMBIAR CAPITAL",
      confirmText: "Validar frase",
      tone: "warning",
    });
    if (String(frase || "").trim().toUpperCase() !== "CAMBIAR CAPITAL") {
      notify("Cambio cancelado: la frase de confirmacion no coincide.", "warning");
      return;
    }
    const superadminEmail = await promptDialog({
      title: "Autorizacion de superadmin",
      message: "Introduce el email del superadmin que autoriza este cambio.",
      placeholder: "superadmin@transgest.local",
      inputType: "email",
      confirmText: "Continuar",
      tone: "warning",
    });
    if (!superadminEmail) return;
    const superadminPassword = await promptDialog({
      title: "Clave de superadmin",
      message: "Introduce la clave del superadmin. No se guardara en el navegador.",
      placeholder: "Clave de superadmin",
      inputType: "password",
      confirmText: "Autorizar cambio",
      tone: "danger",
    });
    if (!superadminPassword) return;
    const okFinal = await confirmDialog({
      title: "Confirmacion final",
      message: `Confirmar definitivamente el nuevo saldo operativo: ${fmt2(capital)} EUR.\n\nQuedara trazado con motivo, soporte documental, gerente y superadmin.`,
      confirmText: "Actualizar saldo",
      tone: "danger",
    });
    if (!okFinal) return;
    setSavingCapital(true);
    try {
      const res = await actualizarCapitalTesoreria({
        capital_actual: capital,
        gerente_confirmacion: "CAMBIAR CAPITAL",
        responsable_contable_confirmacion: "SALDO TESORERIA",
        motivo: capitalMotivo.trim(),
        origen_fondos: capitalOrigen.trim(),
        documento_soporte: capitalSoporte.trim(),
        superadmin_email: superadminEmail,
        superadmin_password: superadminPassword,
      });
      const tesoreria = res?.tesoreria || {};
      const nextCapital = Number(tesoreria.capital_actual || capital);
      setEmpresaCfg(prev => ({
        ...(prev || {}),
        cfg_precios: {
          ...((prev || {}).cfg_precios || {}),
          tesoreria,
        },
      }));
      setCapitalActual(nextCapital);
      setCapitalDraft(String(nextCapital));
      setCapitalMotivo("");
      setCapitalOrigen("");
      setCapitalSoporte("");
      notify("Saldo operativo de tesoreria actualizado.", "success");
    } catch(e) {
      notify(e.message || "No se pudo actualizar el saldo operativo.", "error");
    } finally {
      setSavingCapital(false);
    }
  }

  async function guardarSostenibilidad() {
    if (!esGerente) return;
    const consumo = parseMoney(sostenibilidadCfg.consumo_l_100km);
    const factor = parseMoney(sostenibilidadCfg.factor_kg_co2_litro);
    if (!Number.isFinite(consumo) || consumo <= 0 || consumo > 100) {
      notify("Indica un consumo medio valido en L/100 km.", "warning");
      return;
    }
    if (!Number.isFinite(factor) || factor <= 0 || factor > 10) {
      notify("Indica un factor de CO2 valido en kg por litro.", "warning");
      return;
    }
    setSavingSostenibilidad(true);
    try {
      const nextPrecios = {
        ...(empresaCfg?.cfg_precios || {}),
        sostenibilidad: {
          consumo_l_100km: consumo,
          factor_kg_co2_litro: factor,
          metodologia: String(sostenibilidadCfg.metodologia || "").trim() || "Estimacion preparatoria ISO 14083/GLEC basada en km operativos y factor diesel.",
          updated_at: new Date().toISOString(),
          updated_by: user?.email || user?.username || null,
        },
      };
      await setConfigPrecios(nextPrecios);
      setEmpresaCfg(prev => ({
        ...(prev || {}),
        cfg_precios: nextPrecios,
      }));
      setSostenibilidadCfg(nextPrecios.sostenibilidad);
      setSaved("sostenibilidad");
      notify("Configuracion de sostenibilidad actualizada.", "success");
      setTimeout(() => setSaved(""), 3000);
    } catch (e) {
      notify(e.message || "No se pudo guardar sostenibilidad.", "error");
    } finally {
      setSavingSostenibilidad(false);
    }
  }

  async function descargarInformePuestaMarcha() {
    try {
      const { blob, filename } = await descargarPuestaMarchaInforme();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      notify("Informe de puesta en marcha descargado.", "success");
    } catch(e) {
      notify(e.message || "No se pudo descargar el informe de puesta en marcha.", "error");
    }
  }

  async function descargarInformeJornadaDiaria() {
    try {
      const { blob, filename } = await descargarJornadaDiariaInforme();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      notify("Informe de jornada diaria descargado.", "success");
    } catch(e) {
      notify(e.message || "No se pudo descargar el informe de jornada diaria.", "error");
    }
  }

  async function solicitarBackupGoLive() {
    if (!esGerente || backupSolicitando) return;
    const ok = await confirmDialog({
      title: "Solicitar backup de salida",
      message: "Se registrara una solicitud para que TransGestAdmin prepare un backup inicial antes de la salida a produccion. La empresa no ejecuta ni descarga el backup directamente.",
      confirmText: "Solicitar backup",
      tone: "warning",
    });
    if (!ok) return;
    setBackupSolicitando(true);
    try {
      await solicitarBackupEmpresa({ motivo: "Backup inicial de salida a produccion solicitado desde Puesta en marcha" });
      const refreshed = await getPuestaMarchaComercial().catch(() => null);
      if (refreshed) setPuestaMarcha(refreshed);
      notify("Solicitud de backup registrada para TransGestAdmin.", "success");
    } catch(e) {
      notify(e.message || "No se pudo solicitar el backup.", "error");
    } finally {
      setBackupSolicitando(false);
    }
  }

  async function testSmtp() {
    if (!testEmail) { notify("Introduce un email de prueba", "warning"); return; }
    setTesting(true);
    // Llamada al backend para envío de prueba
    try {
        const res = await fetch("/api/v1/email/test", {
          method:"POST",
          headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${getToken()}` },
          body: JSON.stringify({ destinatario: testEmail }),
        });
      if (!res.ok) {
        const data = await res.json().catch(()=>({}));
        throw new Error(data.error || "No se pudo enviar el email de prueba");
      }
      notify("Email de prueba enviado a " + testEmail, "success");
      getEmailLogBackend().then(rows=>setEmailLog(Array.isArray(rows) ? rows : [])).catch(()=>{});
    } catch(e) {
      notify("Error: " + (e.message || "No se pudo conectar"), "error");
    } finally {
      setTesting(false);
    }
  }

  const TABS = [
    { id:"empresa", l:"Datos fiscales" },
    { id:"tesoreria", l:"Tesoreria" },
    { id:"sostenibilidad", l:"Sostenibilidad / CO2" },
    { id:"factura", l:"Configuración facturas" },
    { id:"email",   l:"Email / Notificaciones" },
    { id:"whatsapp", l:"WhatsApp" },
    { id:"avisos_cfg", l:"Avisos personalizados" },
    { id:"trafico_cfg", l:"Config. Tráfico" },
  ];

  const activePalette = normalizePaletteConfig(empresa.paleta_colores);

  function setEmpresaPalette(paletteId) {
    const preset = COMPANY_PALETTES.find(p => p.id === paletteId) || COMPANY_PALETTES[0];
    const next = normalizePaletteConfig({
      id: preset.id,
      accent: preset.accent,
      accentLight: preset.accentLight,
      sidebar: preset.sidebar,
    });
    setEmpresa(p => ({ ...p, paleta_colores: next }));
    saveCompanyPalette(next);
  }

  function setEmpresaPaletteColor(key, value) {
    const next = normalizePaletteConfig({
      ...activePalette,
      id: "custom",
      [key]: value,
      custom: { ...activePalette.custom, [key]: value },
    });
    setEmpresa(p => ({ ...p, paleta_colores: next }));
    saveCompanyPalette(next);
  }

  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div style={S.title}>Mi Empresa</div>
        {/* Logo preview en cabecera */}
        {logo && (
          <img src={`data:${logoMime};base64,${logo}`} alt="Logo empresa"
            style={{maxHeight:48,maxWidth:160,objectFit:"contain",borderRadius:6,border:"1px solid var(--border)"}}/>
        )}
      </div>
      <div style={S.sub}>Datos fiscales y configuración - alimentan todas las facturas y comunicaciones</div>

      {/* ── Logo de empresa ────────────────────────────────────────── */}
      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"16px 18px",marginBottom:16}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:12}}>Logo de la empresa</div>
        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          {/* Preview */}
          <div style={{width:120,height:80,border:"1px dashed var(--border2)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg3)",overflow:"hidden",flexShrink:0}}>
            {logo ?
              <img src={`data:${logoMime};base64,${logo}`} alt="Logo" style={{maxWidth:116,maxHeight:76,objectFit:"contain"}}/>
              : <span style={{fontSize:11,color:"var(--text5)",textAlign:"center",padding:8}}>Sin logo</span>
            }
          </div>
          {/* Controls */}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{fontSize:12,color:"var(--text3)"}}>
              Sube el logo en <strong>SVG, PNG o JPG</strong> (máx 500KB).<br/>
              Aparecerá en facturas, hojas de ruta y órdenes de carga.
            </div>
            <div style={{display:"flex",gap:8}}>
              <label style={{padding:"6px 14px",borderRadius:7,background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:700,cursor:logoUploading ? "not-allowed" : "pointer",fontFamily:"'DM Sans',sans-serif",opacity:logoUploading ? 0.6 : 1}}>
                {logoUploading ? "Subiendo...":"Subir logo"}
                <input type="file" accept=".svg,.png,.jpg,.jpeg,.webp" style={{display:"none"}}
                  disabled={logoUploading}
                  onChange={async(e)=>{
                    const file=e.target.files?.[0]; if(!file) return;
                    if(file.size>512000){notify("El archivo es demasiado grande (max 500KB)", "warning");return;}
                    setLogoUploading(true);
                    const reader=new FileReader();
                    reader.onload=async(ev)=>{
                      const b64=ev.target.result.split(",")[1];
                      const mime=file.type||"image/png";
      try{
        await subirLogo({logo_base64:b64,logo_mime:mime});
        setLogo(b64); setLogoMime(mime);
        if (typeof window !== "undefined") window.__TMS_LOGO_CACHE = { b64, mime };
        try {
          localStorage.removeItem("tms_logo_b64");
          localStorage.removeItem("tms_logo_mime");
        } catch {}
      }catch(err){notify("Error subiendo logo: "+err.message, "error");}
                      setLogoUploading(false);
                    };
                    reader.readAsDataURL(file);
                    e.target.value="";
                  }}
                />
              </label>
              {logo && (
                <button onClick={async()=>{
                  const ok = await confirmDialog({
                    title: "Eliminar logo",
                    message: "Eliminar el logo de la empresax",
                    confirmText: "Eliminar",
                    tone: "danger",
                  });
                  if(!ok) return;
                  await eliminarLogo();
                  setLogo(null);
                  if (typeof window !== "undefined") window.__TMS_LOGO_CACHE = { b64:null, mime:"image/png" };
                  try {
                    localStorage.removeItem("tms_logo_b64");
                    localStorage.removeItem("tms_logo_mime");
                  } catch {}
                }} style={{padding:"6px 12px",borderRadius:7,border:"1px solid rgba(239,68,68,.3)",background:"rgba(239,68,68,.08)",color:"#ef4444",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  Eliminar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div style={{background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:12,padding:"16px 18px",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:14,flexWrap:"wrap",marginBottom:12}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:13,color:"var(--text)",marginBottom:4}}>Personalizacion premium</div>
            <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.45}}>
              Cada empresa puede elegir una paleta visual propia. El logo del programa no se modifica.
            </div>
          </div>
          <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",border:`1px solid ${puedePersonalizarColores ? "rgba(16,185,129,.30)" : "rgba(245,158,11,.30)"}`,background:puedePersonalizarColores ? "rgba(16,185,129,.10)" : "rgba(245,158,11,.10)",color:puedePersonalizarColores ? "var(--green)" : "#f59e0b",borderRadius:999,padding:"5px 9px"}}>
            {puedePersonalizarColores ? `${empresaPlan} activo` : "Solo premium"}
          </span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"minmax(260px,1.2fr) minmax(260px,.8fr)",gap:14}}>
          <div style={{display:"grid",gap:10}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {COMPANY_PALETTES.filter(palette => palette.id !== "custom").map(palette => (
                <button
                  key={palette.id}
                  type="button"
                  disabled={!puedePersonalizarColores}
                  onClick={() => setEmpresaPalette(palette.id)}
                  style={{
                    border:`1px solid ${activePalette.id === palette.id ? "var(--accent-l)" : "var(--border2)"}`,
                    background:activePalette.id === palette.id ? "var(--accent-dim)" : "var(--bg3)",
                    color:activePalette.id === palette.id ? "var(--accent-xl)" : "var(--text3)",
                    borderRadius:9,
                    padding:"8px 10px",
                    fontSize:12,
                    fontWeight:900,
                    cursor:puedePersonalizarColores ? "pointer" : "not-allowed",
                    opacity:puedePersonalizarColores ? 1 : .58,
                    fontFamily:"'DM Sans',sans-serif",
                    display:"inline-flex",
                    alignItems:"center",
                    gap:7,
                  }}
                >
                  <span style={{width:18,height:18,borderRadius:999,background:`linear-gradient(135deg, ${palette.accent}, ${palette.accentLight})`,border:"1px solid rgba(255,255,255,.35)"}} />
                  {palette.label}
                </button>
              ))}
              <button
                type="button"
                disabled={!puedePersonalizarColores}
                onClick={() => setEmpresaPaletteColor("accent", activePalette.accent)}
                style={{
                  border:`1px solid ${activePalette.id === "custom" ? "var(--accent-l)" : "var(--border2)"}`,
                  background:activePalette.id === "custom" ? "var(--accent-dim)" : "var(--bg3)",
                  color:activePalette.id === "custom" ? "var(--accent-xl)" : "var(--text3)",
                  borderRadius:9,
                  padding:"8px 10px",
                  fontSize:12,
                  fontWeight:900,
                  cursor:puedePersonalizarColores ? "pointer" : "not-allowed",
                  opacity:puedePersonalizarColores ? 1 : .58,
                  fontFamily:"'DM Sans',sans-serif",
                  display:"inline-flex",
                  alignItems:"center",
                  gap:7,
                }}
              >
                <span style={{width:18,height:18,borderRadius:999,background:`linear-gradient(135deg, ${activePalette.accent}, ${activePalette.accentLight})`,border:"1px solid rgba(255,255,255,.35)"}} />
                Personalizada
              </button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10}}>
              {[
                ["accent", "Color principal"],
                ["accentLight", "Color activo"],
                ["sidebar", "Lateral"],
              ].map(([key, label]) => (
                <label key={key} style={{display:"grid",gap:5,fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>
                  {label}
                  <input
                    type="color"
                    disabled={!puedePersonalizarColores}
                    value={activePalette[key]}
                    onChange={e => setEmpresaPaletteColor(key, e.target.value)}
                    style={{width:"100%",height:38,border:"1px solid var(--border2)",borderRadius:8,background:"var(--bg3)",padding:4,cursor:puedePersonalizarColores ? "pointer" : "not-allowed",opacity:puedePersonalizarColores ? 1 : .55}}
                  />
                  <input
                    type="text"
                    disabled={!puedePersonalizarColores}
                    value={activePalette[key]}
                    onChange={e => setEmpresaPaletteColor(key, e.target.value)}
                    placeholder="#0f766e"
                    maxLength={7}
                    style={{...S.inp,height:34,fontSize:12,textTransform:"uppercase",opacity:puedePersonalizarColores ? 1 : .55}}
                  />
                </label>
              ))}
            </div>
          </div>
          <div style={{border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",background:"var(--bg3)"}}>
            <div style={{height:42,background:activePalette.sidebar,display:"flex",alignItems:"center",gap:8,padding:"0 12px",color:"#fff"}}>
              <span style={{width:24,height:24,borderRadius:7,background:activePalette.accentLight}} />
              <strong style={{fontSize:12}}>Vista previa</strong>
            </div>
            <div style={{padding:12,display:"grid",gap:8}}>
              <div style={{height:32,borderRadius:8,background:activePalette.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900}}>Boton principal</div>
              <div style={{height:32,borderRadius:8,border:`1px solid ${activePalette.accentLight}`,background:"var(--bg2)",color:activePalette.accentLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900}}>Estado activo</div>
            </div>
          </div>
        </div>
        {!puedePersonalizarColores && (
          <div style={{marginTop:10,fontSize:12,color:"#b45309",background:"rgba(245,158,11,.10)",border:"1px solid rgba(245,158,11,.25)",borderRadius:8,padding:"8px 10px"}}>
            Disponible para planes Profesional, Enterprise o Premium.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:0, borderBottom:"1px solid #141a28", marginBottom:20, overflowX:"auto", overflowY:"hidden", WebkitOverflowScrolling:"touch" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:"7px 16px", border:"none",
            borderBottom:`2px solid ${tab===t.id ? "var(--accent-l)":"transparent"}`,
            background:"none", fontFamily:"'DM Sans',sans-serif", fontSize:12,
            fontWeight:600, cursor:"pointer", color:tab===t.id ? "var(--accent-xl)" : "var(--text4)", whiteSpace:"nowrap", flex:"0 0 auto",
          }}>{t.l}</button>
        ))}
      </div>

      {/* ── Datos fiscales ── */}
      {tab==="puesta_marcha" && (
        <div>
          <div style={S.info}>
            Semaforo de salida comercial calculado con datos reales de la empresa. Sirve para revisar que la operativa basica puede venderse y ponerse en marcha sin sorpresas.
          </div>
          <div style={S.section}>
            <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap",marginBottom:14}}>
              <div>
                <div style={S.secTitle}>Jornada diaria operativa</div>
                <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.55}}>
                  {jornadaDiaria?.objetivo || "Control rapido para empezar el dia con trafico, cobros, pagos, documentacion y fiscalidad revisados."}
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button
                  onClick={descargarInformeJornadaDiaria}
                  style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)"}}
                >
                  Informe diario
                </button>
                <button
                  onClick={()=>getJornadaDiariaOperativa().then(setJornadaDiaria).catch(e=>notify(e.message || "No se pudo refrescar la jornada diaria.", "error"))}
                  style={{...S.btn,background:"var(--bg4)",color:"var(--text3)",border:"1px solid var(--border)"}}
                >
                  Refrescar
                </button>
              </div>
            </div>
            {jornadaDiaria ? (() => {
              const resumen = jornadaDiaria.resumen || {};
              const metricas = jornadaDiaria.metricas || {};
              const importes = jornadaDiaria.importes || {};
              const estado = resumen.estado || "atencion";
              const color = estado === "listo" ? "var(--green)" : estado === "bloqueado" ? "#ef4444" : "#f59e0b";
              const mainMetrics = [
                ["Score", `${resumen.score || 0}%`, color],
                ["Estado", estado === "listo" ? "Listo" : estado === "bloqueado" ? "Bloqueado" : "Atencion", color],
                ["Cargas hoy", metricas.cargas_hoy || 0, "var(--accent)"],
                ["Descargas hoy", metricas.descargas_hoy || 0, "var(--accent)"],
                ["Bloqueantes", resumen.bloqueantes || 0, Number(resumen.bloqueantes||0)>0?"#ef4444":"var(--green)"],
              ];
              return (
                <>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10,marginBottom:14}}>
                    {mainMetrics.map(([label,value,c])=>(
                      <div key={label} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:9,padding:"11px 12px"}}>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color:c}}>{value}</div>
                        <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",marginTop:3}}>{label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{padding:"11px 13px",borderRadius:9,border:`1px solid ${color}33`,background:`${color}10`,fontSize:12,color:"var(--text3)",lineHeight:1.55,marginBottom:14}}>
                    {resumen.listo_para_jornada
                      ? "No hay bloqueantes para empezar la jornada. Revisa los avisos y trabaja desde Trafico, Facturacion y Excepciones."
                      : "Hay bloqueantes de jornada. Conviene resolverlos antes de aceptar o mover mas viajes."}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:14}}>
                    {[
                      ["Viajes activos", metricas.viajes_activos || 0],
                      ["Vencidos", metricas.vencidos || 0],
                      ["Incidencias", metricas.incidencias || 0],
                      ["Sin asignacion", metricas.sin_asignacion || 0],
                      ["Sin precio", metricas.sin_precio || 0],
                      ["Margen negativo", metricas.margen_negativo || 0],
                      ["Sin soporte", metricas.entregados_sin_soporte || 0],
                      ["Cobros riesgo", metricas.cobros_riesgo || 0],
                      ["Pagos vencidos", metricas.pagos_colaborador_vencidos || 0],
                      ["Fiscal atascado", metricas.fiscal_atascado || 0],
                    ].map(([label,value])=>(
                      <div key={label} style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:14,fontWeight:900,color:Number(value)>0?"#f59e0b":"var(--green)",fontFamily:"'JetBrains Mono',monospace"}}>{value}</div>
                        <div style={{fontSize:9,color:"var(--text5)",fontWeight:800,textTransform:"uppercase"}}>{label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
                    <div style={{padding:"8px 10px",border:"1px solid var(--border)",borderRadius:8,background:"var(--bg4)",fontSize:12,color:"var(--text3)"}}>
                      Cobro en riesgo: <strong style={{color:"var(--text)"}}>{fmt2(importes.cobro_riesgo || 0)} EUR</strong>
                    </div>
                    <div style={{padding:"8px 10px",border:"1px solid var(--border)",borderRadius:8,background:"var(--bg4)",fontSize:12,color:"var(--text3)"}}>
                      Pago colaborador pendiente: <strong style={{color:"var(--text)"}}>{fmt2(importes.pago_colaborador_pendiente || 0)} EUR</strong>
                    </div>
                  </div>
                  {!!jornadaDiaria.acciones_prioritarias?.length && (
                    <div style={{display:"grid",gap:8}}>
                      {jornadaDiaria.acciones_prioritarias.map(a=>(
                        <div key={a.key} style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${a.required?"rgba(239,68,68,.25)":"rgba(245,158,11,.25)"}`,background:a.required?"rgba(239,68,68,.06)":"rgba(245,158,11,.06)"}}>
                          <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                            <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{a.area} - {a.label}</div>
                            <div style={{fontSize:10,fontWeight:900,color:a.required?"#ef4444":"#f59e0b",textTransform:"uppercase"}}>{a.severity || (a.required ? "critica" : "aviso")}</div>
                          </div>
                          <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.45,marginTop:4}}>{a.action}</div>
                          <div style={{fontSize:10,color:"var(--text5)",lineHeight:1.45,marginTop:3}}>{a.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })() : (
              <div style={{fontSize:12,color:"var(--text5)",padding:"18px 0",textAlign:"center"}}>Cargando control diario...</div>
            )}
          </div>
          <div style={S.section}>
            <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap",marginBottom:14}}>
              <div>
                <div style={S.secTitle}>Checklist operativo vendible</div>
                <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.55}}>
                  {puestaMarcha?.objetivo || "Revisando datos de empresa, operativa, facturacion, comunicaciones y documentacion."}
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {esGerente && (
                  <button
                    onClick={solicitarBackupGoLive}
                    disabled={backupSolicitando}
                    style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)",opacity:backupSolicitando?0.7:1}}
                  >
                    {backupSolicitando ? "Solicitando..." : "Solicitar backup"}
                  </button>
                )}
                <button
                  onClick={descargarInformePuestaMarcha}
                  style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)"}}
                >
                  Informe HTML
                </button>
                <button
                  onClick={()=>getPuestaMarchaComercial().then(setPuestaMarcha).catch(e=>notify(e.message || "No se pudo refrescar la puesta en marcha.", "error"))}
                  style={{...S.btn,background:"var(--bg4)",color:"var(--text3)",border:"1px solid var(--border)"}}
                >
                  Refrescar
                </button>
              </div>
            </div>
            {puestaMarcha ? (
              <>
                {(() => {
                  const resumen = puestaMarcha.resumen || {};
                  const estado = resumen.estado || "vigilancia";
                  const color = estado === "listo" ? "var(--green)" : estado === "bloqueado" ? "#ef4444" : "#f59e0b";
                  return (
                    <>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:14}}>
                        {[
                          ["Score", `${resumen.score || 0}%`, color],
                          ["Estado", estado === "listo" ? "Listo" : estado === "bloqueado" ? "Bloqueado" : "Vigilancia", color],
                          ["Bloqueantes", resumen.bloqueantes || 0, Number(resumen.bloqueantes||0)>0?"#ef4444":"var(--green)"],
                          ["Avisos", resumen.avisos || 0, Number(resumen.avisos||0)>0?"#f59e0b":"var(--green)"],
                          ["Estimacion", resumen.producto_operativo_vendible_estimado || "-", color],
                        ].map(([label,value,c])=>(
                          <div key={label} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:9,padding:"11px 12px"}}>
                            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color:c}}>{value}</div>
                            <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",marginTop:3}}>{label}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{padding:"11px 13px",borderRadius:9,border:`1px solid ${color}33`,background:`${color}10`,fontSize:12,color:"var(--text3)",lineHeight:1.55,marginBottom:14}}>
                        {resumen.listo_para_operar
                          ? "No hay bloqueantes criticos. La empresa esta en condiciones de operar; solo quedan avisos de mejora o integraciones opcionales."
                          : "Hay bloqueantes criticos que conviene resolver antes de vender o arrancar una implantacion real."}
                      </div>
                      {puestaMarcha.backup && (
                        <div style={{padding:"10px 12px",borderRadius:9,border:"1px solid rgba(59,130,246,.18)",background:"rgba(59,130,246,.06)",fontSize:12,color:"var(--text3)",lineHeight:1.5,marginBottom:14}}>
                          <strong style={{color:"var(--text)"}}>Continuidad / backup:</strong>{" "}
                          {puestaMarcha.backup.solicitado ? "solicitud registrada" : "sin solicitud registrada"}.
                          {" "}Pendientes: {puestaMarcha.backup.pendientes || 0}; resueltas: {puestaMarcha.backup.resueltos || 0}. Gestion: {puestaMarcha.backup.gestion || "TransGestAdmin"}.
                        </div>
                      )}
                    </>
                  );
                })()}

                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(135px,1fr))",gap:8,marginBottom:14}}>
                  {Object.entries(puestaMarcha.metricas || {}).map(([k,v])=>(
                    <div key={k} style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px"}}>
                      <div style={{fontSize:14,fontWeight:900,color:"var(--text)",fontFamily:"'JetBrains Mono',monospace"}}>{v}</div>
                      <div style={{fontSize:9,color:"var(--text5)",fontWeight:800,textTransform:"uppercase"}}>{k.replace(/_/g," ")}</div>
                    </div>
                  ))}
                </div>

                {!!puestaMarcha.acciones_prioritarias?.length && (
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",color:"var(--text5)",marginBottom:8}}>Acciones prioritarias</div>
                    <div style={{display:"grid",gap:8}}>
                      {puestaMarcha.acciones_prioritarias.map(a=>(
                        <div key={a.key} style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${a.required?"rgba(239,68,68,.25)":"rgba(245,158,11,.25)"}`,background:a.required?"rgba(239,68,68,.06)":"rgba(245,158,11,.06)"}}>
                          <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                            <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{a.area} - {a.label}</div>
                            <div style={{fontSize:10,fontWeight:900,color:a.required?"#ef4444":"#f59e0b",textTransform:"uppercase"}}>{a.required ? "Bloqueante" : "Aviso"}</div>
                          </div>
                          <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.45,marginTop:4}}>{a.action}</div>
                          <div style={{fontSize:10,color:"var(--text5)",lineHeight:1.45,marginTop:3}}>{a.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:8}}>
                  {(puestaMarcha.checks || []).map(check=>(
                    <div key={check.key} style={{border:"1px solid var(--border)",background:"var(--bg3)",borderRadius:8,padding:"10px 11px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{check.label}</div>
                          <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",marginTop:2}}>{check.area}</div>
                        </div>
                        <span style={{fontSize:10,fontWeight:900,color:check.ok?"var(--green)":check.required?"#ef4444":"#f59e0b"}}>
                          {check.ok ? "OK" : check.required ? "PEND." : "AVISO"}
                        </span>
                      </div>
                      <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.45,marginTop:7}}>{check.detail}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{fontSize:12,color:"var(--text5)",padding:"18px 0",textAlign:"center"}}>Cargando checklist...</div>
            )}
          </div>
        </div>
      )}

      {tab==="tesoreria" && (
        <div>
          <div style={S.info}>
            Este saldo representa caja y bancos disponibles para prevision interna. No modifica el capital social legal ni sustituye la contabilidad oficial. Por seguridad, solo puede cambiarlo el gerente y el backend exige autorizacion de un superadmin.
          </div>
          <div style={S.section}>
            <div style={S.secTitle}>Saldo operativo de tesoreria</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:"14px",alignItems:"end"}}>
              <div>
                <label style={S.lbl}>Saldo disponible caja/bancos</label>
                <input
                  value={capitalDraft}
                  onChange={e=>setCapitalDraft(e.target.value)}
                  onBlur={()=>setCapitalDraft(String(parseMoney(capitalDraft)))}
                  placeholder="0,00"
                  disabled={!esGerente || savingCapital}
                  style={{...S.inp,fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:800}}
                />
                <div style={{fontSize:11,color:"var(--text5)",marginTop:6}}>
                  Valor vigente: {fmt2(capitalActual)} EUR
                </div>
              </div>
              <div style={{
                padding:"12px 14px",
                borderRadius:8,
                border:"1px solid rgba(245,158,11,.24)",
                background:"rgba(245,158,11,.07)",
                color:"var(--text3)",
                fontSize:12,
                lineHeight:1.45,
              }}>
                Cambiar este dato requiere doble confirmacion del gerente, frase literal de control, soporte documental y credenciales validas de superadmin. El cambio queda registrado para auditoria.
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:"12px",marginTop:14}}>
              <div>
                <label style={S.lbl}>Motivo del ajuste</label>
                <input
                  value={capitalMotivo}
                  onChange={e=>setCapitalMotivo(e.target.value)}
                  placeholder="Regularizacion saldo inicial, cierre bancario..."
                  disabled={!esGerente || savingCapital}
                  style={S.inp}
                />
              </div>
              <div>
                <label style={S.lbl}>Origen / naturaleza</label>
                <input
                  value={capitalOrigen}
                  onChange={e=>setCapitalOrigen(e.target.value)}
                  placeholder="Banco, caja, aportacion contabilizada..."
                  disabled={!esGerente || savingCapital}
                  style={S.inp}
                />
              </div>
              <div>
                <label style={S.lbl}>Soporte documental</label>
                <input
                  value={capitalSoporte}
                  onChange={e=>setCapitalSoporte(e.target.value)}
                  placeholder="Extracto, asiento, acta, ref. contable..."
                  disabled={!esGerente || savingCapital}
                  style={S.inp}
                />
              </div>
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center",marginTop:14,flexWrap:"wrap"}}>
              {esGerente && (
                <button
                  onClick={guardarCapitalTesoreria}
                  disabled={savingCapital}
                  style={{...S.btn,background:"rgba(245,158,11,.14)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.30)",opacity:savingCapital ? .7 : 1}}
                >
                  {savingCapital ? "Autorizando..." : "Cambiar saldo"}
                </button>
              )}
              {!esGerente && (
                <span style={{fontSize:12,color:"var(--text5)"}}>Solo el gerente puede solicitar cambios de saldo operativo.</span>
              )}
              {empresaCfg?.cfg_precios?.tesoreria?.capital_actual_at && (
                <span style={{fontSize:11,color:"var(--text5)"}}>
                  Ultimo cambio: {new Date(empresaCfg.cfg_precios.tesoreria.capital_actual_at).toLocaleString("es-ES")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {tab==="sostenibilidad" && (
        <div>
          <div style={S.info}>
            Parametros usados por Informes &gt; CO2 para estimar emisiones. Son valores operativos de reporting interno y pueden ajustarse cuando la empresa disponga de consumo real, telematica o metodologia verificada.
          </div>
          <div style={S.section}>
            <div style={S.secTitle}>Factores de calculo CO2</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:"12px 14px",alignItems:"end"}}>
              <div>
                <label style={S.lbl}>Consumo medio flota (L/100 km)</label>
                <input
                  value={sostenibilidadCfg.consumo_l_100km}
                  onChange={e=>setSostenibilidadCfg(prev=>({...prev,consumo_l_100km:e.target.value}))}
                  onBlur={()=>setSostenibilidadCfg(prev=>({...prev,consumo_l_100km:parseMoney(prev.consumo_l_100km)}))}
                  placeholder="32"
                  disabled={!esGerente || savingSostenibilidad}
                  style={{...S.inp,fontFamily:"'JetBrains Mono',monospace",fontWeight:800}}
                />
              </div>
              <div>
                <label style={S.lbl}>Factor CO2 (kg por litro)</label>
                <input
                  value={sostenibilidadCfg.factor_kg_co2_litro}
                  onChange={e=>setSostenibilidadCfg(prev=>({...prev,factor_kg_co2_litro:e.target.value}))}
                  onBlur={()=>setSostenibilidadCfg(prev=>({...prev,factor_kg_co2_litro:parseMoney(prev.factor_kg_co2_litro)}))}
                  placeholder="2,68"
                  disabled={!esGerente || savingSostenibilidad}
                  style={{...S.inp,fontFamily:"'JetBrains Mono',monospace",fontWeight:800}}
                />
              </div>
              <div>
                <label style={S.lbl}>CO2 estimado por 100 km</label>
                <div style={{...S.inp,fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:"var(--green)",background:"rgba(16,185,129,.07)"}}>
                  {fmt2(parseMoney(sostenibilidadCfg.consumo_l_100km) * parseMoney(sostenibilidadCfg.factor_kg_co2_litro))} kg
                </div>
              </div>
            </div>
            <div style={{marginTop:12}}>
              <label style={S.lbl}>Nota metodologica</label>
              <textarea
                value={sostenibilidadCfg.metodologia || ""}
                onChange={e=>setSostenibilidadCfg(prev=>({...prev,metodologia:e.target.value}))}
                disabled={!esGerente || savingSostenibilidad}
                rows={3}
                style={{...S.inp,resize:"vertical",lineHeight:1.4}}
              />
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center",marginTop:14,flexWrap:"wrap"}}>
              {esGerente ? (
                <button
                  onClick={guardarSostenibilidad}
                  disabled={savingSostenibilidad}
                  style={{...S.btn,background:"rgba(16,185,129,.14)",color:"#10b981",border:"1px solid rgba(16,185,129,.30)",opacity:savingSostenibilidad?0.7:1}}
                >
                  {savingSostenibilidad ? "Guardando..." : "Guardar CO2"}
                </button>
              ) : (
                <span style={{fontSize:12,color:"var(--text5)"}}>Solo el gerente puede modificar factores de sostenibilidad.</span>
              )}
              {saved==="sostenibilidad" && <span style={S.saved}>Guardado correctamente</span>}
              {empresaCfg?.cfg_precios?.sostenibilidad?.updated_at && (
                <span style={{fontSize:11,color:"var(--text5)"}}>
                  Ultimo cambio: {new Date(empresaCfg.cfg_precios.sostenibilidad.updated_at).toLocaleString("es-ES")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {tab==="calendario" && (
        <div>
          <div style={S.info}>
            Calendario laboral por comunidad autonoma para planificar cargas, descargas, vencimientos y avisos teniendo en cuenta festivos. El sistema actualiza y cachea cada combinacion de ano y comunidad.
          </div>
          <div style={S.section}>
            <div style={S.secTitle}>Festivos por comunidad autonoma</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:"10px 14px",alignItems:"end"}}>
              <div>
                <label style={S.lbl}>Ano</label>
                <select style={S.inp} value={calYear} onChange={e=>setCalYear(Number(e.target.value))}>
                  {Array.from({length:5},(_,i)=>new Date().getFullYear()-1+i).map(y=><option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label style={S.lbl}>Comunidad autonoma</label>
                <select style={S.inp} value={calCcaa} onChange={e=>setCalCcaa(e.target.value)}>
                  {calCcaaOptions.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={()=>cargarCalendarioLaboral(false)} disabled={calLoading} style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:calLoading ? .7 : 1}}>
                  {calLoading ? "Cargando..." : "Consultar"}
                </button>
                <button onClick={()=>cargarCalendarioLaboral(true)} disabled={calLoading} style={{...S.btn,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border2)",opacity:calLoading ? .7 : 1}}>
                  Actualizar
                </button>
              </div>
            </div>
            {calendarioLaboral && (
              <div style={{marginTop:16}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
                  <div style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>
                    {calendarioLaboral.ccaa_label || calCcaa} - {calendarioLaboral.year}
                  </div>
                  <div style={{fontSize:11,color:"var(--text5)"}}>
                    Fuente: {calendarioLaboral.fuente || "-"}{calendarioLaboral.cache ? " (cache)" : ""} · Actualizado {calendarioLaboral.updated_at ? new Date(calendarioLaboral.updated_at).toLocaleString("es-ES") : "-"}
                  </div>
                </div>
                {!!calendarioLaboral.warnings?.length && (
                  <div style={{...S.info,borderColor:"rgba(245,158,11,.20)",background:"rgba(245,158,11,.07)",color:"#f59e0b"}}>
                    {calendarioLaboral.warnings.join(" ")}
                  </div>
                )}
                <div style={{border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead>
                      <tr>
                        {["Fecha","Festivo","Ambito"].map(h=><th key={h} style={{textAlign:"left",fontSize:10,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",padding:"9px 10px",background:"var(--bg3)",borderBottom:"1px solid var(--border)"}}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {(calendarioLaboral.holidays || []).map(h=>(
                        <tr key={`${h.date}-${h.localName}`}>
                          <td style={{padding:"9px 10px",fontSize:12,borderBottom:"1px solid var(--border)",fontFamily:"'JetBrains Mono',monospace",color:"var(--text)"}}>{h.date}</td>
                          <td style={{padding:"9px 10px",fontSize:12,borderBottom:"1px solid var(--border)",color:"var(--text3)",fontWeight:700}}>{h.localName || h.name}</td>
                          <td style={{padding:"9px 10px",fontSize:12,borderBottom:"1px solid var(--border)",color:h.scope==="nacional"?"var(--accent-xl)":"#f59e0b",fontWeight:800,textTransform:"capitalize"}}>{h.scope || "festivo"}</td>
                        </tr>
                      ))}
                      {!calendarioLaboral.holidays?.length && (
                        <tr><td colSpan={3} style={{padding:14,fontSize:12,color:"var(--text5)",textAlign:"center"}}>Sin festivos cargados para esta seleccion.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab==="empresa" && (
        <div>
          <div style={S.info}>
            Estos datos aparecerán en el encabezado de todas las facturas. Asegúrate de que el CIF y la razón social coincidan exactamente con los de la AEAT.
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Identificación fiscal</div>
            <div style={S.grid2}>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={S.lbl}>Razón social *</label>
                <input style={S.inp} value={empresa.razon_social} onChange={fe("razon_social")} placeholder="Transportes García e Hijos S.L." disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>CIF / NIF *</label>
                <input style={S.inp} value={empresa.cif} onChange={fe("cif")} placeholder="B-12345678" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Régimen IVA</label>
                <select value={empresa.regimen_iva} onChange={fe("regimen_iva")} disabled={!esGerente}
                  style={{ ...S.inp, background:esGerente ? "var(--bg4)":"var(--bg2)" }}>
                  {REGIMENES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Domicilio fiscal</div>
            <div style={S.grid2}>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={S.lbl}>Domicilio (calle y número) *</label>
                <input style={S.inp} value={empresa.domicilio} onChange={fe("domicilio")} placeholder="Calle Mayor, 15" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Código Postal</label>
                <input style={S.inp} value={empresa.cp} onChange={fe("cp")} placeholder="28001" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Municipio</label>
                <input style={S.inp} value={empresa.municipio} onChange={fe("municipio")} placeholder="Madrid" disabled={!esGerente}/>
              </div>
              <GeoFields
                values={empresa}
                onChange={(campo, valor) => setEmpresa(p => ({ ...p, [campo]: valor }))}
                inputStyle={S.inp}
                labelStyle={S.lbl}
                disabled={!esGerente}
              />
            </div>
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Contacto</div>
            <div style={S.grid3}>
              <div>
                <label style={S.lbl}>Teléfono</label>
                <input style={S.inp} value={empresa.telefono} onChange={fe("telefono")} placeholder="+34 91 000 00 00" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Email empresa</label>
                <input type="email" style={S.inp} value={empresa.email} onChange={fe("email")} placeholder="info@empresa.com" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Web</label>
                <input style={S.inp} value={empresa.web} onChange={fe("web")} placeholder="www.empresa.com" disabled={!esGerente}/>
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={S.lbl}>Emails para recibir albaranes</label>
                <textarea
                  style={{...S.inp,minHeight:72,resize:"vertical"}}
                  value={empresa.emails_albaranes || ""}
                  onChange={fe("emails_albaranes")}
                  placeholder="trafico@empresa.com, administracion@empresa.com"
                  disabled={!esGerente}
                />
                <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Se pueden indicar varios separados por coma, punto y coma o salto de linea. Apareceran en las ordenes de carga para colaboradores.</div>
              </div>
            </div>
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Datos bancarios</div>
            <div style={S.grid3}>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={S.lbl}>IBAN *</label>
                <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={empresa.iban} onChange={fe("iban")} placeholder="ES91 2100 0418 4502 0005 1332" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>BIC / SWIFT</label>
                <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={empresa.bic} onChange={fe("bic")} placeholder="CAIXESBBXXX" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Entidad bancaria</label>
                <input style={S.inp} value={empresa.banco} onChange={fe("banco")} placeholder="CaixaBank" disabled={!esGerente}/>
              </div>
            </div>
          </div>

          {esGerente && (
            <div style={{ display:"flex", gap:12, alignItems:"center" }}>
              <button style={{ ...S.btn, background:"var(--accent)", color:"#fff" }} onClick={guardarEmpresa}>
                Guardar datos empresa
              </button>
              {saved==="empresa" && <span style={S.saved}>✓ Guardado correctamente</span>}
            </div>
          )}
          {!esGerente && (
            <div style={{ fontSize:12, color:"var(--text5)", padding:"8px 0" }}>Solo el gerente puede modificar los datos de empresa.</div>
          )}
        </div>
      )}

      {/* ── Config facturas ── */}
      {tab==="factura" && (
        <div>
          <div style={S.section}>
            <div style={S.secTitle}>Series de facturación</div>
            <div style={S.info}>
              Según RD 1619/2012, las facturas rectificativas deben tener su propia serie separada de las facturas ordinarias.
            </div>
            <div style={S.grid3}>
              <div>
                <label style={S.lbl}>Serie facturas normales</label>
                <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={empresa.serie_facturas} onChange={fe("serie_facturas")} placeholder="A" maxLength={3} disabled={!esGerente}/>
                <div style={{ fontSize:10, color:"var(--text5)", marginTop:4 }}>Ej: A-00001, A-00002...</div>
              </div>
              <div>
                <label style={S.lbl}>Serie facturas rectificativas</label>
                <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={empresa.serie_rectificativas} onChange={fe("serie_rectificativas")} placeholder="R" maxLength={3} disabled={!esGerente}/>
                <div style={{ fontSize:10, color:"var(--text5)", marginTop:4 }}>Ej: R-00001, R-00002...</div>
              </div>
              <div>
                <label style={S.lbl}>Serie órdenes de carga</label>
                <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={empresa.serie_ordenes||"OC"} onChange={fe("serie_ordenes")} placeholder="OC" maxLength={5} disabled={!esGerente}/>
                <div style={{ fontSize:10, color:"var(--text5)", marginTop:4 }}>Ej: OC -> genera OC-2026-0001, OC-2026-0002...</div>
              </div>
              <div>
                <label style={S.lbl}>IVA por defecto (%)</label>
                <select value={empresa.tipo_iva_defecto} onChange={fe("tipo_iva_defecto")} disabled={!esGerente}
                  style={{ ...S.inp, background:esGerente ? "var(--bg4)":"var(--bg2)" }}>
                  <option value="21">21% - General</option>
                  <option value="10">10% - Reducido</option>
                  <option value="4">4% - Superreducido</option>
                  <option value="0">0% - Exento</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop:10 }}>
              <div style={{gridColumn:"1/-1",marginTop:10,padding:"12px 14px",background:"rgba(139,92,246,.06)",border:"1px solid rgba(139,92,246,.18)",borderRadius:8}}>
                <div style={{fontWeight:700,fontSize:11,color:"#a78bfa",textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>Condiciones de pago a colaboradores</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0 12px"}}>
                  <div>
                    <label style={S.lbl}>Forma de pago</label>
                    <select style={{...S.inp}} value={empresa.forma_pago_colaboradores||"dias_fijos"} onChange={fe("forma_pago_colaboradores")} disabled={!esGerente}>
                      <option value="dias_fijos">Días fijos del mes (ej: día 15)</option>
                      <option value="fin_mes">Fin de mes</option>
                      <option value="transferencia_inmediata">Transferencia inmediata</option>
                    </select>
                  </div>
                  <div>
                    <label style={S.lbl}>Día(s) de pago del mes</label>
                    <input type="text" style={S.inp} value={empresa.dias_pago_colaboradores||"15"} onChange={fe("dias_pago_colaboradores")} placeholder="Ej: 15 ó 15,30" disabled={!esGerente}/>
                    <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Separa con coma para múltiples días</div>
                  </div>
                  <div>
                    <label style={S.lbl}>Plazo desde recepción factura (días)</label>
                    <input type="number" style={S.inp} value={empresa.plazo_pago_colaboradores||60} onChange={fe("plazo_pago_colaboradores")} placeholder="Ej: 60" disabled={!esGerente}/>
                    <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>El contador empieza al recibir la factura</div>
                  </div>
                </div>
                <div style={{marginTop:8,fontSize:11,color:"var(--text4)"}}>
                  Ejemplo: plazo 60 días + día 15 -> si recibes factura el 5 de marzo, el pago se vence el 5 de mayo, pero se paga el día 15 de mayo.
                </div>
              </div>

              <div style={{gridColumn:"1/-1",marginTop:10,padding:"12px 14px",background:"rgba(59,130,246,.06)",border:"1px solid rgba(59,130,246,.18)",borderRadius:8}}>
                <div style={{fontWeight:700,fontSize:11,color:"#60a5fa",textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>Condiciones de pago de clientes</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0 12px"}}>
                  <div>
                    <label style={S.lbl}>Forma de pago</label>
                    <select style={{...S.inp}} value={empresa.forma_pago_clientes||"recepcion_factura"} onChange={fe("forma_pago_clientes")} disabled={!esGerente}>
                      <option value="recepcion_factura">Transferencia desde recepcion factura</option>
                      <option value="fin_mes">Fin de mes</option>
                      <option value="transferencia_inmediata">Transferencia inmediata</option>
                      <option value="contado">Contado</option>
                    </select>
                  </div>
                  <div>
                    <label style={S.lbl}>Plazo pago clientes (dias)</label>
                    <input type="number" style={S.inp} value={empresa.plazo_pago_clientes||60} onChange={fe("plazo_pago_clientes")} placeholder="Ej: 60" disabled={!esGerente}/>
                  </div>
                  <div>
                    <label style={S.lbl}>Dia(s) pago si aplica</label>
                    <input type="text" style={S.inp} value={empresa.dias_pago_clientes||""} onChange={fe("dias_pago_clientes")} placeholder="Ej: 15,30" disabled={!esGerente}/>
                  </div>
                </div>
                <label style={S.lbl}>Texto exacto para ordenes</label>
                <input style={S.inp} value={empresa.texto_pago_clientes||""} onChange={fe("texto_pago_clientes")} placeholder="Transferencia 60 dias fecha recepcion factura" disabled={!esGerente}/>
                <div style={{marginTop:8,fontSize:11,color:"var(--text4)"}}>
                  Este texto se imprimira en la orden de carga de transporte propio y sirve como condicion economica visible para cliente/expedidor.
                </div>
              </div>

              <div style={{gridColumn:"1/-1",marginTop:10,padding:"12px 14px",background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.18)",borderRadius:8}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:11,color:"var(--green)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>Control de cobros</div>
                    <div style={{fontSize:11,color:"var(--text4)"}}>Politica que se aplica al crear facturas y al revisar cobros vencidos.</div>
                  </div>
                  {esGerente && (
                    <button onClick={guardarCobros} style={{...S.btn,background:"rgba(34,211,160,.12)",color:"var(--green)",border:"1px solid rgba(34,211,160,.25)"}}>
                      Guardar politica de cobros
                    </button>
                  )}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:"6px 14px",alignItems:"end"}}>
                  <div>
                    <label style={S.lbl}>Revision tras vencimiento</label>
                    <input type="number" min="0" max="30" disabled={!esGerente} value={cobrosCfg.dias_revision_post_vencimiento} onChange={fcobro("dias_revision_post_vencimiento")} style={S.inp}/>
                  </div>
                  <div>
                    <label style={S.lbl}>Dias entre emails</label>
                    <input type="number" min="3" max="30" disabled={!esGerente} value={cobrosCfg.dias_entre_reclamaciones} onChange={fcobro("dias_entre_reclamaciones")} style={S.inp}/>
                  </div>
                  <div>
                    <label style={S.lbl}>Max. reclamaciones</label>
                    <input type="number" min="1" max="20" disabled={!esGerente} value={cobrosCfg.max_envios_reclamacion} onChange={fcobro("max_envios_reclamacion")} style={S.inp}/>
                  </div>
                  <div>
                    <label style={S.lbl}>Dias hasta juridico</label>
                    <input type="number" min="7" max="180" disabled={!esGerente} value={cobrosCfg.dias_hasta_juridico} onChange={fcobro("dias_hasta_juridico")} style={S.inp}/>
                  </div>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text3)",fontWeight:700,padding:"8px 0"}}>
                    <input type="checkbox" disabled={!esGerente} checked={!!cobrosCfg.envio_email_auto} onChange={fcobro("envio_email_auto")}/>
                    Enviar emails automaticos
                  </label>
                </div>
                {saved==="cobros" && <div style={{...S.saved,marginTop:10}}>Guardado correctamente</div>}
              </div>

              <label style={S.lbl}>Texto pie de factura</label>
              <textarea style={{ ...S.inp, height:70, resize:"vertical" }}
                value={empresa.texto_pie}
                onChange={fe("texto_pie")}
                placeholder="Ej: Forma de pago: Transferencia bancaria 30 días. En caso de impago se aplicarán los intereses legales según Ley 3/2004."
                disabled={!esGerente}/>
            </div>
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>AEAT - VERIFACTU / SII</div>
            <div style={S.info}>
              Configura el modo fiscal de esta empresa. Al emitir facturas, TransGest ya deja creado el registro fiscal y la cola de envio correspondiente.
            </div>
            {fiscalStatus && (
              <div style={{
                marginBottom:14,
                padding:"12px 14px",
                borderRadius:8,
                background:fiscalStatus.level === "ok" ? "rgba(16,185,129,.08)" : fiscalStatus.level === "warning" ? "rgba(245,158,11,.08)" : "rgba(239,68,68,.08)",
                border:`1px solid ${fiscalStatus.level === "ok" ? "rgba(16,185,129,.25)" : fiscalStatus.level === "warning" ? "rgba(245,158,11,.25)" : "rgba(239,68,68,.25)"}`,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
                  <div style={{fontWeight:800,fontSize:13,color:fiscalStatus.level === "ok" ? "var(--green)" : fiscalStatus.level === "warning" ? "#f59e0b" : "#ef4444"}}>
                    Estado fiscal: {fiscalStatus.level === "ok" ? "Listo" : fiscalStatus.level === "warning" ? "Pendiente de revision" : "Incompleto"}
                  </div>
                  <div style={{fontSize:11,color:"var(--text4)",fontWeight:700}}>
                    {fiscalStatus.production_ready ? "Produccion preparada" : fiscalCfg.entorno === "produccion" ? "Produccion no preparada" : "Modo pruebas"}
                  </div>
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>{fiscalStatus.summary}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
                  {(Array.isArray(fiscalStatus.checks) ? fiscalStatus.checks : []).map((check) => (
                    <div key={check.label} style={{padding:"8px 10px",borderRadius:7,border:"1px solid #1e2d45",background:"var(--bg3)"}}>
                      <div style={{fontSize:11,fontWeight:800,color:check.ok ? "var(--green)" : check.severity === "warning" ? "#f59e0b" : "#ef4444"}}>
                        {check.ok ? "OK" : check.severity === "warning" ? "AVISO" : "FALTA"} - {check.label}
                      </div>
                      {check.detail && <div style={{fontSize:11,color:"var(--text4)",marginTop:4,lineHeight:1.45}}>{check.detail}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={S.grid3}>
              <div>
                <label style={S.lbl}>Modo fiscal</label>
                <select value={fiscalCfg.modo} onChange={ff("modo")} disabled={!esGerente} style={{ ...S.inp, background:esGerente ? "var(--bg4)":"var(--bg2)" }}>
                  <option value="ninguno">Sin integrar</option>
                  <option value="verifactu">VERIFACTU</option>
                  <option value="sii">SII</option>
                </select>
              </div>
              <div>
                <label style={S.lbl}>Entorno</label>
                <select value={fiscalCfg.entorno} onChange={ff("entorno")} disabled={!esGerente} style={{ ...S.inp, background:esGerente ? "var(--bg4)":"var(--bg2)" }}>
                  <option value="pruebas">Pruebas</option>
                  <option value="produccion">Produccion</option>
                </select>
              </div>
              <div>
                <label style={S.lbl}>Email alertas fiscales</label>
                <input style={S.inp} value={fiscalCfg.email_alertas || ""} onChange={ff("email_alertas")} placeholder="fiscal@empresa.com" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>NIF declarante</label>
                <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={fiscalCfg.nif_declarante || ""} onChange={ff("nif_declarante")} placeholder="B12345678" disabled={!esGerente}/>
              </div>
              <div style={{ gridColumn:"span 2" }}>
                <label style={S.lbl}>Razon social declarante</label>
                <input style={S.inp} value={fiscalCfg.razon_social_declarante || ""} onChange={ff("razon_social_declarante")} placeholder="Transportes Ejemplo S.L." disabled={!esGerente}/>
              </div>
            </div>

            <div style={{marginTop:12,padding:"12px 14px",background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.18)",borderRadius:8}}>
              <div style={{fontWeight:700,fontSize:11,color:"var(--green)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>
                Ajustes {fiscalCfg.modo === "sii" ? "SII" : "VERIFACTU"}
              </div>
              {fiscalCfg.modo === "sii" ? (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px 14px",alignItems:"end"}}>
                  <div>
                    <label style={S.lbl}>Alias certificado</label>
                    <input style={S.inp} value={fiscalCfg.sii?.certificado_alias || ""} onChange={ffs("certificado_alias")} placeholder="cert-aeat-empresa" disabled={!esGerente}/>
                  </div>
                  <div>
                    <label style={S.lbl}>Endpoint SII</label>
                    <input style={S.inp} value={fiscalCfg.sii?.endpoint_url || ""} onChange={ffs("endpoint_url")} placeholder="https://..." disabled={!esGerente}/>
                  </div>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text3)",fontWeight:700,padding:"8px 0"}}>
                    <input type="checkbox" checked={!!fiscalCfg.sii?.envio_automatico} onChange={ffs("envio_automatico")} disabled={!esGerente}/>
                    Envio automatico
                  </label>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text3)",fontWeight:700,padding:"8px 0"}}>
                    <input type="checkbox" checked={!!fiscalCfg.sii?.incluir_emitidas} onChange={ffs("incluir_emitidas")} disabled={!esGerente}/>
                    Facturas emitidas
                  </label>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text3)",fontWeight:700,padding:"8px 0"}}>
                    <input type="checkbox" checked={!!fiscalCfg.sii?.incluir_recibidas} onChange={ffs("incluir_recibidas")} disabled={!esGerente}/>
                    Facturas recibidas
                  </label>
                </div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px 14px",alignItems:"end"}}>
                  <div>
                    <label style={S.lbl}>Proveedor VERIFACTU</label>
                    <select value={fiscalCfg.verifactu?.proveedor || "directo"} onChange={ffv("proveedor")} disabled={!esGerente} style={{ ...S.inp, background:esGerente ? "var(--bg4)":"var(--bg2)" }}>
                      <option value="directo">Directo / propio</option>
                      <option value="verifacti">Verifacti API</option>
                    </select>
                  </div>
                  <div>
                    <label style={S.lbl}>Alias certificado</label>
                    <input style={S.inp} value={fiscalCfg.verifactu?.certificado_alias || ""} onChange={ffv("certificado_alias")} placeholder="cert-aeat-empresa" disabled={!esGerente || fiscalCfg.verifactu?.proveedor === "verifacti"}/>
                  </div>
                  <div>
                    <label style={S.lbl}>Endpoint VERIFACTU</label>
                    <input style={S.inp} value={fiscalCfg.verifactu?.endpoint_url || ""} onChange={ffv("endpoint_url")} placeholder="https://..." disabled={!esGerente || fiscalCfg.verifactu?.proveedor === "verifacti"}/>
                  </div>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text3)",fontWeight:700,padding:"8px 0"}}>
                    <input type="checkbox" checked={!!fiscalCfg.verifactu?.envio_automatico} onChange={ffv("envio_automatico")} disabled={!esGerente}/>
                    Envio automatico
                  </label>
                  {fiscalCfg.verifactu?.proveedor === "verifacti" && (
                    <>
                      <div>
                        <label style={S.lbl}>Base URL Verifacti</label>
                        <input style={S.inp} value={fiscalCfg.verifactu?.provider_base_url || ""} onChange={ffv("provider_base_url")} placeholder="https://..." disabled={!esGerente}/>
                      </div>
                      <div>
                        <label style={S.lbl}>API key Verifacti</label>
                        <input style={{...S.inp,fontFamily:"'JetBrains Mono',monospace"}} value={fiscalCfg.verifactu?.provider_api_key || ""} onChange={ffv("provider_api_key")} placeholder={fiscalCfg.verifactu?.provider_api_key_masked ? `Guardada (${fiscalCfg.verifactu.provider_api_key_masked})` : "vf_test_..."} disabled={!esGerente}/>
                      </div>
                      <div>
                        <label style={S.lbl}>Webhook secret</label>
                        <input style={{...S.inp,fontFamily:"'JetBrains Mono',monospace"}} value={fiscalCfg.verifactu?.provider_webhook_secret || ""} onChange={ffv("provider_webhook_secret")} placeholder={fiscalCfg.verifactu?.provider_webhook_secret_masked ? `Guardado (${fiscalCfg.verifactu.provider_webhook_secret_masked})` : "Clave secreta para validar webhooks"} disabled={!esGerente}/>
                      </div>
                    </>
                  )}
                  <div>
                    <label style={S.lbl}>Nombre software</label>
                    <input style={S.inp} value={fiscalCfg.verifactu?.software_nombre || ""} placeholder="TransGest" disabled />
                  </div>
                  <div>
                    <label style={S.lbl}>ID software</label>
                    <input style={S.inp} value={fiscalCfg.verifactu?.software_id || ""} placeholder="transgest-tms" disabled />
                  </div>
                  <div>
                    <label style={S.lbl}>Version software</label>
                    <input style={S.inp} value={fiscalCfg.verifactu?.software_version || ""} placeholder="1.0.0" disabled />
                  </div>
                  <div style={{gridColumn:"1/-1",fontSize:11,color:"var(--text5)"}}>
                    La identidad y version del software emisor se controlan globalmente desde SuperAdmin.
                  </div>
                </div>
              )}
              {fiscalCfg.modo === "verifactu" && fiscalCfg.verifactu?.proveedor === "verifacti" && (
                <div style={{marginTop:10,display:"grid",gap:8}}>
                  <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.5}}>
                    Verifacti usa API key por empresa/NIF. TransGest queda preparado para crear el registro por `POST /verifactu/create`, consultar su estado por `GET /verifactu/status` y recibir confirmaciones por webhook.
                  </div>
                  <div style={{background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.18)",borderRadius:8,padding:"10px 12px"}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--accent-xl)",marginBottom:6}}>
                      Webhook Verifacti
                    </div>
                    <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6,wordBreak:"break-all"}}>
                      URL: <strong style={{color:"var(--text2)"}}>{fiscalMeta?.verifacti_webhook_url || "Guarda la configuracion fiscal para generar la URL."}</strong>
                    </div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:6,lineHeight:1.55}}>
                      Cabecera esperada: <strong style={{color:"var(--text2)"}}>{fiscalMeta?.verifacti_webhook_header || "x-verifacti-secret"}</strong>
                      {fiscalMeta?.verifacti_webhook_secret_configured ? " - secret listo." : " - falta definir el secret para aceptar webhooks."}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{marginTop:12}}>
              <label style={S.lbl}>Notas fiscales internas</label>
              <textarea style={{ ...S.inp, height:70, resize:"vertical" }} value={fiscalCfg.notas || ""} onChange={ff("notas")} placeholder="Observaciones internas sobre certificados, obligacion fiscal o despliegue AEAT" disabled={!esGerente}/>
            </div>
            {esGerente && (
              <div style={{ display:"flex", gap:12, alignItems:"center", marginTop:14 }}>
                <button style={{ ...S.btn, background:"rgba(16,185,129,.14)", color:"var(--green)", border:"1px solid rgba(16,185,129,.25)" }} onClick={guardarFiscal}>
                  Guardar configuracion fiscal
                </button>
                <button
                  style={{ ...S.btn, background:"rgba(59,130,246,.12)", color:"var(--accent-xl)", border:"1px solid rgba(59,130,246,.24)" }}
                  onClick={probarFiscal}
                  disabled={fiscalTesting}
                >
                  {fiscalTesting ? "Probando..." : "Probar canal fiscal"}
                </button>
                {saved==="fiscal" && <span style={S.saved}>Guardado correctamente</span>}
              </div>
            )}
            {fiscalTestResult && (
              <div style={{
                marginTop:12,
                padding:"12px 14px",
                borderRadius:8,
                background:fiscalTestResult.ok ? "rgba(16,185,129,.08)" : "rgba(245,158,11,.08)",
                border:`1px solid ${fiscalTestResult.ok ? "rgba(16,185,129,.24)" : "rgba(245,158,11,.24)"}`,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{fontSize:13,fontWeight:800,color:fiscalTestResult.ok ? "var(--green)" : "#f59e0b"}}>
                    {fiscalTestResult.ok ? "Canal fiscal verificado" : "Revision del canal fiscal"}
                  </div>
                  <div style={{fontSize:11,color:"var(--text4)",fontWeight:700}}>
                    {fiscalTestResult.mode ? `${String(fiscalTestResult.mode).toUpperCase()} - ` : ""}
                    {fiscalTestResult.provider || "sin proveedor"}
                    {fiscalTestResult.transport?.http_status ? ` - HTTP ${fiscalTestResult.transport.http_status}` : ""}
                  </div>
                </div>
                <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.6,marginTop:6}}>
                  {fiscalTestResult.message || "Sin diagnostico adicional."}
                </div>
                {!!fiscalTestResult.tested_at && (
                  <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:8}}>
                    <div style={{fontSize:11,color:"var(--text4)"}}>
                      Ultima prueba: <strong style={{color:"var(--text2)"}}>{new Date(fiscalTestResult.tested_at).toLocaleString("es-ES")}</strong>
                    </div>
                    <span style={{fontSize:10,fontWeight:800,color:fiscalTestFreshness.color}}>
                      {fiscalTestFreshness.label}
                    </span>
                  </div>
                )}
                {!!fiscalTestResult.transport?.base_url && (
                  <div style={{fontSize:11,color:"var(--text4)",marginTop:8,wordBreak:"break-all"}}>
                    Endpoint: <strong style={{color:"var(--text2)"}}>{fiscalTestResult.transport.base_url}</strong>
                  </div>
                )}
                {!!fiscalTestResult.transport?.checks && (
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                    {Object.entries(fiscalTestResult.transport.checks).map(([key, ok]) => (
                      <span
                        key={key}
                        style={{
                          fontSize:10,
                          fontWeight:800,
                          borderRadius:999,
                          padding:"4px 8px",
                          background:ok ? "rgba(16,185,129,.12)" : "rgba(239,68,68,.12)",
                          border:`1px solid ${ok ? "rgba(16,185,129,.24)" : "rgba(239,68,68,.24)"}`,
                          color:ok ? "var(--green)" : "#f87171",
                        }}
                      >
                        {key.replace(/_/g, " ")}: {ok ? "ok" : "revisar"}
                      </span>
                    ))}
                  </div>
                )}
                {!!fiscalTestResult.transport?.issues?.length && (
                  <div style={{fontSize:11,color:"#fca5a5",lineHeight:1.55,marginTop:8}}>
                    {fiscalTestResult.transport.issues.join(" | ")}
                  </div>
                )}
                {fiscalTestResult.pending_connector && (
                  <div style={{fontSize:11,color:"#f59e0b",marginTop:8,lineHeight:1.55}}>
                    El canal esta preparado a nivel de configuracion, pero el conector real de este modo sigue pendiente de activacion.
                  </div>
                )}
              </div>
            )}
            {!!fiscalCfg.historial_pruebas?.length && (
              <div style={{
                marginTop:12,
                padding:"12px 14px",
                borderRadius:8,
                background:"var(--bg3)",
                border:"1px solid #1e2d45",
              }}>
                <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text4)",marginBottom:8}}>
                  Ultimas pruebas fiscales
                </div>
                <div style={{display:"grid",gap:8}}>
                  {fiscalCfg.historial_pruebas.slice(0, 5).map((test, idx) => {
                    const freshness = getFiscalTestFreshness(test);
                    return (
                      <div key={`${test?.tested_at || "sin-fecha"}-${idx}`} style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",padding:"8px 10px",borderRadius:7,border:"1px solid #22314a",background:"var(--bg2)"}}>
                        <div style={{minWidth:220,flex:"1 1 320px"}}>
                          <div style={{fontSize:11,fontWeight:800,color:test?.ok ? "var(--green)" : "#f59e0b"}}>
                            {(test?.mode ? String(test.mode).toUpperCase() : "FISCAL")} - {test?.provider || "sin proveedor"}
                          </div>
                          <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5,marginTop:4}}>
                            {test?.message || "Sin diagnostico adicional."}
                          </div>
                        </div>
                        <div style={{textAlign:"right",minWidth:170}}>
                          <div style={{fontSize:11,color:"var(--text4)"}}>
                            {test?.tested_at ? new Date(test.tested_at).toLocaleString("es-ES") : "Sin fecha"}
                          </div>
                          <div style={{fontSize:10,fontWeight:900,color:freshness.color,marginTop:4}}>
                            {freshness.label}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {(Number(fiscalQueueSummary?.resumen?.total_registros || 0) > 0 || (fiscalQueueSummary?.cola || []).length > 0) && (
              <div style={{marginTop:12,padding:"12px 14px",borderRadius:8,background:"var(--bg3)",border:"1px solid #1e2d45"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text4)"}}>
                    Cola fiscal reciente
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {[
                      ["Aceptados", fiscalQueueSummary?.resumen?.aceptados, "var(--green)"],
                      ["Pendientes", fiscalQueueSummary?.resumen?.pendientes, "#f59e0b"],
                      ["Errores", fiscalQueueSummary?.resumen?.con_error, "#ef4444"],
                      ["Atascados", fiscalQueueSummary?.resumen?.atascados, "#fb7185"],
                    ].map(([label, value, color]) => (
                      <span key={label} style={{fontSize:10,fontWeight:900,color,background:`${color}12`,border:`1px solid ${color}33`,borderRadius:999,padding:"4px 8px"}}>
                        {label}: {Number(value || 0)}
                      </span>
                    ))}
                  </div>
                </div>
                {!!fiscalQueueSummary?.recientes?.length && (
                  <div style={{display:"grid",gap:8,marginBottom:fiscalQueueSummary?.cola?.length ? 10 : 0}}>
                    {fiscalQueueSummary.recientes.slice(0, 3).map((item) => {
                      const accepted = item.estado_envio === "aceptado";
                      const errored = item.estado_envio === "error" || item.ultimo_error;
                      const tone = accepted ? "var(--green)" : errored ? "#ef4444" : "#f59e0b";
                      const border = accepted ? "rgba(16,185,129,.24)" : errored ? "rgba(239,68,68,.24)" : "rgba(245,158,11,.24)";
                      const bg = accepted ? "rgba(16,185,129,.06)" : errored ? "rgba(239,68,68,.06)" : "rgba(245,158,11,.06)";
                      return (
                        <div key={`reciente-${item.id}`} style={{padding:"8px 10px",borderRadius:7,border:`1px solid ${border}`,background:bg}}>
                          <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                            <div style={{fontSize:11,fontWeight:800,color:"var(--text2)"}}>
                              {item.numero || "Factura"} {String(item.modo || "").toUpperCase()}
                            </div>
                            <div style={{fontSize:10,fontWeight:900,color:tone}}>
                              {accepted ? "aceptada" : errored ? "ultimo error" : "pendiente"}
                            </div>
                          </div>
                          <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>
                            {item.cliente_nombre || "Sin cliente"}
                            {item.updated_at ? ` - ${new Date(item.updated_at).toLocaleString("es-ES")}` : ""}
                          </div>
                          {!!item.accepted_ref && (
                            <div style={{fontSize:10,color:"var(--green)",marginTop:4,lineHeight:1.45,fontFamily:"'JetBrains Mono',monospace"}}>
                              Ref. {String(item.accepted_ref).slice(0, 28)}{String(item.accepted_ref).length > 28 ? "..." : ""}
                            </div>
                          )}
                          {!item.accepted_ref && !!item.provider_uuid && (
                            <div style={{fontSize:10,color:"var(--accent)",marginTop:4,lineHeight:1.45,fontFamily:"'JetBrains Mono',monospace"}}>
                              UUID {String(item.provider_uuid).slice(0, 22)}{String(item.provider_uuid).length > 22 ? "..." : ""}
                            </div>
                          )}
                          {item.next_retry_at && !accepted && (
                            <div style={{fontSize:10,color:"#f59e0b",marginTop:4,lineHeight:1.45,fontWeight:700}}>
                              Reintento: {new Date(item.next_retry_at).toLocaleString("es-ES")}
                            </div>
                          )}
                          {!!item.ultimo_error && (
                            <div style={{fontSize:10,color:"#fca5a5",marginTop:4,lineHeight:1.45}}>
                              {String(item.ultimo_error).slice(0, 120)}{String(item.ultimo_error).length > 120 ? "..." : ""}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {!!fiscalQueueSummary?.cola?.length && (
                  <div style={{display:"grid",gap:8}}>
                    {fiscalQueueSummary.cola.slice(0, 3).map((item) => (
                      <div key={item.id} style={{padding:"8px 10px",borderRadius:7,border:"1px solid #22314a",background:"var(--bg2)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                          <div style={{fontSize:11,fontWeight:800,color:"var(--text2)"}}>
                            {item.numero || "Factura pendiente"} - {String(item.sistema || "").toUpperCase()}
                          </div>
                          <div style={{fontSize:10,fontWeight:900,color:item.estado === "error" ? "#ef4444" : item.estado === "procesando" ? "#22d3ee" : "#f59e0b"}}>
                            {item.estado}
                          </div>
                        </div>
                        <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>
                          {item.cliente_nombre || "Sin cliente"} - intento {Number(item.intento || 0)}
                        </div>
                        {item.next_retry_at && (
                          <div style={{fontSize:10,color:"#f59e0b",marginTop:4,fontWeight:700}}>
                            Siguiente reintento: {new Date(item.next_retry_at).toLocaleString("es-ES")}
                          </div>
                        )}
                        {item.error && (
                          <div style={{fontSize:10,color:"#fca5a5",marginTop:4,lineHeight:1.45}}>
                            {item.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Documento de Control Digital (DeCA)</div>
            <div style={S.info}>
              Preparacion del documento de control electronico para transporte por carretera. Puedes trabajar con codigo numerico o con QR enlazado a una URL HTTPS en un dominio comunicado.
            </div>
            <div style={{
              marginBottom:14,
              padding:"12px 14px",
              borderRadius:8,
              background:empresa.documento_control?.habilitado ? "rgba(16,185,129,.08)" : "rgba(245,158,11,.08)",
              border:`1px solid ${empresa.documento_control?.habilitado ? "rgba(16,185,129,.24)" : "rgba(245,158,11,.24)"}`
            }}>
              <div style={{fontSize:13,fontWeight:800,color:empresa.documento_control?.habilitado ? "var(--green)" : "#f59e0b"}}>
                {empresa.documento_control?.habilitado ? "Modulo activado" : "Modulo pendiente de activar"}
              </div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:6,lineHeight:1.55}}>
                {empresa.documento_control?.sistema === "qr_url" ?
                  "El modo QR requiere dominio HTTPS y comunicacion previa del dominio."
                  : "El modo codigo numerico permite remision posterior del documento en PDF/A si lo solicita inspeccion."}
              </div>
            </div>
            {integracionesStatus?.whatsapp && (
              <div style={{
                marginBottom:14,
                padding:"12px 14px",
                borderRadius:8,
                background:integracionesStatus.whatsapp.ready ? "rgba(16,185,129,.08)" : "rgba(37,211,102,.08)",
                border:`1px solid ${integracionesStatus.whatsapp.ready ? "rgba(16,185,129,.24)" : "rgba(37,211,102,.24)"}`,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:integracionesStatus.whatsapp.ready ? "var(--green)" : "#16a34a"}}>
                      WhatsApp Business Cloud API: {integracionesStatus.whatsapp.ready ? "listo" : "preparado en simulacion"}
                    </div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:4,lineHeight:1.45}}>
                      {integracionesStatus.whatsapp.next_action || "Pendiente de credenciales Meta y plantillas aprobadas."}
                    </div>
                  </div>
                  <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:integracionesStatus.whatsapp.ready ? "var(--green)" : "#16a34a"}}>
                    {integracionesStatus.whatsapp.mode || "simulado"}
                  </span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
                  {[
                    ["Phone ID", integracionesStatus.whatsapp.phone_number_id_configured],
                    ["WABA", integracionesStatus.whatsapp.waba_id_configured],
                    ["Token", !!integracionesStatus.whatsapp.access_token_masked],
                  ].map(([label, ok]) => (
                    <div key={label}>
                      <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase"}}>{label}</div>
                      <div style={{fontSize:12,fontWeight:900,color:ok ? "var(--green)" : "#f59e0b"}}>{ok ? "OK" : "PEND."}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {integracionesStatus?.firma && (
              <div style={{
                marginBottom:14,
                padding:"12px 14px",
                borderRadius:8,
                background:integracionesStatus.firma.ready ? "rgba(16,185,129,.08)" : "rgba(245,158,11,.08)",
                border:`1px solid ${integracionesStatus.firma.ready ? "rgba(16,185,129,.24)" : "rgba(245,158,11,.24)"}`,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:integracionesStatus.firma.ready ? "var(--green)" : "#f59e0b"}}>
                      Firma electronica avanzada/eIDAS: {integracionesStatus.firma.ready ? "base preparada" : "pendiente"}
                    </div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>
                      {integracionesStatus.firma.production_ready ? "Preparado para produccion documental." : integracionesStatus.firma.siguiente_accion}
                    </div>
                  </div>
                  <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:integracionesStatus.firma.ready ? "var(--green)" : "#f59e0b"}}>
                    {integracionesStatus.firma.mode}
                  </span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {(integracionesStatus.firma.checks || []).map(check => (
                    <div key={check.key} style={{display:"flex",gap:7,alignItems:"flex-start",fontSize:11,color:"var(--text3)",lineHeight:1.35}}>
                      <span style={{fontWeight:900,color:check.ok ? "var(--green)" : check.required ? "#f59e0b" : "var(--text5)"}}>
                        {check.ok ? "OK" : check.required ? "PEND." : "REC."}
                      </span>
                      <span><strong style={{color:"var(--text2)"}}>{check.label}</strong><br/>{check.detail}</span>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:10,color:"var(--text5)",marginTop:8,lineHeight:1.45}}>
                  {integracionesStatus.firma.legal_note}
                </div>
              </div>
            )}
            {integracionesStatus?.edi_api && (
              <div style={{
                marginBottom:14,
                padding:"12px 14px",
                borderRadius:8,
                background:integracionesStatus.edi_api.ready ? "rgba(16,185,129,.08)" : "rgba(59,130,246,.08)",
                border:`1px solid ${integracionesStatus.edi_api.ready ? "rgba(16,185,129,.24)" : "rgba(59,130,246,.22)"}`,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:integracionesStatus.edi_api.ready ? "var(--green)" : "var(--accent)"}}>
                      EDI/API cliente B2B: {integracionesStatus.edi_api.ready ? "base preparada" : "preparatorio"}
                    </div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>
                      {integracionesStatus.edi_api.siguiente_accion || "Diagnostico de preparacion para integraciones con clientes grandes."}
                    </div>
                  </div>
                  <span style={{fontSize:15,fontWeight:900,fontFamily:"'JetBrains Mono',monospace",color:integracionesStatus.edi_api.ready ? "var(--green)" : "var(--accent)"}}>
                    {Number(integracionesStatus.edi_api.score || 0)}%
                  </span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {(integracionesStatus.edi_api.checks || []).map(check => (
                    <div key={check.key} style={{display:"flex",gap:7,alignItems:"flex-start",fontSize:11,color:"var(--text3)",lineHeight:1.35}}>
                      <span style={{fontWeight:900,color:check.ok ? "var(--green)" : check.required ? "#f59e0b" : "var(--text5)"}}>
                        {check.ok ? "OK" : check.required ? "PEND." : "REC."}
                      </span>
                      <span><strong style={{color:"var(--text2)"}}>{check.label}</strong><br/>{check.detail}</span>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:10,color:"var(--text5)",marginTop:8,lineHeight:1.45}}>
                  {integracionesStatus.edi_api.legal_note}
                </div>
                {integracionesStatus?.edi_feed && (
                  <div style={{borderTop:"1px solid rgba(59,130,246,.18)",marginTop:10,paddingTop:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",flexWrap:"wrap",marginBottom:8}}>
                      <div>
                        <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text4)"}}>
                          Uso real del feed cliente
                        </div>
                        <div style={{fontSize:11,color:"var(--text4)",marginTop:3,lineHeight:1.45}}>
                          {integracionesStatus.edi_feed.active
                            ? `Ultimo export: ${integracionesStatus.edi_feed.last_export_at ? new Date(integracionesStatus.edi_feed.last_export_at).toLocaleString("es-ES") : "sin fecha"}`
                            : "Sin exports registrados todavia."}
                        </div>
                      </div>
                      <span style={{fontSize:10,fontWeight:900,color:integracionesStatus.edi_feed.active ? "var(--green)" : "#f59e0b"}}>
                        {integracionesStatus.edi_feed.active ? "AUDITADO" : "SIN USO"}
                      </span>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:8}}>
                      {[
                        ["Exports", integracionesStatus.edi_feed.total_exports_sample],
                        ["Clientes", integracionesStatus.edi_feed.clientes_distintos_sample],
                        ["Viajes", integracionesStatus.edi_feed.shipments_exported_sample],
                        ["Facturas", integracionesStatus.edi_feed.invoices_exported_sample],
                      ].map(([label, value]) => (
                        <div key={label} style={{minWidth:0}}>
                          <div style={{fontSize:10,color:"var(--text5)",fontWeight:800,textTransform:"uppercase"}}>{label}</div>
                          <div style={{fontSize:14,fontWeight:900,color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace"}}>{Number(value || 0)}</div>
                        </div>
                      ))}
                    </div>
                    {!!integracionesStatus.edi_feed.last_integrity_hash_sha256 && (
                      <div style={{fontSize:10,color:"var(--text5)",marginTop:8,lineHeight:1.45,wordBreak:"break-all"}}>
                        Hash ultimo export: <strong style={{color:"var(--text3)"}}>{String(integracionesStatus.edi_feed.last_integrity_hash_sha256).slice(0, 20)}...</strong>
                      </div>
                    )}
                    {!!integracionesStatus.edi_feed.recent?.length && (
                      <div style={{display:"grid",gap:6,marginTop:8}}>
                        {integracionesStatus.edi_feed.recent.slice(0, 3).map(item => (
                          <div key={item.id || item.export_id} style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",fontSize:11,color:"var(--text4)",borderTop:"1px solid rgba(148,163,184,.12)",paddingTop:6}}>
                            <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {item.cliente_nombre || item.actor_email || "Cliente portal"} - {item.sync_mode === "delta" ? "delta" : `${item.window_days || 0} dias`}
                            </span>
                            <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:"var(--text3)",whiteSpace:"nowrap"}}>
                              {Number(item.shipments || 0)} v / {Number(item.invoices || 0)} f
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div style={S.grid3}>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text3)",fontWeight:700,padding:"8px 0"}}>
                <input type="checkbox" checked={!!empresa.documento_control?.habilitado} onChange={fdc("habilitado")} disabled={!esGerente}/>
                Activar documento digital
              </label>
              <div>
                <label style={S.lbl}>Sistema</label>
                <select value={empresa.documento_control?.sistema || "codigo_numerico"} onChange={fdc("sistema")} disabled={!esGerente} style={{ ...S.inp, background:esGerente ? "var(--bg4)":"var(--bg2)" }}>
                  <option value="codigo_numerico">Codigo numerico</option>
                  <option value="qr_url">QR con URL</option>
                </select>
              </div>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text3)",fontWeight:700,padding:"8px 0"}}>
                <input type="checkbox" checked={!!empresa.documento_control?.usar_orden_carga_como_soporte} onChange={fdc("usar_orden_carga_como_soporte")} disabled={!esGerente}/>
                Usar orden de carga como base
              </label>
              <div style={{gridColumn:"span 2"}}>
                <label style={S.lbl}>Dominio publico para QR</label>
                <input style={S.inp} value={empresa.documento_control?.dominio_url || ""} onChange={fdc("dominio_url")} placeholder="https://miempresa.transgest.app" disabled={!esGerente}/>
              </div>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text3)",fontWeight:700,padding:"8px 0"}}>
                <input type="checkbox" checked={!!empresa.documento_control?.dominio_comunicado} onChange={fdc("dominio_comunicado")} disabled={!esGerente}/>
                Dominio comunicado al Ministerio
              </label>
            </div>
            <div style={{marginTop:12}}>
              <label style={S.lbl}>Observaciones internas</label>
              <textarea style={{ ...S.inp, height:70, resize:"vertical" }} value={empresa.documento_control?.observaciones || ""} onChange={fdc("observaciones")} placeholder="Ej: mientras no este comunicado el dominio, usar codigo numerico." disabled={!esGerente}/>
            </div>
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Normativa rectificativas (AEAT)</div>
            <div style={{ fontSize:12, color:"var(--text3)", lineHeight:1.7 }}>
              <p style={{ marginBottom:8 }}>Según el <strong style={{ color:"var(--text2)" }}>Art. 15 RD 1619/2012</strong>, es <strong style={{ color:"#f97316" }}>obligatorio</strong> emitir factura rectificativa cuando:</p>
              <ul style={{ paddingLeft:18, color:"var(--text3)" }}>
                {[
                  "La factura original no cumpla algún requisito legal (arts. 6 y 7)",
                  "Las cuotas de IVA repercutidas se determinaron incorrectamente",
                  "Haya datos fiscales erróneos del cliente",
                  "El servicio no se prestó o se prestó parcialmente",
                  "Exista una devolución, descuento o bonificación posterior",
                ].map((item, i) => <li key={i} style={{ marginBottom:4 }}>{item}</li>)}
              </ul>
              <p style={{ marginTop:10, color:"var(--text4)" }}>
                <strong style={{ color:"#f97316" }}>No se puede anular</strong> una factura emitida - solo rectificar.<br/>
                La rectificativa debe emitirse en un plazo máximo de <strong style={{ color:"var(--text2)" }}>4 años</strong> desde el devengo del IVA.<br/>
                Debe llevar una serie específica (serie {empresa.serie_rectificativas||"R"}) y hacer referencia expresa a la factura original (número y fecha).
              </p>
            </div>
          </div>

          {esGerente && (
            <div style={{ display:"flex", gap:12, alignItems:"center" }}>
              <button style={{ ...S.btn, background:"var(--accent)", color:"#fff" }} onClick={guardarEmpresa}>
                Guardar configuración
              </button>
              {saved==="empresa" && <span style={S.saved}>✓ Guardado correctamente</span>}
            </div>
          )}
        </div>
      )}

      {/* ── Email / Notificaciones ── */}
      {tab==="email" && (
        <div>
          <div style={S.section}>
            <div style={S.secTitle}>Servidor SMTP</div>
            <div style={S.info}>
              Configura el servidor de correo saliente. Si usas Gmail activa "Acceso de aplicaciones poco seguras" o usa una contraseña de aplicación.
            </div>
            <div style={S.grid2}>
              <div>
                <label style={S.lbl}>Servidor SMTP (host)</label>
                <input style={S.inp} value={emailCfg.smtp_host} onChange={fc("smtp_host")} placeholder="smtp.gmail.com" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Puerto</label>
                <select value={emailCfg.smtp_port} onChange={fc("smtp_port")} disabled={!esGerente}
                  style={{ ...S.inp, background:esGerente ? "var(--bg4)":"var(--bg2)" }}>
                  <option value="587">587 - TLS (recomendado)</option>
                  <option value="465">465 - SSL</option>
                  <option value="25">25 - Sin cifrado</option>
                </select>
              </div>
              <div>
                <label style={S.lbl}>Usuario / Email remitente</label>
                <input type="email" style={S.inp} value={emailCfg.smtp_user} onChange={fc("smtp_user")} placeholder="facturas@empresa.com" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Contraseña / App password</label>
                <input type="password" style={S.inp} value={emailCfg.smtp_pass} onChange={fc("smtp_pass")} placeholder="••••••••••••" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Nombre remitente</label>
                <input style={S.inp} value={emailCfg.smtp_from_nombre} onChange={fc("smtp_from_nombre")} placeholder="TransGest TMS" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Email de respuesta (reply-to)</label>
                <input type="email" style={S.inp} value={emailCfg.smtp_from} onChange={fc("smtp_from")} placeholder="info@empresa.com" disabled={!esGerente}/>
              </div>
            </div>
            {esGerente && (
              <div style={{ display:"flex", gap:10, marginTop:14, alignItems:"center", flexWrap:"wrap" }}>
                <input type="email" style={{ ...S.inp, width:220 }} value={testEmail} onChange={e=>setTestEmail(e.target.value)} placeholder="email@prueba.com"/>
                <button style={{ ...S.btn, background:"var(--bg4)", color:"var(--text2)", border:"1px solid #1e2d45" }}
                  onClick={testSmtp} disabled={testing}>
                  {testing ? "Enviando..." : "Enviar email de prueba"}
                </button>
              </div>
            )}
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Buzon IA para pedidos automaticos</div>
            <div style={S.info}>
              Indica el correo operativo al que los clientes enviaran pedidos para que la Bandeja IA los convierta en solicitudes. Usa una cuenta de la empresa o un alias reenviado a ella.
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
              <input type="checkbox" id="ai_inbox_enabled" checked={!!emailCfg.ai_inbox_enabled} onChange={fc("ai_inbox_enabled")} disabled={!esGerente}
                style={{ width:16, height:16, accentColor:"var(--accent-l)" }}/>
              <label htmlFor="ai_inbox_enabled" style={{ fontSize:13, color:"var(--text2)", cursor:"pointer" }}>
                Activar recepcion de pedidos por correo IA
              </label>
            </div>
            <div>
              <label style={S.lbl}>Correo IA de pedidos</label>
              <input type="email" style={S.inp} value={emailCfg.ai_inbox_email || ""} onChange={fc("ai_inbox_email")} placeholder="pedidos@empresa.com" disabled={!esGerente}/>
              <div style={{ fontSize:10, color:"var(--text5)", marginTop:3 }}>
                La Bandeja IA usara este buzon como canal de entrada. Si no hay SMTP configurado, el sistema conserva la configuracion pero no podra enviar invitaciones ni avisos desde la empresa.
              </div>
            </div>
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Envío automático de facturas</div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
              <input type="checkbox" id="facturas_auto" checked={emailCfg.envio_facturas_auto} onChange={fc("envio_facturas_auto")} disabled={!esGerente}
                style={{ width:16, height:16, accentColor:"var(--accent-l)" }}/>
              <label htmlFor="facturas_auto" style={{ fontSize:13, color:"var(--text2)", cursor:"pointer" }}>
                Enviar factura automáticamente al email de facturación del cliente al emitirla
              </label>
            </div>
            <div style={{ fontSize:11, color:"var(--text5)", marginBottom:12 }}>
              Se enviará al campo "Email facturación" de la ficha del cliente. Si no tiene ese campo, no se enviará.
            </div>
            <div>
              <label style={S.lbl}>Asunto del email de factura</label>
              <input style={S.inp} value={emailCfg.asunto_factura} onChange={fc("asunto_factura")} disabled={!esGerente}
                placeholder="Factura {numero} - {empresa}"/>
              <div style={{ fontSize:10, color:"var(--text5)", marginTop:3 }}>Variables: {"{numero}"}, {"{empresa}"}, {"{cliente}"}, {"{fecha}"}, {"{total}"}</div>
            </div>
            <div>
              <label style={S.lbl}>Cuerpo del email de factura</label>
              <textarea style={{ ...S.inp, height:120, resize:"vertical", fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}
                value={emailCfg.cuerpo_factura} onChange={fc("cuerpo_factura")} disabled={!esGerente}/>
            </div>
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Avisos de carga al cliente</div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
              <input type="checkbox" id="avisos_auto" checked={emailCfg.envio_avisos_carga_auto} onChange={fc("envio_avisos_carga_auto")} disabled={!esGerente}
                style={{ width:16, height:16, accentColor:"var(--accent-l)" }}/>
              <label htmlFor="avisos_auto" style={{ fontSize:13, color:"var(--text2)", cursor:"pointer" }}>
                Enviar aviso de carga automáticamente al confirmar el pedido
              </label>
            </div>
            <div style={{ background:"rgba(249,115,22,.07)", border:"1px solid rgba(249,115,22,.15)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#9a6030", marginBottom:12 }}>
              <strong>WhatsApp:</strong> El envio por WhatsApp se hace desde Pedidos, con preflight y log auditado; si faltan credenciales de Meta se registra como simulacion.<br/>
              <strong>Email:</strong> Si el cliente tiene email de contacto, se enviará automáticamente cuando esté habilitado arriba.
            </div>
            <div>
              <label style={S.lbl}>Asunto del aviso de carga</label>
              <input style={S.inp} value={emailCfg.asunto_carga} onChange={fc("asunto_carga")} disabled={!esGerente}
                placeholder="Confirmación pedido {numero}"/>
              <div style={{ fontSize:10, color:"var(--text5)", marginTop:3 }}>Variables: {"{numero}"}, {"{cliente}"}, {"{origen}"}, {"{destino}"}, {"{fecha_carga}"}</div>
            </div>
            <div>
              <label style={S.lbl}>Cuerpo del aviso de carga</label>
              <textarea style={{ ...S.inp, height:130, resize:"vertical", fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}
                value={emailCfg.cuerpo_carga} onChange={fc("cuerpo_carga")} disabled={!esGerente}/>
            </div>
          </div>

          {esGerente && (
            <div style={{ display:"flex", gap:12, alignItems:"center" }}>
              <button style={{ ...S.btn, background:"var(--accent)", color:"#fff" }} onClick={guardarEmail}>
                Guardar configuración email
              </button>
              <button style={{ ...S.btn, background:"var(--bg4)", color:"var(--text2)", border:"1px solid #1e2d45" }} onClick={()=>getEmailLogBackend().then(rows=>setEmailLog(Array.isArray(rows) ? rows : [])).catch(e=>notify(e.message, "error"))}>
                Actualizar log
              </button>
              {saved==="email" && <span style={S.saved}>✓ Configuración guardada</span>}
            </div>
          )}
          <div style={{...S.section,marginTop:16}}>
            <div style={S.secTitle}>Ultimos envios</div>
            {emailLog.length === 0 ? (
              <div style={{fontSize:12,color:"var(--text5)"}}>Aun no hay envios registrados.</div>
            ) : (
              <div style={{display:"grid",gap:8}}>
                {emailLog.slice(0,8).map(item=>(
                  <div key={item.id} style={{display:"grid",gridTemplateColumns:"minmax(160px,1fr) minmax(180px,1.1fr) auto auto",gap:10,alignItems:"center",background:"var(--bg3)",border:"1px solid #141a28",borderRadius:8,padding:"8px 10px"}}>
                    <div>
                      <div style={{fontSize:12,fontWeight:800,color:"var(--text)"}}>{item.asunto || item.trigger || "Email"}</div>
                      <div style={{fontSize:10,color:"var(--text5)"}}>{item.sent_at ? new Date(item.sent_at).toLocaleString("es-ES") : "-"}</div>
                    </div>
                    <div style={{fontSize:12,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.destinatario || "-"}</div>
                    <span style={{fontSize:11,fontWeight:800,color:item.estado==="error"?"#ef4444":item.estado==="simulado"?"#f59e0b":"var(--green)"}}>{item.estado}</span>
                    <span style={{fontSize:11,color:"var(--text5)"}}>{Number(item.adjuntos_count || 0)} adj.</span>
                    {item.error && <div style={{gridColumn:"1/-1",fontSize:11,color:"#ef4444"}}>{item.error}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {tab==="whatsapp" && (
        <div>
          <div style={S.section}>
            <div style={S.secTitle}>WhatsApp Business Cloud API</div>
            <div style={S.info}>
              La integracion queda en modo simulacion hasta introducir credenciales reales de Meta. Los envios desde Pedidos se registran igualmente en el pedido y en el log.
            </div>
            <div style={{
              marginBottom:14,
              padding:"12px 14px",
              borderRadius:8,
              background:integracionesStatus?.whatsapp?.ready ? "rgba(16,185,129,.08)" : "rgba(245,158,11,.08)",
              border:`1px solid ${integracionesStatus?.whatsapp?.ready ? "rgba(16,185,129,.24)" : "rgba(245,158,11,.24)"}`,
            }}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:integracionesStatus?.whatsapp?.ready ? "var(--green)" : "#f59e0b"}}>
                    Estado: {integracionesStatus?.whatsapp?.ready ? "listo para Meta Cloud API" : "preparado en simulacion"}
                  </div>
                  <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>
                    {integracionesStatus?.whatsapp?.next_action || "Configura WABA ID, Phone Number ID, token permanente y plantillas aprobadas."}
                  </div>
                </div>
                <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:integracionesStatus?.whatsapp?.ready ? "var(--green)" : "#f59e0b"}}>
                  {integracionesStatus?.whatsapp?.mode || "simulado"}
                </span>
              </div>
            </div>
            <div style={S.grid2}>
              <div>
                <label style={S.lbl}>Phone Number ID</label>
                <input style={S.inp} value={whatsappCfg.phone_number_id || ""} onChange={fw("phone_number_id")} placeholder="123456789012345" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>WABA ID</label>
                <input style={S.inp} value={whatsappCfg.waba_id || ""} onChange={fw("waba_id")} placeholder="123456789012345" disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Access token permanente</label>
                <input type="password" style={S.inp} value={whatsappCfg.access_token || ""} onChange={fw("access_token")} placeholder={whatsappCfg.access_token_masked || "Pegar token de Meta"} disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>App secret</label>
                <input type="password" style={S.inp} value={whatsappCfg.app_secret || ""} onChange={fw("app_secret")} placeholder={whatsappCfg.app_secret_masked || "Opcional para validar firma webhook"} disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Verify token webhook</label>
                <input type="password" style={S.inp} value={whatsappCfg.verify_token || ""} onChange={fw("verify_token")} placeholder={whatsappCfg.verify_token_masked || "Token a poner en Meta"} disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>URL webhook publica</label>
                <input style={S.inp} value={`${window.location.origin.replace(/\/$/,"")}/api/v1/whatsapp/webhook`} readOnly/>
              </div>
            </div>
            <div style={{display:"flex",gap:18,alignItems:"center",flexWrap:"wrap",marginTop:14}}>
              <label style={{display:"flex",gap:8,alignItems:"center",fontSize:12,color:"var(--text3)"}}>
                <input type="checkbox" checked={whatsappCfg.activo !== false} onChange={fw("activo")} disabled={!esGerente} style={{accentColor:"var(--accent-l)"}}/>
                Integracion activa
              </label>
              <label style={{display:"flex",gap:8,alignItems:"center",fontSize:12,color:"var(--text3)"}}>
                <input type="checkbox" checked={whatsappCfg.simular_sin_credenciales !== false} onChange={fw("simular_sin_credenciales")} disabled={!esGerente} style={{accentColor:"var(--accent-l)"}}/>
                Simular si faltan credenciales
              </label>
            </div>
          </div>

          <div style={S.section}>
            <div style={S.secTitle}>Plantillas aprobadas en Meta</div>
            <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.55,marginBottom:12}}>
              Estos nombres deben coincidir con las plantillas aprobadas en WhatsApp Manager. Mientras no haya credenciales, sirven para dejar preparado el contrato de envio.
            </div>
            <div style={S.grid2}>
              <div>
                <label style={S.lbl}>Pedido cliente</label>
                <input style={S.inp} value={whatsappCfg.templates?.pedido_cliente || ""} onChange={fwt("pedido_cliente")} disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Orden colaborador</label>
                <input style={S.inp} value={whatsappCfg.templates?.orden_colaborador || ""} onChange={fwt("orden_colaborador")} disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Documentacion pendiente</label>
                <input style={S.inp} value={whatsappCfg.templates?.docs_pendientes || ""} onChange={fwt("docs_pendientes")} disabled={!esGerente}/>
              </div>
              <div>
                <label style={S.lbl}>Recordatorio entrega/albaran</label>
                <input style={S.inp} value={whatsappCfg.templates?.entrega_recordatorio || ""} onChange={fwt("entrega_recordatorio")} disabled={!esGerente}/>
              </div>
            </div>
          </div>

          {esGerente && (
            <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
              <button style={{...S.btn,background:"var(--accent)",color:"#fff",opacity:savingWhatsapp?0.65:1}} onClick={guardarWhatsapp} disabled={savingWhatsapp}>
                {savingWhatsapp ? "Guardando..." : "Guardar WhatsApp"}
              </button>
              <button style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",border:"1px solid #1e2d45"}} onClick={()=>getWhatsappLog().then(rows=>setWhatsappLog(Array.isArray(rows) ? rows : [])).catch(e=>notify(e.message, "error"))}>
                Actualizar log
              </button>
              {saved==="whatsapp" && <span style={S.saved}>Guardado correctamente</span>}
            </div>
          )}

          <div style={S.section}>
            <div style={S.secTitle}>Ultimos WhatsApp</div>
            {whatsappLog.length === 0 ? (
              <div style={{fontSize:12,color:"var(--text5)"}}>Aun no hay envios registrados.</div>
            ) : (
              <div style={{display:"grid",gap:8}}>
                {whatsappLog.slice(0,10).map(item=>(
                  <div key={item.id} style={{display:"grid",gridTemplateColumns:"minmax(150px,1fr) minmax(130px,.8fr) auto",gap:10,alignItems:"center",background:"var(--bg3)",border:"1px solid #141a28",borderRadius:8,padding:"8px 10px"}}>
                    <div>
                      <div style={{fontSize:12,fontWeight:800,color:"var(--text)"}}>{item.template_name || item.destinatario_tipo || "WhatsApp"}</div>
                      <div style={{fontSize:10,color:"var(--text5)"}}>{item.sent_at ? new Date(item.sent_at).toLocaleString("es-ES") : "-"}</div>
                    </div>
                    <div style={{fontSize:12,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.destinatario || "-"}</div>
                    <span style={{fontSize:11,fontWeight:800,color:item.estado==="error"?"#ef4444":item.estado==="simulado"?"#f59e0b":"var(--green)"}}>{item.estado}</span>
                    {item.error && <div style={{gridColumn:"1/-1",fontSize:11,color:"#ef4444"}}>{item.error}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {tab==="avisos_cfg" && (
        <div style={{...S.card,marginTop:0}}>
          <div style={{fontSize:13,color:"var(--text3)",marginBottom:16,background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.15)",borderRadius:8,padding:"9px 14px"}}>
            Configura alertas personalizadas que aparecerán en el Dashboard. Puedes activar o desactivar cada una y ajustar los umbrales de aviso.
          </div>
          {esGerente && (
            <button style={{...S.btn,background:"var(--accent)",color:"#fff",marginBottom:14}} onClick={()=>{setEditAviso(null);setModalAviso(true);}}>
              + Nuevo aviso personalizado
            </button>
          )}
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Tipo de aviso","Descripción","Días de antelación","Activo",""].map(h=>(
              <th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--text5)",borderBottom:"1px solid var(--border)"}}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {avisosCfg.length===0 ? (
                <tr><td colSpan={5} style={{padding:"20px 12px",textAlign:"center",color:"var(--text5)",fontSize:12}}>Sin avisos configurados. A?ade el primero para personalizar las alertas del sistema.</td></tr>
                ) : avisosCfg.map((a,i)=>(
                  <tr key={a.id}>
                    <td style={{padding:"9px 12px",fontWeight:700,color:"var(--text)",fontSize:13,borderBottom:"1px solid var(--border)"}}>{a.tipo}</td>
                    <td style={{padding:"9px 12px",fontSize:12,color:"var(--text4)",borderBottom:"1px solid var(--border)"}}>{a.descripcion||"-"}</td>
                    <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,borderBottom:"1px solid var(--border)"}}>{a.dias_antelacion||30} días</td>
                    <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border)"}}>
                      <span style={{padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,
                        background:a.activo!==false ? "rgba(16,185,129,.1)" : "rgba(107,114,128,.1)",
                        color:a.activo!==false ? "var(--green)" : "var(--text5)"}}>
                        {a.activo!==false ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td style={{padding:"9px 12px",borderBottom:"1px solid var(--border)"}}>
                      {esGerente && <div style={{display:"flex",gap:5}}>
                        <button onClick={()=>{setEditAviso(a);setModalAviso(true);}} style={{padding:"3px 8px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text2)",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>Editar</button>
                        <button onClick={async()=>{if(await confirmDialog({title:"Eliminar aviso",message:"Eliminar este aviso?",confirmText:"Eliminar",tone:"danger"})){const d=avisosCfg.filter(x=>x.id!==a.id);setAvisosCfg(d);try{await setConfigAlertas(d);}catch(e){notify(e.message, "error");}}}} style={{padding:"3px 8px",borderRadius:6,border:"none",background:"rgba(239,68,68,.1)",color:"var(--red)",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>✕</button>
                      </div>}
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          {/* Default alerts info */}
          <div style={{marginTop:16,padding:"10px 14px",background:"rgba(59,130,246,.05)",borderRadius:8,fontSize:11,color:"var(--text5)"}}>
            Los siguientes avisos están siempre activos por defecto y no requieren configuración: ITV vehículos, Seguro vehículos, CAP chóferes, carnet de conducir, reconocimiento médico, stock bajo mínimo en taller.
          </div>
        </div>
      )}

      {/* Modal aviso personalizado */}
      {tab==="trafico_cfg" && (
        <div style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:11,padding:22}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,color:"var(--text)",marginBottom:16}}>Configuración Cuadrante de Tráfico</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
            <div><label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:10}}>Velocidad media camión (km/h)</label>
              <input type="number" style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,width:"100%",boxSizing:"border-box",fontFamily:"'DM Sans',sans-serif",fontSize:13}}
                value={cfgTrafico.velocidad_media||80} onChange={e=>setCfgTrafico(p=>({...p,velocidad_media:Number(e.target.value)}))}/>
              <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Por defecto: 80 km/h</div>
              <div style={{marginTop:8,padding:"9px 11px",background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.15)",borderRadius:8,fontSize:11,color:"var(--text3)",lineHeight:1.45}}>
                Ejemplo: Madrid->Barcelona (620 km) = 620÷80 = 7,75h + 1 pausa de 45min = <strong>8h 30min</strong> de tránsito
              </div>
            </div>
            <div><label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:10}}>Tiempo descarga (minutos)</label>
              <input type="number" style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,width:"100%",boxSizing:"border-box",fontFamily:"'DM Sans',sans-serif",fontSize:13}}
                value={cfgTrafico.tiempo_descarga||60} onChange={e=>setCfgTrafico(p=>({...p,tiempo_descarga:Number(e.target.value)}))}/>
              <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Por defecto: 60 min (1 hora)</div>
            </div>
            <div><label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:10}}>Pausa obligatoria cada (horas)</label>
              <input type="number" step="0.5" style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,width:"100%",boxSizing:"border-box",fontFamily:"'DM Sans',sans-serif",fontSize:13}}
                value={cfgTrafico.horas_pausa||4.5} onChange={e=>setCfgTrafico(p=>({...p,horas_pausa:Number(e.target.value)}))}/>
              <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Por defecto: 4,5 h (normativa)</div>
            </div>
            <div><label style={{display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:10}}>Duración pausa (minutos)</label>
              <input type="number" style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,width:"100%",boxSizing:"border-box",fontFamily:"'DM Sans',sans-serif",fontSize:13}}
                value={cfgTrafico.min_pausa||45} onChange={e=>setCfgTrafico(p=>({...p,min_pausa:Number(e.target.value)}))}/>
              <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Por defecto: 45 min</div>
            </div>
          </div>
          <div style={{marginTop:18,padding:"14px 16px",borderRadius:10,border:"1px solid var(--border2)",background:"var(--bg4)"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:10}}>
              <div>
                <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>Paises operativos</div>
                <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>Solo los paises activados apareceran en los puntos de carga y descarga de Pedidos.</div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button type="button" onClick={()=>setCfgTrafico(p=>({...p,paises_trabajo:["EspaÃ±a"]}))} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text4)",fontSize:11,fontWeight:800,cursor:"pointer"}}>Solo Espana</button>
                <button type="button" onClick={()=>setCfgTrafico(p=>({...p,paises_trabajo:EUROPE_COUNTRIES}))} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--accent)",fontSize:11,fontWeight:800,cursor:"pointer"}}>Activar Europa</button>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:7,maxHeight:260,overflowY:"auto",paddingRight:4}}>
              {EUROPE_COUNTRIES.map(country => {
                const selected = getEnabledEuropeCountries({cfg_trafico:cfgTrafico}).includes(country);
                return (
                  <label key={country} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 9px",borderRadius:8,border:`1px solid ${selected ? "rgba(20,184,166,.36)" : "var(--border2)"}`,background:selected ? "rgba(20,184,166,.08)" : "var(--bg3)",fontSize:12,color:"var(--text)",cursor:"pointer"}}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={e=>setCfgTrafico(prev=>{
                        const current = getEnabledEuropeCountries({cfg_trafico:prev});
                        const canonical = canonicalCountry(country);
                        const next = e.target.checked
                          ? Array.from(new Set([...current, canonical]))
                          : current.filter(x => x !== canonical);
                        return {...prev,paises_trabajo:next.length ? next : ["EspaÃ±a"]};
                      })}
                      style={{accentColor:"var(--accent)"}}
                    />
                    <span>{country}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <label style={{display:"flex",alignItems:"flex-start",gap:10,marginTop:16,padding:"12px 14px",borderRadius:9,border:"1px solid rgba(239,68,68,.24)",background:(cfgTrafico.requerir_motivo_cancelacion !== false && cfgTrafico.requiere_motivo_cancelacion !== false)?"rgba(239,68,68,.07)":"var(--bg4)",cursor:"pointer"}}>
            <input
              type="checkbox"
              checked={cfgTrafico.requerir_motivo_cancelacion !== false && cfgTrafico.requiere_motivo_cancelacion !== false}
              onChange={e=>setCfgTrafico(p=>({...p,requerir_motivo_cancelacion:e.target.checked}))}
              style={{marginTop:2,accentColor:"#ef4444"}}
            />
            <span>
              <span style={{display:"block",fontSize:13,fontWeight:900,color:"var(--text)"}}>Exigir motivo al cancelar viajes</span>
              <span style={{display:"block",fontSize:11,color:"var(--text4)",marginTop:2}}>Si esta activo, el menu contextual de pedidos pedira un motivo y lo guardara en el viaje y en el historial.</span>
            </span>
          </label>
          <button onClick={guardarTrafico} style={{marginTop:14,padding:"7px 18px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            Guardar configuración
          </button>
          {saved==="trafico" && <span style={{marginLeft:10,fontSize:12,color:"var(--green)"}}>Guardado</span>}
        </div>
      )}

      {modalAviso && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&setModalAviso(false)}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:22,width:"min(480px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,color:"var(--text)",marginBottom:14}}>{editAviso ? "Editar aviso" : "Nuevo aviso personalizado"}</div>
            <AvisoCfgForm
              editando={editAviso}
              tipos={TIPOS_AVISO}
              avisosCfg={avisosCfg}
              onClose={()=>{
                setModalAviso(false);
                setEditAviso(null);
              }}
              onSave={async (nuevoListado)=>{
                await setConfigAlertas(nuevoListado);
                setAvisosCfg(nuevoListado);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AvisoCfgForm({editando,tipos,avisosCfg,onClose,onSave}){
  const [form,setForm]=useState(editando||{tipo:"Factura vencida sin cobrar",descripcion:"",dias_antelacion:30,activo:true});
  const [guardando,setGuardando]=useState(false);
  const f=k=>e=>setForm(p=>({...p,[k]:e.target.type==="checkbox" ? e.target.checked : e.target.value}));
  async function guardar(){
    if (guardando) return;
    const d=Array.isArray(avisosCfg) ? [...avisosCfg] : [];
    const p={...form,id:editando?.id||`ae_${Date.now()}`,dias_antelacion:parseInt(form.dias_antelacion)||30};
    if(editando){const i=d.findIndex(x=>x.id===editando.id);if(i>=0)d[i]=p;else d.push(p);}else d.push(p);
    setGuardando(true);
    try {
      await onSave(d);
      onClose();
    } catch(e) {
      notify(e.message || "No se pudo guardar el aviso", "error");
    } finally {
      setGuardando(false);
    }
  }
  const inp={background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl={display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10};
  return(
    <div>
      <label style={lbl}>Tipo de aviso *</label>
      <select style={inp} value={form.tipo} onChange={f("tipo")}>{tipos.map(t=><option key={t}>{t}</option>)}</select>
      <label style={lbl}>Descripción / detalle</label>
      <input style={inp} value={form.descripcion} onChange={f("descripcion")} placeholder="Ej: Avisar cuando queden 15 días para el vencimiento..."/>
      <label style={lbl}>Días de antelación para activar el aviso</label>
      <input type="number" min="1" style={inp} value={form.dias_antelacion} onChange={f("dias_antelacion")}/>
      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:12}}>
        <input type="checkbox" id="ae_activo" checked={form.activo!==false} onChange={f("activo")} style={{width:15,height:15,accentColor:"var(--green)"}}/>
        <label htmlFor="ae_activo" style={{fontSize:13,color:"var(--text2)",cursor:"pointer"}}>Aviso activo</label>
      </div>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <button onClick={onClose} disabled={guardando} style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:guardando ? "not-allowed" : "pointer",opacity:guardando ? 0.65 : 1}}>Cancelar</button>
        <button onClick={guardar} style={{padding:"7px 14px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>Guardar</button>
      </div>
    </div>
  );
}
