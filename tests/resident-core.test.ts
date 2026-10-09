import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PROSE_DIRS, REPO_TOP_LEVEL, SHIPPED_TOP_LEVEL } from "./prose-dirs.ts";

// HARRY.md is loaded into every session, so it holds only what a session must know
// before acting. Each heading keeps its rule; everything that moved out keeps one home
// where a skill or the review standard loads it.

// A ceiling, not a target: the core measured 952 words on 2026-10-09 after the review's
// fixes, and 980 once "optimize on evidence" came back (the plugin eval lost
// no-speculative-optimization, 3/3 → 0/3, without it); 990 leaves room for a word, not a rule.
const CORE_WORDS = 990;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const plain = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ").replace(/[*`]/g, "");

function lawSection(name: string): string {
  const text = readFileSync(path.join(repoRoot, "HARRY.md"), "utf-8");
  const start = text.indexOf(`\n## ${name}\n`);
  assert.ok(start !== -1, `HARRY.md has no "## ${name}" heading`);
  const next = text.indexOf("\n## ", start + 1);
  return text
    .slice(start, next === -1 ? undefined : next)
    .replace(/\s+/g, " ")
    .replace(/[*`]/g, "");
}

test("each resident heading holds the rule the core keeps", () => {
  const rules: [string, RegExp][] = [
    [
      "Priority",
      /user's explicit instruction > these laws > harry skills > the default system prompt/,
    ],
    ["Priority", /harness's hard requirements[^.]*sit above the whole list/],
    [
      "Priority",
      /Anything the user explicitly requested is never simplified away; it does not promote a tier/,
    ],
    ["Tiers", /classify the task and say its tier out loud/],
    ["Tiers", /Skipping a step is lawful only out loud/],
    ["Tiers", /user-declared incident[^.]*never self-declared/],
    ["Ask first", /state the exact command, what breaks if it is wrong, the exact rollback/],
    ["Ask first", /Never touch the main checkout's main\/master without consent to that branch/],
    ["Ask first", /Merge or PR is always the user's choice/],
    [
      "Ask first",
      /Destructive operations\. Before a DELETE, DROP, file removal or any other irreversible action, say what is lost and wait for the user's confirmation/,
    ],
    ["Secrets", /print variable names only or mask the values/],
    [
      "Secrets",
      /A key that lands in the transcript is a key to rotate: the read itself is the leak/,
    ],
    ["Root cause", /find the root cause before any fix, and fix at the source/],
    ["Evidence", /No completion claim without fresh evidence/],
    ["Evidence", /An agent's report of success is not evidence/],
    ["Clarify first", /Clarify every unclear item before implementing any/],
    ["Code", /no unrequested abstraction/],
    [
      "Code",
      /Optimize on evidence, never on imagination: before any cache, index, virtualization or clever rewrite — even one the user asks for — get a measurement of this path/,
    ],
    ["Talk", /Prose addressed to the user opens with the outcome/],
    ["Talk", /Never invent a remediation/],
    ["Talk", /Open with the outcome and stop when the content stops/],
  ];
  for (const [heading, rule] of rules)
    assert.match(lawSection(heading), rule, `HARRY.md ${heading} lost: ${rule}`);
});

test("procedure that left the core lives in the skill that runs it", () => {
  const homes: [string, RegExp, string][] = [
    [
      "references/tier-gates.md",
      /\| Brainstorm \| compressed or full/,
      "each tier's gates live in tier-gates",
    ],
    [
      "skills/executing/SKILL.md",
      /## Who writes The session does all implementation, fixing and writing itself/,
      "dispatch roles live in executing",
    ],
    [
      "skills/executing/SKILL.md",
      /Before building any fix that is not small, dispatch ONE harry:referee/,
      "the fix check lives in executing",
    ],
    [
      "skills/executing/SKILL.md",
      /whether the scope still serves the unit's goal; name the goal/,
      "the scope brake lives in executing",
    ],
    [
      "references/doc-types.md",
      /A work unit is one item: status: backlog → active → done/,
      "the item store's summary lives in doc-types",
    ],
    [
      "skills/finishing/SKILL.md",
      /check its reviews, inline comments, and CodeRabbit status/,
      "PR discipline lives in finishing",
    ],
    [
      "skills/finishing/SKILL.md",
      /Any unresolved actionable item or unmet conditional approval → report and do NOT merge/,
      "an unmet conditional approval blocks the merge",
    ],
    [
      "skills/finishing/SKILL.md",
      /Title and body must not leak internal planning language \(no sprint\/phase\/wave names, \.local\/ paths, personal TODOs/,
      "the PR title and body carry no planning language",
    ],
    [
      "skills/finishing/SKILL.md",
      /destructive; needs the user's call per HARRY\.md Ask first/,
      "finishing cites the destructive-operations rule by name",
    ],
    [
      "skills/executing/SKILL.md",
      /Standard and Major build to references\/review-rubric\.md Engineering judgment — the standard the review judges by — read before the first commit/,
      "the author reads the judgment the review applies",
    ],
    [
      "skills/executing/SKILL.md",
      /The session fixes by references\/review-rubric\.md Engineering judgment too/,
      "the fix wave applies Engineering judgment",
    ],
  ];
  for (const [rel, rule, what] of homes) assert.match(plain(rel), rule, what);
});

test("judgment that left the core lives in the review standard", () => {
  const rubric = plain("references/review-rubric.md");
  const judgment = rubric.split("## Engineering judgment")[1]?.split("## Severity")[0] ?? "";
  for (const [rule, what] of [
    [/The ladder/, "the solution ladder"],
    [/Optimize on evidence, never on imagination/, "evidence before optimizing"],
    [/Clean legacy in the scope you touch/, "clean legacy in scope"],
    [/Pull related changes into the same PR/, "related changes in one PR"],
    [/Drift test: "if these two copies silently diverge/, "the DRY drift test"],
    [/lists its side-effect flags/, "side-effect flags"],
    [/long-term structural fix/, "the structural fix"],
    [/Automated findings are suggestions/, "automated findings as suggestions"],
  ] as const)
    assert.match(judgment, rule, `the review standard lost ${what}`);
  assert.match(
    plain("references/red-green.md"),
    /\| Major \/ any red line \| full red-green, watch-it-fail mandatory \|/,
    "the TDD tiers live in red-green",
  );
});

test("the main-checkout store rule has one home, and every first writer reads it", () => {
  const files = [
    ...SHIPPED_TOP_LEVEL,
    ...REPO_TOP_LEVEL,
    ...PROSE_DIRS.flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf-8" })
        .filter((rel) => rel.endsWith(".md"))
        .map((rel) => path.join(dir, rel)),
    ),
  ];
  const holders = files.filter((rel) =>
    readFileSync(path.join(repoRoot, rel), "utf-8").includes("--git-common-dir"),
  );
  assert.deepEqual(
    holders,
    ["references/doc-types.md"],
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
  assert.match(
    plain("references/doc-types.md"),
    /If the project has no \.local\/ at all, set it up or confirm it with the user first/,
    "the no-.local check left the store rule's home",
  );
});

test("the resident core does not grow back", () => {
  const words = readFileSync(path.join(repoRoot, "HARRY.md"), "utf-8").split(/\s+/).filter(Boolean);
  assert.ok(
    words.length <= CORE_WORDS,
    `HARRY.md grew to ${words.length} words; move the new rule to the skill or reference that uses it, or raise CORE_WORDS on purpose`,
  );
});

test("distill writes its items under the resolved store, never a bare .local/", () => {
  const distill = readFileSync(path.join(repoRoot, ".claude/commands/distill.md"), "utf-8");
  assert.doesNotMatch(distill, /(?<![\w>/])`?\.local\//, "distill writes a bare .local/ path");
});
