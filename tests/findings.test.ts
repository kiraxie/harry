import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonBlock, normalizeFindings } from "../src/lib/findings.ts";

// extractJsonBlock drives the review→fix pipeline: it recovers the structured
// payload from free-form model output. These cover the branches that break on
// real model output — multiple fences, single-line fences, and un-fenced tails.

test("extractJsonBlock takes the LAST fenced json block", () => {
  const text = [
    "Here is a draft:",
    "```json",
    '[{"file":"a.ts","title":"draft"}]',
    "```",
    "On reflection, the final answer:",
    "```json",
    '[{"file":"b.ts","title":"final"}]',
    "```",
  ].join("\n");
  const parsed = extractJsonBlock(text) as Array<{ file: string }>;
  assert.equal(parsed[0].file, "b.ts");
});

test("extractJsonBlock matches a single-line fence", () => {
  const parsed = extractJsonBlock('prose ```json {"applied":["x"]} ``` more') as {
    applied: string[];
  };
  assert.deepEqual(parsed.applied, ["x"]);
});

test("extractJsonBlock falls back to a bare top-level array", () => {
  const parsed = extractJsonBlock(
    'no fence here [{"file":"a.ts","title":"t"}] trailing',
  ) as unknown[];
  assert.equal(parsed.length, 1);
});

test("extractJsonBlock prefers the enclosing object over an inner array", () => {
  // The apply-report object encloses inner arrays; length-desc must pick the {…}.
  const parsed = extractJsonBlock('{"applied":["a"],"skipped":[]}') as { applied: string[] };
  assert.deepEqual(parsed.applied, ["a"]);
});

test("extractJsonBlock returns null on unparseable input", () => {
  assert.equal(extractJsonBlock("just some prose, no json at all"), null);
});

// normalizeFindings coerces loosely-typed JSON into validated Finding[]. It must
// drop unusable entries rather than throw, and keep ids unique.

test("normalizeFindings drops entries missing file or title", () => {
  const out = normalizeFindings([
    { file: "a.ts", title: "keep" },
    { file: "b.ts" }, // no title
    { title: "no file" }, // no file
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].file, "a.ts");
});

test("normalizeFindings reads a {findings:[...]} wrapper", () => {
  const out = normalizeFindings({ findings: [{ file: "a.ts", title: "t" }] });
  assert.equal(out.length, 1);
});

test("normalizeFindings defaults severity and coerces numeric line to string", () => {
  const out = normalizeFindings([{ file: "a.ts", title: "t", line: 42, severity: "bogus" }]);
  assert.equal(out[0].severity, "major");
  assert.equal(out[0].line, "42");
});

test("normalizeFindings de-duplicates colliding ids", () => {
  const out = normalizeFindings([
    { id: "dup", file: "a.ts", title: "one" },
    { id: "dup", file: "b.ts", title: "two" },
  ]);
  assert.notEqual(out[0].id, out[1].id);
});

test("normalizeFindings tolerates a non-array, non-wrapper value", () => {
  assert.deepEqual(normalizeFindings("garbage"), []);
});
