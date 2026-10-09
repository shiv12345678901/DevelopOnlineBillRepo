import type { User } from "@supabase/supabase-js";
import { useState } from "react";
import { Calculator, ReceiptText, Tags, TrendingUp } from "lucide-react";
import { fmt, type Receipt, type Settlement } from "../api";
import { MerchantIcon } from "../components/MerchantIcon";
import { formatDate } from "../components/format";

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function isOwnReceipt(receipt: Receipt, user: User) {
  const payer = normalize(receipt.payer);
  const emailName = user.email?.split("@")[0] || "";
  const names = [
    user.user_metadata.member_key,
    user.user_metadata.display_name,
    user.user_metadata.full_name,
    emailName,
  ].filter(Boolean) as string[];

  return names.some((name) => {
    const fullName = normalize(name);
    const firstName = normalize(name.split(/\s+/)[0]);
    return payer === fullName || payer === firstName || payer.startsWith(firstName);
  });
}

function pointOnCircle(angle: number, radius = 52) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: 60 + radius * Math.cos(radians), y: 60 + radius * Math.sin(radians) };
}

function slicePath(startAngle: number, endAngle: number) {
  const safeEnd = endAngle - startAngle >= 360 ? startAngle + 359.999 : endAngle;
  const start = pointOnCircle(startAngle);
  const end = pointOnCircle(safeEnd);
  const largeArc = safeEnd - startAngle > 180 ? 1 : 0;
  return `M 60 60 L ${start.x} ${start.y} A 52 52 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

const PIE_TONES = ["pie-green", "tone-4", "tone-2"];

export function MySpendingTab({
  receipts,
  settlement,
  user,
}: {
  receipts: Receipt[];
  settlement: Settlement | null;
  user: User;
}) {
  const [groupBy, setGroupBy] = useState<"category" | "merchant">("category");
  const ownReceipts = receipts.filter((receipt) => isOwnReceipt(receipt, user));
  const total = ownReceipts.reduce((sum, receipt) => sum + receipt.amount_cents, 0);
  const average = ownReceipts.length ? Math.round(total / ownReceipts.length) : 0;
  const largest = ownReceipts.reduce<Receipt | null>(
    (current, receipt) => !current || receipt.amount_cents > current.amount_cents ? receipt : current,
    null,
  );
  const householdShare = settlement?.total_cents ? Math.round((total / settlement.total_cents) * 100) : 0;

  const groups = Array.from(
    ownReceipts.reduce((totals, receipt) => {
      const label = groupBy === "category" ? (receipt.category || "Other") : (receipt.merchant || "Other");
      totals.set(label, (totals.get(label) || 0) + receipt.amount_cents);
      return totals;
    }, new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1]);
  const stats = [
    { label: "Receipts", value: String(ownReceipts.length), icon: ReceiptText, tone: "tone-4" },
    { label: "Average", value: fmt(average), icon: Calculator, tone: "tone-6" },
    { label: "Largest", value: largest ? fmt(largest.amount_cents) : "—", icon: TrendingUp, tone: "tone-2" },
    { label: `Top ${groupBy}`, value: groups[0]?.[0] || "—", icon: Tags, tone: "tone-3" },
  ];
  let pieAngle = 0;
  const pieSlices = groups.map(([label, amount], index) => {
    const startAngle = pieAngle;
    pieAngle += total ? (amount / total) * 360 : 0;
    return { label, amount, index, path: slicePath(startAngle, pieAngle) };
  });

  return (
    <div className="screen screen--spending">
      <header className="page-header">
        <h1 className="large-title">My spending</h1>
      </header>

      <section className="personal-summary" aria-labelledby="personal-total-heading">
        <p className="summary-label" id="personal-total-heading">You paid</p>
        <p className="summary-amount">{fmt(total)}</p>
        <p className="personal-share">{householdShare}% of household spending</p>
      </section>

      <section className="insight-grid" aria-label="Your spending statistics">
        {stats.map(({ label, value, icon: Icon, tone }, index) => (
          <div className={`stat-card ${tone}`} style={{ animationDelay: `${index * 70}ms` }} key={label}>
            <span className="stat-icon" aria-hidden="true"><Icon /></span>
            <span className="stat-copy"><span>{label}</span><strong>{value}</strong></span>
          </div>
        ))}
      </section>

      <section className="content-section" aria-labelledby="spending-insights-heading">
        <div className="section-heading spending-heading">
          <h2 id="spending-insights-heading">By {groupBy}</h2>
          <div className="spending-toggle" role="group" aria-label="Group spending by">
            <button className={groupBy === "category" ? "active" : ""} type="button" onClick={() => setGroupBy("category")}>Category</button>
            <button className={groupBy === "merchant" ? "active" : ""} type="button" onClick={() => setGroupBy("merchant")}>Merchant</button>
          </div>
        </div>
        {groups.length ? (
          <div className="category-chart-card">
            <div className="pie-chart-wrap">
              <svg className="pie-chart" viewBox="0 0 120 120" role="img" aria-label={`Your spending by ${groupBy}`}>
                {pieSlices.map((slice) => (
                  <path
                    className={`pie-slice ${PIE_TONES[slice.index % PIE_TONES.length]}`}
                    d={slice.path}
                    style={{ animationDelay: `${160 + slice.index * 90}ms` }}
                    key={slice.label}
                  />
                ))}
              </svg>
            </div>
            <div className="category-insights">
              {groups.map(([label, amount], index) => (
                <div className="category-insight" key={label}>
                  <div>
                    <span><i className={`legend-dot ${PIE_TONES[index % PIE_TONES.length]}`} />{label}</span>
                    <strong>{fmt(amount)}</strong>
                  </div>
                  <small>{total ? Math.round(amount / total * 100) : 0}% of your spending</small>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state compact-empty">No receipts paid by you in this settlement.</div>
        )}
      </section>

      <section className="content-section" aria-labelledby="own-receipts-heading">
        <div className="section-heading">
          <h2 id="own-receipts-heading">My receipts</h2>
          <span>{ownReceipts.length}</span>
        </div>
        {ownReceipts.length ? (
          <ul className="grouped-list">
            {ownReceipts.map((receipt, index) => (
              <li className="list-row stagger" style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }} key={receipt.id}>
                <MerchantIcon merchant={receipt.merchant} category={receipt.category} />
                <div className="row-main">
                  <span className="row-title">{receipt.merchant}</span>
                  <span className="row-sub">{formatDate(receipt.date)} · {receipt.category}</span>
                </div>
                <strong className="row-amount">{fmt(receipt.amount_cents)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state compact-empty">Your purchases will appear here.</div>
        )}
      </section>
    </div>
  );
}
