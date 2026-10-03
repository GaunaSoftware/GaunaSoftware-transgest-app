import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getUserRelease, dismissUserRelease } from '../services/api';
import build from '../data/appBuild.json';
import './ProductNews.css';

export default function ProductNews() {
  const {user,loading} = useAuth();
  const [news,setNews]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [closed,setClosed]=useState(false);
  const dialog=useRef(null), identity=useRef('');
  const key=user ? `${user.empresa_id}:${user.id}` : '';
  identity.current=key;
  useEffect(()=>{
    setNews(null);setClosed(false);setError('');setBusy(false);
    if(!key || loading || user?.debe_cambiar_password)return;
    let active=true;
    getUserRelease(build.releaseId).then(n=>{if(active && n?.id && Array.isArray(n.items))setNews({...n,accountKey:key});}).catch(()=>{/* Retry at the next login; never invent a dismissal. */});
    return()=>{active=false;};
  },[key,loading,user?.debe_cambiar_password]);
  const visible=!!news && news.accountKey===key && !news.dismissed && !closed;
  useEffect(()=>{
    if(!visible)return;
    const prior=document.activeElement;
    dialog.current?.focus();
    return()=>prior?.focus?.();
  },[visible]);
  async function dismiss(){
    const requestedKey=key;setBusy(true);setError('');
    try{await dismissUserRelease(news.id);if(identity.current===requestedKey)setClosed(true);}
    catch(e){if(identity.current===requestedKey)setError('No hemos podido guardar tu elección. Comprueba la conexión e inténtalo de nuevo.');}
    finally{if(identity.current===requestedKey)setBusy(false);}
  }
  function keys(e){
    if(e.key==='Escape' && !busy)setClosed(true);
    if(e.key!=='Tab')return;
    const buttons=Array.from(dialog.current.querySelectorAll('button:not(:disabled)'));
    const first=buttons[0],last=buttons[buttons.length-1];
    if(e.shiftKey&&(document.activeElement===first || document.activeElement===dialog.current)){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
  // Mounting under AuthProvider keeps the account and dismissal scope consistent.
  if(!visible)return null;
  return <div className="product-news-backdrop"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="product-news-title" onKeyDown={keys} className="product-news">
    <header><span>TRANSGEST · NOVEDADES</span><h2 id="product-news-title">{news.title}</h2><p>{news.intro}</p></header>
    <ul>{news.items.map((item,index)=><li key={index}><strong>{item.title}</strong><p>{item.text}</p></li>)}</ul>
    {error && <p role="alert">{error}</p>}
    <footer><button disabled={busy} onClick={()=>setClosed(true)}>Ahora no</button><button className="product-news-primary" disabled={busy} onClick={dismiss}>{busy?'Guardando…':'No mostrar más esta actualización'}</button></footer>
    <small>Las próximas novedades se anunciarán en su propia actualización.</small>
  </section></div>;
}
