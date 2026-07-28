// fix's diff-stat collection. The numbers it returns are published in the
// `status: "fixed"` success envelope, so a failed collection must never be
// reported as "the model changed nothing" — a consumer cannot tell the two
// apart, and the git diagnostic that would explain it was being discarded.
// Runs against a throwaway temp dir; no real repo is touched.
//
// The second half of this file covers the BASELINE SNAPSHOT — the `beforeRun`
// hook that decides what the fix diff is measured against. It is driven
// end-to-end through the real CLI against a fake codex rather than through an
// exported helper: `beforeRun` is a closure over runFix's state, and the
// behavior that matters (which ref the diff lands on, and that `git stash
// create` mutates nothing) is only observable in the published envelope, the
// job log, and the repo left behind. No test seam was added to fix.ts.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeStagedDiff } from "../src/commands/fix.ts";
import { buildEnv, installFakeCodex } from "./fake-codex.mjs";

const CLI = path.resolve(import.meta.dirname, "../src/companion.ts");

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
}

/**
 * A repo with one commit to diff against and a clean tree, returning its HEAD
 * sha.
 *
 * The identity goes in the repo's LOCAL config rather than on a `-c` command
 * line because the `git commit` below runs without one, and an identity-less
 * runner fails it with exit 128. It is NOT propping up the `git stash create`
 * that fix spawns for itself: git writes stash objects under a hardcoded
 * `git stash <git@stash>` ident and needs no configured identity for them
 * (verified on git 2.50.1 with `user.useConfigOnly=true` and no global config).
 */
function repoWithCommit(dir: string): string {
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(dir, "tracked.txt"), "v1\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "base"]);
  return git(dir, ["rev-parse", "HEAD"]);
}

