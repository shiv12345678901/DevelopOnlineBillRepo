import { createClient } from "@supabase/supabase-js";
import { createInstaBoxClient } from "./lib/instabox.mjs";
import { createSyncHandler } from "./lib/sync-handler.mjs";

function createUserClient(token, env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export const handler = createSyncHandler({
  createUserClient,
  createWakeClient: (apiKey) => createInstaBoxClient({ apiKey }),
});
