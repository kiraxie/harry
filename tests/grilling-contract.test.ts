import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LINE_END_RE } from "./lines.ts";
import { READER_CORPUS } from "./prose-dirs.ts";
import { headingSection, section, sectionLines } from "./section.ts";

// `references/grilling.md` owns the adversarial interview end to end; three callers
// point at it (`commands/grill.md`, `skills/brainstorming/SKILL.md`, and
// `references/tier-gates.md` for depth). That
// single-source arrangement is only real while the callers keep *citing* it instead of
// restating it: a second copy of the exit gate or of the cadence rule gives the model
// two instructions that drift apart, which is the drift test in `references/review-rubric.md` answering "bug",
// not "normal evolution". These tests check that the callers cite grilling.md and that its
// lists keep their shape.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

const GRILLING = "references/grilling.md";
const BRAINSTORMING = path.join("skills", "brainstorming", "SKILL.md");
const TIER_GATES = "references/tier-gates.md";
const DOOR = path.join("commands", "grill.md");

/** Blank-line-separated paragraphs — these files wrap prose, so a citation and the
 *  claim it supports routinely sit on different lines of one paragraph. */
const paragraphs = (text: string): string[] => text.split(/\n\s*\n/);

test("AC-1: every brainstorming paragraph that invokes the exit gate cites grilling.md", () => {
  const skill = read(BRAINSTORMING);
  const uncited = paragraphs(skill).filter(
    (p) => /exit gate/i.test(p) && !p.includes("references/grilling.md"),
  );
  assert.deepEqual(
    uncited,
    [],
    "a brainstorming paragraph invokes the exit gate without citing it",
  );
});

test("AC-1: the /grill door points at grilling.md", () => {
  assert.ok(
    read(DOOR).includes("references/grilling.md"),
    `${DOOR} no longer points at ${GRILLING}`,
  );
});

// ---------------------------------------------------------------------------
// AC-2 — the loop and all three of its termination conditions
//
// interview → design → re-interview is the expected shape, not a fallback, and the
// loop exits only on all three conditions. Losing a condition is how a session ends
// with a moved destination or an undischarged assumption while still looking closed.

test("AC-2: grilling.md carries the loop and its three termination conditions", () => {
  const loop = section(read(GRILLING), GRILLING, "## The loop and its close", "### Re-walk");
  const conditions = loop.match(/^\d+\. \*\*/gm) ?? [];
  assert.equal(
    conditions.length,
    3,
    "the loop must exit on exactly three termination conditions — a dropped one is a gate " +
      "that can be passed while something is still open",
  );
});

// ---------------------------------------------------------------------------
// AC-3 — the assumption gate
//
// "Listing an assumption is not closing it" is the whole point: a written-down
// assumption that nobody dispositioned is an unverified premise the design rests on.
// The count is EXACT — a fourth disposition would be a new escape hatch, and that is
// a bug rather than normal evolution.

test("AC-3: the assumption gate has exactly three dispositions", () => {
  const gate = headingSection(read(GRILLING), GRILLING, "### Assumption gate");
  const labels = Array.from(gate.matchAll(/^- \*\*(.+?)\*\*/gm), (m) => m[1].trim());
  assert.deepEqual(
    labels,
    ["confirmed fact", "returned as an open question", "pinned by an AC"],
    "the assumption dispositions must stay exactly these three (harry-authored, per " +
      "upstream.json) — a fourth is a new way to close an assumption without resolving it",
  );
});

// ---------------------------------------------------------------------------
// AC-5 — the ledger
//
// Four lists, and the file write is the user's call. A ledger that writes itself to
// disk on close turns a conversation into an artifact nobody asked for; a missing
// list means something raised can leave the session unaccounted for.

