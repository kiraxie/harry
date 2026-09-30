import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ");
const between = (text: string, from: string, to: string): string => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `no section from "${from}" to "${to}"`);
  return text.slice(start, end);
};
const DIMS = read(path.join("references", "audit", "SCAN-DIMENSIONS.md"));
const ROUNDS = read(path.join("references", "audit", "VALIDATION-AND-REPORTING.md"));

test("dimension 11 judges tests by red-green.md", () => {
  const eleven = between(DIMS, "## 11. Low-value tests", "### Choosing dimensions");
  assert.ok(eleven.includes("`references/red-green.md`"), eleven);
});

test("dimension 9 sends tests that exist but guard nothing to dimension 11", () => {
  const nine = between(DIMS, "## 9. Structural test-coverage holes", "## 10.");
  assert.match(nine, /dimension 11/);
});

const KINDS = ["`owner-proves`", "`guards-nothing`"];

test("Round 3 disproves a low-value-tests finding by its retention_check, per kind", () => {
  const test7 = between(ROUNDS, "7. RETENTION TEST (low-value-tests findings)", "Return one of");
  assert.ok(test7.includes("retention_check"), test7);
  for (const kind of KINDS)
    assert.ok(test7.includes(kind), `Round 3 must say how to disprove ${kind}`);
});

test("Round 5 fact-checks each kind: an owner-proves keeper exists", () => {
  const round5 = between(ROUNDS, "## Round 5", "## Round 6");
  assert.ok(round5.includes("retention_check.proof.keeper"), round5);
  for (const kind of KINDS)
    assert.ok(round5.includes(kind), `Round 5 must say what it checks for ${kind}`);
});

test("dimension-11 agents learn both kinds", () => {
  const deep = read(path.join("references", "audit", "DEEP-DIVE.md"));
  const brief = between(deep, "- retention_check (for low-value-tests findings)", "- remediation:");
  for (const kind of KINDS) assert.ok(brief.includes(kind), brief);
});

test("no /audit file still encodes guards-nothing as a none sentinel", () => {
  const dir = path.join("references", "audit");
  for (const file of readdirSync(path.join(repoRoot, dir))) {
    assert.doesNotMatch(read(path.join(dir, file)), /none: <reason>/, file);
  }
});

test("dimension 11's bar names exactly the schema's retained contracts", () => {
  const schema = JSON.parse(
    readFileSync(path.join(repoRoot, "references", "audit", "report-schema.json"), "utf-8"),
  );
  const retention = schema.output_schema.oneOf.find(
    (b: { properties?: { retention_check?: unknown } }) => b.properties?.retention_check,
  ).properties.retention_check;
  const enumKinds = retention.properties.contract.enum.filter((c: string) => c !== "none");
  const bar = between(DIMS, "**Bar:**", "### Choosing dimensions");
  const list = between(bar, "retained contract (", ")");
  const named = [...list.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...named].sort(), [...enumKinds].sort());
});

test("Round 6 hands every low-value-tests finding's deletion evidence to the report", () => {
  const round6 = between(ROUNDS, "## Round 6", "**`FINDINGS-DETAIL.md`**");
  const entry = between(round6, "**low-value-tests findings**", "`seams_unlocked`");
  assert.match(entry, /at any severity/);
  for (const field of ["kind", "keeper", "mutation", "reason"])
    assert.ok(entry.includes(`\`${field}\``), `the REPORT.md entry must show ${field}`);
  const debt = ROUNDS.slice(ROUNDS.indexOf("If the target uses a debt ledger"));
  assert.match(debt, /low-value-tests finding carries its `retention_check`/);
});

test("dimension 11's remediation names the keeper and the mutation", () => {
  const bar = between(DIMS, "**Bar:**", "### Choosing dimensions");
  assert.match(bar, /remediation names the keeper and the mutation/);
});
