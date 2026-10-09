import { fmt, type Receipt } from "../api";
import { formatDate } from "../components/format";

export function ReceiptsTab({ receipts }: { receipts: Receipt[] }) {
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
              <div
                className="glass-row stagger"
                style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
              >
                <span className="avatar">{(r.merchant || "?").trim()[0].toUpperCase()}</span>
                <div className="row-main">
                  <b>{r.merchant}</b>
                  <small>
                    {r.payer} · {r.category}
                  </small>
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
