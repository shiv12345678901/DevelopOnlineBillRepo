import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("app refresh ignores stale requests and exposes failures", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /const generation = \+\+refreshGenerationRef\.current/);
  assert.match(source, /if \(generation !== refreshGenerationRef\.current\) return;/);
  assert.match(source, /setDataError\(`Couldn’t refresh your bills\./);
  assert.match(source, /className="data-error-banner" role="alert"/);
});
