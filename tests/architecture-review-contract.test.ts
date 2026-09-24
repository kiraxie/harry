import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

const FINISHING = path.join("skills", "finishing", "SKILL.md");
const ARCH_REVIEW = path.join("references", "architecture-review.md");
const CHANGELOG = "CHANGELOG.md";
const DOC_TYPES = path.join("references", "doc-types.md");
const RUBRIC = path.join("references", "review-rubric.md");
const EXECUTING = path.join("skills", "executing", "SKILL.md");

const plain = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .replace(/[*`]/g, "")
    .replace(/(^|[^\w])_(?=\S)|(?<=\S)_(?=[^\w]|$)/g, "$1");

function section(text: string, rel: string, startHeading: string, endHeading: string): string {
  const start = text.indexOf(startHeading);
  assert.ok(start !== -1, `${rel} no longer has the heading "${startHeading}"`);
  const end = text.indexOf(endHeading, start + startHeading.length);
  assert.ok(end !== -1, `${rel} no longer has the heading "${endHeading}" after "${startHeading}"`);
  return text.slice(start, end);
}

function labelled(text: string, rel: string, label: string): string {
  const hit = text
    .split(/\n\s*\n/)
    .map(plain)
    .map((p) => p.trim())
    .find((p) => p.startsWith(label));
  assert.ok(hit, `${rel} no longer has a paragraph starting "${label}"`);
  return hit;
}

function step2Raw(): string {
  const text = read(FINISHING);
  const start = text.search(/^## \d+\. Architecture review/m);
  assert.ok(start !== -1, `${FINISHING} no longer has an "Architecture review" step heading`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}
const step2 = (label: string): string => labelled(step2Raw(), FINISHING, label);
const archReview = (): string => plain(read(ARCH_REVIEW));

test("AC-1: the architecture review is step 2, after verify-tests and before merge-or-PR", () => {
  const text = read(FINISHING);
  const verify = text.indexOf("## 1. Verify tests");
  const review = text.indexOf("## 2. Architecture review");
  const ask = text.indexOf("## 3. Ask: merge or PR");
  assert.ok(verify !== -1, "finishing lost its '## 1. Verify tests' heading");
  assert.ok(review !== -1, "finishing lost its '## 2. Architecture review' heading");
  assert.ok(ask !== -1, "finishing lost its '## 3. Ask: merge or PR' heading");
  assert.ok(
    verify < review && review < ask,
    "the architecture review no longer sits between verifying tests and asking merge or PR",
  );
});

test("AC-1: merge, PR and keep all pass through the review; only Discard skips it", () => {
  const intro = plain(step2Raw());
  assert.match(
    intro,
    /Every path out of the menu.*?merge, PR.*?keep.*?passes through it/,
    "step 2 no longer says merge, PR and keep all pass through it",
  );
  assert.match(intro, /only Discard skips it/, "step 2 no longer limits the skip to Discard");

  const table = read(FINISHING)
    .split("\n")
    .filter((l) => /^\| (1\. Merge|2\. PR|3\. Keep) \|/.test(l));
  assert.equal(
    table.length,
    3,
    "the quick reference lost a Merge, PR or Keep row" +
      " — " +
      "The quick reference is the second place a reader looks; a row that says the review does not apply to an integrating option contradicts the step.",
  );
  for (const row of table) {
    const cell = row.split("|")[3].trim();
    assert.match(
      cell,
      /when a shape changed/,
      `quick-reference row "${row.split("|")[1].trim()}" no longer runs the architecture review`,
    );
  }
});

test("AC-1: a pre-decided integration path still runs the architecture review", () => {
  const p = labelled(read(FINISHING), FINISHING, "Pre-decided integration path.");
  assert.match(p, /NOT a shortcut past finishing/, "a pre-decided path became a shortcut");
  assert.match(
    p,
    /still run step 1's verify gate and step 2's architecture review first/,
    "the pre-decided path no longer runs step 2's architecture review before the tail",
  );
});

test("AC-2: a shape is one of four kinds, defined the same in the step and the architecture-review reference", () => {
  const kinds =
    /A shape is the outward form other code depends on: an API, a DB schema, a public interface, or a module or service boundary\./;
  assert.match(plain(step2Raw()), kinds, "step 2's shape definition drifted");
  assert.match(
    archReview(),
    kinds,
    "the architecture-review reference's shape definition drifted from step 2's",
  );
  assert.match(
    step2("Shape gate."),
    /First list the shapes this change added or altered\./,
    "the gate no longer starts by listing the changed shapes",
  );
});

test("AC-2: an empty shape list writes the verbatim skip line to ## Progress", () => {
  assert.match(
    step2("Shape gate."),
    /Empty list → write one line, no shape changed, architecture review skipped, to the item's ## Progress/,
    "the empty-list skip line, or its recording in ## Progress, is gone",
  );
});

test("AC-2: a bug fix that alters a shape is not exempt", () => {
  assert.match(
    step2("Shape gate."),
    /Non-empty → the review runs, whatever the work is called — a bug fix that alters a shape is reviewed like a feature\./,
    "a non-empty shape list no longer runs the review regardless of what the work is called",
  );
});

test("AC-2: with no item (Trivial) the skip line is written in the reply", () => {
  assert.match(
    step2("No item (Trivial)."),
    /There is no ## Progress: the round's head line, the skip line.*?are written in the reply instead\./,
    "a Trivial unit's skip line no longer goes to the reply",
  );
});

test("AC-3: one analyst, one lane", () => {
  const p = step2("Reviewer.");
  assert.match(p, /dispatch ONE harry:analyst, one lane — no Codex lane/);
});

test("AC-3: the reviewer is handed every input", () => {
  const p = step2("Reviewer.");
  const inputs: [RegExp, string][] = [
    [/Hand it: the shape list;/, "the shape list"],
    [/the item's ## Why \/ What and its ### Acceptance criteria/, "the item's design and AC"],
    [/the diff file, by its absolute path;/, "the diff, by absolute path"],
    [/; references\/architecture-review\.md;/, "the architecture-review reference"],
    [
      /the last 20 commits touching the changed paths \(git log -n 20 /,
      "the last 20 commits touching the changed paths",
    ],
    [/and read access to the whole repo\./, "read access to the whole repo"],
    [
      /On a later round, also hand it every ruling recorded so far — each leave as is with the user's reason, and each backlog/,
      "the prior rulings on a later round",
    ],
  ];
  for (const [re, what] of inputs) assert.match(p, re, `the reviewer is no longer handed ${what}`);
});

test("AC-3: the command that writes the diff also creates its directory", () => {
  const p = step2("Reviewer.");
  assert.match(
    p,
    /in one command that resolves <store>, creates that directory with mkdir -p .*?, and writes the file;/,
    "the diff is no longer written by one command that resolves <store> and creates its directory" +
      " — " +
      "Executing's setup creates no per-branch tmp directory, and for a Trivial unit no executing step writes there either; without the mkdir the diff write fails first.",
  );
  assert.match(
    p,
    /mkdir -p \(nothing earlier writes there for a Trivial unit\)/,
    "the reason for the mkdir no longer says nothing earlier writes there for a Trivial unit",
  );
  assert.doesNotMatch(
    p,
    /never ran executing's setup/,
    "the step claims Trivial skips setup" +
      " — " +
      "Trivial does run executing's setup; that setup just creates no directory.",
  );
});

test("AC-3: the diff file is the CC reviewer's input only; the Codex build writes none", () => {
  const p = step2("Reviewer.");
  assert.match(
    p,
    /Package the diff to a file .*?\(the CC reviewer's input only — the Codex build below writes none\)/,
    "the diff file is no longer marked as the CC reviewer's input only" +
      " — " +
      "With --architecture --base, codex computes the diff itself: a packaged diff file on the Codex build would be written and never read.",
  );
  assert.match(
    p,
    /Codex build:.*?Instead of the diff file, in one command that resolves <store> and creates that directory with mkdir -p, write a context file there/,
    "the Codex build no longer writes its context file in place of the diff file",
  );
  assert.doesNotMatch(
    p,
    /In the same command that packages the diff/,
    "the Codex build still packages the diff",
  );
});

test("AC-3: the architecture-review reference lists the same inputs the step hands over", () => {
  const l = archReview();
  const inputs: [RegExp, string][] = [
    [/The shape list — the shapes this change added or altered/, "the shape list"],
    [/The item's ## Why \/ What and its acceptance criteria/, "the design and AC"],
    [/The branch diff, as a file/, "the diff"],
    [/The last 20 commits touching the changed paths/, "the last 20 commits"],
    [/Read access to the whole repo/, "the whole repo"],
    [
      /On a later round, the rulings recorded so far.*?Do not raise a ruled finding again unless the fix changed the shape it concerns\./,
      "the prior rulings, and not re-raising them",
    ],
  ];
  for (const [re, what] of inputs)
    assert.match(l, re, `the architecture-review reference no longer lists ${what}`);
});

test("AC-3: on the Codex build the review runs out of session through companion review --architecture", () => {
  const p = step2("Reviewer.");
  assert.match(
    p,
    /Codex build: there is no subagent to dispatch, so the review runs in a separate read-only codex exec process instead, and is independent\./,
    "the Codex build no longer runs the architecture review in a separate process",
  );
  assert.match(
    p,
    /run that build's review skill \(codex-skills\/review, which owns resolving the plugin root\) with --architecture --base <base> --context @<file> — on a later round --base <sha>, the head the most recent round recorded\./,
    "the Codex build no longer names the companion invocation, or its later-round base",
  );
  assert.match(
    p,
    /context file .*? — the shape list, the item's ## Why \/ What and its AC, the git log -n 20 --stat -- <changed paths> output, and on a later round the rulings recorded so far\./,
    "the Codex build's context file no longer carries the items the CC reviewer is handed",
  );
});

test("AC-3: on the Codex build a failed companion run falls back to the not-independent in-session review", () => {
  assert.match(
    step2("Reviewer."),
    /If that run fails, the session applies references\/architecture-review\.md itself and records one line in ## Progress that this review was not independent\./,
    "the Codex build's fallback, and its not-independent line, is gone",
  );
});

test("AC-3: with no item (Trivial) the reviewer gets the task as the user stated it", () => {
  assert.match(
    step2("No item (Trivial)."),
    /The reviewer gets the task as the user stated it in place of ## Why \/ What and its AC\./,
    "step 2 no longer hands a Trivial reviewer the task as the user stated it",
  );
  assert.match(
    archReview(),
    /A unit with no item hands you the task as the user stated it instead\./,
    "the architecture-review reference no longer tells the reviewer about the Trivial input",
  );
});

test("AC-4: the architecture-review reference carries the five categories", () => {
  const cats = section(
    read(ARCH_REVIEW),
    ARCH_REVIEW,
    "## Five categories",
    "## Two passes beyond the diff",
  );
  const names = [
    "API and interfaces.",
    "DB schema.",
    "Boundaries.",
    "Abstraction timing",
    "System level (across services).",
  ];
  for (const [i, name] of names.entries())
    assert.ok(
      cats.includes(`${i + 1}. **${name}`),
      `the architecture-review reference lost category ${i + 1}, "${name}"`,
    );
});

test("AC-4: line-level quality and tests are excluded", () => {
  const notYours = plain(
    section(read(ARCH_REVIEW), ARCH_REVIEW, "## Not your job", "## Five categories"),
  );
  assert.match(
    notYours,
    /Line-level code quality and tests are out of scope/,
    "the architecture-review reference no longer excludes line-level quality and tests",
  );
});

test("AC-4: step up one level, and label what is seen only from there", () => {
  const l = archReview();
  assert.match(l, /Step up one level\./, "the step-up pass is gone");
  assert.match(
    l,
    /Label every finding that only appears from the higher level seen only one level up\./,
    "findings seen only from one level up are no longer labelled",
  );
});

test("AC-4: the history is read for accumulation", () => {
  assert.match(
    archReview(),
    /Read the history for accumulation\. Read the 20 commits you were handed as a sequence\./,
    "the history pass for accumulated drift is gone",
  );
});

test("AC-4: the unseen side of a boundary is named, not guessed", () => {
  const l = archReview();
  assert.match(
    l,
    /Name the unseen side; never guess it\./,
    "the unseen-side rule is gone or inverted",
  );
  assert.match(
    l,
    /say which side you could not see and judge only the side you could\./,
    "the reviewer no longer judges only the side it could see",
  );
});

test("AC-4: a finding that depends on missing context is a question", () => {
  assert.match(
    archReview(),
    /Missing context becomes a question\. A finding that holds only if something you were not told is true is written as a question to the user, not as a verdict/,
    "missing-context findings are no longer phrased as questions",
  );
});

test("AC-4: every finding carries where, why, structural fix and recommended ruling", () => {
  const out = section(read(ARCH_REVIEW), ARCH_REVIEW, "## Output", "```");
  assert.match(
    plain(out),
    /Every finding carries four things: where .*?, why it matters, the structural fix, and your recommended ruling\./,
    "a finding no longer carries all four fields",
  );
  const template = section(read(ARCH_REVIEW), ARCH_REVIEW, "### Findings", "```\n\nA finding");
  for (const field of ["Where:", "Why:", "Structural fix:", "Recommended ruling:"])
    assert.ok(template.includes(field), `the output template lost "${field}"`);
});

