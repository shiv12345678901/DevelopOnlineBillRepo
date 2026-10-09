import { fmt, type Settlement } from "../api";

function Balance({ perPerson, paid }: { perPerson: number; paid: number }) {
  const bal = perPerson - paid;
  if (bal > 0) return <span className="row-amount">Owes {fmt(bal)}</span>;
  if (bal < 0)
    return (
      <span className="row-amount" style={{ color: "var(--blue)" }}>
        Owed {fmt(-bal)}
      </span>
    );
  return <span className="row-amount">Settled</span>;
}

export function HomeTab({ settlement }: { settlement: Settlement | null }) {
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
          <span className="hero-sub">
            {fmt(settlement.total_cents)} total · {settlement.receipt_count} receipts
          </span>
        </div>
        <div className="hero-badge">$</div>
      </div>

      <h2 className="section-title">Paid so far</h2>
      <div className="glass-list">
        {members.map(([name, cents], i) => (
          <div
            key={name}
            className="glass-row stagger"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="avatar">{name.trim()[0].toUpperCase()}</span>
            <div className="row-main">
              <b>{name}</b>
              <div className="row-sub">Paid {fmt(cents)}</div>
            </div>
            <Balance perPerson={settlement.per_person_cents} paid={cents} />
          </div>
        ))}
      </div>
    </div>
  );
}
