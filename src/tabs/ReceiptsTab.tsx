import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, CircleAlert, Image, SlidersHorizontal } from "lucide-react";
import { GlassInput } from "@zakisheriff/liquid-glass";
import { fmt, type BankTransferReceipt, type Receipt } from "../api";
import { formatDate } from "../components/format";
import { AppIcon } from "../components/AppIcon";
import { EvidenceDetailPage, type EvidenceDetails } from "../components/EvidenceViewer";
import { MerchantIcon } from "../components/MerchantIcon";
import { useTransferEvidence } from "../components/useTransferEvidence";
import { transferEvidenceState } from "../settlementMatching";

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

export function ReceiptsTab({ receipts, periodId, settlementCalculatedAt }: {
  receipts: Receipt[];
  periodId: string | null;
  settlementCalculatedAt?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceDetails | null>(null);
  const savedScrollY = useRef<number | null>(null);
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
  const receiptsByDate = visibleReceipts.reduce<Map<string, Receipt[]>>((groups, receipt) => {
    const group = groups.get(receipt.date) || [];
    group.push(receipt);
    groups.set(receipt.date, group);
    return groups;
  }, new Map());

  function openReceipt(receipt: Receipt) {
    if (!receipt.image_url) return;
    savedScrollY.current = window.scrollY;
    setSelectedEvidence({
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
    savedScrollY.current = window.scrollY;
    const status = evidenceStatus(receipt).label;
    setSelectedEvidence({
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

  if (selectedEvidence) return <EvidenceDetailPage evidence={selectedEvidence} onBack={() => setSelectedEvidence(null)} />;

  return (
    <div className="screen screen--receipts">
      <header className="page-header">
        <h1 className="large-title">Receipts</h1>
      </header>

      <div className="search-controls">
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

      {!visibleReceipts.length ? <div className="empty-state"><AppIcon name="search" /><h3>No matching receipts</h3></div> : showGroups ? <div className="receipt-groups">
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

      {visibleBankReceipts.length > 0 && (
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
      )}

      {transferEvidence.error && (
        <div className="evidence-fetch-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{transferEvidence.error} Verification remains unknown.</span>
          <button type="button" onClick={transferEvidence.retry}>Retry</button>
        </div>
      )}
    </div>
  );
}
