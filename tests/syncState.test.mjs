import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { completedSyncTimestamp, SYNC_PENDING_WARNING_MS, syncStageMessage } from "../src/sync.ts";

test("a long-pending sync warns that the service looks offline without ending polling", () => {
  const request = { id: "sync-1", status: "pending", stage_message: "Waiting" };
  assert.equal(syncStageMessage(request, 1_000, 1_000 + SYNC_PENDING_WARNING_MS - 1), "Waiting");
  assert.match(syncStageMessage(request, 1_000, 1_000 + SYNC_PENDING_WARNING_MS), /looks offline/);
});

test("only a done request stage update is accepted as a completion time", () => {
  const completedAt = "2026-11-04T01:23:45.000Z";
  assert.equal(completedSyncTimestamp({ id: "done", status: "done", stage_updated_at: completedAt }), completedAt);
  assert.equal(completedSyncTimestamp({ id: "active", status: "processing", stage_updated_at: completedAt }), null);
  assert.equal(completedSyncTimestamp({ id: "missing", status: "done" }), null);
  assert.equal(completedSyncTimestamp({ id: "invalid", status: "done", stage_updated_at: "not-a-date" }), null);
});

test("sync creation is guarded and the Settings action is disabled offline", async () => {
  const [appSource, settingsSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/SettingsTab.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /if \(!navigator\.onLine\) return;/);
  assert.match(appSource, /if \(!session\) return;/);
  assert.match(appSource, /requestSyncWake\(session\.access_token\)/);
  assert.doesNotMatch(appSource, /\.from\("sync_requests"\)\s*\.insert/);
  assert.match(settingsSource, /disabled=\{!online\}/);
});

test("latest completed Netlify sync drives the timestamp and automatic data refresh", async () => {
  const [syncSource, appSource, settingsSource, receiptsSource, homeSource, evidenceHookSource] = await Promise.all([
    readFile(new URL("../src/sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/SettingsTab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/ReceiptsTab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/HomeTab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/useTransferEvidence.ts", import.meta.url), "utf8"),
  ]);
  assert.match(syncSource, /\.eq\("requested_by", "netlify-app"\)/);
  assert.match(syncSource, /\.eq\("status", "done"\)/);
  assert.match(syncSource, /\.not\("stage_updated_at", "is", null\)/);
  assert.match(syncSource, /\.order\("stage_updated_at", \{ ascending: false \}\)/);
  assert.match(appSource, /setInterval\(checkLatestCompletion, COMPLETED_SYNC_POLL_MS\)/);
  assert.match(appSource, /document\.visibilityState === "visible"/);
  assert.match(appSource, /refreshLatestCompletedSyncRef\.current\(\)/);
  assert.match(appSource, /await refreshDataRef\.current\(\)/);
  assert.match(settingsSource, /Last synced \$\{relativeSyncTime\}/);
  assert.doesNotMatch(settingsSource, /last_scanned_at/);
  assert.match(receiptsSource, /useTransferEvidence\(periodId, settlementCalculatedAt\)/);
  assert.match(homeSource, /useTransferEvidence\(currentPeriod\?\.id \|\| null, settlement\?\.calculated_at\)/);
  assert.match(evidenceHookSource, /\[periodId, refreshKey, reloadKey\]/);
});
