import { CalendarRange, ChevronRight, CircleAlert, Clock3, ShieldCheck, WalletCards } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import {
  fetchSettlementCycleMembership,
  fetchSettlementCycleMembershipPermissions,
  fetchSettlementCyclePreview,
  fmt,
  memberNameKey,
  type Period,
  type Settlement,
  type SettlementCyclePreview,
} from "../api";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { formatDate } from "../components/format";
import { cycleStatusFor, cycleStatusLabel, type CycleStatus } from "../cycleStatus";
import { hasReviewedPaymentObligations, provisionalShareDifference } from "../settlementLifecycle";
import { summarizeTransferEvidence } from "../settlementMatching";
import { useTransferEvidence } from "../components/useTransferEvidence";
import { MEMBERSHIP_FEATURE_ENABLED, permissionsMatch } from "../membership";

const HOME_MEMBER_ORDER = ["shiva", "arjun", "arpan", "swasti"];

function memberOrder(name: string) {
  const first = name.trim().split(/\s+/)[0]?.toLocaleLowerCase() || "";
  const index = HOME_MEMBER_ORDER.indexOf(first);
  return index < 0 ? HOME_MEMBER_ORDER.length : index;
}

function ShareDifference({ perPerson, contributed, cycleStatus }: { perPerson: number; contributed: number; cycleStatus: CycleStatus }) {
  const difference = provisionalShareDifference(perPerson, contributed);
  if (difference > 0) return <span className="row-amount balance-due">{cycleStatus === "ACTIVE" ? "Est. owes" : "Below share"} {fmt(difference)}</span>;
  if (difference < 0)
    return (
      <span className="row-amount balance-credit">
        {cycleStatus === "ACTIVE" ? "Est. owed" : "Above share"} {fmt(-difference)}
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
  const currentPeriod = period || periods.find((candidate) => candidate.id === settlement?.period_id) || periods.find((candidate) => candidate.status === "CURRENT") || periods[0];
  const [membershipPreview, setMembershipPreview] = useState<SettlementCyclePreview | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipError, setMembershipError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMembershipPreview(null);
    setMembershipError(false);
    if (!MEMBERSHIP_FEATURE_ENABLED || !currentPeriod?.id) {
      setMembershipLoading(false);
      return () => { cancelled = true; };
    }

    setMembershipLoading(true);
    void (async () => {
      try {
        const permissions = await fetchSettlementCycleMembershipPermissions(currentPeriod.id);
        if (!permissions.can_view) throw new Error("UNAUTHORIZED_MEMBERSHIP_ACCESS");
        const [membership, preview] = await Promise.all([
          fetchSettlementCycleMembership(currentPeriod.id),
          fetchSettlementCyclePreview(currentPeriod.id),
        ]);
        if (
          membership.period_id !== currentPeriod.id
          || preview.period_id !== currentPeriod.id
          || membership.revision !== preview.revision
          || !permissionsMatch(permissions, membership.permissions, preview.permissions)
        ) throw new Error("Membership responses did not agree.");
        if (!cancelled) setMembershipPreview(preview);
      } catch {
        if (!cancelled) setMembershipError(true);
      } finally {
        if (!cancelled) setMembershipLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentPeriod?.id, settlement?.calculated_at]);

  const legacyMembers = Object.entries(settlement?.member_totals || {}).sort(([left], [right]) => memberOrder(left) - memberOrder(right));
  const participatingMembers = membershipPreview?.members
    .filter((member) => member.participation_mode !== "disabled")
    .sort((left, right) => memberOrder(left.member_name) - memberOrder(right.member_name));
  const cycleStatus = currentPeriod ? cycleStatusFor(currentPeriod) : "ACTIVE";
  const membershipFinancialsUnavailable = MEMBERSHIP_FEATURE_ENABLED && !membershipPreview;
  const totalCents = membershipFinancialsUnavailable ? null : membershipPreview?.total_cents ?? settlement?.total_cents ?? currentPeriod?.total_cents ?? 0;
  const perPersonCents = membershipFinancialsUnavailable ? null : membershipPreview?.equal_share_cents ?? settlement?.per_person_cents ?? currentPeriod?.per_person_cents ?? 0;
  const receiptCount = membershipFinancialsUnavailable ? null : membershipPreview?.receipt_count ?? settlement?.receipt_count ?? currentPeriod?.receipt_count ?? 0;
  const evidence = useTransferEvidence(currentPeriod?.id || null, settlement?.calculated_at);
  const evidenceSummary = summarizeTransferEvidence(evidence.bankReceipts);
  const evidenceItemCount = evidenceSummary.total + evidence.whatsAppEvidence.length;
  const hasReviewedObligations = hasReviewedPaymentObligations(settlement);
  const awaitingCalculation = cycleStatus === "PENDING_SETTLEMENT" && !hasReviewedObligations;
  const historicalObligationsUnavailable = cycleStatus === "SETTLED" && !hasReviewedObligations;
  const showPaymentVerification = evidenceItemCount > 0 || hasReviewedObligations || awaitingCalculation || historicalObligationsUnavailable || Boolean(evidence.error);

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

      <section className="balance-summary home-balance" role="region" aria-labelledby="balance-heading">
        <div className="home-summary-top">
          <div>
            <p className="summary-label" id="balance-heading">{cycleStatus === "ACTIVE" ? "Estimated equal share" : cycleStatus === "SETTLED" ? "Final equal share" : "Calculated equal share"}</p>
            <span className={`summary-status cycle-badge--${cycleStatus.toLocaleLowerCase()}`}>{cycleStatusLabel(cycleStatus)}</span>
          </div>
          <span className="home-summary-icon" aria-hidden="true"><WalletCards /></span>
        </div>
        <p className="summary-amount">{perPersonCents === null ? "—" : fmt(perPersonCents)}</p>
        <dl className="summary-details">
          <div><dt>Household spending</dt><dd>{totalCents === null ? "—" : fmt(totalCents)}</dd></div>
          <div><dt>Receipts</dt><dd>{receiptCount ?? "—"}</dd></div>
        </dl>
      </section>

      <section className="content-section" aria-labelledby="members-heading">
        <div className="section-heading">
          <h2 id="members-heading">Paid so far</h2>
          <span>{participatingMembers ? `${participatingMembers.length} people` : `${legacyMembers.length} people`}</span>
        </div>
        {MEMBERSHIP_FEATURE_ENABLED && membershipLoading ? (
          <div className="empty-state compact-empty" role="status">Updating settlement members…</div>
        ) : MEMBERSHIP_FEATURE_ENABLED && membershipError ? (
          <div className="empty-state compact-empty" role="alert">Membership totals are unavailable. Refresh before relying on this calculation.</div>
        ) : participatingMembers ? (participatingMembers.length ? <ul className="grouped-list member-list">
        {participatingMembers.map((member, i) => (
          <li
            key={member.member_name}
            className="list-row stagger"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <ProfileAvatar name={member.member_name} src={memberAvatarUrls[memberNameKey(member.member_name)]} />
            <div className="row-main">
              <span className="row-title">{member.member_name}</span>
              <span className="row-sub">Paid {fmt(member.paid_cents)}{member.participation_mode === "keep_receipts" ? " · Keep Receipts" : ""}</span>
            </div>
            {member.participation_mode === "keep_receipts" ? (
              <span className={`row-amount ${member.net_cents > 0 ? "balance-credit" : "balance-settled"}`}>
                {member.net_cents > 0 ? `Credit ${fmt(member.net_cents)}` : "No equal share"}
              </span>
            ) : member.net_cents > 0 ? (
              <span className="row-amount balance-credit">Est. owed {fmt(member.net_cents)}</span>
            ) : member.net_cents < 0 ? (
              <span className="row-amount balance-due">Est. owes {fmt(-member.net_cents)}</span>
            ) : (
              <span className="row-amount balance-settled">At equal share</span>
            )}
          </li>
        ))}
        </ul> : <div className="empty-state compact-empty">No participating members in this period.</div>) : legacyMembers.length ? <ul className="grouped-list member-list">
        {legacyMembers.map(([name, cents], i) => (
          <li key={name} className="list-row stagger" style={{ animationDelay: `${i * 60}ms` }}>
            <ProfileAvatar name={name} src={memberAvatarUrls[memberNameKey(name)]} />
            <div className="row-main"><span className="row-title">{name}</span><span className="row-sub">Paid {fmt(cents)}</span></div>
            <ShareDifference perPerson={perPersonCents ?? 0} contributed={cents} cycleStatus={cycleStatus} />
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
          {awaitingCalculation ? (
            <div className="payment-verification-card"><Clock3 aria-hidden="true" /><div><strong>Awaiting calculation</strong></div></div>
          ) : historicalObligationsUnavailable ? (
            <div className="payment-verification-card unknown"><CircleAlert aria-hidden="true" /><div><strong>Historical obligations unavailable</strong></div></div>
          ) : evidence.loading ? (
            <div className="payment-verification-card"><span className="status-spinner" aria-hidden="true" /><div><strong>Checking payment evidence</strong></div></div>
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
