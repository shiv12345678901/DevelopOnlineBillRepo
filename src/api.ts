import { projectId, publicAnonKey } from "../utils/supabase/info";

export type CloudLedgerState<Cycle, Entry> = {
  cycles: Cycle[];
  entries: Entry[];
  activeId: number;
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

export async function loadLedger<Cycle, Entry>() {
  const body = await request<{ state: CloudLedgerState<Cycle, Entry> | null }>("/ledger");
  return body.state;
}

export async function saveLedger<Cycle, Entry>(state: CloudLedgerState<Cycle, Entry>) {
  await request<{ ok: true }>("/ledger", {
    method: "PUT",
    body: JSON.stringify(state),
  });
}

export async function scanReceipt(imageBase64: string, mimeType: string) {
  return request<{ amount: number | null; confidence: number }>("/ocr", {
    method: "POST",
    body: JSON.stringify({ imageBase64, mimeType }),
  });
}
