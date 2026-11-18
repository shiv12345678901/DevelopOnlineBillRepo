import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyMembershipError, membershipErrorMessage, modeDescription, modeLabel, permissionsMatch } from "../src/membership.ts";

test("all membership modes retain their documented meaning", () => {
  assert.equal(modeLabel("enabled"), "Enabled");
  assert.equal(modeLabel("keep_receipts"), "Keep Receipts");
  assert.equal(modeLabel("disabled"), "Disabled");
  assert.match(modeDescription("enabled"), /equal share/);
  assert.match(modeDescription("keep_receipts"), /equal share is zero/);
  assert.match(modeDescription("disabled"), /hidden and excluded/);
});

test("permissions must agree across all authoritative RPC responses", () => {
  const admin = { can_view: true, can_edit: true, can_review_disabled_receipts: true };
  assert.equal(permissionsMatch(admin, { ...admin }, { ...admin }), true);
  assert.equal(permissionsMatch(admin, { ...admin, can_edit: false }), false);
});

test("stale revisions and lifecycle restrictions have distinct handling", () => {
  assert.equal(classifyMembershipError({ code: "P0001", message: "STALE_MEMBERSHIP_REVISION" }), "stale");
  assert.equal(classifyMembershipError({ code: "P0001", message: "CLOSED_CYCLE_MEMBERSHIP_CHANGE" }), "closed");
  assert.equal(classifyMembershipError({ code: "P0001", message: "FINALIZED_OBLIGATIONS" }), "finalized");
  assert.match(membershipErrorMessage("stale"), /loaded/);
});

test("authorization and network errors preserve safe read-only behavior", () => {
  assert.equal(classifyMembershipError({ code: "42501", message: "permission denied" }), "unauthorized");
  assert.equal(classifyMembershipError({ code: "P0001", message: "UNAUTHORIZED_MEMBERSHIP_CHANGE" }), "unauthorized");
  assert.equal(classifyMembershipError(new TypeError("Failed to fetch")), "network");
});

test("membership mutations use canonical RPC arguments and revision fencing", async () => {
  const source = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(source, /set_settlement_cycle_member_mode/);
  assert.match(source, /p_member_name: memberName/);
  assert.match(source, /p_participation_mode: participationMode/);
  assert.match(source, /p_expected_revision: expectedRevision/);
});

test("UI checks backend permissions before reads and disabled receipt review", async () => {
  const [settings, receipts] = await Promise.all([
    readFile(new URL("../src/components/SettlementMembersSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/ReceiptsTab.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(settings, /fetchSettlementCycleMembershipPermissions/);
  assert.match(settings, /if \(!nextPermissions\.can_view\)/);
  assert.match(settings, /permissionsMatch\(nextPermissions, nextMembership\.permissions, nextPreview\.permissions\)/);
  assert.match(settings, /p_expected_revision|membership\.revision/);
  assert.match(settings, /membership\.status === "CURRENT"/);
  assert.match(receipts, /permissions\.can_review_disabled_receipts \? fetchDisabledSettlementReceipts/);
  assert.match(receipts, /Manually excluded/);
  assert.match(receipts, /Membership disabled/);
});

test("production membership RPCs remain gated until backend deployment", async () => {
  const [membership, settings, receipts] = await Promise.all([
    readFile(new URL("../src/membership.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/SettlementMembersSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/ReceiptsTab.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(membership, /VITE_ENABLE_CYCLE_MEMBERSHIP === "true"/);
  assert.match(settings, /if \(!MEMBERSHIP_FEATURE_ENABLED/);
  assert.match(receipts, /if \(!MEMBERSHIP_FEATURE_ENABLED/);
});

test("admin membership controls use a binary enabled switch", async () => {
  const source = await readFile(new URL("../src/components/SettlementMembersSettings.tsx", import.meta.url), "utf8");
  assert.match(source, /permissions\?\.can_edit && membership\?\.status === "CURRENT"/);
  assert.match(source, /role="switch"/);
  assert.match(source, /aria-checked=\{enabled\}/);
  assert.match(source, /nextMode: enabled \? "disabled" : "enabled"/);
  assert.doesNotMatch(source, /MODE_OPTIONS|membership-mode-control/);
  assert.match(source, /Historical membership is read-only/);
});

test("admin-only settings stay hidden without authoritative admin permissions", async () => {
  const [members, calculation, settings] = await Promise.all([
    readFile(new URL("../src/components/SettlementMembersSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/CopyCalculationSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/SettingsTab.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(members, /permissions\?\.can_edit \|\| permissions\?\.can_review_disabled_receipts/);
  assert.match(members, /!administrator[\s\S]*?return null/);
  assert.match(calculation, /permissions\.can_edit \|\| permissions\.can_review_disabled_receipts/);
  assert.match(calculation, /if \(!adminAccess\) return null/);
  assert.doesNotMatch(settings, /<h3>Settlement Members<\/h3>/);
});

test("membership consistency still uses the authoritative financial preview", async () => {
  const source = await readFile(new URL("../src/components/SettlementMembersSettings.tsx", import.meta.url), "utf8");
  assert.match(source, /fetchSettlementCyclePreview\(period\.id\)/);
  assert.match(source, /nextMembership\.revision !== nextPreview\.revision/);
  assert.match(source, /permissionsMatch\(nextPermissions, nextMembership\.permissions, nextPreview\.permissions\)/);
  assert.doesNotMatch(source, /fmt\(preview\.|fmt\(financial\./);
});

test("ordinary pages rely on restrictive receipt RLS and exclude disabled members from Home", async () => {
  const [app, api, home] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/tabs/HomeTab.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app, /fetchEffectiveReceiptVisibility/);
  assert.match(app, /fetchReceiptsForPeriod\(targetPeriod\.id\)/);
  assert.match(api, /fetchReceiptsForPeriod[\s\S]*?\.from\("receipts"\)[\s\S]*?\.eq\("period_id", periodId\)/);
  assert.match(home, /filter\(\(member\) => member\.participation_mode !== "disabled"\)/);
  assert.match(home, /membershipPreview\?\.total_cents/);
  assert.match(home, /membershipPreview\?\.equal_share_cents/);
  assert.match(home, /membershipPreview\?\.receipt_count/);
});

test("successful changes refresh financial and receipt state before reloading membership", async () => {
  const source = await readFile(new URL("../src/components/SettlementMembersSettings.tsx", import.meta.url), "utf8");
  assert.match(source, /await onMembershipChanged\(\)/);
  assert.match(source, /await load\(true\)/);
  assert.match(source, /setPendingChange\(null\)/);
});

test("changing periods clears stale membership before loading the selected cycle", async () => {
  const source = await readFile(new URL("../src/components/SettlementMembersSettings.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!preserve\) \{[\s\S]*?setMembership\(null\)[\s\S]*?setPreview\(null\)/);
  assert.match(source, /nextMembership\.period_id !== period\.id/);
  assert.match(source, /nextPreview\.period_id !== period\.id/);
});

test("membership UI retains mobile and theme-compatible design tokens", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(css, /\.membership-mode-badge\.mode-keep_receipts/);
  assert.match(css, /\.membership-mode-badge\.mode-disabled/);
  assert.match(css, /\.membership-toggle\.enabled/);
  assert.match(css, /\.membership-toggle\.legacy/);
  assert.match(css, /var\(--surface\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
});
