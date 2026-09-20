import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The plain-language law (HARRY.md §6) splits harry's prose by READER: what the user
// reads is paced for a person, what another model reads stays precision-first. That
// split is the whole point — a rule stated for "prose" without saying whose prose
// would either pad subagent briefs or license dense chat replies. The law states it,
// `references/plain-language.md` carries the technique, and `/wait-what` is the one
// caller that asks for the deeper level.
//
// The same unit cut five undefined terms out of the shipped trees. A term that
// re-enters those trees undefined is not a style regression: the laws are read by a
// model that has only this text to go on, and an ungrounded term is a silently
// misread instruction — HARRY.md §2's drift test answering "bug".
//
// These tests pin the CLAIMS on both sides of that boundary and tolerate rewording
// around them. Sibling of grilling-contract.test.ts (same door/reference shape) and
// redline-drift.test.ts (same corpus-scan shape).

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
/** Hard-wrapped prose: a claim this file looks for routinely straddles a line break. */
const flat = (text: string): string => text.replace(/\s+/g, " ");
/**
 * Flattened and with markdown emphasis dropped. Every probe below is after a CLAIM, and
 * bolding a word inside one does not change what it says — pinning the `**` makes an
 * editor who unbolds one word fail a contract test for nothing.
 */
const plain = (text: string): string => flat(text).replace(/\*+/g, "");

const PLAIN_LANGUAGE = "references/plain-language.md";
const DOORS = [
  path.join("commands", "wait-what.md"),
  path.join("codex-skills", "wait-what", "SKILL.md"),
];

/** HARRY.md's `- **Plain language for the user.**` bullet, whitespace-normalized. */
function lawBullet(): string {
  const bullet = read("HARRY.md")
    .split("\n")
    .find((l) => l.includes("**Plain language for the user"));
  assert.ok(bullet, "HARRY.md §6 no longer has a 'Plain language for the user' bullet");
  return flat(bullet);
}

// ---------------------------------------------------------------------------
// AC-1 — the law, for prose addressed to the user
//
// Five claims, each independently load-bearing: drop the audience sentence and the
// model writes for someone who has read this repo; drop "one layer at a time" and the
// pre-empted next question comes back. They are asserted on the LAW, not on the
// reference, because the law is what is resident in every session — a rule that only
// exists in an on-demand reference does not bind the message being written right now.

test("AC-1: HARRY.md §6 carries the plain-language rule for user-facing prose", () => {
  const bullet = lawBullet();
  assert.match(
    bullet,
    /Prose addressed to the user/i,
    "the law no longer scopes the rule to prose addressed to the user",
  );
  assert.match(bullet, /opens with the outcome/i, "conclusion-first is gone from the law");
  assert.match(
    bullet,
    /one layer at a time[^.]*(?:expands?|request)/i,
    "the law no longer says one layer at a time, expanded on request",
  );
  assert.match(
    bullet,
    /at most one new concept per message/i,
    "the one-new-concept-per-message limit is gone",
  );
  assert.match(
    bullet,
    /capable adult who has not read this codebase/i,
    "the audience sentence is gone — without it the model writes for a reader who has " +
      "read this repo, which is the failure the rule exists to prevent",
  );
  assert.match(bullet, /One question per message/i, "the one-question-per-message rule is gone");
  assert.ok(
    bullet.includes(PLAIN_LANGUAGE),
    `the law no longer points at ${PLAIN_LANGUAGE}, so the technique is unreachable`,
  );
});

test("AC-1: the one-question rule keeps its already-shown-as-one-list carve-out", () => {
  // The carve-out is what stops the rule from forbidding a batched ruling on a list the
  // user is already looking at (an AC review). Its TEST is what matters: the items were
  // already put in front of the reader as one list. A carve-out that lost that test
  // would read as "several questions are fine if they arrive together", which is the
  // rule inverted rather than qualified.
  const bullet = lawBullet();
  assert.match(
    bullet,
    /already shown[^.]*as one list|items already shown to the user as one list/i,
    "the carve-out no longer requires the items to have been shown as one list first",
  );
  assert.match(
    bullet,
    // The negation itself, not the phrase it is attached to: a looser alternative like
    // /arriv\w+ at once/ matches "decisions arriving at once are fine" too, which is the
    // rule inverted — exactly what this assertion claims to catch.
    /separate decisions arriving at once do not/i,
    "the carve-out no longer excludes separate decisions that merely arrive together",
  );
});

