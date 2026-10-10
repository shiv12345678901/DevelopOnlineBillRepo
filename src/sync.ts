import { supabase } from "./api.ts";

export const ACTIVE_SYNC_STORAGE_KEY = "splitmate-active-sync-request-id";
export const ACTIVE_SYNC_MAX_AGE_MS = 30 * 60 * 1000;
export const SYNC_PENDING_WARNING_MS = 3 * 60 * 1000;

export type SyncRequestRow = {
  id: string;
  requested_by?: string;
  status: string;
  stage?: string | null;
  stage_message?: string | null;
  stage_updated_at?: string | null;
  result_summary?: string | null;
  error?: string | null;
  created_at?: string;
};

export type SyncState = {
  requestId: string | null;
  status: "idle" | "starting" | "pending" | "processing" | "done" | "failed" | "unreachable";
  stageMessage: string;
  resultSummary: string;
  error: string;
};

export const INITIAL_SYNC_STATE: SyncState = {
  requestId: null,
  status: "idle",
  stageMessage: "",
  resultSummary: "",
  error: "",
};

export function isActiveSyncStatus(status: string) {
  return status === "pending" || status === "processing";
}

export function isSyncUiActive(state: SyncState) {
  return ["starting", "pending", "processing", "unreachable"].includes(state.status);
}

export function syncStageMessage(request: SyncRequestRow, pendingSince: number, now = Date.now()) {
  if (request.status === "pending" && now - pendingSince >= SYNC_PENDING_WARNING_MS) {
    return "Sync service looks offline — still waiting and checking…";
  }
  if (request.stage_message) return request.stage_message;
  if (request.status === "pending") return "Waiting for the sync service…";
  return "Sync in progress…";
}

export async function fetchSyncRequest(requestId: string): Promise<SyncRequestRow | null> {
  const { data, error } = await supabase
    .from("sync_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  return data as SyncRequestRow | null;
}

export async function fetchLatestActiveSync(): Promise<SyncRequestRow | null> {
  const cutoff = new Date(Date.now() - ACTIVE_SYNC_MAX_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from("sync_requests")
    .select("*")
    .eq("requested_by", "netlify-app")
    .in("status", ["pending", "processing"])
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as SyncRequestRow | null;
}
