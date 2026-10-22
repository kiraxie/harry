import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  type Block,
  blocks,
  dimensionFailures,
  fenceBlocks,
  fences,
  lineOf,
  namesIn,
  type Repo,
  SCAN_DIMENSIONS,
} from "./citations.ts";
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

type Read = { rel: string; block: Block; fenced: boolean; lineAt: (i: number) => number };

const proseOf = (rel: string, text: string): Read[] => [
  ...blocks(text).map((block) => ({
    rel,
    block,
    fenced: false,
    lineAt: (i: number) => lineOf(text, block.at + i),
  })),
  ...fences(text)
    .filter((fence) => !fence.info)
    .flatMap((fence) =>
      fenceBlocks(fence.text).map((block) => ({
        rel,
        block,
        fenced: true,
        lineAt: (i: number) => fence.line + lineOf(fence.text, block.at + i) - 1,
      })),
    ),
];
const AUDIT_READS = AUDIT_PROSE.flatMap((rel) => proseOf(rel, raw(rel)));

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const kebabSpans = (reads: Read[]): string[] =>
  reads.flatMap(({ rel, block, lineAt }) =>
    block.code
      .filter((span) => KEBAB.test(span.value))
      .map((span) => `${rel}:${lineAt(span.from)}: ${span.value}`),
  );

test("a kebab-case code span in audit prose is a schema term or a listed name", () => {
  assert.ok(AUDIT_PROSE.length > 0, "no shipped prose file is under or cites references/audit/");
  assert.deepEqual(
    kebabSpans(AUDIT_READS).filter((hit) => !ALLOWED.has(hit.split(": ").at(-1) ?? "")),
    [],
    "a kebab-case code span that is neither a report-schema.json term nor a listed name",
  );
});

const REUSE = NAMES.reuseDimensions;
const LOW_VALUE = [NAMES.lowValueDimension];

const spans = (rel: string, label: string): string[] => {
  const found = proseOf(rel, raw(rel)).filter(({ block }) => block.text.startsWith(label));
  assert.equal(found.length, 1, `${rel} needs one block starting ${label}`);
  return (found[0]?.block.code ?? []).map((span) => span.value).filter((s) => SLUGS.includes(s));
};
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
  [`${DEEP} evidence`, () => spans(DEEP, "evidence:"), REUSE],
  [`${DEEP} drift_test`, () => spans(DEEP, "drift_test ("), REUSE],
  [`${DEEP} retention_check`, () => spans(DEEP, "retention_check ("), LOW_VALUE],
  [`${ROUNDS} DRIFT TEST`, () => spans(ROUNDS, "DRIFT TEST ("), REUSE],
  [`${ROUNDS} RETENTION TEST`, () => spans(ROUNDS, "RETENTION TEST ("), LOW_VALUE],
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

const bareSlugs = (reads: Read[]): { slug: string; at: string }[] =>
  reads.flatMap(({ rel, block, lineAt }) => {
    const prose = block.code.reduce(
      (text, span) =>
        text.slice(0, span.from) + " ".repeat(span.to - span.from) + text.slice(span.to),
      block.text,
    );
    return SLUGS.filter((slug) => slug.includes("-")).flatMap((slug) =>
      [...prose.matchAll(new RegExp(`(?<![\\w-])${slug}(?![\\w-])`, "gi"))].map((m) => ({
        slug,
        at: `${rel}:${lineAt(m.index ?? 0)}`,
      })),
    );
  });

const READ_ROWS: [string, string, string[], string[]][] = [
  [
    "a bare slug in an untagged fence",
    "intro\n\n```\nsee low-value-tests\n```\n",
    ["x.md:4: low-value-tests"],
    [],
  ],
  ["a slug in a code span", "see `low-value-tests` here\n", [], ["x.md:1: low-value-tests"]],
  [
    "a ```json fence",
    '```json\n{ "dimension": "low-value-tests", "x": "`foo-bar`" }\n```\n',
    [],
    [],
  ],
  [
    "an indented line in a fence",
    "```\nbrief:\n\n    low-value-tests first\n```\n",
    ["x.md:4: low-value-tests"],
    [],
  ],
  ["an indented code block", "intro\n\n    `foo-bar` and low-value-tests\n", [], []],
  ["a kebab code span in prose", "run `foo-bar` now\n", [], ["x.md:1: foo-bar"]],
  [
    "a kebab code span in an untagged fence",
    "```\n\nrun `foo-bar`\n```\n",
    [],
    ["x.md:3: foo-bar"],
  ],
];

for (const [label, text, bare, kebab] of READ_ROWS)
  test(`the slug scans read audit prose as an agent does: ${label}`, () => {
    const reads = proseOf("x.md", text);
    assert.deepEqual(
      bareSlugs(reads).map(({ slug, at }) => `${at}: ${slug}`),
      bare,
    );
    assert.deepEqual(kebabSpans(reads), kebab);
  });

test("a hyphenated slug in audit prose sits in a code span unless it is plain English", () => {
  const bare = bareSlugs(AUDIT_READS);
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

const UNTAGGED = AUDIT_PROSE.flatMap((rel) =>
  fences(raw(rel))
    .filter((fence) => !fence.info)
    .map((fence) => ({ rel, ...fence })),
);

test("every line holding a word in an untagged audit fence is read", () => {
  assert.ok(UNTAGGED.length > 0, "the audit prose holds no untagged fence");
  const unread = UNTAGGED.flatMap(({ rel, text, line }) => {
    const spans = fenceBlocks(text).map((block) => [
      lineOf(text, block.at),
      lineOf(text, block.at + block.text.length),
    ]);
    return text
      .split("\n")
      .flatMap((content, i) =>
        /\w/.test(content) && !spans.some(([from = 0, to = 0]) => i + 1 >= from && i + 1 <= to)
          ? [`${rel}:${line + i}`]
          : [],
      );
  });
  assert.deepEqual(unread, [], "a fence line the slug scans never read");
});

const scanDimensions: Repo = {
  kind: (rel) => (rel === SCAN_DIMENSIONS ? "file" : "untracked"),
  names: () => namesIn(raw(SCAN_DIMENSIONS)),
};

test("a dimension named inside a fence in audit prose is a SCAN-DIMENSIONS heading", () => {
  assert.deepEqual(
    UNTAGGED.flatMap(({ rel, text, line }) =>
      dimensionFailures(scanDimensions, text, fenceBlocks).failures.map((failure) => {
        const [, at = "1", message] = /^(\d+) -> (.*)$/s.exec(failure) ?? [];
        return `${rel}:${line + Number(at) - 1} -> ${message}`;
      }),
    ),
    [],
    "a fenced dimension name no SCAN-DIMENSIONS ## heading has",
  );
});
