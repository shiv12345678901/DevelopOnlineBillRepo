import { useEffect, useLayoutEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  fetchSettlementForPeriod, fetchReceiptsForPeriod, fetchPeriods, supabase,
  type Receipt, type Settlement, type Period,
} from "./api";
import { SignInScreen } from "./components/SignInScreen";
import { TabBar, type TabId } from "./components/TabBar";
import { HomeTab } from "./tabs/HomeTab";
import { ReceiptsTab } from "./tabs/ReceiptsTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { MySpendingTab } from "./tabs/MySpendingTab";
import { SettleTab } from "./tabs/SettleTab";
import type { Theme } from "./theme";

const THEME_KEY = "splitmate-theme";

function getInitialTheme(): Theme {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [tab, setTab] = useState<TabId>("home");
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [pendingPeriodId, setPendingPeriodId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>();
  const [online, setOnline] = useState(navigator.onLine);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // Theme → <html data-theme>, persisted
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

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
    if (!session) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    refreshData()
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedPeriodId, session?.user.id]);

  function handlePeriodChange(nextPeriodId: string) {
    const currentPeriodId = periods.find((period) => period.status === "CURRENT")?.id;
    if (nextPeriodId !== currentPeriodId) {
      setPendingPeriodId(nextPeriodId);
      return;
    }
    setSelectedPeriodId(null);
  }

  async function refreshData() {
    const nextPeriods = await fetchPeriods();
    setPeriods(nextPeriods);
    const currentPeriod = nextPeriods.find((period) => period.status === "CURRENT") || nextPeriods[0];
    const targetPeriod = nextPeriods.find((period) => period.id === selectedPeriodId) || currentPeriod;
    if (!targetPeriod) {
      setSettlement(null);
      setReceipts([]);
      return;
    }
    const [nextSettlement, nextReceipts] = await Promise.all([
      fetchSettlementForPeriod(targetPeriod.id),
      fetchReceiptsForPeriod(targetPeriod.id),
    ]);
    setSettlement(nextSettlement);
    setReceipts(nextReceipts);
  }

  async function handleSyncNow() {
    const { data, error } = await supabase
      .from("sync_requests")
      .insert({ requested_by: "netlify-app", status: "pending" })
      .select("id")
      .single();
    if (error || !data) throw error || new Error("Could not start sync.");
    const requestId = data.id;
    return new Promise<string>((resolve, reject) => {
      let finished = false;
      const poll = setInterval(async () => {
        const { data: request, error: pollError } = await supabase
          .from("sync_requests")
          .select("status, result_summary, error")
          .eq("id", requestId)
          .single();
        if (pollError || !request || finished) return;
        if (request.status === "done") {
          finished = true;
          clearInterval(poll);
          clearTimeout(timeout);
          await refreshData();
          resolve(request.result_summary || "Data refreshed");
        } else if (request.status === "failed") {
          finished = true;
          clearInterval(poll);
          clearTimeout(timeout);
          reject(new Error(request.error || "Sync failed."));
        }
      }, 5000);
      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        clearInterval(poll);
        reject(new Error("Sync timed out after 5 minutes."));
      }, 300000);
    });
  }

  function confirmPeriodChange() {
    if (!pendingPeriodId) return;
    setPendingPeriodId(null);
    setSelectedPeriodId(pendingPeriodId);
  }

  function handleUserUpdated(user: User) {
    setSession((current) => current ? { ...current, user } : current);
  }

  if (session === undefined) {
    return (
      <div className="app auth-loading">
        <div className="bg-wash" aria-hidden="true" />
        <div className="loading"><div className="spinner" /><p>Opening SplitMate…</p></div>
      </div>
    );
  }

  if (!session) return <SignInScreen />;

  return (
    <div className="app">
      <div className="bg-wash" aria-hidden="true" />

      {!online && (
        <div className="offline-banner">Offline — showing last synced data</div>
      )}

      <main key={tab} className="tab-enter">
        {loading ? (
          <div className="loading">
            <div className="spinner" />
            <p>Loading your bills…</p>
          </div>
        ) : (
          <>
            {tab === "home" && <HomeTab settlement={settlement} periods={periods} onOpenHistory={() => setTab("history")} />}
            {tab === "receipts" && <ReceiptsTab receipts={receipts} />}
            {tab === "settle" && <SettleTab settlement={settlement} periods={periods} />}
            {tab === "spending" && <MySpendingTab receipts={receipts} settlement={settlement} user={session.user} />}
            {tab === "history" && <HistoryTab periods={periods} />}
            {tab === "settings" && (
              <SettingsTab
                theme={theme}
                setTheme={setTheme}
                memberCount={Object.keys(settlement?.member_totals || {}).length}
                periods={periods}
                selectedPeriodId={selectedPeriodId || periods.find((period) => period.status === "CURRENT")?.id || ""}
                onPeriodChange={handlePeriodChange}
                onSyncNow={handleSyncNow}
                user={session.user}
                onUserUpdated={handleUserUpdated}
              />
            )}
          </>
        )}
      </main>

      <TabBar tab={tab} setTab={setTab} />
      {pendingPeriodId && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setPendingPeriodId(null)}>
          <section className="confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="period-confirm-title" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-icon" aria-hidden="true">↻</div>
            <h2 id="period-confirm-title">Load older settlement?</h2>
            <p>Home, receipts, spending, and settle will switch to this period. You can return to the current settlement anytime in Settings.</p>
            <div className="confirm-actions">
              <button type="button" className="confirm-cancel" onClick={() => setPendingPeriodId(null)}>Cancel</button>
              <button type="button" className="confirm-primary" onClick={confirmPeriodChange}>Load settlement</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
