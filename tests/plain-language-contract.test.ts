import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ");
const plain = (text: string): string =>
  flat(text)
    .replace(/\*+/g, "")
    .replace(/(?<!\w)_+|_+(?!\w)/g, "");

const PLAIN_LANGUAGE = "references/plain-language.md";
const DOORS = [
  path.join("commands", "wait-what.md"),
  path.join("codex-skills", "wait-what", "SKILL.md"),
];

function lawBullet(): string {
  const bullet = read("HARRY.md")
    .split("\n")
    .find((l) => l.includes("**Plain language.**"));
  assert.ok(bullet, "HARRY.md §6 no longer has a 'Plain language' bullet");
  return flat(bullet);
}

test("AC-1: HARRY.md §6 carries the plain-language rule for user-facing prose", () => {
  const bullet = lawBullet();
  assert.match(
    bullet,
    /Prose addressed to the user/i,
    "the law no longer scopes the pacing rules to prose addressed to the user; pinned on the law, not the reference, because only the law is resident in every session",
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
  const bullet = lawBullet();
  assert.match(
    bullet,
    /already shown[^.]*as one list|items already shown to the user as one list/i,
    "the carve-out no longer requires the items to have been shown as one list first" +
      " — " +
      'The carve-out is what stops the rule from forbidding a batched ruling on a list the user is already looking at (an AC review). Its TEST is what matters: the items were already put in front of the reader as one list. A carve-out that lost that test would read as "several questions are fine if they arrive together", which is the rule inverted rather than qualified.',
  );
  assert.match(
    bullet,
    /separate decisions arriving at once do not\./i,
    "the carve-out no longer excludes separate decisions that merely arrive together — " +
      "pinned with its full stop, since a looser pattern also matches the rule inverted",
  );
});

test("AC-2: model-to-model artifacts stay precision-first and coin no new term", () => {
  const bullet = lawBullet();
  const modelSide = /[^.]*precision-first[^.]*\./i.exec(bullet)?.[0];
  assert.ok(
    modelSide,
    "subagent briefs and review reports are no longer held to precision first; without it they get paced and padded where the reader is a model",
  );
  for (const artifact of [/subagent brief/i, /review report/i])
    assert.match(
      modelSide,
      artifact,
      `the law no longer names ${artifact} among the model-to-model artifacts`,
    );
  assert.doesNotMatch(
    modelSide,
    /commit message|code comment/i,
    "commit messages and code comments are written for people (HARRY.md §6)",
  );
  assert.match(
    bullet,
    /no new term|may coin no new term/i,
    "the no-new-term rule is gone from the model side",
  );
  for (const source of [/laws/i, /`references\/`/, /`skills\/`/])
    assert.match(
      bullet,
      source,
      `the no-new-term rule no longer names ${source} as a place a term may already be defined` +
        " — " +
        'Where a term counts as already defined. Losing this clause turns the rule into "never use a project term", which no brief can follow.',
    );
});

test("AC-2: a PR body is user-facing, not a model-to-model artifact", () => {
  const modelSide = /[^.]*precision-first[^.]*\./i.exec(lawBullet())?.[0];
  assert.ok(
    modelSide,
    "the law no longer lists which artifacts are model-to-model" +
      " — " +
      "Ruled by the user: people read a PR body, and §5 has the user approve the draft before the PR is opened, so it follows the user-facing pacing rules. The law's model-side list is checked on its own — a later sentence may well name PR bodies on the user side, and a whole-bullet ban would fail on that.",
  );
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

test("AC-3: plain-language.md carries the grounding rule, both principles, and two levels", () => {
  const text = plain(read(PLAIN_LANGUAGE));
  assert.match(
    text,
    /A concept is established before anything is written that leans on it/i,
    "the grounding rule's load-bearing sentence is gone" +
      " — " +
      "The grounding rule and the two cognitive principles are the file's WHY; the two levels are its what. A file that kept the levels and lost the grounding rule would read as a style guide — and the rule is the part that catches plain-worded prose leaning on an idea the reader was never given, which no wording check finds.",
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
  assert.match(
    text,
    /re-explain it once/i,
    "the deeper level no longer says a stated message is re-explained once" +
      " — " +
      "The deeper level is defined here, not in the doors — a door that had to state it would be a second copy of it (HARRY.md §2).",
  );
  assert.match(
    text,
    /Ask the same question again, plainer/i,
    "the deeper level lost the question case — re-explaining a question by answering it " +
      "picks the side the user was being asked to pick",
  );
});

test("AC-4: both /wait-what doors are thin pointers that say one-shot, not a mode", () => {
  for (const door of DOORS) {
    const text = flat(read(door));
    assert.ok(
      text.includes(PLAIN_LANGUAGE),
      `${door} no longer points at ${PLAIN_LANGUAGE}, which owns the deeper level`,
    );
    assert.match(
      text,
      /one-shot|once, on that one message only/i,
      `${door} no longer says the re-explanation is one-shot; a mode would silently re-pace every later message`,
    );
    assert.match(
      text,
      /not a mode|does not persist/i,
      `${door} no longer says this is not a standing mode`,
    );
    for (const restated of [
      /one question per message/i,
      /one new concept/i,
      /capable adult/i,
      /working memory/i,
    ])
      assert.doesNotMatch(
        text,
        restated,
        `${door} is a door, not a second copy of the technique — keep the content in ${PLAIN_LANGUAGE}` +
          " — " +
          "Thin: the door names the technique, it does not restate it. A restated rule is a second copy that can be relaxed on one build only.",
      );
  }
});

const CORPUS_DIRS = ["references", "skills", "commands", "codex-skills", "agents"];
const CORPUS_TOP_LEVEL = ["HARRY.md", "CLAUDE.md", "README.md"];

function corpus(): string[] {
  const files = [...CORPUS_TOP_LEVEL];
  for (const dir of CORPUS_DIRS) {
    const abs = path.join(repoRoot, dir);
    const found = readdirSync(abs, { recursive: true, encoding: "utf-8" })
      .map((rel) => path.join(dir, rel))
      .filter((rel) => statSync(path.join(repoRoot, rel)).isFile());
    assert.ok(
      found.length > 0,
      `${dir}/ holds no files — renamed? the scan below is now blind` +
        " — " +
        "Non-vacuity, as in grilling-contract.test.ts: a renamed directory would otherwise drop its files and leave every scan below passing on a smaller corpus.",
    );
    files.push(...found);
  }
  return files;
}

const GONE = {
  breaker: /\bbreakers?\b/i,
  "law-wiring": /law[-\s]wiring/i,
} as const;

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
    re: /\bflush\w*/i,
    allowed: [path.join("skills", "finishing", "SKILL.md"), "references/doc-types.md"],
    gloss: [
      [
        "references/doc-types.md",
        /every line under the item's `## Follow-ups` becomes its own new `status: backlog` item/i,
      ],
    ],
  },
  hoist: {
    re: /\bhoist\w*/i,
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
  assert.ok(
    GONE.breaker.test("the breaker trips after three failed fixes"),
    "Proven against literals from the text this unit removed, so a regex that stopped matching cannot read the same as a corpus with nothing to flag.",
  );
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
  for (const rel of files) {
    const text = flat(read(rel));
    for (const [term, re] of Object.entries(GONE))
      if (re.test(text)) offenders.push(`${rel} (${term})`);
  }
  assert.deepEqual(
    offenders,
    [],
    "a term this unit cut is back in the shipped prose with no definition behind it" +
      " — " +
      "Whole file, flattened — not line by line: a hard wrap inside `law\\nwiring` would otherwise split the term across two lines that each pass.",
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
        "site and add the file here, or use the plain words instead (HARRY.md §6). " +
        "Limit: a second, ungrounded use inside an allowlisted file is not caught; " +
        "that is not mechanically decidable. Deliberately not an exact equality with the " +
        "files on disk, so a copy-edit that drops one use does not fail.",
    );

    assert.ok(
      allowed.some((rel) => re.test(read(rel))),
      `"${term}" no longer appears in any allowlisted file — move it to GONE` +
        " — " +
        "The allowlist is only honest while the term is still in use: once every allowed file drops it, the entry belongs in GONE, where a reappearance is flagged anywhere rather than silently permitted across this whole list.",
    );

    for (const [glossFile, glossRe] of gloss)
      assert.match(
        plain(read(glossFile)),
        glossRe,
        `${glossFile} no longer defines "${term}" at the spot the allowlist rests on`,
      );
  });
}

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

const HEADER_AND_ALIGNMENT_ROWS = 2;

test("AC-6: 'tier' is defined by the enumeration in §3's table and tier-gates.md", () => {
  const section = read("HARRY.md").split("## §3")[1]?.split("## §4")[0] ?? "";
  const table = section
    .split("\n")
    .filter((l) => l.trimStart().startsWith("|"))
    .slice(HEADER_AND_ALIGNMENT_ROWS)
    .map((l) => (l.split("|")[1] as string).trim());
  assert.deepEqual(
    table,
    ["Trivial", "Standard", "Major"],
    "HARRY.md §3's table no longer enumerates exactly the three tiers; the enumeration is the definition of 'tier', and every body row is read so a fourth row fails too",
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

test("AC-6: squash and ledger are pinned in their own contract tests, cited here rather than re-pinned", () => {
  assert.match(
    read("tests/squash-merge-rule.test.ts"),
    /HARRY\.md §5 makes integration a squash merge/,
    "squash's defining sentence lost its pin; re-pinning it here would put two regexes on one sentence (HARRY.md §2)",
  );
  assert.match(
    read("tests/grilling-contract.test.ts"),
    /AC-5: the ledger keeps four lists/,
    "ledger's defining sentence lost its pin; re-pinning it here would put two regexes on one sentence (HARRY.md §2)",
  );
});
