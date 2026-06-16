import { useState, useEffect } from "react";
import { getChoferes, getVehiculos, getPedidos, getFacturas, getNominasEmitidas, crearNominaEmitida, getNochesVehiculo, getChoferJornadas } from "../services/api";
import { getEmpresaPerfilSync } from "../hooks/useEmpresaPerfil";
import { getChoferConfigSync, hydrateChoferConfig, saveChoferConfigBackend } from "../hooks/useChoferConfig";
import { confirmDialog } from "../services/notify";

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtPct = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:1,maximumFractionDigits:1});

// ── Helpers localStorage ──────────────────────────────────────────────────
// IRPF 2025 tramos
function calcIRPF(base){
  const tramos=[{h:12450,t:.19},{h:20200,t:.24},{h:35200,t:.30},{h:60000,t:.37},{h:300000,t:.45},{h:Infinity,t:.47}];
  let cuota=0,prev=0;
  for(const tr of tramos){
    if(base<=prev) break;
    cuota+=(Math.min(base,tr.h)-prev)*tr.t;
    prev=tr.h;
    if(base<=tr.h) break;
  }
  return cuota;
}
const SS_PCG  = 6.35; // trabajador
const SS_EMP  = 30.40; // empresa
const HORAS_MES_TRANSPARENCIA = 173.33; // Referencia provisional: 40 h/semana * 52 / 12.

function primerDiaMes(ym){ return ym+"-01"; }
function ultimoDiaMes(ym){ const[y,m]=ym.split("-").map(Number); return new Date(y,m,0).toISOString().slice(0,10); }
function fechaISO(v){ return String(v||"").slice(0,10); }
function fechaPedido(p){ return fechaISO(p?.fecha_carga || p?.fecha_pedido || p?.created_at); }

function categoriaRetributiva(r){
  const puesto = String(r?.chofer?.puesto_valor || "Puesto sin valorar").trim();
  const contrato = String(r?.chofer?.tipo_contrato || "Sin contrato").trim();
  const carnet = String(r?.chofer?.categoria_carnet || "Sin carnet").trim();
  const convenio = String(r?.ext?.convenio || "Sin convenio").trim();
  return `${puesto} / ${contrato} / ${carnet} / ${convenio}`;
}

function sexoRetributivo(chofer){
  const value = String(chofer?.sexo || chofer?.genero || "").trim().toLowerCase();
  if(["mujer","femenino","f"].includes(value)) return "mujer";
  if(["hombre","masculino","m"].includes(value)) return "hombre";
  if(["no_binario","otro","no consta","no_consta"].includes(value)) return value;
  return "";
}

function devengoReferencia(r){
  const n = r?.yaEmitida;
  if(n){
    const dev = Number(n.devengos);
    if(Number.isFinite(dev) && dev > 0) return dev;
    return Number(n.salario_base||0)+Number(n.plus_actividad||0)+Number(n.horas_extra||0)+Number(n.importe_noches||0);
  }
  return Number(r?.devengos||0);
}

function buildTransparenciaRows(resumen){
  const groups = {};
  (resumen||[]).forEach(r=>{
    const key = categoriaRetributiva(r);
    if(!groups[key]) groups[key] = { categoria:key, items:[] };
    groups[key].items.push(r);
  });
  return Object.values(groups).map(g=>{
    const values = g.items.map(devengoReferencia).filter(v=>Number.isFinite(v) && v>0);
    const avg = values.length ? values.reduce((s,v)=>s+v,0)/values.length : 0;
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const gapPct = avg>0 ? ((max-min)/avg)*100 : 0;
    const mujeres = g.items.filter(r=>sexoRetributivo(r.chofer)==="mujer").map(devengoReferencia).filter(v=>Number.isFinite(v)&&v>0);
    const hombres = g.items.filter(r=>sexoRetributivo(r.chofer)==="hombre").map(devengoReferencia).filter(v=>Number.isFinite(v)&&v>0);
    const avgMujer = mujeres.length ? mujeres.reduce((s,v)=>s+v,0)/mujeres.length : 0;
    const avgHombre = hombres.length ? hombres.reduce((s,v)=>s+v,0)/hombres.length : 0;
    const brechaGeneroPct = avgMujer>0 && avgHombre>0 ? ((avgHombre-avgMujer)/avgHombre)*100 : null;
    return {
      ...g,
      count: g.items.length,
      avg,
      avgAnnual: avg * 12,
      avgHour: avg / HORAS_MES_TRANSPARENCIA,
      min,
      max,
      gapPct,
      avgMujer,
      avgHombre,
      brechaGeneroPct,
      muestraGenero: mujeres.length + hombres.length,
      alerta: values.length>=2 && (gapPct>=5 || (brechaGeneroPct !== null && Math.abs(brechaGeneroPct)>=5)),
    };
  }).sort((a,b)=>(Number(b.alerta)-Number(a.alerta)) || b.gapPct-a.gapPct || a.categoria.localeCompare(b.categoria));
}

function camposTransparenciaPendientes(chofer, ext){
  const missing = [];
  if(!chofer?.tipo_contrato) missing.push("tipo contrato");
  if(!chofer?.categoria_carnet) missing.push("categoria carnet");
  if(!chofer?.puesto_valor) missing.push("puesto / trabajo de igual valor");
  if(!sexoRetributivo(chofer)) missing.push("sexo/género para brecha");
  if(!ext?.convenio) missing.push("convenio");
  if(!Number(ext?.salario_base||0)) missing.push("salario base");
  return missing;
}