test("computeStagedDiff: a failed git call reports unknown stats, not zeros", () => {
  // A temp dir outside any repository: every `git` call in computeStagedDiff
  // exits non-zero ("not a git repository"), the same shape as any other
  // failure of the stats collection.
  const dir = tempDir("harry-fix-test-");
  const logged: string[] = [];
  try {
    const stats = computeStagedDiff(dir, "HEAD", (m) => logged.push(m));
    assert.equal(stats, null, "unknown stats must not be reported as zero changes");
    assert.ok(
      logged.some((l) => /not a git repository/i.test(l)),
      `git's own diagnostic must be logged, not swallowed; got: ${JSON.stringify(logged)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The other half of the contract: null must mean UNKNOWN, so a real, successful
// measurement of "the model changed nothing" has to stay reportable as zeros.
// Collapsing the two back together in either direction is the defect.
test("computeStagedDiff: a genuine empty diff is still reported as zeros", () => {
  const dir = tempDir("harry-fix-empty-");
  const logged: string[] = [];
  try {
    repoWithCommit(dir);
    const stats = computeStagedDiff(dir, "HEAD", (m) => logged.push(m));
    assert.deepEqual(
      stats,
      { filesModified: [], linesAdded: 0, linesRemoved: 0 },
      "a measured zero must stay zero, not become unknown",
    );
    assert.deepEqual(logged, [], "a successful collection logs nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── baseline snapshot (runFix's `beforeRun`) ────────────────────────────────

interface FixRun {
  status: number | null;
  envelope: Record<string, unknown>;
  jobLog: string;
  stderr: string;
}

/**
 * Run the real `fix` command in `repo` against a fake codex. The fake model
 * edits nothing, so every file the envelope reports as modified came from the
 * baseline choice, not from the fix.
 */
function runFixCli(repo: string, cleanup: string[]): FixRun {
  const binDir = tempDir("harry-fix-bin-");
  const dataDir = tempDir("harry-fix-data-");
  cleanup.push(binDir, dataDir);
  installFakeCodex(binDir, "task-ok");

  const findingsPath = path.join(binDir, "findings.json");
  writeFileSync(
    findingsPath,
    JSON.stringify([{ id: "f1", file: "tracked.txt", title: "noop", severity: "minor" }]),
  );

  // --allow-shell is required: codex's precheck refuses write-without-shell, and
  // that refusal fires BEFORE beforeRun — the baseline would never be computed.
  const res = spawnSync(
    process.execPath,
    [CLI, "fix", "--findings", findingsPath, "--allow-shell"],
    { cwd: repo, encoding: "utf8", env: { ...buildEnv(binDir), CLAUDE_PLUGIN_DATA: dataDir } },
  );

  const lines = (res.stdout ?? "").trim().split("\n").filter(Boolean);
  const last = lines.at(-1) ?? "";
  let envelope: Record<string, unknown> = {};
  try {
    envelope = JSON.parse(last) as Record<string, unknown>;
  } catch {
    assert.fail(`expected a JSON envelope on stdout, got:\n${res.stdout}\n---\n${res.stderr}`);
  }

  const logMatch = (res.stderr ?? "").match(/Job log: (.+)$/m);
  const jobLog = logMatch ? readFileSync(logMatch[1].trim(), "utf-8") : "";
  return { status: res.status, envelope, jobLog, stderr: res.stderr ?? "" };
}

// The isolation contract: pre-existing uncommitted work must NOT show up in the
// reported fix diff. `git stash create` snapshots the dirty tree into an
// ephemeral commit object and the fix is diffed against THAT, not HEAD.
test("baseline: a dirty tree diffs against the stash-create snapshot, not HEAD", () => {
  const dirs: string[] = [];
  const repo = tempDir("harry-fix-dirty-");
  dirs.push(repo);
  try {
    const head = repoWithCommit(repo);
    writeFileSync(path.join(repo, "tracked.txt"), "v2\n"); // pre-existing WIP

    const run = runFixCli(repo, dirs);

    assert.equal(run.status, 0, `fix failed:\n${run.stderr}`);
    assert.equal(run.envelope.status, "fixed");
    assert.equal(run.envelope.preFixDirty, true, "a modified tracked file is a dirty tree");
    assert.equal(run.envelope.baselineCommit, head, "baselineCommit is HEAD, not the snapshot");
    assert.deepEqual(
      run.envelope.filesModified,
      [],
      "pre-existing WIP must be excluded from the fix diff — diffing against HEAD would report it",
    );
    assert.match(
      run.jobLog,
      /pre-fix dirty; diff base = stash-create snapshot/,
      `the log must record which base was taken; got:\n${run.jobLog}`,
    );
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

// The whole design rests on `stash create` being read-only with respect to the
// user's work: it must not revert the tree (as `git stash push` would) and must
// not leave a stash entry or a commit behind.
test("baseline: stash-create leaves the working tree, stash list, and HEAD untouched", () => {
  const dirs: string[] = [];
  const repo = tempDir("harry-fix-nomutate-");
  dirs.push(repo);
  try {
    const head = repoWithCommit(repo);
    writeFileSync(path.join(repo, "tracked.txt"), "v2\n");

    const run = runFixCli(repo, dirs);
    assert.equal(run.status, 0, `fix failed:\n${run.stderr}`);

    assert.equal(
      readFileSync(path.join(repo, "tracked.txt"), "utf-8"),
      "v2\n",
      "the user's uncommitted work must still be in the working tree",
    );
    assert.equal(git(repo, ["stash", "list"]), "", "no stash entry may be created");
    assert.equal(git(repo, ["rev-parse", "HEAD"]), head, "HEAD must not move");
    assert.equal(git(repo, ["rev-list", "--count", "HEAD"]), "1", "no commit may be made");
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

test("baseline: a clean tree is not dirty and falls back to HEAD", () => {
  const dirs: string[] = [];
  const repo = tempDir("harry-fix-clean-");
  dirs.push(repo);
  try {
    const head = repoWithCommit(repo);

    const run = runFixCli(repo, dirs);

    assert.equal(run.status, 0, `fix failed:\n${run.stderr}`);
    assert.equal(run.envelope.preFixDirty, false, "an untouched tree is not dirty");
    assert.equal(run.envelope.baselineCommit, head);
    assert.deepEqual(run.envelope.filesModified, []);
    assert.doesNotMatch(
      run.jobLog,
      /pre-fix dirty/,
      `the snapshot branch must not run on a clean tree; got:\n${run.jobLog}`,
    );
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

// `git stash create` prints NOTHING when there is nothing to stash — an
// untracked-only tree is dirty by `status --porcelain` but has no tracked
// change to snapshot. The empty output must fall back to HEAD, not become an
// empty diff base (which makes every git diff fail).
test("baseline: an untracked-only dirty tree falls back to HEAD when stash-create prints nothing", () => {
  const dirs: string[] = [];
  const repo = tempDir("harry-fix-untracked-");
  dirs.push(repo);
  try {
    const head = repoWithCommit(repo);
    writeFileSync(path.join(repo, "new.txt"), "hello\n"); // untracked only

    const run = runFixCli(repo, dirs);

    assert.equal(run.status, 0, `fix failed:\n${run.stderr}`);
    assert.equal(run.envelope.preFixDirty, true, "an untracked file makes the tree dirty");
    assert.equal(run.envelope.baselineCommit, head);
    assert.match(
      run.jobLog,
      /pre-fix dirty; diff base = HEAD/,
      `empty stash-create output must fall back to HEAD; got:\n${run.jobLog}`,
    );
    // Known DEBT documented in fix.ts: stash-create skips untracked files, so
    // `git add -A` attributes a pre-existing untracked file to the fix. Pinned
    // here so the imprecision stays visible — the alternative (a broken diff
    // base) reports `null`, which is strictly worse.
    assert.deepEqual(run.envelope.filesModified, ["new.txt"]);
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

/**
 * runFix's unborn-HEAD refusal, declared once because two things depend on it:
 * the CLI must emit it, and the apply prose that claims to share runFix's
 * contract must name it. That prose is followed by a human orchestrator on both
 * builds, so a version of it that omits the refusal sends an operator into a
 * fresh repo expecting the flow to continue where the code stops dead.
 */
const UNBORN_HEAD_REFUSAL = "at least one commit to diff against";

/**
 * The other half of runFix's contract that the same apply prose claims to
 * share: a failed measurement is reported as unknown, never as zero. The
 * consequence of prose omitting it is worse than the unborn-HEAD gap — that one
 * stalls an operator, this one has them publish "no files changed" when the fix
 * may well have changed files and only the measurement broke.
 */
const UNAVAILABLE_STATS = "diff stats unavailable";

/**
 * The tail of that operator line, which appears EXACTLY ONCE in fix.ts — inside
 * the line itself. `diff stats unavailable` alone would not do: it also appears
 * in an unrelated job-log call, so deleting the operator line while keeping the
 * log would leave the code side of the guard below satisfied by a string no
 * operator ever sees.
 */
const OPERATOR_LINE_TAIL = "git failed — see the job log";

/**
 * Slice a document between two markers, refusing every way the bound can lie.
 *
 * `indexOf(marker)` guards a marker's ABSENCE but not its AMBIGUITY or its
 * RELOCATION, and the two need different defences:
 *
 *  - **Duplicated** marker → the bound silently re-points at the copy. Closed by
 *    requiring exactly one occurrence. A bare `\n2. ` list token is re-bound by
 *    any appended checklist, which is how one of these guards was widened.
 *  - **Moved** marker (deleted here, re-added elsewhere) → the count stays one,
 *    so uniqueness cannot see it. Closed by refusing a slice that crosses a
 *    `\n## ` heading: a bound that has jumped to another section produces a
 *    slice spanning one, and a legitimate within-section slice never does.
 *
 * Both were found by mutation rather than reasoning — the uniqueness check alone
 * still passed the relocation case.
 */
function sliceBetween(doc: string, text: string, from: string, to: string): string {
  const at = (marker: string): number => {
    const first = text.indexOf(marker);
    assert.notEqual(first, -1, `${doc}: "${marker}" is gone; re-point the slice that used it`);
    assert.equal(
      text.indexOf(marker, first + 1),
      -1,
      `${doc}: "${marker}" now appears more than once, so a slice bound on it can ` +
        `re-point silently. Make it unique again, or pick a different marker.`,
    );
    return first;
  };
  const start = at(from);
  const end = at(to);
  assert.ok(end > start, `${doc}: "${to}" now precedes "${from}"; the slice is inverted`);
  const slice = text.slice(start, end);
  assert.ok(
    !slice.includes("\n## "),
    `${doc}: the slice from "${from}" to "${to}" spans a section heading, so one bound ` +
      `has moved to a different section and this guard is checking the wrong text.`,
  );
  // Collapse whitespace: these sentences wrap across lines in the source.
  return slice.replace(/\s+/g, " ");
}

// With no commit to diff against, the fix diff would silently report nothing —
// so fix must refuse up front rather than run and publish an empty result.
test("baseline: an unborn HEAD refuses the fix instead of running against nothing", () => {
  const dirs: string[] = [];
  const repo = tempDir("harry-fix-unborn-");
  dirs.push(repo);
  try {
    git(repo, ["init", "-q"]); // no commits at all

    const run = runFixCli(repo, dirs);

    assert.equal(run.status, 1, "a refused fix must exit non-zero");
    assert.equal(
      run.envelope.status,
      "failed",
      `expected refusal, got: ${JSON.stringify(run.envelope)}`,
    );
    assert.ok(
      String(run.envelope.error).includes(UNBORN_HEAD_REFUSAL),
      `expected the refusal to say "${UNBORN_HEAD_REFUSAL}", got: ${run.envelope.error}`,
    );
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

// Live prose↔code contract, the same shape as tests/ask.test.ts's failure-marker
// guard. `references/review-orchestration.md` states the apply steps for BOTH
// builds and claims them to be "the same contract as src/commands/fix.ts
// (runFix)". It described the dirty/clean baseline branches but omitted the
// refusal above, so an operator following it in a repo with no commits would
// proceed where the code exits 1 before any model turn. Renaming the message in
// src/ alone fails the test above; dropping it from the prose alone fails here.
test("the apply prose names runFix's unborn-HEAD refusal it claims to share", () => {
  const doc = "references/review-orchestration.md";
  const full = readFileSync(path.resolve(import.meta.dirname, "..", doc), "utf-8");

  // Slice to step 1 — the step that makes the contract claim — not to the whole
  // file and not to the section. A file-level check passes when the sentence is
  // deleted from the step and survives anywhere else (a historical note at the
  // bottom, say), which is how this kind of guard rots. Slicing to the *section*
  // is no better here: it is the last one in the file, so "up to the next
  // heading" means "to EOF" and swallows the same escape. Both markers are
  // asserted, so a restructure fails loudly instead of quietly emptying the
  // slice — a guard reduced to "" would pass every substring check forever.
  // The end marker names step 2's text, not just "\n2. ". A bare list marker
  // REBINDS rather than disappears: renumber step 2 and add any later line
  // starting "2. " — an appended checklist will do — and the slice silently
  // widens across the rest of the file instead of failing. Asserting a marker
  // only protects against its absence.
  const section = sliceBetween(doc, full, "1. **Baseline snapshot**", "\n2. The write mechanism");

  assert.ok(
    section.includes(UNBORN_HEAD_REFUSAL),
    `${doc}'s apply steps claim the same contract as runFix but no longer name its ` +
      `unborn-HEAD refusal ("${UNBORN_HEAD_REFUSAL}"). An operator following them in a ` +
      `repo with no commits would proceed where the code refuses.`,
  );
});

// The same contract claim, for the failure branch of the report step.
//
// WEAKER THAN THE GUARD ABOVE ON TWO AXES, both worth stating precisely because
// a guard that overstates itself is the defect this file exists to catch.
//
//  1. That guard asserts against the LIVE CLI — an unborn HEAD is reachable from
//     a temp repo. This failure path is not: `computeStagedDiff`'s own comment
//     records that it needs a live Codex session, which is why it is exported
//     and unit-tested instead. So the code side here reads source text.
//  2. Reading source text cannot distinguish EMISSION from MENTION. The literal
//     is chosen to narrow that as far as a substring can: `git failed — see the
//     job log` appears exactly once in fix.ts, inside the operator line the
//     prose quotes — unlike "diff stats unavailable", which also appears in an
//     unrelated job-log call, so deleting the operator line while keeping that
//     call would leave the guard green. It would still pass on the string
//     sitting in a comment with no code path producing it. It ties the prose to
//     fix.ts's TEXT, not to anything fix.ts emits; the behaviour itself is
//     covered by the live `computeStagedDiff` unit test above.
//
// Ceiling shared with the guard above and with tests/ask.test.ts's: a substring
// check sees presence, not instruction. Prose that quotes the string and then
// tells the orchestrator to report zeros anyway passes both. That is the
// parser boundary these rules are drawn against, not an oversight.
test("the report step names runFix's unknown-not-zero contract", () => {
  const doc = "references/review-orchestration.md";
  const prose = readFileSync(path.resolve(import.meta.dirname, "..", doc), "utf-8");
  // Bound the slice. There is no step 4, so an unbounded slice runs to EOF and
  // one appended section carrying the literal makes this guard vacuous — the
  // same escape the guard above was re-scoped to close. Anchor on the sentence
  // that already ends step 3.
  const step = sliceBetween(doc, prose, "3. **Stage + report:**", "staged but not committed");

  assert.ok(
    step.includes(UNAVAILABLE_STATS),
    `${doc}'s report step no longer names the unknown-stats outcome ` +
      `("${UNAVAILABLE_STATS}"). An orchestrator whose git call fails would report ` +
      `"no files changed" — the opposite of what happened.`,
  );
  const source = readFileSync(path.resolve(import.meta.dirname, "../src/commands/fix.ts"), "utf-8");
  assert.ok(
    source.includes(OPERATOR_LINE_TAIL),
    `src/commands/fix.ts no longer contains "${OPERATOR_LINE_TAIL}", the tail of the ` +
      `operator line the prose above quotes, so that prose now quotes a string the ` +
      `code does not carry.`,
  );
});
