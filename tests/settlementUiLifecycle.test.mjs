import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ACTIVE UI labels balances as provisional and not payment instructions", async () => {
  const source = await readFile(new URL("../src/tabs/SettleTab.tsx", import.meta.url), "utf8");
  assert.match(source, /estimated equal share/);
  assert.match(source, /No payment amounts or transfer instructions have been created/);
  assert.match(source, /obligationsState === "CONFIRMED" \? reviewedPlan : null/);
});

test("confirmed UI follows the grocery-account flow and keeps evidence states distinct", async () => {
  const [source, homeSource] = await Promise.all([
    readFile(new URL("../src/tabs/SettleTab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/HomeTab.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(source, /"Send equal share"/);
  assert.match(source, /Arjun’s designated grocery account/);
  assert.match(source, /"Reimburse spending"/);
  assert.match(source, /"Completed settlement"/);
  assert.match(source, /No extra transfer is required/);
  assert.match(source, /Pending verification/);
  assert.match(source, /Verified/);
  assert.match(source, /Unassigned · Not verified/);
  assert.match(source, /Awaiting calculation/);
  assert.match(source, /Receipt link unknown/);
  assert.match(homeSource, /Payment verification/);
});
