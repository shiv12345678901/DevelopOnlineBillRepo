import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Check, HandCoins, Image, ReceiptText } from "lucide-react";
import { fetchBankTransferReceipts, fmt, memberNameKey, type BankTransferReceipt, type Period, type Settlement } from "../api";
import { EvidenceDetailPage, type EvidenceDetails } from "../components/EvidenceViewer";
import { formatDate } from "../components/format";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { assignBankReceipts, type ExpectedPayment } from "../settlementMatching";

type Payment = ExpectedPayment;

function firstName(value: string | null | undefined) {
  const name = (value ?? "").trim();
  return name.split(/\s+/)[0] || "Unknown";
}

function getCoordinator(memberNames: string[]) {
  return memberNames.find((name) => name.toLocaleLowerCase().includes("arjun")) || memberNames[0] || "Coordinator";
}

function buildPlan(settlement: Settlement) {
  const spending = Object.entries(settlement.member_totals || {});
  const coordinator = getCoordinator(spending.map(([name]) => name));
  const contributions = spending.map(([name]) => ({
    id: `contribute-${name}`,
    from: name,
    to: coordinator,
    cents: settlement.per_person_cents,
    stage: "contribute" as const,
    self: name === coordinator,
  }));
  const reimbursements = spending.map(([name, cents]) => ({
    id: `reimburse-${name}`,
    from: coordinator,
    to: name,
    cents,
    stage: "reimburse" as const,
    self: name === coordinator,
  }));
  return { coordinator, contributions, reimbursements };
}

function TransferStatus({ complete, loading, unavailable }: { complete: boolean; loading: boolean; unavailable: boolean }) {
  if (loading) return <><span className="settle-status-spinner" aria-hidden="true" />Checking…</>;
  if (unavailable) return <>Unavailable</>;
  if (complete) return <><Check aria-hidden="true" /> Verified</>;
  return <><span className="settle-pending-dot" aria-hidden="true" />Pending</>;
}

