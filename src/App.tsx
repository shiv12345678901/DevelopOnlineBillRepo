import { useEffect, useState } from "react";
import {
  fetchCurrentSettlement, fetchReceipts, fetchPeriods, fmt,
  type Receipt, type Settlement, type Period,
} from "./api";

type Tab = "overview" | "receipts" | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "receipts", label: "Receipts" },
  { id: "history", label: "History" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);

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

  const currentPeriod = periods.find((p) => p.status === "CURRENT");
  const periodLabel = currentPeriod
    ? `${formatDate(currentPeriod.start_date)} – ${formatDate(currentPeriod.end_date)}`
    : "";

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      {!online && <div className="offline-banner">Offline — showing last synced data</div>}
      <header className="site-header">
        <span className="brand">SplitMate</span>
        <span className="header-meta">{periodLabel}</span>
      </header>
      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main id="main">
        {loading ? (
          <p className="loading">Loading…</p>
        ) : (
          <>
            {tab === "overview" && <OverviewTab settlement={settlement} periodLabel={periodLabel} />}
            {tab === "receipts" && <ReceiptsTab receipts={receipts} />}
            {tab === "history" && <HistoryTab periods={periods} />}
          </>
        )}
      </main>
      <footer className="site-footer">
        <span>SplitMate</span>
        <span>Rockdale Homies Grocery · synced from Supabase</span>
      </footer>
    </div>
  );
}

function OverviewTab({ settlement, periodLabel }: { settlement: Settlement | null; periodLabel: string }) {
  if (!settlement) return <p className="empty">No settlement calculated yet.</p>;
  const members = Object.entries(settlement.member_totals || {});
  return (
    <>
      <section className="hero" aria-labelledby="hero-amount">
        <p className="eyebrow">Current settlement{periodLabel ? ` · ${periodLabel}` : ""}</p>
        <p className="display" id="hero-amount">{fmt(settlement.per_person_cents)}</p>
        <p className="display-caption">per person</p>
        <dl className="stat-strip">
          <div className="stat">
            <dt>Total spent</dt>
            <dd>{fmt(settlement.total_cents)}</dd>
          </div>
          <div className="stat">
            <dt>Receipts</dt>
            <dd>{settlement.receipt_count}</dd>
          </div>
          <div className="stat">
            <dt>Members</dt>
            <dd>{members.length}</dd>
          </div>
        </dl>
      </section>

      <section className="section" aria-labelledby="balances-h">
        <h2 id="balances-h">Balances</h2>
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">What each member paid and their remaining balance</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col" className="num">Paid</th>
                <th scope="col" className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {members.map(([name, cents]) => {
                const bal = settlement.per_person_cents - cents;
                const balance = bal > 0 ? `Owes ${fmt(bal)}` : bal < 0 ? `Owed ${fmt(-bal)}` : "Settled";
                return (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td className="num">{fmt(cents)}</td>
                    <td className="num">{balance}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ReceiptsTab({ receipts }: { receipts: Receipt[] }) {
  if (!receipts.length) return <p className="empty">No receipts in this period.</p>;
  let lastDate = "";
  return (
    <section className="section" aria-labelledby="receipts-h">
      <h2 id="receipts-h">Receipts</h2>
      <p className="section-sub">{receipts.length} receipts in this period</p>
      {receipts.map((r) => {
        const groupHeader = r.date !== lastDate
          ? <h3 className="date-group">{formatDate(r.date)}</h3>
          : null;
        lastDate = r.date;
        return (
          <div key={r.id}>
            {groupHeader}
            <div className="receipt-row">
              <div className="receipt-main">
                <p className="receipt-merchant">{r.merchant}</p>
                <p className="receipt-meta">{r.payer} · {r.category}</p>
              </div>
              <p className="receipt-amount">{fmt(r.amount_cents)}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function HistoryTab({ periods }: { periods: Period[] }) {
  if (!periods.length) return <p className="empty">No past periods.</p>;
  return (
    <section className="section" aria-labelledby="history-h">
      <h2 id="history-h">History</h2>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Past settlement periods</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col" className="num">Receipts</th>
              <th scope="col" className="num">Total</th>
              <th scope="col" className="num">Each</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id}>
                <th scope="row">
                  {formatDate(p.start_date)} – {formatDate(p.end_date)}
                  {p.status === "CURRENT" && <span className="current-note"> · Current</span>}
                </th>
                <td className="num">{p.receipt_count}</td>
                <td className="num">{fmt(p.total_cents)}</td>
                <td className="num">{fmt(p.per_person_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDate(d: string) {
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}
