import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { InstaBoxError } from "../netlify/functions/lib/instabox.mjs";
import { createSyncHandler } from "../netlify/functions/lib/sync-handler.mjs";

const ENV = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "anon", INSTABOX_API_KEY: "ibk_secret", INSTABOX_MACHINE_ID: "m_configured" };
const REQUEST = { id: "11111111-1111-4111-8111-111111111111", requested_by: "netlify-app", status: "pending", created_at: new Date().toISOString() };

function supabaseFixture({ email = "shiva@billforus.netlify.app", active = null, inserted = REQUEST, insertError = null, activeAfterConflict = null } = {}) {
  let findCount = 0;
  const state = { inserts: [] };
  return {
    state,
    client: {
      auth: { getUser: async () => ({ data: { user: { email } }, error: null }) },
      from: () => {
        const query = {
          select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
          maybeSingle: async () => ({ data: findCount++ === 0 ? active : activeAfterConflict, error: null }),
          insert: (value) => { state.inserts.push(value); return query; },
          single: async () => ({ data: insertError ? null : inserted, error: insertError }),
        };
        return query;
      },
    },
  };
}

const event = { httpMethod: "POST", headers: { authorization: "Bearer household-token" } };

test("the endpoint rejects missing authentication before touching Supabase or InstaBox", async () => {
  let called = false;
  const handler = createSyncHandler({
    env: ENV,
    createUserClient: () => { called = true; },
    createWakeClient: () => { called = true; },
  });
  const response = await handler({ httpMethod: "POST", headers: {} });
  assert.equal(response.statusCode, 401);
  assert.equal(called, false);
});

test("only an allowlisted household account may wake the configured machine", async () => {
  const fixture = supabaseFixture({ email: "outsider@example.com" });
  let woke = false;
  const handler = createSyncHandler({ env: ENV, createUserClient: () => fixture.client, createWakeClient: () => ({ wakeMachine: async () => { woke = true; } }) });
  const response = await handler(event);
  assert.equal(response.statusCode, 403);
  assert.equal(woke, false);
  assert.equal(fixture.state.inserts.length, 0);
});

test("an invalid session does not disclose whether InstaBox is configured", async () => {
  const fixture = supabaseFixture({ email: "intruder@example.com" });
  fixture.client.auth.getUser = async () => ({ data: { user: null }, error: new Error("invalid") });
  const handler = createSyncHandler({
    env: { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_ANON_KEY: ENV.SUPABASE_ANON_KEY },
    createUserClient: () => fixture.client,
    createWakeClient: () => { throw new Error("must not instantiate"); },
  });
  const response = await handler(event);
  assert.equal(response.statusCode, 401);
  assert.doesNotMatch(response.body, /configured|InstaBox/i);
});

test("an active request is reused and wakes only the configured machine", async () => {
  const fixture = supabaseFixture({ active: REQUEST });
  let wakeArgs;
  const handler = createSyncHandler({
    env: ENV,
    createUserClient: () => fixture.client,
    createWakeClient: (key) => {
      assert.equal(key, "ibk_secret");
      return { wakeMachine: async (args) => { wakeArgs = args; return { status: "waking", machineState: "starting" }; } };
    },
  });
  const response = await handler(event);
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 202);
  assert.equal(body.reused, true);
  assert.deepEqual(wakeArgs, { machineId: "m_configured", requestId: REQUEST.id });
  assert.equal(fixture.state.inserts.length, 0);
  assert.doesNotMatch(response.body, /ibk_secret/);
});

test("a uniqueness race recovers the concurrent pending request", async () => {
  const fixture = supabaseFixture({ insertError: { code: "23505" }, activeAfterConflict: REQUEST });
  const handler = createSyncHandler({
    env: ENV,
    createUserClient: () => fixture.client,
    createWakeClient: () => ({ wakeMachine: async () => ({ status: "ready", machineState: "running" }) }),
  });
  const response = await handler(event);
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.reused, true);
  assert.equal(body.request.id, REQUEST.id);
  assert.deepEqual(fixture.state.inserts, [{ requested_by: "netlify-app", status: "pending" }]);
});

test("wake failures retain the queued request and expose no provider detail", async () => {
  const fixture = supabaseFixture();
  const handler = createSyncHandler({
    env: ENV,
    createUserClient: () => fixture.client,
    createWakeClient: () => ({ wakeMachine: async () => { throw new InstaBoxError("private provider detail", { code: "machine_cooldown", status: 429, retryable: true, retryAfterSeconds: 45 }); } }),
  });
  const response = await handler(event);
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["Retry-After"], "45");
  assert.equal(body.request.id, REQUEST.id);
  assert.equal(body.wake.status, "delayed");
  assert.doesNotMatch(response.body, /private provider detail|ibk_secret|m_configured/);
});

test("browser and Netlify sources keep InstaBox credentials server-only", async () => {
  const [app, sync, fn, handlerSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/sync.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/lib/sync-handler.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app + sync, /INSTABOX_|api\.instabox\.sh|service_role/i);
  assert.match(handlerSource, /INSTABOX_API_KEY/);
  assert.match(handlerSource, /INSTABOX_MACHINE_ID/);
  assert.match(fn, /SUPABASE_ANON_KEY/);
});
