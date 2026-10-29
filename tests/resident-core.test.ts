import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MARKDOWN_CORPUS } from "./prose-dirs.ts";
import { headingSection } from "./section.ts";

// HARRY.md is loaded into every session, so it holds only what a session must know
// before acting; everything that moved out keeps one home where a skill or the review
// standard loads it.

// A ceiling, not a target: the core measured 952 words on 2026-10-09 after the review's
// fixes, and 980 once "optimize on evidence" came back (the plugin eval lost
// no-speculative-optimization, 3/3 → 0/3, without it); 990 leaves room for a word, not a rule.
const CORE_WORDS = 990;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const flatten = (text: string): string => text.replace(/\s+/g, " ").replace(/[*`]/g, "");
const raw = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const plain = (rel: string): string => flatten(raw(rel));
const proseFiles = MARKDOWN_CORPUS;
const DOC_TYPES = "references/doc-types.md";
const restaters = (phrase: string): string[] =>
  proseFiles.filter((rel) => rel !== DOC_TYPES && plain(rel).includes(phrase));

test("Engineering judgment keeps its bullets, in order", () => {
  const judgmentRaw = headingSection(
    raw("references/review-rubric.md"),
    "references/review-rubric.md",
    "## Engineering judgment",
  );
  assert.deepEqual(
    [...judgmentRaw.matchAll(/^- \*\*([^*]+)\*\*/gm)].map((m) => m[1]),
    [
      "Correctness and leaving no legacy outrank saving cost",
      "The ladder",
      "Optimize on evidence, never on imagination.",
      "Clean legacy in the scope you touch.",
      "Pull related changes into the same PR.",
      "Scope grows only on the user's say.",
      "DRY is about knowledge, not code.",
      "A fix stays pure.",
      "Findings carry their structural fix.",
      "Automated findings are suggestions.",
    ],
    "Engineering judgment gained or lost a bullet. HARRY.md Code hands this section its exceptions to measuring first, so a bullet that changes what measuring first allows tiers Major (references/tier-gates.md Promotion rules): re-pin on purpose",
  );
});

test("the main-checkout store rule has one home, and every first writer reads it", () => {
  assert.deepEqual(
    restaters("--git-common-dir"),
    [],
    "the store rule is restated outside doc-types",
  );
  for (const rel of [
    "skills/brainstorming/SKILL.md",
    "skills/executing/SKILL.md",
    "skills/finishing/SKILL.md",
    ".claude/commands/distill.md",
  ])
    assert.match(
      plain(rel),
      /references\/doc-types\.md Naming & location/,
      `${rel} no longer points at the store rule's home`,
    );
});

// A site's own block: its table row or list item, or the paragraph it opens.
const site = (rel: string, heading: string, start: RegExp): string => {
  const lines = headingSection(raw(rel), rel, heading).split("\n");
  const at = lines.findIndex((line) => start.test(line));
  assert.ok(at !== -1, `${rel} ${heading} lost the site ${start}`);
  const end = lines.findIndex(
    (line, i) => i > at && (!line.trim() || /^(\||\d+\. |- )/.test(line)),
  );
  return flatten(lines.slice(at, end === -1 ? undefined : end).join("\n"));
};

test("the item's shape has one home, and every site that shapes an item cites it", () => {
  assert.deepEqual(
    restaters("unless a real design decision was weighed"),
    [],
    "the item's shape is restated outside doc-types The item model",
  );
  for (const [rel, heading, start] of [
    ["references/tier-gates.md", "### Standard", /^\| Item \|/],
    ["references/tier-gates.md", "### Major", /^\| Item \|/],
    ["skills/brainstorming/SKILL.md", "## Entry: tier, then depth", /^\| Compressed \|/],
    ["skills/brainstorming/SKILL.md", "## Full Flow", /^6\. \*\*Write the item\*\*/],
    ["skills/brainstorming/SKILL.md", "## Full Flow", /^The compressed path runs/],
    ["skills/brainstorming/SKILL.md", "## Item Template", /gives the AC list alone/],
  ] as const)
    assert.match(
      site(rel, heading, start),
      /references\/doc-types\.md The item model/,
      `${rel} ${heading} ${start} no longer cites the item's shape`,
    );
  assert.match(
    site("references/doc-types.md", "## Lifecycle rules", /Backlog → active promotion/),
    /The item model/,
    "doc-types' promotion bullet no longer points at The item model",
  );
});

test("the resident core does not grow back", () => {
  const words = readFileSync(path.join(repoRoot, "HARRY.md"), "utf-8").split(/\s+/).filter(Boolean);
  assert.ok(
    words.length <= CORE_WORDS,
    `HARRY.md grew to ${words.length} words; move the new rule to the skill or reference that uses it, or raise CORE_WORDS on purpose`,
  );
});
