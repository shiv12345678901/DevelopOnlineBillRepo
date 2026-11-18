import type { Receipt, SettlementCycleMembership, SettlementCyclePreview } from "./api";

export const CALCULATION_MEMBER_ORDER = ["Arjun Bhurtel", "Arpan Bhurtel", "Shiva Kafle", "Swasti Adhikari"] as const;
const SHORT_NAMES: Record<string, string> = { "Arjun Bhurtel": "Arjun", "Arpan Bhurtel": "Arpan", "Shiva Kafle": "Shiva", "Swasti Adhikari": "Swasti" };
const BANK_MERCHANTS = new Set(["bank transfer", "payment transfer"]);

export type CalculationFailure = "STALE_REVISION" | "TOTAL_MISMATCH" | "MEMBER_MISMATCH" | "INVALID_RECEIPT" | "DISABLED_RECEIPT_VISIBLE" | "MISSING_MEMBER";

export class CopyCalculationError extends Error {
  code: CalculationFailure;
  constructor(code: CalculationFailure, message: string) { super(message); this.name = "CopyCalculationError"; this.code = code; }
}

export type CalculationResult = {
  text: string;
  receiptCount: number;
  enabledCount: number;
  memberReceiptTotals: Record<string, number>;
};

export function formatReceiptCents(cents: number) {
  const dollars = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100);
  if (remainder === 0) return String(dollars);
  if (remainder % 10 === 0) return `${dollars}.${remainder / 10}`;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
}

export function formatFixedCents(cents: number) {
  return (cents / 100).toFixed(2);
}

export function generateCopyCalculation(receipts: Receipt[], membership: SettlementCycleMembership, preview: SettlementCyclePreview): CalculationResult {
  if (membership.period_id !== preview.period_id || membership.revision !== preview.revision) throw new CopyCalculationError("STALE_REVISION", "Membership changed while the calculation was loading.");
  if (![preview.total_cents, preview.equal_share_cents, ...preview.members.flatMap((member) => [member.paid_cents, member.share_cents, member.net_cents])].every(Number.isInteger)) throw new CopyCalculationError("MEMBER_MISMATCH", "The financial preview contains invalid cent values.");
  const membershipByName = new Map(membership.members.map((member) => [member.member_name, member]));
  const previewByName = new Map(preview.members.map((member) => [member.member_name, member]));
  for (const name of CALCULATION_MEMBER_ORDER) if (!membershipByName.has(name) || !previewByName.has(name)) throw new CopyCalculationError("MISSING_MEMBER", `Missing membership data for ${name}.`);

  const uniqueReceipts = new Map<string, Receipt>();
  for (const receipt of receipts) {
    if (uniqueReceipts.has(receipt.id)) continue;
    if (receipt.period_id !== membership.period_id || receipt.is_excluded || !Number.isInteger(receipt.amount_cents) || receipt.amount_cents < 0 || typeof receipt.merchant !== "string" || BANK_MERCHANTS.has(receipt.merchant.trim().toLocaleLowerCase())) continue;
    const member = membershipByName.get(receipt.payer);
    if (!member) throw new CopyCalculationError("INVALID_RECEIPT", `Unknown receipt payer: ${receipt.payer}.`);
    if (member.participation_mode === "disabled") throw new CopyCalculationError("DISABLED_RECEIPT_VISIBLE", "A disabled member receipt was returned by the ordinary receipt query.");
    uniqueReceipts.set(receipt.id, receipt);
  }

  const receiptsByMember = new Map<string, Receipt[]>(CALCULATION_MEMBER_ORDER.map((name) => [name, [] as Receipt[]]));
  for (const receipt of uniqueReceipts.values()) receiptsByMember.get(receipt.payer)?.push(receipt);
  const totals: Record<string, number> = {};
  for (const name of CALCULATION_MEMBER_ORDER) totals[name] = (receiptsByMember.get(name) || []).reduce((sum, receipt) => sum + receipt.amount_cents, 0);

  for (const name of CALCULATION_MEMBER_ORDER) {
    const member = membershipByName.get(name)!;
    const financial = previewByName.get(name)!;
    if (member.participation_mode !== financial.participation_mode) throw new CopyCalculationError("MEMBER_MISMATCH", `${SHORT_NAMES[name]} membership mode does not match the financial preview.`);
    if (member.participation_mode === "disabled") {
      if (financial.paid_cents !== 0 || financial.share_cents !== 0 || financial.net_cents !== 0 || totals[name] !== 0) throw new CopyCalculationError("MEMBER_MISMATCH", `${SHORT_NAMES[name]} disabled balance is not zero.`);
    } else if (totals[name] !== financial.paid_cents) {
      throw new CopyCalculationError("MEMBER_MISMATCH", `${SHORT_NAMES[name]} receipt total does not match the financial preview.`);
    }
    if (member.participation_mode === "keep_receipts" && financial.share_cents !== 0) throw new CopyCalculationError("MEMBER_MISMATCH", `${SHORT_NAMES[name]} Keep Receipts share is not zero.`);
  }

  const includedNames = CALCULATION_MEMBER_ORDER.filter((name) => membershipByName.get(name)!.participation_mode !== "disabled");
  const grandTotal = includedNames.reduce((sum, name) => sum + totals[name], 0);
  if (grandTotal !== preview.total_cents) throw new CopyCalculationError("TOTAL_MISMATCH", "Receipt total does not match the financial preview.");
  const enabledCount = membership.members.filter((member) => member.participation_mode === "enabled").length;

  const sections = includedNames.map((name) => {
    const member = membershipByName.get(name)!;
    const label = `${SHORT_NAMES[name]}${member.participation_mode === "keep_receipts" ? " (Keep Receipts)" : ""} ==`;
    const amounts = receiptsByMember.get(name) || [];
    const equation = amounts.length ? `${amounts.map((receipt) => formatReceiptCents(receipt.amount_cents)).join("+")}=${formatFixedCents(totals[name])}` : "0.00";
    return `${label}\n${equation}`;
  });
  sections.push(`Total ==\n${includedNames.map((name) => formatFixedCents(totals[name])).join("+")}=${formatFixedCents(grandTotal)}`);
  sections.push(`$${formatFixedCents(preview.equal_share_cents)} each${enabledCount === 4 ? "" : ` (${enabledCount} participating members)`}`);

  return { text: sections.join("\n\n"), receiptCount: uniqueReceipts.size, enabledCount, memberReceiptTotals: totals };
}

export async function writeCalculationText(text: string, clipboard: { writeText(text: string): Promise<void> } | undefined, fallback: ((text: string) => boolean) | undefined) {
  if (clipboard) return clipboard.writeText(text);
  if (fallback?.(text)) return;
  throw new Error("Clipboard access is unavailable.");
}
