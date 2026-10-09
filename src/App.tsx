import { useEffect, useState } from "react";
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

  useEffect(() => {
    Promise.all([fetchCurrentSettlement(), fetchReceipts(), fetchPeriods()])
      .then(([s, r, p]) => { setSettlement(s); setReceipts(r); setPeriods(p); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>SplitMate</h1>
        <span className="subtitle">Rockdale Homies Grocery</span>
      </header>

      <main>
        {loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <>
            {tab === "home" && <HomeTab settlement={settlement} />}
            {tab === "receipts" && <ReceiptsTab receipts={receipts} />}
            {tab === "history" && <HistoryTab periods={periods} />}
          </>
        )}
      </main>

      <nav className="bottomnav">
        {(["home", "receipts", "history"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "home" ? "Home" : t === "receipts" ? "Receipts" : "History"}
          </button>
        ))}
      </nav>
    </div>
  );
}

function HomeTab({ settlement }: { settlement: Settlement | null }) {
  if (!settlement) return <div className="empty">No settlement yet.</div>;
  const members = Object.entries(settlement.member_totals || {});
  return (
    <div>
      <div className="hero">
        <span className="hero-label">You each owe</span>
        <span className="hero-amount">{fmt(settlement.per_person_cents)}</span>
        <span className="hero-sub">
          {fmt(settlement.total_cents)} total · {settlement.receipt_count} receipts
        </span>
      </div>
      <h2>Paid so far</h2>
      <div className="cards">
        {members.map(([name, cents]) => (
          <div key={name} className="card member-row">
            <span className="avatar">{name[0]}</span>
            <span className="member-name">{name}</span>
            <strong>{fmt(cents)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceiptsTab({ receipts }: { receipts: Receipt[] }) {
  if (!receipts.length) return <div className="empty">No receipts.</div>;
  return (
    <div className="cards">
      {receipts.map((r) => (
        <div key={r.id} className="card receipt-row">
          <span className="avatar">{(r.merchant || "?")[0].toUpperCase()}</span>
          <div className="receipt-main">
            <b>{r.merchant}</b>
            <small>{r.payer} · {r.date}</small>
          </div>
          <strong className="amount">{fmt(r.amount_cents)}</strong>
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ periods }: { periods: Period[] }) {
  if (!periods.length) return <div className="empty">No past periods.</div>;
  return (
    <div className="cards">
      {periods.map((p) => (
        <div key={p.id} className="card period-row">
          <div>
            <b>{p.start_date} → {p.end_date}</b>
            <small>{p.receipt_count} receipts</small>
          </div>
          <div className="period-amounts">
            <strong>{fmt(p.total_cents)}</strong>
            <small>{fmt(p.per_person_cents)} each</small>
          </div>
          {p.status === "CURRENT" && <span className="badge">Current</span>}
        </div>
      ))}
    </div>
  );
}
