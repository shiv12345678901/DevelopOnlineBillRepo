import assert from "node:assert/strict";
import test from "node:test";
import { confirmedEqualShares, confirmedObligations, equalShareRoundingRemainder, obligationsViewState, provisionalShareDifference } from "../src/settlementLifecycle.ts";

const settlement = {
  id: "s",
  period_id: "p",
  total_cents: 40000,
  per_person_cents: 10000,
  member_totals: { Arjun: 12000, Arpan: 8000, Shiva: 10000, Swasti: 10000 },
  receipt_count: 4,
  calculated_at: "2026-11-04T00:00:00Z",
  owes: { Arjun: 10000, Arpan: 10000, Shiva: 10000, Swasti: 10000 },
  payment_obligations_status: "CONFIRMED",
};

test("ACTIVE always presents provisional balances instead of payment instructions", () => {
  assert.equal(obligationsViewState("ACTIVE", settlement), "PROVISIONAL");
  assert.equal(provisionalShareDifference(10000, 8000), 2000);
});

test("PENDING_SETTLEMENT exposes only initialized non-empty authoritative obligations", () => {
  assert.equal(obligationsViewState("PENDING_SETTLEMENT", settlement), "CONFIRMED");
  assert.deepEqual(confirmedObligations(settlement).map(({ member }) => member), ["Arjun", "Arpan", "Shiva", "Swasti"]);

  const uninitialized = { ...settlement, payment_obligations_status: "UNINITIALIZED" };
  assert.equal(obligationsViewState("PENDING_SETTLEMENT", uninitialized), "PENDING");
  assert.deepEqual(confirmedObligations(uninitialized), []);
});

test("confirmed equal shares retain Arjun without inventing a self-transfer or rounding transfer", () => {
  const withoutArjunTransfer = { ...settlement, total_cents: 40001, owes: { Arpan: 10000, Shiva: 10000, Swasti: 10000 } };
  const shares = confirmedEqualShares(withoutArjunTransfer);

  assert.deepEqual(shares.map(({ member }) => member), ["Shiva Kafle", "Arpan Bhurtel", "Arjun Bhurtel", "Swasti Adhikari"]);
  assert.equal(shares.find(({ member }) => member === "Arjun Bhurtel")?.amountCents, 10000);
  assert.equal(equalShareRoundingRemainder(withoutArjunTransfer), 1);
});

test("null and empty obligations never mean everybody has paid", () => {
  assert.equal(obligationsViewState("PENDING_SETTLEMENT", { ...settlement, owes: null }), "PENDING");
  assert.equal(obligationsViewState("PENDING_SETTLEMENT", { ...settlement, owes: {} }), "PENDING");
  assert.equal(obligationsViewState("SETTLED", { ...settlement, owes: null }), "SETTLED_WITHOUT_BREAKDOWN");
  assert.equal(obligationsViewState("SETTLED", { ...settlement, owes: {} }), "SETTLED_WITHOUT_BREAKDOWN");
});

test("SETTLED keeps confirmed historical obligations when present", () => {
  assert.equal(obligationsViewState("SETTLED", settlement), "CONFIRMED");
  assert.equal(confirmedObligations(settlement)[0].amountCents, 10000);
});

test("an empty new period is safe without a settlement row", () => {
  assert.equal(obligationsViewState("ACTIVE", null), "PROVISIONAL");
  assert.equal(obligationsViewState("PENDING_SETTLEMENT", null), "PENDING");
  assert.deepEqual(confirmedObligations(null), []);
});
