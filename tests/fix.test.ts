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

// A repo with one commit to diff against, and no staged changes.
function emptyRepo(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "base",
    ],
    { cwd: dir },
  );
}

test("computeStagedDiff: a failed git call reports unknown stats, not zeros", () => {
  // A temp dir outside any repository: every `git` call in computeStagedDiff
  // exits non-zero ("not a git repository"), the same shape as any other
  // failure of the stats collection.
  const dir = mkdtempSync(path.join(os.tmpdir(), "harry-fix-test-"));
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
  const dir = mkdtempSync(path.join(os.tmpdir(), "harry-fix-empty-"));
  const logged: string[] = [];
  try {
    emptyRepo(dir);
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

const CLI = path.resolve(import.meta.dirname, "../src/companion.ts");

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
}

/**
 * A repo with one commit. Identity goes in the repo's LOCAL config, not on the
 * `-c` command line: fix spawns its own `git stash create`, which writes a
 * commit object and fails without an identity (CI runners have no global one).
 * Returns the HEAD sha.
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
    assert.match(String(run.envelope.error), /at least one commit/);
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});
