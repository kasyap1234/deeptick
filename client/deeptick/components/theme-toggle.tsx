"use client";

import { useTheme } from "./theme-provider";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSyncExternalStore } from "react";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const toggleTheme = () => {
    if (theme === "system") {
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    } else {
      setTheme(theme === "dark" ? "light" : "dark");
    }
  };

  if (!mounted) {
    return (
      <div
        className={cn(
          "inline-flex items-center justify-center w-9 h-9 rounded-md border border-border",
          className
        )}
      />
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "inline-flex items-center justify-center w-9 h-9 rounded-md",
        "border border-border bg-background hover:bg-accent",
        "transition-colors duration-200",
        className
      )}
      aria-label="Toggle theme"
    >
      {resolvedTheme === "dark" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </button>
  );
}
