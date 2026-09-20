import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// `references/grilling.md` owns the adversarial interview end to end; four callers
// point at it (`commands/grill.md`, `codex-skills/grill/SKILL.md`,
// `skills/brainstorming/SKILL.md`, and `references/tier-gates.md` for depth). That
// single-source arrangement is only real while the callers keep *citing* it instead of
// restating it: a second copy of the exit gate or of the cadence rule gives the model
// two instructions that drift apart, which is HARRY.md §2's drift test answering "bug",
// not "normal evolution". These tests pin the load-bearing words on each side of that
// boundary and tolerate rewording around them.
//
// Sibling of pipeline-stages.test.ts, which already pins the brainstorming ↔ doc-types
// agreement on the item shape; this is the same pattern for grilling ↔ its callers.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

const GRILLING = "references/grilling.md";
const BRAINSTORMING = path.join("skills", "brainstorming", "SKILL.md");
const TIER_GATES = "references/tier-gates.md";
const DOORS = [path.join("commands", "grill.md"), path.join("codex-skills", "grill", "SKILL.md")];

/**
 * The text from `startHeading` up to `endHeading` (exclusive).
 *
 * Throws when either heading is missing rather than returning "". A section-scoped
 * check that silently falls back to an empty string passes every `includes` test it
 * runs, so a renamed heading would read as "the contract still holds" — the exact
 * vacuity prose-refs.test.ts guards its own corpus against.
 */
function section(text: string, rel: string, startHeading: string, endHeading: string): string {
  const start = text.indexOf(startHeading);
  assert.ok(start !== -1, `${rel} no longer has the heading "${startHeading}"`);
  const end = text.indexOf(endHeading, start + startHeading.length);
  assert.ok(end !== -1, `${rel} no longer has the heading "${endHeading}" after "${startHeading}"`);
  return text.slice(start, end);
}

/** Blank-line-separated paragraphs — these files wrap prose, so a citation and the
 *  claim it supports routinely sit on different lines of one paragraph. */
const paragraphs = (text: string): string[] => text.split(/\n\s*\n/);

// ---------------------------------------------------------------------------
// AC-1 — the close of an interview is stated in one place
//
// The residue manifest, the settled decisions restated as numbered acceptance
// criteria, and the sentence naming what approval covers are the exit gate. A caller
// that restates any of them owns a second copy that can be relaxed independently —
// and the gate is precisely what must not get a "lite" version.

test("AC-1: the exit gate is defined in grilling.md", () => {
  const gate = section(read(GRILLING), GRILLING, "### Residue manifest", "## Handoff");
  assert.match(gate, /\*\*Decided\*\*/, "the manifest no longer reads out the decided list");
  assert.match(gate, /deferred/i, "the manifest no longer reads out the deferred list");
  assert.match(gate, /assumptions?/i, "the manifest no longer reads out the assumptions list");
  assert.match(
    gate,
    /numbered \*\*acceptance criteria\*\*|\*\*(?:numbered )?acceptance criteria\*\*/i,
    "the exit gate no longer restates the settled decisions as numbered acceptance criteria",
  );
  assert.match(
    gate,
    /what the user approves is[^.]*residue manifest[^.]*acceptance criteria/i,
    "the sentence naming what the user's approval covers is gone from the exit gate",
  );
});

test("AC-1: brainstorming cites the exit gate without restating it", () => {
  const skill = read(BRAINSTORMING);

  // The manifest's own section names. Their presence in a caller means the caller is
  // spelling out the gate's contents, not pointing at them.
  for (const restated of [/raised-but-deferred/i, /silent assumptions/i, /what the user approves/i])
    assert.doesNotMatch(
      skill,
      restated,
      `${BRAINSTORMING} restates the residue manifest's contents; it must cite ` +
        `${GRILLING}'s exit gate instead (two copies of a gate drift, HARRY.md §2)`,
    );

  // Citing is the other half: every paragraph that invokes the exit gate names the
  // file that defines it, so the pointer survives a rewrite of the surrounding prose.
  const uncited = paragraphs(skill).filter(
    (p) => /exit gate/i.test(p) && !p.includes("references/grilling.md"),
  );
  assert.deepEqual(
    uncited,
    [],
    "a brainstorming paragraph invokes the exit gate without citing it",
  );
});

test("AC-1: both /grill doors stay thin pointers", () => {
  for (const door of DOORS) {
    const text = read(door);
    assert.ok(text.includes("references/grilling.md"), `${door} no longer points at ${GRILLING}`);
    for (const restated of [
      /residue manifest/i,
      /one question per round/i,
      /termination condition/i,
    ])
      assert.doesNotMatch(
        text,
        restated,
        `${door} is a door, not a second copy of the technique — keep the content in ${GRILLING}`,
      );
  }
});

// ---------------------------------------------------------------------------
// AC-2 — the loop and all three of its termination conditions
//
// interview → design → re-interview is the expected shape, not a fallback, and the
// loop exits only on all three conditions. Losing a condition is how a session ends
// with a moved destination or an undischarged assumption while still looking closed.

