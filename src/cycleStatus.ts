import type { BankTransferReceipt, Period, WhatsAppCycleStatus } from "./api";
import { transferEvidenceState } from "./settlementMatching.ts";

export type CycleStatus = WhatsAppCycleStatus;

export function cycleStatusFor(period: Period): CycleStatus {
  const detected = period.whatsapp_cycle_status;
  if (["ACTIVE", "PENDING_SETTLEMENT", "SETTLED", "UNCONFIRMED"].includes(detected || "")) {
    return detected as CycleStatus;
  }
  return period.status === "CURRENT" ? "ACTIVE" : "SETTLED";
}

export function cycleStatusLabel(status: CycleStatus) {
  if (status === "PENDING_SETTLEMENT") return "Awaiting clearance";
  if (status === "SETTLED") return "Settled";
  if (status === "UNCONFIRMED") return "Unconfirmed";
  return "Active";
}

export function transferEvidenceVerified(receipt?: BankTransferReceipt) {
  return receipt ? transferEvidenceState(receipt) === "verified" : false;
}
