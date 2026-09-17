import { PLANNER_MODULES, visiblePlannerModules, hasProduct } from './access';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Login from '../pages/Login';
import Bloqueado from '../pages/Bloqueado';
import { getProduct } from '../services/api';
import PlannerLoads from './PlannerLoads';
import './planner.css';
import './planner-presentation.css';
import PlannerLaunch, { PlannerBrand } from './PlannerLaunch';
import PlannerSlots from './PlannerSlots';
import SupportInbox from '../components/SupportInbox';
const SupplierApp=lazy(()=>import('../pages/SupplierApp'));
const Providers=lazy(()=>import('./PlannerProviders'));
const Warehouse=lazy(()=>import('./PlannerWarehouse'));
const Finance=lazy(()=>import('./PlannerFinance'));
const Intelligence=lazy(()=>import('../pages/Intelligence'));
const Recipients = lazy(() => import('../pages/Clientes'));
const Documents = lazy(() => import('./PlannerDocuments'));
const Company = lazy(() => import('../pages/Empresa'));
const modules = PLANNER_MODULES;
export default function PlannerApp({ PasswordChangeComponent }) {
  const { user, loading, logout, puedeVer, refreshUser } = useAuth();
  const [bloqueado, setBloqueado] = useState(null);
  const { theme, toggle } = useTheme();
  const [view, setView] = useState('pedidos');
  const [product, setProduct] = useState('');
  const [error, setError] = useState('');
  const [support,setSupport]=useState(false);
  const [focusOrder,setFocusOrder]=useState('');
  const [editOrder,setEditOrder]=useState('');
  const consumeEdit=useCallback(()=>setEditOrder(''),[]);
  const consumePreparation=useCallback(()=>setFocusOrder(''),[]);
  useEffect(()=>{const navigate=e=>{const target=['pedidos','viajes','gestion_trafico','muelles'].includes(e.detail)?'pedidos':['choferes','vehiculos'].includes(e.detail)?'colaboradores':e.detail;if(modules.some(([id])=>id===target))setView(target);};window.addEventListener('tms:navegar',navigate);return()=>window.removeEventListener('tms:navegar',navigate);},[]);
  useEffect(() => {
    const onBlocked = event => setBloqueado(event.detail);
    window.addEventListener('tms:bloqueado', onBlocked);
    return () => window.removeEventListener('tms:bloqueado', onBlocked);
  }, []);
  useEffect(() => { setBloqueado(null); }, [user?.id]);
  useEffect(() => {
    document.title = 'TransGest Planner';
    let alive = true;
    getProduct().then(data => { if (alive) setProduct(data.producto); })
      .catch(() => { if (alive) setError('No se pudo verificar el servidor de Planner.'); });
    return () => { alive = false; };
  }, []);
  if (loading) return <p>Cargando...</p>;
  if (!user) return <Login />;
  if (user.debe_cambiar_password) return <PasswordChangeComponent user={user} onChanged={refreshUser} onLogout={logout} />;
  if (bloqueado) return <Bloqueado motivo={bloqueado.motivo} mensaje={bloqueado.mensaje} user={user} />;
  if (error || (product && !['planner','tms','transgest'].includes(product))) return <main className="planner-message"><h1>TransGest Planner</h1><p role="alert">{error || 'Este servidor pertenece al TMS. Revisa la configuración del servidor.'}</p><a href="/?workspace=tms">Volver a TransGest</a> <button onClick={logout}>Salir</button></main>;
  if (!product) return <p>Verificando servidor...</p>;
  if(user.rol==='colaborador'||(user.rol==='chofer'&&user.colaborador_id))return <Suspense fallback={<p>Cargando…</p>}><SupplierApp/></Suspense>;
  if (!visiblePlannerModules(user, puedeVer).length) {
    return <main className="planner-message"><h1>Acceso pendiente</h1><p>Tu perfil no tiene módulos habilitados para Planner. Solicita acceso al administrador de tu empresa.</p><a href="/?workspace=tms">Volver a TransGest</a> <button onClick={logout}>Salir</button></main>;
  }
  const visible = visiblePlannerModules(user, puedeVer);
  const active = visible.some(([id]) => id === view) ? view : visible[0]?.[0];
  return <div className="planner-app">
    <PlannerLaunch key={user.id} />
    <header className="planner-header"><PlannerBrand />{hasProduct(user, 'transgest') && <a className="planner-return" href="/?workspace=tms">Volver a TransGest</a>}<span>{user.nombre}</span><button onClick={()=>setSupport(true)}>Soporte</button><button onClick={toggle}>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</button><button onClick={logout}>Salir</button></header>

    {support&&<SupportInbox onClose={()=>setSupport(false)}/>}
    <nav aria-label="Planner">{visible.map(([id,label]) => <button key={id} aria-current={active === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>)}</nav>
    <main><Suspense fallback={<p>Cargando...</p>}>
      {active === 'pedidos' && <PlannerLoads focusOrder={editOrder} onFocusConsumed={consumeEdit} onPrepare={id=>{setFocusOrder(id);setView('palets');}} />}
      {active === 'muelles' && <PlannerSlots onOrder={id=>{setEditOrder(id);setView('pedidos');}} />}
      {active === 'palets' && <Warehouse focusOrder={focusOrder} onFocusConsumed={consumePreparation} onDocuments={()=>setView('documentos')} onInvoices={()=>setView('facturacion')} />}
      {active === 'facturacion' && <Finance />}
      {active === 'ia' && <Intelligence />}
      {active === 'colaboradores' && <Providers />}
      {active === 'clientes' && <Recipients />}
      {active === 'documentos' && <Documents />}
      {active === 'empresa' && <Company />}
      {!active && <p>No tienes módulos habilitados.</p>}
    </Suspense></main>
  </div>;
}
