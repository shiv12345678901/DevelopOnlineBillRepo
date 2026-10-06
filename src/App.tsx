import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ledgerRepository, scanReceipt, uploadReceipt, fetchPreferences, savePreferences, type Preferences } from "./api";
import { applyTheme, getThemePref, watchSystemTheme, type ThemePref } from "./theme";
import { loadLedgerCache, saveLedgerCache } from "./ledger-cache";

type Tab = "home" | "settle" | "camera" | "receipts" | "settings";

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void | Promise<void>;
};

type Cycle = {
  id: string;
  name: string;
  members: string[];
  startsOn: string;
  endsOn: string | null;
};

type LedgerEntry = {
  id: string;
  cycleId: string;
  payer: string;
  amount: number;
  merchant?: string;
  note: string;
  spentOn: string;
  confidence: number;
  receiptPath?: string;
  receiptUrl?: string;
};

type PendingReceipt = {
  id: string;
  file: File;
  preview: string;
  payer: string;
  amount: string;
  merchant: string;
  note: string;
  spentOn: string;
  status: "scanning" | "ready";
  confidence: number;
  engine: "ai" | "manual";
};

type IconName =
  | "home"
  | "settle"
  | "camera"
  | "people"
  | "settings"
  | "chevron"
  | "arrow"
  | "plus"
  | "calendar"
  | "receipt"
  | "check"
  | "close"
  | "trash"
  | "lock"
  | "refresh";

const GROUP_NAME = "Rockdale Homies";
const LAST_SYNC_KEY = "rockdale-last-sync";
const DEVICE_KEY = "rockdale-device-id";
// A cache younger than this is served without touching the network.
const CACHE_TTL_MS = 60_000;

/** Stable per-installation id, used as the preferences key in the database. */
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** Compact relative stamp for the Cloud Sync row. */
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const date = new Date(timestamp);
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Short day stamp for ranges: "1 Oct". */
function formatDay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** iOS activity indicator: eight blades fading in sequence. */
function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className="ios-spinner" style={{ width: size, height: size }} aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} style={{ transform: `rotate(${i * 45}deg)`, animationDelay: `${(i / 8) * -0.9}s` }} />
      ))}
    </span>
  );
}

const DEFAULT_MEMBERS = ["Shiva", "Arjun", "Arpan", "Swasti"];
const AVATARS: Record<string, { initials: string; color: string }> = {
  Shiva: { initials: "SH", color: "#cfff57" },
  Arjun: { initials: "AJ", color: "#ffac7f" },
  Arpan: { initials: "AP", color: "#79d6ef" },
  Swasti: { initials: "SW", color: "#cba3f4" },
};

const today = () => new Date().toISOString().slice(0, 10);
const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
};
const money = (value: number, decimals = 0) =>
  value.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

async function resizeReceipt(file: File, maxSide = 1600, quality = 0.84) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { imageBase64: dataUrl.split(",")[1], mimeType: "image/jpeg" };
}

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="M3.5 10.5 12 3l8.5 7.5"/><path d="M5.5 9.5v10h13v-10M9.5 19.5v-6h5v6"/></>,
    settle: <><path d="M5 7h14M5 17h14"/><path d="m15 3 4 4-4 4M9 13l-4 4 4 4"/></>,
    camera: <><path d="M4 7.5h3l1.5-2h7l1.5 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></>,
    people: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20v-2.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V20M15 14h1.5a4 4 0 0 1 4 4v2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.8 2.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1 1.7V21h-4v-.1a1.8 1.8 0 0 0-1-1.7 1.8 1.8 0 0 0-2 .4l-.1.1-2.8-2.8.1-.1a1.8 1.8 0 0 0 .4-2A1.8 1.8 0 0 0 3 14H3v-4h.1a1.8 1.8 0 0 0 1.7-1 1.8 1.8 0 0 0-.4-2l-.1-.1 2.8-2.8.1.1a1.8 1.8 0 0 0 2 .4A1.8 1.8 0 0 0 10 3V3h4v.1a1.8 1.8 0 0 0 1 1.7 1.8 1.8 0 0 0 2-.4l.1-.1 2.8 2.8-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.7 1H21v4h-.1a1.8 1.8 0 0 0-1.5.8Z"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></>,
    receipt: <><path d="M6 3h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    check: <path d="m5 12 4 4 10-10"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
    lock: <><rect x="4.5" y="10" width="15" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M18.2 17a8 8 0 1 1 1.4-8.5L20 12"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const avatar = AVATARS[name] ?? { initials: name.slice(0, 2).toUpperCase(), color: "#dbe2ea" };
  return <span className={`avatar avatar-${size}`} style={{ backgroundColor: avatar.color }}>{avatar.initials}</span>;
}

function computeSettlements(entries: LedgerEntry[], members: string[]) {
  const paidBy: Record<string, number> = Object.fromEntries(members.map((member) => [member, 0]));
  entries.forEach((entry) => { paidBy[entry.payer] = (paidBy[entry.payer] ?? 0) + entry.amount; });
  const total = Object.values(paidBy).reduce((sum, amount) => sum + amount, 0);
  const share = members.length ? total / members.length : 0;
  const net = Object.fromEntries(members.map((member) => [member, paidBy[member] - share]));
  const debtors = members.filter((member) => net[member] < -0.005).map((name) => ({ name, amount: -net[name] })).sort((a, b) => b.amount - a.amount);
  const creditors = members.filter((member) => net[member] > 0.005).map((name) => ({ name, amount: net[name] })).sort((a, b) => b.amount - a.amount);
  const settlements: { from: string; to: string; amount: number }[] = [];
  let debtor = 0;
  let creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const amount = Math.min(debtors[debtor].amount, creditors[creditor].amount);
    if (amount > 0.005) settlements.push({ from: debtors[debtor].name, to: creditors[creditor].name, amount });
    debtors[debtor].amount -= amount;
    creditors[creditor].amount -= amount;
    if (debtors[debtor].amount <= 0.005) debtor++;
    if (creditors[creditor].amount <= 0.005) creditor++;
  }
  return { paidBy, total, share, net, settlements };
}

function translateYOf(element: HTMLElement) {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m42;
}

function rubberband(distance: number, dimension: number, constant = 0.55) {
  return (distance * dimension * constant) / (dimension + constant * Math.abs(distance));
}

function projectVelocity(velocity: number, decelerationRate = 0.99) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

