import { CalendarRange, ChevronRight, CircleAlert, Clock3, ShieldCheck, WalletCards } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { fmt, memberNameKey, type Period, type Settlement } from "../api";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { formatDate } from "../components/format";
import { cycleStatusFor, cycleStatusLabel, type CycleStatus } from "../cycleStatus";
import { hasReviewedPaymentObligations, provisionalShareDifference } from "../settlementLifecycle";
import { summarizeTransferEvidence } from "../settlementMatching";
import { useTransferEvidence } from "../components/useTransferEvidence";

function ShareDifference({ perPerson, contributed, cycleStatus }: { perPerson: number; contributed: number; cycleStatus: CycleStatus }) {
  const difference = provisionalShareDifference(perPerson, contributed);
  const estimatePrefix = cycleStatus === "ACTIVE" ? "Est. " : "";
  if (difference > 0) return <span className="row-amount balance-due">{estimatePrefix}gap {fmt(difference)}</span>;
  if (difference < 0)
    return (
      <span className="row-amount balance-credit">
        {estimatePrefix}above {fmt(-difference)}
      </span>
    );
  return <span className="row-amount balance-settled">At equal share</span>;
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
  period,
  memberAvatarUrls = {},
  user,
  onOpenHistory,
}: {
  settlement: Settlement | null;
  periods: Period[];
  period?: Period;
  memberAvatarUrls?: Record<string, string>;
  user: User;
  onOpenHistory: () => void;
}) {
  const members = Object.entries(settlement?.member_totals || {});
  const currentPeriod = period || periods.find((candidate) => candidate.id === settlement?.period_id) || periods.find((candidate) => candidate.status === "CURRENT") || periods[0];
  const cycleStatus = currentPeriod ? cycleStatusFor(currentPeriod) : "ACTIVE";
  const totalCents = settlement?.total_cents ?? currentPeriod?.total_cents ?? 0;
  const perPersonCents = settlement?.per_person_cents ?? currentPeriod?.per_person_cents ?? 0;
  const receiptCount = settlement?.receipt_count ?? currentPeriod?.receipt_count ?? 0;
  const evidence = useTransferEvidence(currentPeriod?.id || null, settlement?.calculated_at);
  const evidenceSummary = summarizeTransferEvidence(evidence.bankReceipts);
  const evidenceItemCount = evidenceSummary.total + evidence.whatsAppEvidence.length;
  const hasReviewedObligations = hasReviewedPaymentObligations(settlement);
  const showPaymentVerification = evidenceItemCount > 0 || hasReviewedObligations || Boolean(evidence.error);

  return (
    <div className="screen screen--home">
      <header className="page-header home-header">
        <h1 className="large-title" id="home-title">{greetingForHour(new Date().getHours())}, {firstName(user)}</h1>
        <div className="home-header-meta">
          <span>Rockdale Homies</span>
          {currentPeriod && (
            <time dateTime={currentPeriod.end_date}>
              {shortDate(currentPeriod.start_date)} – {["ACTIVE", "PENDING_SETTLEMENT"].includes(cycleStatus) ? "Today" : shortDate(currentPeriod.end_date)}
            </time>
          )}
        </div>
      </header>

      <section className="balance-summary home-balance" aria-labelledby="balance-heading">
        <div className="home-summary-top">
          <div>
            <p className="summary-label" id="balance-heading">{cycleStatus === "ACTIVE" ? "Estimated equal share" : cycleStatus === "SETTLED" ? "Final equal share" : "Calculated equal share"}</p>
            <span className={`summary-status cycle-badge--${cycleStatus.toLocaleLowerCase()}`}>{cycleStatusLabel(cycleStatus)}</span>
          </div>
          <span className="home-summary-icon" aria-hidden="true"><WalletCards /></span>
        </div>
        <p className="summary-amount">{fmt(perPersonCents)}</p>
        <dl className="summary-details">
          <div><dt>Household spending</dt><dd>{fmt(totalCents)}</dd></div>
          <div><dt>Receipts</dt><dd>{receiptCount}</dd></div>
        </dl>
      </section>

      <section className="content-section" aria-labelledby="members-heading">
        <div className="section-heading">
          <h2 id="members-heading">Member contributions</h2>
          <span>{members.length} people</span>
        </div>
        {members.length ? <ul className="grouped-list member-list">
        {members.map(([name, cents], i) => (
          <li
            key={name}
            className="list-row stagger"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <ProfileAvatar name={name} src={memberAvatarUrls[memberNameKey(name)]} />
            <div className="row-main">
              <span className="row-title">{name}</span>
              <span className="row-sub">Contributed {fmt(cents)} · equal share {fmt(perPersonCents)}</span>
            </div>
            <ShareDifference perPerson={perPersonCents} contributed={cents} cycleStatus={cycleStatus} />
          </li>
        ))}
        </ul> : <div className="empty-state compact-empty">No household spending has been recorded for this period yet.</div>}
      </section>

      {showPaymentVerification && (
        <section className="content-section home-verification-section" aria-labelledby="home-verification-heading">
          <div className="section-heading">
            <h2 id="home-verification-heading">Payment verification</h2>
            <span>{evidenceItemCount} evidence item{evidenceItemCount === 1 ? "" : "s"}</span>
          </div>
          {evidence.loading ? (
            <div className="payment-verification-card"><span className="settle-status-spinner" aria-hidden="true" /><div><strong>Checking payment evidence</strong><span>Verification details are loading.</span></div></div>
          ) : evidence.error ? (
            <div className="payment-verification-card unknown"><CircleAlert aria-hidden="true" /><div><strong>Verification unavailable</strong><span>Payment evidence could not be checked. No payments are being treated as complete.</span></div></div>
          ) : (
            <div className={`payment-verification-card${evidenceSummary.verified > 0 ? " verified" : ""}`}>
              {evidenceSummary.verified > 0 ? <ShieldCheck aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
              <div>
                <strong>{evidenceSummary.verified > 0 ? `${evidenceSummary.verified} verified` : evidenceSummary.total ? "Evidence awaiting verification" : "Awaiting payment receipts"}</strong>
                <span>{evidenceSummary.pending} pending · {evidenceSummary.rejected} rejected · {evidenceSummary.unknown} unknown{evidence.whatsAppEvidence.length ? ` · ${evidence.whatsAppEvidence.length} unassigned` : ""}</span>
              </div>
            </div>
          )}
        </section>
      )}

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
                  <span className="row-title">{cycleStatusFor(period) === "SETTLED" ? "Completed settlement" : cycleStatusFor(period) === "PENDING_SETTLEMENT" ? "Pending settlement" : "Current settlement"}</span>
                  <span className="row-sub">{formatDate(period.start_date)} – {["ACTIVE", "PENDING_SETTLEMENT"].includes(cycleStatusFor(period)) ? "Open" : formatDate(period.end_date)} · {period.receipt_count} receipts</span>
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
