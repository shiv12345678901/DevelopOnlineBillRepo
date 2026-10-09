import { useEffect, useRef, useState } from "react";
import { SFSymbol, type SFSymbolName } from "./SFSymbol";

export type Theme = "auto" | "light" | "dark";

const ORDER: { id: Theme; icon: SFSymbolName; label: string }[] = [
  { id: "light", icon: "sun", label: "Light" },
  { id: "auto", icon: "circleHalf", label: "Auto" },
  { id: "dark", icon: "moon", label: "Dark" },
];

/**
 * Floating segmented theme switcher with a sliding thumb,
 * like a native iOS segmented control.
 */
export function ThemePill({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const pillRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState({ x: 0, w: 0 });

  useEffect(() => {
    const update = () => {
      const idx = ORDER.findIndex((o) => o.id === theme);
      const el = segRefs.current[idx];
      const pill = pillRef.current;
      if (el && pill) {
        const pillRect = pill.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        setThumb({ x: r.left - pillRect.left, w: r.width });
      }
    };
    update();
    const t = setTimeout(update, 120); // re-measure after fonts settle
    window.addEventListener("resize", update);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", update);
    };
  }, [theme]);

  return (
    <div className="theme-pill" ref={pillRef} role="group" aria-label="Appearance">
      <span
        className="theme-thumb"
        aria-hidden="true"
        style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
      />
      {ORDER.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            segRefs.current[i] = el;
          }}
          className={`theme-seg${theme === o.id ? " active" : ""}`}
          onClick={() => setTheme(o.id)}
          aria-pressed={theme === o.id}
          aria-label={o.label}
        >
          <SFSymbol name={o.icon} filled={theme === o.id} />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
