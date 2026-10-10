import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SYNC_PENDING_WARNING_MS, syncStageMessage } from "../src/sync.ts";

test("a long-pending sync warns that the service looks offline without ending polling", () => {
  const request = { id: "sync-1", status: "pending", stage_message: "Waiting" };
  assert.equal(syncStageMessage(request, 1_000, 1_000 + SYNC_PENDING_WARNING_MS - 1), "Waiting");
  assert.match(syncStageMessage(request, 1_000, 1_000 + SYNC_PENDING_WARNING_MS), /looks offline/);
});

test("sync creation is guarded and the Settings action is disabled offline", async () => {
  const [appSource, settingsSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/SettingsTab.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /if \(!navigator\.onLine\) return;/);
  assert.match(settingsSource, /disabled=\{!online\}/);
});
