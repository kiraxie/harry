import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PROSE_DIRS, REPO_TOP_LEVEL, SHIPPED_TOP_LEVEL } from "./prose-dirs.ts";
import { headingSection } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ").replace(/\*\*/g, "");
const DOC_TYPES = "references/doc-types.md";
const MENTION = /status: backlog|## Follow-ups/;

type Role = { writer: string[] } | { reader: string } | { repoLocal: string };
type Entry = { file: string; snippet: string; lines?: number } & Role;

const KNOWN: Entry[] = [
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "5. **Get approval**",
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "6. **Write the item**",
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "The compressed path runs steps",
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "and finishing carries only `## Follow-ups` forward",
    reader: "describes finishing's flush",
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "`## Follow-ups` (or open a `status: backlog` item now)",
    writer: ["an author copying in a Non-Goal", "an author promoting a Non-Goal"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "its lines are `executing`'s to append. `## Follow-ups`",
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "references/grilling.md",
    snippet: "becomes a `status: backlog` item",
    writer: ["`/grill`'s residue manifest"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "A small fix (",
    writer: ["findings of any severity outside the fix range"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "**There is no second wave.**",
    writer: ["findings adjudicated to Follow-ups"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "Minor findings → `## Follow-ups`",
    writer: ["Minor findings;"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "## Follow-ups discovered during execution",
    writer: ["executing: follow-on work found mid-build"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "is appended as one line under the item's `## Follow-ups`",
    writer: ["executing: follow-on work found mid-build"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "`## Follow-ups` line is for process/scope-level follow-on work",
    reader: "contrasts a Follow-ups line with a DEBT: marker",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "**Reviewer.**",
    reader: "hands the reviewer the Minors already in Follow-ups",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "- **backlog** → a new",
    writer: ["finishing's backlog ruling"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "**Round cap.**",
    writer: ["finishing's architecture review from round 2 on"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "**No item (Trivial).**",
    reader: "moves item lines to the reply when there is no item",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "c. **Flush Follow-ups**",
    writer: ["Follow-ups flush"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "- **Back to backlog**",
    writer: ["Active → backlog (discard)"],
  },
  {
    file: "references/debt-audit.md",
    snippet: "whose frontmatter has `status: backlog`",
    reader: "reads backlog items to re-judge them",
  },
  {
    file: "references/debt-audit.md",
    snippet: "as a new `status: backlog` item",
    writer: ["`/debt`, on request"],
  },
  {
    file: "references/sync-migration.md",
    snippet: "`status: backlog`, its",
    writer: ["`/sync`'s legacy migration"],
  },
  {
    file: "references/review-rubric.md",
    snippet: "item's `## Follow-ups` for final triage; do not block",
    reader: "tells the reviewer where Minors go; executing writes them",
  },
  {
    file: "references/review-rubric.md",
    snippet: "#### Minor (nice to have — item's `## Follow-ups` for final triage)",
    lines: 2,
    reader: "report-template headings, in the review and re-review forms",
  },
  {
    file: "references/architecture-review.md",
    snippet: "which goes to the item's `## Follow-ups` without a ruling.",
    reader: "tells the reviewer where finishing files round-2 Minors",
  },
  {
    file: "references/architecture-review.md",
    snippet: "`## Follow-ups` from round 2 on. Do not raise",
    reader: "tells the reviewer not to raise Minors already in Follow-ups",
  },
  {
    file: "references/architecture-review.md",
    snippet: "exception: it goes to the item's `## Follow-ups`",
    reader: "tells the reviewer where finishing files round-2 Minors",
  },
  {
    file: ".claude/commands/distill.md",
    snippet: "with `status: backlog`",
    repoLocal: "writes backlog items in harry's own store; shipped prose may not cite .claude/",
  },
];

const prose = (): string[] =>
  [
    ...SHIPPED_TOP_LEVEL,
    ...REPO_TOP_LEVEL,
    ...PROSE_DIRS.flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join(dir, f)),
    ),
  ]
    .filter((f) => f !== DOC_TYPES)
    .sort();

const mentions = (file: string): string[] =>
  read(file)
    .split("\n")
    .filter((l) => MENTION.test(l));

const lifecycle = (): string =>
  flat(headingSection(read(DOC_TYPES), DOC_TYPES, "## Lifecycle rules"));

test("every line that mentions backlog items or Follow-ups is on the known list", () => {
  const unlisted = prose().flatMap((file) =>
    mentions(file)
      .filter((line) => !KNOWN.some((k) => k.file === file && line.includes(k.snippet)))
      .map((line) => `${file}: ${line.trim().slice(0, 100)}`),
  );
  assert.deepEqual(
    unlisted,
    [],
    "class each new line: a writer named in doc-types' Lifecycle rules, or a reader with its reason",
  );
});

test("every known entry matches as many mention lines as it declares", () => {
  const files = prose();
  const off = KNOWN.map((k) => ({
    k,
    n: files.includes(k.file) ? mentions(k.file).filter((l) => l.includes(k.snippet)).length : 0,
  })).filter(({ k, n }) => n !== (k.lines ?? 1));
  assert.deepEqual(
    off.map(({ k, n }) => `${k.file}: ${k.snippet} (matches ${n})`),
    [],
    "remove a stale entry, or narrow a snippet that now covers more than its lines",
  );
});

test("doc-types' Lifecycle rules name every writer", () => {
  const rules = lifecycle();
  const missing = KNOWN.flatMap((k) =>
    "writer" in k
      ? k.writer.filter((w) => !rules.includes(flat(w))).map((w) => `${k.file}: ${w}`)
      : [],
  );
  assert.deepEqual(missing, [], "doc-types' Lifecycle rules no longer name these writers");
});

test("doc-types never calls the flush the only source of backlog items, anywhere in the file", () => {
  assert.doesNotMatch(flat(read(DOC_TYPES)), /the only place new backlog items get created/);
});
