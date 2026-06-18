import { createContext, useContext, useState, useEffect } from "react";
import { applyCompanyPalette, loadCompanyPalette } from "../utils/companyPalette";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("tms_theme") || "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tms_theme", theme);
    applyCompanyPalette(loadCompanyPalette());
  }, [theme]);

  useEffect(() => {
    const apply = (e) => applyCompanyPalette(e?.detail || loadCompanyPalette());
    window.addEventListener("tms:company-palette-changed", apply);
    return () => window.removeEventListener("tms:company-palette-changed", apply);
  }, []);

  function toggle() {
    setTheme(t => t === "dark" ? "light" : "dark");
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle, isDark: theme === "dark" }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
