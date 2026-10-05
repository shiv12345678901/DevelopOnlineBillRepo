import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ledgerRepository, scanReceipt } from "./api";

type Tab = "home" | "settle" | "camera" | "people" | "settings";

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
  status: "cropping" | "scanning" | "ready";
  confidence: number;
  crop: { x: number; y: number; width: number; height: number };
  processedImageBase64: string;
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
  value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

async function resizeReceipt(file: File, crop: PendingReceipt["crop"], maxSide = 1600) {
  const bitmap = await createImageBitmap(file);
  const sourceX = Math.round(bitmap.width * crop.x);
  const sourceY = Math.round(bitmap.height * crop.y);
  const sourceWidth = Math.round(bitmap.width * crop.width);
  const sourceHeight = Math.round(bitmap.height * crop.height);
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  canvas.getContext("2d")?.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.84);
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
  const [toast, setToast] = useState("");
  const [showNewCycle, setShowNewCycle] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"loading" | "online" | "saving" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const overlayOpen = pending.length > 0 || showNewCycle;

  const cycle = cycles.find((item) => item.id === activeId) ?? cycles[0];
  const cycleEntries = useMemo(
    () => entries.filter((entry) => entry.cycleId === cycle?.id).sort((a, b) =>
      b.spentOn.localeCompare(a.spentOn) || b.id.localeCompare(a.id)
    ),
    [entries, cycle?.id],
  );
  const summary = useMemo(() => computeSettlements(cycleEntries, cycle?.members ?? []), [cycleEntries, cycle?.members]);

  const fetchLedger = useCallback(async () => {
    setSyncStatus("loading");
    setLoadError("");
    try {
      const snapshot = await ledgerRepository.fetch<Cycle, LedgerEntry>();
      setCycles(snapshot.cycles);
      setEntries(snapshot.entries);
      setActiveId(snapshot.activeId);
      setSyncStatus("online");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the ledger.");
      setSyncStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

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
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    const next = images.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
      payer: "",
      amount: "",
      merchant: "",
      note: "",
      spentOn: today(),
      status: "cropping" as const,
      confidence: 0,
      crop: { x: 0.03, y: 0.03, width: 0.94, height: 0.94 },
      processedImageBase64: "",
    }));
    setPending(next);
  };

  const readReceipt = async (id: string) => {
    const item = pending.find((receipt) => receipt.id === id);
    if (!item) return;
    setPending((current) => current.map((receipt) =>
      receipt.id === id ? { ...receipt, status: "scanning" } : receipt
    ));
    try {
      const image = await resizeReceipt(item.file, item.crop);
      const result = await scanReceipt(image.imageBase64, image.mimeType);
      setPending((current) => current.map((receipt) => receipt.id === id ? {
        ...receipt,
        amount: result.amount === null ? "" : String(result.amount),
        merchant: result.merchant || "",
        confidence: result.confidence,
        processedImageBase64: image.imageBase64,
        status: "ready",
      } : receipt));
    } catch (error) {
      setPending((current) => current.map((receipt) => receipt.id === id ? {
        ...receipt,
        confidence: 0,
        status: "ready",
      } : receipt));
      setToast(error instanceof Error ? `${error.message} Enter the details manually.` : "Couldn’t read the receipt — enter the details manually");
      window.setTimeout(() => setToast(""), 3200);
    }
  };

  const saveReceipts = async () => {
    if (!cycle) return;
    const valid = pending.filter((item) => Number(item.amount) > 0 && item.payer);
    if (!valid.length) return;
    setSyncStatus("saving");
    const input = valid.map((item) => ({
      cycleId: cycle.id,
      payer: item.payer,
      amount: Number(item.amount),
      merchant: item.merchant.trim(),
      note: item.note.trim(),
      spentOn: item.spentOn,
      confidence: item.confidence,
      receiptImageBase64: item.processedImageBase64,
      receiptMimeType: "image/jpeg",
    }));
    try {
      const created = await ledgerRepository.createEntries<LedgerEntry>(input);
      setEntries((current) => [...created, ...current]);
      pending.forEach((item) => URL.revokeObjectURL(item.preview));
      setPending([]);
      setSyncStatus("online");
      flash(`${created.length} receipt${created.length === 1 ? "" : "s"} added`);
      setTab("home");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not save the receipts.");
    }
  };

  const closePending = () => {
    pending.forEach((item) => URL.revokeObjectURL(item.preview));
    setPending([]);
  };

  const closeCycle = async () => {
    if (!cycle) return;
    if (summary.settlements.length > 0) {
      const outstanding = summary.settlements.reduce((sum, payment) => sum + payment.amount, 0);
      const confirmed = window.confirm(
        `${summary.settlements.length} unresolved payment${summary.settlements.length === 1 ? "" : "s"} ` +
        `totalling ${money(outstanding)} remain. Closing prevents new receipts, but balances stay visible. Close anyway?`,
      );
      if (!confirmed) return;
    }
    setSyncStatus("saving");
    try {
      const updated = await ledgerRepository.updateCycle<Cycle>(cycle.id, { endsOn: today() });
      setCycles((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSyncStatus("online");
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
      flash("Cycle reopened");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not reopen the cycle.");
    }
  };

  const selectCycle = async (id: string) => {
    if (id === activeId) {
      setTab("home");
      return;
    }
    setSyncStatus("saving");
    try {
      await ledgerRepository.setActiveCycle(id);
      setActiveId(id);
      setSyncStatus("online");
      setTab("home");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not switch cycles.");
    }
  };

  const createCycle = async (name: string, members: string[], startsOn: string) => {
    setSyncStatus("saving");
    try {
      const created = await ledgerRepository.createCycle<Cycle>({ name, members, startsOn, endsOn: null });
      setCycles((current) => [created, ...current]);
      setActiveId(created.id);
      setShowNewCycle(false);
      setSyncStatus("online");
      setTab("home");
      flash("New cycle created");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not create the cycle.");
    }
  };

  const deleteEntry = async (entry: LedgerEntry) => {
    if (!window.confirm(`Delete ${money(entry.amount)} paid by ${entry.payer}? This cannot be undone.`)) return;
    setSyncStatus("saving");
    try {
      await ledgerRepository.deleteEntry(entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setSyncStatus("online");
      flash("Entry deleted");
    } catch (error) {
      setSyncStatus("error");
      flash(error instanceof Error ? error.message : "Could not delete the entry.");
    }
  };

  const exportLedger = () => {
    const cycleNames = Object.fromEntries(cycles.map((item) => [item.id, item.name]));
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Cycle", "Merchant", "Date", "Paid by", "Amount INR", "Note"],
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

  const installApp = () => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    flash(standalone ? "Grocery Ledger is already installed" : "On iPhone: tap Share, then Add to Home Screen");
  };

  const title = tab === "home" ? greeting() : tab === "settle" ? "Settle up" : tab === "people" ? "People" : "Settings";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{tab === "home" ? "Home household" : GROUP_NAME}</p>
          <h1>{title}</h1>
        </div>
        {tab !== "settings" && (
          <button className="profile-button more-button" onClick={() => setTab("settings")} aria-label="Open settings">
            <span>•••</span>
          </button>
        )}
      </header>

      <main className="content">
        <div className="screen-transition" key={`${tab}-${activeId}`}>
        {syncStatus === "loading" ? (
          <DataState title="Loading your ledger" copy="Fetching the latest cycles and receipts from Supabase." />
        ) : loadError ? (
          <DataState title="Couldn’t load your ledger" copy={loadError} action={fetchLedger} actionLabel="Try again" />
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
            onDelete={deleteEntry}
          />
        ) : tab === "settle" ? (
          <SettleView cycle={cycle} summary={summary} entries={cycleEntries} onClose={closeCycle} />
        ) : tab === "people" ? (
          <PeopleView cycle={cycle} entries={cycleEntries} summary={summary} />
        ) : (
          <SettingsView
            cycles={cycles}
            activeId={activeId}
            onSelect={selectCycle}
            onReopen={reopenCycle}
            onNew={() => setShowNewCycle(true)}
            onRefresh={fetchLedger}
            onExport={exportLedger}
            onInstall={installApp}
            syncStatus={syncStatus}
          />
        )}
        </div>
      </main>

      <nav className="tabbar" aria-label="Primary navigation">
        {(["home", "settle", "camera", "people", "settings"] as Tab[]).map((item) => (
          <button
            key={item}
            className={`tab-button ${tab === item ? "active" : ""} ${item === "camera" ? "camera-button" : ""}`}
            onClick={() => selectTab(item)}
            aria-label={item === "camera" ? "Add receipt" : undefined}
          >
            <span className="tab-icon"><Icon name={item} size={item === "camera" ? 25 : 21} /></span>
            <span className={item === "camera" ? "camera-label" : ""}>{item === "settle" ? "Settle" : item[0].toUpperCase() + item.slice(1)}</span>
          </button>
        ))}
      </nav>

      <input ref={fileInput} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => {
        queueFiles(event.target.files);
        event.target.value = "";
      }} />

      {pending.length > 0 && (
        <ReceiptSheet
          receipts={pending}
          members={cycle?.members ?? []}
          onUpdate={(id, update) => setPending((items) => items.map((item) => item.id === id ? { ...item, ...update } : item))}
          onRemove={(id) => setPending((items) => {
            const removed = items.find((item) => item.id === id);
            if (removed) URL.revokeObjectURL(removed.preview);
            return items.filter((item) => item.id !== id);
          })}
          onClose={closePending}
          onSave={saveReceipts}
          saving={syncStatus === "saving"}
          onScan={readReceipt}
        />
      )}

      {showNewCycle && (
        <NewCycleSheet
          onClose={() => setShowNewCycle(false)}
          onCreate={createCycle}
          saving={syncStatus === "saving"}
        />
      )}

      {toast && <div className="toast"><Icon name="check" size={17} />{toast}</div>}
    </div>
  );
}

