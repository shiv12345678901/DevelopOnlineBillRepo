import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Check, Clock3, HandCoins, Image, ReceiptText, ShieldQuestion } from "lucide-react";
import { fetchBankTransferReceipts, fetchWhatsAppTransferEvidence, fmt, memberNameKey, type BankTransferReceipt, type Period, type Receipt, type Settlement } from "../api";
import { EvidenceDetailPage, type EvidenceDetails } from "../components/EvidenceViewer";
import { formatDate } from "../components/format";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { cycleStatusFor, cycleStatusLabel } from "../cycleStatus";
import { confirmedEqualShares, confirmedObligations, equalShareRoundingRemainder, obligationsViewState, provisionalShareDifference } from "../settlementLifecycle";

function firstName(value: string | null | undefined) {
  const name = (value ?? "").trim();
  return name.split(/\s+/)[0] || "Unknown";
}

function isCoordinator(value: string) {
  return firstName(value).toLocaleLowerCase() === "arjun";
}

function evidenceStatus(receipt: BankTransferReceipt) {
  if (receipt.verification_status === "verified") return { label: "Verified", className: "verified" };
  if (receipt.verification_status === "rejected") return { label: "Rejected", className: "rejected" };
  return { label: "Pending verification", className: "pending" };
}

export function SettleTab({ settlement, periods, period, memberAvatarUrls = {} }: {
  settlement: Settlement | null;
  periods: Period[];
  period?: Period;
  memberAvatarUrls?: Record<string, string>;
}) {
  const [bankReceipts, setBankReceipts] = useState<BankTransferReceipt[]>([]);
  const [whatsAppEvidence, setWhatsAppEvidence] = useState<Receipt[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(true);
  const [transferError, setTransferError] = useState("");
  const [transferReloadKey, setTransferReloadKey] = useState(0);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceDetails | null>(null);
  const savedScrollY = useRef<number | null>(null);
  const currentPeriod = period || periods.find((candidate) => candidate.id === settlement?.period_id) || periods.find((candidate) => candidate.status === "CURRENT") || periods[0];
  const periodId = currentPeriod?.id ?? settlement?.period_id ?? null;
  const cycleStatus = currentPeriod ? cycleStatusFor(currentPeriod) : "ACTIVE";
  const isHistoricalSettlement = cycleStatus === "SETTLED";
  const obligations = useMemo(() => confirmedObligations(settlement), [settlement]);
  const equalShares = useMemo(() => confirmedEqualShares(settlement), [settlement]);
  const roundingRemainder = equalShareRoundingRemainder(settlement);
  const obligationsState = obligationsViewState(cycleStatus, settlement);
  const contributions = Object.entries(settlement?.member_totals || {});
  const memberNames = contributions.map(([name]) => name).slice(0, 4);
  const totalCents = settlement?.total_cents ?? currentPeriod?.total_cents ?? 0;
  const perPersonCents = settlement?.per_person_cents ?? currentPeriod?.per_person_cents ?? 0;
  const receiptCount = settlement?.receipt_count ?? currentPeriod?.receipt_count ?? 0;
  const avatarFor = (name: string) => memberAvatarUrls[memberNameKey(name)];

  useEffect(() => {
    setSelectedEvidence(null);
    savedScrollY.current = null;
    setBankReceipts([]);
    setWhatsAppEvidence([]);
    setTransferError("");
    if (!periodId) {
      setTransfersLoading(false);
      return;
    }
    let cancelled = false;
    setTransfersLoading(true);
    Promise.allSettled([fetchBankTransferReceipts(periodId), fetchWhatsAppTransferEvidence(periodId)])
      .then(([payments, evidence]) => {
        if (cancelled) return;
        if (payments.status === "fulfilled") setBankReceipts(payments.value);
        if (evidence.status === "fulfilled") setWhatsAppEvidence(evidence.value);
        const failure = payments.status === "rejected" ? payments.reason : evidence.status === "rejected" ? evidence.reason : null;
        if (failure) {
          const detail = failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Please try again.";
          setTransferError(`Couldn’t load all bank-transfer evidence. ${detail}`);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        const detail = error && typeof error === "object" && "message" in error ? String(error.message) : "Please try again.";
        setTransferError(`Couldn’t load bank-transfer evidence. ${detail}`);
      })
      .finally(() => { if (!cancelled) setTransfersLoading(false); });
    return () => { cancelled = true; };
  }, [periodId, transferReloadKey]);

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

  if (selectedEvidence) return <EvidenceDetailPage evidence={selectedEvidence} onBack={() => setSelectedEvidence(null)} />;

  return (
    <div className="screen screen--settle">
      <header className="page-header"><h1 className="large-title">Settle</h1></header>

      <section className="balance-summary home-balance settle-summary" aria-labelledby="settle-summary-heading">
        <div className="home-summary-top"><div><p className="summary-label" id="settle-summary-heading">{cycleStatus === "ACTIVE" ? "Provisional household spending" : "Settlement"}</p><span className={`summary-status cycle-badge--${cycleStatus.toLocaleLowerCase()}`}>{cycleStatusLabel(cycleStatus)}</span></div><span className="home-summary-icon" aria-hidden="true"><HandCoins /></span></div>
        {memberNames.length ? <>
          <div className="share-orbit" aria-label={`Household total ${fmt(totalCents)} split between ${memberNames.length} people`}>
            <span className="share-orbit-ring" aria-hidden="true" />
            <span className="share-orbit-center"><span>Household spending</span><strong>{fmt(totalCents)}</strong></span>
            <span className="share-orbit-track" role="list">{memberNames.map((name, index) => <span className={`share-orbit-node orbit-node-${index}`} role="listitem" aria-label={`${firstName(name)} estimated equal share ${fmt(perPersonCents)}`} key={name}><span className="share-orbit-node-inner"><span className="share-orbit-node-shell"><ProfileAvatar name={firstName(name)} src={avatarFor(name)} /></span><span className="share-orbit-copy"><span>{firstName(name)}</span><strong>{fmt(perPersonCents)}</strong></span></span></span>)}</span>
          </div>
          <p className="share-orbit-caption">{cycleStatus === "ACTIVE" ? "Estimated " : ""}{fmt(perPersonCents)} equal share per person</p>
        </> : <div className="settle-empty-summary"><strong>{fmt(totalCents)}</strong><span>No member contributions recorded yet</span></div>}
      </section>

      {transferError && <div className="settle-transfer-alert" role="alert"><span>{transferError} Verification status is unavailable.</span><button type="button" onClick={() => setTransferReloadKey((key) => key + 1)}>Retry</button></div>}

      {obligationsState === "PROVISIONAL" && <section className="content-section" aria-labelledby="provisional-heading"><div className="section-heading"><h2 id="provisional-heading">Provisional balances</h2><span>Not payment instructions</span></div>{contributions.length ? <ul className="grouped-list">{contributions.map(([name, amount], index) => { const difference = provisionalShareDifference(perPersonCents, amount); return <li className="list-row stagger" style={{ animationDelay: `${index * 55}ms` }} key={name}><ProfileAvatar name={name} src={avatarFor(name)} /><div className="row-main"><span className="row-title">{name}</span><span className="row-sub">Contributed {fmt(amount)} · estimated equal share {fmt(perPersonCents)}</span></div><strong className="row-amount">{difference > 0 ? `${fmt(difference)} below` : difference < 0 ? `${fmt(-difference)} above` : "Equal"}</strong></li>; })}</ul> : <div className="empty-state compact-empty">Receipts and contributions will appear here as the active cycle grows.</div>}<p className="settle-explainer">These figures compare spending with an estimated equal share. They are not confirmed amounts to transfer.</p></section>}

      {obligationsState === "CONFIRMED" && <>
        <section className="content-section" aria-labelledby="collect-heading"><div className="section-heading"><h2 id="collect-heading">1. {isHistoricalSettlement ? "Equal shares" : "Send equal share"}</h2><span>{isHistoricalSettlement ? "Completed" : "Confirmed"}</span></div><p className="settle-explainer">{isHistoricalSettlement ? "This completed cycle recorded equal shares through Arjun’s designated grocery account." : "Household members send the confirmed equal share to Arjun’s designated grocery account. Arjun’s own contribution is recorded without requiring a self-transfer."}</p><ul className="grouped-list">{equalShares.map((obligation) => <li className="list-row" key={obligation.member}><ProfileAvatar name={obligation.member} src={avatarFor(obligation.member)} /><div className="row-main"><span className="row-title">{isCoordinator(obligation.member) ? `${firstName(obligation.member)} · Grocery account` : `${firstName(obligation.member)} → Arjun · Grocery`}</span><span className="row-sub">{isHistoricalSettlement ? "Historical equal-share obligation" : isCoordinator(obligation.member) ? "Record contribution · no self-transfer required" : "Confirmed equal-share obligation"}</span></div><strong className="row-amount">{fmt(obligation.amountCents)}</strong></li>)}</ul>{roundingRemainder !== 0 && <p className="settle-explainer rounding-note">{fmt(Math.abs(roundingRemainder))} rounding remainder stays in the grocery ledger. No extra transfer is required.</p>}</section>
        <section className="content-section" aria-labelledby="reimburse-heading"><div className="section-heading"><h2 id="reimburse-heading">2. {isHistoricalSettlement ? "Spending reimbursements" : "Reimburse spending"}</h2><span>{isHistoricalSettlement ? "Completed" : "Receipt totals"}</span></div><p className="settle-explainer">{isHistoricalSettlement ? "The grocery account reimbursement record is preserved from this completed cycle." : "The grocery account returns each person’s recorded grocery spending."}</p><ul className="grouped-list">{contributions.filter(([, amount]) => amount > 0).map(([name, amount]) => <li className="list-row" key={name}><ProfileAvatar name={name} src={avatarFor(name)} /><div className="row-main"><span className="row-title">Grocery → {firstName(name)}</span><span className="row-sub">Recorded receipt total</span></div><strong className="row-amount">{fmt(amount)}</strong></li>)}</ul></section>
      </>}

      {obligationsState === "PENDING" && <section className="content-section" aria-labelledby="obligations-pending-heading"><div className="section-heading"><h2 id="obligations-pending-heading">Payment obligations</h2><span>Pending</span></div><div className="obligations-state-card"><Clock3 aria-hidden="true" /><div><strong>Confirmed amounts are not available yet</strong><span>The settlement is awaiting authoritative payment obligations. No transfer amounts have been inferred from spending.</span></div></div></section>}

      {obligationsState === "SETTLED_WITHOUT_BREAKDOWN" && <section className="content-section" aria-labelledby="settled-heading"><div className="section-heading"><h2 id="settled-heading">Completed settlement</h2><span>Settled</span></div><div className="obligations-state-card settled"><Check aria-hidden="true" /><div><strong>This cycle was cleared</strong><span>The historical obligation breakdown is unavailable. Empty or missing obligations are not being treated as proof that individual payments were made.</span></div></div></section>}

      <section className="content-section" aria-labelledby="settlement-cycle-heading"><div className="section-heading"><h2 id="settlement-cycle-heading">Settlement cycle</h2></div><div className="settle-cycle-card"><ReceiptText aria-hidden="true" /><div><strong>{currentPeriod ? `${formatDate(currentPeriod.start_date)} – ${cycleStatus === "SETTLED" ? formatDate(currentPeriod.end_date) : "Open"}` : "Current period"}</strong><span>{receiptCount} receipts · {fmt(totalCents)} household total</span><dl className="cycle-facts"><div><dt>Cycle status</dt><dd>{cycleStatusLabel(cycleStatus)}</dd></div><div><dt>Settlement calculation</dt><dd>{currentPeriod?.whatsapp_calculation_message ? "Received" : "Not available"}</dd></div><div><dt>Payment obligations</dt><dd>{settlement?.payment_obligations_status || (obligations.length ? "Available" : "Unavailable")}</dd></div><div><dt>Bank-transfer evidence</dt><dd>{bankReceipts.length + whatsAppEvidence.length} item{bankReceipts.length + whatsAppEvidence.length === 1 ? "" : "s"}</dd></div><div><dt>Final clearance</dt><dd>{currentPeriod?.whatsapp_clearance_message ? `${currentPeriod.whatsapp_clearance_message.text || "Received"}${currentPeriod.whatsapp_clearance_message.timeStr ? ` · ${currentPeriod.whatsapp_clearance_message.timeStr}` : ""}` : "Not received"}</dd></div></dl></div></div></section>

      {whatsAppEvidence.length > 0 && <section className="content-section" aria-labelledby="unassigned-evidence-heading"><div className="section-heading"><h2 id="unassigned-evidence-heading">Unassigned transfer evidence</h2><span>Needs review</span></div><ul className="grouped-list">{whatsAppEvidence.map((receipt) => <li className={`list-row${receipt.image_url ? " evidence-row" : ""}`} key={receipt.id} role={receipt.image_url ? "button" : undefined} tabIndex={receipt.image_url ? 0 : undefined} onClick={() => openWhatsAppEvidence(receipt)} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && receipt.image_url) { event.preventDefault(); openWhatsAppEvidence(receipt); } }}><span className="settle-paid-icon unassigned"><ShieldQuestion aria-hidden="true" /></span><div className="row-main"><span className="row-title">Evidence from {firstName(receipt.payer)}</span><span className="row-sub settle-proof-status pending">Unassigned · Not verified</span></div><span className="evidence-row-tail">{receipt.image_url && <Image aria-label="View transfer evidence" />}</span></li>)}</ul></section>}

      <section className="content-section" aria-labelledby="transfer-evidence-heading"><div className="section-heading"><h2 id="transfer-evidence-heading">Bank-transfer evidence</h2></div>{transfersLoading ? <div className="empty-state compact-empty transfer-loading"><span className="settle-status-spinner" aria-hidden="true" />Checking bank transfers…</div> : transferError && !bankReceipts.length ? <div className="empty-state compact-empty">Transfer evidence is temporarily unavailable.</div> : bankReceipts.length ? <ul className="grouped-list">{bankReceipts.map((receipt) => { const status = evidenceStatus(receipt); return <li className={`list-row${receipt.receipt_url ? " evidence-row" : ""}`} key={receipt.id} role={receipt.receipt_url ? "button" : undefined} tabIndex={receipt.receipt_url ? 0 : undefined} onClick={() => openTransfer(receipt)} onKeyDown={(event) => transferKeyDown(event, receipt)}><span className={`settle-paid-icon ${status.className}`}><ArrowDownToLine aria-hidden="true" /></span><div className="row-main"><span className="row-title">{firstName(receipt.from_name)} → {firstName(receipt.to_name)}</span><span className={`row-sub settle-proof-status ${status.className}`}>{status.label} · {formatDate(receipt.transfer_date)}</span></div><span className="evidence-row-tail"><strong className="row-amount">{fmt(receipt.amount_cents)}</strong>{receipt.receipt_url && <Image aria-label="View bank transfer image" />}</span></li>; })}</ul> : <div className="empty-state compact-empty">No bank-transfer evidence has been recorded for this period.</div>}</section>
    </div>
  );
}
