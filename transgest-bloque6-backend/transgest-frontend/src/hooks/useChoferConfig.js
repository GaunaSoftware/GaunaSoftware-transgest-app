import { useEffect, useState } from "react";
import { getChoferConfig, setChoferConfig } from "../services/api";

const CHOFER_DEFAULTS = {
  salario_base: 0,
  precio_noche: 40,
  plus_actividad: 0,
  incentivo_pct: 0,
  irpf_pct: 0,
  ss_empresa_pct: 29.9,
  ss_trabajador_pct: 6.35,
  convenio: "",
};

const choferConfigCache = new Map();

export function getChoferConfigSync(choferId) {
  if (!choferId) return { ...CHOFER_DEFAULTS };
  return {
    ...CHOFER_DEFAULTS,
    ...(choferConfigCache.get(String(choferId)) || {}),
  };
}

export async function hydrateChoferConfig(choferId) {
  if (!choferId) return { ...CHOFER_DEFAULTS };
  try {
    const remote = await getChoferConfig(choferId);
    if (remote && typeof remote === "object") {
      const merged = { ...CHOFER_DEFAULTS, ...remote };
      choferConfigCache.set(String(choferId), merged);
      return merged;
    }
  } catch {}
  return getChoferConfigSync(choferId);
}

export async function saveChoferConfigBackend(choferId, patch = {}) {
  const merged = {
    ...getChoferConfigSync(choferId),
    ...(patch && typeof patch === "object" ? patch : {}),
  };
  await setChoferConfig(choferId, merged);
  choferConfigCache.set(String(choferId), merged);
  return merged;
}

export function useChoferConfig(choferId) {
  const [config, setConfig] = useState(() => getChoferConfigSync(choferId));

  useEffect(() => {
    let alive = true;
    setConfig(getChoferConfigSync(choferId));
    hydrateChoferConfig(choferId).then((data) => {
      if (alive) setConfig(data);
    });
    return () => { alive = false; };
  }, [choferId]);

  return config;
}
