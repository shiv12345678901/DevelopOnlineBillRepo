import assert from "node:assert/strict";
import test from "node:test";
import { assignBankReceipts } from "../src/settlementMatching.ts";

const groceryToArjun = {
  step_id: "xfer-2026-10-10-0943-grocery-4",
  from_name: "Grocery",
  to_name: "Arjun Bhurtel",
  amount_cents: 64976,
  receipt_url: "storage://bill-evidence/arjun.jpg",
};

test("Grocery to coordinator verifies only the coordinator self-reimbursement", () => {
  const payments = [
    { id: "contribute-Arjun", from: "Arjun Bhurtel", to: "Arjun Bhurtel", cents: 64976, stage: "contribute", self: true },
    { id: "reimburse-Arjun", from: "Arjun Bhurtel", to: "Arjun Bhurtel", cents: 64976, stage: "reimburse", self: true },
  ];

  const assignments = assignBankReceipts(payments, [groceryToArjun]);

  assert.equal(assignments.has("contribute-Arjun"), false);
  assert.equal(assignments.get("reimburse-Arjun")?.step_id, groceryToArjun.step_id);
});

test("a genuine member self-transfer does not verify a payment", () => {
  const payment = { id: "reimburse-Arjun", from: "Arjun", to: "Arjun", cents: 64976, stage: "reimburse", self: true };
  const selfTransfer = { ...groceryToArjun, step_id: "self", from_name: "Arjun Bhurtel" };

  assert.equal(assignBankReceipts([payment], [selfTransfer]).size, 0);
});

test("transfer rows with missing names are ignored safely", () => {
  const payment = { id: "reimburse-Arjun", from: "Arjun", to: "Arjun", cents: 64976, stage: "reimburse", self: true };
  const missingSender = { ...groceryToArjun, step_id: "missing-sender", from_name: null };
  const missingRecipient = { ...groceryToArjun, step_id: "missing-recipient", to_name: null };

  assert.doesNotThrow(() => assignBankReceipts([payment], [missingSender, missingRecipient]));
  assert.equal(assignBankReceipts([payment], [missingSender, missingRecipient]).size, 0);
});
