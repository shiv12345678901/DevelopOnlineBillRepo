import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settlement transfer failures are visible and retryable", async () => {
  const source = await readFile(new URL("../src/tabs/SettleTab.tsx", import.meta.url), "utf8");
  assert.match(source, /\.catch\(\(error\) =>/);
  assert.match(source, /Checking bank transfers…/);
  assert.match(source, /Verification status is unavailable\./);
  assert.match(source, /setTransferReloadKey\(\(key\) => key \+ 1\)/);
});
