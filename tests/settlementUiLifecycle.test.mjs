import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Home keeps provisional and unavailable settlement states explicit", async () => {
  const source = await readFile(new URL("../src/tabs/HomeTab.tsx", import.meta.url), "utf8");
  assert.match(source, /"Estimated equal share"/);
  assert.match(source, /"Est\. owes"/);
  assert.match(source, />Awaiting calculation</);
  assert.match(source, />Historical obligations unavailable</);
  assert.match(source, /evidence\.whatsAppBankEvidence\.reduce/);
  assert.match(source, /Settlement calculation is still pending\. No payment is verified\./);
  assert.match(source, /item\.review_status === "reviewed"/);
  assert.doesNotMatch(source, /review_status === "reviewed"[^\n]*verified/);
});

test("Receipts keeps bank evidence states distinct", async () => {
  const source = await readFile(new URL("../src/tabs/ReceiptsTab.tsx", import.meta.url), "utf8");
  assert.match(source, /Pending verification/);
  assert.match(source, /Verified/);
  assert.match(source, /Rejected/);
  assert.match(source, /Unverified/);
  assert.match(source, /Verification remains unknown/);
});

test("primary navigation omits settlement and receipts owns period-isolated bank evidence", async () => {
  const [appSource, tabBarSource, receiptsSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/TabBar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/ReceiptsTab.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(tabBarSource, /id: "settle"/);
  assert.doesNotMatch(appSource, /tab === "settle"/);
  assert.match(appSource, /periodId=\{displayedPeriod\?\.id \?\? null\}/);
  assert.match(receiptsSource, /useTransferEvidence\(periodId, settlementCalculatedAt\)/);
  assert.match(receiptsSource, /transferEvidenceState\(receipt\) !== "pending"/);
  assert.match(receiptsSource, /visibleBankReceipts\.length > 0/);
  assert.match(receiptsSource, />Bank receipts</);
  assert.match(receiptsSource, /return \{ state, label: "Unverified" \}/);
});

test("opening Receipts refreshes in the background without replacing the page", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const effect = source.match(/\/\/ Receipts and settlement evidence[\s\S]*?\}, \[tab, session\?\.user\.id\]\);/)?.[0] || "";
  assert.match(effect, /tab !== "receipts"/);
  assert.match(effect, /void refreshData\(\)/);
  assert.doesNotMatch(effect, /setLoading/);
});

test("History can always return Home through the selected bottom-nav item", async () => {
  const source = await readFile(new URL("../src/components/TabBar.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(tab !== "history"\) return/);
  assert.match(source, /item\?\.dataset\.lgItem === "0"/);
  assert.match(source, /setTab\("home"\)/);
});

test("Home uses a skeleton on initial data load", async () => {
  const [app, skeleton, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/HomeSkeleton.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /tab === "home" \? <HomeSkeleton/);
  assert.match(app, /session === undefined[\s\S]*?<HomeSkeleton/);
  assert.match(skeleton, /aria-label="Loading Home"/);
  assert.match(css, /@keyframes skeletonShimmer/);
});

test("iOS sheets are edge anchored, animated and draggable to dismiss", async () => {
  const [sheet, css] = await Promise.all([
    readFile(new URL("../src/components/IosSheet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  assert.match(sheet, /onPointerDown=\{startDrag\}/);
  assert.match(sheet, /distance > Math\.min\(140/);
  assert.match(sheet, /setClosing\(true\)/);
  assert.match(css, /border-radius: 28px 28px 0 0/);
  assert.match(css, /@keyframes iosSheetIn/);
  assert.match(css, /\.ios-sheet-layer\.is-closing \.ios-sheet/);
});
