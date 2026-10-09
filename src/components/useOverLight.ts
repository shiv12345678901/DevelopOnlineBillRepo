import { useEffect, useState } from "react";
import type { Theme } from "../theme";

/** Resolves whether the glass sits over a light background (for LiquidGlass `overLight`). */
export function useOverLight(theme: Theme) {
  const [overLight, setOverLight] = useState(false);
  useEffect(() => {
    setOverLight(theme === "light");
  }, [theme]);
  return overLight;
}
