import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getToken, getUser, setUser as setCachedUser, removeToken, login as apiLogin, getMe } from "../services/api";
import { hasProduct } from "../planner/access";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  // Al arrancar: verificar si hay token válido
  useEffect(() => {
    async function init() {
      const token = getToken();
      if (!token) { setLoading(false); return; }
      try {
        const me = await getMe();
        if (getToken() !== token) return;
        setUser(me);
        setCachedUser(me);
      } catch (err) {
        if (getToken() !== token) return;
        const cachedUser = getUser();
        if (err?.message === "suscripcion_bloqueada") {
          setUser(cachedUser);
        } else if (
          err?.message?.includes?.("No se pudo conectar con el servidor") ||
          err?.message?.includes?.("problema interno del servidor") ||
          err?.message?.includes?.("se ha cortado")
        ) {
          setUser(cachedUser);
        } else {
          removeToken();
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  useEffect(() => {
    const restore = async () => {
      delete window.__TMS_TOKEN;
      delete window.__TMS_USER;
      delete window.__TMS_SUSCRIPCION;
      delete window.__TMS_BLOQUEADO;
      const token = getToken();
      if (!token) { setUser(null); return; }
      setUser(null);
      try { const me=await getMe(); if(getToken()===token){setUser(me);setCachedUser(me);} }
      catch { if(getToken()===token) setUser(getUser()); }
    };
    const onStorage = event => { if(['tms_token','tms_user'].includes(event.key)) restore(); };
    const onPageshow = event => { if(event.persisted) restore(); };
    const onCleared = () => setUser(null);
    window.addEventListener('storage',onStorage);
    window.addEventListener('pageshow',onPageshow);
    window.addEventListener('tms:session-cleared',onCleared);
    return ()=>{window.removeEventListener('storage',onStorage);window.removeEventListener('pageshow',onPageshow);window.removeEventListener('tms:session-cleared',onCleared);};
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await apiLogin(email, password);
    if (!hasProduct(data.user, "planner")) {
      window.history.replaceState(null, "", "/?workspace=tms");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    setUser(data.user);
    window.dispatchEvent(new CustomEvent("tms:launch-splash"));
    return data;
  }, []);

  const refreshUser = useCallback(async () => {
    const token = getToken();
    const me = await getMe();
    if(getToken() !== token) return null;
    setUser(me);
    setCachedUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    removeToken();
    setUser(null);
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  // Guards de rol
  const puedeVer = useCallback((modulo) => checkPermiso(user, modulo, "ver"), [user]);
  const puedeEditar = useCallback((modulo) => checkPermiso(user, modulo, "editar"), [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, puedeVer, puedeEditar }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// ── Permisos por rol ──────────────────────────────────
const PERMISOS = {
  chofer: {
    ver:    ["app_chofer","rutas_recomendadas_chofer","avisos","mi_cuenta"],
    editar: ["app_chofer","avisos","mi_cuenta"],
  },
  cliente: {
    ver:    ["portal-cliente","pedidos","documentos","facturacion"],
    editar: ["portal-cliente"],
  },
  cliente_portal: {
    ver:    ["portal-cliente","pedidos","documentos","facturacion"],
    editar: ["portal-cliente"],
  },
  gerente: {
    ver:    ["todo"],
    editar: ["todo"],
  },
  contable: {
    ver:    ["dashboard","agenda","clientes","vehiculos","choferes","facturacion","contabilidad","nominas","pedidos","documentos","informes","actividad","empresa"],
    editar: ["clientes","facturacion","contabilidad","nominas","documentos"],
  },
  trafico: {
    ver:    ["dashboard","control_tower","agenda","pedidos","plan_diario","gestion_trafico","rutas","rutas_recomendadas","clientes","vehiculos","choferes","colaboradores","documentos","avisos","hojas_ruta","palets","grupajes","solicitudes"],
    editar: ["agenda","control_tower","pedidos","plan_diario","gestion_trafico","rutas","rutas_recomendadas","clientes","vehiculos","choferes","colaboradores","documentos","avisos","hojas_ruta","palets","grupajes","solicitudes"],
  },
  administrativo: {
    ver:    ["dashboard","agenda","clientes","vehiculos","choferes","facturacion","contabilidad","nominas","pedidos","documentos","informes","actividad","empresa","avisos","mi_cuenta"],
    editar: ["agenda","clientes","facturacion","pedidos","documentos","avisos","mi_cuenta"],
  },
  responsable_taller: {
    ver:    ["agenda","vehiculos","taller","avisos"],
    editar: ["agenda","vehiculos","taller"],
  },
  mecanico: {
    ver:    ["taller","vehiculos","avisos","mi_cuenta"],
    editar: ["taller","avisos","mi_cuenta"],
  },
  colaborador: {
    ver:    ["pedidos","documentos","mi_cuenta"],
    editar: ["pedidos","documentos","mi_cuenta"],
  },
  visualizador: {
    ver:    ["dashboard","control_tower","agenda","pedidos","plan_diario","gestion_trafico","clientes","vehiculos","choferes","documentos"],
    editar: [],
  },
};

function checkPermiso(user, modulo, tipo) {
  const aliases = modulo === "portal_cliente" || modulo === "portal-cliente"
    ? ["portal_cliente", "portal-cliente"]
    : [modulo];
  const reglas = user?.permisos?.modulos;
  if (reglas) {
    for (const id of aliases) {
      if (reglas[id]) return Boolean(reglas[id][tipo]);
    }
  }
  const rol = user?.rol;
  if (!rol) return false;
  const p = PERMISOS[rol];
  if (!p) return false;
  const lista = p[tipo] || [];
  return lista.includes("todo") || aliases.some(id => lista.includes(id));
}
