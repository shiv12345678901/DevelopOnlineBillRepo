import { createClient } from "@supabase/supabase-js";
import { projectId, publicAnonKey } from "../utils/supabase/info";

/**
 * Data layer — talks to the project's Supabase tables directly:
 *   settlement_cycles (id, name, members, starts_on, ends_on)
 *   grocery_ledger    (id, cycle_id, payer, amount, merchant, note,
 *                      ai_confidence, spent_on)
 *
 * The active cycle is a per-device preference kept in localStorage; the
 * database holds no global pointer so two people can use the app at once.
 */

export type LedgerSnapshot<Cycle, Entry> = {
  cycles: Cycle[];
  entries: Entry[];
  activeId: string | null;
};

const supabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey,
  { auth: { persistSession: false } },
);

const ACTIVE_KEY = "rockdale-active-cycle";
const STORAGE_BUCKET = "receipts";
const storagePublicBase = `https://${projectId}.supabase.co/storage/v1/object/public/${STORAGE_BUCKET}/`;

/**
 * Uploads a receipt image to the public `receipts` storage bucket and
 * returns its public URL, or null when the bucket isn't set up yet
 * (see supabase/storage-setup.sql) — callers then fall back to storing
 * the compressed image inline in the database.
 */
export async function uploadReceipt(cycleId: string, imageBase64: string, mimeType: string): Promise<string | null> {
  try {
    const binary = atob(imageBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const path = `cycle-${cycleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType: mimeType, cacheControl: "31536000", upsert: false });
    if (error) return null;
    return `${storagePublicBase}${path}`;
  } catch {
    return null;
  }
}

const toCycle = (row: Record<string, unknown>) => ({
  id: String(row.id),
  name: String(row.name),
  members: (row.members as string[]) ?? [],
  startsOn: String(row.starts_on),
  endsOn: (row.ends_on as string | null) ?? null,
});

const toEntry = (row: Record<string, unknown>) => ({
  id: String(row.id),
  cycleId: String(row.cycle_id),
  payer: String(row.payer),
  amount: Number(row.amount),
  merchant: (row.merchant as string | null) ?? undefined,
  note: (row.note as string | null) ?? "",
  spentOn: String(row.spent_on),
  confidence: Number(row.ai_confidence ?? 0),
  receiptUrl: (row.receipt_path as string | null)
    ? `${storagePublicBase}${String(row.receipt_path)}`
    : ((row.receipt_image as string | null) ?? undefined),
});

/**
 * PostgREST caps unpaginated responses (Supabase default: 1000 rows) — past
 * that, older rows silently disappear. Walk the table with range windows
 * until a short page marks the end. buildPage() must return a FRESH query
 * builder for every page; builders are single-use.
 */
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(buildPage: () => { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }> }): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildPage().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return rows;
  }
}

export const ledgerRepository = {
  async fetch<Cycle, Entry>(): Promise<LedgerSnapshot<Cycle, Entry>> {
    const [cyclesRows, entriesRows] = await Promise.all([
      // .retry(false): the app layer owns retry policy (quiet retries on
      // initial load, a visible error dialog on manual refresh) — without
      // this, postgrest-js adds its own 1s/2s/4s backoff on top.
      fetchAllRows<any>(() =>
        supabase
          .from("settlement_cycles")
          .select("*")
          .order("created_at", { ascending: false })
          .retry(false),
      ),
      fetchAllRows<any>(() =>
        supabase
          .from("grocery_ledger")
          .select("*")
          .order("spent_on", { ascending: false })
          .order("id", { ascending: false })
          .retry(false),
      ),
    ]);

    return {
      cycles: (cyclesRows ?? []).map(toCycle) as unknown as Cycle[],
      entries: (entriesRows ?? []).map(toEntry) as unknown as Entry[],
      activeId: localStorage.getItem(ACTIVE_KEY),
    };
  },

  async createCycle<Cycle>(input: Record<string, unknown>) {
    const { data, error } = await supabase
      .from("settlement_cycles")
      .insert({
        name: input.name,
        members: input.members,
        starts_on: input.startsOn,
        ends_on: input.endsOn ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toCycle(data) as unknown as Cycle;
  },

  async updateCycle<Cycle>(id: string, update: Record<string, unknown>) {
    const patch: Record<string, unknown> = {};
    if ("name" in update) patch.name = update.name;
    if ("members" in update) patch.members = update.members;
    if ("startsOn" in update) patch.starts_on = update.startsOn;
    if ("endsOn" in update) patch.ends_on = update.endsOn;
    const { data, error } = await supabase
      .from("settlement_cycles")
      .update(patch)
      .eq("id", Number(id))
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toCycle(data) as unknown as Cycle;
  },

  async setActiveCycle(id: string | null) {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  },

  async createEntries<Entry>(entries: Array<Record<string, unknown>>) {
    const rows = entries.map((e) => ({
      cycle_id: Number(e.cycleId),
      payer: e.payer,
      amount: e.amount,
      merchant: (e.merchant as string) || null,
      note: (e.note as string) || null,
      ai_confidence: e.confidence ?? null,
      spent_on: e.spentOn,
      receipt_path: (e.receiptUrl as string | null) ?? null,
      receipt_image: e.receiptImageBase64
        ? `data:${e.receiptMimeType || "image/jpeg"};base64,${e.receiptImageBase64}`
        : null,
    }));
    // Optional columns are stripped one by one if the table predates them.
    const optionalColumns = ["receipt_path", "merchant", "receipt_image"] as const;
    let attemptRows: Array<Record<string, unknown>> = rows;
    let result = await supabase.from("grocery_ledger").insert(attemptRows).select();
    for (const column of optionalColumns) {
      if (!result.error || !new RegExp(column, "i").test(result.error.message)) continue;
      attemptRows = attemptRows.map((row) => {
        const { [column]: dropped, ...rest } = row;
        void dropped;
        return rest;
      });
      result = await supabase.from("grocery_ledger").insert(attemptRows).select();
    }
    if (result.error) throw new Error(result.error.message);
    return (result.data ?? []).map(toEntry) as unknown as Entry[];
  },

  async deleteEntry(id: string) {
    const { error } = await supabase
      .from("grocery_ledger")
      .delete()
      .eq("id", Number(id));
    if (error) throw new Error(error.message);
  },

  async updateEntry<Entry>(id: string, update: Record<string, unknown>) {
    const patch: Record<string, unknown> = {};
    if ("payer" in update) patch.payer = update.payer;
    if ("amount" in update) patch.amount = update.amount;
    if ("merchant" in update) patch.merchant = update.merchant || null;
    if ("note" in update) patch.note = update.note || null;
    if ("spentOn" in update) patch.spent_on = update.spentOn;
    let result = await supabase
      .from("grocery_ledger")
      .update(patch)
      .eq("id", Number(id))
      .select()
      .single();
    // Table without the merchant column yet: retry without it.
    if (result.error && /merchant/i.test(result.error.message)) {
      const { merchant, ...rest } = patch;
      void merchant;
      result = await supabase
        .from("grocery_ledger")
        .update(rest)
        .eq("id", Number(id))
        .select()
        .single();
    }
    if (result.error) throw new Error(result.error.message);
    return toEntry(result.data) as unknown as Entry;
  },
};

export async function scanReceipt(imageBase64: string, mimeType: string) {
  const response = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mimeType }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `OCR failed (${response.status})`);
  return body as { amount: number | null; merchant: string; confidence: number };
}

/**
 * Per-device preferences (active cycle, theme), persisted in the database so
 * the experience follows the user like an account switch. All functions
 * degrade quietly when the user_preferences table hasn't been created yet
 * (see supabase/preferences-setup.sql).
 */

export type Preferences = {
  activeCycleId: string | null;
  theme: "auto" | "light" | "dark";
};

export async function fetchPreferences(deviceId: string): Promise<Preferences | null> {
  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("active_cycle_id, theme")
      .eq("id", deviceId)
      .maybeSingle()
      .retry(false);
    if (error || !data) return null;
    const theme = data.theme === "light" || data.theme === "dark" ? data.theme : "auto";
    return { activeCycleId: data.active_cycle_id != null ? String(data.active_cycle_id) : null, theme };
  } catch {
    return null;
  }
}

export async function savePreferences(deviceId: string, patch: Partial<Preferences>): Promise<boolean> {
  try {
    const row: Record<string, unknown> = {
      id: deviceId,
      updated_at: new Date().toISOString(),
      ...(patch.activeCycleId !== undefined ? { active_cycle_id: patch.activeCycleId == null ? null : Number(patch.activeCycleId) } : {}),
      ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
    };
    const { error } = await supabase.from("user_preferences").upsert(row);
    return !error;
  } catch {
    return false;
  }
}