function useSheetGesture(onClose: () => void) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const closeRef = useRef(onClose);
  const gestureRef = useRef({
    active: false,
    pointerId: 0,
    startY: 0,
    startTranslate: 0,
    lastY: 0,
    lastTime: 0,
    velocity: 0,
  });
  closeRef.current = onClose;

  const renderPosition = useCallback((position: number) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transform = `translate3d(0, ${position}px, 0)`;
    const progress = Math.min(1, Math.max(0, position / Math.max(window.innerHeight, 1)));
    sheet.parentElement?.style.setProperty("--scrim-opacity", String((1 - progress) * 0.46));
  }, []);

  const springTo = useCallback((target: number, initialVelocity = 0, complete?: () => void) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      renderPosition(target);
      complete?.();
      return;
    }

    let position = translateYOf(sheet);
    let velocity = initialVelocity;
    let previous = performance.now();
    const stiffness = 250;
    const damping = 31;

    const frame = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.032);
      previous = now;
      const acceleration = -stiffness * (position - target) - damping * velocity;
      velocity += acceleration * delta;
      position += velocity * delta;
      renderPosition(position);
      if (Math.abs(position - target) < 0.5 && Math.abs(velocity) < 8) {
        renderPosition(target);
        animationRef.current = null;
        complete?.();
        return;
      }
      animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
  }, [renderPosition]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      renderPosition(0);
      return;
    }
    renderPosition(Math.min(window.innerHeight, sheet.getBoundingClientRect().height + 40));
    animationRef.current = requestAnimationFrame(() => springTo(0));
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [renderPosition, springTo]);

  const dismissWith = useCallback((complete?: () => void) => {
    springTo(window.innerHeight, 250, complete ?? (() => closeRef.current()));
  }, [springTo]);

  const dismiss = useCallback(() => dismissWith(), [dismissWith]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const current = translateYOf(sheet);
    gestureRef.current = {
      active: true,
      pointerId: event.pointerId,
      startY: event.clientY,
      startTranslate: current,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    sheet.classList.add("is-dragging");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;
    const elapsed = Math.max(event.timeStamp - gesture.lastTime, 1);
    const instantaneousVelocity = ((event.clientY - gesture.lastY) / elapsed) * 1000;
    gesture.velocity = gesture.velocity * 0.65 + instantaneousVelocity * 0.35;
    gesture.lastY = event.clientY;
    gesture.lastTime = event.timeStamp;
    const raw = gesture.startTranslate + event.clientY - gesture.startY;
    const position = raw < 0 ? rubberband(raw, window.innerHeight) : raw;
    renderPosition(position);
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;
    gesture.active = false;
    sheetRef.current?.classList.remove("is-dragging");
    const current = sheetRef.current ? translateYOf(sheetRef.current) : 0;
    const projected = current + projectVelocity(gesture.velocity);
    const shouldDismiss = gesture.velocity > 700 || projected > window.innerHeight * 0.3;
    if (shouldDismiss) {
      springTo(window.innerHeight, gesture.velocity, () => closeRef.current());
    } else {
      springTo(0, gesture.velocity);
    }
  };

  return {
    sheetRef,
    dismiss,
    dragProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishGesture,
      onPointerCancel: finishGesture,
    },
  };
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReceipt[]>([]);
  const [defaultPayer, setDefaultPayer] = useState("");
  const [sheetExit, setSheetExit] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [themePref, setThemePref] = useState<ThemePref>(() => getThemePref());
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [detailCycleId, setDetailCycleId] = useState<string | null>(null);
  const [showCyclesPage, setShowCyclesPage] = useState(false);
  const [household, setHousehold] = useState<string>(() => localStorage.getItem("rockdale-household") || GROUP_NAME);
  const [editHousehold, setEditHousehold] = useState(false);
  const [editCycle, setEditCycle] = useState<Cycle | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // False until the first successful fetch — the initial load shows the
  // full-screen data states; later refreshes never blank the page.
  const [dataReady, setDataReady] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(LAST_SYNC_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
    const [remotePrefs, setRemotePrefs] = useState<Preferences | null>(null);
  // Guards the close-and-start flow so the confirmed create doesn't re-prompt.
  const previousCycleCloseConfirmed = useRef(false);
  const [toast, setToast] = useState("");
  const [showNewCycle, setShowNewCycle] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"loading" | "online" | "saving" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const overlayOpen = pending.length > 0 || showNewCycle || sheetExit || Boolean(editingEntry) || Boolean(confirmRequest) || showInstallGuide || Boolean(syncError) || Boolean(detailCycleId) || showCyclesPage || editHousehold || Boolean(editCycle);

  const cycle = cycles.find((item) => item.id === activeId) ?? cycles[0];

  // When the last receipt auto-saves (or is removed), slide the sheet away
  // instead of unmounting it abruptly.
  const pendingCountRef = useRef(0);
  useEffect(() => {
    if (pendingCountRef.current > 0 && pending.length === 0) {
      setSheetExit(true);
      const timer = window.setTimeout(() => setSheetExit(false), 320);
      pendingCountRef.current = 0;
      return () => window.clearTimeout(timer);
    }
    pendingCountRef.current = pending.length;
  }, [pending]);

  // Remember the last payer used so consecutive scans need no taps.
  useEffect(() => {
    if (!defaultPayer && cycle) setDefaultPayer(cycle.members[0] ?? "");
  }, [cycle, defaultPayer]);

  // Per-page scroll memory: leaving a page stores its position, arriving on
  // one restores it — like a native app's back stack.
  const scrollMemory = useRef<Partial<Record<Tab, number>>>({});
  const prevTabRef = useRef<Tab>(tab);
  useEffect(() => {
    if (prevTabRef.current !== tab) {
      scrollMemory.current[prevTabRef.current] = window.scrollY;
      prevTabRef.current = tab;
      const saved = scrollMemory.current[tab];
      requestAnimationFrame(() => window.scrollTo(0, saved ?? 0));
    }
  }, [tab]);
  const cycleEntries = useMemo(
    () => entries.filter((entry) => entry.cycleId === cycle?.id).sort((a, b) =>
      b.spentOn.localeCompare(a.spentOn) || b.id.localeCompare(a.id)
    ),
    [entries, cycle?.id],
  );
  const summary = useMemo(() => computeSettlements(cycleEntries, cycle?.members ?? []), [cycleEntries, cycle?.members]);

  const markSynced = useCallback(() => {
    const at = Date.now();
    setLastSync(at);
    try { localStorage.setItem(LAST_SYNC_KEY, String(at)); } catch { /* private mode */ }
  }, []);

  const fetchLedger = useCallback(async (opts?: { retries?: number; quiet?: boolean }): Promise<string | null> => {
    const retries = opts?.retries ?? 2;
    try {
      const snapshot = await ledgerRepository.fetch<Cycle, LedgerEntry>();
      setCycles(snapshot.cycles);
      setEntries(snapshot.entries);
      setActiveId(snapshot.activeId);
      setSyncStatus("online");
      setLoadError("");
      markSynced();
      setDataReady(true);
      return null;
    } catch (error) {
      // Dev-server reloads and flaky connections abort in-flight fetches;
      // retry quietly before surfacing the problem.
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return fetchLedger({ retries: retries - 1, quiet: opts?.quiet });
      }
      const message = error instanceof Error ? error.message : "Could not load the ledger.";
      // Background revalidation just flips the chip; the initial load owns
      // the full-screen error state.
      if (!opts?.quiet) setLoadError(message);
      setSyncStatus("error");
      return message;
    }
  }, []);

  /** Manual refresh: fade the page, spin the row, then report any failure. */
  const refreshLedger = useCallback(async () => {
    setRefreshing(true);
    try {
      const error = await fetchLedger({ retries: 1, quiet: true });
      if (error) setSyncError(error);
    } finally {
      setRefreshing(false);
    }
  }, [fetchLedger]);

  // Boot: serve the cached snapshot instantly, then revalidate in the
  // background only if it is older than the freshness window. A warm load
  // makes zero network calls.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const cached = loadLedgerCache();
    if (cached) {
      setCycles(cached.cycles as Cycle[]);
      setEntries(cached.entries as LedgerEntry[]);
      setActiveId(cached.activeId);
      setLastSync((prev) => {
        const best = Math.max(prev ?? 0, cached.savedAt);
        return best > 0 ? best : null;
      });
      setDataReady(true);
      setSyncStatus("online");
      if (Date.now() - cached.savedAt > CACHE_TTL_MS) void fetchLedger({ retries: 1, quiet: true });
    } else {
      void fetchLedger();
    }
    // Preferences ride along in the background: the database wins on boot,
    // like signing into an account.
    void (async () => {
      const stored = await fetchPreferences(deviceId());
      if (!stored) {
        // First run on this device — seed the row with local state.
        void savePreferences(deviceId(), { activeCycleId: localStorage.getItem("rockdale-active-cycle"), theme: getThemePref() });
        return;
      }
      setRemotePrefs(stored);
    })();
  }, [fetchLedger]);

  // Apply the database's preferences once both the cycles and the stored
  // preferences have arrived.
  const prefsAppliedRef = useRef(false);
  useEffect(() => {
    if (!remotePrefs || !dataReady || prefsAppliedRef.current) return;
    prefsAppliedRef.current = true;
    if (remotePrefs.theme !== "auto" && remotePrefs.theme !== getThemePref()) {
      setThemePref(remotePrefs.theme);
    }
    if (remotePrefs.householdName && remotePrefs.householdName !== household) {
      setHousehold(remotePrefs.householdName);
      localStorage.setItem("rockdale-household", remotePrefs.householdName);
    }
    if (remotePrefs.activeCycleId && cycles.some((item) => item.id === remotePrefs.activeCycleId)) {
      setActiveId((current) => {
        if (current === remotePrefs.activeCycleId) return current;
        localStorage.setItem("rockdale-active-cycle", remotePrefs.activeCycleId!);
        flash(`Switched to ${cycles.find((item) => item.id === remotePrefs.activeCycleId)?.name ?? "saved cycle"}`);
        return remotePrefs.activeCycleId;
      });
    }
    // The saved household is the identity this page renders; it changes only
    // through the edit sheet, so depending on it here would re-run needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotePrefs, dataReady, cycles]);

  // Write-through: persist the snapshot whenever it changes, preserving the
  // original savedAt when the data is identical so the TTL is not reset by
  // a no-op reload.
  useEffect(() => {
    if (!dataReady) return;
    const fingerprint = JSON.stringify([cycles, entries, activeId]);
    const prev = loadLedgerCache();
    const unchanged = Boolean(prev && JSON.stringify([prev.cycles, prev.entries, prev.activeId]) === fingerprint);
    saveLedgerCache(cycles, entries, activeId, unchanged ? prev!.savedAt : Date.now());
  }, [cycles, entries, activeId, dataReady]);

  useEffect(() => {
    applyTheme(themePref);
  }, [themePref]);

  // Persist theme choices to the database once the remote preference has
  // been applied, so the choice follows the user across devices.
  useEffect(() => {
    if (!prefsAppliedRef.current || bootedRef.current !== true) return;
    void savePreferences(deviceId(), { theme: themePref });
  }, [themePref]);

  useEffect(() => watchSystemTheme(() => applyTheme(getThemePref())), []);

  useEffect(() => {
    if (!overlayOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = "";
      body.style.top = "";
      body.style.width = "";
      body.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, [overlayOpen]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const openConfirm = (request: ConfirmRequest) => setConfirmRequest(request);

  const selectTab = (next: Tab) => {
    if (next === "camera") {
      fileInput.current?.click();
      return;
    }
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const queueFiles = (files: FileList | null) => {
    if (!files || !cycle) return;
    if (cycle.endsOn) {
      flash(`“${cycle.name}” is closed — set an active cycle to add receipts`);
      return;
    }
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    const next = images.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
      payer: defaultPayer || cycle.members[0] || "",
      amount: "",
      merchant: "",
      note: "",
      spentOn: today(),
      status: "scanning" as const,
      confidence: 0,
      engine: "ai" as const,
    }));
    setPending((current) => [...current, ...next]);
    next.forEach((item) => void processReceipt(item));
  };

  /**
   * Recognition only: the server chains Gemini, then a fallback vision
   * model, and stages the result in the review sheet. Nothing reaches the
   * ledger until the user confirms, so an OCR misread can be corrected
   * before it is saved.
   */
  const processReceipt = async (item: PendingReceipt) => {
    const apply = (patch: Partial<PendingReceipt>) => setPending((current) => current.map((receipt) =>
      receipt.id === item.id ? { ...receipt, ...patch } : receipt
    ));

    try {
      // Re-enter the reading state so a rescan shows progress too.
      apply({ status: "scanning", confidence: 0 });
      const image = await resizeReceipt(item.file);

      // The server tries Gemini first, then the configured fallback model.
      const result = await scanReceipt(image.imageBase64, image.mimeType);
      if (result.amount !== null && Number(result.amount) > 0) {
        apply({
          status: "ready",
          amount: String(result.amount),
          merchant: result.merchant || "",
          confidence: result.confidence,
          engine: "ai",
        });
        return;
      }

      // No readable total anywhere — manual entry.
      apply({ status: "ready", engine: "manual" });
      flash("Couldn't read a total — type it in or scan again");
    } catch {
      apply({ status: "ready", engine: "manual" });
      flash("Couldn't process that image. Enter the total manually.");
    }
  };


  const saveReceipts = async () => {
    if (!cycle) return;
    const readyItems = pending.filter((item) => item.status === "ready");
    const valid = readyItems.filter((item) => Number(item.amount) > 0 && item.payer);
    if (!readyItems.length) return;
    // Nothing valid: put the cursor exactly where the problem is.
    if (!valid.length) {
      document.getElementById(`receipt-amount-${readyItems[0].id}`)?.focus();
      flash("Enter the total to save this receipt");
      return;
    }
    if (valid.length !== readyItems.length) {
      const incomplete = readyItems.find((item) => !(Number(item.amount) > 0 && item.payer));
      if (incomplete) document.getElementById(`receipt-amount-${incomplete.id}`)?.focus();
    }
    setSyncStatus("saving");
    const created: LedgerEntry[] = [];
    try {
      // One receipt at a time so a single bad image can't lose the whole batch.
      for (const item of valid) {
        // A smaller copy kept in storage so the receipt stays viewable.
        const stored = await resizeReceipt(item.file, 900, 0.72);
        // Prefer the storage bucket; fall back to an inline copy when the
        // bucket isn't set up (supabase/storage-setup.sql).
        const receiptUrl = await uploadReceipt(cycle.id, stored.imageBase64, stored.mimeType);
        created.push(...await ledgerRepository.createEntries<LedgerEntry>([{
          cycleId: cycle.id,
          payer: item.payer,
          amount: Number(item.amount),
          merchant: item.merchant.trim(),
          note: item.note.trim(),
          spentOn: item.spentOn,
          confidence: item.confidence,
          receiptUrl: receiptUrl ?? undefined,
          receiptImageBase64: receiptUrl ? undefined : stored.imageBase64,
          receiptMimeType: stored.mimeType,
        }]));
      }
      setEntries((current) => [...created, ...current]);
      pending.forEach((item) => URL.revokeObjectURL(item.preview));
      setPending([]);
      setSyncStatus("online");
      markSynced();
      flash(`${created.length} receipt${created.length === 1 ? "" : "s"} added`);
      setTab("home");
    } catch (error) {
      if (created.length) setEntries((current) => [...created, ...current]);
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not save the receipts.");
    }
  };

  const closePending = () => {
    pending.forEach((item) => URL.revokeObjectURL(item.preview));
    setPending([]);
  };

  const updateEntry = async (id: string, patch: { payer: string; amount: number; merchant: string; note: string; spentOn: string }) => {
    setSyncStatus("saving");
    try {
      const updated = await ledgerRepository.updateEntry<LedgerEntry>(id, patch);
      setEntries((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setSyncStatus("online");
      markSynced();
      setEditingEntry(null);
      flash("Receipt updated");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not update the receipt.");
    }
  };

  // Closing works on any cycle and always surfaces its settlement first.
  const closeCycleById = async (id: string, options?: { skipConfirm?: boolean }) => {
    const target = cycles.find((item) => item.id === id);
    if (!target || target.endsOn) return;
    const targetEntries = entries.filter((entry) => entry.cycleId === id);
    const targetSummary = computeSettlements(targetEntries, target.members);
    const outstanding = targetSummary.settlements.reduce((sum, payment) => sum + payment.amount, 0);
    if (!options?.skipConfirm) {
      openConfirm({
        title: `Close “${target.name}”?`,
        message: outstanding > 0
          ? `${targetSummary.settlements.length} unresolved payment${targetSummary.settlements.length === 1 ? "" : "s"} totalling ${money(outstanding)} remain. It closes today and becomes read-only; balances stay visible.`
          : `“${target.name}” is fully settled. It closes today and becomes read-only; balances stay visible.`,
        confirmLabel: "Close cycle",
        action: () => closeCycleById(id, { skipConfirm: true }),
      });
      return;
    }
    setSyncStatus("saving");
    try {
      const updated = await ledgerRepository.updateCycle<Cycle>(id, { endsOn: today() });
      setCycles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSyncStatus("online");
      markSynced();
      flash("Cycle closed and locked");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not close the cycle.");
    }
  };

  const reopenCycle = async (id: string) => {
    setSyncStatus("saving");
    try {
      const updated = await ledgerRepository.updateCycle<Cycle>(id, { endsOn: null });
      setCycles((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSyncStatus("online");
      markSynced();
      flash("Cycle reopened");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not reopen the cycle.");
    }
  };

  const commitCycleEdit = async (id: string, patch: { name: string; members: string[]; startsOn: string; endsOn: string | null }) => {
    setSyncStatus("saving");
    try {
      const updated = await ledgerRepository.updateCycle<Cycle>(id, patch);
      setCycles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSyncStatus("online");
      markSynced();
      setEditCycle(null);
      flash("Cycle updated");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not update the cycle.");
    }
  };

  const removeCycle = async (id: string) => {
    setSyncStatus("saving");
    try {
      await ledgerRepository.deleteCycle(id);
      const remaining = cycles.filter((item) => item.id !== id);
      setCycles(remaining);
      setEntries((current) => current.filter((entry) => entry.cycleId !== id));
      if (activeId === id) {
        const next = remaining[0] ?? null;
        setActiveId(next?.id ?? null);
        localStorage.setItem("rockdale-active-cycle", next?.id ?? "");
        void savePreferences(deviceId(), { activeCycleId: next?.id ?? null });
        setTab("home");
      }
      setSyncStatus("online");
      markSynced();
      flash("Cycle deleted");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not delete the cycle.");
    }
  };

  const requestCycleDelete = (id: string, receiptCount: number, isActive: boolean) => {
    const target = cycles.find((item) => item.id === id);
    if (!target) return;
    openConfirm({
      title: `Delete “${target.name}”?`,
      message: `The cycle and its ${receiptCount} receipt${receiptCount === 1 ? "" : "s"} will be permanently removed. This cannot be undone.${isActive ? " It is the active cycle — the next one takes over." : ""}`,
      confirmLabel: "Delete cycle",
      action: () => removeCycle(id),
    });
  };

  // Switching cycles behaves like changing accounts: the whole app flips
  // instantly and optimistically, the choice is persisted to the database,
  // and a failure rolls the switch back.
  const selectCycle = async (id: string) => {
    if (id === activeId) {
      setTab("home");
      return;
    }
    const previous = activeId;
    const target = cycles.find((item) => item.id === id);
    setActiveId(id);
    localStorage.setItem("rockdale-active-cycle", id);
    setTab("home");
    flash(`Switched to ${target?.name ?? "cycle"}`);
    setSyncStatus("saving");
    try {
      await ledgerRepository.setActiveCycle(id);
      void savePreferences(deviceId(), { activeCycleId: id });
      setSyncStatus("online");
      markSynced();
    } catch (error) {
      setActiveId(previous);
      localStorage.setItem("rockdale-active-cycle", previous ?? "");
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not switch cycles.");
    }
  };

  // Starting a cycle while one is live closes the old one first — with its
  // settlement surfaced, so nothing is silently abandoned.
  const createCycle = async (name: string, members: string[], startsOn: string) => {
    const previous = cycle && !cycle.endsOn ? cycle : null;
    if (previous && !previousCycleCloseConfirmed.current) {
      const outstanding = summary.settlements.reduce((sum, payment) => sum + payment.amount, 0);
      openConfirm({
        title: `Close “${previous.name}” first?`,
        message: outstanding > 0
          ? `${summary.settlements.length} unresolved payment${summary.settlements.length === 1 ? "" : "s"} totalling ${money(outstanding)} remain in “${previous.name}”. It will close today and become read-only; new receipts land in “${name}”.`
          : `“${previous.name}” is fully settled. It will close today and become read-only; new receipts land in “${name}”.`,
        confirmLabel: "Close & start new",
        action: async () => {
          previousCycleCloseConfirmed.current = true;
          try {
            await createCycle(name, members, startsOn);
          } finally {
            previousCycleCloseConfirmed.current = false;
          }
        },
      });
      return;
    }
    setSyncStatus("saving");
    try {
      const created = await ledgerRepository.createCycle<Cycle>({ name, members, startsOn, endsOn: null });
      setCycles((current) => [created, ...current]);
      setActiveId(created.id);
      localStorage.setItem("rockdale-active-cycle", created.id);
      void savePreferences(deviceId(), { activeCycleId: created.id });
      if (previous) {
        try {
          const closed = await ledgerRepository.updateCycle<Cycle>(previous.id, { endsOn: today() });
          setCycles((current) => current.map((item) => (item.id === closed.id ? closed : item)));
        } catch {
          flash(`${created.name} started — closing “${previous.name}” failed. Close it from its detail page.`);
        }
      }
      setShowNewCycle(false);
      setSyncStatus("online");
      markSynced();
      setTab("home");
      flash(previous ? `Closed ${previous.name} — started ${created.name}` : "New cycle created");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not create the cycle.");
    }
  };

  const deleteEntry = async (entry: LedgerEntry) => {
    setSyncStatus("saving");
    try {
      await ledgerRepository.deleteEntry(entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setSyncStatus("online");
      markSynced();
      flash("Entry deleted");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not delete the entry.");
    }
  };

  const exportLedger = () => {
    if (!entries.length) {
      flash("No receipts to export yet");
      return;
    }
    const cycleCount = new Set(entries.map((entry) => entry.cycleId)).size;
    openConfirm({
      title: "Export your ledger?",
      message: `${entries.length} receipt${entries.length === 1 ? "" : "s"} across ${cycleCount} cycle${cycleCount === 1 ? "" : "s"} will download as grocery-ledger-${today()}.csv — merchant, date, payer, amount and note for each.`,
      confirmLabel: "Download CSV",
      action: runExport,
    });
  };

  const runExport = () => {
    const cycleNames = Object.fromEntries(cycles.map((item) => [item.id, item.name]));
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Cycle", "Merchant", "Date", "Paid by", "Amount AUD", "Note"],
      ...entries.map((entry) => [
        cycleNames[entry.cycleId] ?? "",
        entry.merchant ?? "",
        entry.spentOn,
        entry.payer,
        entry.amount.toFixed(2),
        entry.note,
      ]),
    ];
    const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `grocery-ledger-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    flash("Ledger exported");
  };

  const installApp = () => setShowInstallGuide(true);

  const title = tab === "home" ? greeting() : tab === "settle" ? "Settle up" : tab === "receipts" ? "Receipts" : "Settings";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{tab === "home" ? "Home household" : household}</p>
          <h1>{title}</h1>
        </div>
        {tab !== "settings" && (
          <button className="profile-button more-button" onClick={() => setTab("settings")} aria-label="Open settings">
            <span>•••</span>
          </button>
        )}
      </header>

      <main className={`content ${refreshing ? "content-refreshing" : ""}`}>
        <div className="screen-transition" key={`${tab}-${activeId}`}>
        {!dataReady ? (
          loadError ? (
            <DataState title="Couldn’t load your ledger" copy={loadError} action={fetchLedger} actionLabel="Try again" />
          ) : (
            <DataState title="Loading your ledger" copy="Fetching the latest cycles and receipts from Supabase." />
          )
        ) : !cycle ? (
          <EmptyState title="No active cycle" copy="Create a cycle to start tracking shared groceries." action={() => setShowNewCycle(true)} />
        ) : tab === "home" ? (
          <HomeView
            cycle={cycle}
            entries={cycleEntries}
            total={summary.total}
            share={summary.share}
            onCamera={() => fileInput.current?.click()}
            onSettle={() => setTab("settle")}
          />
        ) : tab === "settle" ? (
          <SettleView cycle={cycle} summary={summary} entries={cycleEntries} onClose={() => closeCycleById(cycle.id)} />
        ) : tab === "receipts" ? (
          <ReceiptsView
            cycle={cycle}
            entries={cycleEntries}
            summary={summary}
            onEdit={(entry) => setEditingEntry(entry)}
            onDelete={deleteEntry}
            onConfirmRequest={openConfirm}
          />
        ) : (
          <SettingsView
            cycles={cycles}
            activeId={activeId}
            onNew={() => setShowNewCycle(true)}
            onRefresh={refreshLedger}
            onExport={exportLedger}
            onInstall={installApp}
            onOpenCycle={setDetailCycleId}
            onOpenCycles={() => setShowCyclesPage(true)}
            onEditHousehold={() => setEditHousehold(true)}
            household={household}
            syncStatus={syncStatus}
            themePref={themePref}
            onThemeChange={setThemePref}
            lastSyncedAt={lastSync}
            isRefreshing={refreshing}
          />
        )}
        </div>
      </main>

      <nav className="tabbar" aria-label="Primary navigation">
        <div className="tabbar-pill">
          {(["home", "settle", "receipts", "settings"] as Tab[]).map((item) => (
            <button
              key={item}
              className={`tab-button ${tab === item ? "active" : ""}`}
              onClick={() => selectTab(item)}
            >
              <span className="tab-icon"><Icon name={item === "receipts" ? "receipt" : item} size={22} /></span>
              <span>{item === "settle" ? "Settle" : item === "receipts" ? "Receipts" : item[0].toUpperCase() + item.slice(1)}</span>
            </button>
          ))}
        </div>
        <button className="cam-orb" onClick={() => fileInput.current?.click()} aria-label="Add receipt">
          <Icon name="camera" size={25} />
        </button>
      </nav>

      <input ref={fileInput} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => {
        queueFiles(event.target.files);
        event.target.value = "";
      }} />

      {(pending.length > 0 || sheetExit) && (
        <ReceiptSheet
          receipts={pending}
          exiting={sheetExit}
          members={cycle?.members ?? []}
          defaultPayer={defaultPayer}
          onPayerChange={setDefaultPayer}
          onUpdate={(id, update) => setPending((items) => items.map((item) => item.id === id ? { ...item, ...update } : item))}
          onRemove={(id) => setPending((items) => {
            const removed = items.find((item) => item.id === id);
            if (removed) URL.revokeObjectURL(removed.preview);
            return items.filter((item) => item.id !== id);
          })}
          onClose={closePending}
          onSave={saveReceipts}
          saving={syncStatus === "saving"}
          onScan={async (id) => {
            const item = pending.find((receipt) => receipt.id === id);
            if (item) await processReceipt(item);
          }}
        />
      )}

      {editingEntry && (
        <EditSheet
          entry={editingEntry}
          members={cycle?.members ?? []}
          saving={syncStatus === "saving"}
          onClose={() => setEditingEntry(null)}
          onSave={(patch) => updateEntry(editingEntry.id, patch)}
        />
      )}

      {confirmRequest && (
        <ConfirmSheet
          title={confirmRequest.title}
          message={confirmRequest.message}
          confirmLabel={confirmRequest.confirmLabel}
          onClose={() => setConfirmRequest(null)}
          onConfirm={async () => {
            const action = confirmRequest.action;
            setConfirmRequest(null);
            await action();
          }}
        />
      )}

      {showNewCycle && (
        <NewCycleSheet
          onClose={() => setShowNewCycle(false)}
          onCreate={createCycle}
          saving={syncStatus === "saving"}
        />
      )}

      {showInstallGuide && <InstallGuide onClose={() => setShowInstallGuide(false)} />}

      {showCyclesPage && (
        <CyclesPage
          cycles={cycles}
          activeId={activeId}
          entries={entries}
          onOpenCycle={setDetailCycleId}
          onEditCycle={(id) => {
            const target = cycles.find((item) => item.id === id);
            if (target) setEditCycle(target);
          }}
          onDeleteCycle={requestCycleDelete}
          onClose={() => setShowCyclesPage(false)}
        />
      )}

      {editCycle && (
        <CycleEditSheet
          cycle={editCycle}
          saving={syncStatus === "saving"}
          onClose={() => setEditCycle(null)}
          onSave={(patch) => commitCycleEdit(editCycle.id, patch)}
        />
      )}

      {editHousehold && (
        <TextEditSheet
          title="Household name"
          value={household}
          saving={syncStatus === "saving"}
          onClose={() => setEditHousehold(false)}
          onSave={async (next) => {
            setHousehold(next);
            localStorage.setItem("rockdale-household", next);
            void savePreferences(deviceId(), { householdName: next });
            setEditHousehold(false);
            flash("Household updated");
          }}
        />
      )}

      {detailCycleId && (() => {
        const detailCycle = cycles.find((item) => item.id === detailCycleId);
        if (!detailCycle) return null;
        const detailEntries = entries
          .filter((entry) => entry.cycleId === detailCycle.id)
          .sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.id.localeCompare(a.id));
        return (
          <CycleDetailPage
            cycle={detailCycle}
            entries={detailEntries}
            summary={computeSettlements(detailEntries, detailCycle.members)}
            isActive={detailCycle.id === activeId}
            saving={syncStatus === "saving"}
            backLabel={showCyclesPage ? "Cycles" : "Settings"}
            onClose={() => setDetailCycleId(null)}
            onSetActive={async () => {
              await selectCycle(detailCycle.id);
              setDetailCycleId(null);
            }}
            onReopen={reopenCycle}
            onCloseCycle={closeCycleById}
          />
        );
      })()}

      {syncError && (
        <ConfirmSheet
          tone="neutral"
          title="Sync problem"
          message={`${syncError.replace(/^TypeError:\s*/, "").replace(/\.$/, "")}. Check your internet connection, then try again. Last successful sync: ${lastSync ? timeAgo(lastSync) : "never"}.`}
          confirmLabel="Try again"
          onClose={() => setSyncError(null)}
          onConfirm={async () => {
            setSyncError(null);
            await refreshLedger();
          }}
        />
      )}

      {toast && <div className="toast"><Icon name="check" size={17} />{toast}</div>}
    </div>
  );
}

function HomeView({ cycle, entries, total, share, onCamera, onSettle }: {
  cycle: Cycle;
  entries: LedgerEntry[];
  total: number;
  share: number;
  onCamera: () => void;
  onSettle: () => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [memberFilter, setMemberFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [merchantFilter, setMerchantFilter] = useState("");
  const [minimumAmount, setMinimumAmount] = useState("");
  const [maximumAmount, setMaximumAmount] = useState("");
  const hasFilters = Boolean(memberFilter || dateFilter || merchantFilter || minimumAmount || maximumAmount);
  const filteredEntries = useMemo(() => entries.filter((entry) => {
    if (memberFilter && entry.payer !== memberFilter) return false;
    if (dateFilter && entry.spentOn !== dateFilter) return false;
    if (merchantFilter && !(entry.merchant ?? "").toLowerCase().includes(merchantFilter.toLowerCase())) return false;
    if (minimumAmount && entry.amount < Number(minimumAmount)) return false;
    if (maximumAmount && entry.amount > Number(maximumAmount)) return false;
    return true;
  }), [entries, memberFilter, dateFilter, merchantFilter, minimumAmount, maximumAmount]);

  const clearFilters = () => {
    setMemberFilter("");
    setDateFilter("");
    setMerchantFilter("");
    setMinimumAmount("");
    setMaximumAmount("");
  };

  return (
    <div className="view home-view">
      <section className="balance-card">
        <span className="balance-ring balance-ring-one" />
        <span className="balance-ring balance-ring-two" />
        <div className="card-topline">
          <strong className="cycle-name">{cycle.name}</strong>
          <span className="receipt-count">{cycle.endsOn ? "Closed" : "Live"}</span>
        </div>
        <div className="balance-value">{money(total, 2)}</div>
        <p className="balance-meta">{money(share, 2)} each · {entries.length} receipt{entries.length === 1 ? "" : "s"}</p>
        <div className="balance-footer">
          <div className="avatar-stack">
            {cycle.members.map((member) => <Avatar name={member} size="sm" key={member} />)}
          </div>
          <button className="settle-pill" onClick={onSettle}>Settle up <Icon name="arrow" size={18} /></button>
        </div>
      </section>

      {!cycle.endsOn && (
        <button className="scan-card" onClick={onCamera}>
          <span className="scan-icon"><Icon name="camera" size={26} /></span>
          <span className="scan-copy"><strong>Snap a receipt</strong><small>We'll prepare the details for you</small></span>
          <Icon name="chevron" size={19} />
        </button>
      )}

      {entries.some((entry) => entry.receiptUrl) && (
        <section className="section gallery-section">
          <div className="section-title">
            <div><p className="kicker">Receipts</p><h2>Receipt gallery</h2></div>
            <span className="subtle">{entries.filter((entry) => entry.receiptUrl).length} saved</span>
          </div>
          <div className="receipt-gallery">
            {entries.filter((entry) => entry.receiptUrl).map((entry) => (
              <a
                className="gallery-item"
                href={entry.receiptUrl}
                target="_blank"
                rel="noreferrer"
                key={entry.id}
                aria-label={`Open receipt from ${entry.merchant || entry.payer}`}
              >
                <img src={entry.receiptUrl} alt={entry.merchant ? `Receipt from ${entry.merchant}` : `Receipt paid by ${entry.payer}`} />
                <span><strong>{entry.merchant || "Receipt"}</strong><small>{money(entry.amount)}</small></span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="section activity-section">
        <div className="section-title">
          <div><p className="kicker">Activity</p><h2>Recent expenses</h2></div>
          <button className={`filter-toggle ${hasFilters ? "active" : ""}`} onClick={() => setFiltersOpen((open) => !open)}>
            {hasFilters ? `${filteredEntries.length} matches` : "Filter"}
          </button>
        </div>
        {filtersOpen && (
          <div className="filter-panel">
            <label><span>Member</span><select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}><option value="">Everyone</option>{cycle.members.map((member) => <option key={member}>{member}</option>)}</select></label>
            <label><span>Date</span><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label>
            <label className="merchant-filter"><span>Merchant</span><input value={merchantFilter} onChange={(event) => setMerchantFilter(event.target.value)} placeholder="Search merchant" /></label>
            <label><span>Minimum</span><input type="number" inputMode="decimal" min="0" placeholder="$0" value={minimumAmount} onChange={(event) => setMinimumAmount(event.target.value)} /></label>
            <label><span>Maximum</span><input type="number" inputMode="decimal" min="0" placeholder="Any" value={maximumAmount} onChange={(event) => setMaximumAmount(event.target.value)} /></label>
            {hasFilters && <button className="filter-clear" onClick={clearFilters}>Clear filters</button>}
          </div>
        )}
        <div className="list-card">
          {filteredEntries.length ? filteredEntries.slice(0, hasFilters ? 50 : 5).map((entry, index, visible) => (
            <div className="expense-row" key={entry.id}>
              <Avatar name={entry.payer} size="sm" />
              <div className="expense-main">
                <strong>{entry.merchant || entry.note || "Grocery receipt"}</strong>
                <span>{entry.payer} · {new Date(`${entry.spentOn}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
              </div>
              <strong className="expense-amount">{money(entry.amount)}</strong>
              {index < visible.length - 1 && <span className="row-divider" />}
            </div>
          )) : <div className="empty-inline"><Icon name="receipt" /><span>{hasFilters ? "No expenses match these filters" : "No receipts yet"}</span></div>}
        </div>
        {!hasFilters && entries.length > 5 && <p className="recent-hint">Showing 5 most recent · swipe them in the Receipts tab</p>}
      </section>
    </div>
  );
}

function SettleView({ cycle, summary, entries, onClose }: {
  cycle: Cycle;
  summary: ReturnType<typeof computeSettlements>;
  entries: LedgerEntry[];
  onClose: () => void;
}) {
  return (
    <div className="view settle-view">
      <section className="settle-hero">
        <span className="settle-icon"><Icon name="settle" size={25} /></span>
        <p>Group total</p>
        <h2>{money(summary.total)}</h2>
        <span>{cycle.name} · {entries.length} receipts</span>
      </section>
      <section className="section">
        <div className="section-title"><div><p className="kicker">Suggested payments</p><h2>Square everything up</h2></div></div>
        <div className="transfer-list">
          {summary.settlements.length ? summary.settlements.map((payment) => (
            <div className="transfer-card" key={`${payment.from}-${payment.to}`}>
              <div className="transfer-avatars"><Avatar name={payment.from} size="sm" /><span><Icon name="arrow" size={14} /></span><Avatar name={payment.to} size="sm" /></div>
              <div className="transfer-copy"><strong>{payment.from} pays {payment.to}</strong><span>Settles their balance</span></div>
              <strong>{money(payment.amount)}</strong>
            </div>
          )) : <div className="all-square"><Icon name="check" /><strong>Everyone is square</strong></div>}
        </div>
      </section>
      <section className="section">
        <div className="section-title"><div><p className="kicker">Breakdown</p><h2>Member balances</h2></div><span className="subtle">{money(summary.share)} share</span></div>
        <div className="list-card">
          {cycle.members.map((member, index) => (
            <div className="balance-row" key={member}>
              <Avatar name={member} size="sm" />
              <div><strong>{member}</strong><span>Paid {money(summary.paidBy[member])}</span></div>
              <strong className={summary.net[member] >= 0 ? "positive" : "negative"}>{summary.net[member] >= 0 ? "+" : "−"}{money(Math.abs(summary.net[member]))}</strong>
              {index < cycle.members.length - 1 && <span className="row-divider" />}
            </div>
          ))}
        </div>
      </section>
      {!cycle.endsOn && entries.length > 0 && <button className="close-cycle" onClick={onClose}><Icon name="lock" size={18} />Close cycle and lock it in</button>}
    </div>
  );
}

function ReceiptsView({ cycle, entries, summary, onEdit, onDelete, onConfirmRequest }: {
  cycle: Cycle;
  entries: LedgerEntry[];
  summary: ReturnType<typeof computeSettlements>;
  onEdit: (entry: LedgerEntry) => void;
  onDelete: (entry: LedgerEntry) => void | Promise<void>;
  onConfirmRequest: (request: ConfirmRequest) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const requestDelete = (entry: LedgerEntry) => {
    setOpenId(null);
    onConfirmRequest({
      title: "Delete receipt?",
      message: `The ${money(entry.amount)} receipt from ${entry.merchant || entry.payer} will be permanently removed.`,
      confirmLabel: "Delete",
      action: () => onDelete(entry),
    });
  };

  // Close an open card when the pointer goes down anywhere outside the cards.
  const onOutsidePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!openId) return;
    const card = (event.target as HTMLElement).closest?.(".swipe-card");
    if (!card) setOpenId(null);
  };

  return (
    <div className="view receipts-view" onPointerDown={onOutsidePointerDown}>
      <section className="people-summary">
        <div className="large-avatar-stack">{cycle.members.map((member) => <Avatar name={member} key={member} />)}</div>
        <h2>{entries.length} receipt{entries.length === 1 ? "" : "s"} this cycle</h2>
        <p>{cycle.name}</p>
      </section>
      <section className="section">
        <div className="section-title"><div><p className="kicker">{cycle.name}</p><h2>All receipts</h2></div></div>
        {entries.length ? (
          <div className="swipe-list" ref={listRef}>
            {entries.map((entry) => (
              <SwipeCard
                key={entry.id}
                entry={entry}
                open={openId === entry.id}
                onOpen={() => setOpenId(entry.id)}
                onClose={() => setOpenId(null)}
                onEdit={() => { setOpenId(null); onEdit(entry); }}
                onDelete={() => requestDelete(entry)}
                onExpandImage={(url) => setLightbox(url)}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No receipts yet" copy="Snap a receipt and it will show up here." />
        )}
        {lightbox && (
          <ReceiptLightbox url={lightbox} alt="Saved receipt" onClose={() => setLightbox(null)} />
        )}
      </section>
      {entries.length > 0 && (
        <section className="section">
          <div className="section-title"><div><p className="kicker">Household</p><h2>Balances</h2></div></div>
          <div className="people-list">
            {cycle.members.map((member) => (
              <div className="person-card" key={member}>
                <Avatar name={member} size="lg" />
                <div className="person-copy"><strong>{member}</strong><span>paid {money(summary.paidBy[member])}</span></div>
                <div className={`balance-chip ${summary.net[member] >= 0 ? "owed" : "owes"}`}>
                  <span>{summary.net[member] >= 0 ? "gets back" : "owes"}</span>
                  <strong>{money(Math.abs(summary.net[member]))}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const SWIPE_ACTIONS_WIDTH = 148;

/** Apple-notification-style swipe: the card slides, and glass action buttons
 *  fade/scale in proportionally underneath it. Stays open until the user
 *  taps elsewhere, taps the card, or swipes it shut. Tapping a closed card
 *  expands it to show the stored receipt image and details. */
function SwipeCard({ entry, open, onOpen, onClose, onEdit, onDelete, onExpandImage }: {
  entry: LedgerEntry;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onExpandImage: (url: string) => void;
}) {
  const width = SWIPE_ACTIONS_WIDTH;
  const [offset, setOffset] = useState(open ? -width : 0);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const gesture = useRef({ active: false, startX: 0, base: 0, moved: false });

  useEffect(() => { setOffset(open ? -width : 0); }, [open, width]);

  const position = dragging ? offset : open ? -width : offset;
  const progress = Math.min(1, Math.max(0, -position / width));

  const endDrag = () => {
    if (!gesture.current.active) return;
    gesture.current.active = false;
    setDragging(false);
    const moved = Math.abs(offset - gesture.current.base) > 6;
    if (moved && offset < -width / 2 - 12) {
      onOpen();
    } else if (!moved && open) {
      onClose(); // tap on an open card closes it
    } else if (!moved && !open) {
      setExpanded((value) => !value); // tap toggles the details
    } else if (moved) {
      onClose();
    }
    setOffset(moved && offset < -width / 2 - 12 ? -width : open && !moved ? -width : 0);
  };

  return (
    <div className={`swipe-card ${open ? "open" : ""} ${expanded ? "expanded" : ""}`}>
      <div className={`swipe-actions ${dragging ? "dragging" : ""}`} style={{ opacity: progress, transform: `translateX(${(1 - progress) * 26}px)` }}>
        <button
          className="swipe-action glass-edit"
          style={{ transform: `scale(${0.7 + progress * 0.3})` }}
          onClick={(event) => { event.stopPropagation(); onEdit(); }}
          aria-label={`Edit receipt from ${entry.merchant || entry.payer}`}
          tabIndex={open ? 0 : -1}
        >
          <Icon name="plus" size={17} /> Edit
        </button>
        <button
          className="swipe-action glass-delete"
          style={{ transform: `scale(${0.7 + progress * 0.3})` }}
          onClick={(event) => { event.stopPropagation(); onDelete(); }}
          aria-label={`Delete receipt from ${entry.merchant || entry.payer}`}
          tabIndex={open ? 0 : -1}
        >
          <Icon name="trash" size={17} /> Delete
        </button>
      </div>
      <div
        className={`swipe-content ${dragging ? "dragging" : ""}`}
        style={{ transform: `translate3d(${position}px, 0, 0)`, transition: dragging ? "none" : "transform .4s cubic-bezier(.32,.72,0,1)" }}
        onPointerDown={(event) => {
          gesture.current = { active: true, startX: event.clientX, base: open ? -width : offset, moved: false };
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!gesture.current.active) return;
          const raw = gesture.current.base + event.clientX - gesture.current.startX;
          if (Math.abs(raw - gesture.current.base) > 6) gesture.current.moved = true;
          setOffset(Math.max(-width - 40, Math.min(0, raw)));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => {
          // Suppress the click that follows a drag; taps on an open card
          // close it, taps on a closed card expand the details.
          if (gesture.current.moved) event.stopPropagation();
        }}
      >
        <div className="swipe-row">
          <Avatar name={entry.payer} size="sm" />
          <div className="expense-main">
            <strong>{entry.merchant || entry.note || "Grocery receipt"}</strong>
            <span>{entry.payer} · {new Date(`${entry.spentOn}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
          </div>
          <strong className="expense-amount">{money(entry.amount)}</strong>
        </div>
        {expanded && (
          <div className="swipe-expanded" onClick={(event) => event.stopPropagation()}>
            {entry.receiptUrl ? (
              <button
                className="receipt-thumb-button"
                onClick={(event) => { event.stopPropagation(); onExpandImage(entry.receiptUrl!); }}
                aria-label="View receipt full size"
              >
                <img src={entry.receiptUrl} alt={`Receipt from ${entry.merchant || entry.payer}`} />
                <span className="expand-hint">Tap to enlarge</span>
              </button>
            ) : (
              <div className="receipt-thumb-placeholder"><Icon name="receipt" size={20} /> No image stored for this receipt</div>
            )}
            <dl className="expanded-details">
              <div><dt>Merchant</dt><dd>{entry.merchant || "—"}</dd></div>
              <div><dt>Paid by</dt><dd>{entry.payer}</dd></div>
              <div><dt>Date</dt><dd>{new Date(`${entry.spentOn}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</dd></div>
              {entry.note && <div><dt>Note</dt><dd>{entry.note}</dd></div>}
              {entry.confidence > 0 && <div><dt>Read by</dt><dd>{entry.confidence >= 0.75 ? "AI" : "OCR"} · {Math.round(entry.confidence * 100)}%</dd></div>}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

/** In-app confirmation sheet — replaces native confirm() dialogs. */
function ConfirmSheet({ title, message, confirmLabel, tone = "danger", onClose, onConfirm }: {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "danger" | "neutral";
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const { sheetRef, dismiss, dragProps } = useSheetGesture(onClose);
  const cancel = () => { if (!busy) dismiss(); };
  return (
    <div className="sheet-backdrop confirm-backdrop" role="alertdialog" aria-modal="true" aria-label={title}
      onPointerDown={(event) => event.target === event.currentTarget && !busy && dismiss()}>
      <div className="bottom-sheet confirm-sheet" ref={sheetRef} role="document">
        <div className="sheet-drag-region" aria-hidden="true" {...dragProps}><div className="sheet-handle" /></div>
        <h2 className="confirm-title">{title}</h2>
        <p className="confirm-message">{message}</p>
        <button className={tone === "danger" ? "danger-button" : "tinted-button"} disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); }}>
          {busy ? "Working…" : confirmLabel}
        </button>
        <button className="cancel-button" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Edit sheet for a whole cycle: name, dates and members. */
function CycleEditSheet({ cycle, saving, onClose, onSave }: {
  cycle: Cycle;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: { name: string; members: string[]; startsOn: string; endsOn: string | null }) => void | Promise<void>;
}) {
  const [name, setName] = useState(cycle.name);
  const [startsOn, setStartsOn] = useState(cycle.startsOn);
  const [endsOn, setEndsOn] = useState(cycle.endsOn ?? "");
  const [members, setMembers] = useState<string[]>(cycle.members);
  const [newMember, setNewMember] = useState("");
  const { sheetRef, dismiss, dragProps } = useSheetGesture(onClose);

  const trimmedName = name.trim();
  const valid = Boolean(trimmedName) && Boolean(startsOn) && members.length > 0 && (!endsOn || endsOn >= startsOn);

  const addMember = () => {
    const member = newMember.trim();
    if (!member || members.includes(member)) { setNewMember(""); return; }
    setMembers((current) => [...current, member]);
    setNewMember("");
  };
  const removeMember = (member: string) => setMembers((current) => current.filter((item) => item !== member));

  return (
    <div className="sheet-backdrop receipt-sheet-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && !saving && dismiss()}>
      <div className="bottom-sheet compact-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="Edit cycle">
        <div className="sheet-drag-region" aria-hidden="true" {...dragProps}><div className="sheet-handle" /></div>
        <div className="sheet-header receipt-sheet-header">
          <div>
            <p className="receipt-sheet-context">Edit cycle</p>
            <h2>{cycle.name}</h2>
          </div>
          <button className="icon-button receipt-sheet-close" onClick={onClose} aria-label="Close editor" disabled={saving}><Icon name="close" size={18} /></button>
        </div>
        <div className="form-stack">
          <label><span>Name</span><input value={name} maxLength={40} disabled={saving} onChange={(event) => setName(event.target.value)} /></label>
          <div className="field-grid">
            <label><span>Starts</span><input type="date" value={startsOn} disabled={saving} onChange={(event) => setStartsOn(event.target.value)} /></label>
            <label><span>Ends <i>optional</i></span><input type="date" value={endsOn} min={startsOn} disabled={saving} onChange={(event) => setEndsOn(event.target.value)} /></label>
          </div>
          <div>
            <span className="member-editor-label">Members</span>
            <div className="member-chips">
              {members.map((member) => (
                <span className="member-chip" key={member}>
                  <Avatar name={member} size="sm" />
                  {member}
                  <button type="button" onClick={() => removeMember(member)} disabled={saving || members.length === 1} aria-label={`Remove ${member}`}>
                    <Icon name="close" size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="member-add">
              <input
                placeholder="Add a member"
                value={newMember}
                maxLength={20}
                disabled={saving}
                onChange={(event) => setNewMember(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addMember(); } }}
              />
              <button type="button" className="member-add-button" onClick={addMember} disabled={saving || !newMember.trim()}>
                <Icon name="plus" size={15} /> Add
              </button>
            </div>
          </div>
        </div>
        <button className="primary-button" disabled={!valid || saving} onClick={() => onSave({ name: trimmedName, members, startsOn, endsOn: endsOn || null })}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

/** Bottom sheet for editing a single text value (e.g. the household name). */
function TextEditSheet({ title, value, saving, onClose, onSave }: {
  title: string;
  value: string;
  saving: boolean;
  onClose: () => void;
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const { sheetRef, dismiss, dragProps } = useSheetGesture(onClose);
  const trimmed = draft.trim();
  const dirty = Boolean(trimmed) && trimmed !== value.trim();

  const commit = async () => {
    if (!dirty || saving) return;
    await onSave(trimmed);
  };

  return (
    <div className="sheet-backdrop confirm-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && !saving && dismiss()}>
      <div className="bottom-sheet confirm-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-drag-region" aria-hidden="true" {...dragProps}><div className="sheet-handle" /></div>
        <h2 className="confirm-title">{title}</h2>
        <input
          className="edit-field"
          autoFocus
          value={draft}
          maxLength={40}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void commit(); }}
        />
        <button className="tinted-button" disabled={!dirty || saving} onClick={() => void commit()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="cancel-button" disabled={saving} onClick={() => { if (!saving) dismiss(); }}>Cancel</button>
      </div>
    </div>
  );
}

/** Fullscreen receipt viewer. */
function ReceiptLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close viewer"><Icon name="close" size={20} /></button>
      <img src={url} alt={alt} onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

/** Edit sheet: the receipt's saved details, pre-filled and saveable. */
function EditSheet({ entry, members, saving, onClose, onSave }: {
  entry: LedgerEntry;
  members: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (patch: { payer: string; amount: number; merchant: string; note: string; spentOn: string }) => Promise<void>;
}) {
  const [payer, setPayer] = useState(entry.payer);
  const [amount, setAmount] = useState(String(entry.amount));
  const [merchant, setMerchant] = useState(entry.merchant ?? "");
  const [note, setNote] = useState(entry.note ?? "");
  const [spentOn, setSpentOn] = useState(entry.spentOn);
  const amountRef = useRef<HTMLInputElement>(null);
  const valid = Number(amount) > 0 && Boolean(payer);
  const { sheetRef, dismiss, dragProps } = useSheetGesture(onClose);

  return (
    <div className="sheet-backdrop receipt-sheet-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && dismiss()}>
      <div className="bottom-sheet receipt-sheet compact-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="Edit receipt">
        <div className="sheet-drag-region" aria-hidden="true" {...dragProps}><div className="sheet-handle" /></div>
        <div className="sheet-header receipt-sheet-header">
          <div>
            <p className="receipt-sheet-context">Edit receipt</p>
            <h2>{entry.merchant || "Grocery receipt"}</h2>
          </div>
          <button className="icon-button receipt-sheet-close" onClick={onClose} aria-label="Close editor"><Icon name="close" size={18} /></button>
        </div>
        <div className="receipt-fields">
          <label className="amount-field"><span>Total amount</span><div><b>$</b><input ref={amountRef} inputMode="decimal" type="number" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label>
          <label><span>Merchant</span><input placeholder="Store or merchant" value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label>
          <div className="field-grid">
            <label>
              <span>Who paid?</span>
              <select value={payer} onChange={(event) => setPayer(event.target.value)}>
                {members.map((member) => <option key={member} value={member}>{member}</option>)}
              </select>
            </label>
            <label><span>Date</span><input type="date" value={spentOn} onChange={(event) => setSpentOn(event.target.value)} /></label>
          </div>
          <label><span>Note <i>optional</i></span><input placeholder="e.g. Weekly shop" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <button
          className="primary-button"
          disabled={!valid || saving}
          onClick={async () => {
            if (!valid) { amountRef.current?.focus(); return; }
            await onSave({ payer, amount: Number(amount), merchant: merchant.trim(), note: note.trim(), spentOn });
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function SettingsView({ cycles, activeId, onNew, onRefresh, onExport, onInstall, onOpenCycle, onOpenCycles, onEditHousehold, household, syncStatus, themePref, onThemeChange, lastSyncedAt, isRefreshing }: {
  cycles: Cycle[];
  activeId: string | null;
  onNew: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onInstall: () => void;
  onOpenCycle: (id: string) => void;
  onOpenCycles: () => void;
  onEditHousehold: () => void;
  household: string;
  syncStatus: "loading" | "online" | "saving" | "error";
  themePref: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
  lastSyncedAt: number | null;
  isRefreshing: boolean;
}) {
  // Re-render every half minute so "Synced 2 mins ago" stays truthful.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeCycle = cycles.find((item) => item.id === activeId) ?? null;

  const busySync = syncStatus === "loading" || isRefreshing;
  const syncChip = busySync
    ? <><Spinner size={14} />{syncStatus === "saving" ? "Saving…" : "Syncing…"}</>
    : syncStatus === "saving"
      ? <><Spinner size={14} />Saving…</>
      : syncStatus === "error"
        ? <><i className="sync-dot warn" />Offline</>
        : <><i className="sync-dot" />Connected</>;

  return (
    <div className="view settings-view">
      <section className="settings-group">
        <p className="settings-group-label">Appearance</p>
        <div className="settings-list">
          <div className="settings-row">
            <span className="settings-icon settings-icon-indigo"><Icon name="settle" size={19} /></span>
            <span className="settings-row-copy"><strong>Theme</strong></span>
          </div>
          <div className="theme-segmented" role="radiogroup" aria-label="Theme">
            {([
              ["auto", "Automatic"],
              ["light", "Light"],
              ["dark", "Dark"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={themePref === value}
                className={`theme-segment ${themePref === value ? "active" : ""}`}
                onClick={() => onThemeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-group">
        <p className="settings-group-label">Cycles</p>
        <div className="settings-list">
          <button className="settings-row" onClick={onNew}>
            <span className="settings-icon settings-icon-green"><Icon name="plus" size={20} /></span>
            <span className="settings-row-copy"><strong>Start New Cycle</strong></span>
            <Icon name="chevron" size={17} />
          </button>
          {activeCycle && (
            <div className="settings-row settings-cycle-row" key={activeCycle.id}>
              <button className="settings-row-main" onClick={() => onOpenCycle(activeCycle.id)}>
                <span className="settings-icon settings-icon-blue"><Icon name="calendar" size={19} /></span>
                <span className="settings-row-copy"><strong>{activeCycle.name}</strong><small>{activeCycle.startsOn}{activeCycle.endsOn ? ` – ${activeCycle.endsOn}` : " · Live"}</small></span>
              </button>
              <span className="settings-row-value">Active</span>
              <Icon name="chevron" size={17} />
            </div>
          )}
          <button className="settings-row" onClick={onOpenCycles}>
            <span className="settings-icon settings-icon-indigo"><Icon name="settle" size={19} /></span>
            <span className="settings-row-copy"><strong>All Cycles</strong></span>
            <span className="settings-row-value">{cycles.length}</span>
            <Icon name="chevron" size={17} />
          </button>
        </div>
      </section>

      <section className="settings-group">
        <p className="settings-group-label">Household</p>
        <div className="settings-list">
          <button className="settings-row" onClick={onEditHousehold}>
            <span className="settings-icon settings-icon-orange"><Icon name="people" size={19} /></span>
            <span className="settings-row-copy"><strong>Household</strong></span>
            <span className="settings-row-value">{household}</span>
            <Icon name="chevron" size={17} />
          </button>
          <div className="settings-row">
            <span className="settings-icon settings-icon-green"><Icon name="settle" size={19} /></span>
            <span className="settings-row-copy"><strong>Currency</strong></span>
            <span className="settings-row-value">AUD</span>
          </div>
        </div>
      </section>

      <section className="settings-group">
        <p className="settings-group-label">Data &amp; App</p>
        <div className="settings-list">
          <button className="settings-row" onClick={onRefresh}>
            <span className="settings-icon settings-icon-green"><Icon name="refresh" size={19} /></span>
            <span className="settings-row-copy">
              <strong>Cloud Sync</strong>
              {lastSyncedAt !== null && <small>Synced {timeAgo(lastSyncedAt)}</small>}
            </span>
            <span className={`settings-row-value sync-value sync-${syncStatus}`}>{syncChip}</span>
            {!busySync && <Icon name="chevron" size={17} />}
          </button>
          <button className="settings-row" onClick={onExport}>
            <span className="settings-icon settings-icon-orange"><Icon name="receipt" size={19} /></span>
            <span className="settings-row-copy"><strong>Export Ledger</strong></span>
            <Icon name="chevron" size={17} />
          </button>
          <button className="settings-row" onClick={onInstall}>
            <span className="settings-icon settings-icon-blue"><Icon name="home" size={19} /></span>
            <span className="settings-row-copy"><strong>Add to Home Screen</strong></span>
            <Icon name="chevron" size={17} />
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * iOS edge-swipe back: a horizontal drag starting within ~36px of the left
 * edge pushes the page right with the finger; past a distance or velocity
 * threshold it slides out and pops, otherwise it springs back. Vertical
 * scrolling is preserved via an axis lock on the first movement.
 */
function useEdgeSwipeBack(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const gesture = useRef({ active: false, pointerId: -1, startX: 0, startY: 0, lastX: 0, lastT: 0, velocity: 0, dragging: false, axis: "" as "" | "x" | "y" });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.clientX > 36) return;
    gesture.current = {
      active: true, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      lastX: event.clientX, lastT: event.timeStamp, velocity: 0, dragging: false, axis: "",
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g.active || g.pointerId !== event.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (g.axis === "x") {
        const el = ref.current;
        if (!el) return;
        el.style.animation = "none"; // release the entrance animation's fill
        el.classList.add("edge-dragging");
        g.dragging = true;
      }
    }
    if (g.axis !== "x") return;
    const elapsed = Math.max(event.timeStamp - g.lastT, 1);
    g.velocity = g.velocity * 0.6 + ((event.clientX - g.lastX) / elapsed) * 1000 * 0.4;
    g.lastX = event.clientX;
    g.lastT = event.timeStamp;
    ref.current?.style.setProperty("transform", `translate3d(${Math.max(dx, 0)}px, 0, 0)`);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g.active || g.pointerId !== event.pointerId) return;
    g.active = false;
    const el = ref.current;
    if (!el || !g.dragging) return;
    g.dragging = false;
    const dx = g.lastX - g.startX;
    if (dx > 110 || (dx > 40 && g.velocity > 450)) {
      el.style.transition = "transform .26s cubic-bezier(.32, .72, 0, 1)";
      el.style.transform = "translate3d(103%, 0, 0)";
      window.setTimeout(() => closeRef.current(), 250);
    } else {
      el.style.transition = "transform .28s cubic-bezier(.32, .72, 0, 1)";
      el.style.transform = "translate3d(0, 0, 0)";
      window.setTimeout(() => {
        el.style.transition = "";
        el.classList.remove("edge-dragging");
      }, 300);
    }
  };

  // A drag that began on the back button must not also fire its click.
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (gesture.current.dragging) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return { ref, onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onClickCapture };
}

const SHARE_GLYPH = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 14.5V3.5" /><path d="M8.25 7.25 12 3.5l3.75 3.75" />
    <path d="M7.5 10.5H7a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4a3 3 0 0 0-3-3h-.5" />
  </svg>
);

const MENU_GLYPH = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
    <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
  </svg>
);

type GuidePlatform = {
  id: "ios" | "android";
  name: string;
  requires: string;
  glyph: ReactNode;
  steps: ReactNode[];
};

const INSTALL_GUIDE_SECTIONS: GuidePlatform[] = [
  {
    id: "ios",
    name: "iPhone & iPad",
    requires: "Uses the Safari app",
    glyph: SHARE_GLYPH,
    steps: [
      <><p>Open this site in <b>Safari</b>. Chrome on iPhone cannot install apps.</p></>,
      <><p>Tap the <b>Share</b> button <span className="guide-glyph">{SHARE_GLYPH}</span> in the toolbar.</p></>,
      <><p>Scroll down and tap <span className="guide-key">Add to Home Screen</span>.</p></>,
      <><p>Name it if you like, then tap <span className="guide-key">Add</span>. The icon lands on your Home Screen.</p></>,
    ],
  },
  {
    id: "android",
    name: "Android",
    requires: "Uses the Chrome app",
    glyph: MENU_GLYPH,
    steps: [
      <><p>Open this site in <b>Chrome</b>.</p></>,
      <><p>Tap the <b>menu</b> <span className="guide-glyph">{MENU_GLYPH}</span> at the top right.</p></>,
      <><p>Tap <span className="guide-key">Add to Home screen</span> — on newer phones it appears as <span className="guide-key">Install app</span>.</p></>,
      <><p>Confirm with <span className="guide-key">Add</span> or <span className="guide-key">Install</span>. The icon lands on your Home Screen.</p></>,
    ],
  },
];

/** Full-screen push page: how to install the app on iOS and Android. */
function InstallGuide({ onClose }: { onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const installed = useMemo(() => window.matchMedia("(display-mode: standalone)").matches, []);
  const detected = useMemo(() => (/android/i.test(navigator.userAgent) ? "android" : "ios"), []);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 250);
  }, [onClose]);

  const swipe = useEdgeSwipeBack(onClose);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const sections = [...INSTALL_GUIDE_SECTIONS].sort((a) => (a.id === detected ? -1 : 1));

  return (
    <div
      className={`install-guide ${closing ? "closing" : ""}`}
      ref={swipe.ref}
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClickCapture={swipe.onClickCapture}
      role="dialog" aria-modal="true" aria-label="Add to Home Screen guide"
    >
      <header className="guide-nav">
        <button className="guide-back" onClick={close}><Icon name="chevron" size={20} />Settings</button>
        <strong>Add to Home Screen</strong>
        <span className="guide-nav-spacer" aria-hidden="true" />
      </header>
      <div className="guide-body">
        {installed && (
          <div className="settings-list guide-installed-card">
            <div className="insight-row installed-row"><span><Icon name="check" size={15} />Grocery Ledger is already installed on this device</span></div>
          </div>
        )}
        {sections.map((section) => (
          <section className="push-group" key={section.id}>
            <div className="settings-list">
              <div className="insight-row guide-platform-row">
                <span className={`settings-icon ${section.id === "ios" ? "settings-icon-blue" : "settings-icon-green"}`}>{section.glyph}</span>
                <span>{section.name}{section.id === detected && <i className="guide-device-note">This device</i>}</span>
              </div>
              {section.steps.map((step, index) => (
                <div className="guide-step" key={index}>
                  <span className="guide-step-num">{index + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          </section>
        ))}
        <p className="guide-footnote">Receipts and settlement cycles stay in sync automatically, installed or not.</p>
      </div>
    </div>
  );
}

/** Pushed page: every cycle as an account-style switcher list. */
const CYCLE_ICON_CLASSES = [
  "settings-icon-blue",
  "settings-icon-indigo",
  "settings-icon-cyan",
  "settings-icon-orange",
  "settings-icon-green",
];

/** One cycle row with notification-style progressive swipe actions. */
function CycleSwipeCard({ cycle, tintClass, count, range, active, open, onOpen, onClose, onTap, onEdit, onDelete }: {
  cycle: Cycle;
  tintClass: string;
  count: number;
  range: string;
  active: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onTap: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const width = SWIPE_ACTIONS_WIDTH;
  const [offset, setOffset] = useState(open ? -width : 0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef({ active: false, startX: 0, base: 0, moved: false });

  useEffect(() => { setOffset(open ? -width : 0); }, [open, width]);

  const position = dragging ? offset : open ? -width : offset;
  const progress = Math.min(1, Math.max(0, -position / width));

  const endDrag = () => {
    if (!gesture.current.active) return;
    gesture.current.active = false;
    setDragging(false);
    const moved = Math.abs(offset - gesture.current.base) > 6;
    if (moved && offset < -width / 2 - 12) onOpen();
    else if (!moved && open) onClose();
    else if (!moved && !open) onTap();
    else onClose();
    setOffset(moved && offset < -width / 2 - 12 ? -width : open && !moved ? -width : 0);
  };

  return (
    <div className={`swipe-card ${open ? "open" : ""}`}>
      <div className={`swipe-actions ${dragging ? "dragging" : ""}`} style={{ opacity: progress, transform: `translateX(${(1 - progress) * 26}px)` }}>
        <button
          className="swipe-action glass-edit"
          style={{ transform: `scale(${0.7 + progress * 0.3})` }}
          onClick={(event) => { event.stopPropagation(); onEdit(); }}
          aria-label={`Edit ${cycle.name}`}
          tabIndex={open ? 0 : -1}
        >
          <Icon name="plus" size={17} /> Edit
        </button>
        <button
          className="swipe-action glass-delete"
          style={{ transform: `scale(${0.7 + progress * 0.3})` }}
          onClick={(event) => { event.stopPropagation(); onDelete(); }}
          aria-label={`Delete ${cycle.name}`}
          tabIndex={open ? 0 : -1}
        >
          <Icon name="trash" size={17} /> Delete
        </button>
      </div>
      <div
        className={`swipe-content ${dragging ? "dragging" : ""}`}
        style={{ transform: `translate3d(${position}px, 0, 0)`, transition: dragging ? "none" : "transform .4s cubic-bezier(.32,.72,0,1)", cursor: "pointer" }}
        onPointerDown={(event) => {
          gesture.current = { active: true, startX: event.clientX, base: open ? -width : offset, moved: false };
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!gesture.current.active) return;
          const raw = gesture.current.base + event.clientX - gesture.current.startX;
          if (Math.abs(raw - gesture.current.base) > 6) gesture.current.moved = true;
          setOffset(Math.max(-width - 40, Math.min(0, raw)));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => {
          if (gesture.current.moved) event.stopPropagation();
        }}
      >
        <div className="settings-row">
          <span className={`settings-icon ${tintClass}`}><Icon name="calendar" size={19} /></span>
          <span className="settings-row-copy">
            <strong>{cycle.name}</strong>
            <small>{range} · {count} receipt{count === 1 ? "" : "s"}</small>
          </span>
          {active
            ? <span className="settings-row-value active-value"><i className="sync-dot" />Active</span>
            : (
              <span className="settings-row-value sync-value">
                <i className={`sync-dot ${cycle.endsOn ? "off" : "static"}`} />{cycle.endsOn ? "Closed" : "Live"}
              </span>
            )}
        </div>
      </div>
    </div>
  );
}

/** Pushed page: every cycle as an account-style switcher list. */
function CyclesPage({ cycles, activeId, entries, onOpenCycle, onEditCycle, onDeleteCycle, onClose }: {
  cycles: Cycle[];
  activeId: string | null;
  entries: LedgerEntry[];
  onOpenCycle: (id: string) => void;
  onEditCycle: (id: string) => void;
  onDeleteCycle: (id: string, receiptCount: number, isActive: boolean) => void;
  onClose: () => void;
}) {
  const swipe = useEdgeSwipeBack(onClose);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const countFor = (id: string) => entries.filter((entry) => entry.cycleId === id).length;

  // Close an open swipe row when the pointer goes down outside the cards.
  const onOutsidePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!openId) return;
    const card = (event.target as HTMLElement).closest?.(".swipe-card");
    if (!card) setOpenId(null);
  };

  return (
    <div
      className="install-guide cycles-page"
      ref={swipe.ref}
      onPointerDown={(event) => {
        // Row swipes own their pointers; the page-level edge swipe must not
        // fight them inside a card.
        if (!(event.target as HTMLElement).closest?.(".swipe-card")) swipe.onPointerDown(event);
        onOutsidePointerDown(event);
      }}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClickCapture={swipe.onClickCapture}
      role="dialog" aria-modal="true" aria-label="All cycles"
    >
      <header className="guide-nav">
        <button className="guide-back" onClick={onClose}><Icon name="chevron" size={20} />Settings</button>
        <strong>Cycles</strong>
        <span className="guide-nav-spacer" aria-hidden="true" />
      </header>
      <div className="guide-body">
        <section className="push-group">
          <div className="swipe-list">
            {cycles.map((cycle, index) => (
              <CycleSwipeCard
                key={cycle.id}
                cycle={cycle}
                tintClass={CYCLE_ICON_CLASSES[index % CYCLE_ICON_CLASSES.length]}
                count={countFor(cycle.id)}
                range={cycle.endsOn ? `${formatDay(cycle.startsOn)} – ${formatDay(cycle.endsOn)}` : `${formatDay(cycle.startsOn)} – today`}
                active={cycle.id === activeId}
                open={openId === cycle.id}
                onOpen={() => setOpenId(cycle.id)}
                onClose={() => setOpenId(null)}
                onTap={() => onOpenCycle(cycle.id)}
                onEdit={() => { setOpenId(null); onEditCycle(cycle.id); }}
                onDelete={() => { setOpenId(null); onDeleteCycle(cycle.id, countFor(cycle.id), cycle.id === activeId); }}
              />
            ))}
          </div>
        </section>
        <p className="guide-footnote with-icon"><Icon name="refresh" size={15} />Tap a cycle for details — swipe for edit and delete.</p>
      </div>
    </div>
  );
}

/** Pushed page: every detail and insight for one cycle, on a single scroll. */
function CycleDetailPage({ cycle, entries, summary, isActive, saving, backLabel = "Settings", onClose, onSetActive, onReopen, onCloseCycle }: {
  cycle: Cycle;
  entries: LedgerEntry[];
  summary: ReturnType<typeof computeSettlements>;
  isActive: boolean;
  saving: boolean;
  backLabel?: string;
  onClose: () => void;
  onSetActive: () => Promise<void>;
  onReopen: (id: string) => Promise<void>;
  onCloseCycle: (id: string) => void;
}) {
  const swipe = useEdgeSwipeBack(onClose);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const average = entries.length ? summary.total / entries.length : 0;
  const largest = entries.reduce<LedgerEntry | null>((max, entry) => (!max || entry.amount > max.amount ? entry : max), null);
  const topPayer = Object.entries(summary.paidBy).sort(([, a], [, b]) => b - a)[0];
  const dateRange = cycle.endsOn ? `${cycle.startsOn} – ${cycle.endsOn}` : `${cycle.startsOn} – today`;
  const formatDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div
      className="install-guide cycle-page"
      ref={swipe.ref}
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClickCapture={swipe.onClickCapture}
      role="dialog" aria-modal="true" aria-label={`${cycle.name} details`}
    >
      <header className="guide-nav">
        <button className="guide-back" onClick={onClose}><Icon name="chevron" size={20} />{backLabel}</button>
        <strong>Cycle details</strong>
        <span className="guide-nav-spacer" aria-hidden="true" />
      </header>
      <div className="guide-body">
        <header className="push-title">
          <h1>{cycle.name}</h1>
          <p>{dateRange} · {entries.length} receipt{entries.length === 1 ? "" : "s"}</p>
        </header>

        <section className="push-group">
          <div className="settings-list push-summary">
            <div className="push-summary-main">
              <span className="settings-icon settings-icon-blue"><Icon name="settle" size={19} /></span>
              <div className="push-summary-copy">
                <small>Total spent</small>
                <strong>{money(summary.total, 2)}</strong>
              </div>
              <div className="push-summary-side">
                <small>Each</small>
                <strong>{money(summary.share, 2)}</strong>
              </div>
            </div>
            <div className="push-summary-foot">
              <div className="avatar-stack">
                {cycle.members.map((member) => <Avatar name={member} size="sm" key={member} />)}
              </div>
              <span className={`cycle-status-chip ${cycle.endsOn ? "closed" : "live"}`}>
                {cycle.endsOn ? "Closed" : "Live"}
              </span>
            </div>
          </div>
        </section>

        <section className="push-group">
          <p className="settings-group-label">Insights</p>
          <div className="settings-list">
            {entries.length ? (
              <>
                <div className="insight-row">
                  <span className="row-icon row-icon-blue"><Icon name="settle" size={15} /></span>
                  <div className="insight-copy">
                    <strong>Average receipt</strong>
                    <i>across {entries.length} receipt{entries.length === 1 ? "" : "s"}</i>
                  </div>
                  <span className="insight-value">{money(average, 2)}</span>
                </div>
                {largest && (
                  <div className="insight-row">
                    <span className="row-icon row-icon-orange"><Icon name="receipt" size={15} /></span>
                    <div className="insight-copy">
                      <strong>Largest receipt</strong>
                      <i>{largest.merchant || "Receipt"} · {formatDate(largest.spentOn)}</i>
                    </div>
                    <span className="insight-value">{money(largest.amount, 2)}</span>
                  </div>
                )}
                {topPayer && topPayer[1] > 0 && (
                  <div className="insight-row">
                    <span className="row-icon row-icon-green"><Icon name="people" size={15} /></span>
                    <div className="insight-copy">
                      <strong>Top payer</strong>
                      <i>paid {money(topPayer[1], 2)}</i>
                    </div>
                    <span className="insight-value">{topPayer[0]}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="insight-row">
                <span className="row-icon row-icon-gray"><Icon name="receipt" size={15} /></span>
                <div className="insight-copy"><strong>No receipts yet</strong></div>
              </div>
            )}
          </div>
        </section>

        <section className="push-group">
          <p className="settings-group-label">Settlement</p>
          <div className="settings-list">
            {summary.settlements.length ? summary.settlements.map((payment) => (
              <div className="insight-row" key={`${payment.from}-${payment.to}`}>
                <span className="pay-flow">
                  <Avatar name={payment.from} size="sm" />
                  <Icon name="arrow" size={14} />
                  <Avatar name={payment.to} size="sm" />
                </span>
                <div className="insight-copy">
                  <strong>{payment.from} pays {payment.to}</strong>
                  <i>suggested payment</i>
                </div>
                <span className="insight-value">{money(payment.amount, 2)}</span>
              </div>
            )) : (
              <div className="insight-row">
                <span className="row-icon row-icon-green"><Icon name="check" size={15} /></span>
                <div className="insight-copy"><strong>Everyone is square</strong></div>
              </div>
            )}
          </div>
        </section>

        <section className="push-group">
          <p className="settings-group-label">Member balances</p>
          <div className="settings-list">
            {cycle.members.map((member, index) => (
              <div className="balance-row" key={member}>
                <Avatar name={member} size="sm" />
                <div><strong>{member}</strong><span>Paid {money(summary.paidBy[member] ?? 0)}</span></div>
                <strong className={(summary.net[member] ?? 0) >= 0 ? "positive" : "negative"}>{(summary.net[member] ?? 0) >= 0 ? "+" : "−"}{money(Math.abs(summary.net[member] ?? 0))}</strong>
                {index < cycle.members.length - 1 && <span className="row-divider" />}
              </div>
            ))}
          </div>
        </section>

        <section className="push-group">
          <p className="settings-group-label">Receipts</p>
          <div className="settings-list">
            {entries.length ? entries.map((entry) => (
              <div className="expense-row" key={entry.id}>
                <Avatar name={entry.payer} size="sm" />
                <div className="expense-main">
                  <strong>{entry.merchant || entry.note || "Grocery receipt"}</strong>
                  <span>{entry.payer} · {new Date(`${entry.spentOn}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
                </div>
                <strong className="expense-amount">{money(entry.amount, 2)}</strong>
              </div>
            )) : <div className="insight-row"><span>Nothing recorded in this cycle yet</span></div>}
          </div>
        </section>

        <section className="push-group">
          <div className="settings-list">
            {!isActive && (
              <button className="insight-row action-row" disabled={saving} onClick={onSetActive}>
                {saving ? "Switching…" : "Set as Active Cycle"}
              </button>
            )}
            {!cycle.endsOn && (
              <button className="insight-row action-row action-row-danger" disabled={saving} onClick={() => onCloseCycle(cycle.id)}>
                Close Cycle
              </button>
            )}
            {cycle.endsOn && (
              <button className="insight-row action-row" disabled={saving} onClick={() => onReopen(cycle.id)}>
                {saving ? "Working…" : "Reopen Cycle"}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ReceiptSheet({ receipts, members, defaultPayer, onPayerChange, onUpdate, onRemove, onClose, onSave, onScan, saving, exiting }: {
  receipts: PendingReceipt[];
  members: string[];
  defaultPayer: string;
  onPayerChange: (payer: string) => void;
  onUpdate: (id: string, update: Partial<PendingReceipt>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  onScan: (id: string) => Promise<void>;
  saving: boolean;
  exiting: boolean;
}) {
  // Scanned receipts save themselves; the sheet only holds items that need
  // manual attention after both engines came up empty.
  const needsReview = receipts.filter((receipt) => receipt.status === "ready");
  const canSave = needsReview.length > 0 && needsReview.every(
    (receipt) => Number(receipt.amount) > 0 && receipt.payer,
  );
  const scanning = receipts.filter((receipt) => receipt.status === "scanning").length;
  const phaseTitle = scanning > 0 ? "Scanning receipts" : "Complete the details";
  const completionHint = scanning > 0
    ? "Receipts save automatically as they're read"
    : canSave
      ? "Everything is ready to save"
      : "Add an amount and payer for each receipt";
  const { sheetRef, dismiss, dragProps } = useSheetGesture(onClose);

  // Auto-focus the amount field of the first receipt that needs a manual
  // total, so the fix is one keystroke away.
  const manualReceipt = receipts.find((receipt) => receipt.status === "ready" && receipt.engine === "manual");
  useEffect(() => {
    if (manualReceipt && !exiting) {
      document.getElementById(`receipt-amount-${manualReceipt.id}`)?.focus();
    }
  }, [manualReceipt?.id, exiting]);
  return (
    <div className={`sheet-backdrop receipt-sheet-backdrop${exiting ? " closing" : ""}`} role="presentation" onPointerDown={(event) => event.target === event.currentTarget && dismiss()}>
      <div className="bottom-sheet receipt-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="receipt-sheet-title">
        <div className="sheet-drag-region" aria-hidden="true" {...dragProps}><div className="sheet-handle" /></div>
        <div className="sheet-header receipt-sheet-header">
          <div>
            <p className="receipt-sheet-context">Receipt review · {receipts.length} item{receipts.length === 1 ? "" : "s"}</p>
            <h2 id="receipt-sheet-title">{phaseTitle}</h2>
          </div>
          <button className="icon-button receipt-sheet-close" onClick={dismiss} aria-label="Cancel receipt review"><Icon name="close" size={18} /></button>
        </div>
        <div className="payer-chip-row" role="radiogroup" aria-label="Who paid">
          <span className="payer-chip-label">Saving as</span>
          {members.map((member) => (
            <button
              key={member}
              className={`payer-chip ${defaultPayer === member ? "selected" : ""}`}
              onClick={() => onPayerChange(member)}
              role="radio"
              aria-checked={defaultPayer === member}
            >
              <Avatar name={member} size="sm" /> {member}
            </button>
          ))}
        </div>
        <div className="receipt-progress" aria-label={`${needsReview.length} of ${receipts.length} receipts need review`}>
          {receipts.map((receipt) => (
            <span className={receipt.status === "ready" ? receipt.engine : receipt.status} key={`progress-${receipt.id}`} />
          ))}
        </div>
        <div className="receipt-editor-list" aria-live="polite">
          {receipts.map((receipt, index) => (
            <div className="receipt-editor" key={receipt.id}>
              <div className="receipt-item-heading">
                <span>Receipt {index + 1}</span>
                <span>{receipt.status === "scanning" ? "Reading…" : "Needs your input"}</span>
              </div>
              <div className="receipt-preview">
                <img src={receipt.preview} alt="Uploaded receipt" />
                {receipt.status === "scanning" && <span className="scanning"><Icon name="receipt" />Reading receipt…</span>}
              </div>
              <button className="remove-receipt" onClick={() => onRemove(receipt.id)} aria-label={`Remove receipt ${index + 1}`}><Icon name="trash" size={16} /></button>
              {receipt.status === "ready" && (
                <div className="receipt-fields">
                  <label className="amount-field"><span>Total amount</span><div><b>$</b><input id={`receipt-amount-${receipt.id}`} inputMode="decimal" type="number" placeholder="0.00" value={receipt.amount} onChange={(event) => onUpdate(receipt.id, { amount: event.target.value })} /></div></label>
                  <label><span>Merchant</span><input placeholder="Store or merchant" value={receipt.merchant} onChange={(event) => onUpdate(receipt.id, { merchant: event.target.value })} /></label>
                  <div className="field-grid">
                    <label>
                      <span>Who paid?</span>
                      <select value={receipt.payer} onChange={(event) => onUpdate(receipt.id, { payer: event.target.value })}>
                        <option value="" disabled>Choose a person</option>
                        {members.map((member) => <option key={member} value={member}>{member}</option>)}
                      </select>
                    </label>
                    <label><span>Date</span><input type="date" value={receipt.spentOn} onChange={(event) => onUpdate(receipt.id, { spentOn: event.target.value })} /></label>
                  </div>
                  <label><span>Note <i>optional</i></span><input placeholder="e.g. Weekly shop" value={receipt.note} onChange={(event) => onUpdate(receipt.id, { note: event.target.value })} /></label>
                  <div className="manual-actions">
                    <p className="ai-note">
                      <Icon name="receipt" size={14} />
                      {receipt.confidence > 0
                        ? `Read via AI · ${Math.round(receipt.confidence * 100)}% confidence, please confirm`
                        : "Auto-read failed. Type the total, or scan again."}
                    </p>
                    <button className="retry-scan" onClick={() => onScan(receipt.id)} disabled={saving}>
                      <Icon name="refresh" size={13} /> Scan again
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {needsReview.length > 0 && (
          <div className="receipt-sheet-actions">
            <p className={canSave ? "ready" : ""}><Icon name={canSave ? "check" : "receipt"} size={15} />{completionHint}</p>
            <button className="primary-button" disabled={!canSave || saving} onClick={onSave}>
              {saving ? "Saving…" : `Save ${needsReview.length} receipt${needsReview.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


function NewCycleSheet({ onClose, onCreate, saving }: {
  onClose: () => void;
  onCreate: (name: string, members: string[], startsOn: string) => Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState(DEFAULT_MEMBERS.join(", "));
  const [startsOn, setStartsOn] = useState(today());
  const parsedMembers = members.split(",").map((member) => member.trim()).filter(Boolean);
  const { sheetRef, dismiss, dragProps } = useSheetGesture(onClose);
  return (
    <div className="sheet-backdrop" onPointerDown={(event) => event.target === event.currentTarget && dismiss()}>
      <div className="bottom-sheet compact-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="Create cycle">
        <div className="sheet-drag-region" aria-hidden="true" {...dragProps}><div className="sheet-handle" /></div>
        <div className="sheet-header"><div><p className="kicker">New shared ledger</p><h2>Start a cycle</h2></div><button className="icon-button" onClick={dismiss} aria-label="Close new cycle form"><Icon name="close" size={20} /></button></div>
        <div className="form-stack">
          <label><span>Cycle name</span><input autoFocus placeholder="April groceries" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>Members <i>comma-separated</i></span><input value={members} onChange={(event) => setMembers(event.target.value)} /></label>
          <label><span>Start date</span><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
        </div>
        <button className="primary-button" disabled={!name.trim() || !parsedMembers.length || saving} onClick={() => onCreate(name.trim(), parsedMembers, startsOn)}>{saving ? "Creating…" : "Create cycle"}</button>
      </div>
    </div>
  );
}

function EmptyState({ title, copy, action, actionLabel }: { title: string; copy: string; action?: () => void; actionLabel?: string }) {
  return <div className="empty-state"><span><Icon name="receipt" size={28} /></span><h2>{title}</h2><p>{copy}</p>{action && <button className="primary-button" onClick={action}>{actionLabel ?? "Create a cycle"}</button>}</div>;
}

function DataState({ title, copy, action, actionLabel }: {
  title: string;
  copy: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="empty-state data-state" role={action ? "alert" : "status"} tabIndex={-1} autoFocus={Boolean(action)}>
      <span><Icon name={action ? "refresh" : "receipt"} size={28} /></span>
      <h2>{title}</h2>
      <p>{copy}</p>
      {action && <button className="primary-button" onClick={action}>{actionLabel}</button>}
    </div>
  );
}
