import { SFSymbol, type SFSymbolName } from "./SFSymbol";

export type Theme = "auto" | "light" | "dark";

function ThemeSeg({
  active, onClick, icon, label,
}: {
  active: boolean; onClick: () => void; icon: SFSymbolName; label: string;
}) {
  return (
    <button
      className={`theme-seg${active ? " active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
    >
      <SFSymbol name={icon} filled={active} />
      <span>{label}</span>
    </button>
  );
}

/** Floating segmented theme switcher pill (top-right). */
export function ThemePill({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <div className="theme-pill" role="group" aria-label="Appearance">
      <ThemeSeg active={theme === "light"} onClick={() => setTheme("light")} icon="sun" label="Light" />
      <ThemeSeg active={theme === "auto"} onClick={() => setTheme("auto")} icon="circleHalf" label="Auto" />
      <ThemeSeg active={theme === "dark"} onClick={() => setTheme("dark")} icon="moon" label="Dark" />
    </div>
  );
}
