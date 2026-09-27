import IntelligenceAnswer from '../components/IntelligenceAnswer';
import React, { useEffect, useRef, useState } from 'react';
import { getIntelligenceStatus, queryIntelligence } from '../services/api';
import './Intelligence.css';
import { openNotice } from '../services/noticeNavigation';

const ASSISTANCE = [
  {tool:'buscar_pedidos',title:'Preparar la jornada',description:'Prioridades, asignaciones y ventanas de carga.',prompt:'Revisa los pedidos abiertos de hoy. Prepara una tabla con cliente, ruta, ventanas de carga y descarga, asignación e incidencias. Ordena qué debemos revisar primero y explica el motivo sin suponer retrasos reales.'},
  {tool:'vencimientos_empresa',title:'Cobros por revisar',description:'Facturas vencidas y borradores de reclamación.',prompt:'Consulta las facturas vencidas disponibles en Avisos. Resume cliente, factura, fecha e importe. Aclara las limitaciones del saldo y sugiere prioridades de seguimiento. No envíes mensajes.'},
  {tool:'vencimientos_empresa',title:'Documentación al día',description:'Vehículos, remolques, conductores y plataformas.',prompt:'Revisa los vencimientos documentales, excluyendo facturas. Agrupa vehículos, remolques, conductores y plataformas, distingue vencidos y próximos, y prepara una lista de acciones con los registros que tengo que abrir.'},
  {tool:'analisis_rentabilidad',title:'Entender la rentabilidad',description:'Ingresos, costes registrados, vacíos y cobertura.',prompt:'Analiza la rentabilidad del mes actual con el servicio BI común. Compara ingresos realizados, margen directo y resultado con los costes disponibles, kilómetros vacíos y resultados por camión y cliente. Señala gastos sin valorar y tres acciones justificadas. No llames beneficio neto a un margen parcial.'},
  {tool:'buscar_pedidos',title:'Revisar servicios',description:'Localizar pedidos, incidencias y datos que faltan.',prompt:'Revisa los pedidos abiertos de este mes. Identifica incidencias registradas, servicios sin asignación y ventanas no informadas; distingue los datos ausentes de problemas confirmados. Indica total y alcance de la lista.'},
  {tool:'disponibilidad_flota',title:'Consultar la flota',description:'Ocupación registrada para planificar el trabajo.',prompt:'¿Qué vehículos tienen viajes asignados hoy? Distingue ocupación registrada, vehículos en taller y datos que hay que confirmar antes de asignar, sin suponer disponibilidad física ni posición GPS.'},
];

export default function Intelligence() {
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const last = useRef(null);
  const generation = useRef(0);
  const available = Boolean(status?.configured) && status?.available !== false;
  useEffect(() => {
    const currentGeneration = generation;
    let active = true;
    getIntelligenceStatus().then(s => active && setStatus(s)).catch(e => active && setError(e.message));
    return () => { active = false; currentGeneration.current++; };
  }, []);
  useEffect(() => { last.current?.scrollIntoView({ block: 'nearest' }); }, [messages,busy]);
  async function send(event) {
    event.preventDefault();
    if (!draft.trim() || busy || !available) return;
    const content = draft.trim();
    const history = [...messages, {role:'user',content}];
    if (history.length > 16) { setError('Inicia una nueva consulta para continuar.'); return; }
    const run = ++generation.current;
    setBusy(true); setError(''); setDraft('');
    setMessages(history);
    try {
      const result = await queryIntelligence({ messages:history.map(({role,content})=>({role,content})) });
      if (run !== generation.current) return;
      setMessages([...history, {role:'assistant', content:result.answer, sources:result.sources, references:result.references, checked_at:result.checked_at}]);
    } catch (e) {
      if (run !== generation.current) return;
      setMessages(history.slice(0,-1)); setDraft(content); setError(e.message);
    } finally { if (run === generation.current) setBusy(false); }
  }
  const suggestions = ASSISTANCE.filter(s => status?.tools?.includes(s.tool));
  return <section className="intelligence">
    <header className="intelligence-header">
      <div><h1>TransGest Intelligence</h1><span>Ayuda para decidir, planificar y revisar tu empresa</span></div>
      <button type="button" disabled={busy || !messages.length} onClick={() => {setMessages([]);setError('');setDraft('');}}>Nueva consulta</button>
    </header>
    <div className="intelligence-status" role="status">{status ? (status.message || (available ? 'TransGest Intelligence · Consultas sobre los datos de tu empresa' : 'Intelligence pendiente de configuración. Contacta con administración.')) : 'Comprobando disponibilidad…'}</div>
    {status && <p className="intelligence-scope">Solo consulta los módulos que tienes autorizados. Puede analizar y preparar borradores; revisa las propuestas antes de actuar. {status.remaining != null && <strong>{status.remaining} consultas disponibles</strong>}</p>}
    {!messages.length && <div className="intelligence-start">
      <h2>¿Qué necesitas revisar?</h2>
      <div className="intelligence-suggestions">{suggestions.map(s => <button type="button" key={s.title} onClick={() => {setDraft(s.prompt);document.getElementById('intelligence-question')?.focus();}}><strong>{s.title}</strong><span>{s.description}</span><small>Preparar consulta →</small></button>)}</div>
    </div>}
    <div className="intelligence-messages" role="log" aria-label="Conversación">
      {messages.map((m,i) => <article key={i} className={`intelligence-message ${m.role}`}>
        <strong>{m.role === 'user' ? 'Tu consulta' : 'TransGest Intelligence'}</strong><div className="intelligence-answer">{m.role === 'assistant' ? <IntelligenceAnswer content={m.content}/> : m.content}</div>
        {!!m.references?.length && <details className="intelligence-references"><summary>Abrir registros consultados (hasta 40)</summary><div>{m.references.map((r,j)=><button key={j} type="button" onClick={()=>openNotice(r)}>{r.label || r.title || 'Ver registro'}</button>)}</div></details>}
        {!!m.sources?.length && <details><summary>Fuentes consultadas ({m.sources.length})</summary>
          <ul>{m.sources.map((s,n) => <li key={n}>{s.name}: {Object.entries(s.filters || {}).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(' · ')}{s.total != null ? ` · ${s.total} registros en total` : ''}{s.page ? ` · Página ${s.page}` : ''}{s.limited ? ' · Lista parcial' : ''}{typeof s.coverage==='string'?` · Cobertura: ${s.coverage}`:''}{s.errors?.length?' · Hay fuentes no disponibles':''}</li>)}</ul>
          <small>{new Date(m.checked_at).toLocaleString('es-ES')}</small>
        </details>}
      </article>)}
      {busy && <p role="status">Consultando datos de tu empresa...</p>}<div ref={last}/>
    </div>
    {error && <div className="intelligence-error" role="alert">{error}</div>}
    <form className="intelligence-compose" onSubmit={send}>
      <label htmlFor="intelligence-question">Consulta</label>
      <textarea id="intelligence-question" value={draft} maxLength={4000} rows={3} disabled={busy} onChange={e=>setDraft(e.target.value)} placeholder="Pedido, matricula, periodo o pregunta..."/>
      <div><small>{draft.length}/4000 · Las respuestas pueden contener errores. Verifica antes de actuar.</small><button type="submit" disabled={busy || !draft.trim() || !available}>{busy ? 'Consultando...' : 'Consultar'}</button></div>
    </form>
  </section>;
}
