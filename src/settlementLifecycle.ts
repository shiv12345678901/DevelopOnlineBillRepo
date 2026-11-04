import type { Settlement } from "./api";
import type { CycleStatus } from "./cycleStatus";
import { HOUSEHOLD_MEMBERS } from "./household.ts";
import type { ExpectedPayment } from "./settlementMatching";

export type ObligationsViewState =
  | "PROVISIONAL"
  | "PENDING"
  | "CONFIRMED"
  | "SETTLED_WITHOUT_BREAKDOWN";

export type SettlementPaymentPlan = {
  coordinator: string;
  contributions: ExpectedPayment[];
  reimbursements: ExpectedPayment[];
};

function sameMember(left: string, right: string) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  return normalize(left) === normalize(right)
    || normalize(left).split(/\s+/)[0] === normalize(right).split(/\s+/)[0];
}

function positiveObligationCount(settlement: Settlement) {
  return Object.values(settlement.owes || {}).reduce((count, relationships) => (
    count + Object.values(relationships || {}).filter((amount) => Number.isFinite(amount) && amount > 0).length
  ), 0);
}

export function hasReviewedPaymentObligations(settlement: Settlement | null | undefined) {
  return Boolean(
    settlement
    && settlement.payment_obligations_status === "REVIEWED"
    && settlement.owes
    && positiveObligationCount(settlement) > 0,
  );
}

function memberTotal(settlement: Settlement, memberName: string) {
  const match = Object.entries(settlement.member_totals || {}).find(([name]) => sameMember(name, memberName));
  return match?.[1] ?? 0;
}

export function reviewedPaymentPlan(settlement: Settlement | null | undefined): SettlementPaymentPlan | null {
  if (!settlement || !hasReviewedPaymentObligations(settlement)) return null;
  const coordinator = HOUSEHOLD_MEMBERS.find(({ name }) => sameMember(name, "Arjun"))?.name || "Arjun Bhurtel";
  const base = { periodId: settlement.period_id, stepId: null };

  return {
    coordinator,
    contributions: HOUSEHOLD_MEMBERS.map(({ name }) => ({
      ...base,
      id: `contribute-${name}`,
      from: name,
      to: coordinator,
      cents: settlement.per_person_cents,
      stage: "contribute" as const,
      self: sameMember(name, coordinator),
    })).filter(({ cents }) => Number.isFinite(cents) && cents > 0),
    reimbursements: HOUSEHOLD_MEMBERS.map(({ name }) => ({
      ...base,
      id: `reimburse-${name}`,
      from: coordinator,
      to: name,
      cents: memberTotal(settlement, name),
      stage: "reimburse" as const,
      self: sameMember(name, coordinator),
    })).filter(({ cents }) => Number.isFinite(cents) && cents >= 0),
  };
}

export function equalShareRoundingRemainder(settlement: Settlement | null | undefined) {
  const plan = reviewedPaymentPlan(settlement);
  if (!settlement || !plan) return 0;
  const remainder = settlement.total_cents - plan.contributions.reduce((total, share) => total + share.cents, 0);
  return Math.abs(remainder) < HOUSEHOLD_MEMBERS.length ? remainder : 0;
}

export function obligationsViewState(
  cycleStatus: CycleStatus,
  settlement: Settlement | null | undefined,
): ObligationsViewState {
  if (cycleStatus === "ACTIVE") return "PROVISIONAL";
  if (hasReviewedPaymentObligations(settlement)) return "CONFIRMED";
  if (cycleStatus === "SETTLED") return "SETTLED_WITHOUT_BREAKDOWN";
  return "PENDING";
}

export function provisionalShareDifference(perPersonCents: number, contributionCents: number) {
  return perPersonCents - contributionCents;
}
