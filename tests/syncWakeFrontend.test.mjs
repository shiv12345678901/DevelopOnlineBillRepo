import assert from "node:assert/strict";
import test from "node:test";
import { requestSyncWake, SyncStartError } from "../src/sync.ts";

const request = { id: "11111111-1111-4111-8111-111111111111", status: "pending", requested_by: "netlify-app" };

test("frontend calls only the same-origin authenticated Netlify endpoint", async () => {
  let called;
  const result = await requestSyncWake("user-jwt", async (url, options) => {
    called = { url, options };
    return new Response(JSON.stringify({ request, reused: false, wake: { status: "waking" } }), { status: 202, headers: { "Content-Type": "application/json" } });
  });
  assert.equal(called.url, "/api/sync");
  assert.equal(called.options.headers.Authorization, "Bearer user-jwt");
  assert.equal(result.request.id, request.id);
  assert.equal(result.wake.status, "waking");
});

test("a wake API failure keeps the created request available for polling", async () => {
  await assert.rejects(
    () => requestSyncWake("user-jwt", async () => new Response(JSON.stringify({ error: "Wake delayed", request, wake: { status: "delayed" } }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": "30" },
    })),
    (error) => error instanceof SyncStartError && error.request?.id === request.id && error.retryAfterSeconds === 30,
  );
});
