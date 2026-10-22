import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SHIPPED_PROSE_DIRS } from "./prose-dirs.ts";
import { headingSection, outline } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const AUDIT = path.join("references", "audit");
const raw = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const SCHEMA = JSON.parse(raw(path.join(AUDIT, "report-schema.json")));
type Branch = {
  properties: {
    verdict: { const: string };
    dimension?: { enum: string[] };
    evidence?: { description: string };
    drift_test?: { description: string };
    retention_check?: { description: string };
  };
};
const confirmed = (SCHEMA.output_schema.oneOf as Branch[]).find(
  (branch) => branch.properties.verdict.const === "confirmed",
);
assert.ok(confirmed?.properties.dimension, "report-schema.json lost its confirmed dimension enum");
const SLUGS = confirmed.properties.dimension.enum;

const schemaTerms = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(schemaTerms)
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, v]) =>
          key === "enum" && Array.isArray(v)
            ? v.filter((x) => typeof x === "string")
            : key === "const" && typeof v === "string"
              ? [v]
              : schemaTerms(v),
        )
      : [];
const ALLOWED = new Set([...schemaTerms(SCHEMA), "allowed-tools", "import-linter", "ts-prune"]);

const AUDIT_PROSE = SHIPPED_PROSE_DIRS.flatMap((dir) =>
  readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf-8" })
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => path.join(dir, rel)),
).filter((rel) => rel.startsWith(`${AUDIT}/`) || raw(rel).includes("references/audit/"));

test("each scan dimension opens with its schema slug, in the schema's order", () => {
  const rel = path.join(AUDIT, "SCAN-DIMENSIONS.md");
  const text = raw(rel);
  const headings = outline(text)
    .filter((line) => line.level === 2 && /^\d+\. /.test(line.title))
    .map((line) => line.text);
  assert.ok(headings.length > 0, `${rel} has no numbered dimension headings`);
  const slugs = headings.map((heading) => {
    const [, ...body] = headingSection(text, rel, heading)
      .split("\n")
      .filter((line) => line.trim());
    const slugLines = body.filter((line) => line.startsWith("**Slug:**"));
    const first = /^\*\*Slug:\*\* `([^`]+)`$/.exec(body[0] ?? "");
    assert.ok(
      first && slugLines.length === 1,
      `${heading} needs one **Slug:** line, right under it`,
    );
    return first[1];
  });
  assert.deepEqual(slugs, SLUGS);
});

test("a kebab-case code span in audit prose is a schema term or a listed name", () => {
  assert.ok(AUDIT_PROSE.length > 0, "no shipped prose file is under or cites references/audit/");
  const hits = AUDIT_PROSE.flatMap((rel) =>
    [...raw(rel).matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)]
      .map((m) => m[1])
      .filter((span) => !ALLOWED.has(span))
      .map((span) => `${rel}: ${span}`),
  );
  assert.deepEqual(
    hits,
    [],
    "a kebab-case code span that is neither a report-schema.json term nor a listed name",
  );
});

const validator = raw(path.join(AUDIT, "validate-findings.cjs"));
const reuseMatch = /reuseDimensions:\s*\[([^\]]+)\]/.exec(validator);
const lowValueMatch = /lowValueDimension:\s*"([^"]+)"/.exec(validator);
assert.ok(
  reuseMatch && lowValueMatch,
  "validate-findings.cjs NAMES lost its reuse or low-value dimension",
);
const REUSE: string[] = JSON.parse(`[${reuseMatch[1]}]`);
const LOW_VALUE = [lowValueMatch[1]];

const block = (rel: string, start: string): string => {
  const lines = raw(rel).split("\n");
  const at = lines.findIndex((line) => line.startsWith(start));
  assert.ok(at !== -1, `${rel} lost the line starting ${start}`);
  const end = lines.findIndex((line, i) => i > at && (!line.trim() || /^(- |\d+\. )/.test(line)));
  return lines.slice(at, end === -1 ? undefined : end).join("\n");
};
const spans = (text: string): string[] =>
  [...text.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]).filter((s) => SLUGS.includes(s));
const named = (text: string): string[] =>
  SLUGS.filter((slug) => new RegExp(`(?<![\\w-])${slug}(?![\\w-])`).test(text));
const DEEP = path.join(AUDIT, "DEEP-DIVE.md");
const ROUNDS = path.join(AUDIT, "VALIDATION-AND-REPORTING.md");
const description = (prop: "evidence" | "drift_test" | "retention_check"): string => {
  const text = confirmed.properties[prop]?.description;
  assert.ok(text, `report-schema.json lost the ${prop} description`);
  return text;
};
const NAMES_SITES: [string, () => string[], string[]][] = [
  [`${DEEP} evidence`, () => spans(block(DEEP, "- evidence:")), REUSE],
  [`${DEEP} drift_test`, () => spans(block(DEEP, "- drift_test (")), REUSE],
  [`${DEEP} retention_check`, () => spans(block(DEEP, "- retention_check (")), LOW_VALUE],
  [`${ROUNDS} DRIFT TEST`, () => spans(block(ROUNDS, "2. DRIFT TEST (")), REUSE],
  [`${ROUNDS} RETENTION TEST`, () => spans(block(ROUNDS, "7. RETENTION TEST (")), LOW_VALUE],
  ["the schema's evidence description", () => named(description("evidence")), REUSE],
  ["the schema's drift_test description", () => named(description("drift_test")), REUSE],
  [
    "the schema's retention_check description",
    () => named(description("retention_check")),
    LOW_VALUE,
  ],
];
for (const [site, actual, expected] of NAMES_SITES)
  test(`${site} names the dimensions validate-findings.cjs NAMES applies the rule to`, () => {
    assert.deepEqual([...new Set(actual())].sort(), [...expected].sort());
  });