test("AC-5: the ledger keeps four lists", () => {
  const ledger = headingSection(read(GRILLING), GRILLING, "## The ledger");
  const lists = Array.from(ledger.matchAll(/^\d+\. \*\*(.+?)\*\*/gm), (m) => m[1].trim());
  assert.deepEqual(
    lists,
    ["Decided", "Open", "Deferred", "Assumptions"],
    "the ledger's four lists changed — every termination condition reads one of them",
  );
});

// ---------------------------------------------------------------------------
// AC-4 — cadence: one question per round, everywhere
//
// The old design batched up to four questions a round via AskUserQuestion and fell
// back to numbered text rounds where no picker existed. Both are gone. The
// reason is stated in the prose: the user runs several sessions at once and returns
// cold, where four unanswered questions are unanswerable. A surviving sentence from
// the old design anywhere in a model-instructing tree reinstates it for that reader —
// which is why the negative scan is corpus-wide, not grilling-file-only.

/**
 * The trees AC-4 names: everything that instructs a model or describes harry.
 * `HARRY.md` and `agents/` are in the scan because they instruct a model too — the
 * resident laws are the likeliest place a cadence rule gets re-added, and a role
 * agent's card is read as an instruction by whatever runs as that role. Both are
 * clean today; the scan is here so they stay that way — though only the two
 * unambiguous patterns (`NUMBERED_ROUNDS_RE`, `FOUR_PER_ROUND_RE`) run against this
 * whole corpus; the context-dependent picker/batch patterns below are scoped to the
 * grill family only (see `PICKER_RE`'s comment).
 */
const cadenceCorpus = (): string[] => READER_CORPUS;

// Unambiguous on their own, so they are scanned corpus-wide.
const NUMBERED_ROUNDS_RE = /numbered (?:text )?rounds?/i;
const FOUR_PER_ROUND_RE =
  /(?:≤|<=|up to|at most|no more than)\s*(?:4|four)\b[^.\n]{0,60}questions?|questions?[^.\n]{0,60}(?:≤|<=|up to|at most|no more than)\s*(?:4|four)\b/i;
// Context-dependent, so scanned only in the grill family: `/sync`, `/debate`, `/audit`
// and `/distill` use AskUserQuestion for their own prompts, and executing's pre-flight
// AC review legitimately asks "one batched question" — neither is interview cadence.
// Deliberately NOT matching "picker" on its own: grilling.md's divergence phase says
// "no structured pickers", which is the new design stating itself, not the old one
// surviving. A harness-specific delivery mechanism can only be named by invoking
// AskUserQuestion or by falling back to something else.
const PICKER_RE = /AskUserQuestion|falls? back/i;
const BATCHED_QUESTIONS_RE = /batch(?:es|ing)?\s+(?:the\s+|its\s+)?questions?/i;
const GRILL_FAMILY = [GRILLING, BRAINSTORMING, DOOR];

test("AC-4: the cadence regexes still match the design they forbid", () => {
  // Proven against literals from the prose these replaced, so a regex that stopped
  // matching cannot read the same as a corpus with nothing to flag.
  const old =
    "grill's convergence phase batches questions via AskUserQuestion on Claude Code; Codex has no structured picker, so its skill falls back to the numbered text rounds";
  assert.ok(NUMBERED_ROUNDS_RE.test(old));
  assert.ok(PICKER_RE.test(old));
  assert.ok(BATCHED_QUESTIONS_RE.test(old));
  assert.ok(FOUR_PER_ROUND_RE.test("ask up to 4 questions per round"));
  assert.ok(FOUR_PER_ROUND_RE.test("questions are batched, at most four a round"));
});

