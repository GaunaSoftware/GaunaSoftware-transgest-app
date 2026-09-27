import { useEffect, useState } from 'react';
import { getAgendaPreferences, saveAgendaPreferences, getCentroAvisos } from '../services/api';
import { NoticeList } from './NoticeCenter';
import { Button } from '../ui';
import { useAuth } from '../context/AuthContext';
import '../pages/Avisos.css';

export default function AgendaNotices() {
  const {user} = useAuth();
  const [prefs,setPrefs] = useState(null), [selected,setSelected] = useState([]);
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [data,setData] = useState(null), [revision,setRevision] = useState(0);
  useEffect(()=>{
    let active=true; setPrefs(null); setData(null); setError('');
    getAgendaPreferences().then(p=>{if(active){setPrefs(p);setSelected(p.notice_types);}}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[user?.id,user?.empresa_id]);
  const types = JSON.stringify(prefs?.notice_types || []);
  useEffect(()=>{
    let active=true; setData(null);
    if(JSON.parse(types).length) getCentroAvisos().then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[types,revision]);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {const p=await saveAgendaPreferences(selected);setPrefs(p);setOpen(false);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="agenda-notice-options">
    <div className="workspace-toolbar"><p>Organiza tus reuniones, llamadas y tareas. Los avisos se consultan por separado.</p>
      <Button onClick={()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'avisos'}))}>Ir a Avisos</Button>
      <Button disabled={!prefs} aria-expanded={open} onClick={()=>setOpen(!open)}>Configurar agenda</Button></div>
    {error && <p role="alert">{error}</p>}
    {open && <form className="notices-settings" onSubmit={save}>
      <h2>Avisos que quieres ver junto a tu agenda</h2>
      <p>Sin selecciones verás solo tu calendario. Esta preferencia se guarda en tu cuenta para esta empresa y se respeta en todos tus dispositivos.</p>
      <div className="workspace-toolbar"><Button type="button" onClick={()=>setSelected([])}>Solo agenda</Button><Button type="button" onClick={()=>setSelected(prefs.recommended)}>Sugeridos para mi perfil</Button></div>
      {prefs.allowed.map(t=><label key={t.key} className="agenda-notice-choice"><input type="checkbox" checked={selected.includes(t.key)} onChange={e=>setSelected(v=>e.target.checked?[...v,t.key]:v.filter(k=>k!==t.key))}/>{t.label}</label>)}
      {!prefs.allowed.length && <p>Tu perfil no dispone de avisos de empresa.</p>}
      <Button type="submit" variant="primary" disabled={busy}>{busy?'Guardando…':'Guardar mi configuración'}</Button>
    </form>}
    {!!prefs?.notice_types.length && <details className="agenda-notice-summary"><summary>Avisos seleccionados · {data ? data.items.filter(i=>prefs.notice_types.includes(i.category)).length : 'consultando…'}</summary>
      <NoticeList data={data} categories={prefs.notice_types} limit={20} error={error} reload={()=>{setError('');setRevision(r=>r+1);}}/>
      <p>Se muestran hasta 20 avisos. En Avisos puedes consultar todos y actuar sobre ellos.</p>
    </details>}
  </section>;
}
