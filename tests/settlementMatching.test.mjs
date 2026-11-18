import assert from "node:assert/strict";
import test from "node:test";
import { assignBankReceipts, summarizeTransferEvidence, transferEvidenceState } from "../src/settlementMatching.ts";

const payment = {
  id: "payment-1",
  periodId: "period_2026-09-19",
  stepId: "xfer-boundary-date-grocery-4",
  from: "Shiva Kafle",
  to: "Arjun Bhurtel",
  cents: 64976,
  stage: "contribute",
};

const evidence = {
  period_id: "period_2026-09-19",
  step_id: "xfer-boundary-date-grocery-4",
  from_name: "Name is not used for matching",
  to_name: "Neither is this name",
  amount_cents: 64976,
  receipt_url: "storage://bill-evidence/transfer.jpg",
  verification_status: null,
  verified_at: null,
};

test("period, step ID and exact amount are all required to assign evidence", () => {
  assert.equal(assignBankReceipts([payment], [evidence]).get(payment.id), evidence);
  assert.equal(assignBankReceipts([payment], [{ ...evidence, period_id: "period_2026-10-10" }]).size, 0);
  assert.equal(assignBankReceipts([payment], [{ ...evidence, step_id: "another-step" }]).size, 0);
  assert.equal(assignBankReceipts([payment], [{ ...evidence, amount_cents: 64975 }]).size, 0);
});

test("matching names and amount never substitute for a missing authoritative step ID", () => {
  const withoutStep = { ...payment, stepId: null };
  const matchingNames = { ...evidence, from_name: payment.from, to_name: payment.to };
  assert.equal(assignBankReceipts([withoutStep], [matchingNames]).size, 0);
});

test("nullable historical verification metadata remains pending, not verified", () => {
  assert.equal(transferEvidenceState(evidence), "pending");
  const historical = Array.from({ length: 8 }, (_, index) => ({ ...evidence, step_id: `historical-${index}` }));
  assert.deepEqual(summarizeTransferEvidence(historical), {
    total: 8,
    pending: 8,
    verified: 0,
    rejected: 0,
    unknown: 0,
  });
});

test("verified evidence needs a completion timestamp and rejected remains distinct", () => {
  assert.equal(transferEvidenceState({ ...evidence, verification_status: "verified" }), "unknown");
  assert.equal(transferEvidenceState({ ...evidence, verification_status: "verified", verified_at: "2026-11-04T01:00:00Z" }), "verified");
  assert.equal(transferEvidenceState({ ...evidence, verification_status: "rejected" }), "rejected");
  assert.equal(transferEvidenceState({ ...evidence, verification_status: "unexpected" }), "unknown");
});

test("WhatsApp review status is separate from payment verification", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/tabs/ReceiptsTab.tsx", import.meta.url), "utf8");
  assert.match(source, /status === "reviewed"\) return "Reviewed"/);
  assert.match(source, /not payment verification/);
});

test("WhatsApp evidence deduplicates by stable ID and preserves missing amounts", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/tabs/ReceiptsTab.tsx", import.meta.url), "utf8");
  assert.match(source, /key=\{receipt\.id\}/);
  assert.match(source, /receipt\.amount_cents === null \? "—"/);
  assert.match(source, /receipt\.amount_cents === null \? "Amount unavailable"/);
});

test("WhatsApp evidence query is isolated to exact period ID", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(source, /from\("whatsapp_bank_transfer_evidence"\)[\s\S]*?\.eq\("period_id", periodId\)/);
});
