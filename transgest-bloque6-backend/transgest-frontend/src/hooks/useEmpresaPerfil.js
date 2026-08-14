import { useEffect, useState } from "react";
import { getEmpresa, saveEmpresa, getEmpresaBackend } from "../services/api";
import { ensureLogoCargado } from "../services/logoHelper";

export const EMPRESA_DEFAULTS = {
  razon_social: "",
  cif: "",
  domicilio: "",
  cp: "",
  municipio: "",
  provincia: "",
  pais: "Espana",
  telefono: "",
  email: "",
  emails_albaranes: "",
  web: "",
  iban: "",
  bic: "",
  banco: "",
  regimen_iva: "Regimen general",
  forma_pago_colaboradores: "dias_fijos",
  dias_pago_colaboradores: "15",
  plazo_pago_colaboradores: 60,
  tipo_iva_defecto: "21",
  serie_facturas: "A",
  serie_rectificativas: "R",
  serie_ordenes: "OC",
  texto_pie: "",
  logo_url: "",
};

export function getEmpresaPerfilSync() {
  return {
    ...EMPRESA_DEFAULTS,
    ...getEmpresa(),
  };
}

export async function hydrateEmpresaPerfil() {
  const local = getEmpresaPerfilSync();
  // Asegura que el logo este cargado en cache para las impresiones (orden de
  // carga, factura, nomina...), aunque no se haya abierto "Mi Empresa". Guardada:
  // solo hace la peticion una vez.
  ensureLogoCargado();
  try {
    const remote = await getEmpresaBackend();
    if (remote && typeof remote === "object" && Object.keys(remote).length) {
      const merged = { ...local, ...remote };
      saveEmpresa(merged);
      return merged;
    }
  } catch {}
  return local;
}

export function useEmpresaPerfil() {
  const [empresa, setEmpresa] = useState(getEmpresaPerfilSync);

  useEffect(() => {
    let alive = true;
    hydrateEmpresaPerfil().then((perfil) => {
      if (alive) setEmpresa(perfil);
    });
    return () => { alive = false; };
  }, []);

  return empresa;
}
