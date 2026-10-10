import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image, SlidersHorizontal } from "lucide-react";
import { fmt, type Receipt } from "../api";
import { formatDate } from "../components/format";
import { AppIcon } from "../components/AppIcon";
import { EvidenceDetailPage, type EvidenceDetails } from "../components/EvidenceViewer";
import { MerchantIcon } from "../components/MerchantIcon";

export function ReceiptsTab({ receipts }: { receipts: Receipt[] }) {
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceDetails | null>(null);
  const savedScrollY = useRef<number | null>(null);
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

  if (selectedEvidence) return <EvidenceDetailPage evidence={selectedEvidence} onBack={() => setSelectedEvidence(null)} />;

  return (
    <div className="screen screen--receipts">
      <header className="page-header">
        <h1 className="large-title">Receipts</h1>
      </header>

      <div className="search-controls">
        <label className="search-field">
          <span className="visually-hidden">Search receipts</span>
          <AppIcon name="search" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search receipts" autoComplete="off" enterKeyHint="search" />
        </label>
        <div className="filter-menu-wrap">
          <button className={`filter-button${filterOpen || categoryFilter !== "all" || sortOrder !== "newest" ? " active" : ""}`} type="button" aria-label="Filter receipts" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><SlidersHorizontal aria-hidden="true" /></button>
          {filterOpen && <div className="filter-dropdown" role="menu" aria-label="Receipt filters">
            <span className="filter-dropdown-label">Sort by</span>
            {[["newest", "Newest first"], ["oldest", "Oldest first"], ["amount-high", "Amount: high to low"], ["amount-low", "Amount: low to high"]].map(([value, label]) => <button className={sortOrder === value ? "active" : ""} type="button" role="menuitem" onClick={() => { setSortOrder(value); setFilterOpen(false); }} key={value}>{label}</button>)}
          </div>}
        </div>
      </div>
      <div className="category-tabs" role="tablist" aria-label="Filter by category">
        <button className={categoryFilter === "all" ? "active" : ""} type="button" role="tab" aria-selected={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>All</button>
        {categories.map((category) => <button className={categoryFilter === category ? "active" : ""} type="button" role="tab" aria-selected={categoryFilter === category} onClick={() => setCategoryFilter(category)} key={category}>{category}</button>)}
      </div>

      {!visibleReceipts.length ? <div className="empty-state"><AppIcon name="search" /><h3>No matching receipts</h3><p>Try a merchant, person, category, or another date.</p></div> : showGroups ? <div className="receipt-groups">
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
    </div>
  );
}