test("AC-4: no model-instructing file keeps a batched cadence", () => {
  const corpus = cadenceCorpus();
  // The comment above claims the scan is corpus-wide; these two say so in assertions.
  // A corpus that quietly lost the laws or the role cards would still pass every scan
  // below while no longer covering where a cadence rule is most likely to reappear.
  assert.ok(corpus.includes("HARRY.md"), "the resident laws dropped out of the cadence scan");
  assert.ok(
    corpus.some((rel) => rel.startsWith(`agents${path.sep}`)),
    "the role agent cards dropped out of the cadence scan",
  );

  const offenders: string[] = [];
  for (const rel of corpus) {
    const grillFamily = GRILL_FAMILY.includes(rel);
    read(rel)
      .split(LINE_END_RE)
      .forEach((line, i) => {
        const hit = [
          NUMBERED_ROUNDS_RE.test(line) && "numbered rounds",
          FOUR_PER_ROUND_RE.test(line) && "a four-questions-per-round default",
          grillFamily && PICKER_RE.test(line) && "a picker/fallback cadence",
          grillFamily && BATCHED_QUESTIONS_RE.test(line) && "batched questions",
        ].filter(Boolean)[0];
        if (hit) offenders.push(`${rel}:${i + 1} (${hit})`);
      });
  }
  assert.deepEqual(offenders, [], "one question per round, in both phases");
});

// ---------------------------------------------------------------------------
// Opt-in batch: the round format lives inside the opt-in rule and nowhere else
//
// Upstream's grilling skill made a round of every frontier question its default. Harry
// keeps one question per round and lends upstream's round layout only to a batch the user
// asked for. The layout appearing anywhere else — a caller, a door, the laws — is a
// default batch returning under a format instead of a word, which the cadence scan above
// cannot see.

/** A question line of the round layout, with or without its emoji: `❓ **Q1** - **title**`. */
const ROUND_FORMAT_RE = /(?:❓\s*)?\*\*Q\d+\*\*\s*[-–—:]\s*\*\*/;
const OPT_IN_START = "**Batching is opt-in only**";
const OPT_IN_END = "**No question-count caps**";

test("round format: the pattern matches upstream's layout", () => {
  assert.ok(ROUND_FORMAT_RE.test("❓ **Q1** - **<question title>**: <question body>"));
  assert.ok(ROUND_FORMAT_RE.test("**Q2** - **<question title>**: <question body>"));
  assert.ok(ROUND_FORMAT_RE.test("**Q3** — **<question title>**: <question body>"));
  assert.ok(!ROUND_FORMAT_RE.test("Ask one question at a time"));
  assert.ok(!ROUND_FORMAT_RE.test("**Q&A** notes"));
});

test("round format: no other model-instructing file carries the layout", () => {
  const offenders: string[] = [];
  for (const rel of cadenceCorpus()) {
    const text = read(rel);
    // Lines of grilling.md's opt-in rule are skipped, not cut, so every offender
    // keeps its real line number.
    const allowed = rel === GRILLING ? sectionLines(text, rel, OPT_IN_START, OPT_IN_END) : [0, 0];
    text.split(LINE_END_RE).forEach((line, i) => {
      const n = i + 1;
      if (n >= allowed[0] && n <= allowed[1]) return;
      if (ROUND_FORMAT_RE.test(line)) offenders.push(`${rel}:${n}`);
    });
  }
  assert.deepEqual(offenders, [], "the round layout outside grilling.md's opt-in rule");
});

test("AC-7: brainstorming points at tier-gates' Brainstorm depth", () => {
  headingSection(read(TIER_GATES), TIER_GATES, "## Brainstorm depth");
  assert.match(
    read(BRAINSTORMING).replace(/\s+/g, " "),
    /`references\/tier-gates\.md` \*\*Brainstorm depth\*\*/,
    `${BRAINSTORMING} no longer points at tier-gates' Brainstorm depth`,
  );
});

test("AC-8: every mention of the re-walk outside grilling.md cites it", () => {
  for (const rel of [BRAINSTORMING, TIER_GATES]) {
    const text = read(rel);
    const uncited = paragraphs(text).filter(
      (p) => /re-walk/i.test(p) && !p.includes("references/grilling.md"),
    );
    assert.deepEqual(uncited, [], `a ${rel} paragraph names the re-walk without citing it`);
  }
});
