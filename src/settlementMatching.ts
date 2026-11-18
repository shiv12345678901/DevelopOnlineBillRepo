export type ExpectedPayment = {
  id: string;
  periodId: string;
  stepId: string | null;
  from: string;
  to: string;
  cents: number;
  stage: "contribute" | "reimburse";
  self?: boolean;
};

export type TransferEvidence = {
  period_id: string;
  step_id: string;
  from_name: string | null;
  to_name: string | null;
  amount_cents: number;
  receipt_url?: string | null;
  verification_status?: string | null;
  verified_at?: string | null;
};

export type EvidenceVerificationState = "pending" | "verified" | "rejected" | "unknown";

export function transferEvidenceState(receipt: TransferEvidence): EvidenceVerificationState {
  if (receipt.verification_status === "rejected") return "rejected";
  if (receipt.verification_status === "verified") {
    return receipt.verified_at && Number.isFinite(Date.parse(receipt.verified_at)) ? "verified" : "unknown";
  }
  if (receipt.verification_status === null || receipt.verification_status === undefined || receipt.verification_status === "pending") {
    return "pending";
  }
  return "unknown";
}

export function summarizeTransferEvidence(receipts: TransferEvidence[]) {
  return receipts.reduce(
    (summary, receipt) => {
      summary.total += 1;
      summary[transferEvidenceState(receipt)] += 1;
      return summary;
    },
    { total: 0, pending: 0, verified: 0, rejected: 0, unknown: 0 },
  );
}

/**
 * Attach evidence only through the database's authoritative relationship.
 * Names, transfer dates and near-equal amounts are deliberately ignored.
 */
export function assignBankReceipts<T extends TransferEvidence>(payments: ExpectedPayment[], receipts: T[]) {
  const assignments = new Map<string, T>();
  const usedReceiptIds = new Set<string>();

  for (const payment of payments) {
    if (!payment.periodId || !payment.stepId || !Number.isFinite(payment.cents)) continue;
    const receipt = receipts.find((candidate) => {
      const identity = `${candidate.period_id}\u0000${candidate.step_id}`;
      return !usedReceiptIds.has(identity)
        && candidate.period_id === payment.periodId
        && candidate.step_id === payment.stepId
        && candidate.amount_cents === payment.cents;
    });
    if (!receipt) continue;
    assignments.set(payment.id, receipt);
    usedReceiptIds.add(`${receipt.period_id}\u0000${receipt.step_id}`);
  }

  return assignments;
}
