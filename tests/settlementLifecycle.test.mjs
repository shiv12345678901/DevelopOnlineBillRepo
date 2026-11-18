import assert from "node:assert/strict";
import test from "node:test";
import { equalShareRoundingRemainder, hasReviewedPaymentObligations, obligationsViewState, provisionalShareDifference, reviewedPaymentPlan } from "../src/settlementLifecycle.ts";

const settlement = {
  id: "s",
  period_id: "period_2026-09-19",
  total_cents: 40001,
  per_person_cents: 10000,
  member_totals: { "Arjun Bhurtel": 12000, "Arpan Bhurtel": 8000, "Shiva Kafle": 10000, "Swasti Adhikari": 0 },
  receipt_count: 4,
  calculated_at: "2026-11-04T00:00:00Z",
  owes: { "Arjun Bhurtel": { "Shiva Kafle": 10000 } },
  payment_obligations_status: "REVIEWED",
};

test("ACTIVE presents provisional balances instead of a reviewed payment plan", () => {
  assert.equal(obligationsViewState("ACTIVE", settlement), "PROVISIONAL");
  assert.equal(provisionalShareDifference(10000, 8000), 2000);
});

test("reviewed nested obligations enable the original two-stage plan", () => {
  assert.equal(hasReviewedPaymentObligations(settlement), true);
  assert.equal(obligationsViewState("PENDING_SETTLEMENT", settlement), "CONFIRMED");
  const plan = reviewedPaymentPlan(settlement);
  assert.equal(plan.contributions.length, 4);
  assert.equal(plan.reimbursements.length, 4);
  assert.equal(plan.contributions.find(({ self }) => self)?.from, "Arjun Bhurtel");
  assert.equal(plan.reimbursements.find(({ self }) => self)?.cents, 12000);
  assert.equal(plan.reimbursements.find(({ to }) => to === "Swasti Adhikari")?.cents, 0);
  assert.equal(plan.contributions.every(({ stepId }) => stepId === null), true, "frontend must not invent step IDs");
  assert.equal(equalShareRoundingRemainder(settlement), 1);
});

test("null, empty and uninitialized obligations never create instructions", () => {
  for (const unavailable of [
    { ...settlement, owes: null },
    { ...settlement, owes: {} },
    { ...settlement, payment_obligations_status: "UNINITIALIZED" },
  ]) {
    assert.equal(hasReviewedPaymentObligations(unavailable), false);
    assert.equal(reviewedPaymentPlan(unavailable), null);
    assert.equal(obligationsViewState("PENDING_SETTLEMENT", unavailable), "PENDING");
  }
});

test("SETTLED with empty historical owes remains completed without a payment breakdown", () => {
  const historical = { ...settlement, owes: {}, payment_obligations_status: null };
  assert.equal(obligationsViewState("SETTLED", historical), "SETTLED_WITHOUT_BREAKDOWN");
  assert.equal(reviewedPaymentPlan(historical), null);
});

test("an empty new period is safe without a settlement row", () => {
  assert.equal(obligationsViewState("ACTIVE", null), "PROVISIONAL");
  assert.equal(obligationsViewState("PENDING_SETTLEMENT", null), "PENDING");
  assert.equal(reviewedPaymentPlan(null), null);
});
