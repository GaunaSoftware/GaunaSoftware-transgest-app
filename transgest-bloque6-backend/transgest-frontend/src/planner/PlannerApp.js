import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Login from '../pages/Login';
import Bloqueado from '../pages/Bloqueado';
import { getProduct } from '../services/api';
import PlannerLoads from './PlannerLoads';
import './planner.css';
const Agencies = lazy(() => import('../pages/Colaboradores'));
const Recipients = lazy(() => import('../pages/Clientes'));
const Documents = lazy(() => import('../pages/Documentos'));
const Company = lazy(() => import('../pages/Empresa'));
const logo = require('../assets/brand/transgest_logo_white.svg').default;
const modules = [
  ['pedidos','Cargas'], ['colaboradores','Agencias de transporte'],
  ['clientes','Destinatarios'], ['documentos','Documentos'], ['empresa','Empresa'],
];
export default function PlannerApp({ PasswordChangeComponent }) {
  const { user, loading, logout, puedeVer, bloqueado, refreshUser } = useAuth();
  const { theme, toggle } = useTheme();
  const [view, setView] = useState('pedidos');
  const [product, setProduct] = useState('');
  const [error, setError] = useState('');
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
  if (error || (product && product !== 'planner')) return <main className="planner-message"><h1>TransGest Planner</h1><p role="alert">{error || 'Este servidor pertenece al TMS. Conecta Planner a su servidor independiente.'}</p><button onClick={logout}>Salir</button></main>;
  if (!product) return <p>Verificando servidor...</p>;
  if (!['gerente','trafico','administrativo','contable','visualizador'].includes(user.rol)) {
    return <main className="planner-message"><h1>Acceso pendiente</h1><p>Solicita al administrador que revise tu acceso y contraseña.</p><button onClick={logout}>Salir</button></main>;
  }
  const visible = modules.filter(([id]) => puedeVer(id));
  const active = visible.some(([id]) => id === view) ? view : visible[0]?.[0];
  return <div className="planner-app">
    <header className="planner-header"><img src={logo} alt="TransGest"/><strong>Planner</strong><span>{user.nombre}</span><button onClick={toggle}>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</button><button onClick={logout}>Salir</button></header>
    <nav aria-label="Planner">{visible.map(([id,label]) => <button key={id} aria-current={active === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>)}</nav>
    <main><Suspense fallback={<p>Cargando...</p>}>
      {active === 'pedidos' && <PlannerLoads />}
      {active === 'colaboradores' && <Agencies />}
      {active === 'clientes' && <Recipients />}
      {active === 'documentos' && <Documents />}
      {active === 'empresa' && <Company />}
      {!active && <p>No tienes módulos habilitados.</p>}
    </Suspense></main>
  </div>;
}
