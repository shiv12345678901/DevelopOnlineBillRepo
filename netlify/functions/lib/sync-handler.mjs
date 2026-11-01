import { InstaBoxError } from "./instabox.mjs";

export const HOUSEHOLD_EMAILS = new Set([
  "shiva@billforus.netlify.app",
  "arpan@billforus.netlify.app",
  "arjun@billforus.netlify.app",
  "swasti@billforus.netlify.app",
]);

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  body: JSON.stringify(body),
});

function bearerToken(headers = {}) {
  const authorization = headers.authorization || headers.Authorization || "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] || null;
}

export function createSyncStore(supabase, { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  async function findActive() {
    const { data, error } = await supabase.from("sync_requests").select("*")
      .eq("requested_by", "netlify-app").in("status", ["pending", "processing"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function createOrReuse() {
    const existing = await findActive();
    if (existing) return { request: existing, reused: true };
    const { data, error } = await supabase.from("sync_requests")
      .insert({ requested_by: "netlify-app", status: "pending" }).select("*").single();
    if (!error && data) return { request: data, reused: false };
    if (error?.code !== "23505") throw error || new Error("Could not create sync request.");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const concurrent = await findActive();
      if (concurrent) return { request: concurrent, reused: true };
      await sleep(25 * (attempt + 1));
    }
    throw new Error("Concurrent sync request could not be recovered.");
  }

  return { createOrReuse };
}

export function createSyncHandler({ createUserClient, createWakeClient, env = process.env } = {}) {
  return async function handler(event) {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." }, { Allow: "POST" });
    const token = bearerToken(event.headers);
    if (!token) return json(401, { error: "Sign in is required." });

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return json(503, { error: "Authentication is not configured." });
    }

    let supabase;
    try {
      supabase = createUserClient(token, env);
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return json(401, { error: "Your session is invalid or expired." });
      if (!HOUSEHOLD_EMAILS.has(String(data.user.email || "").toLowerCase())) {
        return json(403, { error: "This account cannot start household syncs." });
      }
    } catch {
      return json(401, { error: "Your session could not be verified." });
    }

    if (!env.INSTABOX_API_KEY || !env.INSTABOX_MACHINE_ID) {
      return json(503, { error: "Sync wake-up is not configured." });
    }

    let sync;
    try {
      sync = await createSyncStore(supabase).createOrReuse();
    } catch {
      return json(503, { error: "The sync request could not be queued." });
    }

    try {
      const wake = await createWakeClient(env.INSTABOX_API_KEY).wakeMachine({
        machineId: env.INSTABOX_MACHINE_ID,
        requestId: sync.request.id,
      });
      return json(wake.status === "ready" ? 200 : 202, { request: sync.request, reused: sync.reused, wake });
    } catch (error) {
      const retryable = error instanceof InstaBoxError && error.retryable;
      const retryAfter = retryable && error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {};
      return json(error instanceof InstaBoxError && error.status === 429 ? 429 : retryable ? 503 : 502, {
        error: retryable
          ? "The sync request is queued, but InstaBox wake-up is delayed. We’ll keep checking."
          : "The sync request is queued, but InstaBox could not be woken. Muse may still process it.",
        request: sync.request,
        reused: sync.reused,
        wake: { status: "delayed" },
      }, retryAfter);
    }
  };
}
