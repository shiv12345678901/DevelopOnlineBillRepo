import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://oisbygwncnperuxfkvfd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pc2J5Z3duY25wZXJ1eGZrdmZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNzg0ODcsImV4cCI6MjEwNjc1NDQ4N30.Zp4mhbNt2DPT1ricYwf0BlWbEz22pJBk4AfQoFDQUyQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    experimental: { passkey: true },
  },
});

export type Receipt = {
  id: string;
  period_id: string;
  captured_at: string | null;
  merchant: string;
  amount_cents: number;
  payer: string;
  category: string;
  date: string;
  is_excluded: boolean;
  image_url: string | null;
};

export type WhatsAppCycleStatus = "ACTIVE" | "PENDING_SETTLEMENT" | "SETTLED" | "UNCONFIRMED";

export type PaymentObligationsStatus = "UNINITIALIZED" | "REVIEWED";

// Reviewed obligations are stored as a nested member-to-member amount matrix.
// Transfer direction must not be inferred from this object in the frontend.
export type PaymentObligations = Record<string, Record<string, number>>;

export type Settlement = {
  id: string;
  period_id: string;
  total_cents: number;
  per_person_cents: number;
  member_totals: Record<string, number>;
  receipt_count: number;
  calculated_at: string;
  owes: PaymentObligations | null;
  payment_obligations_status: PaymentObligationsStatus | null;
};

export type Period = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  total_cents: number;
  per_person_cents: number;
  receipt_count: number;
  last_scanned_at?: string | null;
  whatsapp_cycle_status?: WhatsAppCycleStatus | null;
  whatsapp_calculation_message?: { id?: string; text?: string; timestamp?: number; timeStr?: string } | null;
  whatsapp_clearance_message?: { id?: string; text?: string; timestamp?: number; timeStr?: string } | null;
  whatsapp_cycle_updated_at?: string | null;
};

export type BankTransferReceipt = {
  id: string;
  period_id: string;
  step_id: string;
  from_name: string | null;
  to_name: string | null;
  amount_cents: number;
  transfer_date: string;
  receipt_url: string | null;
  verification_status: "pending" | "verified" | "rejected" | string | null;
  verified_at?: string | null;
};

export type WhatsAppBankTransferEvidence = {
  id: string;
  period_id: string;
  sender_name: string | null;
  recipient_name: string | null;
  amount_cents: number | null;
  transfer_date: string | null;
  reference_number: string | null;
  evidence_url: string | null;
  review_status: "pending" | "reviewed" | "dismissed" | string | null;
  captured_at: string | null;
};

export type ParticipationMode = "enabled" | "keep_receipts" | "disabled";

export type MembershipPermissions = {
  can_view: boolean;
  can_edit: boolean;
  can_review_disabled_receipts: boolean;
};

export type SettlementCycleMember = {
  member_name: string;
  participation_mode: ParticipationMode;
};

export type SettlementCycleMembership = {
  period_id: string;
  revision: number;
  status: string;
  members: SettlementCycleMember[];
  permissions: MembershipPermissions;
};

export type SettlementCycleMemberPreview = SettlementCycleMember & {
  paid_cents: number;
  share_cents: number;
  net_cents: number;
};

export type SettlementCyclePreview = {
  period_id: string;
  revision: number;
  total_cents: number;
  receipt_count: number;
  equal_share_cents: number;
  members: SettlementCycleMemberPreview[];
  permissions: MembershipPermissions;
};

export type EffectiveReceiptVisibility = {
  receipt_id: string;
  payer: string;
  mode: ParticipationMode;
  visible: boolean;
  eligible: boolean;
  manually_excluded: boolean;
};

export function throwIfSupabaseError(error: unknown): void {
  if (error) throw error;
}

export async function fetchCurrentPeriod(): Promise<Period | null> {
  const { data, error } = await supabase
    .from("periods")
    .select("*")
    .eq("status", "CURRENT")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(error);
  return data;
}

export async function fetchCurrentSettlement(): Promise<Settlement | null> {
  const period = await fetchCurrentPeriod();
  if (!period) return null;
  return fetchSettlementForPeriod(period.id);
}

