import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("bank receipt failures are visible and retryable", async () => {
  const [source, hookSource] = await Promise.all([
    readFile(new URL("../src/tabs/ReceiptsTab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/useTransferEvidence.ts", import.meta.url), "utf8"),
  ]);
  assert.match(hookSource, /Promise\.allSettled/);
  assert.match(hookSource, /Couldn’t load all bank-transfer evidence/);
  assert.match(source, /Verification remains unknown/);
  assert.match(source, /transferEvidence\.retry/);
});
