import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Check, CircleX, Clock3, HandCoins, Image, ReceiptText, ShieldCheck, ShieldQuestion } from "lucide-react";
import { fmt, memberNameKey, type BankTransferReceipt, type Period, type Receipt, type Settlement } from "../api";
import { EvidenceDetailPage, type EvidenceDetails } from "../components/EvidenceViewer";
import { formatDate } from "../components/format";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { useTransferEvidence } from "../components/useTransferEvidence";
import { cycleStatusFor, cycleStatusLabel } from "../cycleStatus";
import { equalShareRoundingRemainder, obligationsViewState, reviewedPaymentPlan } from "../settlementLifecycle";
import { assignBankReceipts, transferEvidenceState, type ExpectedPayment } from "../settlementMatching";

type PaymentDisplayState = "recorded" | "awaiting_receipt" | "pending" | "verified" | "rejected" | "unknown" | "loading";

function firstName(value: string | null | undefined) {
  const name = (value ?? "").trim();
  return name.split(/\s+/)[0] || "Unknown";
}

function evidenceStatus(receipt: BankTransferReceipt) {
  const state = transferEvidenceState(receipt);
  if (state === "verified") return { state, label: "Verified" };
  if (state === "rejected") return { state, label: "Rejected" };
  if (state === "pending") return { state, label: "Pending verification" };
  return { state, label: "Unknown verification" };
}

function paymentDisplayState(
  payment: ExpectedPayment,
  receipt: BankTransferReceipt | undefined,
  loading: boolean,
  unavailable: boolean,
): PaymentDisplayState {
  if (payment.self) return "recorded";
  if (loading) return "loading";
  if (unavailable) return "unknown";
  if (!payment.stepId) return "unknown";
  if (!receipt) return "awaiting_receipt";
  return transferEvidenceState(receipt);
}

function PaymentStatus({ state }: { state: PaymentDisplayState }) {
  if (state === "recorded") return <><Check aria-hidden="true" /> Recorded in grocery account</>;
  if (state === "loading") return <><span className="settle-status-spinner" aria-hidden="true" />Checking evidence</>;
  if (state === "awaiting_receipt") return <><Clock3 aria-hidden="true" />Awaiting receipt</>;
  if (state === "pending") return <><Image aria-hidden="true" />Pending verification</>;
  if (state === "verified") return <><ShieldCheck aria-hidden="true" />Verified</>;
  if (state === "rejected") return <><CircleX aria-hidden="true" />Rejected</>;
  return <><ShieldQuestion aria-hidden="true" />Receipt link unknown</>;
}

