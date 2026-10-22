import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

test("validate-findings.cjs loads as a module without running its CLI", () => {
  const validator = fileURLToPath(
    new URL("../references/audit/validate-findings.cjs", import.meta.url),
  );
  const load = `process.stdout.write(JSON.stringify(Object.keys(require(${JSON.stringify(validator)}))))`;
  const run = spawnSync(process.execPath, ["-e", load], { encoding: "utf8" });
  assert.equal(run.stderr, "");
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '["NAMES","confirmedBranch"]');
});
