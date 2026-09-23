import { useEffect, useState } from 'react';
import { getBiAnalitica, getBiHoja } from './api';
export default function useBiAnalytics(params, reload = 0, kind = "analitica") {
  const key = JSON.stringify(typeof params === 'string' ? { periodo: params } : params);
  const [result, setResult] = useState({ key: null, data: null, error: '', loading: true });
  useEffect(() => {
    let active = true;
    setResult({ key, data: null, error: '', loading: true });
    (kind === "hoja" ? getBiHoja : getBiAnalitica)(JSON.parse(key)).then(data => {
      if (active) setResult({ key, data, error: '', loading: false });
    }).catch(() => {
      if (active) setResult({ key, data: null, error: 'No se ha podido calcular la analítica. Los indicadores no están disponibles; no significa que no haya actividad.', loading: false });
    });
    return () => { active = false; };
  }, [key, reload, kind]);
  return result.key === key ? result : { data: null, error: '', loading: true };
}