export function SettleTab({ settlement, periods, period, memberAvatarUrls = {} }: {
  settlement: Settlement | null;
  periods: Period[];
  period?: Period;
  memberAvatarUrls?: Record<string, string>;
}) {
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceDetails | null>(null);
  const savedScrollY = useRef<number | null>(null);
  const currentPeriod = period || periods.find((candidate) => candidate.id === settlement?.period_id) || periods.find((candidate) => candidate.status === "CURRENT") || periods[0];
  const periodId = currentPeriod?.id ?? settlement?.period_id ?? null;
  const cycleStatus = currentPeriod ? cycleStatusFor(currentPeriod) : "ACTIVE";
  const obligationsState = obligationsViewState(cycleStatus, settlement);
  const reviewedPlan = useMemo(() => reviewedPaymentPlan(settlement), [settlement]);
  const plan = obligationsState === "CONFIRMED" ? reviewedPlan : null;
  const evidence = useTransferEvidence(periodId, settlement?.calculated_at);
  const assignments = useMemo(
    () => plan ? assignBankReceipts([...plan.contributions, ...plan.reimbursements], evidence.bankReceipts) : new Map<string, BankTransferReceipt>(),
    [evidence.bankReceipts, plan],
  );
  const totalCents = settlement?.total_cents ?? currentPeriod?.total_cents ?? 0;
  const perPersonCents = settlement?.per_person_cents ?? currentPeriod?.per_person_cents ?? 0;
  const receiptCount = settlement?.receipt_count ?? currentPeriod?.receipt_count ?? 0;
  const roundingRemainder = equalShareRoundingRemainder(settlement);
  const avatarFor = (name: string) => memberAvatarUrls[memberNameKey(name)];

  useEffect(() => {
    setSelectedEvidence(null);
    savedScrollY.current = null;
  }, [periodId]);

  function openTransfer(receipt: BankTransferReceipt) {
    if (!receipt.receipt_url) return;
    savedScrollY.current = window.scrollY;
    const status = evidenceStatus(receipt).label;
    setSelectedEvidence({
      locator: receipt.receipt_url,
      kind: "Bank transfer",
      title: `${firstName(receipt.from_name)} → ${firstName(receipt.to_name)}`,
      subtitle: `${formatDate(receipt.transfer_date)} · ${status}`,
      amount: fmt(receipt.amount_cents),
      facts: [
        { label: "From", value: receipt.from_name || "Unknown" },
        { label: "To", value: receipt.to_name || "Unknown" },
        { label: "Amount", value: fmt(receipt.amount_cents) },
        { label: "Verification", value: status },
        { label: "Settlement", value: receipt.period_id },
        { label: "Step ID", value: receipt.step_id },
      ],
    });
  }

  function openWhatsAppEvidence(receipt: Receipt) {
    if (!receipt.image_url) return;
    savedScrollY.current = window.scrollY;
    setSelectedEvidence({
      locator: receipt.image_url,
      kind: "Bank transfer",
      title: `${firstName(receipt.payer)} · Needs review`,
      subtitle: formatDate(receipt.date),
      amount: "Unverified",
      facts: [
        { label: "Sender", value: receipt.payer || "Unknown" },
        { label: "Captured", value: formatDate(receipt.date) },
        { label: "Review status", value: "Unassigned evidence — not verified" },
        { label: "Settlement", value: receipt.period_id },
        { label: "WhatsApp message ID", value: receipt.id },
      ],
    });
  }

  useLayoutEffect(() => {
    if (selectedEvidence) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    if (savedScrollY.current === null) return;
    const top = savedScrollY.current;
    savedScrollY.current = null;
    window.scrollTo({ top, behavior: "instant" });
  }, [selectedEvidence]);

  function transferKeyDown(event: React.KeyboardEvent, receipt: BankTransferReceipt) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openTransfer(receipt);
    }
  }

  function paymentRow(payment: ExpectedPayment, index: number) {
    const bankReceipt = assignments.get(payment.id);
    const state = paymentDisplayState(payment, bankReceipt, evidence.loading, Boolean(evidence.error));
    const hasImage = Boolean(bankReceipt?.receipt_url);
    const subject = payment.stage === "contribute" ? payment.from : payment.to;
    const title = payment.stage === "contribute"
      ? payment.self ? `${firstName(payment.from)} · Grocery account` : `${firstName(payment.from)} → Arjun · Grocery`
      : payment.self ? `Grocery account · ${firstName(payment.to)} retained` : `Grocery → ${firstName(payment.to)}`;
    return (
      <li
        className={`list-row settle-transfer-row payment-state-${state}${hasImage ? " evidence-row" : ""}`}
        key={payment.id}
        style={{ animationDelay: `${index * 55}ms` }}
        role={hasImage ? "button" : undefined}
        tabIndex={hasImage ? 0 : undefined}
        onClick={() => bankReceipt && openTransfer(bankReceipt)}
        onKeyDown={(event) => bankReceipt && transferKeyDown(event, bankReceipt)}
      >
        <ProfileAvatar name={subject} src={avatarFor(subject)} />
        <div className="row-main"><span className="row-title">{title}</span><span className={`row-sub settle-proof-status ${state}`}><PaymentStatus state={state} /></span></div>
        <div className="settle-transfer-action"><strong className="row-amount">{fmt(payment.cents)}</strong>{hasImage && <Image aria-label="View matched bank transfer image" />}</div>
      </li>
    );
  }

  if (selectedEvidence) return <EvidenceDetailPage evidence={selectedEvidence} onBack={() => setSelectedEvidence(null)} />;

  const awaitingCopy = obligationsState === "SETTLED_WITHOUT_BREAKDOWN"
    ? "Historical payment obligations are unavailable. This settled marker does not verify individual transfers."
    : "Awaiting a reviewed settlement calculation. No payment amounts or transfer instructions have been created.";

  return (
    <div className="screen screen--settle">
      <header className="page-header"><h1 className="large-title">Settle</h1></header>

      <section className="balance-summary settle-summary simple-settle-summary" aria-labelledby="settle-summary-heading">
        <div className="home-summary-top"><div><p className="summary-label" id="settle-summary-heading">{cycleStatus === "ACTIVE" ? "Current spending" : "Settlement"}</p><span className={`summary-status cycle-badge--${cycleStatus.toLocaleLowerCase()}`}>{cycleStatusLabel(cycleStatus)}</span></div><span className="home-summary-icon" aria-hidden="true"><HandCoins /></span></div>
        <p className="summary-amount">{fmt(perPersonCents)}</p>
        <p className="summary-caption">{cycleStatus === "ACTIVE" ? "estimated equal share" : "equal share per person"}</p>
        <dl className="summary-details"><div><dt>Household total</dt><dd>{fmt(totalCents)}</dd></div><div><dt>Receipts</dt><dd>{receiptCount}</dd></div></dl>
      </section>

      {evidence.error && <div className="settle-transfer-alert" role="alert"><span>{evidence.error} No payments are being treated as verified.</span><button type="button" onClick={evidence.retry}>Retry</button></div>}

      {plan ? <>
        <section className="content-section" aria-labelledby="contribute-heading"><div className="section-heading"><h2 id="contribute-heading">1. {cycleStatus === "SETTLED" ? "Equal shares" : "Send equal share"}</h2><span>{cycleStatus === "SETTLED" ? "Completed" : `${fmt(perPersonCents)} each`}</span></div><p className="settle-explainer">{cycleStatus === "SETTLED" ? "This completed cycle recorded reviewed equal shares through Arjun’s designated grocery account." : "Each member’s reviewed equal share goes to Arjun’s designated grocery account. Arjun’s own share is recorded without a self-transfer."}</p><ul className="grouped-list settle-transfer-list">{plan.contributions.map(paymentRow)}</ul>{roundingRemainder !== 0 && <p className="settle-explainer rounding-note">{fmt(Math.abs(roundingRemainder))} rounding remainder stays in the grocery ledger. No extra transfer is required.</p>}</section>
        <section className="content-section" aria-labelledby="reimburse-heading"><div className="section-heading"><h2 id="reimburse-heading">2. {cycleStatus === "SETTLED" ? "Spending reimbursements" : "Reimburse spending"}</h2><span>{cycleStatus === "SETTLED" ? "Completed" : "Receipt totals"}</span></div><p className="settle-explainer">{cycleStatus === "SETTLED" ? "The reviewed grocery-account reimbursements are preserved from this completed cycle." : "The grocery account returns each member’s reviewed grocery spending. Arjun’s own reimbursement is retained in the grocery account."}</p><ul className="grouped-list settle-transfer-list">{plan.reimbursements.map(paymentRow)}</ul></section>
      </> : <section className="content-section" aria-labelledby="breakdown-heading"><div className="section-heading"><h2 id="breakdown-heading">{obligationsState === "SETTLED_WITHOUT_BREAKDOWN" ? "Completed settlement" : "Payment breakdown"}</h2><span>{obligationsState === "SETTLED_WITHOUT_BREAKDOWN" ? "Breakdown unavailable" : "Awaiting calculation"}</span></div><div className="settlement-step-placeholder"><div><strong><span>1</span>Send equal share</strong><p>Transfers to the grocery account will appear after obligations are reviewed.</p></div><div><strong><span>2</span>Reimburse spending</strong><p>Member reimbursements will appear after obligations are reviewed.</p></div><footer>{awaitingCopy}</footer></div></section>}

      <section className="content-section" aria-labelledby="settlement-cycle-heading"><div className="section-heading"><h2 id="settlement-cycle-heading">Settlement cycle</h2></div><div className="settle-cycle-card"><ReceiptText aria-hidden="true" /><div><strong>{currentPeriod ? `${formatDate(currentPeriod.start_date)} – ${cycleStatus === "SETTLED" ? formatDate(currentPeriod.end_date) : "Open"}` : "Current period"}</strong><span>{receiptCount} receipts · {fmt(totalCents)} household total</span><dl className="cycle-facts"><div><dt>Cycle status</dt><dd>{cycleStatusLabel(cycleStatus)}</dd></div><div><dt>Payment obligations</dt><dd>{settlement?.payment_obligations_status || "Unavailable"}</dd></div><div><dt>Evidence records</dt><dd>{evidence.bankReceipts.length + evidence.whatsAppEvidence.length}</dd></div><div><dt>Clearance</dt><dd>{currentPeriod?.whatsapp_clearance_message ? "Received" : "Not received"}</dd></div></dl></div></div></section>

      {evidence.whatsAppEvidence.length > 0 && <section className="content-section" aria-labelledby="unassigned-evidence-heading"><div className="section-heading"><h2 id="unassigned-evidence-heading">Unassigned transfer evidence</h2><span>Needs review</span></div><ul className="grouped-list">{evidence.whatsAppEvidence.map((receipt) => <li className={`list-row${receipt.image_url ? " evidence-row" : ""}`} key={receipt.id} role={receipt.image_url ? "button" : undefined} tabIndex={receipt.image_url ? 0 : undefined} onClick={() => openWhatsAppEvidence(receipt)} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && receipt.image_url) { event.preventDefault(); openWhatsAppEvidence(receipt); } }}><span className="settle-paid-icon unassigned"><ShieldQuestion aria-hidden="true" /></span><div className="row-main"><span className="row-title">Evidence from {firstName(receipt.payer)}</span><span className="row-sub settle-proof-status pending">Unassigned · Not verified</span></div><span className="evidence-row-tail">{receipt.image_url && <Image aria-label="View transfer evidence" />}</span></li>)}</ul></section>}

      <section className="content-section" aria-labelledby="transfer-evidence-heading"><div className="section-heading"><h2 id="transfer-evidence-heading">Bank-transfer evidence</h2><span>{currentPeriod ? formatDate(currentPeriod.start_date) : "Current period"}</span></div>{evidence.loading ? <div className="empty-state compact-empty transfer-loading"><span className="settle-status-spinner" aria-hidden="true" />Checking bank transfers…</div> : evidence.error && !evidence.bankReceipts.length ? <div className="empty-state compact-empty">Transfer evidence is unavailable. Payment status remains unknown.</div> : evidence.bankReceipts.length ? <ul className="grouped-list">{evidence.bankReceipts.map((receipt) => { const status = evidenceStatus(receipt); return <li className={`list-row${receipt.receipt_url ? " evidence-row" : ""}`} key={receipt.id} role={receipt.receipt_url ? "button" : undefined} tabIndex={receipt.receipt_url ? 0 : undefined} onClick={() => openTransfer(receipt)} onKeyDown={(event) => transferKeyDown(event, receipt)}><span className={`settle-paid-icon ${status.state}`}><ArrowDownToLine aria-hidden="true" /></span><div className="row-main"><span className="row-title">{firstName(receipt.from_name)} → {firstName(receipt.to_name)}</span><span className={`row-sub settle-proof-status ${status.state}`}>{status.label} · {formatDate(receipt.transfer_date)}</span><span className="row-sub evidence-step-id">Step {receipt.step_id}</span></div><span className="evidence-row-tail"><strong className="row-amount">{fmt(receipt.amount_cents)}</strong>{receipt.receipt_url && <Image aria-label="View bank transfer image" />}</span></li>; })}</ul> : <div className="empty-state compact-empty">No bank-transfer evidence is linked to this settlement period.</div>}</section>
    </div>
  );
}
