import assert from "node:assert/strict";
import test from "node:test";
import { add } from "./math.mjs";

// Covers `add` only — passes on the seed. The seeded `rangeSum` bug is not
// exercised here, so `node --test` is green until a bug-fix case touches it.
test("add sums two numbers", () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
});
