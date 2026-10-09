import { useEffect, useRef, useState } from "react";
import {
  fetchCurrentSettlement, fetchReceipts, fetchPeriods, fmt,
  type Receipt, type Settlement, type Period,
} from "./api";

type Tab = "home" | "receipts" | "history";

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [collapsed, setCollapsed] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const lastY = useRef(0);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY.current;
      lastY.current = y;
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
      if (dy > 8 && y > 120) {
        setCollapsed(true); // scrolling down -> contract
      } else if (dy < -8) {
        setCollapsed(false); // scrolling up -> expand
      }
      // re-expand after idle so it's tappable
      collapseTimer.current = setTimeout(() => setCollapsed(false), 1800);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
  }, []);

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

  useEffect(() => {
    Promise.all([fetchCurrentSettlement(), fetchReceipts(), fetchPeriods()])
      .then(([s, r, p]) => { setSettlement(s); setReceipts(r); setPeriods(p); })
      .finally(() => setLoading(false));
  }, []);

  const tabTitle = tab === "home" ? "SplitMate" : tab === "receipts" ? "Receipts" : "History";

  return (
    <div className="app">
      <div className="bg-wash" aria-hidden="true" />

      <header className="nav-bar">
        <div className="nav-title">{tabTitle}</div>
      </header>
      {!online && <div className="offline-banner">Offline — showing last synced data</div>}

      <main key={tab} ref={mainRef} className="tab-enter">
        {loading ? (
          <div className="loading">
            <div className="spinner" />
            <p>Loading your bills…</p>
          </div>
        ) : (
          <>
            {tab === "home" && <HomeTab settlement={settlement} />}
            {tab === "receipts" && <ReceiptsTab receipts={receipts} />}
            {tab === "history" && <HistoryTab periods={periods} />}
          </>
        )}
      </main>

      <nav
        className={`tab-bar${collapsed ? " collapsed" : ""}`}
        onPointerEnter={() => setCollapsed(false)}
        onTouchStart={() => setCollapsed(false)}
      >
        <TabButton active={tab === "home"} onClick={() => setTab("home")} path="M3 10.5 12 3l9 7.5V21H3z M9 21v-6h6v6" label="Home" />
        <TabButton active={tab === "receipts"} onClick={() => setTab("receipts")} path="M6 2h9l5 5v15H6z M14 2v6h6 M9 13h8 M9 17h8" label="Receipts" />
        <TabButton active={tab === "history"} onClick={() => setTab("history")} path="M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 3" label="History" />
      </nav>
    </div>
  );
}

function TabButton({ active, onClick, path, label }: { active: boolean; onClick: () => void; path: string; label: string }) {
  return (
    <button className={`tab-btn${active ? " active" : ""}`} onClick={onClick}>
      <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
      <span className="tab-label">{label}</span>
    </button>
  );
}

function HomeTab({ settlement }: { settlement: Settlement | null }) {
  if (!settlement) return <div className="empty">No settlement yet.</div>;
  const members = Object.entries(settlement.member_totals || {});

  return (
    <div>
      <h1 className="large-title">SplitMate</h1>
      <p className="caption">Rockdale Homies Grocery</p>

      <div className="glass-hero">
        <div className="glass-shine" />
        <div className="hero-main">
          <span className="hero-label">You each owe</span>
          <span className="hero-amount">{fmt(settlement.per_person_cents)}</span>
          <span className="hero-sub">{fmt(settlement.total_cents)} total · {settlement.receipt_count} receipts</span>
        </div>
        <div className="hero-badge">$</div>
      </div>

      <h2 className="section-title">Paid so far</h2>
      <div className="glass-list">
        {members.map(([name, cents], i) => (
          <div key={name} className="glass-row stagger" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="avatar">{name.trim()[0].toUpperCase()}</span>
            <div className="row-main">
              <b>{name}</b>
              <div className="row-sub">Paid {fmt(cents)}</div>
            </div>
            {(() => {
              const bal = settlement.per_person_cents - cents;
              return bal > 0
                ? <span className="row-amount">Owes {fmt(bal)}</span>
                : bal < 0
                  ? <span className="row-amount" style={{ color: "var(--blue)" }}>Owed {fmt(-bal)}</span>
                  : <span className="row-amount">Settled</span>;
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceiptsTab({ receipts }: { receipts: Receipt[] }) {
  if (!receipts.length) return <div className="empty">No receipts.</div>;
  let lastDate = "";
  return (
    <div>
      <h1 className="large-title">Receipts</h1>
      <p className="caption">{receipts.length} receipts this period</p>
      <div className="glass-list">
        {receipts.map((r, i) => {
          const showHeader = r.date !== lastDate;
          lastDate = r.date;
          return (
            <div key={r.id}>
              {showHeader && <div className="date-header">{formatDate(r.date)}</div>}
              <div className="glass-row stagger" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                <span className="avatar">{(r.merchant || "?").trim()[0].toUpperCase()}</span>
                <div className="row-main">
                  <b>{r.merchant}</b>
                  <small>{r.payer} · {r.category}</small>
                </div>
                <strong className="row-amount">{fmt(r.amount_cents)}</strong>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryTab({ periods }: { periods: Period[] }) {
  if (!periods.length) return <div className="empty">No past periods.</div>;
  return (
    <div>
      <h1 className="large-title">History</h1>
      <p className="caption">Past settlement periods</p>
      <div className="glass-list">
        {periods.map((p, i) => (
          <div key={p.id} className="glass-card stagger" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="period-top">
              <div>
                <b>{formatDate(p.start_date)} — {formatDate(p.end_date)}</b>
                <small>{p.receipt_count} receipts</small>
              </div>
              {p.status === "CURRENT" && <span className="badge">Current</span>}
            </div>
            <div className="period-amounts">
              <div>
                <small>Total</small>
                <b>{fmt(p.total_cents)}</b>
              </div>
              <div>
                <small>Each</small>
                <b className="accent">{fmt(p.per_person_cents)}</b>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(d: string) {
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}
