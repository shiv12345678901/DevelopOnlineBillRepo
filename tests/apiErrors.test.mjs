import assert from "node:assert/strict";
import test from "node:test";
import { throwIfSupabaseError } from "../src/api.ts";

test("Supabase errors are surfaced instead of becoming empty data", () => {
  const error = { message: "permission denied", code: "42501" };
  assert.throws(() => throwIfSupabaseError(error), (thrown) => thrown === error);
  assert.doesNotThrow(() => throwIfSupabaseError(null));
});