// ---------------------------------------------------------------------------
// AC-2 — the split by reader
//
// Without this half the law reads as "write plainly", full stop, and a subagent brief
// or a review report gets paced and padded — which costs precision exactly where the
// reader is a model that does not need the pacing. The one rule that crosses over is
// the no-new-term rule, and it is stated HERE rather than only in the reference,
// because the reference is scoped to the user side.

test("AC-2: model-to-model artifacts stay precision-first and coin no new term", () => {
  const bullet = lawBullet();
  for (const artifact of [/subagent brief/i, /review report/i, /commit message/i])
    assert.match(
      bullet,
      artifact,
      `the law no longer names ${artifact} among the model-to-model artifacts; an ` +
        "unnamed artifact falls back to the user-side pacing rules by default",
    );
  assert.match(
    bullet,
    /precision-first|stay precision/i,
    "model-to-model artifacts are no longer held to precision first",
  );
  assert.match(
    bullet,
    /no new term|may coin no new term/i,
    "the no-new-term rule is gone from the model side",
  );
  // Where a term counts as already defined. Losing this clause turns the rule into
  // "never use a project term", which no brief can follow.
  for (const source of [/laws/i, /`references\/`/, /`skills\/`/])
    assert.match(
      bullet,
      source,
      `the no-new-term rule no longer names ${source} as a place a term may already be defined`,
    );
});

test("AC-2: a PR body is user-facing, not a model-to-model artifact", () => {
  // Ruled by the user: people read a PR body, and §5 has the user approve the draft
  // before the PR is opened, so it follows the user-facing pacing rules. The law's
  // model-side list is checked on its own — a later sentence may well name PR bodies
  // on the user side, and a whole-bullet ban would fail on that.
  const modelSide = /Model-to-model artifacts \(([^)]*)\)/i.exec(lawBullet())?.[1];
  assert.ok(modelSide, "the law no longer lists which artifacts are model-to-model");
  assert.doesNotMatch(
    modelSide,
    /PR bod(?:y|ies)/i,
    "the law counts a PR body as model-to-model again — the user approves that draft " +
      "and people read it, so it is user-facing prose (HARRY.md §5)",
  );
  assert.match(
    plain(read(PLAIN_LANGUAGE)),
    /a PR body[^.]*written for the person/i,
    `${PLAIN_LANGUAGE} no longer lists a PR body among the prose written for the person`,
  );
  assert.match(
    plain(read(PLAIN_LANGUAGE)),
    /the user approve the draft before the PR is opened/i,
    `${PLAIN_LANGUAGE} no longer says why a PR body is the user's — the §5 approval step ` +
      "is the reason, and without it the classification reads as a bare assertion",
  );
});

// ---------------------------------------------------------------------------
// AC-3 — the technique file
//
// The grounding rule and the two cognitive principles are the file's WHY; the two
// levels are its what. A file that kept the levels and lost the grounding rule would
// read as a style guide — and the rule is the part that catches plain-worded prose
// leaning on an idea the reader was never given, which no wording check finds.

