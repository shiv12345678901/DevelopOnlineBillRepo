import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, Check, HandCoins, ReceiptText } from "lucide-react";
import { fetchBankTransferReceipts, fmt, type BankTransferReceipt, type Period, type Settlement } from "../api";
import { formatDate } from "../components/format";
import { ProfileAvatar } from "../components/ProfileAvatar";

type Payment = { id: string; from: string; to: string; cents: number; self?: boolean };

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || value;
}

function getCoordinator(memberNames: string[]) {
  return memberNames.find((name) => name.toLocaleLowerCase().includes("arjun")) || memberNames[0] || "Coordinator";
}

function samePerson(left: string, right: string) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  return normalize(left) === normalize(right) || normalize(left).split(/\s+/)[0] === normalize(right).split(/\s+/)[0];
}

function isGrocery(value: string) {
  return value.trim().toLocaleLowerCase() === "grocery";
}

function hasBankReceipt(payment: Payment, stage: "contribute" | "reimburse", receipts: BankTransferReceipt[]) {
  return receipts.some((receipt) => {
    const correctDirection = stage === "contribute"
      ? samePerson(receipt.from_name, payment.from) && (isGrocery(receipt.to_name) || samePerson(receipt.to_name, payment.to))
      : (samePerson(receipt.from_name, payment.from) || isGrocery(receipt.from_name)) &&
        (samePerson(receipt.to_name, payment.to) || (payment.self && isGrocery(receipt.to_name)));
    return correctDirection && Math.abs(receipt.amount_cents - payment.cents) <= 10;
  });
}

function buildPlan(settlement: Settlement) {
  const spending = Object.entries(settlement.member_totals || {});
  const coordinator = getCoordinator(spending.map(([name]) => name));
  const contributions = spending.map(([name]) => ({
    id: `contribute-${name}`,
    from: name,
    to: coordinator,
    cents: settlement.per_person_cents,
    self: name === coordinator,
  }));
  const reimbursements = spending.map(([name, cents]) => ({
    id: `reimburse-${name}`,
    from: coordinator,
    to: name,
    cents,
    self: name === coordinator,
  }));
  return { coordinator, contributions, reimbursements };
}

export function SettleTab({ settlement, periods }: { settlement: Settlement | null; periods: Period[] }) {
  const [bankReceipts, setBankReceipts] = useState<BankTransferReceipt[]>([]);
  const plan = useMemo(() => settlement ? buildPlan(settlement) : null, [settlement]);
  const currentPeriod = periods.find((period) => period.id === settlement?.period_id) || periods.find((period) => period.status === "CURRENT") || periods[0];
  useEffect(() => {
    if (!settlement) return;
    fetchBankTransferReceipts(settlement.period_id).then(setBankReceipts);
  }, [settlement]);

  if (!settlement || !plan) return <div className="empty">No settlement yet.</div>;

  return (
    <div className="screen screen--settle">
      <header className="page-header"><h1 className="large-title">Settle</h1></header>

      <section className="balance-summary settle-summary" aria-labelledby="settle-summary-heading">
        <div className="settle-summary-top"><div><p className="summary-label" id="settle-summary-heading">Settlement</p><p className="summary-caption">{fmt(settlement.total_cents)} total</p></div><span className="settle-summary-icon" aria-hidden="true"><HandCoins /></span></div>
        <p className="summary-amount">{fmt(settlement.per_person_cents)}</p>
        <p className="summary-caption">per person</p>
      </section>

      <section className="content-section" aria-labelledby="contribute-heading">
        <div className="section-heading"><h2 id="contribute-heading">1. Send equal share</h2><span>{fmt(settlement.per_person_cents)} each</span></div>
        <ul className="grouped-list settle-transfer-list">{plan.contributions.map((payment, index) => {
          const isComplete = hasBankReceipt(payment, "contribute", bankReceipts);
          return <li className={`list-row settle-transfer-row${isComplete ? " settled" : ""}`} key={payment.id} style={{ animationDelay: `${index * 55}ms` }}>
            <ProfileAvatar name={firstName(payment.from)} />
            <div className="row-main"><span className="row-title">{payment.self ? `${firstName(payment.from)} → Grocery` : `${firstName(payment.from)} → ${firstName(payment.to)}`}</span><span className={`row-sub settle-proof-status${isComplete ? " verified" : ""}`}>{isComplete ? <><Check aria-hidden="true" /> Verified</> : <><span className="settle-pending-dot" aria-hidden="true" />Pending</>}</span></div>
            <div className="settle-transfer-action"><strong className="row-amount">{fmt(payment.cents)}</strong></div>
          </li>;
        })}</ul>
      </section>

      <section className="content-section" aria-labelledby="reimburse-heading">
        <div className="section-heading"><h2 id="reimburse-heading">2. Reimburse spending</h2><span>{firstName(plan.coordinator)}</span></div>
        <ul className="grouped-list settle-transfer-list">{plan.reimbursements.map((payment, index) => {
          const isComplete = hasBankReceipt(payment, "reimburse", bankReceipts);
          return <li className={`list-row settle-transfer-row${isComplete ? " settled" : ""}`} key={payment.id} style={{ animationDelay: `${index * 55}ms` }}>
            <ProfileAvatar name={firstName(payment.to)} />
            <div className="row-main"><span className="row-title">{payment.self ? `Grocery → ${firstName(payment.to)}` : `${firstName(payment.from)} → ${firstName(payment.to)}`}</span><span className={`row-sub settle-proof-status${isComplete ? " verified" : ""}`}>{isComplete ? <><Check aria-hidden="true" /> Verified</> : <><span className="settle-pending-dot" aria-hidden="true" />Pending</>}</span></div>
            <div className="settle-transfer-action"><strong className="row-amount">{fmt(payment.cents)}</strong></div>
          </li>;
        })}</ul>
      </section>

      <section className="content-section" aria-labelledby="settlement-cycle-heading"><div className="section-heading"><h2 id="settlement-cycle-heading">Settlement cycle</h2></div><div className="settle-cycle-card"><ReceiptText aria-hidden="true" /><div><strong>{currentPeriod ? `${formatDate(currentPeriod.start_date)} – ${formatDate(currentPeriod.end_date)}` : "Current period"}</strong><span>{settlement.receipt_count} receipts · {fmt(settlement.total_cents)} household total</span></div></div></section>

      <section className="content-section" aria-labelledby="recent-payments-heading"><div className="section-heading"><h2 id="recent-payments-heading">Recent repayments</h2></div>{bankReceipts.length ? <ul className="grouped-list">{bankReceipts.slice(0, 5).map((receipt) => <li className="list-row" key={receipt.id}><span className="settle-paid-icon"><ArrowDownToLine aria-hidden="true" /></span><div className="row-main"><span className="row-title">{firstName(receipt.from_name)} paid {firstName(receipt.to_name)}</span><span className="row-sub">Bank receipt · {formatDate(receipt.transfer_date)}</span></div><strong className="row-amount">{fmt(receipt.amount_cents)}</strong></li>)}</ul> : <div className="empty-state compact-empty">Bank transfer receipts will appear here after they are added to Supabase.</div>}</section>
    </div>
  );
}
