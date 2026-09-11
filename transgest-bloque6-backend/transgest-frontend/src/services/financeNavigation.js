import { useEffect, useState } from "react";
import { readRuntimeFocus, setRuntimeFocus } from "./runtimeFocus";

export const FINANCE_TABS = [
  { value: "resumen", label: "Resumen", icon: "wallet" },
  { value: "facturas", label: "Facturas", icon: "invoice" },
  { value: "cobros", label: "Cobros", icon: "coins" },
  { value: "pagos", label: "Pagos", icon: "wallet" },
  { value: "tesoreria", label: "Tesorería", icon: "clock" },
  { value: "fiscal", label: "Fiscal (AEAT)", icon: "shield" },
];

export function selectFinanceTab(value) {
  if (!FINANCE_TABS.some(tab => tab.value === value)) return;
  setRuntimeFocus("tms_finance_tab", value);
  window.dispatchEvent(new CustomEvent("tms:finance-tab", { detail: value }));
}

export function useFinanceTab() {
  const [value, setValue] = useState(() => readRuntimeFocus("tms_finance_tab") || "facturas");
  useEffect(() => {
    const sync = event => { if (FINANCE_TABS.some(tab => tab.value === event.detail)) setValue(event.detail); };
    window.addEventListener("tms:finance-tab", sync);
    return () => window.removeEventListener("tms:finance-tab", sync);
  }, []);
  return [value, selectFinanceTab];
}
