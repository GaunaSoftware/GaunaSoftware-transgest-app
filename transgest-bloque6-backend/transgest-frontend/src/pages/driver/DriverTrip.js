import DriverTripCard from './DriverTripCard';
import DriverDcdActions from './DriverDcdActions';
import DriverTripMap from './DriverTripMap';
import { openMobileDocument, shareMobileDocument } from '../../services/mobileRuntime';
import { restoreDriverSteps } from './driverSupport';
import { useState, useEffect, useCallback } from "react";
import { getPedidos, cambiarEstadoPedido, guardarFirmaEntrega, actualizarGpsPedido, getPedidoDocumentoControl, registrarPedidoDocumentoControlEvento, getPedidoChoferPasos, guardarPedidoChoferPasos, getChoferPedidoDocs, verArchivoProtegido } from "../../services/api";

import { buildTransportDocumentLine as adrDocLine, calcExencion1136 as adrExencion, adrRequisitos } from "../../utils/adr";
import { confirmDialog, notify } from "../../services/notify";





import { normalizeChoferPasos, esViajeCisterna, leerPasosViaje, guardarPasosViaje, createDriverOfflineActions, esErrorOffline, capturarUbicacionActual, FirmaCanvas, ModalIncidencia, EscanerAlbaran, segundosDesdeIso, fmtDuracionSegundos, EC, PROTOCOLO_CISTERNA } from "./driverSupport";
function TarjetaViaje({ pedido, onActualizar, jornadaInfo, onAbrirJornada, expanded = false, onExpandedChange, onFoto, featured = false }){
  const [{encolarOffline, queueOfflineCriticalAction}] = useState(createDriverOfflineActions);
  const [firmando,     setFirmando]     = useState(false);
  const [incidencia,   setIncidencia]   = useState(false);
  const [incidenciaFase,setIncidenciaFase]=useState("ruta");
  const [loading,      setLoading]      = useState(false);
  const [proximaCarga, setProximaCarga] = useState(null);
  const kmActuales = ""; // Odometer entry belongs to the workday. Preserve historical trip readings.
  const [pasos,        setPasos]        = useState({});
  const [tick,         setTick]         = useState(0);
  const [docControl,   setDocControl]   = useState(null);
  const [docControlLoading, setDocControlLoading] = useState(false);
  const [choferDocs,   setChoferDocs]   = useState([]);
  const [qrVisible, setQrVisible] = useState(false);
  const [firmandoCargador, setFirmandoCargador] = useState(false);
  const [mercanciaCarga, setMercanciaCarga] = useState({
    mercancia: pedido.mercancia || pedido.descripcion_carga || "",
    palets: pedido.bultos || "",
    peso_kg: pedido.peso_kg || "",
    referencia: pedido.referencia_cliente || "",
  });
  const e = EC[pedido.estado]||EC.pendiente;

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const local = leerPasosViaje(pedido.id);
    setPasos({});
    getPedidoChoferPasos(pedido.id)
      .then((payload) => {
        if (!alive) return;
        const remote = normalizeChoferPasos(payload?.data || payload || {});
        if (Object.keys(remote).length) {
          setPasos(guardarPasosViaje(pedido.id, remote));
          return;
        }
        setPasos(local);
      })
      .catch(() => {
        if (!alive) return;
        setPasos(local);
      });
    return () => { alive = false; };
  }, [pedido.id]);

  useEffect(() => {
    let alive = true;
    getChoferPedidoDocs(pedido.id)
      .then(d => { if (alive) setChoferDocs(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setChoferDocs([]); });
    return () => { alive = false; };
  }, [pedido.id]);

  async function verChoferDoc(doc) {
    try {
      await verArchivoProtegido(`/pedidos/${pedido.id}/chofer-docs/${encodeURIComponent(doc.id)}/archivo`, doc.nombre || "documento");
    } catch (err) {
      notify(err.message || "No se pudo abrir el documento.", "error");
    }
  }

  const cargarDocumentoControl = useCallback(async () => {
    setDocControlLoading(true);
    try {
      const data = await getPedidoDocumentoControl(pedido.id);
      setDocControl(data || null);
      return data || null;
    } catch {
      setDocControl(null);
      return null;
    } finally {
      setDocControlLoading(false);
    }
  }, [pedido.id]);

  useEffect(() => {
    let alive = true;
    if (!expanded) return undefined;
    cargarDocumentoControl().then(data => { if (!alive) return; if (data) setDocControl(data); });
    return () => { alive = false; };
  }, [expanded, cargarDocumentoControl]);

  const docControlSupportUrl = docControl?.documento?.soporte_url || docControl?.soporte_url || "";
  const dcd = docControl?.documento || null;
  const dcdHorarios = dcd?.horarios || {};
  const dcdCargas = Array.isArray(dcd?.cargas) ? dcd.cargas : [];
  const dcdDescargas = Array.isArray(dcd?.descargas) ? dcd.descargas : [];
  const dcdReady = !!docControl?.status?.ready;
  const dcdRevisado = !!pasos.dcd_revisado;
  const dcdDisponible = !!pasos.dcd_disponible || !!pasos.dcd_revisado;
  const dcdOperativoOk = dcdReady && dcdRevisado && dcdDisponible;
  const requiereProtocoloCisterna = esViajeCisterna(pedido);
  const protocoloCisternaCompletado = !requiereProtocoloCisterna || PROTOCOLO_CISTERNA.every(step => pasos[step.key]);
  const protocoloCisternaPendientes = PROTOCOLO_CISTERNA.filter(step => !pasos[step.key]);
  const fmtDcdFecha = (v) => v ? new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString("es-ES") : "-";
  const fmtDcdHora = (hora, ventana) => hora || ventana || "-";
  const registrarDcdEvento = useCallback((action) => {
    if (!pedido?.id) return;
    registrarPedidoDocumentoControlEvento(pedido.id, { action, source:"app_chofer" }).catch(() => {});
  }, [pedido?.id]);

  function abrirDocumentoControl(printMode = false) {
    if (!docControlSupportUrl) return;
    const url = printMode
      ? `${docControlSupportUrl}${docControlSupportUrl.includes("?") ? "&" : "?"}print=1`
      : docControlSupportUrl;
    registrarDcdEvento(printMode ? "impreso" : "abierto");
    openMobileDocument(url).catch(error=>notify(error.message,"error"));
  }

  async function verQrDocumentoControl() {
    const data = docControl || await cargarDocumentoControl();
    if (!data?.qr?.data_url && !data?.qr?.url && !data?.documento?.soporte_url) {
      notify("No se pudo preparar el QR del DCD.", "warning");
      return;
    }
    setDocControl(data);
    registrarDcdEvento("qr_mostrado");
    setQrVisible(true);
  }

  function descargarDocumentoControl() {
    const url = docControl?.remision?.download_url || (docControlSupportUrl ? `${docControlSupportUrl}${docControlSupportUrl.includes("?") ? "&" : "?"}download=1` : "");
    if (!url) return;
    registrarDcdEvento("descargado");
    registrarDcdEvento("disponible");
    persistirPasos({ dcd_disponible:true, dcd_disponible_at:new Date().toISOString() }, { silent:true }).catch(() => {});
    openMobileDocument(url).catch(error=>notify(error.message,"error"));
  }

  async function compartirDocumentoControl() {
    if (!docControlSupportUrl) return;
    const shareData = {
      title: `Documento de control ${pedido.numero || ""}`.trim(),
      text: `Documento de control del viaje ${pedido.numero || ""}`.trim(),
      url: docControlSupportUrl,
    };
    try {
      const result=await shareMobileDocument(shareData);
      registrarDcdEvento(result?.copied ? "copiado" : "compartido");
      if(result?.copied) notify("Enlace del documento digital copiado");
    } catch {
      notify("No se pudo compartir el documento digital", "error");
    }
  }

  async function marcarDcdRevisado() {
    const data = docControl || await cargarDocumentoControl();
    if (!data?.documento) {
      notify("No se pudo cargar el DCD. Revisa la conexión o avisa a tráfico.", "warning");
      return;
    }
    if (!data?.status?.ready) {
      notify("El DCD aun tiene datos pendientes. Puedes consultarlo, pero tráfico debe completarlo.", "warning");
    }
    registrarDcdEvento("consultado");
    registrarDcdEvento("revisado");
    await persistirPasos({
      dcd_revisado:true,
      dcd_disponible:true,
      dcd_revisado_at:new Date().toISOString(),
      dcd_disponible_at:new Date().toISOString(),
    }, { silent:true });
    notify("DCD revisado y marcado como disponible.", "success");
  }

  async function confirmarDcdAntesDeSalir() {
    const data = docControl || await cargarDocumentoControl();
    if (!data?.documento) {
      const ok = await confirmDialog({
        title: "DCD no disponible",
        message: "No se ha podido cargar el documento de control digital. Puedes continuar para no bloquear la operativa, pero quedara pendiente para tráfico.",
        confirmText: "Continuar igualmente",
        cancelText: "Revisar",
        tone: "warning",
      });
      return ok;
    }
    if (pasos.dcd_revisado && pasos.dcd_disponible && data?.status?.ready) return true;
    const ok = await confirmDialog({
      title: data?.status?.ready ? "Confirmar DCD" : "DCD con datos pendientes",
      message: data?.status?.ready
        ? "Antes de salir, confirma que has revisado el DCD y lo llevas disponible en el móvil o impreso."
        : "El DCD esta pendiente de revisión interna. Puedes continuar con aviso, pero informa a tráfico si necesitas el soporte definitivo.",
      confirmText: data?.status?.ready ? "Lo llevo revisado" : "Continuar con aviso",
      cancelText: "Volver",
      tone: data?.status?.ready ? "success" : "warning",
    });
    if (!ok) return false;
    registrarDcdEvento("revisado");
    await persistirPasos({
      dcd_revisado:true,
      dcd_disponible:true,
      dcd_revisado_at:new Date().toISOString(),
      dcd_disponible_at:new Date().toISOString(),
    }, { silent:true });
    return true;
  }

  async function persistirPasos(patch, { silent = false } = {}) {
    const normalized = normalizeChoferPasos(patch);
    const previous = leerPasosViaje(pedido.id);
    const optimistic = guardarPasosViaje(pedido.id, normalized);
    setPasos(optimistic);
    try {
      const saved = await guardarPedidoChoferPasos(pedido.id, normalized);
      const remote = normalizeChoferPasos(saved?.data || saved || {});
      if (Object.keys(remote).length) {
        setPasos(guardarPasosViaje(pedido.id, remote));
      }
      return remote;
    } catch (err) {
      if(!esErrorOffline(err)) { restoreDriverSteps(pedido.id,previous); setPasos(previous); notify(err.message || "No se pudo guardar el paso.","error"); throw err; }
      const queued = encolarOffline({
        tipo: "pedido_chofer_pasos",
        pedido_id: pedido.id,
        patch: normalized,
        dedupe_key: `pedido_chofer_pasos:${pedido.id}:${Object.keys(normalized).sort().join(",")}`,
        fecha: new Date().toISOString(),
      });
      if (!silent) notify("Guardado pendiente de sincronizar", "warning");
      return { ...optimistic, offline_queue: queued.length };
    }
  }

  function kmLectura() {
    if (!String(kmActuales).trim()) return null;
    const n = Number(kmActuales);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null;
  }

  function patchKmParaPaso(key) {
    const km = kmLectura();
    if (km == null) return {};
    if (key === "carga_iniciada" || key === "carga_ok") return { km_carga: km };
    if (key === "descarga_iniciada" || key === "descarga_ok" || key === "firma_entrega") return { km_descarga: km };
    return {};
  }

  async function marcarPaso(key, value=true) {
    if(!jornadaInfo?.jornada) {notify("Abre jornada antes de continuar el viaje.","warning");onAbrirJornada?.();throw new Error("Jornada cerrada");}
    const patch = { [key]: value, [`${key}_at`]: new Date().toISOString(), ...patchKmParaPaso(key) };
    return persistirPasos(patch, { silent: true });
  }

  async function albaranSubido(key) {
    await marcarPaso(key);
    const fresh = await cargarDocumentoControl().catch(() => null);
    if (fresh) setDocControl(fresh);
    onActualizar();
  }

  async function confirmarDatosMercanciaCarga() {
    const mercancia = String(mercanciaCarga.mercancia || "").trim();
    const palets = String(mercanciaCarga.palets || "").trim();
    const peso = String(mercanciaCarga.peso_kg || "").trim();
    if (!mercancia || !palets || !peso) {
      notify("Indica mercancía, palets/bultos y peso antes de cerrar la carga.", "warning");
      return;
    }
    const pesoNum = Number(String(peso).replace(",", "."));
    if (!Number.isFinite(pesoNum) || pesoNum <= 0) {
      notify("El peso debe ser un número válido.", "warning");
      return;
    }
    await persistirPasos({
      mercancia_confirmada: true,
      mercancia_confirmada_at: new Date().toISOString(),
      mercancia_cargada: mercancia,
      mercancia_palets: palets,
      mercancia_peso_kg: String(pesoNum),
      mercancia_referencia: String(mercanciaCarga.referencia || "").trim(),
    }, { silent: true });
    const fresh = await cargarDocumentoControl().catch(() => null);
    if (fresh) setDocControl(fresh);
    notify("Datos de mercancía guardados.", "success");
    onActualizar();
  }

  async function registrarFirmaCargador(dataURL, firmaNombre) {
    const firmaPayload = {
      rol: "cargador",
      firma_destinatario: dataURL,
      firma_nombre: firmaNombre || "Remitente",
      source: "app_chofer_carga",
    };
    try {
      await guardarFirmaEntrega(pedido.id, firmaPayload);
      await persistirPasos({ firma_cargador:true, firma_cargador_at:new Date().toISOString() }, { silent:true });
      const fresh = await cargarDocumentoControl().catch(() => null);
      if (fresh) setDocControl(fresh);
      setFirmandoCargador(false);
      notify("Firma del remitente registrada en el DCD.", "success");
      onActualizar();
    } catch(err) {
      if (esErrorOffline(err)) {
        queueOfflineCriticalAction({
          tipo: "pedido_firma",
          pedido_id: pedido.id,
          body: firmaPayload,
          dedupe_key: `pedido_firma:${pedido.id}:cargador:${Date.now()}`,
          fecha: new Date().toISOString(),
        }, "Firma del remitente guardada para sincronizar");
        await persistirPasos({ firma_cargador:true, firma_cargador_at:new Date().toISOString() }, { silent:true });
        setFirmandoCargador(false);
        onActualizar();
        return;
      }
      notify(err.message || "No se pudo registrar la firma del remitente.", "error");
    }
  }

  const timerActual = (() => {
    void tick;
    if (pasos.carga_iniciada && !pasos.carga_proceso) {
      const seconds = segundosDesdeIso(pasos.carga_iniciada_at);
      return { fase:"espera_carga", label:"Espera para iniciar carga", seconds, mins:Math.floor(seconds / 60), alertKey:"aviso_espera_carga" };
    }
    if (pasos.carga_proceso && !pasos.carga_ok) {
      const seconds = segundosDesdeIso(pasos.carga_proceso_at);
      const totalSeconds = segundosDesdeIso(pasos.carga_iniciada_at);
      return { fase:"carga", label:"Carga en curso", seconds, totalSeconds, mins:Math.floor(seconds / 60), total:Math.floor(totalSeconds / 60), alertKey:"aviso_espera_carga" };
    }
    if (pasos.posicionado_descarga && !pasos.descarga_iniciada) {
      const seconds = segundosDesdeIso(pasos.posicionado_descarga_at);
      return { fase:"espera_descarga", label:"Espera para iniciar descarga", seconds, mins:Math.floor(seconds / 60), alertKey:"aviso_espera_descarga" };
    }
    if (pasos.descarga_iniciada && !pasos.descarga_ok) {
      const seconds = segundosDesdeIso(pasos.descarga_iniciada_at);
      const totalSeconds = segundosDesdeIso(pasos.posicionado_descarga_at);
      return { fase:"descarga", label:"Descarga en curso", seconds, totalSeconds, mins:Math.floor(seconds / 60), total:Math.floor(totalSeconds / 60), alertKey:"aviso_espera_descarga" };
    }
    return null;
  })();

  useEffect(() => {
    if (!timerActual || timerActual.mins <= 60 || pasos[timerActual.alertKey]) return;
    persistirPasos({ [timerActual.alertKey]: true, [`${timerActual.alertKey}_at`]: new Date().toISOString() }, { silent: true })
      .then(() => notify("Aviso enviado a tráfico y gerencia por superar 60 minutos.", "warning"))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerActual?.fase, timerActual?.mins, timerActual?.alertKey, pasos.aviso_espera_carga, pasos.aviso_espera_descarga]);

  async function iniciarPosicionCarga() {
    if (!jornadaInfo?.jornada) {
      notify("Abre jornada antes de iniciar el posicionamiento a carga.", "warning");
      onAbrirJornada?.();
      return;
    }
    if (!(await confirmarDcdAntesDeSalir())) return;
    setLoading(true);
    try {
      const location = await capturarUbicacionActual();
      if (!location) notify("No se pudo capturar la ubicación de carga. Puedes continuar, queda pendiente para tráfico.", "warning");
      if (!["en_curso","descarga","entregado"].includes(pedido.estado)) await cambiarEstadoPedido(pedido.id, "en_curso");
      await persistirPasos({
        carga_iniciada:true,
        carga_iniciada_at:new Date().toISOString(),
        ...(location ? { carga_ubicacion: location } : {}),
        ...patchKmParaPaso("carga_iniciada"),
      }, { silent:true });
      onActualizar();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function iniciarCarga() {
    if (!pasos.carga_iniciada) {
      notify("Primero marca posicionado en carga.", "warning");
      return;
    }
    if (requiereProtocoloCisterna && !protocoloCisternaCompletado) {
      notify("Completa el protocolo de seguridad de cisterna antes de iniciar la carga.", "warning");
      return;
    }
    await marcarPaso("carga_proceso");
    notify("Carga iniciada. El contador de carga empieza ahora.", "success");
  }

  async function finalizarCarga() {
    if (!pasos.carga_proceso) {
      notify("Primero inicia la carga.", "warning");
      return;
    }
    if (!pasos.mercancia_confirmada || !pasos.albaran_carga || !pasos.firma_cargador) {
      notify("Antes de finalizar la carga debes confirmar mercancía, adjuntar albarán y registrar la firma del remitente.", "warning");
      return;
    }
    await marcarPaso("carga_ok");
    notify("Carga finalizada con mercancía, albarán y firma registrados.", "success");
    onActualizar();
  }

  async function iniciarViaje() {
    if(!jornadaInfo?.jornada) {notify("Abre jornada antes de iniciar el viaje.","warning");onAbrirJornada?.();return;}
    if (!pasos.albaran_carga) {
      notify("Sube el albarán de carga antes de iniciar el viaje.", "warning");
      return;
    }
    if (!(await confirmarDcdAntesDeSalir())) return;
    setLoading(true);
    try {
      await cambiarEstadoPedido(pedido.id, "en_curso");
      await marcarPaso("viaje_iniciado");
      notify("Viaje iniciado hacia descarga.", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoading(false);
    }
    onActualizar();
  }

  async function posicionarDescarga() {
    if (!pasos.carga_ok) {
      notify("Primero finaliza la carga.", "warning");
      return;
    }
    await marcarPaso("posicionado_descarga");
    notify("Posicionamiento para descarga registrado.", "success");
  }

  async function iniciarDescarga() {
    if (!pasos.posicionado_descarga) {
      notify("Marca antes el posicionamiento para descarga.", "warning");
      return;
    }
    setLoading(true);
    try {
      await cambiarEstadoPedido(pedido.id, "descarga");
      await marcarPaso("descarga_iniciada");
      onActualizar();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function finalizarDescarga() {
    if (!pasos.descarga_iniciada) {
      notify("Primero marca descarga iniciada.", "warning");
      return;
    }
    await marcarPaso("descarga_ok");
    notify("Descarga finalizada. Sube el albarán de descarga para poder firmar.", "success");
  }

  function siguientePaso() {
    if (!pasos.carga_iniciada) {
      return { label:"Posicionado en carga", help:"Registra que ya estas en el punto de carga. Desde aquí empieza la espera.", run: iniciarPosicionCarga, color:"#3b82f6" };
    }
    if (!pasos.carga_proceso) return { label:"Iniciar carga", help:"Empieza el contador real de carga y reinicia el temporizador visual del chófer.", run: iniciarCarga, color:"#f59e0b" };
    if (!pasos.mercancia_confirmada) return { type:"mercancia_carga", label:"Confirmar mercancía cargada", help:"Antes de firmar la carga, introduce mercancía, palets/bultos, peso y referencia si procede." };
    if (!pasos.albaran_carga) return { type:"albaran_carga", label:"Subir albarán de carga", help:"Adjunta el albarán de carga para incorporarlo al DCD." };
    if (!pasos.firma_cargador) return { label:"Firma del remitente", help:"El remitente/cargador firma la carga y la firma aparece en el bloque Sender del DCD.", run:()=>setFirmandoCargador(true), color:"#10b981" };
    if (!pasos.carga_ok) return { label:"Carga finalizada", help:"Marca este paso cuando la mercancía ya este cargada, documentada y firmada.", run: finalizarCarga, color:"#10b981" };
    if (!pasos.viaje_iniciado) return { label:"Iniciar viaje", help:"Comienza el trayecto hacia destino. El viaje sigue activo hasta finalizar descarga y firma.", run: iniciarViaje, color:"#3b82f6" };
    if (!pasos.posicionado_descarga) return { label:"Posicionado para descarga", help:"Registra la llegada o posicionamiento en destino. Empieza la espera de descarga.", run: posicionarDescarga, color:"#3b82f6" };
    if (!pasos.descarga_iniciada) return { label:"Descarga iniciada", help:"Empieza el contador de descarga y avisa si supera 60 minutos.", run: iniciarDescarga, color:"#a78bfa" };
    if (!pasos.descarga_ok) return { label:"Descarga finalizada", help:"Marca este paso al terminar la descarga.", run: finalizarDescarga, color:"#10b981" };
    if (!pasos.albaran_descarga) return { type:"albaran_descarga", label:"Subir albarán de descarga", help:"El albarán de descarga aparece ahora porque la descarga ya esta marcada como finalizada." };
    if (!pasos.firma_entrega) return { label:"Firmar entrega cliente", help:"Firma interna de entrega correcta con origen, destino y mercancía.", run:()=>setFirmando(true), color:"#10b981" };
    return null;
  }

  function abrirIncidencia(fase="ruta") {
    setIncidenciaFase(fase);
    setIncidencia(true);
  }

  async function cambiarEstado(nuevoEstado){
    if (nuevoEstado === "en_curso" && !jornadaInfo?.jornada) {
      notify("Abre jornada antes de iniciar el viaje. Asi queda registrado el turno y los tiempos.", "warning");
      onAbrirJornada?.();
      return;
    }
    if (nuevoEstado === "en_curso" && !(await confirmarDcdAntesDeSalir())) return;
    setLoading(true);
    try{
      await cambiarEstadoPedido(pedido.id,nuevoEstado);
      if(nuevoEstado==="en_curso") {
        const location = await capturarUbicacionActual();
        await persistirPasos({ carga_iniciada:true, carga_iniciada_at:new Date().toISOString(), ...(location ? { carga_ubicacion: location } : {}), ...patchKmParaPaso("carga_iniciada") }, { silent:true });
      }
      if(nuevoEstado==="descarga") await persistirPasos({ descarga_iniciada:true, ...patchKmParaPaso("descarga_iniciada") }, { silent:true });
      if(nuevoEstado==="entregado") {
        await persistirPasos({ descarga_ok:true, firma_entrega:true, ...patchKmParaPaso("firma_entrega") }, { silent:true });
      }
      // Si marcamos entregado, mostrar proxima carga si existe
      if(nuevoEstado==="entregado"){
        try{
          const all = await getPedidos();
          const arr = Array.isArray(all) ? all : Array.isArray(all?.data) ? all.data : [];
          const proxima = arr.find(p=>
            p.vehiculo_id===pedido.vehiculo_id &&
            p.id!==pedido.id &&
            ["confirmado","pendiente"].includes(p.estado)
          );
          if(proxima){
            setProximaCarga(proxima);
          }
        }catch(e){}
      }
      onActualizar();
    }catch(err){
      if (esErrorOffline(err)) {
        queueOfflineCriticalAction({
          tipo: "pedido_estado",
          pedido_id: pedido.id,
          estado: nuevoEstado,
          body: {},
          dedupe_key: `pedido_estado:${pedido.id}:${nuevoEstado}:${Date.now()}`,
          fecha: new Date().toISOString(),
        }, "Cambio de estado guardado para sincronizar");
        if(nuevoEstado==="en_curso") {
          const location = await capturarUbicacionActual();
          await persistirPasos({ carga_iniciada:true, carga_iniciada_at:new Date().toISOString(), ...(location ? { carga_ubicacion: location } : {}), ...patchKmParaPaso("carga_iniciada") }, { silent:true });
        }
        if(nuevoEstado==="descarga") await persistirPasos({ descarga_iniciada:true, ...patchKmParaPaso("descarga_iniciada") }, { silent:true });
        if(nuevoEstado==="entregado") await persistirPasos({ descarga_ok:true, firma_entrega:true, ...patchKmParaPaso("firma_entrega") }, { silent:true });
        onActualizar();
        return;
      }
      notify(err.message, "error");
    }
    finally{setLoading(false);}
  }

  async function registrarFirma(dataURL, firmaNombre){
    const firmaPayload = {
      firma_destinatario: dataURL,
      firma_nombre: firmaNombre || "Destinatario",
      source: "app_chofer",
    };
    try{
      await guardarFirmaEntrega(pedido.id, firmaPayload);
      try {
        await cambiarEstadoPedido(pedido.id,"entregado");
      } catch (estadoErr) {
        notify(estadoErr.message || "Firma guardada, pero no se pudo marcar entregado automáticamente.", "warning");
      }
      await persistirPasos({ descarga_ok:true, firma_entrega:true, firma_entrega_at:new Date().toISOString(), ...patchKmParaPaso("firma_entrega") }, { silent:true });
      const fresh = await cargarDocumentoControl().catch(() => null);
      if (fresh) setDocControl(fresh);
      setFirmando(false);
      notify("Firma de entrega registrada en el viaje.", "success");
      onActualizar();
    }catch(err){
      if (esErrorOffline(err)) {
        queueOfflineCriticalAction({
          tipo: "pedido_firma",
          pedido_id: pedido.id,
          body: firmaPayload,
          dedupe_key: `pedido_firma:${pedido.id}:destinatario:${Date.now()}`,
          fecha: new Date().toISOString(),
        }, "Firma de entrega guardada para sincronizar");
        encolarOffline({
          tipo: "pedido_estado",
          pedido_id: pedido.id,
          estado: "entregado",
          body: {},
          dedupe_key: `pedido_estado:${pedido.id}:entregado:${Date.now()}`,
          fecha: new Date().toISOString(),
        });
        await persistirPasos({ descarga_ok:true, firma_entrega:true, firma_entrega_at:new Date().toISOString(), ...patchKmParaPaso("firma_entrega") }, { silent:true });
        setFirmando(false);
        onActualizar();
        return;
      }
      notify(err.message || "No se pudo completar la firma por un problema en el servidor.", "error");
    }
  }

  async function abrirFirmaFinalizacionManual() {
    const faltan = [];
    if (!pasos.descarga_ok) faltan.push("descarga finalizada");
    if (!pasos.albaran_descarga) faltan.push("albarán de descarga");
    if (faltan.length) {
      const ok = await confirmDialog({
        title: "Finalizar viaje",
        message: `Faltan estos pasos: ${faltan.join(", ")}.\n\nPuedes finalizar igualmente para que el viaje no quede colgado, pero quedara trazado para administracion.`,
        confirmText: "Firmar y finalizar",
        tone: "warning",
      });
      if (!ok) return;
    }
    setFirmando(true);
  }

  async function actualizarPosicion(){
    const pos = await capturarUbicacionActual(15000);
    if(!pos){notify("GPS no disponible o permiso denegado", "warning");return;}
    const gpsPayload = {
      lat: pos.lat,
      lng: pos.lng,
      accuracy_m: Math.round(Number(pos.accuracy_m || 0)),
      captured_at: pos.captured_at || new Date().toISOString(),
    };
    try{
        await actualizarGpsPedido(pedido.id, gpsPayload);
        notify("Posicion actualizada", "success");
    }catch(err){
      if (esErrorOffline(err)) {
        queueOfflineCriticalAction({
          tipo: "pedido_gps",
          pedido_id: pedido.id,
          body: gpsPayload,
          dedupe_key: `pedido_gps:${pedido.id}:${Date.now()}`,
          fecha: new Date().toISOString(),
        }, "Posicion guardada para sincronizar");
        return;
      }
      notify(err.message, "error");
    }
  }

  async function abrirUbicacionEnApps(){
    const location = await capturarUbicacionActual();
    if (!location) {
      notify("No se pudo obtener la ubicación", "error");
      return;
    }
    const label = encodeURIComponent(`TransGest ${pedido.numero || "viaje"}`);
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
    const geoUrl = `geo:${location.lat},${location.lng}?q=${location.lat},${location.lng}(${label})`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Ubicacion viaje ${pedido.numero || ""}`.trim(),
          text: `Ubicacion registrada por app chofer (${location.lat.toFixed(6)}, ${location.lng.toFixed(6)})`,
          url: mapsUrl,
        });
        return;
      }
    } catch {}
    window.location.href = geoUrl;
    window.setTimeout(() => window.open(mapsUrl, "_blank", "noopener,noreferrer"), 700);
  }

  async function registrarVariacionCarga(){
    const peso = window.prompt("Peso real o variación detectada (opcional)", pedido.peso_kg || "");
    if (peso === null) return;
    const mercancia = window.prompt("Mercancía real o variación detectada (opcional)", pedido.mercancia || pedido.descripcion_carga || "");
    if (mercancia === null) return;
    const detalle = window.prompt("Describe la variación/incidencia para tráfico", "");
    if (detalle === null) return;
    const partes = [
      peso ? `Peso indicado por chofer: ${peso}` : null,
      mercancia ? `Mercancia indicada por chofer: ${mercancia}` : null,
      detalle ? `Detalle: ${detalle}` : null,
    ].filter(Boolean);
    if (!partes.length) {
      notify("No se ha indicado ninguna variación.", "warning");
      return;
    }
    try {
      await cambiarEstadoPedido(pedido.id, "incidencia", { incidencia: `[Variacion carga] ${partes.join(" | ")}` });
      notify("Variación registrada para revisión de tráfico.", "success");
      onActualizar();
    } catch (err) {
      notify(err.message || "No se pudo registrar la variación", "error");
    }
  }

  const ACCIONES = {
    confirmado: [{label:"Iniciar viaje",   estado:"en_curso",   bg:"#3b82f6"}],
    en_curso:   [{label:"En descarga",      estado:"descarga",   bg:"#a78bfa"},
                 {label:"Entregar + Firma", action:"firma",      bg:"#10b981"}],
    descarga:   [{label:"Entregar + Firma", action:"firma",      bg:"#10b981"}],
    pendiente:  [{label:"Iniciar viaje",    estado:"en_curso",   bg:"#3b82f6"}],
  };
  const acciones = ACCIONES[pedido.estado]||[];
  const nextStep = siguientePaso();

  return(
    <>
      {/* Proxima carga banner */}
      {proximaCarga&&(
        <div style={{background:"rgba(16,185,129,.12)",border:"1.5px solid rgba(16,185,129,.4)",borderRadius:12,padding:"12px 16px",marginBottom:8,animation:"pulse 2s infinite"}}>
          <div style={{fontWeight:800,fontSize:14,color:"#10b981",marginBottom:4}}>Tu próxima carga esta lista</div>
          <div style={{fontWeight:700,fontSize:15,color:"var(--text)"}}>{proximaCarga.origen||"-"} -> {proximaCarga.destino||"-"}</div>
          <div style={{fontSize:14,color:"var(--text4)",marginTop:2}}>{proximaCarga.numero} - {proximaCarga.cliente_nombre||""}</div>
          <button onClick={()=>setProximaCarga(null)} style={{marginTop:8,padding:"6px 14px",borderRadius:7,border:"none",background:"#10b981",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Ver detalles</button>
        </div>
      )}
      <DriverTripCard pedido={pedido} state={e} expanded={expanded} featured={featured} onToggle={()=>onExpandedChange?.(!expanded)}/>

      {expanded&&(
        <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px",marginTop:-8,marginBottom:10}}>
          {/* Detalles */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[
              ["Mercancía",pedido.mercancia||pedido.descripcion_carga||"-"],
              ["Peso",pedido.peso_kg?(pedido.peso_kg+" kg"):"-"],
              ["Bultos/Palets",pedido.bultos||"-"],
            ].map(([l,v])=>(
              <div key={l} style={{background:"var(--bg4)",borderRadius:7,padding:"8px 10px"}}>
                <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>{l}</div>
                <div style={{fontSize:14,fontWeight:600,color:"var(--text)"}}>{v}</div>
              </div>
            ))}
          </div>
          {(() => {
            const adrItems = (Array.isArray(pedido.adr_items) ? pedido.adr_items : []).filter(it => it && (it.un || it.nombre));
            if (!pedido.adr && !adrItems.length) return null;
            const ex = adrExencion(adrItems);
            const reqs = adrRequisitos(adrItems);
            return (
              <div style={{border:"2px solid #b91c1c",borderRadius:10,padding:"12px 14px",marginBottom:12,background:"rgba(239,68,68,.06)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{display:"inline-block",width:18,height:18,background:"#f59e0b",border:"2px solid #111",transform:"rotate(45deg)",borderRadius:3}}/>
                  <strong style={{fontSize:14,color:"#b91c1c"}}>Mercancía peligrosa (ADR)</strong>
                  <span style={{marginLeft:"auto",fontSize:12,fontWeight:800,padding:"2px 8px",borderRadius:20,background:ex.exento?"rgba(16,185,129,.15)":"rgba(239,68,68,.15)",color:ex.exento?"#10b981":"#ef4444"}}>{ex.exento?"Exencion 1.1.3.6":"ADR completo"}</span>
                </div>
                {adrItems.map((it,i)=>(
                  <div key={i} style={{fontFamily:"monospace",fontSize:14,color:"var(--text)",background:"var(--bg4)",borderRadius:6,padding:"6px 8px",marginBottom:4,wordBreak:"break-word"}}>{adrDocLine(it)}</div>
                ))}
                <div style={{fontSize:14,color:"var(--text4)",margin:"6px 0 8px"}}>{ex.resumen}</div>
                <div style={{fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:".05em",color:"var(--text5)",marginBottom:4}}>Comprobar antes de cargar</div>
                {reqs.filter(r=>r.obligatorio).map(r=>(
                  <div key={r.clave} style={{display:"flex",alignItems:"center",gap:8,fontSize:14,color:"var(--text3)",padding:"3px 0"}}>
                    <span style={{color:"#ef4444",fontWeight:900}}>&#9744;</span>{r.etiqueta}
                  </div>
                ))}
              </div>
            );
          })()}
          {choferDocs.length > 0 && (
            <div style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:12}}>
              <div style={{fontSize:14,fontWeight:900,color:"var(--text)",marginBottom:8}}>Documentos del viaje ({choferDocs.length})</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {choferDocs.map(doc => (
                  <div key={doc.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"var(--bg3)",borderRadius:8,border:"1px solid var(--border)"}}>
                    <span style={{fontSize:14,fontWeight:800,color:"var(--text5)"}}>{doc.file_mime?.includes("pdf")?"PDF":doc.file_mime?.startsWith("image/")?"IMG":"DOC"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{doc.nombre}</div>
                      {doc.tipo && <div style={{fontSize:12,color:"var(--text5)"}}>{doc.tipo}</div>}
                    </div>
                    <button onClick={()=>verChoferDoc(doc)} style={{border:"1px solid var(--border2)",background:"var(--bg)",color:"var(--accent)",borderRadius:7,padding:"6px 12px",fontSize:14,fontWeight:800,cursor:"pointer",flexShrink:0}}>Ver</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {pedido.notas&&(
            <div style={{background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.2)",borderRadius:7,padding:"8px 12px",marginBottom:12,fontSize:14,color:"var(--text3)"}}>
              Notas: {pedido.notas}
            </div>
          )}

          {requiereProtocoloCisterna && (
            <div style={{background:protocoloCisternaCompletado ? "rgba(16,185,129,.08)" : "rgba(245,158,11,.08)",border:`1px solid ${protocoloCisternaCompletado ? "rgba(16,185,129,.24)" : "rgba(245,158,11,.28)"}`,borderRadius:10,padding:12,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontSize:14,fontWeight:900,color:"var(--text)"}}>Protocolo cisterna</div>
                  <div style={{fontSize:14,color:"var(--text5)",lineHeight:1.4}}>
                    Confirma los pasos de seguridad antes de iniciar carga o descarga. Queda registrado con fecha y hora.
                  </div>
                </div>
                <span style={{fontSize:14,fontWeight:900,color:protocoloCisternaCompletado ? "#10b981" : "#f59e0b",whiteSpace:"nowrap"}}>
                  {protocoloCisternaCompletado ? "Completo" : `${protocoloCisternaPendientes.length} pendiente(s)`}
                </span>
              </div>
              <div style={{display:"grid",gap:7}}>
                {PROTOCOLO_CISTERNA.map(step => {
                  const ok = !!pasos[step.key];
                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => persistirPasos({ [step.key]: !ok, [`${step.key}_at`]: new Date().toISOString() }, { silent:true })}
                      style={{display:"grid",gridTemplateColumns:"28px 1fr",gap:8,textAlign:"left",alignItems:"center",padding:"8px 9px",borderRadius:8,border:`1px solid ${ok ? "rgba(16,185,129,.26)" : "var(--border)"}`,background:ok ? "rgba(16,185,129,.08)" : "var(--bg4)",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
                    >
                      <span style={{width:22,height:22,borderRadius:999,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,background:ok ? "#10b981" : "rgba(148,163,184,.16)",color:ok ? "#fff" : "var(--text5)"}}>
                        {ok ? "OK" : ""}
                      </span>
                      <span>
                        <span style={{display:"block",fontSize:14,fontWeight:900}}>{step.label}</span>
                        <span style={{display:"block",fontSize:12,color:"var(--text5)",marginTop:2,lineHeight:1.35}}>{step.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
              <div>
                <div style={{fontSize:14,fontWeight:900,color:"var(--text)"}}>Documento de control digital</div>
                <div style={{fontSize:14,color:"var(--text5)"}}>
                  {docControlLoading
                    ? "Preparando documento..."
                    : docControlSupportUrl ? "Documento disponible para mostrar, descargar o compartir." : "Documento pendiente de preparar por tráfico."}
                </div>
              </div>
              <div style={{fontSize:14,fontWeight:800,color:dcdOperativoOk ? "#10b981" : dcdReady ? "#60a5fa" : "#f59e0b"}}>
                {dcdOperativoOk ? "Disponible" : dcdReady ? "Listo" : "Pendiente"}
              </div>
            </div>
            {docControl?.documento && (
              <>
                <div className="tg-driver-dcd-internal" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
                  {[
                    ["DCD listo", dcdReady],
                    ["Revisado", dcdRevisado],
                    ["En móvil/impreso", dcdDisponible],
                  ].map(([label, ok]) => (
                    <div key={label} style={{background:ok ? "rgba(16,185,129,.09)" : "rgba(245,158,11,.08)",border:`1px solid ${ok ? "rgba(16,185,129,.22)" : "rgba(245,158,11,.2)"}`,borderRadius:8,padding:"7px 8px",textAlign:"center"}}>
                      <div style={{fontSize:14,fontWeight:900,color:ok ? "#10b981" : "#f59e0b"}}>{ok ? "OK" : "Pend."}</div>
                      <div style={{fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:".04em",color:"var(--text5)"}}>{label}</div>
                    </div>
                  ))}
                </div>
                <div className="tg-driver-dcd-internal" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>Sistema</div>
                    <div style={{fontSize:14,fontWeight:800,color:"var(--text)"}}>{docControl.documento.sistema === "qr_url" ? "QR / URL" : "Codigo numerico"}</div>
                  </div>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>Codigo</div>
                    <div style={{fontSize:14,fontWeight:800,color:"var(--text)",fontFamily:"'JetBrains Mono',monospace"}}>{docControl.documento.codigo_control || "Pendiente"}</div>
                  </div>
                </div>
                <div className="tg-driver-dcd-internal" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>Carga DCD</div>
                    <div style={{fontSize:14,fontWeight:800,color:"var(--text)"}}>{fmtDcdFecha(dcdHorarios.fecha_carga)}</div>
                    <div style={{fontSize:14,color:"var(--text4)",marginTop:2}}>{fmtDcdHora(dcdHorarios.hora_carga, dcdHorarios.ventana_carga)}</div>
                  </div>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>Descarga DCD</div>
                    <div style={{fontSize:14,fontWeight:800,color:"var(--text)"}}>{fmtDcdFecha(dcdHorarios.fecha_descarga)}</div>
                    <div style={{fontSize:14,color:"var(--text4)",marginTop:2}}>{fmtDcdHora(dcdHorarios.hora_descarga, dcdHorarios.ventana_descarga)}</div>
                  </div>
                </div>
                {(dcdCargas.length > 0 || dcdDescargas.length > 0) && (
                  <div className="tg-driver-dcd-internal" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    {[
                      ["Cargas", dcdCargas],
                      ["Descargas", dcdDescargas],
                    ].map(([titulo, items])=>(
                      <div key={titulo} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:6}}>{titulo}</div>
                        {items.length === 0 ? (
                          <div style={{fontSize:14,color:"var(--text5)"}}>Sin paradas adicionales</div>
                        ) : items.slice(0,3).map(stop=>(
                          <div key={`${titulo}-${stop.orden}-${stop.direccion}`} style={{fontSize:14,color:"var(--text3)",padding:"5px 0",borderTop:stop.orden>1?"1px solid var(--border2)":"none"}}>
                            <div style={{fontWeight:800,color:"var(--text)"}}>{stop.orden}. {stop.nombre || stop.direccion || "-"}</div>
                            <div style={{color:"var(--text4)"}}>{stop.direccion || "-"}</div>
                            <div style={{color:"var(--text5)"}}>{stop.fecha || "-"} · {stop.hora || stop.ventana || "-"}</div>
                            {stop.google_maps_url && (
                              <button type="button" onClick={()=>window.open(stop.google_maps_url,"_blank","noopener,noreferrer")}
                                style={{marginTop:4,padding:"4px 7px",borderRadius:7,border:"1px solid rgba(59,130,246,.28)",background:"rgba(59,130,246,.08)",color:"#60a5fa",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                                Abrir Maps
                              </button>
                            )}
                          </div>
                        ))}
                        {items.length > 3 && <div style={{fontSize:12,color:"var(--text5)",marginTop:4}}>+ {items.length - 3} paradas mas en el soporte</div>}
                      </div>
                    ))}
                  </div>
                )}
                {Array.isArray(docControl.status?.faltantes) && docControl.status.faltantes.length > 0 && (
                  <div className="tg-driver-dcd-internal" style={{fontSize:14,color:"#f59e0b",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",borderRadius:8,padding:"8px 10px",marginBottom:8}}>
                    Faltan datos: {docControl.status.faltantes.slice(0, 3).join(" | ")}{docControl.status.faltantes.length > 3 ? "..." : ""}
                  </div>
                )}
                {docControl?.remision && (
                  <div className="tg-driver-dcd-internal" style={{fontSize:14,color:"var(--text3)",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.18)",borderRadius:8,padding:"8px 10px",marginBottom:8}}>
                    <div style={{fontWeight:800,color:"var(--text)",marginBottom:4}}>Remision</div>
                    <div>{docControl.remision.etiqueta}</div>
                  </div>
                )}
                {docControlSupportUrl && <DriverDcdActions onView={()=>abrirDocumentoControl(false)} onQr={verQrDocumentoControl} onShare={compartirDocumentoControl} onPrint={()=>abrirDocumentoControl(true)} onDownload={descargarDocumentoControl} onReview={marcarDcdRevisado} reviewed={dcdOperativoOk}/>}
              </>
            )}
          </div>

          <details className="driver-map-disclosure"><summary>Mapa, paradas y posición del vehículo</summary><DriverTripMap pedido={pedido} pasos={pasos} chofer={jornadaInfo?.chofer}/></details>

          {timerActual && (
            <div style={{
              background:(timerActual.total || timerActual.mins) > 60 ? "rgba(239,68,68,.10)" : "rgba(16,185,129,.08)",
              border:`1px solid ${(timerActual.total || timerActual.mins) > 60 ? "rgba(239,68,68,.28)" : "rgba(16,185,129,.22)"}`,
              borderRadius:10,padding:12,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10
            }}>
              <div>
                <div style={{fontSize:14,fontWeight:900,color:"var(--text)"}}>{timerActual.label}</div>
                <div style={{fontSize:14,color:"var(--text5)",marginTop:2}}>
                  {timerActual.totalSeconds ? `Total espera + operacion: ${fmtDuracionSegundos(timerActual.totalSeconds)}` : "Aviso automatico al superar 60 minutos."}
                </div>
              </div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color:(timerActual.total || timerActual.mins) > 60 ? "#ef4444" : "#10b981"}}>
                {fmtDuracionSegundos(timerActual.seconds)}
              </div>
            </div>
          )}

          {nextStep && (
            <div style={{background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.22)",borderRadius:10,padding:12,marginBottom:12}}>
              <div style={{fontWeight:900,fontSize:14,color:"var(--text)",marginBottom:4}}>{nextStep.label}</div>
              <div style={{fontSize:14,color:"var(--text5)",marginBottom:10,lineHeight:1.45}}>{nextStep.help}</div>
              {nextStep.type === "mercancia_carga" ? (
                <div style={{display:"grid",gap:8}}>
                  <input aria-label="Mercancía cargada"
                    value={mercanciaCarga.mercancia}
                    onChange={e=>setMercanciaCarga(p=>({...p,mercancia:e.target.value}))}
                    placeholder="Mercancía cargada"
                    style={{width:"100%",boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--text)",borderRadius:8,padding:"10px 12px",fontFamily:"'DM Sans',sans-serif"}}
                  />
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <input aria-label="Palets / bultos"
                      value={mercanciaCarga.palets}
                      onChange={e=>setMercanciaCarga(p=>({...p,palets:e.target.value}))}
                      placeholder="Palets / bultos"
                      inputMode="numeric"
                      style={{width:"100%",minWidth:0,boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--text)",borderRadius:8,padding:"10px 12px",fontFamily:"'DM Sans',sans-serif"}}
                    />
                    <input aria-label="Peso kg"
                      value={mercanciaCarga.peso_kg}
                      onChange={e=>setMercanciaCarga(p=>({...p,peso_kg:e.target.value}))}
                      placeholder="Peso kg"
                      inputMode="decimal"
                      style={{width:"100%",minWidth:0,boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--text)",borderRadius:8,padding:"10px 12px",fontFamily:"'DM Sans',sans-serif"}}
                    />
                  </div>
                  <input aria-label="Referencia de carga (opcional)"
                    value={mercanciaCarga.referencia}
                    onChange={e=>setMercanciaCarga(p=>({...p,referencia:e.target.value}))}
                    placeholder="Referencia de carga (opcional)"
                    style={{width:"100%",boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--text)",borderRadius:8,padding:"10px 12px",fontFamily:"'DM Sans',sans-serif"}}
                  />
                  <button onClick={confirmarDatosMercanciaCarga} disabled={loading}
                    style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:"#10b981",color:"#fff",fontSize:14,fontWeight:900,cursor:loading?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                    Guardar datos de carga
                  </button>
                </div>
              ) : nextStep.type === "albaran_carga" ? (
                <EscanerAlbaran pedido={pedido} fase="carga" onUploaded={()=>albaranSubido("albaran_carga")} />
              ) : nextStep.type === "albaran_descarga" ? (
                <EscanerAlbaran pedido={pedido} fase="descarga" onUploaded={()=>albaranSubido("albaran_descarga")} />
              ) : (
                <button onClick={()=>Promise.resolve().then(nextStep.run).catch(()=>{})} disabled={loading}
                  style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:nextStep.color || "#10b981",color:"#fff",fontSize:14,fontWeight:900,cursor:loading?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  {loading ? "Actualizando..." : nextStep.label}
                </button>
              )}
            </div>
          )}

          {["en_curso","descarga"].includes(pedido.estado) && pasos.descarga_ok && (!pasos.firma_entrega || !pedido.firma_fecha) && (
            <button onClick={abrirFirmaFinalizacionManual} disabled={loading}
              style={{width:"100%",padding:"11px",borderRadius:8,border:"1px solid rgba(16,185,129,.35)",background:"rgba(16,185,129,.12)",color:"#10b981",fontSize:14,fontWeight:900,cursor:loading?"default":"pointer",fontFamily:"'DM Sans',sans-serif",marginBottom:12}}>
              {pasos.firma_entrega && !pedido.firma_fecha ? "Firmar y cerrar viaje" : "Finalizar / firmar entrega"}
            </button>
          )}

          {/* Acciones principales */}
          <div style={{display:"none",flexDirection:"column",gap:8}}>
            {acciones.map((a,i)=>(
              <button key={i} disabled={loading}
                onClick={async()=>{
                  if(a.action==="firma"){
                    if(!pasos.albaran_descarga) {
                      const ok = await confirmDialog({
                        title: "Entregar sin albarán",
                        message: "Aun no has adjuntado el albarán?",
                        confirmText: "Firmar igualmente",
                        tone: "warning",
                      });
                      if(!ok) return;
                    }
                    setFirmando(true);
                    return;
                  }
                  // Si entrega, guardar km si los indico
                  if(a.estado==="entregado"&&kmActuales){
                    try{
                      const {actualizarKmVehiculo}=await import("../../services/api");
                      if(pedido.vehiculo_id) await actualizarKmVehiculo(pedido.vehiculo_id,Number(kmActuales));
                    }catch(e){}
                  }
                  cambiarEstado(a.estado);
                }}
                style={{padding:"16px",borderRadius:12,border:"none",background:a.bg,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",opacity:loading?.7:1,letterSpacing:".01em",boxShadow:`0 4px 12px ${a.bg}66`}}>
                {loading?"Actualizando...":a.label}
              </button>
            ))}
          </div>

          {/* Acciones secundarias */}
          <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
            <button onClick={actualizarPosicion} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text3)",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Mi ubicación
            </button>
            <button onClick={abrirUbicacionEnApps} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid rgba(16,185,129,.3)",background:"rgba(16,185,129,.1)",color:"#10b981",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Abrir mapas
            </button>
            <button onClick={()=>onFoto?.(pedido)} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid rgba(59,130,246,.3)",background:"rgba(59,130,246,.1)",color:"#60a5fa",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Foto
            </button>
            <button onClick={registrarVariacionCarga} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid rgba(245,158,11,.3)",background:"rgba(245,158,11,.1)",color:"#fbbf24",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Variación
            </button>
            {pedido.estado!=="entregado"&&pedido.estado!=="cancelado"&&(
              <button onClick={()=>abrirIncidencia(pedido.estado==="descarga"?"descarga":"ruta")} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid rgba(251,191,36,.3)",background:"rgba(251,191,36,.1)",color:"#fbbf24",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                Aviso viaje
              </button>
            )}
            {pasos.firma_entrega&&(
              <div style={{fontSize:12,color:"#10b981",display:"flex",alignItems:"center",gap:4,padding:"0 8px"}}>Firmado</div>
            )}
          </div>
        </div>
      )}

      {firmando&&<FirmaCanvas pedido={pedido} onFirma={registrarFirma} onCancel={()=>setFirmando(false)}/>}
      {firmandoCargador&&(
        <FirmaCanvas
          pedido={pedido}
          title="Firma del remitente"
          onFirma={registrarFirmaCargador}
          onCancel={()=>setFirmandoCargador(false)}
        />
      )}
      {incidencia&&<ModalIncidencia pedido={pedido} fase={incidenciaFase} onClose={()=>setIncidencia(false)} onGuardado={()=>{setIncidencia(false);onActualizar();}}/>}
      {qrVisible&&(
        <div className="driver-overlay" style={{position:"fixed",inset:0,background:"rgba(2,6,23,.96)",zIndex:700,display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div style={{width:"min(390px,94vw)",background:"#fff",color:"#111827",borderRadius:12,padding:18,textAlign:"center",boxShadow:"0 24px 80px rgba(0,0,0,.45)"}}>
            <div style={{fontSize:14,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--accent)",marginBottom:4}}>Documento de control digital</div>
            <div style={{fontSize:18,fontWeight:900,marginBottom:4}}>{pedido.numero || dcd?.referencia_pedido || "Viaje"}</div>
            <div style={{fontSize:14,color:"#64748b",marginBottom:12}}>Muestra este QR para abrir el documento alojado en el servidor.</div>
            {docControl?.qr?.data_url ? (
              <img src={docControl.qr.data_url} alt="QR documento de control" style={{width:"min(300px,78vw)",height:"min(300px,78vw)",objectFit:"contain",border:"1px solid #e5e7eb",borderRadius:8,padding:10,background:"#fff"}}/>
            ) : (
              <div style={{border:"1px solid #e5e7eb",borderRadius:8,padding:14,fontSize:14,wordBreak:"break-all",color:"var(--accent)"}}>
                {docControl?.qr?.url || docControlSupportUrl}
              </div>
            )}
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:900,marginTop:10,color:"#0f172a"}}>{dcd?.codigo_control || ""}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:14}}>
              <button onClick={()=>abrirDocumentoControl(false)} style={{padding:"11px",borderRadius:8,border:"1px solid #99f6e4",background:"#ccfbf1",color:"var(--accent)",fontSize:14,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Abrir DCD</button>
              <button onClick={()=>setQrVisible(false)} style={{padding:"11px",borderRadius:8,border:"1px solid #cbd5e1",background:"#f8fafc",color:"#334155",fontSize:14,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Solicitudes de taller desde app chofer

export { TarjetaViaje };
