import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  type Block,
  blockDimensionFailures,
  type Fence,
  fenceBlocks,
  namesIn,
  type Repo,
  readProse,
  SCAN_DIMENSIONS,
  untaggedFences,
} from "./citations.ts";
import { LINE_END_RE } from "./lines.ts";
import { SHIPPED_MARKDOWN } from "./prose-dirs.ts";
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

const auditProse = (read: (rel: string) => string): string[] =>
  SHIPPED_MARKDOWN.filter(
    (rel) => rel.startsWith(`${AUDIT}/`) || read(rel).includes("references/audit/"),
  );
const AUDIT_PROSE = auditProse(raw);

test("the audit slug scans select HARRY.md when it cites references/audit/", () => {
  const read = (rel: string): string =>
    rel === "HARRY.md" ? "see `references/audit/RECON.md`" : raw(rel);
  assert.ok(auditProse(read).includes("HARRY.md"));
});

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

type Read = { rel: string; block: Block };

const readsOf = (rel: string, text: string): Read[] =>
  readProse(rel, text).map((block) => ({ rel, block }));
const AUDIT_READS = AUDIT_PROSE.flatMap((rel) => readsOf(rel, raw(rel)));

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const kebabSpans = (reads: Read[]): string[] =>
  reads.flatMap(({ rel, block }) =>
    block.code
      .filter((span) => KEBAB.test(span.value))
      .map((span) => `${rel}:${block.lineAt(span.from)}: ${span.value}`),
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

const spans = (rel: string, text: string, label: string): string[] => {
  const found = readProse(rel, text).filter((block) => block.text.startsWith(label));
  assert.equal(found.length, 1, `${rel} needs one block starting ${label}`);
  return (found[0]?.code ?? []).map((span) => span.value).filter((s) => SLUGS.includes(s));
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
  [`${DEEP} evidence`, () => spans(DEEP, raw(DEEP), "evidence:"), REUSE],
  [`${DEEP} drift_test`, () => spans(DEEP, raw(DEEP), "drift_test ("), REUSE],
  [`${DEEP} retention_check`, () => spans(DEEP, raw(DEEP), "retention_check ("), LOW_VALUE],
  [`${ROUNDS} DRIFT TEST`, () => spans(ROUNDS, raw(ROUNDS), "DRIFT TEST ("), REUSE],
  [`${ROUNDS} RETENTION TEST`, () => spans(ROUNDS, raw(ROUNDS), "RETENTION TEST ("), LOW_VALUE],
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

const LABEL_ROWS: [string, string][] = [
  ["no block starts", "other\n"],
  ["two blocks start", "evidence: a\n\nevidence: b\n"],
];

for (const [label, text] of LABEL_ROWS)
  test(`a label site fails naming its file and label when ${label} with the label`, () => {
    assert.throws(() => spans("x.md", text, "evidence:"), {
      message: /^x\.md needs one block starting evidence:$/m,
    });
  });

const PLAIN_ENGLISH = [
  "copy-paste",
  "dead-code",
  "error-handling",
  "over-engineering",
  "test-coverage",
];

const bareSlugs = (reads: Read[]): { slug: string; at: string }[] =>
  reads.flatMap(({ rel, block }) =>
    SLUGS.filter((slug) => slug.includes("-")).flatMap((slug) =>
      [...block.prose.matchAll(new RegExp(`(?<![\\w-])${slug}(?![\\w-])`, "gi"))].map((m) => ({
        slug,
        at: `${rel}:${block.lineAt(m.index ?? 0)}`,
      })),
    ),
  );

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
    const reads = readsOf("x.md", text);
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
  untaggedFences(raw(rel)).map((fence) => ({ rel, fence })),
);

const unreadLines = (rel: string, fence: Fence, read: (fence: Fence) => Block[]): string[] => {
  const spans = read(fence).map((block) => [block.lineAt(0), block.lineAt(block.text.length)]);
  return fence.text
    .split(LINE_END_RE)
    .flatMap((content, i) =>
      /\w/.test(content) &&
      !spans.some(([from = 0, to = 0]) => fence.line + i >= from && fence.line + i <= to)
        ? [`${rel}:${fence.line + i}`]
        : [],
    );
};

const UNREAD_ROWS: [string, (fence: Fence) => Block[], string[]][] = [
  ["the fence reader", fenceBlocks, []],
  ["a reader that drops the last block", (fence) => fenceBlocks(fence).slice(0, 1), ["x.md:4"]],
];

for (const [label, read, expected] of UNREAD_ROWS)
  test(`the unread fence line check flags what ${label} skips`, () => {
    const [fence] = untaggedFences("```\nfirst\n\nsecond\n```\n");
    assert.ok(fence);
    assert.deepEqual(unreadLines("x.md", fence, read), expected);
  });

test("every line holding a word in an untagged audit fence is read", () => {
  assert.ok(UNTAGGED.length > 0, "the audit prose holds no untagged fence");
  assert.deepEqual(
    UNTAGGED.flatMap(({ rel, fence }) => unreadLines(rel, fence, fenceBlocks)),
    [],
    "a fence line the slug scans never read",
  );
});

const scanDimensions: Repo = {
  kind: (rel) => (rel === SCAN_DIMENSIONS ? "file" : "untracked"),
  names: () => namesIn(raw(SCAN_DIMENSIONS)),
};

const fencedDimensions = (reads: Read[]): string[] =>
  reads
    .filter(({ block }) => block.fenced)
    .flatMap(({ rel, block }) =>
      blockDimensionFailures(scanDimensions, block).map(
        ({ line, failure }) => `${rel}:${line} -> ${failure}`,
      ),
    );

test("the fenced dimension check reads a fence as an agent does", () => {
  assert.deepEqual(
    fencedDimensions(readsOf("x.md", "```\nintro\n\n    dimension **Dead codes**\n```\n")),
    ['x.md:4 -> references/audit/SCAN-DIMENSIONS.md has no ## heading "Dead codes"'],
  );
  assert.deepEqual(
    fencedDimensions(readsOf("x.md", "```json\ndimension **Dead codes**\n```\n")),
    [],
  );
});

test("a dimension named inside a fence in audit prose is a SCAN-DIMENSIONS heading", () => {
  assert.deepEqual(
    fencedDimensions(AUDIT_READS),
    [],
    "a fenced dimension name no SCAN-DIMENSIONS ## heading has",
  );
});
