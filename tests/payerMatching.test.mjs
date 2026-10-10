import assert from "node:assert/strict";
import test from "node:test";
import { payerMatchesUser } from "../src/payerMatching.ts";

const user = {
  email: "shiva@billforus.netlify.app",
  user_metadata: { display_name: "Shiva Kafle", full_name: "Shiva Kafle" },
};

test("payer matching accepts exact identities but not longer prefix matches", () => {
  assert.equal(payerMatchesUser("Shiva Kafle", user), true);
  assert.equal(payerMatchesUser("Shiva", user), true);
  assert.equal(payerMatchesUser("Shiva Kafle Guest", user), false);
  assert.equal(payerMatchesUser("Shivani", user), false);
});