// ── Modal nómina individual ───────────────────────────────────────────────
function ModalNomina({ chofer, vehiculo, periodo, pedidos, facturas, nochesVehiculo = [], jornadasChofer = [], ultimaNomina, onClose, onEmitida }){
  const ext   = getChoferConfigSync(chofer.id);
  const desde = primerDiaMes(periodo);
  const hasta = ultimoDiaMes(periodo);
  const baseAnterior = ultimaNomina || null;

  // Calcular valores del período
  const pedVeh = vehiculo
    ? (pedidos||[]).filter(p=>{
        const f=fechaPedido(p);
        return (p.vehiculo_id===vehiculo.id) && f>=desde && f<=hasta && p.estado!=="cancelado";
      })
    : (pedidos||[]).filter(p=>{
        const f=fechaPedido(p);
        return (p.chofer_id===chofer.id||p.chofer2_id===chofer.id) && f>=desde && f<=hasta && p.estado!=="cancelado";
      });

  const facVeh = vehiculo
    ? facturas.filter(f=>f.fecha?.slice(0,10)>=desde && f.fecha?.slice(0,10)<=hasta && pedVeh.find(p=>p.id===f.pedido_id))
    : facturas.filter(f=>f.fecha?.slice(0,10)>=desde && f.fecha?.slice(0,10)<=hasta && pedVeh.find(p=>p.id===f.pedido_id));

  const ingresosVeh = facVeh.reduce((s,f)=>s+Number(f.total||0),0);
  const nochesLista = vehiculo ? nochesVehiculo.filter(x=>x.fecha>=desde&&x.fecha<=hasta) : [];
  const totalNoches = nochesLista.reduce((s,x)=>s+Number(x.importe||0),0);
  const jornadasPeriodo = (jornadasChofer||[]).filter(j=>{
    const f = fechaISO(j.inicio_at);
    return f>=desde && f<=hasta;
  });
  const jornadasCerradas = jornadasPeriodo.filter(j=>j.estado==="cerrada");
  const jornadasAbiertas = jornadasPeriodo.filter(j=>j.estado!=="cerrada");
  const kmJornadas = jornadasPeriodo.reduce((s,j)=>{
    const direct = Number(j.km_jornada);
    if(Number.isFinite(direct) && direct>0) return s + direct;
    const ini = Number(j.km_inicio);
    const fin = Number(j.km_fin);
    return Number.isFinite(ini) && Number.isFinite(fin) && fin>=ini ? s + (fin-ini) : s;
  },0);
  const nochesApp = jornadasPeriodo.filter(j=>j.hace_noche);
  const diasConViaje = Array.from(new Set(pedVeh.map(fechaPedido).filter(Boolean)));
  const diasConJornada = new Set(jornadasPeriodo.map(j=>fechaISO(j.inicio_at)).filter(Boolean));
  const diasViajeSinJornada = diasConViaje.filter(d=>!diasConJornada.has(d));
  const nochesSinImporte = nochesLista.filter(n=>Number(n.importe||0)<=0);
  const avisosJornada = [
    pedVeh.length>0 && jornadasPeriodo.length===0 ? "Hay viajes en el periodo, pero no hay jornadas registradas desde la app. Revisa hoja de ruta y mete km/noches manualmente si procede." : "",
    diasViajeSinJornada.length>0 && jornadasPeriodo.length>0 ? `${diasViajeSinJornada.length} dia(s) con viaje no tienen jornada app asociada.` : "",
    jornadasAbiertas.length>0 ? `${jornadasAbiertas.length} jornada(s) siguen abiertas. Pide cierre al chofer antes de liquidar.` : "",
    nochesLista.length>0 && nochesSinImporte.length===nochesLista.length ? "Hay noches registradas, pero sin importe. Introduce la dieta manualmente o configura el importe antes de emitir." : "",
  ].filter(Boolean);
  const resumenJornadaNotas = `App chofer: ${jornadasPeriodo.length} jornada(s), ${kmJornadas.toFixed(0)} km, ${nochesApp.length} noche(s), ${diasViajeSinJornada.length} dia(s) con viaje sin jornada.`;
  const incentivoPct = Number(ext.incentivo_pct||0);
  const incentivo    = ingresosVeh>0 ? (ingresosVeh*incentivoPct/100) : 0;
  const plusActividad= Number(ext.plus_actividad||0);

  const [form, setForm] = useState({
    salario_base:    Number(baseAnterior?.salario_base ?? ext.salario_base ?? 0),
    incentivos:      incentivo,
    noches:          totalNoches,
    plus_actividad:  Number(baseAnterior?.plus_actividad ?? plusActividad),
    horas_extra:     Number(baseAnterior?.horas_extra ?? ext.ultima_nomina_horas_extra ?? 0),
    otros_plus:      Number(ext.ultima_nomina_otros_plus ?? 0),
    irpf_pct:        Number(baseAnterior?.irpf_pct ?? ext.ultima_nomina_irpf_pct ?? ext.irpf_pct ?? 15),
    anticipos:       Number(ext.ultima_nomina_anticipos ?? 0),
    embargos:        Number(ext.ultima_nomina_embargos ?? 0),
    otros_descuentos:Number(ext.ultima_nomina_otros_descuentos ?? 0),
    notas:           String(baseAnterior?.notas ?? ext.ultima_nomina_notas ?? ""),
  });
  const f = k => e => setForm(p=>({...p,[k]:Number(e.target.value)||0}));
  const fn = k => e => setForm(p=>({...p,[k]:e.target.value}));

  // Cálculo nómina
  const devengos = form.salario_base + form.incentivos + form.noches + form.plus_actividad + form.horas_extra + form.otros_plus;
  const ss_trabajador = devengos * (SS_PCG/100);
  const ss_empresa    = devengos * (SS_EMP/100);
  const base_irpf     = devengos - ss_trabajador;
  const irpf          = base_irpf * (form.irpf_pct/100);
  const liquido       = devengos - ss_trabajador - irpf - form.anticipos - form.embargos - form.otros_descuentos;
  const coste_empresa = devengos + ss_empresa;

  async function emitir(){
    const ok = await confirmDialog({
      title: "Emitir nomina",
      message: `Emitir nomina de ${chofer.nombre} para ${periodo}?`,
      confirmText: "Emitir",
    });
    if(!ok) return;
    const nomina = {
      id:"nom_"+Date.now(), periodo, fecha_emision: new Date().toISOString().slice(0,10),
      chofer_id:chofer.id, vehiculo_id:vehiculo?.id||null,
      ...form, devengos, ss_trabajador, ss_empresa, base_irpf, irpf, liquido, coste_empresa,
      ingresos_vehiculo: ingresosVeh, viajes: pedVeh.length,
    };
    const notasConJornada = [form.notas, resumenJornadaNotas, avisosJornada.length ? `Avisos: ${avisosJornada.join(" | ")}` : ""].filter(Boolean).join("\n");
    const saved = await crearNominaEmitida({
      chofer_id: chofer.id,
      periodo,
      salario_base: form.salario_base,
      plus_actividad: form.plus_actividad,
      horas_extra: form.horas_extra,
      noches: nochesLista.length,
      importe_noches: form.noches,
      ss_empresa,
      ss_trabajador,
      irpf,
      liquido,
      total_empresa: coste_empresa,
      notas: notasConJornada || null,
    });
    await saveChoferConfigBackend(chofer.id, {
      salario_base: form.salario_base,
      plus_actividad: form.plus_actividad,
      irpf_pct: form.irpf_pct,
      ultima_nomina_horas_extra: form.horas_extra,
      ultima_nomina_otros_plus: form.otros_plus,
      ultima_nomina_anticipos: form.anticipos,
      ultima_nomina_embargos: form.embargos,
      ultima_nomina_otros_descuentos: form.otros_descuentos,
      ultima_nomina_notas: form.notas || "",
    }).catch(() => {});
    const nominaGuardada = {
      ...nomina,
      ...saved,
      irpf_pct: form.irpf_pct,
      incentivos: form.incentivos,
      otros_plus: form.otros_plus,
      anticipos: form.anticipos,
      embargos: form.embargos,
      otros_descuentos: form.otros_descuentos,
      noches: form.noches,
      notas: notasConJornada,
    };
    imprimirNomina(nominaGuardada);
    onEmitida(nominaGuardada);
  }

  function imprimirNomina(nomina){
    const empresa = getEmpresaPerfilSync();
    const w = window.open("","_blank","width=800,height=1000");
    const n = nomina || { ...form, devengos, ss_trabajador, ss_empresa, base_irpf, irpf, liquido, coste_empresa };
    w.document.write(`<!DOCTYPE html><html><head><title>Nómina ${periodo} — ${chofer.nombre}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:28px;color:#111;font-size:12px;max-width:700px;margin:0 auto}
      h1{font-size:16px;margin:0 0 2px 0}.sub{font-size:11px;color:#555;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;margin:8px 0}
      th{background:#f0f0f0;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;border:1px solid #ddd}
      td{padding:6px 8px;border:1px solid #ddd;font-size:12px}
      .right{text-align:right}.bold{font-weight:bold}
      .total-row{background:#e8f4e8;font-weight:bold}
      .descuento-row{background:#fef9e7}
      .liquido-row{background:#e8f4e8;font-size:15px;font-weight:bold}
      .empresa-row{background:#eef2ff}
      .header{display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:14px}
      .firma-box{border-top:1px solid #333;padding-top:6px;font-size:10px;color:#555;min-width:180px;text-align:center}
      .firmas{display:flex;gap:40px;margin-top:40px;justify-content:space-between}
      @media print{body{padding:10px}}
    </style></head><body>
    <div class="header">
      <div>
        <h1>NÓMINA — ${periodo}</h1>
        <div class="sub">${empresa.razon_social||"Empresa"} · CIF: ${empresa.cif||"—"}</div>
        <div class="sub">${empresa.domicilio||""} ${empresa.municipio||""}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:bold;font-size:13px">${chofer.nombre} ${chofer.apellidos||""}</div>
        <div class="sub">DNI: ${chofer.dni||"—"}</div>
        <div class="sub">Contrato: ${chofer.tipo_contrato||"—"}</div>
        <div class="sub">Fecha emisión: ${n.fecha_emision||new Date().toLocaleDateString("es-ES")}</div>
      </div>
    </div>

    <table>
      <thead><tr><th>Concepto</th><th>Unidades</th><th class="right">Importe</th></tr></thead>
      <tbody>
        <tr><td>Salario base</td><td>1 mes</td><td class="right">${fmt2(n.salario_base)} €</td></tr>
        ${n.incentivos>0?`<tr><td>Incentivos (${incentivoPct}% s/ ${fmt2(ingresosVeh)} €)</td><td>—</td><td class="right">${fmt2(n.incentivos)} €</td></tr>`:""}
        ${n.noches>0?`<tr><td>Dietas / Noches (${nochesLista.length} noches)</td><td>${nochesLista.length}</td><td class="right">${fmt2(n.noches)} €</td></tr>`:""}
        ${n.plus_actividad>0?`<tr><td>Plus de actividad</td><td>—</td><td class="right">${fmt2(n.plus_actividad)} €</td></tr>`:""}
        ${n.horas_extra>0?`<tr><td>Horas extra</td><td>—</td><td class="right">${fmt2(n.horas_extra)} €</td></tr>`:""}
        ${n.otros_plus>0?`<tr><td>Otros pluses</td><td>—</td><td class="right">${fmt2(n.otros_plus)} €</td></tr>`:""}
        <tr class="total-row"><td>TOTAL DEVENGOS</td><td></td><td class="right">${fmt2(n.devengos)} €</td></tr>
      </tbody>
    </table>

    <table>
      <thead><tr><th>Deducciones</th><th>%</th><th class="right">Importe</th></tr></thead>
      <tbody>
        <tr class="descuento-row"><td>SS Trabajador (contingencias comunes + desempleo + FP)</td><td>${SS_PCG}%</td><td class="right">- ${fmt2(n.ss_trabajador)} €</td></tr>
        <tr class="descuento-row"><td>IRPF (retención a cuenta)</td><td>${n.irpf_pct}%</td><td class="right">- ${fmt2(n.irpf)} €</td></tr>
        ${n.anticipos>0?`<tr class="descuento-row"><td>Anticipos</td><td>—</td><td class="right">- ${fmt2(n.anticipos)} €</td></tr>`:""}
        ${n.embargos>0?`<tr class="descuento-row"><td>Embargos / Retenciones judiciales</td><td>—</td><td class="right">- ${fmt2(n.embargos)} €</td></tr>`:""}
        ${n.otros_descuentos>0?`<tr class="descuento-row"><td>Otras deducciones</td><td>—</td><td class="right">- ${fmt2(n.otros_descuentos)} €</td></tr>`:""}
        <tr class="liquido-row"><td>LÍQUIDO A PERCIBIR</td><td></td><td class="right">${fmt2(n.liquido)} €</td></tr>
      </tbody>
    </table>

    <table>
      <thead><tr><th colspan="2">Coste empresa (informativo)</th><th class="right">Importe</th></tr></thead>
      <tbody>
        <tr class="empresa-row"><td>SS Empresa</td><td>${SS_EMP}%</td><td class="right">${fmt2(n.ss_empresa)} €</td></tr>
        <tr class="empresa-row"><td><strong>COSTE TOTAL EMPRESA</strong></td><td></td><td class="right"><strong>${fmt2(n.coste_empresa)} €</strong></td></tr>
      </tbody>
    </table>

    ${vehiculo?`<div style="margin-top:10px;font-size:11px;color:#555;background:#f8f8f8;padding:6px 10px;border-radius:4px">
      Vehículo: ${vehiculo.matricula} · Viajes período: ${pedVeh.length} · Ingresos generados: ${fmt2(ingresosVeh)} €
    </div>`:""}
    <div style="margin-top:8px;font-size:11px;color:#555;background:#f8f8f8;padding:6px 10px;border-radius:4px">
      App chofer / hoja de ruta: ${jornadasPeriodo.length} jornada(s) registradas · ${jornadasCerradas.length} cerrada(s) · ${fmt2(kmJornadas)} km · ${nochesApp.length} noche(s). ${avisosJornada.length ? "Revisar: " + avisosJornada.join(" ") : ""}
    </div>
    ${n.notas?`<div style="margin-top:8px;font-size:11px;color:#666">Notas: ${n.notas}</div>`:""}

    <div class="firmas">
      <div class="firma-box">Firma trabajador:<br/><br/>${chofer.nombre} ${chofer.apellidos||""}</div>
      <div class="firma-box">Firma empresa:<br/><br/>${empresa.razon_social||""}</div>
    </div>
    </body></html>`);
    w.document.close(); w.focus(); setTimeout(()=>w.print(),400);
  }

  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"6px 9px",borderRadius:6,fontFamily:"'DM Sans',sans-serif",fontSize:12,outline:"none",width:"100%",boxSizing:"border-box",textAlign:"right"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:12}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:22,width:"min(700px,96vw)",maxHeight:"95vh",overflowY:"auto"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:16,color:"var(--text)"}}>
              Nómina — {chofer.nombre} {chofer.apellidos||""}
            </div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>
              Período: <strong>{periodo}</strong>
              {vehiculo&&<span style={{marginLeft:8,color:"var(--accent)"}}>· {vehiculo.matricula}</span>}
              {pedVeh.length>0&&<span style={{marginLeft:8,color:"var(--text5)"}}>· {pedVeh.length} viajes · {fmt2(ingresosVeh)} € ingresos</span>}
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:14,cursor:"pointer"}}>Cerrar</button>
        </div>

        <div style={{background:avisosJornada.length?"rgba(245,158,11,.10)":"rgba(16,185,129,.08)",border:`1px solid ${avisosJornada.length?"rgba(245,158,11,.28)":"rgba(16,185,129,.22)"}`,borderRadius:8,padding:"10px 12px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}>
            <div style={{fontSize:12,fontWeight:800,color:"var(--text)"}}>App chofer / hoja de ruta</div>
            <div style={{fontSize:11,color:"var(--text4)"}}>
              {jornadasPeriodo.length} jornadas · {jornadasCerradas.length} cerradas · {fmt2(kmJornadas)} km · {nochesApp.length} noches app · {nochesLista.length} noches liquidables
            </div>
          </div>
          <div style={{fontSize:11,color:"var(--text4)",marginTop:6,lineHeight:1.45}}>
            Se cruza con los viajes del periodo. Si faltan datos de la app, revisa la hoja de ruta y completa manualmente las noches, kilometros u horas antes de emitir.
          </div>
          {avisosJornada.length>0&&(
            <div style={{marginTop:8,display:"grid",gap:5}}>
              {avisosJornada.map((a,i)=>(
                <div key={i} style={{fontSize:11,fontWeight:700,color:"#f59e0b"}}>{a}</div>
              ))}
            </div>
          )}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}}>
          {/* Devengos */}
          <div>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#10b981",marginBottom:8,borderBottom:"1px solid rgba(16,185,129,.2)",paddingBottom:4}}>
              DEVENGOS
            </div>
            {[
              ["salario_base",  "Salario base (€/mes)", f],
              ["incentivos",   `Incentivos (${incentivoPct}% s/ ingresos)`, f],
              ["noches",       "Noches / Dietas (€)", f],
              ["plus_actividad","Plus de actividad (€)", f],
              ["horas_extra",  "Horas extra (€)", f],
              ["otros_plus",   "Otros pluses (€)", f],
            ].map(([k,l,handler])=>(
              <div key={k} style={{marginBottom:8}}>
                <label style={lbl}>{l}</label>
                <input type="number" step="0.01" style={inp} value={form[k]} onChange={handler(k)} onFocus={e=>e.target.select()}/>
              </div>
            ))}
            <div style={{background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.2)",borderRadius:7,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
              <span style={{fontSize:12,fontWeight:700,color:"var(--text4)"}}>Total devengos</span>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color:"#10b981"}}>{fmt2(devengos)} €</span>
            </div>
          </div>

          {/* Deducciones + resultado */}
          <div>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#ef4444",marginBottom:8,borderBottom:"1px solid rgba(239,68,68,.2)",paddingBottom:4}}>
              DEDUCCIONES
            </div>
            <div style={{marginBottom:8}}>
              <label style={lbl}>SS Trabajador ({SS_PCG}% — automático)</label>
              <div style={{...inp,background:"var(--bg3)",color:"var(--text4)",display:"flex",alignItems:"center",justifyContent:"flex-end"}}>{fmt2(ss_trabajador)} €</div>
            </div>
            <div style={{marginBottom:8}}>
              <label style={lbl}>IRPF retención (%)</label>
              <input type="number" step="0.5" min="0" max="47" style={inp} value={form.irpf_pct} onChange={f("irpf_pct")} onFocus={e=>e.target.select()}/>
              <div style={{fontSize:10,color:"var(--text5)",marginTop:1,textAlign:"right"}}>{fmt2(irpf)} € de retención</div>
            </div>
            {[
              ["anticipos",       "Anticipos (€)", f],
              ["embargos",        "Embargos / Retenciones (€)", f],
              ["otros_descuentos","Otras deducciones (€)", f],
            ].map(([k,l,handler])=>(
              <div key={k} style={{marginBottom:8}}>
                <label style={lbl}>{l}</label>
                <input type="number" step="0.01" style={inp} value={form[k]} onChange={handler(k)} onFocus={e=>e.target.select()}/>
              </div>
            ))}

            {/* Resultado */}
            <div style={{background:"rgba(59,130,246,.1)",border:"1px solid rgba(59,130,246,.25)",borderRadius:7,padding:"10px 12px",marginTop:8}}>
              {[
                ["Líquido a percibir", fmt2(liquido)+" €", "#10b981", true],
                ["Coste SS empresa ("+SS_EMP+"%)", fmt2(ss_empresa)+" €", "#f97316", false],
                ["Coste total empresa", fmt2(coste_empresa)+" €", "#ef4444", true],
              ].map(([l,v,c,b])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:b?"1px solid rgba(59,130,246,.15)":"none",marginBottom:b?4:0}}>
                  <span style={{fontSize:b?13:11,fontWeight:b?700:400,color:"var(--text4)"}}>{l}</span>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:b?800:600,fontSize:b?16:12,color:c}}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{marginTop:10}}>
              <label style={lbl}>Notas internas</label>
              <input style={{...inp,textAlign:"left"}} value={form.notas} onChange={fn("notas")}/>
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div style={{display:"flex",gap:10,marginTop:16,justifyContent:"flex-end",flexWrap:"wrap"}}>
          <button onClick={()=>imprimirNomina(null)} style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>
            Vista previa PDF
          </button>
          <button onClick={emitir} style={{padding:"8px 20px",borderRadius:7,border:"none",background:"var(--green)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            Emitir y guardar nómina
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
export default function Nominas(){
  const hoy     = new Date();
  const mesHoy  = hoy.toISOString().slice(0,7);
  const [periodo, setPeriodo]   = useState(mesHoy);
  const [choferes,setChoferes]  = useState([]);
  const [vehiculos,setVehiculos]= useState([]);
  const [pedidos, setPedidos]   = useState([]);
  const [facturas,setFacturas]  = useState([]);
  const [nominasEmitidas, setNominasEmitidas] = useState([]);
  const [nochesPorVehiculo, setNochesPorVehiculo] = useState({});
  const [jornadasPorChofer, setJornadasPorChofer] = useState({});
  const [loading, setLoading]   = useState(true);
  const [modal,   setModal]     = useState(null); // {chofer, vehiculo}
  const [tab,     setTab]       = useState("calcular"); // calcular | historial | transparencia

  async function cargarNominasEmitidas() {
    try {
      const rows = await getNominasEmitidas();
      setNominasEmitidas(Array.isArray(rows) ? rows : []);
    } catch {
      setNominasEmitidas([]);
    }
  }

  async function cargarNochesVehiculos(rows = vehiculos) {
    const listaVehiculos = Array.isArray(rows) ? rows.filter(v => v?.id) : [];
    if (!listaVehiculos.length) {
      setNochesPorVehiculo({});
      return;
    }
    const pares = await Promise.all(
      listaVehiculos.map(async (v) => {
        const noches = await getNochesVehiculo(v.id).catch(() => []);
        return [String(v.id), Array.isArray(noches) ? noches : []];
      })
    );
    const next = {};
    pares.forEach(([id, noches]) => {
      next[id] = noches;
    });
    setNochesPorVehiculo(next);
  }

  async function cargarJornadasChoferes(rows = choferes, per = periodo) {
    const listaChoferes = Array.isArray(rows) ? rows.filter(c => c?.id) : [];
    if (!listaChoferes.length) {
      setJornadasPorChofer({});
      return;
    }
    const desdePeriodo = primerDiaMes(per);
    const hastaPeriodo = ultimoDiaMes(per);
    const pares = await Promise.all(
      listaChoferes.map(async (c) => {
        const jornadas = await getChoferJornadas(c.id, { desde: desdePeriodo, hasta: hastaPeriodo }).catch(() => []);
        return [String(c.id), Array.isArray(jornadas) ? jornadas : []];
      })
    );
    const next = {};
    pares.forEach(([id, jornadas]) => {
      next[id] = jornadas;
    });
    setJornadasPorChofer(next);
  }

  useEffect(()=>{
    setLoading(true);
    const _t = (p,ms=8000) => Promise.race([p, new Promise(r=>setTimeout(()=>r([]),ms))]);
    Promise.all([
      _t(getChoferes().catch(()=>[])),
      _t(getVehiculos().catch(()=>[])),
      _t(getPedidos({limit:200}).catch(()=>[])),
      _t(getFacturas().catch(()=>[])),
      _t(getNominasEmitidas().catch(()=>[])),
    ]).then(([c,v,p,f,n])=>{
      setChoferes(Array.isArray(c)?c:[]);
      setVehiculos(Array.isArray(v)?v:[]);
      const pArr = Array.isArray(p)?p:(Array.isArray(p?.data)?p.data:[]);
      setPedidos(pArr);
      setFacturas(Array.isArray(f)?f:Array.isArray(f?.data)?f.data:[]);
      setNominasEmitidas(Array.isArray(n)?n:[]);
    }).finally(()=>setLoading(false));
  },[]);

  useEffect(() => {
    choferes.forEach(c => { hydrateChoferConfig(c.id).catch(() => {}); });
  }, [choferes]);

  useEffect(() => {
    if (!vehiculos.length) {
      setNochesPorVehiculo({});
      return;
    }
    cargarNochesVehiculos(vehiculos).catch(() => {});
  }, [vehiculos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!choferes.length) {
      setJornadasPorChofer({});
      return;
    }
    cargarJornadasChoferes(choferes, periodo).catch(() => {});
  }, [choferes, periodo]); // eslint-disable-line react-hooks/exhaustive-deps

  const desde = primerDiaMes(periodo);
  const hasta = ultimoDiaMes(periodo);

  // Para cada chófer, calcular resumen del período
  const resumen = choferes.map(c=>{
    const ext = getChoferConfigSync(c.id);
    const veh = vehiculos.find(v=>v.id===c.vehiculo_id||v.chofer_id===c.id);
    const pedC = pedidos.filter(p=>{
      const f=(p.fecha_carga||p.fecha_pedido||"").slice(0,10);
      return (p.chofer_id===c.id||p.chofer2_id===c.id)&&f>=desde&&f<=hasta&&p.estado!=="cancelado";
    });
    const facC = facturas.filter(f=>f.fecha?.slice(0,10)>=desde&&f.fecha?.slice(0,10)<=hasta&&pedC.find(p=>p.id===f.pedido_id));
    const ingresos = facC.reduce((s,f)=>s+Number(f.total||0),0);
    const nochesLista = veh ? (nochesPorVehiculo[String(veh.id)] || []).filter(x=>x.fecha>=desde&&x.fecha<=hasta) : [];
    const noches   = nochesLista.reduce((s,x)=>s+Number(x.importe||0),0);
    const jornadas = jornadasPorChofer[String(c.id)] || [];
    const jornadasPeriodo = jornadas.filter(j=>fechaISO(j.inicio_at)>=desde && fechaISO(j.inicio_at)<=hasta);
    const diasViaje = new Set(pedC.map(fechaPedido).filter(Boolean));
    const diasJornada = new Set(jornadasPeriodo.map(j=>fechaISO(j.inicio_at)).filter(Boolean));
    const faltanJornadas = pedC.length>0 && Array.from(diasViaje).some(d=>!diasJornada.has(d));
    const incentivo= ingresos>0?(ingresos*Number(ext.incentivo_pct||0)/100):0;
    const devengos = Number(ext.salario_base||0)+incentivo+noches+Number(ext.plus_actividad||0);
    const nominasHist = nominasEmitidas.filter(n=>n.chofer_id===c.id);
    const yaEmitida   = nominasHist.find(n=>n.periodo===periodo);
    const ultimaNomina = nominasHist.find(n=>n.periodo!==periodo) || yaEmitida || null;
    // Estimated IRPF: use manual % if set, otherwise use 2025 table
    const pctIRPF = ext.usar_irpf_manual && ext.pct_irpf_manual>0
      ? Number(ext.pct_irpf_manual)
      : devengos>0 ? Math.round((calcIRPF(devengos*12)/( devengos*12))*1000)/10 : 0;
    const irpfEst   = devengos * pctIRPF / 100;
    const ssEst     = devengos * SS_PCG / 100;
    const liquidoEst = devengos - irpfEst - ssEst;
    return{chofer:c,vehiculo:veh,ext,pedidos:pedC.length,ingresos,noches,incentivo,devengos,
           jornadas:jornadasPeriodo.length,faltanJornadas,
           pctIRPF,irpfEst,ssEst,liquidoEst,yaEmitida,ultimaNomina};
  }).filter(r=>r.ext.salario_base>0||r.devengos>0||r.pedidos>0);

  const transparenciaRows = buildTransparenciaRows(resumen);
  const transparenciaAlertas = transparenciaRows.filter(r=>r.alerta);
  const transparenciaPendientes = choferes.map(c=>{
    const ext = getChoferConfigSync(c.id);
    return { chofer:c, missing:camposTransparenciaPendientes(c, ext) };
  }).filter(x=>x.missing.length>0);

  function imprimirTransparencia(){
    const empresa = getEmpresaPerfilSync();
    const w = window.open("","_blank","width=900,height=1000");
    const rows = transparenciaRows.map(r=>`
      <tr>
        <td>${r.categoria}</td>
        <td class="right">${r.count}</td>
        <td class="right">${fmt2(r.avg)} EUR</td>
        <td class="right">${fmt2(r.avgAnnual)} EUR</td>
        <td class="right">${fmt2(r.avgHour)} EUR/h</td>
        <td class="right">${fmt2(r.min)} EUR</td>
        <td class="right">${fmt2(r.max)} EUR</td>
        <td class="right">${fmtPct(r.gapPct)}%</td>
        <td class="right">${r.brechaGeneroPct===null ? "Sin muestra" : `${fmtPct(r.brechaGeneroPct)}%`}</td>
        <td>${r.alerta ? "Revisar" : "OK"}</td>
      </tr>
    `).join("");
    const missing = transparenciaPendientes.map(x=>`
      <tr><td>${x.chofer.nombre} ${x.chofer.apellidos||""}</td><td>${x.missing.join(", ")}</td></tr>
    `).join("");
    w.document.write(`<!DOCTYPE html><html><head><title>Transparencia salarial ${periodo}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:28px;color:#111;font-size:12px;max-width:900px;margin:0 auto}
      h1{font-size:18px;margin:0 0 4px}.muted{color:#555;font-size:11px;line-height:1.45}
      table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #ddd;padding:7px 8px;text-align:left}
      th{background:#f2f4f7;font-size:10px;text-transform:uppercase}.right{text-align:right}.warn{background:#fff7ed;border:1px solid #fed7aa;padding:10px;margin-top:14px}
    </style></head><body>
      <h1>Diagnostico preparatorio de transparencia retributiva</h1>
      <div class="muted">${empresa.razon_social||"Empresa"} - periodo ${periodo}</div>
      <div class="muted">Informe interno basado en puesto de igual valor, tipo de contrato, carnet y convenio. Incluye retribucion mensual, anual y hora segun referencia provisional de ${fmt2(HORAS_MES_TRANSPARENCIA)} horas/mes. Pendiente de ajustar a la transposicion espanola definitiva de la Directiva UE 2023/970.</div>
      <table><thead><tr><th>Categoria</th><th>Choferes</th><th>Promedio mes</th><th>Bruto anual</th><th>Bruto hora</th><th>Min.</th><th>Max.</th><th>Diferencia</th><th>Brecha M/H</th><th>Estado</th></tr></thead><tbody>${rows||"<tr><td colspan='10'>Sin datos retributivos suficientes.</td></tr>"}</tbody></table>
      <div class="warn"><strong>Datos incompletos:</strong> ${transparenciaPendientes.length} fichas requieren revision.</div>
      <table><thead><tr><th>Chofer</th><th>Campos pendientes</th></tr></thead><tbody>${missing||"<tr><td colspan='2'>Sin campos pendientes detectados.</td></tr>"}</tbody></table>
    </body></html>`);
    w.document.close(); w.focus(); setTimeout(()=>w.print(),400);
  }

  const S={
    card:{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"16px 18px",marginBottom:14},
    btn:{padding:"7px 14px",borderRadius:7,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:5},
    th:{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",borderBottom:"1px solid var(--border)",whiteSpace:"nowrap"},
    td:{padding:"9px 12px",borderBottom:"1px solid var(--border2)",fontSize:12,color:"var(--text2)",verticalAlign:"middle"},
  };

  return(
    <div style={{flex:1, padding:"22px 26px",fontFamily:"'DM Sans',sans-serif",minHeight:"100vh"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:900,color:"var(--text)"}}>Nóminas</div>
        <input type="month" value={periodo} onChange={e=>setPeriodo(e.target.value)}
          style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"6px 10px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none"}}/>
        <span style={{fontSize:11,color:"var(--text5)"}}>{desde} → {hasta}</span>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:2,borderBottom:"1px solid var(--border)",marginBottom:16}}>
        {[["calcular","Generar nóminas"],["historial","Historial emitidas"],["transparencia","Transparencia salarial"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)} style={{...S.btn,border:"none",borderRadius:"6px 6px 0 0",borderBottom:`2px solid ${tab===id?"var(--accent)":"transparent"}`,color:tab===id?"var(--accent)":"var(--text4)",background:"transparent",padding:"8px 16px",fontSize:12}}>
            {l}
          </button>
        ))}
      </div>

      {tab==="calcular"&&(
        <div style={S.card}>
          {loading?(
            <div style={{padding:30,textAlign:"center",color:"var(--text5)"}}>Cargando...</div>
          ):resumen.length===0?(
            <div style={{padding:30,textAlign:"center",color:"var(--text5)"}}>
              Sin chóferes con configuración de nómina. Ve a Flota → Chóferes → ficha → Salario / Incentivo para configurarlos.
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>
                <th style={S.th}>Chófer</th>
                <th style={S.th}>Vehículo</th>
                <th style={S.th}>Viajes</th>
                <th style={S.th}>Ingresos veh.</th>
                <th style={S.th}>Salario base</th>
                <th style={S.th}>Incentivo</th>
                <th style={S.th}>Noches</th>
                <th style={S.th}>Devengos est.</th>
                <th style={S.th}>IRPF est.</th>
                <th style={S.th}>Liquido est.</th>
                <th style={S.th}>Estado</th>
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                {resumen.map(r=>(
                  <tr key={r.chofer.id} style={{background:r.yaEmitida?"rgba(16,185,129,.03)":"transparent"}}>
                    <td style={{...S.td,fontWeight:700,color:"var(--text)"}}>{r.chofer.nombre} {r.chofer.apellidos||""}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--accent)"}}>{r.vehiculo?.matricula||"—"}</td>
                    <td style={{...S.td,textAlign:"right"}}>{r.pedidos}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:600,color:"#10b981",textAlign:"right"}}>{fmt2(r.ingresos)} €</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",textAlign:"right"}}>{fmt2(r.ext.salario_base||0)} €</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#f59e0b",textAlign:"right"}}>{fmt2(r.incentivo)} €</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#a78bfa",textAlign:"right"}}>{fmt2(r.noches)} €</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:13,textAlign:"right"}}>{fmt2(r.devengos)} €</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#f97316",textAlign:"right",fontWeight:700}}>
                      {r.pctIRPF?.toFixed(1)}%
                    </td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"#10b981",fontWeight:800,textAlign:"right"}}>
                      {fmt2(r.liquidoEst)} €
                    </td>
                    <td style={S.td}>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {r.yaEmitida?(
                          <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:"rgba(16,185,129,.12)",color:"#10b981",border:"1px solid rgba(16,185,129,.25)"}}>Emitida</span>
                        ):(
                          <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:"rgba(251,191,36,.1)",color:"#fbbf24",border:"1px solid rgba(251,191,36,.25)"}}>Pendiente</span>
                        )}
                        {r.faltanJornadas&&(
                          <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,background:"rgba(245,158,11,.12)",color:"#f59e0b",border:"1px solid rgba(245,158,11,.25)"}}>Falta app</span>
                        )}
                      </div>
                    </td>
                    <td style={S.td}>
                      <button onClick={()=>setModal({chofer:r.chofer,vehiculo:r.vehiculo||null,ultimaNomina:r.ultimaNomina})}
                        style={{...S.btn,background:r.yaEmitida?"var(--bg4)":"var(--accent)",color:r.yaEmitida?"var(--text3)":"#fff",border:r.yaEmitida?"1px solid var(--border2)":"none",padding:"4px 10px",fontSize:11}}>
                        {r.yaEmitida?"Ver / Reimprimir":"Preparar nómina"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab==="transparencia"&&(
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start",marginBottom:14,flexWrap:"wrap"}}>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:900,color:"var(--text)"}}>Diagnostico preparatorio de transparencia retributiva</div>
              <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.5,maxWidth:760,marginTop:5}}>
                Panel interno para revisar criterios objetivos, detectar diferencias retributivas por categoria comparable y preparar evidencias antes de la transposicion espanola definitiva.
              </div>
            </div>
            <button onClick={imprimirTransparencia} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>
              Imprimir informe
            </button>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:14}}>
            {[
              ["Categorias analizadas", transparenciaRows.length, "var(--accent)"],
              ["Brechas a revisar", transparenciaAlertas.length, transparenciaAlertas.length?"#f97316":"#10b981"],
              ["Fichas incompletas", transparenciaPendientes.length, transparenciaPendientes.length?"#f59e0b":"#10b981"],
            ].map(([l,v,c])=>(
              <div key={l} style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,padding:"12px 14px"}}>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".07em",fontWeight:800,color:"var(--text5)"}}>{l}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:24,fontWeight:900,color:c,marginTop:4}}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{fontSize:12,color:"var(--text4)",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.2)",borderRadius:8,padding:"10px 12px",marginBottom:14,lineHeight:1.5}}>
            La Directiva UE 2023/970 exige transparencia retributiva, criterios objetivos y seguimiento de diferencias. Este modulo calcula retribucion mensual, anual y hora, marca diferencias internas iguales o superiores al 5% y prepara brecha mujer/hombre cuando las fichas tienen sexo/genero informado. La referencia horaria provisional es {fmt2(HORAS_MES_TRANSPARENCIA)} h/mes hasta configurar el convenio definitivo.
          </div>

          {transparenciaRows.length===0?(
            <div style={{padding:28,textAlign:"center",color:"var(--text5)"}}>Sin datos retributivos suficientes para analizar el periodo.</div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",marginBottom:16}}>
              <thead><tr>
                <th style={S.th}>Categoria</th>
                <th style={S.th}>Choferes</th>
                <th style={S.th}>Promedio mes</th>
                <th style={S.th}>Bruto anual</th>
                <th style={S.th}>Bruto hora</th>
                <th style={S.th}>Min.</th>
                <th style={S.th}>Max.</th>
                <th style={S.th}>Diferencia</th>
                <th style={S.th}>Brecha M/H</th>
                <th style={S.th}>Estado</th>
              </tr></thead>
              <tbody>
                {transparenciaRows.map(r=>(
                  <tr key={r.categoria} style={{background:r.alerta?"rgba(249,115,22,.06)":"transparent"}}>
                    <td style={{...S.td,fontWeight:700,color:"var(--text)"}}>{r.categoria}</td>
                    <td style={{...S.td,textAlign:"right"}}>{r.count}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",textAlign:"right"}}>{fmt2(r.avg)} EUR</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",textAlign:"right"}}>{fmt2(r.avgAnnual)} EUR</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",textAlign:"right"}}>{fmt2(r.avgHour)} EUR/h</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",textAlign:"right"}}>{fmt2(r.min)} EUR</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",textAlign:"right"}}>{fmt2(r.max)} EUR</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",fontWeight:800,color:r.alerta?"#f97316":"#10b981"}}>{fmtPct(r.gapPct)}%</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",textAlign:"right",fontWeight:800,color:r.brechaGeneroPct!==null && Math.abs(r.brechaGeneroPct)>=5?"#f97316":"var(--text4)"}}>
                      {r.brechaGeneroPct===null ? "Sin muestra" : `${fmtPct(r.brechaGeneroPct)}%`}
                    </td>
                    <td style={S.td}>
                      <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,background:r.alerta?"rgba(249,115,22,.12)":"rgba(16,185,129,.12)",color:r.alerta?"#f97316":"#10b981",border:`1px solid ${r.alerta?"rgba(249,115,22,.25)":"rgba(16,185,129,.25)"}`}}>
                        {r.alerta?"Revisar":"OK"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{fontSize:13,fontWeight:800,color:"var(--text)",marginBottom:8}}>Datos laborales pendientes</div>
          {transparenciaPendientes.length===0?(
            <div style={{fontSize:12,color:"#10b981"}}>Todas las fichas tienen los campos basicos necesarios para este diagnostico.</div>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:8}}>
              {transparenciaPendientes.slice(0,12).map(x=>(
                <div key={x.chofer.id} style={{background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.22)",borderRadius:8,padding:"9px 11px"}}>
                  <div style={{fontSize:12,fontWeight:800,color:"var(--text)"}}>{x.chofer.nombre} {x.chofer.apellidos||""}</div>
                  <div style={{fontSize:11,color:"var(--text4)",marginTop:3}}>{x.missing.join(", ")}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==="historial"&&(
        <div style={S.card}>
          {choferes.map(c=>{
            const hist=nominasEmitidas.filter(n=>n.chofer_id===c.id && n.periodo?.startsWith(periodo.slice(0,4)));
            if(hist.length===0) return null;
            return(
              <div key={c.id} style={{marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:8,paddingBottom:6,borderBottom:"1px solid var(--border)"}}>
                  {c.nombre} {c.apellidos||""}
                </div>
                {hist.map(n=>(
                  <div key={n.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid var(--border2)"}}>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:12,color:"var(--accent)",minWidth:80}}>{n.periodo}</span>
                    <span style={{fontSize:12,color:"var(--text4)"}}>Devengos: <strong>{fmt2(n.devengos)} €</strong></span>
                    <span style={{fontSize:12,color:"#10b981"}}>Líquido: <strong>{fmt2(n.liquido)} €</strong></span>
                    <span style={{fontSize:12,color:"var(--text5)",marginLeft:"auto"}}>Emitida: {n.fecha_emision}</span>
                  </div>
                ))}
              </div>
            );
          }).filter(Boolean)}
          {choferes.every(c=>nominasEmitidas.filter(n=>n.chofer_id===c.id && n.periodo?.startsWith(periodo.slice(0,4))).length===0)&&(
            <div style={{padding:30,textAlign:"center",color:"var(--text5)"}}>Sin nóminas emitidas en {periodo.slice(0,4)}</div>
          )}
        </div>
      )}

      {modal&&(
        <ModalNomina
          chofer={modal.chofer}
          vehiculo={modal.vehiculo}
          periodo={periodo}
          pedidos={pedidos}
          facturas={facturas}
          nochesVehiculo={modal.vehiculo ? (nochesPorVehiculo[String(modal.vehiculo.id)] || []) : []}
          jornadasChofer={jornadasPorChofer[String(modal.chofer.id)] || []}
          ultimaNomina={modal.ultimaNomina}
          onClose={()=>setModal(null)}
          onEmitida={(nomina)=>{ setModal(null); if (nomina) setNominasEmitidas(prev => [nomina, ...prev.filter(x => !(x.chofer_id===nomina.chofer_id && x.periodo===nomina.periodo))]); else cargarNominasEmitidas(); if (modal?.vehiculo?.id) cargarNochesVehiculos([modal.vehiculo]).catch(() => {}); }}
        />
      )}
    </div>
  );
}
