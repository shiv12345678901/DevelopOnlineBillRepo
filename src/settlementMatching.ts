export type ExpectedPayment = {
  id: string;
  from: string;
  to: string;
  cents: number;
  stage: "contribute" | "reimburse";
  self?: boolean;
};

export type TransferEvidence = {
  step_id: string;
  from_name: string;
  to_name: string;
  amount_cents: number;
  receipt_url?: string | null;
};

function samePerson(left: string, right: string) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  return normalize(left) === normalize(right) || normalize(left).split(/\s+/)[0] === normalize(right).split(/\s+/)[0];
}

function isGrocery(value: string) {
  return value.trim().toLocaleLowerCase() === "grocery";
}

export function assignBankReceipts<T extends TransferEvidence>(payments: ExpectedPayment[], receipts: T[]) {
  const assignments = new Map<string, T>();
  const usedStepIds = new Set<string>();
  const candidates = receipts
    .filter((receipt) => !samePerson(receipt.from_name, receipt.to_name))
    .sort((left, right) => Number(Boolean(right.receipt_url)) - Number(Boolean(left.receipt_url)));

  for (const recipientKind of ["exact", "grocery"] as const) {
    for (const payment of payments) {
      if (assignments.has(payment.id)) continue;
      const receipt = candidates.find((candidate) => {
        if (usedStepIds.has(candidate.step_id)) return false;
        const senderMatches = samePerson(candidate.from_name, payment.from)
          || (payment.stage === "reimburse" && payment.self && isGrocery(candidate.from_name));
        if (!senderMatches) return false;
        if (Math.abs(candidate.amount_cents - payment.cents) > 10) return false;
        return recipientKind === "exact"
          ? samePerson(candidate.to_name, payment.to)
          : isGrocery(candidate.to_name);
      });
      if (!receipt) continue;
      assignments.set(payment.id, receipt);
      usedStepIds.add(receipt.step_id);
    }
  }

  return assignments;
}
