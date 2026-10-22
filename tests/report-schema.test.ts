import assert from "node:assert/strict";
import test from "node:test";
import { type Branch, confirmedBranch, SCHEMA } from "./report-schema.ts";

const branch = (verdict: string): Branch => ({ properties: { verdict: { const: verdict } } });

test("the confirmed branch is found by its verdict, in any order", () => {
  assert.equal(confirmedBranch().properties.verdict.const, "confirmed");
  const confirmed = branch("confirmed");
  assert.equal(
    confirmedBranch({ output_schema: { oneOf: [branch("rejected"), confirmed] } }),
    confirmed,
    "the confirmed branch is read by position, not by its verdict",
  );
  assert.ok(SCHEMA.output_schema.oneOf.length > 1, "report-schema.json lost its verdict branches");
});

test("a schema with no confirmed branch fails naming report-schema.json", () => {
  assert.throws(
    () => confirmedBranch({ output_schema: { oneOf: [branch("rejected")] } }),
    /report-schema\.json has no output_schema\.oneOf branch whose verdict is "confirmed"/,
  );
});
