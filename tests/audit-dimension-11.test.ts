import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { headingSection, section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const flatten = (text: string): string => text.replace(/\s+/g, " ");
const raw = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const read = (rel: string): string => flatten(raw(rel));
const DIMS = read(path.join("references", "audit", "SCAN-DIMENSIONS.md"));
const ROUNDS = read(path.join("references", "audit", "VALIDATION-AND-REPORTING.md"));

const dimension11 = (): string =>
  section(
    DIMS,
    "references/audit/SCAN-DIMENSIONS.md",
    "## 11. Low-value tests",
    "### Choosing dimensions",
  );

test("dimension 11 judges tests by red-green.md", () => {
  const eleven = dimension11();
  assert.ok(eleven.includes("`references/red-green.md`"), eleven);
});

test("dimension 9 sends tests that exist but guard nothing to dimension 11", () => {
  const nine = flatten(
    headingSection(
      raw("references/audit/SCAN-DIMENSIONS.md"),
      "references/audit/SCAN-DIMENSIONS.md",
      "## 9. Structural test-coverage holes",
    ),
  );
  assert.match(nine, /dimension 11/);
});

const KINDS = ["`owner-proves`", "`guards-nothing`"];

test("Round 3 disproves a low-value-tests finding by its retention_check, per kind", () => {
  const test7 = section(
    ROUNDS,
    "references/audit/VALIDATION-AND-REPORTING.md",
    "7. RETENTION TEST (low-value-tests findings)",
    "Return one of",
  );
  assert.ok(test7.includes("retention_check"), test7);
  for (const kind of KINDS)
    assert.ok(test7.includes(kind), `Round 3 must say how to disprove ${kind}`);
});

test("Round 5 fact-checks each kind: an owner-proves keeper exists", () => {
  const round5 = flatten(
    headingSection(
      raw("references/audit/VALIDATION-AND-REPORTING.md"),
      "references/audit/VALIDATION-AND-REPORTING.md",
      "## Round 5",
    ),
  );
  assert.ok(round5.includes("retention_check.proof.keeper"), round5);
  for (const kind of KINDS)
    assert.ok(round5.includes(kind), `Round 5 must say what it checks for ${kind}`);
});

test("dimension-11 agents learn both kinds", () => {
  const deep = read(path.join("references", "audit", "DEEP-DIVE.md"));
  const brief = section(
    deep,
    "references/audit/DEEP-DIVE.md",
    "- retention_check (for low-value-tests findings)",
    "- remediation:",
  );
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
  const bar = section(dimension11(), "references/audit/SCAN-DIMENSIONS.md", "**Bar:**");
  const list = section(bar, "references/audit/SCAN-DIMENSIONS.md", "retained contract (", ")");
  const named = [...list.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...named].sort(), [...enumKinds].sort());
});

test("Round 6 hands every low-value-tests finding's deletion evidence to the report", () => {
  const round6 = section(
    ROUNDS,
    "references/audit/VALIDATION-AND-REPORTING.md",
    "## Round 6",
    "**`FINDINGS-DETAIL.md`**",
  );
  const entry = section(
    round6,
    "references/audit/VALIDATION-AND-REPORTING.md",
    "**low-value-tests findings**",
    "`seams_unlocked`",
  );
  assert.match(entry, /at any severity/);
  for (const field of ["kind", "keeper", "mutation", "reason"])
    assert.ok(entry.includes(`\`${field}\``), `the REPORT.md entry must show ${field}`);
  const debt = section(
    ROUNDS,
    "references/audit/VALIDATION-AND-REPORTING.md",
    "If the target uses a debt ledger",
  );
  assert.match(debt, /low-value-tests finding carries its `retention_check`/);
});

test("dimension 11's remediation names the keeper and the mutation", () => {
  const bar = section(dimension11(), "references/audit/SCAN-DIMENSIONS.md", "**Bar:**");
  assert.match(bar, /remediation names the keeper and the mutation/);
});
