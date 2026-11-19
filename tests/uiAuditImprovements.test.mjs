import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [appSource, cssSource, homeSource, receiptsSource, spendingSource, historySource] = await Promise.all([
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  readFile(new URL("../src/tabs/HomeTab.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/tabs/ReceiptsTab.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/tabs/MySpendingTab.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/tabs/HistoryTab.tsx", import.meta.url), "utf8"),
]);

test("semantic secondary text colors meet the reviewed contrast floor", () => {
  assert.match(cssSource, /--label-tertiary: rgba\(235, 235, 245, 0\.56\)/);
  assert.match(cssSource, /--label-secondary: rgba\(60, 60, 67, 0\.74\)/);
  assert.match(cssSource, /--label-tertiary: rgba\(60, 60, 67, 0\.74\)/);
});

test("mobile interface text never drops below eleven CSS pixels", () => {
  const remSizes = [...cssSource.matchAll(/font-size:\s*(?:0)?(\.[0-9]+)rem/g)].map((match) => Number(match[1]));
  assert.ok(remSizes.length > 0);
  assert.ok(remSizes.every((size) => size >= 0.6875), `Found undersized rem value: ${Math.min(...remSizes)}`);
});

test("the Home header wraps instead of truncating scaled text", () => {
  assert.match(cssSource, /\.home-header \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(cssSource, /\.home-header \.large-title \{[^}]*overflow-wrap: anywhere/);
  assert.match(cssSource, /@media \(max-width: 480px\)[\s\S]*\.home-header \.large-title \{[^}]*white-space: normal/);
  assert.doesNotMatch(cssSource, /\.home-header \.large-title \{[^}]*text-overflow: ellipsis/);
});

test("Receipts keeps its continuous list and provides filter recovery", () => {
  assert.doesNotMatch(receiptsSource, /options=\{\["Purchases", "Transfers", "Review"\]\}/);
  assert.doesNotMatch(receiptsSource, /type ReceiptSection/);
  assert.match(receiptsSource, /visibleBankReceipts\.length > 0/);
  assert.match(receiptsSource, /transferEvidence\.whatsAppBankEvidence\.length > 0/);
  assert.match(receiptsSource, />Clear filters</);
});

test("Receipts filters purchases by member instead of category", () => {
  assert.match(receiptsSource, /aria-label="Filter receipts by member"/);
  assert.match(receiptsSource, /receipt\.payer\.trim\(\)\.toLocaleLowerCase\(\) === memberFilter/);
  assert.match(receiptsSource, /members\.map\(\(member\) =>/);
  assert.match(receiptsSource, /label: name\.split\(\/\\s\+\/\)\[0\]/);
  assert.match(receiptsSource, /aria-label=\{`Filter receipts paid by \$\{member\.name\}`\}/);
  assert.match(receiptsSource, />\{member\.label\}<\/button>/);
  assert.doesNotMatch(receiptsSource, /categoryFilter|Filter by category|category-tabs/);
  assert.match(cssSource, /\.member-filter-pills/);
});

test("empty states explain how content will become available", () => {
  assert.match(receiptsSource, /New purchases will appear here after the next successful WhatsApp sync/);
  assert.match(spendingSource, /Receipts matched to your profile will appear here after the next successful sync/);
  assert.match(historySource, /Completed billing cycles will appear here after the first verified clearance rollover/);
});

test("Home displays the freshness of its financial data", () => {
  assert.match(appSource, /lastCompletedSyncAt=\{lastCompletedSyncAt\}/);
  assert.match(homeSource, /lastCompletedSyncAt \|\| currentPeriod\?\.last_scanned_at/);
  assert.match(homeSource, /compactRelativeTime\(freshnessTimestamp, freshnessNow\)/);
  assert.match(homeSource, /replace\(\/\^\(\\d\+\) minutes\? ago\$\/, "\$1m ago"\)/);
  assert.match(homeSource, /<time dateTime=\{freshnessTimestamp\}>Updated \{freshnessText\}<\/time>/);
  assert.match(homeSource, /className="home-summary-meta"/);
  assert.match(cssSource, /\.home-summary-meta \{[^}]*justify-items: end/);
});

test("older-period confirmation uses the opaque iOS confirmation sheet", () => {
  assert.match(appSource, /<IosSheet open=\{Boolean\(pendingPeriodId\)\}/);
  assert.match(appSource, /className="period-confirm-modal" overlayPriority=\{OVERLAY_PRIORITY\.confirmation\}/);
  assert.match(appSource, /className="period-confirm-icon"[^>]*><CalendarClock \/>/);
  assert.match(appSource, /className="ios-secondary-button"/);
  assert.match(appSource, />Cancel<\/button>/);
  assert.match(appSource, /className="ios-primary-button"[^>]*>View Period<\/button>/);
  assert.doesNotMatch(appSource, /GlassSheet|period-confirm-toolbar|lg-sheet/);
  assert.match(cssSource, /\.period-confirm-modal \{ background: var\(--surface\); \}/);
  assert.match(cssSource, /\.period-confirm \{[^}]*padding: 4px 22px max\(24px, env\(safe-area-inset-bottom\)\)/);
});
