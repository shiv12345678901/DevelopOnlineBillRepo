import { fmt, type Period } from "../api";
import { formatDate } from "../components/format";
import { CalendarRange } from "lucide-react";

export function HistoryTab({ periods }: { periods: Period[] }) {
  if (!periods.length) return <div className="empty">No past periods.</div>;
  return (
    <div className="screen screen--history">
      <header className="page-header">
        <p className="eyebrow">Household archive</p>
        <h1 className="large-title">History</h1>
        <p className="page-summary">Review current and previous settlement periods.</p>
      </header>

      <section className="content-section" aria-labelledby="periods-heading">
        <div className="section-heading">
          <h2 id="periods-heading">Settlement periods</h2>
          <span>{periods.length}</span>
        </div>
        <ul className="history-list">
        {periods.map((p, i) => (
          <li
            key={p.id}
            className="period-card stagger"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="period-top">
              <span className="history-icon" aria-hidden="true"><CalendarRange /></span>
              <div className="period-title-copy">
                <h3>{p.status === "CURRENT" ? "Current settlement" : "Completed settlement"}</h3>
                <p>{formatDate(p.start_date)} – {formatDate(p.end_date)} · {p.receipt_count} receipts</p>
              </div>
              {p.status === "CURRENT" && <span className="badge">Current</span>}
            </div>
            <dl className="period-amounts">
              <div>
                <dt>Total</dt>
                <dd>{fmt(p.total_cents)}</dd>
              </div>
              <div>
                <dt>Each person</dt>
                <dd>{fmt(p.per_person_cents)}</dd>
              </div>
            </dl>
          </li>
        ))}
        </ul>
      </section>
    </div>
  );
}