test("AC-3: plain-language.md carries the grounding rule, both principles, and two levels", () => {
  const text = plain(read(PLAIN_LANGUAGE));
  assert.match(
    text,
    /A concept is established before anything is written that leans on it/i,
    "the grounding rule's load-bearing sentence is gone",
  );
  assert.match(
    text,
    /the unit that matters is the concept, not the word for it/i,
    "the grounding rule no longer says the unit is the concept, not the word — without " +
      "it the rule collapses into a jargon ban and misses plain-worded ungrounded prose",
  );
  assert.match(
    text,
    /Difficulty consumes the working memory/i,
    "principle 1 (difficulty spends the capacity needed to understand) is gone",
  );
  assert.match(
    text,
    /Fluency in the moment is not retention/i,
    "principle 2 (reading as clear is not recalling) is gone",
  );
  assert.match(text, /### Default/, "the default level's heading is gone");
  assert.match(
    text,
    /### The deeper level — `\/wait-what`/,
    "the deeper level is no longer a named level of this file",
  );
  // The deeper level is defined here, not in the doors — a door that had to state it
  // would be a second copy of it (HARRY.md §2).
  assert.match(
    text,
    /re-explain it once/i,
    "the deeper level no longer says a stated message is re-explained once",
  );
  assert.match(
    text,
    /Ask the same question again, plainer/i,
    "the deeper level lost the question case — re-explaining a question by answering it " +
      "picks the side the user was being asked to pick",
  );
});

// ---------------------------------------------------------------------------
// AC-4 — the two `/wait-what` doors
//
// One-shot is the property that makes the door safe to invoke: a mode would silently
// re-pace every later message, and nothing downstream would say why. Both doors must
// say it, because a Codex reader never sees the CC one.

test("AC-4: both /wait-what doors are thin pointers that say one-shot, not a mode", () => {
  for (const door of DOORS) {
    const text = flat(read(door));
    assert.ok(text.includes(PLAIN_LANGUAGE), `${door} no longer points at ${PLAIN_LANGUAGE}`);
    assert.match(
      text,
      /one-shot|once, on that one message only/i,
      `${door} no longer says the re-explanation is one-shot`,
    );
    assert.match(
      text,
      /not a mode|does not persist/i,
      `${door} no longer says this is not a standing mode`,
    );
    // Thin: the door names the technique, it does not restate it. A restated rule is a
    // second copy that can be relaxed on one build only.
    for (const restated of [
      /one question per message/i,
      /one new concept/i,
      /capable adult/i,
      /working memory/i,
    ])
      assert.doesNotMatch(
        text,
        restated,
        `${door} is a door, not a second copy of the technique — keep the content in ${PLAIN_LANGUAGE}`,
      );
  }
});

// ---------------------------------------------------------------------------
// AC-5 / AC-6 — the corpus
// ---------------------------------------------------------------------------

/**
 * Every shipped file a model reads: the laws, the technique references, the skills,
 * both builds' doors, the role cards, and the two contributor-facing top-level docs.
 *
 * NOT `.md`-only, deliberately. `references/audit/` ships a JSON schema and a CJS
 * validator that carry the same vocabulary — one of the `hoist` uses below is a schema
 * enum value — and an extension filter would drop them out of the scan while it kept
 * reading as corpus-wide.
 */
const CORPUS_DIRS = ["references", "skills", "commands", "codex-skills", "agents"];
const CORPUS_TOP_LEVEL = ["HARRY.md", "CLAUDE.md", "README.md"];

function corpus(): string[] {
  const files = [...CORPUS_TOP_LEVEL];
  for (const dir of CORPUS_DIRS) {
    const abs = path.join(repoRoot, dir);
    const found = readdirSync(abs, { recursive: true, encoding: "utf-8" })
      .map((rel) => path.join(dir, rel))
      .filter((rel) => statSync(path.join(repoRoot, rel)).isFile());
    // Non-vacuity, as in grilling-contract.test.ts: a renamed directory would otherwise
    // drop its files and leave every scan below passing on a smaller corpus.
    assert.ok(found.length > 0, `${dir}/ holds no files — renamed? the scan below is now blind`);
    files.push(...found);
  }
  return files;
}

// Terms cut for being undefined where they were used. Two shapes:
//
//  - GONE: no use survives anywhere in the corpus. A reappearance is flagged wherever
//    it lands, which is the whole check.
//  - SURVIVING: the term still earns its place at specific spots, each of which
//    glosses or defines it there. The check is a per-term file allowlist plus one
//    gloss anchor at the defining site.
//
// WHAT THE ALLOWLIST CATCHES: the term spreading to a file that does not define it —
// the actual failure mode, since an undefined use is written where the concept is
// already familiar to the author, i.e. somewhere new.
// WHAT IT DOES NOT CATCH: a second, ungrounded use added INSIDE an allowlisted file.
// Reading every occurrence for a nearby gloss is not mechanically decidable, and a
// proximity heuristic would be an approximation dressed as a guard. The gloss anchors
// below close the half that is decidable: the defining sentence itself cannot be lost
// while the term stays.
// Deliberately NOT an exact both-directions equality against the files on disk: a
// harmless copy-edit that drops the last use in one allowlisted file would then fail,
// and this guard exists to stop the term SPREADING, not to freeze its uses in place.
const GONE = {
  breaker: /\bbreakers?\b/i,
  // Hyphen or space: the same term written open is the same undefined term.
  "law-wiring": /law[-\s]wiring/i,
} as const;

// `gloss` is a LIST of per-file anchors, not one: `premise check` names two different
// procedures (a design's premises at hand-off, a deferral's premise when it is
// re-judged), and one anchor in one file would leave the other file's use resting on a
// definition that is not about it.
const SURVIVING: Record<string, { re: RegExp; allowed: string[]; gloss: [string, RegExp][] }> = {
  "premise check": {
    re: /premise[-\s]checks?/i,
    allowed: [path.join("skills", "brainstorming", "SKILL.md"), "references/debt-audit.md"],
    gloss: [
      [
        path.join("skills", "brainstorming", "SKILL.md"),
        /premises the design rests on still hold/i,
      ],
      ["references/debt-audit.md", /judge whether the original premise still holds/i],
    ],
  },
  flush: {
    // Prefix, not a fixed set of endings: `flushing` is the same term and the closed
    // alternation missed it.
    re: /\bflush\w*/i,
    allowed: [path.join("skills", "finishing", "SKILL.md"), "references/doc-types.md"],
    // The sentence that says what flushing IS, not the heading above it: a heading
    // pins that the words exist, and the term stays defined only while this does.
    gloss: [
      [
        "references/doc-types.md",
        /every line under the item's `## Follow-ups` becomes its own new `status: backlog` item/i,
      ],
    ],
  },
  hoist: {
    // `hoist-candidates`, `reusability-hoist` and `Hoist-candidate` all start at a word
    // boundary, so the prefix match covers every shape the audit bundle uses.
    re: /\bhoist\w*/i,
    // The audit bundle self-glosses the word at first use and reuses it as a fixed
    // enum value in `report-schema.json` / `validate-findings.cjs`; both audit doors
    // carry the same self-glossing phrase in their description line.
    allowed: [
      path.join("commands", "audit.md"),
      path.join("codex-skills", "audit", "SKILL.md"),
      "references/audit/DEEP-DIVE.md",
      "references/audit/ORCHESTRATION.md",
      "references/audit/RECON.md",
      "references/audit/SCAN-DIMENSIONS.md",
      "references/audit/VALIDATION-AND-REPORTING.md",
      "references/audit/report-schema.json",
      "references/audit/validate-findings.cjs",
    ],
    gloss: [
      [
        "references/audit/SCAN-DIMENSIONS.md",
        /hoist candidates \(same-intent code that drifted apart\)/i,
      ],
    ],
  },
};

test("AC-5: the cut-term regexes still match the prose they replaced", () => {
  // Proven against literals from the text this unit removed, so a regex that stopped
  // matching cannot read the same as a corpus with nothing to flag.
  assert.ok(GONE.breaker.test("the breaker trips after three failed fixes"));
  assert.ok(GONE["law-wiring"].test("`sync`'s law-wiring inlines HARRY.md's content"));
  assert.ok(GONE["law-wiring"].test("the law wiring runs at install time"));
  assert.ok(SURVIVING["premise check"]?.re.test("run step 9's premise check"));
  assert.ok(SURVIVING["premise check"]?.re.test("run step 9's premise-check"));
  assert.ok(SURVIVING.flush?.re.test("only `## Follow-ups` is flushed"));
  assert.ok(SURVIVING.flush?.re.test("flushing `## Follow-ups` before the archive"));
  assert.ok(SURVIVING.hoist?.re.test("suggest the hoist and its destination"));
});

test("AC-5: the terms cut entirely are absent from every shipped file", () => {
  const files = corpus();
  assert.ok(files.includes("HARRY.md"), "the resident laws dropped out of the jargon scan");
  const offenders: string[] = [];
  for (const rel of files)
    read(rel)
      .split("\n")
      .forEach((line, i) => {
        for (const [term, re] of Object.entries(GONE))
          if (re.test(line)) offenders.push(`${rel}:${i + 1} (${term})`);
      });
  assert.deepEqual(
    offenders,
    [],
    "a term this unit cut is back in the shipped prose with no definition behind it",
  );
});

for (const [term, { re, allowed, gloss }] of Object.entries(SURVIVING)) {
  test(`AC-5: "${term}" appears only where it is defined`, () => {
    const offenders = corpus()
      .filter((rel) => !allowed.includes(rel))
      .filter((rel) => re.test(read(rel)));
    assert.deepEqual(
      offenders,
      [],
      `"${term}" is used in a file that does not define it. Either gloss it at the new ` +
        "site and add the file here, or use the plain words instead (HARRY.md §6).",
    );

    // The allowlist is only honest while the term is still in use: once every allowed
    // file drops it, the entry belongs in GONE, where a reappearance is flagged
    // anywhere rather than silently permitted across this whole list.
    assert.ok(
      allowed.some((rel) => re.test(read(rel))),
      `"${term}" no longer appears in any allowlisted file — move it to GONE`,
    );

    for (const [glossFile, glossRe] of gloss)
      assert.match(
        plain(read(glossFile)),
        glossRe,
        `${glossFile} no longer defines "${term}" at the spot the allowlist rests on`,
      );
  });
}

// ---------------------------------------------------------------------------
// AC-6 — every surviving project term is defined somewhere a reader can reach
//
// The cut list's counterpart. These nine terms stayed because each one earns a name,
// and each earns it only while the defining sentence is still in the shipped tree: a
// model reading `references/tier-gates.md` cold has nothing else to resolve "frontier"
// against. Pinned at the DEFINING site only, never corpus-wide — `frontier` also means
// "frontier model" in the `/ask` doors and `ledger` also names `/debt`'s output, so a
// corpus-wide pin would be matching the wrong word.

const DEFINITIONS: Record<string, [string, RegExp]> = {
  "red line": ["HARRY.md", /red lines, the boundaries[^.]*shortcut cross/i],
  "acceptance criteria": [
    "references/doc-types.md",
    /`### Acceptance criteria` is a numbered `AC-1, AC-2, …` list/i,
  ],
  frontier: [
    "references/grilling.md",
    /frontier: every question whose prerequisites are already settled/i,
  ],
  // Bounded deliberately: the probes here run against whitespace-flattened text, so a
  // `[^\n]*` gap would span the whole file and match a heading's words against a
  // sentence three sections away.
  "residue manifest": ["references/grilling.md", /Residue manifest [—-] the exit gate/i],
  "dispatch cap": [
    path.join("skills", "executing", "SKILL.md"),
    /dispatch cap — `opus`[^)]*HARD cap/i,
  ],
};

