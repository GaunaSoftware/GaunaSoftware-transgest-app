import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getToken, getUser, removeToken, login as apiLogin, getMe } from "../services/api";

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

  const logout = useCallback(() => {
    removeToken();
    setUser(null);
  }, []);

  // Guards de rol
  const puedeVer    = (modulo) => checkPermiso(user, modulo, "ver");
  const puedeEditar = (modulo) => checkPermiso(user, modulo, "editar");

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, puedeVer, puedeEditar }}>
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
    ver:    ["agenda","pedidos","documentos","app_chofer","rutas_recomendadas_chofer"],
    editar: ["agenda","pedidos"],
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
    ver:    ["dashboard","agenda","clientes","vehiculos","choferes","facturacion","contabilidad","nominas","pedidos","documentos","informes","actividad","empresa"],
    editar: ["agenda","clientes","facturacion","pedidos","documentos"],
  },
  responsable_taller: {
    ver:    ["agenda","vehiculos","taller","avisos"],
    editar: ["agenda","vehiculos","taller"],
  },
  visualizador: {
    ver:    ["dashboard","control_tower","agenda","pedidos","plan_diario","gestion_trafico","clientes","vehiculos","choferes","documentos"],
    editar: [],
  },
};

function checkPermiso(user, modulo, tipo) {
  const reglas = user?.permisos?.modulos;
  if (reglas?.[modulo]) return Boolean(reglas[modulo][tipo]);
  const rol = user?.rol;
  if (!rol) return false;
  const p = PERMISOS[rol];
  if (!p) return false;
  const lista = p[tipo] || [];
  return lista.includes("todo") || lista.includes(modulo);
}
