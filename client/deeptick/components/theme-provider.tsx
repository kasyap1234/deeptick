"use client";

import { createContext, useContext, useEffect, useMemo } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

function getResolvedTheme(t: Theme): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  if (t === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return t;
}

function getInitialTheme(defaultTheme: Theme, storageKey: string): Theme {
  if (typeof window === "undefined") return defaultTheme;
  return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "deeptick-theme",
}: ThemeProviderProps) {
  const theme = getInitialTheme(defaultTheme, storageKey);
  const resolvedTheme = useMemo(() => getResolvedTheme(theme), [theme]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = (newTheme: Theme) => {
    localStorage.setItem(storageKey, newTheme);
    window.location.reload();
  };

  const value = {
    theme,
    setTheme,
    resolvedTheme,
  };

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
