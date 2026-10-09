import { useEffect, useState } from "react";
import type { Theme } from "./ThemePill";

/** Resolves whether the glass sits over a light background (for LiquidGlass `overLight`). */
export function useOverLight(theme: Theme) {
  const [overLight, setOverLight] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const resolve = () =>
      setOverLight(theme === "light" || (theme === "auto" && mq.matches));
    resolve();
    mq.addEventListener("change", resolve);
    return () => mq.removeEventListener("change", resolve);
  }, [theme]);
  return overLight;
}
