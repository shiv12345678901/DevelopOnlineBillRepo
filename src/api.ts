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
  merchant: string;
  amount_cents: number;
  payer: string;
  category: string;
  date: string;
  is_excluded: boolean;
  image_url: string | null;
};

export type Settlement = {
  id: string;
  period_id: string;
  total_cents: number;
  per_person_cents: number;
  member_totals: Record<string, number>;
  receipt_count: number;
  calculated_at: string;
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
};

export type BankTransferReceipt = {
  id: string;
  period_id: string;
  step_id: string;
  from_name: string;
  to_name: string;
  amount_cents: number;
  transfer_date: string;
  receipt_url: string | null;
};

export async function fetchCurrentPeriod(): Promise<Period | null> {
  const { data } = await supabase
    .from("periods")
    .select("*")
    .eq("status", "CURRENT")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function fetchCurrentSettlement(): Promise<Settlement | null> {
  const period = await fetchCurrentPeriod();
  if (!period) return null;
  return fetchSettlementForPeriod(period.id);
}

export async function fetchSettlementForPeriod(periodId: string): Promise<Settlement | null> {
  const { data } = await supabase
    .from("settlements")
    .select("*")
    .eq("period_id", periodId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function fetchReceipts(limit = 100): Promise<Receipt[]> {
  const period = await fetchCurrentPeriod();
  if (!period) return [];
  return fetchReceiptsForPeriod(period.id, limit);
}

export async function fetchReceiptsForPeriod(periodId: string, limit = 100): Promise<Receipt[]> {
  const { data } = await supabase
    .from("receipts")
    .select("*")
    .eq("period_id", periodId)
    .eq("is_excluded", false)
    .order("date", { ascending: false })
    .limit(limit);
  return data || [];
}

export async function fetchPeriods(): Promise<Period[]> {
  const { data } = await supabase
    .from("periods")
    .select("*")
    .order("start_date", { ascending: false });
  return data || [];
}

export async function fetchBankTransferReceipts(periodId: string): Promise<BankTransferReceipt[]> {
  const { data } = await supabase
    .from("bank_transfer_receipts")
    .select("*")
    .eq("period_id", periodId)
    .order("transfer_date", { ascending: false });
  return data || [];
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
