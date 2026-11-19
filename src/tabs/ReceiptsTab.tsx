import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, CircleAlert, Image, SlidersHorizontal } from "lucide-react";
import { GlassInput, GlassSegmented } from "@zakisheriff/liquid-glass";
import { fetchDisabledSettlementReceipts, fetchSettlementCycleMembershipPermissions, fmt, type BankTransferReceipt, type Receipt, type WhatsAppBankTransferEvidence } from "../api";
import { formatDate } from "../components/format";
import { AppIcon } from "../components/AppIcon";
import type { EvidenceDetails } from "../components/EvidenceViewer";
import { MerchantIcon } from "../components/MerchantIcon";
import { useTransferEvidence } from "../components/useTransferEvidence";
import { transferEvidenceState } from "../settlementMatching";
import { MEMBERSHIP_FEATURE_ENABLED } from "../membership";

type ReceiptSection = "purchases" | "transfers" | "review";

function firstName(value: string | null | undefined) {
  return (value ?? "").trim().split(/\s+/)[0] || "Unknown";
}

function evidenceStatus(receipt: BankTransferReceipt) {
  const state = transferEvidenceState(receipt);
  if (state === "verified") return { state, label: "Verified" };
  if (state === "rejected") return { state, label: "Rejected" };
  if (state === "pending") return { state, label: "Pending verification" };
  return { state, label: "Unverified" };
}

function whatsappEvidenceStatus(status: WhatsAppBankTransferEvidence["review_status"]) {
  if (status === "reviewed") return "Reviewed";
  if (status === "dismissed") return "Dismissed";
  return "Pending review";
}

