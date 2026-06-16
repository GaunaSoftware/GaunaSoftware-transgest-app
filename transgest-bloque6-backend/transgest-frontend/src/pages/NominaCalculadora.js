import { useState, useEffect } from "react";
import { getNominasEmitidas, crearNominaEmitida, borrarNominaEmitida } from "../services/api";
import { getChoferes } from "../services/api";
import { useEmpresaPerfil } from "../hooks/useEmpresaPerfil";
import { saveChoferConfigBackend, useChoferConfig } from "../hooks/useChoferConfig";
import { confirmDialog, notify } from "../services/notify";

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});

function normalizarNominaEmitida(n) {
  const salarioBase = Number(n?.salario_base || n?.datos?.salario_base || 0);
  const plusActividad = Number(n?.plus_actividad || n?.datos?.plus_actividad || 0);
  const horasExtra = Number(n?.horas_extra || n?.datos?.horas_extra || 0);
  const importeNoches = Number(n?.importe_noches || 0);
  const ssTrabajador = Number(n?.ss_trabajador ?? n?.calculo?.ss_trabajador ?? 0);
  const irpf = Number(n?.irpf ?? n?.calculo?.irpf ?? 0);
  const liquido = Number(n?.liquido ?? n?.calculo?.neto ?? 0);
  const totalEmpresa = Number(n?.total_empresa ?? n?.calculo?.coste_empresa ?? 0);
  const ssEmpresa = Number(n?.ss_empresa ?? n?.calculo?.ss_empresa ?? 0);
  const totalBruto = Number(n?.calculo?.total_bruto || salarioBase + plusActividad + horasExtra + importeNoches || liquido + ssTrabajador + irpf);
  const calculo = {
    ...(n?.calculo || {}),
    total_bruto: totalBruto,
    ss_trabajador: ssTrabajador,
    irpf,
    pct_irpf: totalBruto > 0 ? (irpf / totalBruto) * 100 : Number(n?.calculo?.pct_irpf || 0),
    total_deducciones: ssTrabajador + irpf,
    neto: liquido,
    coste_empresa: totalEmpresa,
    ss_empresa: ssEmpresa,
  };
  const datos = {
    ...(n?.datos || {}),
    salario_base: salarioBase,
    plus_actividad: plusActividad,
    horas_extra: Number(n?.datos?.horas_extra || 0),
    precio_hora_extra: Number(n?.datos?.precio_hora_extra || 0),
  };
  return { ...n, calculo, datos };
}

// ── Tablas IRPF 2024/2025 España ──────────────────────────────────────────
// Retención mínima aproximada por tramos de base liquidable
function calcIRPF(baseLiquidable) {
  const tramos = [
    { hasta: 12450,  tipo: 0.19 },
    { hasta: 20200,  tipo: 0.24 },
    { hasta: 35200,  tipo: 0.30 },
    { hasta: 60000,  tipo: 0.37 },
    { hasta: 300000, tipo: 0.45 },
    { hasta: Infinity, tipo: 0.47 },
  ];
  let cuota = 0;
  let anterior = 0;
  for (const t of tramos) {
    if (baseLiquidable <= anterior) break;
    const tramo = Math.min(baseLiquidable, t.hasta) - anterior;
    cuota += tramo * t.tipo;
    anterior = t.hasta;
    if (baseLiquidable <= t.hasta) break;
  }
  return cuota;
}

// SS trabajador 2024: contingencias comunes 4.70%, desempleo 1.55%, FP 0.10%
// SS empresa: contingencias comunes 23.60%, desempleo 5.50%, FP 0.60%, FOGASA 0.20%

// SMI 2024: 1134 €/mes (14 pagas) = 15876 €/año
const SMI_MES = 1134;


