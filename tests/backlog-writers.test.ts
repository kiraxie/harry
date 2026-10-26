import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MARKDOWN_CORPUS } from "./prose-dirs.ts";
import { headingSection } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ").replace(/\*\*/g, "");
const DOC_TYPES = "references/doc-types.md";
const MENTION = /status: backlog|## Follow-ups/;

type Role = { writer: string[] } | { rule: string } | { reader: string } | { repoLocal: string };
type Entry = { file: string; snippet: string; sentences?: number } & Role;

const KNOWN: Entry[] = [
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "The manifest's dispositions are *commitments*",
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "promote an existing `status: backlog` item",
    reader: "promotes a backlog item in place",
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "Discharge step 5's manifest commitments",
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "skills/brainstorming/SKILL.md",
    snippet: "The manifest's deferred lines land the same way",
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
    snippet: "`## Follow-ups` MAY be created here at step 6",
    writer: ["brainstorming's residue manifest"],
  },
  {
    file: "references/grilling.md",
    snippet: "becomes a `status: backlog` item",
    writer: ["`/grill`'s residue manifest"],
  },
  {
    file: "skills/executing/SKILL.md",
    snippet: "anything outside it → the item's `## Follow-ups`",
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
    snippet: "On a later round, also hand it every ruling",
    reader: "hands the reviewer the Minors already in Follow-ups",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "- **backlog** → a new",
    writer: ["finishing's backlog ruling"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "From round 2 on, each Minor finding goes to the item's `## Follow-ups`",
    writer: ["finishing's architecture review from round 2 on"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "**No item (Trivial).**",
    reader: "moves item lines to the reply when there is no item",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "A kept leftover is appended to the item's `## Follow-ups`",
    writer: ["finishing's leftover check"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "Skip anything already in `## Follow-ups`",
    reader: "skips what Follow-ups and the backlog already hold",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "- **Conversation leftovers, before `gh pr create`.**",
    writer: ["finishing's leftover check"],
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "Then flush: read the item's `## Follow-ups` section",
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "For each line, create a new `.local/items/<new-slug>.md`",
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "Then clear the source item's `## Follow-ups` section.",
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "Non-Goals do NOT get this treatment",
    rule: "Follow-ups flush",
  },
  {
    file: "skills/finishing/SKILL.md",
    snippet: "- **Back to backlog**",
    rule: "Active → backlog (discard)",
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
    sentences: 2,
    reader: "report-template headings, in the review and re-review forms",
  },
  {
    file: "references/architecture-review.md",
    snippet: "which goes to the item's `## Follow-ups` without a ruling.",
    reader: "tells the reviewer where finishing files round-2 Minors",
  },
  {
    file: "references/architecture-review.md",
    snippet: "and the Minor findings sent to `## Follow-ups` from round 2 on.",
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

const prose = (): string[] => MARKDOWN_CORPUS.filter((f) => f !== DOC_TYPES).sort();

const BLOCK_START = /^\s*(?:$|#|[-*] |\d+\. |[a-z]\. |\||```|<!--)/;

const sentences = (text: string): string[] =>
  text
    .split("\n")
    .reduce<string[]>((blocks, line) => {
      if (BLOCK_START.test(line) || blocks.length === 0) blocks.push(line.trim());
      else blocks[blocks.length - 1] += ` ${line.trim()}`;
      return blocks;
    }, [])
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=\S)/))
    .map((s) => s.trim());

const mentions = (file: string): string[] => sentences(read(file)).filter((s) => MENTION.test(s));

const lifecycleBullets = (): Map<string, string> =>
  new Map(
    headingSection(read(DOC_TYPES), DOC_TYPES, "## Lifecycle rules")
      .split(/\n(?=- \*\*)/)
      .flatMap((b) => {
        const name = /^- \*\*(.+?)\*\*:/.exec(b)?.[1];
        return name === undefined ? [] : [[name, flat(b)] as const];
      }),
  );

test("every sentence that mentions backlog items or Follow-ups is on the known list", () => {
  const unlisted = prose().flatMap((file) =>
    mentions(file)
      .filter((s) => !KNOWN.some((k) => k.file === file && s.includes(k.snippet)))
      .map((s) => `${file}: ${s.trim().slice(0, 100)}`),
  );
  assert.deepEqual(
    unlisted,
    [],
    "class each new sentence: a writer named in doc-types' Writers bullet, a Lifecycle rule of its own, a reader with its reason, or repo-local",
  );
});

test("every known entry matches as many mention sentences as it declares", () => {
  const files = prose();
  const off = KNOWN.map((k) => ({
    k,
    n: files.includes(k.file) ? mentions(k.file).filter((s) => s.includes(k.snippet)).length : 0,
  })).filter(({ k, n }) => n !== (k.sentences ?? 1));
  assert.deepEqual(
    off.map(({ k, n }) => `${k.file}: ${k.snippet} (matches ${n})`),
    [],
    "remove a stale entry, or narrow a snippet that now covers more than its sentences",
  );
});

test("doc-types' Writers bullet names every writer", () => {
  const list = lifecycleBullets().get("Writers") ?? "";
  const missing = KNOWN.flatMap((k) =>
    "writer" in k
      ? k.writer.filter((w) => !list.includes(flat(w))).map((w) => `${k.file}: ${w}`)
      : [],
  );
  assert.deepEqual(missing, [], "doc-types' Writers bullet no longer names these writers");
});

test("the writers outside the Writers bullet are Lifecycle rules of their own", () => {
  const bullets = lifecycleBullets();
  const missing = [...new Set(KNOWN.flatMap((k) => ("rule" in k ? [k.rule] : [])))].filter(
    (rule) => !bullets.has(rule),
  );
  assert.deepEqual(missing, [], "doc-types' Lifecycle rules no longer have these bullets");
});

test("doc-types never calls the flush the only source of backlog items, anywhere in the file", () => {
  assert.doesNotMatch(flat(read(DOC_TYPES)), /the only place new backlog items get created/);
});
