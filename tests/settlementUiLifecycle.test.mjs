import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Home keeps provisional and unavailable settlement states explicit", async () => {
  const source = await readFile(new URL("../src/tabs/HomeTab.tsx", import.meta.url), "utf8");
  assert.match(source, /"Estimated equal share"/);
  assert.match(source, /"Est\. owes"/);
  assert.match(source, />Awaiting calculation</);
  assert.match(source, />Historical obligations unavailable</);
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
