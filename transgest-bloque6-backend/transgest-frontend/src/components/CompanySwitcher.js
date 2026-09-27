import React,{useEffect,useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {getCompanyMemberships,switchActiveCompany} from '../services/api';
import {confirmDialog} from '../services/notify';
export default function CompanySwitcher(){
 const {user}=useAuth();const [companies,setCompanies]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;if(user?.superadmin_impersonation)return;getCompanyMemberships().then(r=>{if(active)setCompanies(r.companies||[]);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[user?.id,user?.empresa_id,user?.superadmin_impersonation]);
 async function change(id){if(id===user.empresa_id)return;if(!await confirmDialog({title:'Cambiar empresa activa',message:'Cambiar de empresa recargará la aplicación. Guarda antes cualquier formulario pendiente. ¿Continuar?'}))return;setBusy(true);try{await switchActiveCompany(id);window.location.assign('/');}catch(e){setError(e.message);setBusy(false);}}
 if(companies.length<2)return error?<span role="status" title={error}>Empresa no disponible</span>:null;
 return <div style={{minWidth:0,maxWidth:210}}><select aria-label="Empresa activa" value={user.empresa_id} disabled={busy} onChange={e=>change(e.target.value)} style={{width:'100%',maxWidth:'100%',color:'var(--text)',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:6,padding:6}}>{companies.map(c=><option key={c.empresa_id} value={c.empresa_id}>{c.nombre} · {c.rol}</option>)}</select>{error&&<small role="alert">{error}</small>}</div>;
}
