import { CalendarRange, ChevronRight, WalletCards } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { fmt, memberNameKey, type Period, type Settlement } from "../api";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { formatDate } from "../components/format";

function Balance({ perPerson, paid }: { perPerson: number; paid: number }) {
  const bal = perPerson - paid;
  if (bal > 0) return <span className="row-amount balance-due">Owes {fmt(bal)}</span>;
  if (bal < 0)
    return (
      <span className="row-amount balance-credit">
        Owed {fmt(-bal)}
      </span>
    );
  return <span className="row-amount balance-settled">Settled</span>;
}

function shortDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(user: User) {
  const displayName = user.user_metadata.display_name || user.user_metadata.full_name || user.email?.split("@")[0] || "there";
  return String(displayName).trim().split(/\s+/)[0] || "there";
}

export function HomeTab({
  settlement,
  periods,
  memberAvatarUrls = {},
  user,
  onOpenHistory,
}: {
  settlement: Settlement | null;
  periods: Period[];
  memberAvatarUrls?: Record<string, string>;
  user: User;
  onOpenHistory: () => void;
}) {
  if (!settlement) return <div className="empty">No settlement yet.</div>;
  const members = Object.entries(settlement.member_totals || {});
  const currentPeriod = periods.find((period) => period.id === settlement.period_id) || periods.find((period) => period.status === "CURRENT") || periods[0];

  return (
    <div className="screen screen--home">
      <header className="page-header home-header">
        <h1 className="large-title" id="home-title">{greetingForHour(new Date().getHours())}, {firstName(user)}</h1>
        <div className="home-header-meta">
          <span>Rockdale Homies</span>
          {currentPeriod && (
            <time dateTime={currentPeriod.end_date}>
              {shortDate(currentPeriod.start_date)} – {currentPeriod.status === "CURRENT" ? "Today" : shortDate(currentPeriod.end_date)}
            </time>
          )}
        </div>
      </header>

      <section className="balance-summary home-balance" aria-labelledby="balance-heading">
        <div className="home-summary-top">
          <div>
            <p className="summary-label" id="balance-heading">Each person’s share</p>
          </div>
          <span className="home-summary-icon" aria-hidden="true"><WalletCards /></span>
        </div>
        <p className="summary-amount">{fmt(settlement.per_person_cents)}</p>
        <dl className="summary-details">
          <div><dt>Household total</dt><dd>{fmt(settlement.total_cents)}</dd></div>
          <div><dt>Receipts</dt><dd>{settlement.receipt_count}</dd></div>
        </dl>
      </section>

      <section className="content-section" aria-labelledby="members-heading">
        <div className="section-heading">
          <h2 id="members-heading">Paid so far</h2>
          <span>{members.length} people</span>
        </div>
        <ul className="grouped-list member-list">
        {members.map(([name, cents], i) => (
          <li
            key={name}
            className="list-row stagger"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <ProfileAvatar name={name} src={memberAvatarUrls[memberNameKey(name)]} />
            <div className="row-main">
              <span className="row-title">{name}</span>
              <span className="row-sub">Paid {fmt(cents)}</span>
            </div>
            <Balance perPerson={settlement.per_person_cents} paid={cents} />
          </li>
        ))}
        </ul>
      </section>

      <section className="content-section" aria-labelledby="home-history-heading">
        <div className="section-heading">
          <h2 id="home-history-heading">History</h2>
          <button className="section-link" type="button" onClick={onOpenHistory}>
            View all <ChevronRight aria-hidden="true" />
          </button>
        </div>
        {periods.length ? (
          <ul className="grouped-list period-preview-list">
            {periods.slice(0, 3).map((period) => (
              <li className="period-preview-row" key={period.id}>
                <span className="history-icon" aria-hidden="true"><CalendarRange /></span>
                <div className="period-preview-copy">
                  <span className="row-title">{period.status === "CURRENT" ? "Current settlement" : "Completed settlement"}</span>
                  <span className="row-sub">{formatDate(period.start_date)} – {formatDate(period.end_date)} · {period.receipt_count} receipts</span>
                </div>
                <strong className="row-amount">{fmt(period.total_cents)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state compact-empty">No settlement history yet.</div>
        )}
      </section>
    </div>
  );
}
