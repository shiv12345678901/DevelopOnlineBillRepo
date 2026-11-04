import { GlassNav } from "@zakisheriff/liquid-glass";
import { AppIcon, type AppIconName } from "./AppIcon";

export type TabId = "home" | "receipts" | "spending" | "history" | "settings";

const TABS: { id: TabId; icon: AppIconName; label: string }[] = [
  { id: "home", icon: "house", label: "Home" },
  { id: "receipts", icon: "docText", label: "Receipts" },
  { id: "spending", icon: "chart", label: "Spending" },
  { id: "settings", icon: "gear", label: "Settings" },
];

export function TabBar({ tab, setTab }: { tab: TabId; setTab: (tab: TabId) => void }) {
  const activeTab = tab === "history" ? "home" : tab;
  const activeIndex = Math.max(0, TABS.findIndex(({ id }) => id === activeTab));
  const items = TABS.map(({ icon, label }, index) => ({
    label,
    icon: <AppIcon name={icon} active={index === activeIndex} />,
  }));

  return (
    <div className="nav-shell">
      <GlassNav
        className="liquid-tab-bar"
        items={items}
        activeIndex={activeIndex}
        onChange={(index) => setTab(TABS[index].id)}
        intensity={6}
        aria-label="Primary navigation"
      />
    </div>
  );
}
