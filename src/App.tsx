import { useEffect, useState } from "react";
import {
  fetchCurrentSettlement, fetchReceipts, fetchPeriods,
  type Receipt, type Settlement, type Period,
} from "./api";
import { ThemePill, type Theme } from "./components/ThemePill";
import { TabBar, type TabId } from "./components/TabBar";
import { HomeTab } from "./tabs/HomeTab";
import { ReceiptsTab } from "./tabs/ReceiptsTab";
import { HistoryTab } from "./tabs/HistoryTab";

const THEME_KEY = "splitmate-theme";

export default function App() {
  const [tab, setTab] = useState<TabId>("home");
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || "auto"
  );

  // Theme → <html data-theme>, persisted
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Online/offline banner
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Initial data load
  useEffect(() => {
    Promise.all([fetchCurrentSettlement(), fetchReceipts(), fetchPeriods()])
      .then(([s, r, p]) => {
        setSettlement(s);
        setReceipts(r);
        setPeriods(p);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app">
      <div className="bg-wash" aria-hidden="true" />

      {!online && (
        <div className="offline-banner">Offline — showing last synced data</div>
      )}

      <ThemePill theme={theme} setTheme={setTheme} />

      <main key={tab} className="tab-enter">
        {loading ? (
          <div className="loading">
            <div className="spinner" />
            <p>Loading your bills…</p>
          </div>
        ) : (
          <>
            {tab === "home" && <HomeTab settlement={settlement} theme={theme} />}
            {tab === "receipts" && <ReceiptsTab receipts={receipts} />}
            {tab === "history" && <HistoryTab periods={periods} />}
          </>
        )}
      </main>

      <TabBar tab={tab} setTab={setTab} theme={theme} />
    </div>
  );
}