const S = {
  page:  { padding:"22px 26px", fontFamily:"'DM Sans',sans-serif", minHeight:"100vh" },
  card:  { background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 18px", marginBottom:14 },
  th:    { textAlign:"left", padding:"8px 12px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text5)", borderBottom:"1px solid var(--border)", whiteSpace:"nowrap" },
  td:    { padding:"9px 12px", borderBottom:"1px solid var(--border2)", fontSize:13, color:"var(--text2)", verticalAlign:"middle" },
  btn:   { padding:"7px 14px", borderRadius:7, border:"none", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", display:"inline-flex", alignItems:"center", gap:5 },
  inp:   { background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"7px 10px", borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" },
  lbl:   { display:"block", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text5)", marginBottom:3, marginTop:10 },
  sec:   { fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", color:"var(--text5)", padding:"10px 0 6px", borderBottom:"1px solid var(--border2)", marginBottom:10 },
};

// ── Modal calculadora nómina ───────────────────────────────────────────────
function ModalNomina({ chofer, nomina, onClose, onSaved }) {
  const empresa = useEmpresaPerfil();
  const choferExt = useChoferConfig(chofer.id);

  const mesActual = new Date().toISOString().slice(0,7);
  const periodoLabel = p => { try { const [y,m]=p.split('-'); return new Date(+y,+m-1,1).toLocaleString('es-ES',{month:'long',year:'numeric'}); } catch{return p;} };
  const [periodo, setPeriodo]   = useState(nomina?.periodo || mesActual);
  const [datos,   setDatos]     = useState(nomina?.datos || {
    // Devengos
    salario_base:            Number(choferExt.salario_base||SMI_MES),
    plus_actividad:          0,
    plus_transporte:         0,
    plus_nocturnidad:        0,
    plus_peligrosidad:       0,
    plus_distancia:          0,
    horas_extra:             0,
    precio_hora_extra:       0,
    pagas_extra_prorrateadas:0,
    incentivos:              0,
    dietas:                  0,
    // Situación personal para IRPF
    hijos:                   0,
    discapacidad:            0,
    tipo_contrato:           "indefinido",
    pct_irpf_manual:         0,
    usar_irpf_manual:        false,
    // Cotización
    grupo_cotizacion:        "5", // Grupo 5: Oficiales 3ª y esp.
    bases_minimas_max:       "manual",
  });

  const d = datos;
  const inp = (k, type="number", step="0.01") => (
    <input type={type} step={step} style={S.inp} value={d[k]||""} onChange={e=>setDatos(p=>({...p,[k]:type==="number"?Number(e.target.value):e.target.value}))}/>
  );

  // ── CÁLCULOS ──────────────────────────────────────────────────────────
  // Total devengos brutos (excluye dietas que no cotizan si < límite)
  const horasExtras = Number(d.horas_extra||0) * Number(d.precio_hora_extra||0);
  const devengos = {
    salario_base:             Number(d.salario_base||0),
    plus_actividad:           Number(d.plus_actividad||0),
    plus_transporte:          Number(d.plus_transporte||0),
    plus_nocturnidad:         Number(d.plus_nocturnidad||0),
    plus_peligrosidad:        Number(d.plus_peligrosidad||0),
    plus_distancia:           Number(d.plus_distancia||0),
    horas_extra:              horasExtras,
    pagas_extra_prorrateadas: Number(d.pagas_extra_prorrateadas||0),
    incentivos:               Number(d.incentivos||0),
    dietas:                   Number(d.dietas||0),
  };

  // Bruto cotizable (sin dietas exentas — límite 26.67€/día España 2024)
  const totalBruto = Object.values(devengos).reduce((s,v)=>s+v,0);
  const dietasExentas = Math.min(devengos.dietas, 26.67 * 30); // máx exento
  const baseCotizacion = totalBruto - dietasExentas;

  // Bases de cotización SS
  // Grupos cotización transportistas: típicamente grupo 5 (base min ~1323€, max ~4720€ 2024)
  const BASES_GRUPOS = {
    "1": { min: 1847.40, max: 4720.50, label: "Grupo 1 — Ingenieros, Licenciados" },
    "2": { min: 1530.90, max: 4720.50, label: "Grupo 2 — Ingenieros técnicos" },
    "3": { min: 1334.40, max: 4720.50, label: "Grupo 3 — Jefes admin. y taller" },
    "4": { min: 1323.00, max: 4720.50, label: "Grupo 4 — Ayudantes no titulados" },
    "5": { min: 1323.00, max: 4720.50, label: "Grupo 5 — Oficiales 3ª y esp. (Chóferes)" },
    "6": { min: 1323.00, max: 4720.50, label: "Grupo 6 — Peones" },
    "7": { min: 1323.00, max: 4720.50, label: "Grupo 7 — Trabajadores mayores 18" },
  };
  const grupo = BASES_GRUPOS[d.grupo_cotizacion] || BASES_GRUPOS["5"];
  const baseCC = Math.max(Math.min(baseCotizacion, grupo.max), grupo.min);

  // Cuotas SS trabajador
  const ssCC_trab  = baseCC * 0.047;   // 4.70% contingencias comunes
  const ssDesempleo_trab = baseCC * 0.0155; // 1.55%
  const ssFP_trab  = baseCC * 0.001;   // 0.10% FP
  const totalSS_trab = ssCC_trab + ssDesempleo_trab + ssFP_trab;

  // Cuotas SS empresa
  const ssCC_emp   = baseCC * 0.236;   // 23.60%
  const ssDesempleo_emp = baseCC * 0.055; // 5.50%
  const ssFP_emp   = baseCC * 0.006;   // 0.60%
  const ssFogasa   = baseCC * 0.002;   // 0.20%
  const ssAT       = baseCC * 0.0155;  // AT/EP (transporte: 1.55%)
  const totalSS_emp = ssCC_emp + ssDesempleo_emp + ssFP_emp + ssFogasa + ssAT;

  // IRPF
  const baseLiquidableAnual = (baseCotizacion - totalSS_trab) * 12;
  const cuotaAnualIRPF = calcIRPF(baseLiquidableAnual);
  const tipoEfectivo = baseLiquidableAnual > 0 ? (cuotaAnualIRPF / baseLiquidableAnual) * 100 : 0;
  const pctIRPF = d.usar_irpf_manual ? Number(d.pct_irpf_manual||0) : Math.max(tipoEfectivo, 2); // mínimo 2%
  const retencionIRPF = baseCotizacion * (pctIRPF / 100);

  // TOTALES
  const totalDeducciones = totalSS_trab + retencionIRPF;
  const netoPercibir = totalBruto - totalDeducciones;
  const costeEmpresa = totalBruto + totalSS_emp;

  async function guardar() {
    const nomObj = {
      id:       nomina?.id || `nom_${Date.now()}`,
      periodo,
      datos:    d,
      calculo: {
        total_bruto:       totalBruto,
        base_cotizacion:   baseCC,
        ss_trabajador:     totalSS_trab,
        irpf:              retencionIRPF,
        pct_irpf:          pctIRPF,
        total_deducciones: totalDeducciones,
        neto:              netoPercibir,
        coste_empresa:     costeEmpresa,
        ss_empresa:        totalSS_emp,
      },
      fecha_calculo: new Date().toISOString(),
    };
    let savedNomina = nomObj;
    try {
      const apiNomina = await crearNominaEmitida({
        chofer_id: chofer.id,
        periodo: periodo,
        salario_base: datos.salario_base||0,
        plus_actividad: datos.plus_actividad||0,
        horas_extra: (datos.horas_extra||0)*(datos.precio_hora_extra||0),
        noches: 0,
        importe_noches: 0,
        ss_empresa: totalSS_emp,
        ss_trabajador: totalSS_trab,
        irpf: retencionIRPF,
        liquido: netoPercibir,
        total_empresa: costeEmpresa,
      });
      if (apiNomina && typeof apiNomina === "object") {
        savedNomina = normalizarNominaEmitida({ ...nomObj, ...apiNomina, datos: d, calculo: nomObj.calculo });
      }
    } catch(e) { console.error(e); }
    // Also update chofer_ext with latest salary
    try {
      await saveChoferConfigBackend(chofer.id, {
        salario_base: datos.salario_base || choferExt.salario_base || 0,
        incentivo_pct: choferExt.incentivo_pct || 0,
      });
    } catch(e) { console.error(e); }
    onSaved(savedNomina);
  }

  function imprimir() {
    const w = window.open("","_blank","width=800,height=1000");
    const rows = [
      ["DEVENGOS","",""],
      ["Salario base","1",fmt2(d.salario_base)+" €"],
      ...(d.plus_actividad>0?[["Plus de actividad/transporte","1",fmt2(d.plus_actividad)+" €"]]:[]),
      ...(d.plus_transporte>0?[["Plus extrasalarial transporte","1",fmt2(d.plus_transporte)+" €"]]:[]),
      ...(d.plus_nocturnidad>0?[["Plus nocturnidad","1",fmt2(d.plus_nocturnidad)+" €"]]:[]),
      ...(d.plus_peligrosidad>0?[["Plus peligrosidad/penosidad","1",fmt2(d.plus_peligrosidad)+" €"]]:[]),
      ...(d.plus_distancia>0?[["Plus distancia/desplazamiento","1",fmt2(d.plus_distancia)+" €"]]:[]),
      ...(horasExtras>0?[["Horas extraordinarias ("+d.horas_extra+"h × "+fmt2(d.precio_hora_extra)+"€)","1",fmt2(horasExtras)+" €"]]:[]),
      ...(d.pagas_extra_prorrateadas>0?[["Pagas extraordinarias prorrateadas","1",fmt2(d.pagas_extra_prorrateadas)+" €"]]:[]),
      ...(d.incentivos>0?[["Incentivos / Comisiones","1",fmt2(d.incentivos)+" €"]]:[]),
      ...(d.dietas>0?[["Dietas y gastos locomoción","1",fmt2(d.dietas)+" €"]]:[]),
      ["TOTAL DEVENGADO","",""+fmt2(totalBruto)+" €"],
      ["DEDUCCIONES","",""],
      ["Contingencias comunes (4,70%)",""+fmt2(baseCC)+" €","-"+fmt2(ssCC_trab)+" €"],
      ["Desempleo (1,55%)",""+fmt2(baseCC)+" €","-"+fmt2(ssDesempleo_trab)+" €"],
      ["Formación profesional (0,10%)",""+fmt2(baseCC)+" €","-"+fmt2(ssFP_trab)+" €"],
      ["IRPF ("+fmt2(pctIRPF)+"%)",""+fmt2(baseCotizacion)+" €","-"+fmt2(retencionIRPF)+" €"],
      ["TOTAL DEDUCCIONES","","-"+fmt2(totalDeducciones)+" €"],
    ];
    w.document.write(`<!DOCTYPE html><html><head><title>Nómina ${periodo} — ${chofer.nombre}</title>
    <style>body{font-family:Arial,sans-serif;padding:32px;color:#111;font-size:12px}
    h1{font-size:16px;margin:0}table{width:100%;border-collapse:collapse}
    th{background:#f5f5f5;border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase}
    td{border:1px solid #eee;padding:6px 10px}
    .header{display:flex;justify-content:space-between;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #333}
    .neto{background:#f0fdf4;border:2px solid #86efac;padding:10px 16px;text-align:right;margin-top:10px;border-radius:6px}
    .seccion{background:#f8f8f8;font-weight:bold;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666}
    .total-row{font-weight:bold;background:#f0f0f0}
    .empresa-info{font-size:11px;color:#555;margin-top:4px}
    </style></head><body>
    <div class="header">
      <div>
        <h1>RECIBO DE SALARIOS</h1>
        <div class="empresa-info">${empresa.razon_social||"Empresa"} · CIF: ${empresa.cif||"—"}</div>
        <div class="empresa-info">${empresa.domicilio||""} ${empresa.municipio||""}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:bold">Período: ${periodoLabel(periodo)}</div>
        <div class="empresa-info">Trabajador: ${chofer.nombre} ${chofer.apellidos||""}</div>
        <div class="empresa-info">DNI/NIE: ${chofer.dni||"—"}</div>
        <div class="empresa-info">Categoría: ${chofer.categoria||"Chófer"} · Grupo ${d.grupo_cotizacion}</div>
        <div class="empresa-info">Tipo contrato: ${d.tipo_contrato||"Indefinido"}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>Concepto</th><th style="text-align:right">Base / Referencia</th><th style="text-align:right">Importe</th></tr></thead>
      <tbody>
      ${rows.map(r=>{
        const isHeader = r[0]==="DEVENGOS"||r[0]==="DEDUCCIONES";
        const isTotal  = r[0].startsWith("TOTAL");
        if(isHeader) return `<tr><td colspan="3" class="seccion">${r[0]}</td></tr>`;
        if(isTotal)  return `<tr class="total-row"><td><strong>${r[0]}</strong></td><td></td><td style="text-align:right"><strong>${r[2]}</strong></td></tr>`;
        return `<tr><td>${r[0]}</td><td style="text-align:right;color:#666">${r[1]}</td><td style="text-align:right">${r[2]}</td></tr>`;
      }).join("")}
      </tbody>
    </table>
    <div class="neto">
      <div style="font-size:13px;color:#555">LÍQUIDO A PERCIBIR</div>
      <div style="font-size:26px;font-weight:bold;color:#166534">${fmt2(netoPercibir)} €</div>
    </div>
    <div style="margin-top:16px;padding:10px;background:#fef9c3;border:1px solid #fde68a;border-radius:6px;font-size:10px;color:#92400e">
      <strong>Coste total para la empresa:</strong> ${fmt2(costeEmpresa)} € 
      (incluye cuotas patronales SS: ${fmt2(totalSS_emp)} €)
    </div>
    <div style="display:flex;gap:60px;margin-top:40px">
      <div style="flex:1;border-top:1px solid #333;padding-top:8px;font-size:11px;color:#555">Firma del trabajador<br/><br/>${chofer.nombre} ${chofer.apellidos||""}</div>
      <div style="flex:1;border-top:1px solid #333;padding-top:8px;font-size:11px;color:#555">Por la empresa<br/><br/>${empresa.razon_social||""}</div>
    </div>
    </body></html>`);
    w.document.close(); w.focus(); setTimeout(()=>w.print(),400);
  }

  const rowStyle = { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:"1px solid var(--border2)", fontSize:12 };
  const valStyle = { fontFamily:"'JetBrains Mono',monospace", fontWeight:700 };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:300,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:16,overflowY:"auto"}}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:22,width:"min(820px,96vw)",margin:"auto"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,color:"var(--text)"}}>Nomina - {chofer.nombre} {chofer.apellidos||""}</div>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>Calculadora conforme al ET y SS España 2024/2025</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:13,cursor:"pointer"}}>Cerrar</button>
        </div>

        {/* Período */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
          <div>
            <label style={S.lbl}>Período</label>
            <input type="month" style={S.inp} value={periodo} onChange={e=>setPeriodo(e.target.value)} placeholder="Ej: Enero 2026"/>
          </div>
          <div>
            <label style={S.lbl}>Tipo de contrato</label>
            <select style={S.inp} value={d.tipo_contrato} onChange={e=>setDatos(p=>({...p,tipo_contrato:e.target.value}))}>
              <option value="indefinido">Indefinido</option>
              <option value="temporal">Temporal / obra y servicio</option>
              <option value="fijo_discontinuo">Fijo discontinuo</option>
              <option value="practicas">Prácticas / formación</option>
            </select>
          </div>
          <div>
            <label style={S.lbl}>Grupo cotización SS</label>
            <select style={S.inp} value={d.grupo_cotizacion} onChange={e=>setDatos(p=>({...p,grupo_cotizacion:e.target.value}))}>
              {Object.entries(BASES_GRUPOS).map(([k,v])=><option key={k} value={k}>{k} — {v.label.split("—")[1]?.trim()}</option>)}
            </select>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
          {/* Columna izquierda: Devengos */}
          <div>
            <div style={S.sec}>Devengos salariales</div>

            <label style={S.lbl}>Salario base (€/mes)</label>
            {inp("salario_base")}
            <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>SMI 2024: {fmt2(SMI_MES)} €/mes</div>

            <label style={S.lbl}>Plus de actividad / transporte (€)</label>
            {inp("plus_actividad")}

            <label style={S.lbl}>Plus nocturno (€)</label>
            {inp("plus_nocturnidad")}

            <label style={S.lbl}>Plus peligrosidad / penosidad (€)</label>
            {inp("plus_peligrosidad")}

            <label style={S.lbl}>Plus distancia / desplazamiento (€)</label>
            {inp("plus_distancia")}

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <label style={S.lbl}>Horas extra (nº horas)</label>
                {inp("horas_extra","number","1")}
              </div>
              <div>
                <label style={S.lbl}>Precio hora extra (€/h)</label>
                {inp("precio_hora_extra")}
              </div>
            </div>

            <label style={S.lbl}>Pagas extra prorrateadas (€)</label>
            {inp("pagas_extra_prorrateadas")}
            <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Si no se prorratean, déjalo a 0 (se emiten en junio/diciembre)</div>

            <label style={S.lbl}>Incentivos / Comisiones (€)</label>
            {inp("incentivos")}

            <div style={S.sec}>Dietas y gastos extrasalariales</div>
            <label style={S.lbl}>Dietas / gastos locomoción (€)</label>
            {inp("dietas")}
            <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Exentas SS hasta 26,67 €/día. Exentas IRPF si desplazamiento laboral.</div>

            <label style={S.lbl}>Plus extrasalarial transporte (€)</label>
            {inp("plus_transporte")}
            <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>No computa en base cotización (transporte al trabajo)</div>
          </div>

          {/* Columna derecha: IRPF + Resultado */}
          <div>
            <div style={S.sec}>IRPF y situacion personal</div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <label style={S.lbl}>Hijos / descendientes</label>
                {inp("hijos","number","1")}
              </div>
              <div>
                <label style={S.lbl}>Discapacidad (%)</label>
                {inp("discapacidad","number","1")}
              </div>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10,marginBottom:4}}>
              <input type="checkbox" checked={!!d.usar_irpf_manual} onChange={e=>setDatos(p=>({...p,usar_irpf_manual:e.target.checked}))} id="irpf_manual"/>
              <label htmlFor="irpf_manual" style={{fontSize:12,color:"var(--text3)",cursor:"pointer"}}>Fijar retención IRPF manualmente</label>
            </div>
            {d.usar_irpf_manual ? (
              <>
                <label style={S.lbl}>Retención IRPF manual (%)</label>
                {inp("pct_irpf_manual")}
              </>
            ) : (
              <div style={{background:"var(--bg3)",borderRadius:7,padding:"8px 12px",fontSize:11,color:"var(--text4)"}}>
                IRPF calculado automáticamente: <strong style={{color:"var(--accent-xl)"}}>{fmt2(pctIRPF)}%</strong>
                <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Tipo efectivo anual estimado sobre base liquidable {fmt2(baseCotizacion - totalSS_trab)}/mes</div>
              </div>
            )}

            {/* ── RESUMEN RESULTADO ── */}
            <div style={S.sec}>Resultado nomina</div>

            <div style={{background:"var(--bg3)",borderRadius:10,padding:"12px 14px"}}>
              {[
                ["Total devengado (bruto)",      fmt2(totalBruto)+" €",       "var(--text)"],
                ["─ Base cotización SS",          fmt2(baseCC)+" €",           "var(--text4)"],
                ["─ Contingencias comunes 4,70%", "-"+fmt2(ssCC_trab)+" €",   "var(--red)"],
                ["─ Desempleo 1,55%",             "-"+fmt2(ssDesempleo_trab)+" €","var(--red)"],
                ["─ FP 0,10%",                   "-"+fmt2(ssFP_trab)+" €",    "var(--red)"],
                ["─ Retención IRPF "+fmt2(pctIRPF)+"%","-"+fmt2(retencionIRPF)+" €","var(--red)"],
                ["= LÍQUIDO A PERCIBIR",          fmt2(netoPercibir)+" €",     "#10b981"],
              ].map(([l,v,c])=>(
                <div key={l} style={{...rowStyle,borderBottom: l.startsWith("=")?"none":"1px solid var(--border2)"}}>
                  <span style={{color:l.startsWith("=")||l.startsWith("Total")?"var(--text)":"var(--text4)",fontWeight:l.startsWith("=")||l.startsWith("Total")?700:400}}>{l}</span>
                  <span style={{...valStyle,color:c,fontSize:l.startsWith("=")?16:12}}>{v}</span>
                </div>
              ))}
            </div>

            {/* Coste empresa */}
            <div style={{marginTop:10,background:"rgba(239,68,68,.07)",border:"1px solid rgba(239,68,68,.2)",borderRadius:9,padding:"10px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--red)",marginBottom:6}}>Coste total empresa</div>
              {[
                ["Salario bruto",               fmt2(totalBruto)],
                ["SS empresa (CC 23,60%)",       fmt2(ssCC_emp)],
                ["SS empresa (Desempleo 5,50%)", fmt2(ssDesempleo_emp)],
                ["SS empresa (FP 0,60%)",        fmt2(ssFP_emp)],
                ["SS empresa (AT/EP 1,55%)",     fmt2(ssAT)],
                ["FOGASA (0,20%)",               fmt2(ssFogasa)],
              ].map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text4)",padding:"2px 0"}}>
                  <span>{l}</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{v} €</span>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:14,fontWeight:800,color:"var(--red)",marginTop:6,paddingTop:6,borderTop:"1px solid rgba(239,68,68,.2)"}}>
                <span>TOTAL COSTE EMPRESA</span>
                <span style={{fontFamily:"'JetBrains Mono',monospace"}}>{fmt2(costeEmpresa)} €</span>
              </div>
            </div>

            <div style={{marginTop:10,display:"flex",gap:8}}>
              <button onClick={guardar} style={{...S.btn,background:"var(--accent)",color:"#fff",flex:1,justifyContent:"center",fontWeight:700,fontSize:13}}>
                Guardar nomina
              </button>
              <button onClick={imprimir} style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text3)"}}>
                Imprimir
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
export default function NominaCalculadora() {
  const [choferes,   setChoferes]   = useState([]);
  const [choferSel,  setChoferSel]  = useState("");
  const [nominas,    setNominas]    = useState([]);
  const [modalNom,   setModalNom]   = useState(null); // null | {chofer, nomina?}
  const [loading,    setLoading]    = useState(true);

  useEffect(()=>{
    const _t = (p,ms=8000) => Promise.race([p, new Promise(r=>setTimeout(()=>r([]),ms))]);
    _t(getChoferes().catch(()=>[])).then(d=>{
      const arr = Array.isArray(d)?d:[];
      setChoferes(arr);
      if(arr.length>0) setChoferSel(arr[0].id);
    }).finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{
    if(!choferSel) return;
    setNominas([]);
    getNominasEmitidas({chofer_id: choferSel}).then(d=>{
      setNominas(Array.isArray(d) ? d.map(normalizarNominaEmitida) : []);
    }).catch(()=>{});
  },[choferSel]);

  const chofer = choferes.find(c=>c.id===choferSel);
  const choferExt = useChoferConfig(chofer?.id);

  function onSaved(nom) {
    setNominas(prev => {
      const next = Array.isArray(prev) ? [...prev] : [];
      const idx = next.findIndex(n => n.id===nom.id || n.periodo===nom.periodo);
      if (idx >= 0) next[idx] = nom;
      else next.unshift(nom);
      return next;
    });
    setModalNom(null);
  }

  async function eliminar(id) {
    const ok = await confirmDialog({
      title: "Eliminar nomina",
      message: "Eliminar esta nomina calculada?",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await borrarNominaEmitida(id);
      setNominas(nominas.filter(n=>n.id!==id));
      notify("Nomina eliminada", "success");
    } catch (e) {
      notify("No se pudo eliminar la nomina: " + e.message, "error");
    }
  }

  return (
    <div style={S.page}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:900,color:"var(--text)"}}>Calculadora de nominas</div>
        <div style={{fontSize:12,color:"var(--text4)",marginLeft:4}}>Conforme ET, SS y IRPF España 2024/2025</div>
        <select value={choferSel} onChange={e=>setChoferSel(e.target.value)}
          style={{...S.inp,width:"auto",minWidth:200,marginLeft:"auto",fontWeight:700}}>
          {choferes.map(c=><option key={c.id} value={c.id}>{c.nombre} {c.apellidos||""}</option>)}
        </select>
        {chofer && (
          <button onClick={()=>setModalNom({chofer})} style={{...S.btn,background:"var(--accent)",color:"#fff",fontWeight:700}}>
            + Nueva nomina
          </button>
        )}
      </div>

      {loading && <div style={{color:"var(--text5)",padding:40,textAlign:"center"}}>Cargando...</div>}

      {!loading && chofer && (
        <>
          {/* Info chófer */}
          <div style={{...S.card,display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:800,fontSize:16,color:"var(--text)"}}>{chofer.nombre} {chofer.apellidos||""}</div>
              <div style={{fontSize:12,color:"var(--text4)"}}>{chofer.categoria||"Chofer"} - {chofer.tipo_contrato||"Sin contrato"}</div>
            </div>
            {choferExt.salario_base && (
              <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 14px"}}>
                <div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".06em"}}>Salario base configurado</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color:"var(--green)"}}>{fmt2(choferExt.salario_base)} EUR/mes</div>
              </div>
            )}
            {choferExt.incentivo_pct>0 && (
              <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 14px"}}>
                <div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".06em"}}>Incentivo</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color:"#f59e0b"}}>{choferExt.incentivo_pct}%</div>
              </div>
            )}
          </div>

          {/* Historial nominas */}
          <div style={S.card}>
            <div style={{fontWeight:700,fontSize:12,color:"var(--text4)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:12}}>
              Historial de nominas calculadas ({nominas.length})
            </div>
            {nominas.length===0 ? (
              <div style={{padding:20,textAlign:"center",color:"var(--text5)"}}>
                Sin nominas calculadas. Usa "Nueva nomina" para calcular y guardar.
              </div>
            ) : (
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr>
                  <th style={S.th}>Periodo</th>
                  <th style={S.th}>Bruto</th>
                  <th style={S.th}>SS trab.</th>
                  <th style={S.th}>IRPF</th>
                  <th style={S.th}>Neto</th>
                  <th style={S.th}>Coste empresa</th>
                  <th style={S.th}></th>
                </tr></thead>
                <tbody>
                  {nominas.map(n=>(
                    <tr key={n.id}>
                      <td style={{...S.td,fontWeight:700,color:"var(--text)"}}>{n.periodo}</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace"}}>{fmt2(n.calculo?.total_bruto||0)} EUR</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"var(--red)"}}>{fmt2(n.calculo?.ss_trabajador||0)} EUR</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"var(--red)"}}>{fmt2(n.calculo?.irpf||0)} EUR ({fmt2(n.calculo?.pct_irpf||0)}%)</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:"var(--green)",fontSize:14}}>{fmt2(n.calculo?.neto||0)} EUR</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"var(--red)"}}>{fmt2(n.calculo?.coste_empresa||0)} EUR</td>
                      <td style={S.td}>
                        <div style={{display:"flex",gap:5}}>
                          <button onClick={()=>setModalNom({chofer,nomina:n})} style={{...S.btn,padding:"3px 9px",background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text3)",fontSize:11}}>Editar</button>
                          <button onClick={()=>eliminar(n.id)} style={{...S.btn,padding:"3px 9px",background:"rgba(239,68,68,.1)",color:"var(--red)",border:"none",fontSize:11}}>Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Info legal */}
          <div style={{background:"rgba(59,130,246,.06)",border:"1px solid rgba(59,130,246,.15)",borderRadius:10,padding:"12px 16px",fontSize:11,color:"var(--text4)",lineHeight:1.6}}>
            <strong style={{color:"var(--accent-xl)"}}>ℹ️ Conceptos calculados</strong> conforme al Estatuto de los Trabajadores, 
            bases de cotización SS 2024 y tabla IRPF 2024/2025. 
            Tipos SS trabajador: CC 4,70% + Desempleo 1,55% + FP 0,10% = 6,35% total. 
            Tipos SS empresa: CC 23,60% + Desempleo 5,50% + FP 0,60% + AT/EP 1,55% + FOGASA 0,20% = 31,45%.
            <strong style={{color:"#fbbf24"}}> Este calculo es orientativo - consulta con tu gestor para nominas oficiales.</strong>
          </div>
        </>
      )}

      {modalNom && (
        <ModalNomina
          chofer={modalNom.chofer}
          nomina={modalNom.nomina||null}
          onClose={()=>setModalNom(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