test("AC-4: no findings is said plainly", () => {
  assert.match(
    archReview(),
    /When there is nothing to report, say so plainly — the whole ### Findings section is the single line No findings\. Never pad it/,
    "the no-findings case is no longer one plain line",
  );
});

test("AC-5: findings never reach an automatic fixer and go to the user as one list", () => {
  const p = step2("Rulings.");
  assert.match(
    p,
    /Findings never go to an automatic fixer\./,
    "findings may now reach a fixer; every finding is the user's to rule",
  );
  assert.match(p, /Put them to the user as one list/, "findings are no longer one list");
  assert.match(
    archReview(),
    /you do not fix anything; what you find goes to the user, who rules on each finding\./,
    "the architecture-review reference no longer forbids the reviewer from fixing",
  );
});

test("AC-5: exactly three rulings — fix now, backlog, leave as is", () => {
  const bullets = (text: string, arrow: string): string[] =>
    text
      .replace(/\*/g, "")
      .split("\n")
      .filter((l) => l.startsWith("- ") && l.includes(` ${arrow} `))
      .map((l) => l.slice(2, l.indexOf(` ${arrow} `)));

  const rulings = section(step2Raw(), FINISHING, "**Rulings.**", "No findings →");
  assert.match(
    plain(rulings),
    /Each finding is ruled one of three ways:/,
    "step 2 no longer rules each finding one of three ways",
  );
  assert.deepEqual(bullets(rulings, "→"), ["fix now", "backlog", "leave as is"]);

  const out = section(read(ARCH_REVIEW), ARCH_REVIEW, "## Output", "```");
  assert.match(
    plain(out),
    /The user rules each finding one of three ways/,
    "the architecture-review reference no longer has the user rule each finding one of three ways",
  );
  assert.deepEqual(bullets(out, "—"), ["fix now", "backlog", "leave as is"]);
});

