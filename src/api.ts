import { projectId, publicAnonKey } from "../utils/supabase/info";

export type LedgerSnapshot<Cycle, Entry> = {
  cycles: Cycle[];
  entries: Entry[];
  activeId: string | null;
};

const serverUrl = `https://${projectId}.supabase.co/functions/v1/make-server-3d31521b`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${publicAnonKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body as T;
}

export const ledgerRepository = {
  async fetch<Cycle, Entry>() {
    return request<LedgerSnapshot<Cycle, Entry>>("/ledger");
  },

  async createCycle<Cycle>(input: Omit<Cycle, "id">) {
    const body = await request<{ cycle: Cycle }>("/cycles", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return body.cycle;
  },

  async updateCycle<Cycle>(id: string, update: Partial<Cycle>) {
    const body = await request<{ cycle: Cycle }>(`/cycles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    });
    return body.cycle;
  },

  async setActiveCycle(id: string | null) {
    await request<{ ok: true }>("/ledger/active", {
      method: "PUT",
      body: JSON.stringify({ activeId: id }),
    });
  },

  async createEntries<Entry>(entries: Array<Omit<Entry, "id">>) {
    const body = await request<{ entries: Entry[] }>("/entries", {
      method: "POST",
      body: JSON.stringify({ entries }),
    });
    return body.entries;
  },

  async deleteEntry(id: string) {
    await request<{ ok: true }>(`/entries/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};

export async function scanReceipt(imageBase64: string, mimeType: string) {
  return request<{ amount: number | null; merchant: string; confidence: number }>("/ocr", {
    method: "POST",
    body: JSON.stringify({ imageBase64, mimeType }),
  });
}