export function SettleTab({ settlement, periods, memberAvatarUrls = {} }: { settlement: Settlement | null; periods: Period[]; memberAvatarUrls?: Record<string, string> }) {
  const [bankReceipts, setBankReceipts] = useState<BankTransferReceipt[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(true);
  const [transferError, setTransferError] = useState("");
  const [transferReloadKey, setTransferReloadKey] = useState(0);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceDetails | null>(null);
  const savedScrollY = useRef<number | null>(null);
  const plan = useMemo(() => settlement ? buildPlan(settlement) : null, [settlement]);
  const transferAssignments = useMemo(
    () => plan ? assignBankReceipts([...plan.contributions, ...plan.reimbursements], bankReceipts) : new Map<string, BankTransferReceipt>(),
    [bankReceipts, plan],
  );
  const currentPeriod = periods.find((period) => period.id === settlement?.period_id) || periods.find((period) => period.status === "CURRENT") || periods[0];
  const memberNames = Object.keys(settlement?.member_totals || {}).slice(0, 4);
  const avatarFor = (name: string) => memberAvatarUrls[memberNameKey(name)];
  useEffect(() => {
    if (!settlement) {
      setTransfersLoading(false);
      return;
    }
    let cancelled = false;
    setBankReceipts([]);
    setTransfersLoading(true);
    setTransferError("");
    fetchBankTransferReceipts(settlement.period_id)
      .then((receipts) => {
        if (!cancelled) setBankReceipts(receipts);
      })
      .catch((error) => {
        if (cancelled) return;
        const detail = error && typeof error === "object" && "message" in error ? String(error.message) : "Please try again.";
        setTransferError(`Couldn’t load bank transfers. ${detail}`);
      })
      .finally(() => {
        if (!cancelled) setTransfersLoading(false);
      });
    return () => { cancelled = true; };
  }, [settlement, transferReloadKey]);

  function openTransfer(receipt: BankTransferReceipt) {
    if (!receipt.receipt_url) return;
    savedScrollY.current = window.scrollY;
    setSelectedEvidence({
      locator: receipt.receipt_url,
      kind: "Bank transfer",
      title: `${firstName(receipt.from_name)} → ${firstName(receipt.to_name)}`,
      subtitle: formatDate(receipt.transfer_date),
      amount: fmt(receipt.amount_cents),
      facts: [
        { label: "From", value: receipt.from_name || "Unknown" },
        { label: "To", value: receipt.to_name || "Unknown" },
        { label: "Amount", value: fmt(receipt.amount_cents) },
        { label: "Transfer date", value: formatDate(receipt.transfer_date) },
        { label: "Settlement", value: receipt.period_id },
        { label: "Step ID", value: receipt.step_id },
        { label: "Transfer ID", value: receipt.id },
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

  if (!settlement || !plan) return <div className="empty">No settlement yet.</div>;
  if (selectedEvidence) return <EvidenceDetailPage evidence={selectedEvidence} onBack={() => setSelectedEvidence(null)} />;

  return (
    <div className="screen screen--settle">
      <header className="page-header"><h1 className="large-title">Settle</h1></header>

      <section className="balance-summary home-balance settle-summary" aria-labelledby="settle-summary-heading">
        <div className="home-summary-top"><p className="summary-label" id="settle-summary-heading">Settlement</p><span className="home-summary-icon" aria-hidden="true"><HandCoins /></span></div>
        <div className="share-orbit" aria-label={`Household total ${fmt(settlement.total_cents)} split between ${memberNames.length} people`}>
          <span className="share-orbit-ring" aria-hidden="true" />
          <span className="share-orbit-center">
            <span>Household total</span>
            <strong>{fmt(settlement.total_cents)}</strong>
          </span>
          <span className="share-orbit-track" role="list">
            {memberNames.map((name, index) => (
              <span className={`share-orbit-node orbit-node-${index}`} role="listitem" aria-label={`${firstName(name)} ${fmt(settlement.per_person_cents)}`} key={name}>
                <span className="share-orbit-node-inner">
                  <span className="share-orbit-node-shell"><ProfileAvatar name={firstName(name)} src={avatarFor(name)} /></span>
                  <span className="share-orbit-copy">
                    <span>{firstName(name)}</span>
                    <strong>{fmt(settlement.per_person_cents)}</strong>
                  </span>
                </span>
              </span>
            ))}
          </span>
        </div>
        <p className="share-orbit-caption">{fmt(settlement.per_person_cents)} per person</p>
      </section>

      {transferError && (
        <div className="settle-transfer-alert" role="alert">
          <span>{transferError} Verification status is unavailable.</span>
          <button type="button" onClick={() => setTransferReloadKey((key) => key + 1)}>Retry</button>
        </div>
      )}

      <section className="content-section" aria-labelledby="contribute-heading">
        <div className="section-heading"><h2 id="contribute-heading">1. Send equal share</h2><span>{fmt(settlement.per_person_cents)} each</span></div>
        <ul className="grouped-list settle-transfer-list">{plan.contributions.map((payment, index) => {
          const bankReceipt = transferAssignments.get(payment.id);
          const isComplete = Boolean(bankReceipt?.receipt_url);
          return <li className={`list-row settle-transfer-row${isComplete ? " settled" : ""}${bankReceipt?.receipt_url ? " evidence-row" : ""}`} key={payment.id} style={{ animationDelay: `${index * 55}ms` }} role={bankReceipt?.receipt_url ? "button" : undefined} tabIndex={bankReceipt?.receipt_url ? 0 : undefined} onClick={() => bankReceipt && openTransfer(bankReceipt)} onKeyDown={(event) => bankReceipt && transferKeyDown(event, bankReceipt)}>
            <ProfileAvatar name={firstName(payment.from)} src={avatarFor(payment.from)} />
            <div className="row-main"><span className="row-title">{payment.self ? `${firstName(payment.from)} → Grocery` : `${firstName(payment.from)} → ${firstName(payment.to)}`}</span><span className={`row-sub settle-proof-status${isComplete ? " verified" : ""}`}><TransferStatus complete={isComplete} loading={transfersLoading} unavailable={Boolean(transferError)} /></span></div>
            <div className="settle-transfer-action"><strong className="row-amount">{fmt(payment.cents)}</strong>{bankReceipt?.receipt_url && <Image aria-label="View bank transfer image" />}</div>
          </li>;
        })}</ul>
      </section>

      <section className="content-section" aria-labelledby="reimburse-heading">
        <div className="section-heading"><h2 id="reimburse-heading">2. Reimburse spending</h2><span>{firstName(plan.coordinator)}</span></div>
        <ul className="grouped-list settle-transfer-list">{plan.reimbursements.map((payment, index) => {
          const bankReceipt = transferAssignments.get(payment.id);
          const isComplete = Boolean(bankReceipt?.receipt_url);
          return <li className={`list-row settle-transfer-row${isComplete ? " settled" : ""}${bankReceipt?.receipt_url ? " evidence-row" : ""}`} key={payment.id} style={{ animationDelay: `${index * 55}ms` }} role={bankReceipt?.receipt_url ? "button" : undefined} tabIndex={bankReceipt?.receipt_url ? 0 : undefined} onClick={() => bankReceipt && openTransfer(bankReceipt)} onKeyDown={(event) => bankReceipt && transferKeyDown(event, bankReceipt)}>
            <ProfileAvatar name={firstName(payment.to)} src={avatarFor(payment.to)} />
            <div className="row-main"><span className="row-title">{payment.self ? `Grocery → ${firstName(payment.to)}` : `${firstName(payment.from)} → ${firstName(payment.to)}`}</span><span className={`row-sub settle-proof-status${isComplete ? " verified" : ""}`}><TransferStatus complete={isComplete} loading={transfersLoading} unavailable={Boolean(transferError)} /></span></div>
            <div className="settle-transfer-action"><strong className="row-amount">{fmt(payment.cents)}</strong>{bankReceipt?.receipt_url && <Image aria-label="View bank transfer image" />}</div>
          </li>;
        })}</ul>
      </section>

      <section className="content-section" aria-labelledby="settlement-cycle-heading"><div className="section-heading"><h2 id="settlement-cycle-heading">Settlement cycle</h2></div><div className="settle-cycle-card"><ReceiptText aria-hidden="true" /><div><strong>{currentPeriod ? `${formatDate(currentPeriod.start_date)} – ${formatDate(currentPeriod.end_date)}` : "Current period"}</strong><span>{settlement.receipt_count} receipts · {fmt(settlement.total_cents)} household total</span></div></div></section>

      <section className="content-section" aria-labelledby="recent-payments-heading"><div className="section-heading"><h2 id="recent-payments-heading">Recent repayments</h2></div>{transfersLoading ? <div className="empty-state compact-empty transfer-loading"><span className="settle-status-spinner" aria-hidden="true" />Checking bank transfers…</div> : transferError ? <div className="empty-state compact-empty">Transfer evidence is temporarily unavailable.</div> : bankReceipts.length ? <ul className="grouped-list">{bankReceipts.slice(0, 5).map((receipt) => <li className={`list-row${receipt.receipt_url ? " evidence-row" : ""}`} key={receipt.id} role={receipt.receipt_url ? "button" : undefined} tabIndex={receipt.receipt_url ? 0 : undefined} onClick={() => openTransfer(receipt)} onKeyDown={(event) => transferKeyDown(event, receipt)}><span className="settle-paid-icon"><ArrowDownToLine aria-hidden="true" /></span><div className="row-main"><span className="row-title">{firstName(receipt.from_name)} paid {firstName(receipt.to_name)}</span><span className="row-sub">Bank receipt · {formatDate(receipt.transfer_date)}</span></div><span className="evidence-row-tail"><strong className="row-amount">{fmt(receipt.amount_cents)}</strong>{receipt.receipt_url && <Image aria-label="View bank transfer image" />}</span></li>)}</ul> : <div className="empty-state compact-empty">Bank transfer receipts will appear here after they are added to Supabase.</div>}</section>
    </div>
  );
}
