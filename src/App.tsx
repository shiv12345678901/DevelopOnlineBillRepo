import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  fetchSettlementForPeriod, fetchReceiptsForPeriod, fetchPeriods, supabase,
  fetchMemberAvatarUrls, memberNameKey,
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
import {
  ACTIVE_SYNC_STORAGE_KEY,
  INITIAL_SYNC_STATE,
  fetchLatestActiveSync,
  fetchSyncRequest,
  isActiveSyncStatus,
  type SyncRequestRow,
  type SyncState,
} from "./sync";

const THEME_KEY = "splitmate-theme";
const SYNC_POLL_MS = 5000;
const SYNC_TIMEOUT_MS = 300000;

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
  const [avatarUrl, setAvatarUrl] = useState("");
  const [memberAvatarUrls, setMemberAvatarUrls] = useState<Record<string, string>>({});
  const [syncState, setSyncState] = useState<SyncState>(INITIAL_SYNC_STATE);
  const activeSyncIdRef = useRef<string | null>(localStorage.getItem(ACTIVE_SYNC_STORAGE_KEY));
  const pollTimerRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);
  const pollGenerationRef = useRef(0);
  const startingSyncRef = useRef(false);
  const refreshDataRef = useRef<() => Promise<void>>(async () => undefined);
  const recoverSyncRef = useRef<() => Promise<void>>(async () => undefined);
  const previousTabRef = useRef<TabId>(tab);

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

  // Receipts and settlement evidence may change after a backend sync while
  // another page is open. Re-read Supabase whenever either data page opens.
  useEffect(() => {
    const previousTab = previousTabRef.current;
    previousTabRef.current = tab;
    if (!session || previousTab === tab || (tab !== "receipts" && tab !== "settle")) return;

    let cancelled = false;
    setLoading(true);
    refreshData().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [tab, session?.user.id]);

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

  refreshDataRef.current = refreshData;

  function clearSyncTimers() {
    if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    if (timeoutTimerRef.current !== null) window.clearTimeout(timeoutTimerRef.current);
    pollTimerRef.current = null;
    timeoutTimerRef.current = null;
  }

  function stageMessageFor(request: SyncRequestRow) {
    if (request.stage_message) return request.stage_message;
    if (request.status === "pending") return "Waiting for the sync service…";
    return "Sync in progress…";
  }

  async function finishSync(request: SyncRequestRow) {
    clearSyncTimers();
    activeSyncIdRef.current = null;
    localStorage.removeItem(ACTIVE_SYNC_STORAGE_KEY);

    if (request.status === "done") {
      setSyncState({
        requestId: request.id,
        status: "done",
        stageMessage: request.stage_message || "Sync complete",
        resultSummary: request.result_summary || "Your data is up to date.",
        error: "",
      });
      try {
        await refreshDataRef.current();
      } catch {
        // The sync is still complete. A later app refresh can retry the data read.
      }
      return;
    }

    setSyncState({
      requestId: request.id,
      status: "failed",
      stageMessage: request.stage_message || "Sync failed",
      resultSummary: "",
      error: request.error || request.stage_message || "The sync could not be completed.",
    });
  }

  function scheduleSyncPoll(requestId: string, generation: number) {
    if (generation !== pollGenerationRef.current) return;
    if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = window.setTimeout(() => void pollSyncRequest(requestId, generation), SYNC_POLL_MS);
  }

  async function pollSyncRequest(requestId: string, generation: number) {
    if (generation !== pollGenerationRef.current) return;
    try {
      const request = await fetchSyncRequest(requestId);
      if (generation !== pollGenerationRef.current) return;
      if (!request) {
        scheduleSyncPoll(requestId, generation);
        return;
      }
      if (request.status === "done" || request.status === "failed") {
        await finishSync(request);
        return;
      }
      if (isActiveSyncStatus(request.status)) {
        setSyncState({
          requestId,
          status: request.status,
          stageMessage: stageMessageFor(request),
          resultSummary: "",
          error: "",
        });
      }
    } catch {
      // A transient network error must not turn a live backend job into a false failure.
    }
    scheduleSyncPoll(requestId, generation);
  }

  async function checkSyncTimeout(requestId: string, generation: number) {
    if (generation !== pollGenerationRef.current) return;
    try {
      const request = await fetchSyncRequest(requestId);
      if (generation !== pollGenerationRef.current) return;
      if (request?.status === "done" || request?.status === "failed") {
        await finishSync(request);
        return;
      }
      if (request && isActiveSyncStatus(request.status)) {
        setSyncState({
          requestId,
          status: request.status,
          stageMessage: stageMessageFor(request),
          resultSummary: "",
          error: "",
        });
      } else {
        throw new Error("Sync request is unavailable.");
      }
    } catch {
      setSyncState((current) => ({
        ...current,
        requestId,
        status: "unreachable",
        stageMessage: "Still syncing — reconnecting…",
        error: "The sync status could not be reached. We’ll keep checking automatically.",
      }));
    }

    timeoutTimerRef.current = window.setTimeout(
      () => void checkSyncTimeout(requestId, generation),
      SYNC_TIMEOUT_MS,
    );
    scheduleSyncPoll(requestId, generation);
  }

  function attachToSync(request: SyncRequestRow) {
    clearSyncTimers();
    const generation = ++pollGenerationRef.current;
    activeSyncIdRef.current = request.id;
    localStorage.setItem(ACTIVE_SYNC_STORAGE_KEY, request.id);
    setSyncState({
      requestId: request.id,
      status: isActiveSyncStatus(request.status) ? request.status : "processing",
      stageMessage: stageMessageFor(request),
      resultSummary: "",
      error: "",
    });
    scheduleSyncPoll(request.id, generation);
    timeoutTimerRef.current = window.setTimeout(
      () => void checkSyncTimeout(request.id, generation),
      SYNC_TIMEOUT_MS,
    );
  }

  async function recoverActiveSync() {
    const storedRequestId = localStorage.getItem(ACTIVE_SYNC_STORAGE_KEY);
    let storedRequest: SyncRequestRow | null = null;
    let storedRequestUnreachable = false;

    if (storedRequestId) {
      try {
        storedRequest = await fetchSyncRequest(storedRequestId);
        if (storedRequest?.status === "done" || storedRequest?.status === "failed") {
          await finishSync(storedRequest);
          storedRequest = null;
        } else if (!storedRequest || !isActiveSyncStatus(storedRequest.status)) {
          storedRequestUnreachable = true;
        }
      } catch {
        storedRequestUnreachable = true;
      }
    }

    try {
      const latestActive = await fetchLatestActiveSync();
      if (latestActive) {
        const storedCreatedAt = storedRequest?.created_at ? Date.parse(storedRequest.created_at) : 0;
        const latestCreatedAt = latestActive.created_at ? Date.parse(latestActive.created_at) : 0;
        attachToSync(storedRequest && storedCreatedAt > latestCreatedAt ? storedRequest : latestActive);
        return;
      }
    } catch {
      // Fall back to the saved request below when discovery is temporarily unavailable.
    }

    if (storedRequest && isActiveSyncStatus(storedRequest.status)) {
      attachToSync(storedRequest);
    } else if (storedRequestId && storedRequestUnreachable) {
      attachToSync({ id: storedRequestId, status: "processing", stage_message: "Still syncing — reconnecting…" });
      setSyncState({
        requestId: storedRequestId,
        status: "unreachable",
        stageMessage: "Still syncing — reconnecting…",
        resultSummary: "",
        error: "The saved sync request could not be reached. We’ll keep checking automatically.",
      });
    }
  }

  recoverSyncRef.current = recoverActiveSync;

  useEffect(() => {
    if (session) void recoverSyncRef.current();
  }, [session?.user.id]);

  useEffect(() => {
    if (session && tab === "settings") void recoverSyncRef.current();
  }, [session?.user.id, tab]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void recoverSyncRef.current();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearSyncTimers();
      pollGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const avatarPath = session?.user.user_metadata.avatar_path;
    if (!avatarPath) {
      setAvatarUrl("");
      return;
    }

    let cancelled = false;
    supabase.storage.from("avatars").createSignedUrl(avatarPath, 60 * 60 * 24 * 7)
      .then(({ data }) => {
        if (!data?.signedUrl || cancelled) return;
        const image = new Image();
        image.onload = () => {
          if (!cancelled) setAvatarUrl(data.signedUrl);
        };
        image.src = data.signedUrl;
      });

    return () => { cancelled = true; };
  }, [session?.user.id, session?.user.user_metadata.avatar_path]);

  useEffect(() => {
    if (!session) {
      setMemberAvatarUrls({});
      return;
    }

    let cancelled = false;
    fetchMemberAvatarUrls().then((urls) => {
      if (!cancelled) setMemberAvatarUrls(urls);
    });
    return () => { cancelled = true; };
  }, [session?.user.id]);

  useEffect(() => {
    const displayName = session?.user.user_metadata.display_name;
    if (!displayName || !avatarUrl) return;
    setMemberAvatarUrls((current) => ({ ...current, [memberNameKey(displayName)]: avatarUrl }));
  }, [avatarUrl, session?.user.id, session?.user.user_metadata.display_name]);

  async function handleSyncNow() {
    if (startingSyncRef.current) return;
    startingSyncRef.current = true;
    try {
      if (activeSyncIdRef.current) {
        await recoverActiveSync();
        return;
      }

      const latestActive = await fetchLatestActiveSync();
      if (latestActive) {
        attachToSync(latestActive);
        return;
      }

      setSyncState({ ...INITIAL_SYNC_STATE, status: "starting", stageMessage: "Starting sync…" });
      const { data, error } = await supabase
        .from("sync_requests")
        .insert({ requested_by: "netlify-app", status: "pending" })
        .select("*")
        .single();
      if (error || !data) throw error || new Error("Could not start sync.");
      attachToSync(data as SyncRequestRow);
    } catch (error) {
      setSyncState({
        requestId: null,
        status: "failed",
        stageMessage: "Sync could not start",
        resultSummary: "",
        error: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      startingSyncRef.current = false;
    }
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
            {tab === "home" && <HomeTab settlement={settlement} periods={periods} memberAvatarUrls={memberAvatarUrls} user={session.user} onOpenHistory={() => setTab("history")} />}
            {tab === "receipts" && <ReceiptsTab receipts={receipts} />}
            {tab === "settle" && <SettleTab settlement={settlement} periods={periods} memberAvatarUrls={memberAvatarUrls} />}
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
                syncState={syncState}
                user={session.user}
                avatarUrl={avatarUrl}
                onAvatarUrlChange={setAvatarUrl}
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
