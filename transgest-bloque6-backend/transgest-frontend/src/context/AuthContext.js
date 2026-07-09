import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getToken, getUser, setUser as setCachedUser, removeToken, login as apiLogin, getMe } from "../services/api";

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
        setUser(me);
        setCachedUser(me);
      } catch (err) {
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

  const login = useCallback(async (email, password) => {
    const data = await apiLogin(email, password);
    setUser(data.user);
    window.dispatchEvent(new CustomEvent("tms:launch-splash"));
    return data;
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await getMe();
    setUser(me);
    setCachedUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    removeToken();
    setUser(null);
  }, []);

  // Guards de rol
  const puedeVer    = (modulo) => checkPermiso(user, modulo, "ver");
  const puedeEditar = (modulo) => checkPermiso(user, modulo, "editar");

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