test("AC-2: grilling.md carries the loop and its three termination conditions", () => {
  const text = read(GRILLING);
  assert.match(
    text,
    /interview\s*(?:→|->)\s*design\s*(?:→|->)\s*re-?interview/i,
    "the interview → design → re-interview loop is no longer described",
  );

  const loop = section(text, GRILLING, "## The loop and its close", "### Assumption gate");
  const conditions = loop.match(/^\d+\. \*\*/gm) ?? [];
  assert.equal(
    conditions.length,
    3,
    "the loop must exit on exactly three termination conditions — a dropped one is a gate " +
      "that can be passed while something is still open",
  );
  assert.match(loop, /no open questions/i, "condition 1 (empty open list) is gone");
  assert.match(
    loop,
    /assumption[^.]*disposition|disposition[^.]*assumption/i,
    "condition 2 is gone",
  );
  assert.match(loop, /destination did not move/i, "condition 3 (destination stability) is gone");
});

// ---------------------------------------------------------------------------
// AC-3 — the assumption gate
//
// "Listing an assumption is not closing it" is the whole point: a written-down
// assumption that nobody dispositioned is an unverified premise the design rests on.
// The count is EXACT — a fourth disposition would be a new escape hatch, and that is
// a bug rather than normal evolution.

test("AC-3: listing an assumption is not closing it, and there are exactly three dispositions", () => {
  const gate = section(read(GRILLING), GRILLING, "### Assumption gate", "### Residue manifest");
  assert.match(
    gate,
    /listing an assumption is not closing it/i,
    "the assumption gate's load-bearing sentence is gone",
  );

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

test("AC-5: the ledger keeps four lists and is written to a file only on request", () => {
  const ledger = section(read(GRILLING), GRILLING, "## The ledger", "## The loop and its close");
  const lists = Array.from(ledger.matchAll(/^\d+\. \*\*(.+?)\*\*/gm), (m) => m[1].trim());
  assert.deepEqual(
    lists,
    ["Decided", "Open", "Deferred", "Assumptions"],
    "the ledger's four lists changed — every termination condition reads one of them",
  );
  assert.match(
    ledger,
    /written to a file only when the user asks|only when the user asks for it/i,
    "the ledger no longer says the file write is the user's request, not a default",
  );
  assert.match(ledger, /never by default/i, "the 'never by default' guard on writing is gone");
});

test("AC-5: only the user may defer a question", () => {
  // Termination condition 1 is "the open list is empty", and a question also leaves
  // that list by being deferred — so an agent free to defer on its own can empty the
  // list without settling anything. This is the exploit guard on the exit gate, and it
  // is a user ruling; deleting the paragraph would otherwise pass the whole suite.
  const ledger = section(read(GRILLING), GRILLING, "## The ledger", "## The loop and its close");
  assert.match(
    ledger,
    /only the user\s+defers/i,
    "the ledger no longer says only the user may move a question to Deferred",
  );
  assert.match(
    ledger,
    /agent never\s+moves a question there|never[^.]*on its own initiative/i,
    "the guard against the agent self-deferring to satisfy the exit gate is gone",
  );
});

// ---------------------------------------------------------------------------
// AC-4 — cadence: one question per round, everywhere
//
// The old design batched up to four questions a round on Claude Code via
// AskUserQuestion and fell back to numbered text rounds on Codex. Both are gone. The
// reason is stated in the prose: the user runs several sessions at once and returns
// cold, where four unanswered questions are unanswerable. A surviving sentence from
// the old design anywhere in a model-instructing tree reinstates it for that reader —
// which is why the negative scan is corpus-wide, not grilling-file-only.

/**
 * The trees AC-4 names: everything that instructs a model or describes the build.
 * `HARRY.md` and `agents/` are in the scan because they instruct a model too — the
 * resident laws are the likeliest place a cadence rule gets re-added, and a role
 * agent's card is read as an instruction by whatever runs as that role. Both are
 * clean today; the scan is here so they stay that way.
 */
const CADENCE_DIRS = ["references", "skills", "commands", "codex-skills", "agents"];
const CADENCE_TOP_LEVEL = ["CLAUDE.md", "README.md", "upstream.json", "HARRY.md"];

function cadenceCorpus(): string[] {
  const files = [...CADENCE_TOP_LEVEL];
  for (const dir of CADENCE_DIRS) {
    const abs = path.join(repoRoot, dir);
    const found = readdirSync(abs, { recursive: true, encoding: "utf-8" })
      .filter((rel) => rel.endsWith(".md"))
      .map((rel) => path.join(dir, rel));
    // Same non-vacuity guard as prose-refs.test.ts: a renamed directory would
    // otherwise drop its files and leave the scan passing on a smaller corpus.
    assert.ok(found.length > 0, `${dir}/ holds no markdown — renamed? the scan below is now blind`);
    files.push(...found);
  }
  return files;
}

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
/** The bullet is a parity note, so it may not name a picker at all, negated or not. */
const STALE_BULLET_RE = /AskUserQuestion|structured picker|falls? back|numbered/i;
const BATCHED_QUESTIONS_RE = /batch(?:es|ing)?\s+(?:the\s+|its\s+)?questions?/i;
const GRILL_FAMILY = [GRILLING, BRAINSTORMING, ...DOORS];

test("AC-4: the cadence regexes still match the design they forbid", () => {
  // Proven against literals from the prose these replaced, so a regex that stopped
  // matching cannot read the same as a corpus with nothing to flag.
  const old =
    "grill's convergence phase batches questions via AskUserQuestion on Claude Code; Codex has no structured picker, so its skill falls back to the numbered text rounds";
  assert.ok(NUMBERED_ROUNDS_RE.test(old));
  assert.ok(PICKER_RE.test(old));
  assert.ok(STALE_BULLET_RE.test(old));
  assert.ok(BATCHED_QUESTIONS_RE.test(old));
  assert.ok(FOUR_PER_ROUND_RE.test("ask up to 4 questions per round"));
  assert.ok(FOUR_PER_ROUND_RE.test("questions are batched, at most four a round"));
});

test("AC-4: grilling.md states one question per round, both phases, both builds", () => {
  const cadence = section(read(GRILLING), GRILLING, "## Cadence", "## Phase-dependent stance");
  assert.match(
    cadence,
    /one question (?:at a time|per round)/i,
    "the one-question-per-round rule is gone",
  );
  assert.match(
    cadence,
    /both phases[^.]*both builds/i,
    "the cadence no longer says it holds in both phases and on both builds — a " +
      "build-specific cadence is what the harness fallback used to be",
  );
  assert.match(
    cadence,
    /batching is opt-in|opt-in only/i,
    "batching is no longer marked opt-in; a default batch is the old design returning",
  );
});

test("AC-4: no model-instructing file keeps a batched or per-build cadence", () => {
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
      .split("\n")
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
  assert.deepEqual(offenders, [], "one question per round, both phases, both builds");
});

test("AC-4: CLAUDE.md's grill bullet describes the shipped cadence", () => {
  // CLAUDE.md is where a contributor reads what the Codex build does differently. Its
  // grill bullet claimed an AskUserQuestion batch and a numbered-rounds fallback long
  // after both were removed — a stale parity note is a wrong map, not a typo.
  const lines = read("CLAUDE.md").split("\n");
  const start = lines.findIndex((l) => l.startsWith("- `grill`"));
  assert.ok(start !== -1, "CLAUDE.md's partial-parity list no longer has a `grill` bullet");
  const end = lines.findIndex((l, i) => i > start && /^- /.test(l));
  // Whitespace-normalized: the bullet is hard-wrapped and indented, so a phrase this
  // test looks for routinely straddles a line break.
  const bullet = lines
    .slice(start, end === -1 ? undefined : end)
    .join(" ")
    .replace(/\s+/g, " ");

  assert.match(bullet, /one question/i, "the bullet no longer states the one-question cadence");
  assert.match(
    bullet,
    /both builds/i,
    "the bullet no longer says the cadence is build-independent",
  );
  assert.doesNotMatch(
    bullet,
    STALE_BULLET_RE,
    "the bullet describes a picker or a fallback the interview no longer has",
  );
});

// ---------------------------------------------------------------------------
// AC-7 — tier sets the interview's DEPTH, never its cadence
//
// Compressed depth is defined in two files, and these three phrases are the contract
// between them: each file carries all three, verbatim. This is a shared-phrase pin, not
// a semantic one — rewording one copy fails here on purpose, because the two
// definitions silently diverging is HARRY.md §2's drift test answering "bug" (the model
// would get two different interviews for one tier). Reword both copies together.

test("AC-7: both definitions of compressed depth make the same claims", () => {
  const claims: [RegExp, string][] = [
    [/divergence is brief/i, "divergence is brief"],
    [/convergence covers only the frontier/i, "convergence covers only this task's frontier"],
    [/exit gate,? unabridged/i, "the exit gate is closed unabridged"],
  ];
  for (const rel of [BRAINSTORMING, TIER_GATES]) {
    const text = read(rel);
    for (const [re, claim] of claims)
      assert.match(text, re, `${rel}'s compressed-depth definition dropped: ${claim}`);
  }
});

test("AC-7: tier gates set depth, and no tier row sets cadence", () => {
  assert.match(
    read(BRAINSTORMING),
    /depth, never its cadence/i,
    `${BRAINSTORMING} no longer states that tier sets depth and never cadence`,
  );
  // tier-gates agrees by ABSENCE: a cadence directive appearing in a tier row is
  // exactly what "tier never sets cadence" forbids, and it would out-rank the
  // reference for a model reading the gates table.
  const gates = read(TIER_GATES);
  const offenders: string[] = [];
  for (const [heading, next] of [
    ["### Standard", "### Major"],
    ["### Major", "## Promotion rules"],
  ] as const)
    section(gates, TIER_GATES, heading, next)
      .split("\n")
      .forEach((line) => {
        if (/\bquestions?\b|per round|cadence/i.test(line))
          offenders.push(`${heading}: ${line.trim()}`);
      });
  assert.deepEqual(
    offenders,
    [],
    "a tier row is prescribing interview cadence; only depth belongs here",
  );
});
