import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("receipt loading uses period_id and not calendar date boundaries", async () => {
  const source = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
  const functionSource = source.match(
    /export async function fetchReceiptsForPeriod[\s\S]*?\r?\n}\r?\n\r?\nexport async function fetchPeriods/,
  )?.[0];

  assert.ok(functionSource, "fetchReceiptsForPeriod should exist");
  assert.match(functionSource, /\.eq\("period_id", periodId\)/);
  assert.doesNotMatch(functionSource, /\.(?:gte|lte)\("date"/);
});
