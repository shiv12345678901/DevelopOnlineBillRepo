import { AppIcon, type AppIconName } from "./AppIcon";

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
  const activeTab = tab === "history" ? "home" : tab;
  const activeIndex = TABS.findIndex((item) => item.id === activeTab);

  return (
    <div className="nav-shell">
      <nav className="tab-bar" aria-label="Primary navigation">
        <span
          className={`tab-active-pill${activeIndex < 0 ? " tab-active-pill--hidden" : ""}`}
          aria-hidden="true"
          style={{ transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }}
        />
        {TABS.map((t) => (
          <TabButton
            key={t.id}
            active={activeTab === t.id}
            onClick={() => setTab(t.id)}
            icon={t.icon}
            label={t.label}
          />
        ))}
      </nav>
    </div>
  );
}
