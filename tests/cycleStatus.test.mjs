import test from "node:test";
import assert from "node:assert/strict";
import { cycleStatusFor, cycleStatusLabel, transferEvidenceVerified } from "../src/cycleStatus.ts";

const period = { id: "p", start_date: "2026-10-01", end_date: "2026-10-31", status: "CURRENT", total_cents: 0, per_person_cents: 0, receipt_count: 0 };

test("frontend presents active, pending and settled cycle states with a legacy fallback", () => {
  assert.equal(cycleStatusFor(period), "ACTIVE");
  assert.equal(cycleStatusFor({ ...period, whatsapp_cycle_status: "PENDING_SETTLEMENT" }), "PENDING_SETTLEMENT");
  assert.equal(cycleStatusLabel("PENDING_SETTLEMENT"), "Awaiting clearance");
  assert.equal(cycleStatusFor({ ...period, status: "CLOSED" }), "SETTLED");
});

test("bank-transfer evidence is not verified merely because an image exists", () => {
  const evidence = { id: "t", period_id: "p", step_id: "s", from_name: "A", to_name: "B", amount_cents: 100, transfer_date: "2026-10-02", receipt_url: "storage://bill-evidence/t.jpg" };
  assert.equal(transferEvidenceVerified(evidence), false);
  assert.equal(transferEvidenceVerified({ ...evidence, verification_status: "verified" }), true);
});
