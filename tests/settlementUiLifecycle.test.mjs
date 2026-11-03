import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ACTIVE UI labels balances as provisional and not payment instructions", async () => {
  const source = await readFile(new URL("../src/tabs/SettleTab.tsx", import.meta.url), "utf8");
  assert.match(source, /Provisional balances/);
  assert.match(source, /Not payment instructions/);
  assert.doesNotMatch(source, /function buildPlan/);
});

test("confirmed UI follows the grocery-account flow and keeps evidence states distinct", async () => {
  const source = await readFile(new URL("../src/tabs/SettleTab.tsx", import.meta.url), "utf8");
  assert.match(source, /"Send equal share"/);
  assert.match(source, /Arjun’s designated grocery account/);
  assert.match(source, /"Reimburse spending"/);
  assert.match(source, /No extra transfer is required/);
  assert.match(source, /isHistoricalSettlement \? "Completed"/);
  assert.match(source, /Pending verification/);
  assert.match(source, /Verified/);
  assert.match(source, /Unassigned · Not verified/);
});
