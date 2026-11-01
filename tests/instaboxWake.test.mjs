import assert from "node:assert/strict";
import test from "node:test";
import { createInstaBoxClient, InstaBoxError } from "../netlify/functions/lib/instabox.mjs";

const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...headers },
});

test("a ready machine is reused without a lifecycle mutation", async () => {
  const calls = [];
  const client = createInstaBoxClient({ apiKey: "secret", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ state: "running", runtime: { ready: true }, cooldownUntil: null });
  } });
  const result = await client.wakeMachine({ machineId: "m_test", requestId: "job-1" });
  assert.equal(result.status, "ready");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["X-API-Key"], "secret");
});

test("a suspended machine uses resume with a stable idempotency key and follows the operation", async () => {
  const calls = [];
  const responses = [
    jsonResponse({ state: "suspended", runtime: { ready: false }, cooldownUntil: null }),
    jsonResponse({ id: "op_resume", state: "queued" }, 202),
    jsonResponse({ id: "op_resume", state: "succeeded", machine: { state: "running", runtime: { ready: true } } }),
  ];
  const client = createInstaBoxClient({ apiKey: "secret", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return responses.shift();
  } });
  const result = await client.wakeMachine({ machineId: "m_test", requestId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(result.status, "ready");
  assert.match(calls[1].url, /\/v1\/machines\/m_test\/resume$/);
  assert.match(calls[1].options.headers["Idempotency-Key"], /^billforus-sync-11111111-1111-4111-8111-111111111111-resume-[a-z0-9]+$/);
  assert.match(calls[2].url, /\/v1\/operations\/op_resume\?wait=8s$/);
});

test("a stopped machine retries a retryable start with the same idempotency key", async () => {
  const calls = [];
  const delays = [];
  const responses = [
    jsonResponse({ state: "stopped", runtime: { ready: false }, cooldownUntil: null }),
    jsonResponse({ error: { code: "no_capacity", message: "later", retryable: true, retryAfterSeconds: 1, operationId: null } }, 503, { "Retry-After": "1" }),
    jsonResponse({ id: "op_start", state: "succeeded", machine: { state: "running", runtime: { ready: true } } }, 202),
  ];
  const client = createInstaBoxClient({
    apiKey: "secret",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return responses.shift(); },
    sleep: async (delay) => delays.push(delay),
  });
  const result = await client.wakeMachine({ machineId: "m_test", requestId: "job-2" });
  assert.equal(result.status, "ready");
  assert.deepEqual(delays, [1_000]);
  assert.equal(calls[1].options.headers["Idempotency-Key"], calls[2].options.headers["Idempotency-Key"]);
  assert.match(calls[1].url, /\/start$/);
});

test("machine cooldown is reported without calling start or resume", async () => {
  const calls = [];
  const client = createInstaBoxClient({ apiKey: "secret", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ state: "suspended", runtime: { ready: false }, cooldownUntil: new Date(Date.now() + 60_000).toISOString() });
  } });
  await assert.rejects(
    () => client.wakeMachine({ machineId: "m_test", requestId: "job-3" }),
    (error) => error instanceof InstaBoxError && error.code === "machine_cooldown" && error.retryable,
  );
  assert.equal(calls.length, 1);
});

test("an existing transition is followed instead of starting a competing operation", async () => {
  const calls = [];
  const responses = [
    jsonResponse({ state: "starting", operationId: "op_existing", runtime: { ready: false }, cooldownUntil: null }),
    jsonResponse({ id: "op_existing", state: "running" }),
  ];
  const client = createInstaBoxClient({ apiKey: "secret", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return responses.shift();
  } });
  const result = await client.wakeMachine({ machineId: "m_test", requestId: "job-4" });
  assert.equal(result.status, "waking");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/operations\/op_existing/);
});
