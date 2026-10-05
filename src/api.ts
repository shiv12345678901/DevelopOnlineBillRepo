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
  receiptUrl: (row.receipt_image as string | null) ?? undefined,
});

export const ledgerRepository = {
  async fetch<Cycle, Entry>(): Promise<LedgerSnapshot<Cycle, Entry>> {
    const [cyclesRes, entriesRes] = await Promise.all([
      supabase
        .from("settlement_cycles")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("grocery_ledger")
        .select("*")
        .order("spent_on", { ascending: false })
        .order("id", { ascending: false }),
    ]);
    if (cyclesRes.error) throw new Error(cyclesRes.error.message);
    if (entriesRes.error) throw new Error(entriesRes.error.message);

    return {
      cycles: (cyclesRes.data ?? []).map(toCycle) as unknown as Cycle[],
      entries: (entriesRes.data ?? []).map(toEntry) as unknown as Entry[],
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
      receipt_image: e.receiptImageBase64
        ? `data:${e.receiptMimeType || "image/jpeg"};base64,${e.receiptImageBase64}`
        : null,
    }));
    let result = await supabase.from("grocery_ledger").insert(rows).select();
    // Table without the receipt_image column yet: retry without it.
    if (result.error && /receipt_image/i.test(result.error.message)) {
      result = await supabase
        .from("grocery_ledger")
        .insert(rows.map(({ receipt_image, ...rest }) => { void receipt_image; return rest; }))
        .select();
    }
    // Table without the merchant column either: strip both and retry.
    if (result.error && /merchant/i.test(result.error.message)) {
      result = await supabase
        .from("grocery_ledger")
        .insert(rows.map(({ merchant, receipt_image, ...rest }) => { void merchant; void receipt_image; return rest; }))
        .select();
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