for (const [term, [rel, re]] of Object.entries(DEFINITIONS)) {
  test(`AC-6: "${term}" carries its defining sentence in ${rel}`, () => {
    assert.match(
      plain(read(rel)),
      re,
      `"${term}" is used across the shipped trees but ${rel} no longer says what it means`,
    );
  });
}

// Two of the nine are defined by ENUMERATION, not by a sentence — the definition is
// the complete set of values, so a probe for a defining clause would fail on prose that
// is doing its job. Pinned as the enumeration each one is.

test("AC-6: 'tier' is defined by the enumeration in §3's table and tier-gates.md", () => {
  // Every body row of §3's table, not the rows already known to be the right three: a
  // filter on the expected names asserts nothing a fourth row could fail, and a tier the
  // enumeration does not list is the one thing this check exists to catch.
  const section = read("HARRY.md").split("## §3")[1]?.split("## §4")[0] ?? "";
  const table = section
    .split("\n")
    .filter((l) => l.trimStart().startsWith("|"))
    .slice(2) // the header row and the alignment row below it
    .map((l) => (l.split("|")[1] as string).trim());
  assert.deepEqual(
    table,
    ["Trivial", "Standard", "Major"],
    "HARRY.md §3's table no longer enumerates exactly the three tiers — the enumeration " +
      "IS the definition of 'tier', so a missing row leaves the term partly undefined",
  );
  assert.match(
    plain(read("references/tier-gates.md")),
    /Classify every non-trivial task into exactly one tier/i,
    "tier-gates.md no longer says a task lands in exactly one tier",
  );
});

test("AC-6: 'scope tag' is defined by its two values in grilling.md", () => {
  const text = plain(read("references/grilling.md"));
  assert.match(
    text,
    /scope tag[^.]*deferred-in-scope or destination-outside/i,
    "grilling.md no longer enumerates the scope tag's two values beside the term — the " +
      "pair IS the definition, and a deferred line carries one of them",
  );
});

// `squash` and `ledger` are the other two survivors, and both are already pinned at
// their defining sites by tests that own those sentences: squash-merge-rule.test.ts
// ("HARRY.md §5 makes integration a squash merge") and grilling-contract.test.ts
// ("AC-5: the ledger keeps four lists…"). Re-pinning either here would put two regexes
// on one sentence, which is the drift vector HARRY.md §2 forbids, so they are cited
// rather than duplicated.