test("AC-5: fix now drafts a new AC that supersedes, if any, and never edits approved text", () => {
  const p = step2("Rulings.");
  assert.match(
    p,
    /fix now → draft a new AC, appended to the item's ### Acceptance criteria and naming the AC it supersedes, if any/,
    "fix now no longer drafts a new AC naming the one it supersedes, if any",
  );
  assert.match(p, /approved AC text is never edited/, "approved AC text may now be edited");
  assert.match(
    p,
    /the user approves it → back to the executing skill/,
    "fix now no longer returns to executing after the user approves",
  );
});

test("AC-5: after a fix, only the shapes the fix changed are re-checked", () => {
  assert.match(
    step2("Rulings."),
    /this step re-checks only the shapes the fix changed/,
    "the re-run no longer re-checks only the shapes the fix changed",
  );
});

test("AC-5: every round records the head it reviews", () => {
  assert.match(
    step2("Shape gate."),
    /Every round records the head it reviews — architecture review at <sha7> \(git rev-parse --short HEAD\) — in ## Progress\./,
    "a round no longer records the head it reviewed, so the next round has no range to start from" +
      " — " +
      "The fix-now bullet alone does not narrow a later round: the shape gate and the diff packaging run every round, so each must say how it narrows, and to what range. The range is anchored on the head the previous round reviewed, not on AC completion lines: the review's fix wave commits after those lines are written, and a range built from them would let a shape that fixer altered merge unreviewed.",
  );
  assert.match(
    step2("No item (Trivial)."),
    /There is no ## Progress: the round's head line, the skip line/,
    "a Trivial unit's head line no longer goes to the reply",
  );
});

