import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_THEME, isTheme, THEME_STORAGE_KEY, type Theme } from "./theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