export async function fetchSettlementForPeriod(periodId: string): Promise<Settlement | null> {
  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("period_id", periodId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(error);
  return data;
}

export async function fetchReceipts(limit = 100): Promise<Receipt[]> {
  const period = await fetchCurrentPeriod();
  if (!period) return [];
  return fetchReceiptsForPeriod(period.id, limit);
}

export async function fetchReceiptsForPeriod(periodId: string, limit = 100): Promise<Receipt[]> {
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("period_id", periodId)
    .eq("is_excluded", false)
    .order("date", { ascending: false })
    .limit(limit);
  throwIfSupabaseError(error);
  return data || [];
}

export async function fetchAllEligibleReceiptsForPeriod(periodId: string, pageSize = 500): Promise<Receipt[]> {
  const receipts: Receipt[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("receipts")
      .select("id,period_id,captured_at,merchant,amount_cents,payer,category,date,is_excluded,image_url")
      .eq("period_id", periodId)
      .eq("is_excluded", false)
      .order("date", { ascending: true })
      .order("captured_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    throwIfSupabaseError(error);
    const page = (data || []) as Receipt[];
    receipts.push(...page);
    if (page.length < pageSize) break;
  }
  return receipts;
}

export async function fetchPeriods(): Promise<Period[]> {
  const { data, error } = await supabase
    .from("periods")
    .select("*")
    .order("start_date", { ascending: false });
  throwIfSupabaseError(error);
  return data || [];
}

export async function fetchBankTransferReceipts(periodId: string): Promise<BankTransferReceipt[]> {
  const { data, error } = await supabase
    .from("bank_transfer_receipts")
    .select("*")
    .eq("period_id", periodId)
    .order("transfer_date", { ascending: false });
  throwIfSupabaseError(error);
  return data || [];
}

export async function fetchWhatsAppBankTransferEvidence(periodId: string): Promise<WhatsAppBankTransferEvidence[]> {
  const { data, error } = await supabase
    .from("whatsapp_bank_transfer_evidence")
    .select("id,period_id,sender_name,recipient_name,amount_cents,transfer_date,reference_number,evidence_url,review_status,captured_at")
    .eq("period_id", periodId)
    .order("captured_at", { ascending: false });
  throwIfSupabaseError(error);
  return data || [];
}

export async function fetchWhatsAppTransferEvidence(periodId: string): Promise<Receipt[]> {
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("period_id", periodId)
    .eq("is_excluded", true)
    .in("merchant", ["Bank Transfer", "Payment Transfer"])
    .order("captured_at", { ascending: false });
  throwIfSupabaseError(error);
  return data || [];
}

export async function fetchSettlementCycleMembershipPermissions(periodId: string): Promise<MembershipPermissions> {
  const { data, error } = await supabase.rpc("get_settlement_cycle_membership_permissions", { p_period_id: periodId });
  throwIfSupabaseError(error);
  return data as MembershipPermissions;
}

export async function fetchSettlementCycleMembership(periodId: string): Promise<SettlementCycleMembership> {
  const { data, error } = await supabase.rpc("get_settlement_cycle_membership", { p_period_id: periodId });
  throwIfSupabaseError(error);
  return data as SettlementCycleMembership;
}

export async function fetchSettlementCyclePreview(periodId: string): Promise<SettlementCyclePreview> {
  const { data, error } = await supabase.rpc("preview_settlement_cycle_membership", { p_period_id: periodId });
  throwIfSupabaseError(error);
  return data as SettlementCyclePreview;
}

export async function setSettlementCycleMemberMode(periodId: string, memberName: string, participationMode: ParticipationMode, expectedRevision: number): Promise<SettlementCycleMembership> {
  const { data, error } = await supabase.rpc("set_settlement_cycle_member_mode", {
    p_period_id: periodId,
    p_member_name: memberName,
    p_participation_mode: participationMode,
    p_expected_revision: expectedRevision,
  });
  throwIfSupabaseError(error);
  return data as SettlementCycleMembership;
}

export async function fetchEffectiveReceiptVisibility(periodId: string): Promise<EffectiveReceiptVisibility[]> {
  const { data, error } = await supabase.rpc("get_effective_receipt_visibility", { p_period_id: periodId });
  throwIfSupabaseError(error);
  return (data || []) as EffectiveReceiptVisibility[];
}

export async function fetchDisabledSettlementReceipts(periodId: string): Promise<Receipt[]> {
  const { data, error } = await supabase.rpc("get_disabled_settlement_receipts", { p_period_id: periodId });
  throwIfSupabaseError(error);
  return (data || []) as Receipt[];
}

const evidenceUrlCache = new Map<string, { url: string; expiresAt: number }>();
const avatarUrlCache = new Map<string, { url: string; expiresAt: number }>();

export function memberNameKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Resolve the household members' private avatar paths through the Supabase RPC,
 * then turn them into short-lived signed URLs for the current session.
 * Missing schema/policies are treated as an empty result so the initials icon
 * remains a safe fallback until the SQL setup has been applied.
 */
export async function fetchMemberAvatarUrls(): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc("get_member_avatar_paths");
  if (error || !Array.isArray(data)) return {};

  const entries = await Promise.all(
    data
      .filter((row): row is { member_name: string; avatar_path: string } => Boolean(row?.member_name && row?.avatar_path))
      .map(async (row) => {
        const cached = avatarUrlCache.get(row.avatar_path);
        if (cached && cached.expiresAt > Date.now()) {
          return [memberNameKey(row.member_name), cached.url] as const;
        }

        const { data: signedData, error: signedError } = await supabase.storage
          .from("avatars")
          .createSignedUrl(row.avatar_path, 60 * 60 * 24 * 7);
        if (signedError || !signedData?.signedUrl) return null;
        avatarUrlCache.set(row.avatar_path, {
          url: signedData.signedUrl,
          expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
        });
        return [memberNameKey(row.member_name), signedData.signedUrl] as const;
      }),
  );

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
}

export async function createEvidenceSignedUrl(locator: string, expiresIn = 600) {
  const cached = evidenceUrlCache.get(locator);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const match = /^storage:\/\/([^/]+)\/(.+)$/.exec(locator);
  if (!match) throw new Error("This evidence link is invalid.");
  const [, bucket, objectPath] = match;
  if (bucket !== "bill-evidence" || !objectPath || objectPath.includes("..")) {
    throw new Error("This evidence link is not allowed.");
  }

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, expiresIn);
  if (error || !data?.signedUrl) throw error || new Error("Could not open this evidence image.");
  evidenceUrlCache.set(locator, { url: data.signedUrl, expiresAt: Date.now() + (expiresIn - 30) * 1000 });
  return data.signedUrl;
}

export const fmt = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