export function ReceiptsTab({ receipts, periodId, settlementCalculatedAt, onOpenEvidence }: {
  receipts: Receipt[];
  periodId: string | null;
  settlementCalculatedAt?: string | null;
  onOpenEvidence: (evidence: EvidenceDetails) => void;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [section, setSection] = useState<ReceiptSection>("purchases");
  const [disabledReceipts, setDisabledReceipts] = useState<Receipt[]>([]);
  const [disabledReceiptsError, setDisabledReceiptsError] = useState("");
  const transferEvidence = useTransferEvidence(periodId, settlementCalculatedAt);
  const visibleBankReceipts = transferEvidence.bankReceipts.filter((receipt) => transferEvidenceState(receipt) !== "pending");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const categories = useMemo(() => Array.from(new Set(receipts.map((receipt) => receipt.category).filter(Boolean))).sort(), [receipts]);
  const filteredReceipts = useMemo(() => {
    const filtered = receipts.filter((receipt) => {
      const matchesCategory = categoryFilter === "all" || receipt.category === categoryFilter;
      const matchesQuery = !normalizedQuery || [receipt.merchant, receipt.payer, receipt.category, receipt.date].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
      return matchesCategory && matchesQuery;
    });
    return [...filtered].sort((a, b) => {
      if (sortOrder === "oldest") return a.date.localeCompare(b.date);
      if (sortOrder === "amount-high") return b.amount_cents - a.amount_cents;
      if (sortOrder === "amount-low") return a.amount_cents - b.amount_cents;
      return b.date.localeCompare(a.date);
    });
  }, [categoryFilter, normalizedQuery, receipts, sortOrder]);
  const showGroups = !normalizedQuery && categoryFilter === "all" && sortOrder === "newest";
  const visibleReceipts = filteredReceipts;
  const hasPurchaseFilters = Boolean(normalizedQuery) || categoryFilter !== "all" || sortOrder !== "newest";
  const reviewItemCount = transferEvidence.whatsAppBankEvidence.length + disabledReceipts.length;
  const receiptsByDate = visibleReceipts.reduce<Map<string, Receipt[]>>((groups, receipt) => {
    const group = groups.get(receipt.date) || [];
    group.push(receipt);
    groups.set(receipt.date, group);
    return groups;
  }, new Map());

  useEffect(() => {
    setSection("purchases");
    setQuery("");
    setCategoryFilter("all");
    setSortOrder("newest");
  }, [periodId]);

  function clearPurchaseFilters() {
    setQuery("");
    setCategoryFilter("all");
    setSortOrder("newest");
  }

  useEffect(() => {
    let cancelled = false;
    setDisabledReceipts([]);
    setDisabledReceiptsError("");
    if (!MEMBERSHIP_FEATURE_ENABLED || !periodId) return () => { cancelled = true; };
    fetchSettlementCycleMembershipPermissions(periodId)
      .then((permissions) => permissions.can_review_disabled_receipts ? fetchDisabledSettlementReceipts(periodId) : [])
      .then((rows) => { if (!cancelled) setDisabledReceipts(rows); })
      .catch(() => { if (!cancelled) setDisabledReceiptsError("Disabled member receipts could not be loaded."); });
    return () => { cancelled = true; };
  }, [periodId, settlementCalculatedAt]);

  function openReceipt(receipt: Receipt) {
    if (!receipt.image_url) return;
    onOpenEvidence({
      locator: receipt.image_url,
      kind: "Receipt",
      title: receipt.merchant,
      subtitle: `Paid by ${receipt.payer} · ${formatDate(receipt.date)}`,
      amount: fmt(receipt.amount_cents),
      facts: [
        { label: "Merchant", value: receipt.merchant },
        { label: "Amount", value: fmt(receipt.amount_cents) },
        { label: "Paid by", value: receipt.payer },
        { label: "Date", value: formatDate(receipt.date) },
        { label: "Category", value: receipt.category || "Uncategorised" },
      ],
    });
  }

  function openTransfer(receipt: BankTransferReceipt) {
    if (!receipt.receipt_url) return;
    const status = evidenceStatus(receipt).label;
    onOpenEvidence({
      locator: receipt.receipt_url,
      kind: "Bank transfer",
      title: `${firstName(receipt.from_name)} → ${firstName(receipt.to_name)}`,
      subtitle: status,
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

  function openWhatsAppEvidence(receipt: WhatsAppBankTransferEvidence) {
    if (!receipt.evidence_url) return;
    const status = whatsappEvidenceStatus(receipt.review_status);
    const amount = receipt.amount_cents === null ? "Amount unavailable" : fmt(receipt.amount_cents);
    onOpenEvidence({
      locator: receipt.evidence_url,
      kind: "Bank transfer",
      title: `${firstName(receipt.sender_name)} → ${firstName(receipt.recipient_name)}`,
      subtitle: status,
      amount,
      facts: [
        { label: "From", value: receipt.sender_name || "Unknown" },
        { label: "To", value: receipt.recipient_name || "Unknown" },
        { label: "Amount", value: amount },
        { label: "Review", value: `${status} · not payment verification` },
        { label: "Transfer date", value: receipt.transfer_date ? formatDate(receipt.transfer_date) : "Unknown" },
        { label: "Reference", value: receipt.reference_number || "None" },
        { label: "Settlement", value: receipt.period_id },
      ],
    });
  }

  function receiptKeyDown(event: React.KeyboardEvent, receipt: Receipt) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openReceipt(receipt);
    }
  }

  function transferKeyDown(event: React.KeyboardEvent, receipt: BankTransferReceipt) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openTransfer(receipt);
    }
  }

  return (
    <div className="screen screen--receipts">
      <header className="page-header">
        <h1 className="large-title">Receipts</h1>
      </header>

      <GlassSegmented
        className="receipt-section-switcher liquid-segmented"
        options={["Purchases", "Transfers", "Review"]}
        value={section === "purchases" ? 0 : section === "transfers" ? 1 : 2}
        onChange={(index) => setSection(index === 0 ? "purchases" : index === 1 ? "transfers" : "review")}
        size="sm"
        aria-label="Receipt section"
      />

      {section === "purchases" && <>
      <div className="search-controls receipt-purchase-controls">
        <GlassInput className="search-field liquid-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Search receipts" autoComplete="off" enterKeyHint="search" aria-label="Search receipts" intensity={5} />
        <label className={`filter-button native-filter${categoryFilter !== "all" || sortOrder !== "newest" ? " active" : ""}`}>
          <SlidersHorizontal aria-hidden="true" />
          <span className="visually-hidden">Sort receipts</span>
          <select aria-label="Sort receipts" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount-high">Amount: high to low</option>
            <option value="amount-low">Amount: low to high</option>
          </select>
        </label>
      </div>
      <div className="category-tabs" role="tablist" aria-label="Filter by category">
        <button className={categoryFilter === "all" ? "active" : ""} type="button" role="tab" aria-selected={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>All</button>
        {categories.map((category) => <button className={categoryFilter === category ? "active" : ""} type="button" role="tab" aria-selected={categoryFilter === category} onClick={() => setCategoryFilter(category)} key={category}>{category}</button>)}
      </div>

      {!visibleReceipts.length ? <div className="empty-state"><AppIcon name={hasPurchaseFilters ? "search" : "docText"} /><h3>{hasPurchaseFilters ? "No matching receipts" : "No purchases yet"}</h3><p>{hasPurchaseFilters ? "Try clearing the search and filters." : "New purchases will appear here after the next successful WhatsApp sync."}</p>{hasPurchaseFilters && <button className="empty-state-action" type="button" onClick={clearPurchaseFilters}>Clear filters</button>}</div> : showGroups ? <div className="receipt-groups">
        {Array.from(receiptsByDate).map(([date, dateReceipts], groupIndex) => (
          <section className="content-section" aria-labelledby={`date-${groupIndex}`} key={date}>
            <div className="section-heading compact">
              <h2 id={`date-${groupIndex}`}>{formatDate(date)}</h2>
            </div>
            <ul className="grouped-list">
              {dateReceipts.map((receipt, itemIndex) => (
              <li
                key={receipt.id}
                className={`list-row stagger${receipt.image_url ? " evidence-row" : ""}`}
                style={{ animationDelay: `${Math.min(groupIndex * 2 + itemIndex, 12) * 35}ms` }}
                role={receipt.image_url ? "button" : undefined}
                tabIndex={receipt.image_url ? 0 : undefined}
                onClick={() => openReceipt(receipt)}
                onKeyDown={(event) => receiptKeyDown(event, receipt)}
              >
                <MerchantIcon merchant={receipt.merchant} category={receipt.category} />
                <div className="row-main">
                  <span className="row-title">{receipt.merchant}</span>
                  <span className="row-sub">Paid by {receipt.payer} · {receipt.category}</span>
                </div>
                <span className="evidence-row-tail"><strong className="row-amount">{fmt(receipt.amount_cents)}</strong>{receipt.image_url && <Image aria-label="View receipt image" />}</span>
              </li>
              ))}
            </ul>
          </section>
        ))}
      </div> : <ul className="grouped-list">{visibleReceipts.map((receipt, index) => (
        <li key={receipt.id} className={`list-row stagger${receipt.image_url ? " evidence-row" : ""}`} style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }} role={receipt.image_url ? "button" : undefined} tabIndex={receipt.image_url ? 0 : undefined} onClick={() => openReceipt(receipt)} onKeyDown={(event) => receiptKeyDown(event, receipt)}>
          <MerchantIcon merchant={receipt.merchant} category={receipt.category} />
          <div className="row-main"><span className="row-title">{receipt.merchant}</span><span className="row-sub">Paid by {receipt.payer} · {formatDate(receipt.date)}</span></div>
          <span className="evidence-row-tail"><strong className="row-amount">{fmt(receipt.amount_cents)}</strong>{receipt.image_url && <Image aria-label="View receipt image" />}</span>
        </li>
      ))}</ul>}
      </>}

      {section === "transfers" && (visibleBankReceipts.length > 0 ? (
        <section className="content-section bank-receipts-section" aria-labelledby="bank-receipts-heading">
          <div className="section-heading">
            <h2 id="bank-receipts-heading">Bank receipts</h2>
            <span>{visibleBankReceipts.length}</span>
          </div>
          <ul className="grouped-list">
            {visibleBankReceipts.map((receipt) => {
              const status = evidenceStatus(receipt);
              return (
                <li
                  className={`list-row${receipt.receipt_url ? " evidence-row" : ""}`}
                  key={receipt.id}
                  role={receipt.receipt_url ? "button" : undefined}
                  tabIndex={receipt.receipt_url ? 0 : undefined}
                  onClick={() => openTransfer(receipt)}
                  onKeyDown={(event) => transferKeyDown(event, receipt)}
                >
                  <span className={`bank-receipt-icon ${status.state}`} aria-hidden="true"><ArrowDownToLine /></span>
                  <div className="row-main">
                    <span className="row-title">{firstName(receipt.from_name)} → {firstName(receipt.to_name)}</span>
                    <span className={`row-sub evidence-verification-status ${status.state}`}>{status.label}</span>
                  </div>
                  <span className="evidence-row-tail">
                    <strong className="row-amount">{fmt(receipt.amount_cents)}</strong>
                    {receipt.receipt_url && <Image aria-label="View bank receipt image" />}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : <div className="empty-state"><AppIcon name="dollar" /><h3>No transfer receipts</h3><p>Reviewed bank-transfer receipts for this settlement will appear here.</p></div>)}

      {section === "review" && transferEvidence.whatsAppBankEvidence.length > 0 && (
        <section className="content-section bank-receipts-section" aria-labelledby="whatsapp-evidence-heading">
          <div className="section-heading"><h2 id="whatsapp-evidence-heading">WhatsApp transfer evidence</h2></div>
          <ul className="grouped-list">
            {transferEvidence.whatsAppBankEvidence.map((receipt) => {
              const status = whatsappEvidenceStatus(receipt.review_status);
              const amount = receipt.amount_cents === null ? "—" : fmt(receipt.amount_cents);
              return <li className={`list-row${receipt.evidence_url ? " evidence-row" : ""}`} key={receipt.id} role={receipt.evidence_url ? "button" : undefined} tabIndex={receipt.evidence_url ? 0 : undefined} onClick={() => openWhatsAppEvidence(receipt)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openWhatsAppEvidence(receipt); } }}>
                <span className="bank-receipt-icon unknown" aria-hidden="true"><ArrowDownToLine /></span>
                <div className="row-main"><span className="row-title">{firstName(receipt.sender_name)} → {firstName(receipt.recipient_name)}</span><span className="row-sub">{status}{receipt.transfer_date ? ` · ${formatDate(receipt.transfer_date)}` : ""}</span></div>
                <span className="evidence-row-tail"><strong className="row-amount">{amount}</strong>{receipt.evidence_url && <Image aria-label="View WhatsApp transfer evidence" />}</span>
              </li>;
            })}
          </ul>
        </section>
      )}

      {section === "review" && disabledReceipts.length > 0 && <section className="content-section" aria-labelledby="disabled-receipts-heading">
        <div className="section-heading"><h2 id="disabled-receipts-heading">Excluded Member Receipts</h2><span>{disabledReceipts.length}</span></div>
        <ul className="grouped-list">{disabledReceipts.map((receipt) => <li className={`list-row${receipt.image_url ? " evidence-row" : ""}`} key={receipt.id} role={receipt.image_url ? "button" : undefined} tabIndex={receipt.image_url ? 0 : undefined} onClick={() => openReceipt(receipt)} onKeyDown={(event) => receiptKeyDown(event, receipt)}>
          <MerchantIcon merchant={receipt.merchant} category={receipt.category} />
          <div className="row-main"><span className="row-title">{receipt.merchant}</span><span className="row-sub">{receipt.payer} · {receipt.is_excluded ? "Manually excluded" : "Membership disabled"}</span></div>
          <span className="evidence-row-tail"><strong className="row-amount">{fmt(receipt.amount_cents)}</strong>{receipt.image_url && <Image aria-label="View excluded receipt image" />}</span>
        </li>)}</ul>
      </section>}
      {section === "review" && reviewItemCount === 0 && !disabledReceiptsError && !transferEvidence.error && <div className="empty-state"><AppIcon name="info" /><h3>Nothing needs review</h3><p>WhatsApp transfer evidence and excluded-member receipts will appear here when attention is needed.</p></div>}
      {section === "review" && disabledReceiptsError && <div className="evidence-fetch-error" role="alert"><CircleAlert aria-hidden="true" /><span>{disabledReceiptsError}</span></div>}

      {section !== "purchases" && transferEvidence.error && (
        <div className="evidence-fetch-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{transferEvidence.error} Verification remains unknown.</span>
          <button type="button" onClick={transferEvidence.retry}>Retry</button>
        </div>
      )}
    </div>
  );
}
