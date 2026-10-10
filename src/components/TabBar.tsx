import { AppIcon, type AppIconName } from "./AppIcon";
import { useEffect, useRef, useState } from "react";

export type TabId = "home" | "receipts" | "settle" | "spending" | "history" | "settings";

const TABS: { id: TabId; icon: AppIconName; label: string }[] = [
  { id: "home", icon: "house", label: "Home" },
  { id: "receipts", icon: "docText", label: "Receipts" },
  { id: "settle", icon: "settle", label: "Settle" },
  { id: "spending", icon: "chart", label: "My spending" },
  { id: "settings", icon: "gear", label: "Settings" },
];

function TabButton({
  active, onClick, icon, label,
}: {
  active: boolean; onClick: () => void; icon: AppIconName; label: string;
}) {
  return (
    <button
      type="button"
      className={`tab-btn${active ? " active" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      <AppIcon name={icon} active={active} />
    </button>
  );
}

export function TabBar({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const [compact, setCompact] = useState(false);
  const [morphing, setMorphing] = useState(false);
  const activeTab = tab === "history" ? "home" : tab;
  const activeIndex = TABS.findIndex((item) => item.id === activeTab);
  const previousActiveIndex = useRef(activeIndex);
  const pillCorrection = activeIndex * (compact ? 1.6 : 2.4);
  const pillLeft = activeIndex === 0
    ? "var(--nav-inset)"
    : `calc(var(--nav-inset) + ${activeIndex * 20}% - ${pillCorrection}px)`;

  useEffect(() => {
    if (activeIndex < 0 || previousActiveIndex.current === activeIndex) return;
    previousActiveIndex.current = activeIndex;
    setMorphing(false);
    const frame = window.requestAnimationFrame(() => setMorphing(true));
    const timer = window.setTimeout(() => setMorphing(false), 520);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [activeIndex]);

  useEffect(() => {
    let previousScrollY = window.scrollY;
    let direction = 0;
    let travelled = 0;
    let animationFrame = 0;

    const updateFromScroll = () => {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - previousScrollY;
      const nextDirection = Math.sign(delta);

      if (nextDirection && nextDirection !== direction) {
        direction = nextDirection;
        travelled = 0;
      }
      travelled += Math.abs(delta);

      if (currentScrollY < 12) {
        setCompact(false);
        travelled = 0;
      } else if (direction > 0 && travelled >= 12) {
        setCompact(true);
        travelled = 0;
      } else if (direction < 0 && travelled >= 3) {
        setCompact(false);
        travelled = 0;
      }
      previousScrollY = currentScrollY;
      animationFrame = 0;
    };

    const handleScroll = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(updateFromScroll);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  function handleTabChange(nextTab: TabId) {
    setCompact(false);
    setTab(nextTab);
  }

  return (
    <div className={`nav-shell${compact ? " nav-shell--compact" : ""}`}>
      <nav className="tab-bar" aria-label="Primary navigation">
        <span
          className={`tab-active-pill${activeIndex < 0 ? " tab-active-pill--hidden" : ""}${morphing ? " is-morphing" : ""}`}
          aria-hidden="true"
          style={{ left: pillLeft }}
        ><span className="tab-active-pill__shine" /></span>
        {TABS.map((t) => (
          <TabButton
            key={t.id}
            active={activeTab === t.id}
            onClick={() => handleTabChange(t.id)}
            icon={t.icon}
            label={t.label}
          />
        ))}
      </nav>
    </div>
  );
}
