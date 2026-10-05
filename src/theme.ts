export type ThemePref = "auto" | "light" | "dark";

const THEME_KEY = "rockdale-theme";
const THEME_COLOR = {
  light: "#f5f5f8",
  dark: "#10131c",
};

export function getThemePref(): ThemePref {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply a preference to the document. "auto" follows the OS setting. */
export function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "auto" && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  // Keeps form controls, scrollbars and keyboard chrome on the same scheme.
  root.style.colorScheme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Private mode: the choice just won't survive a reload.
  }
}

/** Re-apply the stored preference whenever the OS scheme flips. */
export function watchSystemTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
