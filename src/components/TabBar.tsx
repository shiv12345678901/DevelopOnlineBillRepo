import { useEffect, useRef, useState } from "react";
import { SFSymbol, type SFSymbolName } from "./SFSymbol";

export type TabId = "home" | "receipts" | "history";

const TABS: { id: TabId; icon: SFSymbolName; label: string }[] = [
  { id: "home", icon: "house", label: "Home" },
  { id: "receipts", icon: "docText", label: "Receipts" },
  { id: "history", icon: "clock", label: "History" },
];

function TabButton({
  active, onClick, icon, label,
}: {
  active: boolean; onClick: () => void; icon: SFSymbolName; label: string;
}) {
  return (
    <button className={`tab-btn${active ? " active" : ""}`} onClick={onClick}>
      <SFSymbol name={icon} filled={active} />
      <span className="tab-label">{label}</span>
    </button>
  );
}

/**
 * Floating pill tab bar.
 * Contracts to icons-only while scrolling down; expands on scroll up,
 * touch, or after 1.8s idle.
 */
export function TabBar({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const lastY = useRef(0);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY.current;
      lastY.current = y;
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
      if (dy > 8 && y > 120) {
        setCollapsed(true);
      } else if (dy < -8) {
        setCollapsed(false);
      }
      collapseTimer.current = setTimeout(() => setCollapsed(false), 1800);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
  }, []);

  return (
    <nav
      className={`tab-bar${collapsed ? " collapsed" : ""}`}
      onPointerEnter={() => setCollapsed(false)}
      onTouchStart={() => setCollapsed(false)}
      aria-label="Sections"
    >
      {TABS.map((t) => (
        <TabButton
          key={t.id}
          active={tab === t.id}
          onClick={() => setTab(t.id)}
          icon={t.icon}
          label={t.label}
        />
      ))}
    </nav>
  );
}
