import assert from "node:assert/strict";
import test from "node:test";
import { formatRelativeTime } from "../src/components/format.ts";

test("sync-relative time uses readable minute wording", () => {
  const now = Date.parse("2026-11-04T02:00:00.000Z");
  assert.equal(formatRelativeTime("2026-11-04T01:59:30.000Z", now), "just now");
  assert.equal(formatRelativeTime("2026-11-04T01:59:00.000Z", now), "1 minute ago");
  assert.equal(formatRelativeTime("2026-11-04T01:55:00.000Z", now), "5 minutes ago");
});