function HomeView({ cycle, entries, total, share, onCamera, onSettle, onDelete }: {
  cycle: Cycle;
  entries: LedgerEntry[];
  total: number;
  share: number;
  onCamera: () => void;
  onSettle: () => void;
  onDelete: (entry: LedgerEntry) => void;
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
          {filteredEntries.length ? filteredEntries.slice(0, hasFilters ? 50 : 4).map((entry, index, visible) => (
            <div className="expense-row" key={entry.id}>
              <Avatar name={entry.payer} size="sm" />
              <div className="expense-main">
                <strong>{entry.merchant || entry.note || "Grocery receipt"}</strong>
                <span>{entry.payer} · {new Date(`${entry.spentOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
              </div>
              <strong className="expense-amount">{money(entry.amount)}</strong>
              <button className="entry-delete" onClick={() => onDelete(entry)} aria-label={`Delete ${entry.merchant || entry.note || "receipt"} entry`}>
                <Icon name="trash" size={16} />
              </button>
              {index < visible.length - 1 && <span className="row-divider" />}
            </div>
          )) : <div className="empty-inline"><Icon name="receipt" /><span>{hasFilters ? "No expenses match these filters" : "No receipts yet"}</span></div>}
        </div>
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

function PeopleView({ cycle, entries, summary }: {
  cycle: Cycle;
  entries: LedgerEntry[];
  summary: ReturnType<typeof computeSettlements>;
}) {
  return (
    <div className="view people-view">
      <section className="people-summary">
        <div className="large-avatar-stack">{cycle.members.map((member) => <Avatar name={member} key={member} />)}</div>
        <h2>{cycle.members.length} people sharing</h2>
        <p>{cycle.name}</p>
      </section>
      <section className="section">
        <div className="section-title"><div><p className="kicker">Household</p><h2>Group members</h2></div></div>
        <div className="people-list">
          {cycle.members.map((member) => {
            const count = entries.filter((entry) => entry.payer === member).length;
            return (
              <div className="person-card" key={member}>
                <Avatar name={member} size="lg" />
                <div className="person-copy"><strong>{member}{member === "Shiva" && <span className="you-pill">You</span>}</strong><span>{count} receipt{count === 1 ? "" : "s"} · paid {money(summary.paidBy[member])}</span></div>
                <div className={`balance-chip ${summary.net[member] >= 0 ? "owed" : "owes"}`}>
                  <span>{summary.net[member] >= 0 ? "gets back" : "owes"}</span>
                  <strong>{money(Math.abs(summary.net[member]))}</strong>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SettingsView({ cycles, activeId, onSelect, onReopen, onNew, onRefresh, onExport, onInstall, syncStatus }: {
  cycles: Cycle[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onReopen: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onInstall: () => void;
  syncStatus: "loading" | "online" | "saving" | "error";
}) {
  return (
    <div className="view settings-view">
      <section className="settings-group">
        <p className="settings-group-label">Cycles</p>
        <div className="settings-list">
          <button className="settings-row" onClick={onNew}>
            <span className="settings-icon settings-icon-green"><Icon name="plus" size={20} /></span>
            <span className="settings-row-copy"><strong>Start New Cycle</strong><small>Create a fresh shared ledger</small></span>
            <Icon name="chevron" size={17} />
          </button>
          {cycles.map((cycle) => (
            <div className={`settings-row settings-cycle-row ${cycle.id === activeId ? "active" : ""}`} key={cycle.id}>
              <button className="settings-row-main" onClick={() => onSelect(cycle.id)}>
                <span className="settings-icon settings-icon-blue"><Icon name="calendar" size={19} /></span>
                <span className="settings-row-copy"><strong>{cycle.name}</strong><small>{cycle.startsOn}{cycle.endsOn ? ` – ${cycle.endsOn}` : " · Live"}</small></span>
              </button>
              {cycle.endsOn
                ? <button className="settings-row-value settings-action-value" onClick={() => onReopen(cycle.id)}>Reopen</button>
                : <span className="settings-row-value">{cycle.id === activeId ? "Active" : "Open"}</span>}
              <Icon name="chevron" size={17} />
            </div>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <p className="settings-group-label">Household</p>
        <div className="settings-list">
          <div className="settings-row">
            <span className="settings-icon settings-icon-orange"><Icon name="people" size={19} /></span>
            <span className="settings-row-copy"><strong>Household</strong></span>
            <span className="settings-row-value">{GROUP_NAME}</span>
          </div>
          <div className="settings-row">
            <span className="settings-icon settings-icon-green"><Icon name="settle" size={19} /></span>
            <span className="settings-row-copy"><strong>Currency</strong></span>
            <span className="settings-row-value">INR</span>
          </div>
          <div className="settings-row">
            <span className="settings-icon settings-icon-cyan"><Icon name="receipt" size={19} /></span>
            <span className="settings-row-copy"><strong>Receipt Storage</strong></span>
            <span className="settings-row-value">Private</span>
          </div>
          <div className="settings-row">
            <span className="settings-icon settings-icon-blue"><Icon name="camera" size={19} /></span>
            <span className="settings-row-copy"><strong>Receipt Recognition</strong></span>
            <span className="settings-row-value">Gemini</span>
          </div>
        </div>
      </section>

      <section className="settings-group">
        <p className="settings-group-label">Data &amp; App</p>
        <div className="settings-list">
          <button className="settings-row" onClick={onRefresh}>
            <span className="settings-icon settings-icon-green"><Icon name="refresh" size={19} /></span>
            <span className="settings-row-copy"><strong>Cloud Sync</strong><small>Refresh records from Supabase</small></span>
            <span className={`settings-row-value sync-${syncStatus}`}>
              {syncStatus === "online" ? "Connected" : syncStatus === "saving" ? "Saving…" : syncStatus === "loading" ? "Loading…" : "Attention"}
            </span>
            <Icon name="chevron" size={17} />
          </button>
          <button className="settings-row" onClick={onExport}>
            <span className="settings-icon settings-icon-orange"><Icon name="receipt" size={19} /></span>
            <span className="settings-row-copy"><strong>Export Ledger</strong><small>Download expenses as CSV</small></span>
            <Icon name="chevron" size={17} />
          </button>
          <button className="settings-row" onClick={onInstall}>
            <span className="settings-icon settings-icon-blue"><Icon name="home" size={19} /></span>
            <span className="settings-row-copy"><strong>Add to Home Screen</strong><small>Install Grocery Ledger on iPhone</small></span>
            <Icon name="chevron" size={17} />
          </button>
        </div>
      </section>
    </div>
  );
}

function ReceiptSheet({ receipts, members, onUpdate, onRemove, onClose, onSave, onScan, saving }: {
  receipts: PendingReceipt[];
  members: string[];
  onUpdate: (id: string, update: Partial<PendingReceipt>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  onScan: (id: string) => Promise<void>;
  saving: boolean;
}) {
  const canSave = receipts.length > 0 && receipts.every(
    (receipt) => receipt.status === "ready" && Number(receipt.amount) > 0 && receipt.payer,
  );
  const cropping = receipts.filter((receipt) => receipt.status === "cropping").length;
  const scanning = receipts.filter((receipt) => receipt.status === "scanning").length;
  const ready = receipts.filter((receipt) => receipt.status === "ready").length;
  const phaseTitle = cropping > 0
    ? "Frame your receipt"
    : scanning > 0
      ? "Reading receipt"
      : "Confirm the details";
  const completionHint = cropping > 0
    ? `${cropping} receipt${cropping === 1 ? "" : "s"} still need cropping`
    : scanning > 0
      ? "Keep this sheet open while recognition finishes"
      : canSave
        ? "Everything is ready to save"
        : "Confirm an amount and payer for every receipt";
  const { sheetRef, dismiss, dragProps } = useSheetGesture(onClose);
  return (
    <div className="sheet-backdrop receipt-sheet-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && dismiss()}>
      <div className="bottom-sheet receipt-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="receipt-sheet-title">
        <div className="sheet-drag-region" aria-hidden="true" {...dragProps}><div className="sheet-handle" /></div>
        <div className="sheet-header receipt-sheet-header">
          <div>
            <p className="receipt-sheet-context">Receipt review · {receipts.length} item{receipts.length === 1 ? "" : "s"}</p>
            <h2 id="receipt-sheet-title">{phaseTitle}</h2>
          </div>
          <button className="icon-button receipt-sheet-close" onClick={dismiss} aria-label="Cancel receipt review"><Icon name="close" size={18} /></button>
        </div>
        <div className="receipt-progress" aria-label={`${ready} of ${receipts.length} receipts reviewed`}>
          {receipts.map((receipt) => (
            <span className={receipt.status === "ready" ? "complete" : receipt.status} key={`progress-${receipt.id}`} />
          ))}
        </div>
        <div className="receipt-editor-list" aria-live="polite">
          {receipts.map((receipt, index) => (
            <div className="receipt-editor" key={receipt.id}>
              <div className="receipt-item-heading">
                <span>Receipt {index + 1}</span>
                <span>{receipt.status === "cropping" ? "Crop" : receipt.status === "scanning" ? "Reading…" : "Review"}</span>
              </div>
              {receipt.status === "cropping" ? (
                <CropEditor
                  receipt={receipt}
                  onChange={(crop) => onUpdate(receipt.id, { crop })}
                  onScan={() => onScan(receipt.id)}
                />
              ) : (
                <div className="receipt-preview">
                  <img src={receipt.preview} alt="Uploaded receipt" />
                  {receipt.status === "scanning" && <span className="scanning"><Icon name="receipt" />Reading receipt…</span>}
                </div>
              )}
              <button className="remove-receipt" onClick={() => onRemove(receipt.id)} aria-label={`Remove receipt ${index + 1}`}><Icon name="trash" size={16} /></button>
              {receipt.status === "ready" && (
                <div className="receipt-fields">
                  <label className="amount-field"><span>Total amount</span><div><b>$</b><input autoFocus inputMode="decimal" type="number" placeholder="0.00" value={receipt.amount} onChange={(event) => onUpdate(receipt.id, { amount: event.target.value })} /></div></label>
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
                  <p className="ai-note">
                    <Icon name="check" size={14} />
                    {receipt.confidence > 0
                      ? `Total found · ${Math.round(receipt.confidence * 100)}% confidence — please confirm`
                      : "Enter the printed total before saving"}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="receipt-sheet-actions">
          <p className={canSave ? "ready" : ""}><Icon name={canSave ? "check" : "receipt"} size={15} />{completionHint}</p>
          <button className="primary-button" disabled={!canSave || saving} onClick={onSave}>
            {saving ? "Saving…" : `Save ${receipts.length} receipt${receipts.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CropEditor({ receipt, onChange, onScan }: {
  receipt: PendingReceipt;
  onChange: (crop: PendingReceipt["crop"]) => void;
  onScan: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    corner: "tl" | "tr" | "bl" | "br";
    startX: number;
    startY: number;
    crop: PendingReceipt["crop"];
  } | null>(null);
  const minimum = 0.16;

  const startDrag = (corner: "tl" | "tr" | "bl" | "br", event: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = { corner, startX: event.clientX, startY: event.clientY, crop: receipt.crop };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current || !stageRef.current) return;
    const bounds = stageRef.current.getBoundingClientRect();
    const dx = (event.clientX - drag.current.startX) / bounds.width;
    const dy = (event.clientY - drag.current.startY) / bounds.height;
    const start = drag.current.crop;
    let { x, y, width, height } = start;
    if (drag.current.corner.includes("l")) {
      const right = start.x + start.width;
      x = Math.max(0, Math.min(right - minimum, start.x + dx));
      width = right - x;
    } else {
      width = Math.max(minimum, Math.min(1 - start.x, start.width + dx));
    }
    if (drag.current.corner.includes("t")) {
      const bottom = start.y + start.height;
      y = Math.max(0, Math.min(bottom - minimum, start.y + dy));
      height = bottom - y;
    } else {
      height = Math.max(minimum, Math.min(1 - start.y, start.height + dy));
    }
    onChange({ x, y, width, height });
  };

  return (
    <div className="crop-editor">
      <p>Drag the corners around the receipt</p>
      <div className="crop-stage" ref={stageRef}>
        <img src={receipt.preview} alt="Receipt ready to crop" />
        <div
          className="crop-box"
          style={{
            left: `${receipt.crop.x * 100}%`,
            top: `${receipt.crop.y * 100}%`,
            width: `${receipt.crop.width * 100}%`,
            height: `${receipt.crop.height * 100}%`,
          }}
        >
          {(["tl", "tr", "bl", "br"] as const).map((corner) => (
            <button
              key={corner}
              className={`crop-handle crop-${corner}`}
              aria-label={`Adjust ${corner} crop corner`}
              onPointerDown={(event) => startDrag(corner, event)}
              onPointerMove={moveDrag}
              onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}
            />
          ))}
        </div>
      </div>
      <button className="crop-confirm" onClick={onScan}>Crop and read receipt</button>
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

function EmptyState({ title, copy, action }: { title: string; copy: string; action: () => void }) {
  return <div className="empty-state"><span><Icon name="receipt" size={28} /></span><h2>{title}</h2><p>{copy}</p><button className="primary-button" onClick={action}>Create a cycle</button></div>;
}

function DataState({ title, copy, action, actionLabel }: {
  title: string;
  copy: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="empty-state data-state" role={action ? "alert" : "status"}>
      <span><Icon name={action ? "refresh" : "receipt"} size={28} /></span>
      <h2>{title}</h2>
      <p>{copy}</p>
      {action && <button className="primary-button" onClick={action}>{actionLabel}</button>}
    </div>
  );
}
