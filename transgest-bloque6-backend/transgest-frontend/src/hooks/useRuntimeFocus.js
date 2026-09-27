import { useEffect, useState } from 'react';
import { readRuntimeFocus } from '../services/runtimeFocus';
export default function useRuntimeFocus(key) {
  const [value, setValue] = useState(() => readRuntimeFocus(key));
  useEffect(() => {
    const receive = event => { if (event.detail?.key === key) setValue(event.detail.value); };
    window.addEventListener('tms:runtime-focus', receive);
    return () => window.removeEventListener('tms:runtime-focus', receive);
  }, [key]);
  return value;
}
