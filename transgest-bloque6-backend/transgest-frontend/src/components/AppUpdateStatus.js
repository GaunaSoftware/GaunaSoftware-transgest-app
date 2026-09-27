import {useEffect,useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {checkWebUpdate,startAppUpdates} from '../services/appUpdates';
import {readOfflineQueue} from '../services/offlineQueue';
export default function AppUpdateStatus(){
  const {user}=useAuth();const [available,setAvailable]=useState(false);
  useEffect(()=>{startAppUpdates();},[]);
  useEffect(()=>{
    let active=true;
    const check=()=>{if(!document.hidden)checkWebUpdate().then(found=>{if(active)setAvailable(found);}).catch(()=>{});};
    check();const timer=setInterval(check,300000);window.addEventListener('focus',check);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',check);};
  },[user?.id]);
  // Browsers receive fresh assets on normal navigation. Long-lived tabs get an
  // explicit save-first action, never an unexpected mid-operation reload.
  if(!available)return null;
  return <aside className="app-update-status" role="status">Hay una mejora disponible. Guarda lo que estés haciendo y actualiza.
    <button onClick={()=>{if(readOfflineQueue().length){window.alert('Hay acciones sin sincronizar. Conecta y sincroniza antes de actualizar.');return;}window.location.reload();}}>Actualizar ahora</button>
  </aside>;
}
