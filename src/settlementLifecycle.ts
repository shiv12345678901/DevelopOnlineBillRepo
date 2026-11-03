import type { PaymentObligationsStatus, Settlement } from "./api";
import type { CycleStatus } from "./cycleStatus";
import { HOUSEHOLD_MEMBERS } from "./household.ts";

export type ConfirmedObligation = {
  member: string;
  amountCents: number;
};

export type ObligationsViewState =
  | "PROVISIONAL"
  | "PENDING"
  | "CONFIRMED"
  | "SETTLED_WITHOUT_BREAKDOWN";

export function obligationsAreUninitialized(status: PaymentObligationsStatus | null | undefined) {
  return status === "UNINITIALIZED";
}

export function confirmedObligations(settlement: Settlement | null | undefined): ConfirmedObligation[] {
  if (!settlement || obligationsAreUninitialized(settlement.payment_obligations_status) || !settlement.owes) {
    return [];
  }

  return Object.entries(settlement.owes)
    .filter(([member, amountCents]) => member.trim().length > 0 && Number.isFinite(amountCents) && amountCents > 0)
    .map(([member, amountCents]) => ({ member, amountCents }));
}

function sameMember(left: string, right: string) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  return normalize(left) === normalize(right)
    || normalize(left).split(/\s+/)[0] === normalize(right).split(/\s+/)[0];
}

export function confirmedEqualShares(settlement: Settlement | null | undefined): ConfirmedObligation[] {
  const owes = settlement?.owes;
  if (confirmedObligations(settlement).length === 0 || !settlement || !owes) return [];

  return HOUSEHOLD_MEMBERS.map(({ name }) => {
    const authoritativeEntry = Object.entries(owes).find(([member]) => sameMember(member, name));
    return {
      member: name,
      amountCents: authoritativeEntry?.[1] ?? settlement.per_person_cents,
    };
  }).filter(({ amountCents }) => Number.isFinite(amountCents) && amountCents > 0);
}

export function equalShareRoundingRemainder(settlement: Settlement | null | undefined) {
  const equalShares = confirmedEqualShares(settlement);
  if (!settlement || equalShares.length === 0) return 0;
  const remainder = settlement.total_cents - equalShares.reduce((total, share) => total + share.amountCents, 0);
  return Math.abs(remainder) < HOUSEHOLD_MEMBERS.length ? remainder : 0;
}

export function obligationsViewState(
  cycleStatus: CycleStatus,
  settlement: Settlement | null | undefined,
): ObligationsViewState {
  if (cycleStatus === "ACTIVE") return "PROVISIONAL";
  if (confirmedObligations(settlement).length > 0) return "CONFIRMED";
  if (cycleStatus === "SETTLED") return "SETTLED_WITHOUT_BREAKDOWN";
  return "PENDING";
}

export function provisionalShareDifference(perPersonCents: number, contributionCents: number) {
  return perPersonCents - contributionCents;
}
