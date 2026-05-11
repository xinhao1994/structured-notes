"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  // Initial: respect localStorage, then system preference. Avoid hydration flash
  // by setting on first client render.
  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("snd.theme")) as Theme | null;
    // Default to dark mode (Bloomberg-terminal feel). System preference respected only if user previously chose light/dark explicitly.
    const initial: Theme = stored ?? "dark";
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  function toggle() {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try { localStorage.setItem("snd.theme", next); } catch {}
      return next;
    });
  }

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
