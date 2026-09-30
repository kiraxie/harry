import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const VALIDATOR = path.join(repoRoot, "references/audit/validate-findings.cjs");
const dir = mkdtempSync(path.join(os.tmpdir(), "harry-audit-validator-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const RETENTION = {
  detects: "a rename of the retry constant",
  contract: "none",
  seams_unlocked: ["src/retry.ts: export resetRetryState"],
  proof: {
    kind: "owner-proves",
    keeper: "tests/retry.test.ts: retries a failed send three times",
    mutation: "drop the retry loop in src/retry.ts; the keeper must go red",
  },
};

const GUARDS_NOTHING = {
  detects: "nothing: it asserts MAX_RETRIES equals 3",
  contract: "none",
  seams_unlocked: [],
  proof: { kind: "guards-nothing", reason: "no bug in the retry loop can change a constant" },
};

const withProof = (base: typeof RETENTION | typeof GUARDS_NOTHING, proof: object) => ({
  ...base,
  proof: { ...base.proof, ...proof },
});
const without = (o: object, key: string) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

function lowValueFinding(retention: object | undefined): object {
  return {
    verdict: "confirmed",
    title: "retry-constant test restates a constant",
    dimension: "low-value-tests",
    description: "asserts MAX_RETRIES equals 3",
    concrete_cost: "fails on every redesign of the retry policy, never on a retry bug",
    evidence: [{ file: "tests/constants.test.ts", line: 4, note: "the assertion" }],
    remediation: { strategy: "delete the test; the keeper already proves retries" },
    classification: "fix-now",
    severity: {
      blast_radius: { score: "low", reason: "one test" },
      change_likelihood: { score: "medium", reason: "retry policy changes quarterly" },
      overall: "low",
    },
    confidence: { score: "high", reason: "read the test and the keeper" },
    ...(retention ? { retention_check: retention } : {}),
  };
}

function validate(finding: object): { status: number | null; out: string } {
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify([finding]));
  const run = spawnSync(process.execPath, [VALIDATOR, file], { encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

for (const { name, finding } of [
  { name: "a complete low-value-tests finding", finding: lowValueFinding(RETENTION) },
  { name: "a finding whose test guards nothing", finding: lowValueFinding(GUARDS_NOTHING) },
  {
    name: "a rejected finding",
    finding: { verdict: "rejected", title: "retry test", reason: "guards the public retry API" },
  },
]) {
  test(`${name} passes`, () => {
    const run = validate(finding);
    assert.equal(run.status, 0, run.out);
  });
}

for (const { name, retention, reason, not } of [
  { name: "without retention_check", retention: undefined, reason: /requires a retention_check/ },
  {
    name: "guarding a retained contract",
    retention: { ...RETENTION, contract: "public-api" },
    reason: /retention_check\.contract .*must be rejected/,
  },
  {
    name: "that guards nothing yet claims a retained contract",
    retention: { ...GUARDS_NOTHING, contract: "public-api" },
    reason: /retention_check\.contract .*must be rejected/,
  },
  {
    name: "whose contract is not one of the named kinds",
    retention: { ...RETENTION, contract: "None" },
    reason: /retention_check\.contract.*(enum|one of)/,
    not: /must be rejected/,
  },
  {
    name: "missing seams_unlocked",
    retention: without(RETENTION, "seams_unlocked"),
    reason: /retention_check: missing required field "seams_unlocked"/,
  },
  {
    name: "that guards nothing and omits seams_unlocked",
    retention: without(GUARDS_NOTHING, "seams_unlocked"),
    reason: /retention_check: missing required field "seams_unlocked"/,
  },
  {
    name: "without a proof",
    retention: without(RETENTION, "proof"),
    reason: /retention_check: missing required field "proof"/,
  },
  {
    name: "that guards nothing yet names a keeper",
    retention: withProof(GUARDS_NOTHING, { keeper: "tests/retry.test.ts: retries" }),
    reason: /retention_check\.proof: unexpected field "keeper"/,
  },
  {
    name: "that guards nothing yet names a mutation",
    retention: withProof(GUARDS_NOTHING, { mutation: "drop the retry loop" }),
    reason: /retention_check\.proof: unexpected field "mutation"/,
  },
  {
    name: "whose owner proves it yet gives a reason",
    retention: withProof(RETENTION, { reason: "guards nothing" }),
    reason: /retention_check\.proof: unexpected field "reason"/,
  },
  {
    name: "whose owner proves it but gives no mutation",
    retention: { ...RETENTION, proof: without(RETENTION.proof, "mutation") },
    reason: /retention_check\.proof: missing required field "mutation"/,
  },
  {
    name: "that guards nothing but omits the reason",
    retention: { ...GUARDS_NOTHING, proof: without(GUARDS_NOTHING.proof, "reason") },
    reason: /retention_check\.proof: missing required field "reason"/,
  },
  {
    name: "of an unknown kind",
    retention: withProof(RETENTION, { kind: "none" }),
    reason: /retention_check\.proof: "kind" must be one of "owner-proves", "guards-nothing"/,
  },
  {
    name: "with no keeper",
    retention: withProof(RETENTION, { keeper: " " }),
    reason: /retention_check\.proof\.keeper: must match pattern/,
  },
  {
    name: "with no deletion-time mutation",
    retention: withProof(RETENTION, { mutation: "" }),
    reason: /retention_check\.proof\.mutation: must match pattern/,
  },
  {
    name: "that guards nothing but gives an empty reason",
    retention: withProof(GUARDS_NOTHING, { reason: "  " }),
    reason: /retention_check\.proof\.reason: must match pattern/,
  },
  {
    name: "that says nothing about what the test detects",
    retention: { ...RETENTION, detects: " " },
    reason: /retention_check\.detects: must match pattern/,
  },
]) {
  test(`a low-value-tests finding ${name} fails for that reason`, () => {
    const run = validate(lowValueFinding(retention));
    assert.notEqual(run.status, 0, run.out);
    assert.match(run.out, reason);
    if (not) assert.doesNotMatch(run.out, not);
  });
}

test("a confirmed finding with a blank concrete_cost fails for that reason", () => {
  const run = validate({ ...lowValueFinding(RETENTION), concrete_cost: " " });
  assert.notEqual(run.status, 0, run.out);
  assert.match(run.out, /\.concrete_cost: must match pattern/);
});

// The validator reads report-schema.json beside itself, so a schema-level test runs a copy
// of the real script next to an edited copy of the real schema.
// biome-ignore lint/suspicious/noExplicitAny: the tests edit arbitrary nodes of a parsed JSON schema
type Schema = Record<string, any>;

function validateAgainst(editSchema: (doc: Schema) => void): {
  status: number | null;
  out: string;
} {
  const copy = path.join(dir, Math.random().toString(36).slice(2));
  mkdirSync(copy);
  copyFileSync(VALIDATOR, path.join(copy, "validate-findings.cjs"));
  const doc = JSON.parse(
    readFileSync(path.join(path.dirname(VALIDATOR), "report-schema.json"), "utf8"),
  );
  editSchema(doc);
  writeFileSync(path.join(copy, "report-schema.json"), JSON.stringify(doc));
  const findings = path.join(copy, "findings.json");
  writeFileSync(findings, JSON.stringify([lowValueFinding(RETENTION)]));
  const run = spawnSync(process.execPath, [path.join(copy, "validate-findings.cjs"), findings], {
    encoding: "utf8",
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

const confirmed = (doc: Schema): Schema => doc.output_schema.oneOf[0].properties;

test("the unedited schema copy passes, so each refusal below comes from its edit", () => {
  const run = validateAgainst(() => {});
  assert.equal(run.status, 0, run.out);
});

for (const { name, edit, reason } of [
  {
    name: "a keyword it does not enforce",
    edit: (doc: Schema) => {
      confirmed(doc).concrete_cost.minLength = 1;
    },
    reason: /concrete_cost: unsupported schema keyword "minLength"/,
  },
  {
    name: "a type it does not interpret",
    edit: (doc: Schema) => {
      confirmed(doc).concrete_cost.type = "number";
    },
    reason: /concrete_cost: unsupported type "number"/,
  },
  {
    name: "a list of types",
    edit: (doc: Schema) => {
      confirmed(doc).concrete_cost.type = ["string", "null"];
    },
    reason: /concrete_cost: unsupported type \["string","null"\]/,
  },
  {
    name: "a schema-valued additionalProperties",
    edit: (doc: Schema) => {
      confirmed(doc).evidence.items.additionalProperties = { type: "integer" };
    },
    reason: /evidence\[\]: additionalProperties must be false/,
  },
  {
    name: "a pattern on a field that is not a string",
    edit: (doc: Schema) => {
      confirmed(doc).evidence.pattern = "x";
    },
    reason: /evidence: pattern applies only to type "string"/,
  },
  {
    name: "a required that is not a list of names",
    edit: (doc: Schema) => {
      confirmed(doc).remediation.required = "strategy";
    },
    reason: /remediation: required must be an array of strings/,
  },
  {
    name: "a minItems on a field that is not an array",
    edit: (doc: Schema) => {
      confirmed(doc).title.minItems = 1;
    },
    reason: /title: minItems applies only to type "array"/,
  },
  {
    name: "an enum that is not a list",
    edit: (doc: Schema) => {
      confirmed(doc).classification.enum = "fix-now";
    },
    reason: /classification: enum must be an array/,
  },
  {
    name: "properties that are not an object",
    edit: (doc: Schema) => {
      confirmed(doc).remediation.properties = ["strategy"];
    },
    reason: /remediation: properties must be an object/,
  },
  {
    name: "an empty oneOf",
    edit: (doc: Schema) => {
      confirmed(doc).retention_check.properties.proof.oneOf = [];
    },
    reason: /proof: oneOf must be a non-empty array/,
  },
  {
    name: "a minItems that is not an integer",
    edit: (doc: Schema) => {
      confirmed(doc).evidence.minItems = "1";
    },
    reason: /evidence: minItems must be a non-negative integer/,
  },
  {
    name: "object keywords on a node with no type",
    edit: (doc: Schema) => {
      delete confirmed(doc).remediation.type;
    },
    reason: /remediation: properties applies only to type "object"/,
  },
  {
    name: "items on a node that is not an array",
    edit: (doc: Schema) => {
      confirmed(doc).evidence.type = "object";
      delete confirmed(doc).evidence.minItems;
    },
    reason: /evidence: items applies only to type "array"/,
  },
  {
    name: "a keyword beside oneOf",
    edit: (doc: Schema) => {
      doc.output_schema.required = ["verdict"];
    },
    reason: /output_schema: required cannot sit beside oneOf/,
  },
  {
    name: "two oneOf branches with the same discriminator",
    edit: (doc: Schema) => {
      doc.output_schema.oneOf[1].properties.verdict.const = "confirmed";
    },
    reason: /output_schema: oneOf branches share the "verdict" value "confirmed"/,
  },
  {
    name: "a pattern that is not a string",
    edit: (doc: Schema) => {
      confirmed(doc).concrete_cost.pattern = 5;
    },
    reason: /concrete_cost: pattern must be a string/,
  },
  {
    name: "a negative minItems",
    edit: (doc: Schema) => {
      confirmed(doc).evidence.minItems = -1;
    },
    reason: /evidence: minItems must be a non-negative integer/,
  },
  ...["reusability-hoist", "copy-paste"].map((dim) => ({
    name: `a renamed reuse dimension ${dim} the semantic layer still names`,
    edit: (doc: Schema) => {
      const dims: string[] = confirmed(doc).dimension.enum;
      dims[dims.indexOf(dim)] = "duplication";
    },
    reason: new RegExp(`semantic layer reads dimension "${dim}", which the schema does not define`),
  })),
  {
    name: "no low-value-tests dimension for the semantic layer",
    edit: (doc: Schema) => {
      const dims: string[] = confirmed(doc).dimension.enum;
      dims.splice(dims.indexOf("low-value-tests"), 1);
    },
    reason: /semantic layer reads dimension "low-value-tests", which the schema does not define/,
  },
  {
    name: "no drift_test for the semantic layer",
    edit: (doc: Schema) => {
      delete confirmed(doc).drift_test;
    },
    reason: /semantic layer reads drift_test, which the schema does not define/,
  },
  {
    name: "no normal-to-diverge verdict for the semantic layer",
    edit: (doc: Schema) => {
      confirmed(doc).drift_test.properties.verdict.enum = ["bug-if-diverge", "incidental"];
    },
    reason:
      /semantic layer reads drift_test\.verdict "normal-to-diverge", which the schema does not define/,
  },
  {
    name: "no evidence array for the semantic layer",
    edit: (doc: Schema) => {
      delete confirmed(doc).evidence;
    },
    reason: /semantic layer reads evidence, which the schema does not define/,
  },
  {
    name: "a moved retention_check.contract",
    edit: (doc: Schema) => {
      const r = confirmed(doc).retention_check;
      r.properties.proof.oneOf[0].properties.contract = r.properties.contract;
      delete r.properties.contract;
    },
    reason:
      /semantic layer reads retention_check\.contract's enum, which the schema does not define/,
  },
  {
    name: "no none value in retention_check.contract",
    edit: (doc: Schema) => {
      const r = confirmed(doc).retention_check.properties.contract;
      r.enum = r.enum.map((c: string) => (c === "none" ? "no-contract" : c));
    },
    reason:
      /semantic layer reads retention_check\.contract "none", which the schema does not define/,
  },
  {
    name: "no confirmed verdict branch",
    edit: (doc: Schema) => {
      doc.output_schema.oneOf[0].properties.verdict.const = "accepted";
    },
    reason: /semantic layer reads a "confirmed" verdict branch, which the schema does not define/,
  },
  {
    name: "a sub-schema that is not an object",
    edit: (doc: Schema) => {
      confirmed(doc).title = null;
    },
    reason: /title: a schema must be an object/,
  },
]) {
  test(`the validator refuses a schema with ${name}`, () => {
    const run = validateAgainst(edit);
    assert.notEqual(run.status, 0, run.out);
    assert.match(run.out, reason);
    assert.doesNotMatch(run.out, /\n\s+at /, "a refusal is a message, not a stack trace");
  });
}

test("the validator reports a malformed schema pattern without a stack trace", () => {
  const run = validateAgainst((doc) => {
    confirmed(doc).concrete_cost.pattern = "(";
  });
  assert.notEqual(run.status, 0, run.out);
  assert.match(run.out, /invalid pattern "\(" /);
  assert.doesNotMatch(run.out, /\n\s+at /);
});

test("a pattern failure says why the field matters", () => {
  const run = validate(lowValueFinding({ ...RETENTION, detects: " " }));
  assert.match(
    run.out,
    /retention_check\.detects: must match pattern \/\\S\/, got " " — What the test checks/,
  );
});

test("a field named like a built-in object property is still an unexpected field", () => {
  const run = validate({ ...lowValueFinding(RETENTION), toString: "x" });
  assert.notEqual(run.status, 0, run.out);
  assert.match(run.out, /unexpected field "toString"/);
});

test("a required field named like a built-in object property must be present", () => {
  const run = validateAgainst((doc) => {
    confirmed(doc).remediation.required = ["strategy", "constructor"];
  });
  assert.notEqual(run.status, 0, run.out);
  assert.match(run.out, /remediation: missing required field "constructor"/);
});

for (const dim of ["reusability-hoist", "copy-paste"]) {
  const reuseFinding = (overrides: object = {}): object => ({
    ...lowValueFinding(undefined),
    title: "two retry loops",
    dimension: dim,
    evidence: [
      { file: "src/a.ts", line: 3, note: "first loop" },
      { file: "src/b.ts", line: 9, note: "second loop" },
    ],
    drift_test: { verdict: "bug-if-diverge", reason: "both must retry the same way" },
    ...overrides,
  });

  test(`a complete ${dim} finding passes`, () => {
    const run = validate(reuseFinding());
    assert.equal(run.status, 0, run.out);
  });

  for (const { name, overrides, reason } of [
    {
      name: "without a drift_test",
      overrides: { drift_test: undefined },
      reason: new RegExp(`dimension "${dim}" requires a drift_test`),
    },
    {
      name: "whose drift_test says normal-to-diverge",
      overrides: { drift_test: { verdict: "normal-to-diverge", reason: "they evolve apart" } },
      reason: /drift_test\.verdict is "normal-to-diverge" — that is incidental duplication/,
    },
    {
      name: "with one evidence site",
      overrides: { evidence: [{ file: "src/a.ts", line: 3, note: "first loop" }] },
      reason: new RegExp(`a "${dim}" finding needs >=2 evidence sites, got 1`),
    },
  ]) {
    test(`a ${dim} finding ${name} fails for that reason`, () => {
      const run = validate(reuseFinding(overrides));
      assert.notEqual(run.status, 0, run.out);
      assert.match(run.out, reason);
    });
  }
}
