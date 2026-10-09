import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://oisbygwncnperuxfkvfd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pc2J5Z3duY25wZXJ1eGZrdmZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNzg0ODcsImV4cCI6MjEwNjc1NDQ4N30.Zp4mhbNt2DPT1ricYwf0BlWbEz22pJBk4AfQoFDQUyQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

export type Receipt = {
  id: string;
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
};

export async function fetchCurrentSettlement(): Promise<Settlement | null> {
  const { data } = await supabase
    .from("settlements")
    .select("*")
    .order("calculated_at", { ascending: false })
    .limit(1)
    .single();
  return data;
}

export async function fetchReceipts(limit = 100): Promise<Receipt[]> {
  const { data } = await supabase
    .from("receipts")
    .select("*")
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

export const fmt = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