test("AC-5: a later round lists and packages everything since the previous round's head", () => {
  assert.match(
    step2("Shape gate."),
    /On a later round — a fix now ruling is already recorded — list only the shapes changed since the head the most recent round recorded: <sha>\.\.HEAD, which covers every commit since, whoever made it \(the executing fix and its review's fix wave\)\./,
    "a later round's shape gate no longer covers every commit since the previous round's head",
  );
  assert.match(
    step2("Reviewer."),
    /or on a later round only the shape gate's <sha>\.\.HEAD, never the whole branch again/,
    "a later round no longer packages the diff since the previous round's head",
  );
  assert.match(
    archReview(),
    /The branch diff, as a file — on a later round, only the diff since the head the previous round reviewed\./,
    "the architecture-review reference no longer says a later round hands the diff since the previous head",
  );
});

test("AC-5: backlog opens a new item quoting the finding", () => {
  assert.match(
    step2("Rulings."),
    /- backlog → a new <store>\/\.local\/items\/<slug>\.md with status: backlog and a ## Notes section quoting the finding/,
    "backlog no longer opens a new item quoting the finding",
  );
});

test("AC-5: leave as is records the reason and is not raised again", () => {
  assert.match(
    step2("Rulings."),
    /- leave as is → the ruling and the user's reason go to ## Progress; handed to the reviewer on any later round, so the finding is not raised again\./,
    "leave as is no longer records the reason, or the finding may be raised again",
  );
});

test("AC-5: there is no round cap", () => {
  assert.match(step2("No findings →"), /There is no round cap:/, "a round cap was introduced");
});

test("AC-5: with no item (Trivial) rulings go to the reply and fix now fixes in place", () => {
  const p = step2("No item (Trivial).");
  assert.match(
    p,
    /and every ruling are written in the reply instead\./,
    "Trivial rulings left the reply",
  );
  assert.match(
    p,
    /A fix now ruling means fix it in place, re-run step 1, and re-check the shapes that changed — no AC is drafted\./,
    "a Trivial fix now no longer fixes in place without drafting an AC",
  );
  assert.match(p, /backlog still opens a new item\./, "a Trivial backlog no longer opens an item");
});

test("fix now: doc-types owns the superseded-AC rule", () => {
  assert.match(
    plain(read(DOC_TYPES)),
    /An AC appended later may name an AC it supersedes \(finishing's fix now ruling drafts one that way\); the superseded AC keeps its text and is judged by its successor, not on its own\./,
    "doc-types no longer says a superseded AC keeps its text and is judged by its successor" +
      " — " +
      "A fix-now AC supersedes an approved one. doc-types owns the rule; the rubric (which both review lanes read) and executing's pre-flight scan are where it is acted on, so each must cite it — otherwise the pre-flight flags the pair as a conflict and the final review fails the superseded AC and hands the approved fix to be reverted.",
  );
});

test("fix now: the review rubric judges a superseded AC by its successor, citing doc-types", () => {
  const spec = plain(section(read(RUBRIC), RUBRIC, "1. **Spec compliance**", "2. **Code quality"));
  assert.match(
    spec,
    /An AC that a later AC supersedes is judged by its successor, not on its own \(references\/doc-types\.md\): its line reads superseded by AC-<m>, never fail, and only the successor's verdict counts\./,
    "the rubric's spec dimension no longer judges a superseded AC by its successor",
  );
});

test("fix now: executing's pre-flight does not count a superseding pair as a conflict", () => {
  const preflight = plain(
    section(read(EXECUTING), EXECUTING, "3. **Pre-flight AC review**", "**Legacy items.**"),
  );
  assert.match(
    preflight,
    /in conflict with another AC or the item's Constraints — a later AC that names the AC it supersedes is not a conflict \(references\/doc-types\.md\)\./,
    "executing's pre-flight may now flag a superseding AC pair as a conflict",
  );
});

test("AC-6: the CHANGELOG records the architecture review", () => {
  // Pinned on the whole file, not on an [Unreleased] section: a release renames that
  // section to its version, and the announcement stays there for good.
  const changelog = plain(read(CHANGELOG));
  assert.match(
    changelog,
    /Finishing reviews the change's shape before anything merges or is pushed\./,
    "the CHANGELOG no longer announces the architecture review",
  );
  assert.match(
    changelog,
    /references\/architecture-review\.md/,
    "the CHANGELOG no longer names the architecture-review reference",
  );
});
