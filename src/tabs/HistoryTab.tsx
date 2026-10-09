import { fmt, type Period } from "../api";
import { formatDate } from "../components/format";

export function HistoryTab({ periods }: { periods: Period[] }) {
  if (!periods.length) return <div className="empty">No past periods.</div>;
  return (
    <div>
      <h1 className="large-title">History</h1>
      <p className="caption">Past settlement periods</p>
      <div className="glass-list">
        {periods.map((p, i) => (
          <div
            key={p.id}
            className="glass-card stagger"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="period-top">
              <div>
                <b>
                  {formatDate(p.start_date)} — {formatDate(p.end_date)}
                </b>
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
