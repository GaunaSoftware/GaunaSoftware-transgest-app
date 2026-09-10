import React, { useEffect, useRef, useState } from 'react';
import { getIntelligenceStatus, queryIntelligence } from '../services/api';
import './Intelligence.css';

export default function Intelligence() {
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const last = useRef(null);
  const generation = useRef(0);
  useEffect(() => {
    const currentGeneration = generation;
    let active = true;
    getIntelligenceStatus().then(s => active && setStatus(s)).catch(e => active && setError(e.message));
    return () => { active = false; currentGeneration.current++; };
  }, []);
  useEffect(() => { last.current?.scrollIntoView({ block: 'nearest' }); }, [messages,busy]);
  async function send(event) {
    event.preventDefault();
    if (!draft.trim() || busy || !status?.configured) return;
    const content = draft.trim();
    const history = [...messages.map(({role,content}) => ({role,content})), {role:'user',content}];
    if (history.length > 16) { setError('Inicia una nueva consulta para continuar.'); return; }
    const run = ++generation.current;
    setBusy(true); setError(''); setDraft('');
    setMessages(history);
    try {
      const result = await queryIntelligence({ messages:history });
      if (run !== generation.current) return;
      setMessages([...history, {role:'assistant', content:result.answer, sources:result.sources, checked_at:result.checked_at}]);
    } catch (e) {
      if (run !== generation.current) return;
      setMessages(history.slice(0,-1)); setDraft(content); setError(e.message);
    } finally { if (run === generation.current) setBusy(false); }
  }
  const suggestions = [
    'Que pedidos pendientes tenemos para hoy?',
    'Que vehiculos tienen viajes asignados hoy?',
    'Resume los viajes realizados y pendientes de facturar de este mes.',
  ];
  return <section className="intelligence">
    <header className="intelligence-header">
      <div><h1>TransGest Intelligence</h1><span>Consulta de empresa · Solo lectura</span></div>
      <button type="button" disabled={busy || !messages.length} onClick={() => {setMessages([]);setError('');setDraft('');}}>Nueva consulta</button>
    </header>
    <div className="intelligence-status" role="status">{status ? (status.configured ? `OpenAI · ${status.model} · ${status.source === 'company' ? 'Clave de empresa' : 'Clave general'}` : 'OpenAI pendiente de configurar en Superadmin > Integraciones') : 'Comprobando integracion...'}</div>
    {!messages.length && <div className="intelligence-start">
      <h2>Que necesitas revisar?</h2>
      <div className="intelligence-suggestions">{suggestions.map(s => <button type="button" key={s} onClick={() => setDraft(s)}>{s}</button>)}</div>
    </div>}
    <div className="intelligence-messages" role="log" aria-label="Conversacion">
      {messages.map((m,i) => <article key={i} className={`intelligence-message ${m.role}`}>
        <strong>{m.role === 'user' ? 'Tu consulta' : 'TransGest Intelligence'}</strong><div className="intelligence-answer">{m.content}</div>
        {!!m.sources?.length && <details><summary>Fuentes consultadas ({m.sources.length})</summary>
          <ul>{m.sources.map((s,n) => <li key={n}>{s.name}: {Object.entries(s.filters).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(' · ')}{s.limited ? ' · Lista parcial' : ''}</li>)}</ul>
          <small>{new Date(m.checked_at).toLocaleString('es-ES')}</small>
        </details>}
      </article>)}
      {busy && <p role="status">Consultando datos de tu empresa...</p>}<div ref={last}/>
    </div>
    {error && <div className="intelligence-error" role="alert">{error}</div>}
    <form className="intelligence-compose" onSubmit={send}>
      <label htmlFor="intelligence-question">Consulta</label>
      <textarea id="intelligence-question" value={draft} maxLength={4000} rows={3} disabled={busy} onChange={e=>setDraft(e.target.value)} placeholder="Pedido, matricula, periodo o pregunta..."/>
      <div><small>{draft.length}/4000 · Las respuestas pueden contener errores. Verifica antes de actuar.</small><button type="submit" disabled={busy || !draft.trim() || !status?.configured}>{busy ? 'Consultando...' : 'Consultar'}</button></div>
    </form>
  </section>;
}
