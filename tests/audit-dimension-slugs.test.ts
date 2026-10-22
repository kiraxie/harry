import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dimensionFailures, namesIn, type Repo } from "./citations.ts";
import { MARKDOWN_CORPUS, SHIPPED_PROSE_DIRS, under } from "./prose-dirs.ts";
import { confirmedBranch, NAMES, SCHEMA } from "./report-schema.ts";
import { headingSection, outline } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const AUDIT = path.join("references", "audit");
const raw = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const confirmed = confirmedBranch();
assert.ok(confirmed.properties.dimension, "report-schema.json lost its confirmed dimension enum");
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

const AUDIT_PROSE = MARKDOWN_CORPUS.filter(under(SHIPPED_PROSE_DIRS)).filter(
  (rel) => rel.startsWith(`${AUDIT}/`) || raw(rel).includes("references/audit/"),
);

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

const REUSE = NAMES.reuseDimensions;
const LOW_VALUE = [NAMES.lowValueDimension];

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

const PLAIN_ENGLISH = [
  "copy-paste",
  "dead-code",
  "error-handling",
  "over-engineering",
  "test-coverage",
];

test("a hyphenated slug in audit prose sits in a code span unless it is plain English", () => {
  const bare = AUDIT_PROSE.flatMap((rel) =>
    outline(raw(rel)).flatMap((line, i) => {
      const prose = line.text.replace(/`[^`]*`/g, " ");
      return SLUGS.filter(
        (slug) => slug.includes("-") && new RegExp(`(?<![\\w-])${slug}(?![\\w-])`, "i").test(prose),
      ).map((slug) => ({ slug, at: `${rel}:${i + 1}` }));
    }),
  );
  assert.deepEqual(
    bare
      .filter(({ slug }) => !PLAIN_ENGLISH.includes(slug))
      .map(({ slug, at }) => `${at}: ${slug}`),
    [],
    "a dimension slug outside a code span; write the slug in a code span, or the dimension by name",
  );
  assert.deepEqual(
    PLAIN_ENGLISH.filter((slug) => !bare.some((b) => b.slug === slug)),
    [],
    "a listed plain-English slug the audit prose no longer uses bare — delete it",
  );
});

type Fence = { at: number; text: string };

const fences = (rel: string): Fence[] => {
  const found: Fence[] = [];
  let open: { at: number; lines: string[] } | undefined;
  for (const [i, line] of outline(raw(rel)).entries()) {
    if (!line.fenced) continue;
    if (!/^\s*`{3,}/.test(line.text)) open?.lines.push(line.text);
    else if (!open) open = { at: i + 2, lines: [] };
    else {
      found.push({ at: open.at, text: open.lines.join("\n") });
      open = undefined;
    }
  }
  return found;
};

const SCAN_DIMENSIONS = "references/audit/SCAN-DIMENSIONS.md";
const scanDimensions: Repo = {
  kind: (rel) => (rel === SCAN_DIMENSIONS ? "file" : "untracked"),
  names: () => namesIn(raw(SCAN_DIMENSIONS)),
};

test("a dimension named inside a fence in audit prose is a SCAN-DIMENSIONS heading", () => {
  const fenced = AUDIT_PROSE.flatMap((rel) => fences(rel).map((fence) => ({ rel, ...fence })));
  assert.ok(fenced.length > 0, "the audit prose holds no fenced block");
  assert.deepEqual(
    fenced.flatMap(({ rel, at, text }) =>
      dimensionFailures(scanDimensions, text).failures.map((failure) => {
        const [, line = "1", message] = /^(\d+) -> (.*)$/s.exec(failure) ?? [];
        return `${rel}:${at + Number(line) - 1} -> ${message}`;
      }),
    ),
    [],
    "a fenced dimension name no SCAN-DIMENSIONS ## heading has",
  );
});
