// Repo-detection safety for src/lib/git.ts. `ensureGitRepository`'s return value
// becomes the cwd of a WRITE-enabled Codex session (src/commands/fix.ts), so
// "could not run git" must never be reported as "here is your repo root" — an
// empty root would point the session at the process cwd instead of the repo.
// Everything here runs against throwaway temp dirs; no real repo is touched.
//
// The rest of the file covers the review *input* path: `resolveReviewTarget`
// (which diff gets reviewed) and `collectReviewContext` (how much of it is
// handed to the model inline). A regression in either silently reviews the
// WRONG diff — the model still returns a confident, well-formed review, so
// nothing looks broken. Each test below is pinned by a mutation that makes it
// fail; a plausible mutation no test notices is untested behavior.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectReviewContext,
  ensureGitRepository,
  type ReviewScope,
  resolveReviewTarget,
} from "../src/lib/git.ts";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "harry-git-test-"));
}

// Commits need an identity and no signing: CI runners have no global git
// identity, and a developer's global `commit.gpgsign=true` would hang here.
const IDENTITY = [
  "-c",
  "user.name=harry test",
  "-c",
  "user.email=harry-test@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

function run(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function commitAll(dir: string, message: string): void {
  run(dir, "add", "-A");
  run(dir, ...IDENTITY, "commit", "-q", "-m", message);
}

function write(dir: string, name: string, body: string): void {
  writeFileSync(path.join(dir, name), body);
}

/**
 * A file git will treat as binary (it contains NUL). This is what makes the
 * `--binary` measurement flag load-bearing: on text-only content git emits
 * byte-identical output with and without it, so an all-text fixture cannot
 * notice `--binary` being dropped from the measured command.
 *
 * Scope, so the next reader does not re-derive it: this pins `--binary` and
 * nothing else. The other two flags in that command stay unpinned — mutating
 * `--submodule=diff` to `--submodule=short`, or dropping `--no-ext-diff`
 * outright, leaves the whole suite green, because this fixture has no submodule
 * and no configured `diff.external` driver, so neither flag changes a byte.
 * Closing them costs a submodule fixture and a gitconfig respectively — far
 * heavier than a NUL file, guarding drift that matters much less than
 * `--binary`'s. Deliberately not bought.
 */
function writeBinary(dir: string, name: string, bytes: number[]): void {
  writeFileSync(path.join(dir, name), Buffer.from(bytes));
}

/**
 * `count` lines of multi-byte UTF-8. This is what makes the measurement's UNIT
 * observable: on ASCII, `Buffer.byteLength(s, "utf8")` and `s.length` are equal,
 * so an all-ASCII fixture cannot tell a byte count from a UTF-16 code-unit
 * count — and the review budget is denominated in bytes. Traditional Chinese
 * runs about 2.5x, and is this tool's own workload rather than an exotic edge.
 */
function multiByteLines(count: number): string {
  const lines = Array.from({ length: count }, (_, i) => `第 ${i} 行：這是一段中文測試內容`);
  return `${lines.join("\n")}\n`;
}

/**
 * A throwaway repo on `branch`, torn down afterwards. `git init -b` pins the
 * initial branch name so the caller's global `init.defaultBranch` cannot decide
 * what these tests observe.
 */
function inTempRepo(branch: string, body: (dir: string) => void): void {
  // macOS temp dirs are symlinked (/var -> /private/var) and git reports the
  // resolved path, so resolve up front and compare like with like.
  const dir = realpathSync(tmpDir());
  try {
    run(dir, "init", "-q", "-b", branch);
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A clean repo whose current branch is `feature` and whose default branch is `main`. */
function onFeatureBranch(dir: string): void {
  write(dir, "a.txt", "one\n");
  commitAll(dir, "init");
  run(dir, "checkout", "-q", "-b", "feature");
}

test("ensureGitRepository: a spawn failure is not reported as success", () => {
  const dir = tmpDir();
  try {
    // A regular file as cwd makes spawnSync fail before git ever runs: it
    // returns status null with an ENOTDIR error and no stdout. That is a spawn
    // failure, NOT an exit code — and it is not the ENOENT ("git is not
    // installed") case the function special-cases.
    const notADir = path.join(dir, "a-file");
    writeFileSync(notADir, "x");
    assert.throws(
      () => ensureGitRepository(notADir),
      /repository|git/i,
      "a spawn failure must throw, not return a repo root",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureGitRepository: a real repo still resolves to its top level", () => {
  const dir = tmpDir();
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    // Independent expectation: macOS temp dirs are symlinked (/var ->
    // /private/var) and git reports the resolved path, so resolve it here rather
    // than re-running the command under test to produce its own answer.
    assert.equal(ensureGitRepository(dir), realpathSync(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureGitRepository: a non-repo directory is rejected", () => {
  const dir = tmpDir();
  try {
    assert.throws(
      () => ensureGitRepository(dir),
      /must run inside a Git repository/,
      "a clean non-zero git exit must still throw",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- resolveReviewTarget: which diff gets reviewed --------------------------

test("resolveReviewTarget: an explicit base outranks an explicit working-tree scope", () => {
  inTempRepo("main", (dir) => {
    onFeatureBranch(dir);
    write(dir, "a.txt", "two\n"); // dirty, so both other rules would say working-tree
    assert.deepEqual(resolveReviewTarget(dir, { scope: "working-tree", base: "release-2.0" }), {
      mode: "branch",
      label: "branch diff against release-2.0",
      baseRef: "release-2.0",
      explicit: true,
    });
  });
});

test("resolveReviewTarget: an explicit working-tree scope stays working-tree on a clean tree", () => {
  inTempRepo("main", (dir) => {
    onFeatureBranch(dir); // clean: auto would resolve to a branch diff against main
    assert.deepEqual(resolveReviewTarget(dir, { scope: "working-tree" }), {
      mode: "working-tree",
      label: "working tree diff",
      explicit: true,
    });
  });
});

test("resolveReviewTarget: auto picks the working tree when it is dirty", () => {
  inTempRepo("main", (dir) => {
    onFeatureBranch(dir);
    write(dir, "a.txt", "two\n");
    assert.deepEqual(resolveReviewTarget(dir, {}), {
      mode: "working-tree",
      label: "working tree diff",
      explicit: false,
    });
  });
});

test("resolveReviewTarget: auto counts an untracked file alone as dirty", () => {
  inTempRepo("main", (dir) => {
    onFeatureBranch(dir);
    write(dir, "new.txt", "brand new\n"); // nothing staged, nothing modified
    assert.equal(resolveReviewTarget(dir, {}).mode, "working-tree");
  });
});

test("resolveReviewTarget: auto falls back to a branch diff when the tree is clean", () => {
  inTempRepo("main", (dir) => {
    onFeatureBranch(dir);
    assert.deepEqual(resolveReviewTarget(dir, {}), {
      mode: "branch",
      label: "branch diff against main",
      baseRef: "main",
      explicit: false,
    });
  });
});

test("resolveReviewTarget: a remote main outranks a local master as the default branch", () => {
  inTempRepo("master", (dir) => {
    write(dir, "a.txt", "one\n");
    commitAll(dir, "init");
    run(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    run(dir, "checkout", "-q", "-b", "feature");
    // Candidate order is main-then-master, and each candidate checks local
    // before remote — so origin/main wins over the local master.
    assert.equal(resolveReviewTarget(dir, { scope: "branch" }).baseRef, "origin/main");
  });
});

test("resolveReviewTarget: origin/HEAD wins and is reported without the refs/remotes/ prefix", () => {
  inTempRepo("main", (dir) => {
    write(dir, "a.txt", "one\n");
    commitAll(dir, "init");
    run(dir, "update-ref", "refs/remotes/origin/trunk", "HEAD");
    run(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    run(dir, "checkout", "-q", "-b", "feature");
    // Without the symbolic ref the main-first candidate loop would answer "main".
    assert.equal(resolveReviewTarget(dir, { scope: "branch" }).baseRef, "origin/trunk");
  });
});

test("resolveReviewTarget: an undetectable default branch throws instead of guessing", () => {
  inTempRepo("feature", (dir) => {
    write(dir, "a.txt", "one\n");
    commitAll(dir, "init"); // no main/master/trunk anywhere, no remote
    assert.throws(
      () => resolveReviewTarget(dir, { scope: "branch" }),
      /Unable to detect the repository default branch/,
      "a silent fallback would diff against a ref the user never chose",
    );
  });
});

test("resolveReviewTarget: an unsupported scope throws instead of falling through to auto", () => {
  inTempRepo("main", (dir) => {
    onFeatureBranch(dir);
    write(dir, "a.txt", "two\n"); // dirty, so a fall-through would quietly answer working-tree
    assert.throws(
      () => resolveReviewTarget(dir, { scope: "staged" as unknown as ReviewScope }),
      /Unsupported review scope "staged"/,
    );
  });
});

// --- collectReviewContext: how much of the diff is inlined ------------------

/** Commits `a.txt`/`b.txt`/`c.txt`, then dirties the first `changed` of them. */
function repoWithChangedFiles(dir: string, changed: number): void {
  for (const name of ["a.txt", "b.txt", "c.txt"]) write(dir, name, "one\n");
  commitAll(dir, "init");
  for (const name of ["a.txt", "b.txt", "c.txt"].slice(0, changed)) write(dir, name, "two\n");
}

test("collectReviewContext: a working tree at the inline file cap stays inline", () => {
  inTempRepo("main", (dir) => {
    repoWithChangedFiles(dir, 2);
    const target = resolveReviewTarget(dir, { scope: "working-tree" });
    const context = collectReviewContext(dir, target, { maxInlineFiles: 2 });
    assert.equal(context.fileCount, 2);
    assert.equal(context.inputMode, "inline-diff");
    assert.match(context.content, /## Unstaged Diff/);
  });
});

test("collectReviewContext: one file over the inline cap switches to self-collect", () => {
  inTempRepo("main", (dir) => {
    repoWithChangedFiles(dir, 3);
    const target = resolveReviewTarget(dir, { scope: "working-tree" });
    const context = collectReviewContext(dir, target, { maxInlineFiles: 2 });
    assert.equal(context.fileCount, 3);
    assert.equal(context.inputMode, "self-collect");
    assert.match(context.content, /## Changed Files/);
  });
});

test("collectReviewContext: untracked files count toward the inline file cap", () => {
  inTempRepo("main", (dir) => {
    write(dir, "a.txt", "one\n");
    commitAll(dir, "init");
    for (const name of ["x.txt", "y.txt", "z.txt"]) write(dir, name, "new\n");
    const target = resolveReviewTarget(dir, { scope: "working-tree" });
    const context = collectReviewContext(dir, target, { maxInlineFiles: 2 });
    // Untracked files produce no diff bytes at all, so only the file count can
    // have made this decision.
    assert.equal(context.diffBytes, 0);
    assert.equal(context.inputMode, "self-collect");
  });
});

test("collectReviewContext: the inline byte cap is inclusive", () => {
  inTempRepo("main", (dir) => {
    write(dir, "unstaged.txt", "one\n");
    write(dir, "staged.txt", "one\n");
    writeBinary(dir, "staged.bin", [0, 1, 2, 253, 254, 255]);
    writeBinary(dir, "unstaged.bin", [7, 0, 7, 0, 255]);
    commitAll(dir, "init");
    write(dir, "unstaged.txt", multiByteLines(40));
    write(dir, "staged.txt", multiByteLines(40));
    writeBinary(dir, "staged.bin", [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    writeBinary(dir, "unstaged.bin", [1, 1, 2, 3, 5, 8, 13, 0]);
    // The working-tree measurement is a sum over a staged and an unstaged
    // command, so each half needs to carry every property the assertion below
    // relies on. A half with nothing in it cannot notice being dropped from the
    // sum; a half carrying only text cannot notice --binary being dropped from
    // it; and a half carrying only ASCII cannot notice bytes being counted as
    // characters. Hence four changes, two per half, one binary and one
    // multi-byte on each side.
    run(dir, "add", "staged.txt", "staged.bin");
    const target = resolveReviewTarget(dir, { scope: "working-tree" });
    // The exact byte size of a git diff is git's to decide, so the cap below is
    // derived from what the code measured. That alone would let the code measure
    // the WRONG COMMAND — a summary instead of the diff — and still satisfy every
    // threshold assertion, because both sides of the comparison would shrink
    // together. So pin the measurement itself first, by re-running the commands
    // independently: the working-tree number is the staged and unstaged binary
    // diffs added together.
    const baseline = collectReviewContext(dir, target, { maxInlineFiles: 8 });
    const measured = baseline.diffBytes;
    assert.ok(measured > 0, "the fixture must produce a non-empty diff");
    assert.equal(baseline.fileCount, 4, "four changed files, so the cap of 8 never decides");
    const staged = run(dir, "diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff");
    const unstaged = run(dir, "diff", "--binary", "--no-ext-diff", "--submodule=diff");
    assert.equal(
      measured,
      Buffer.byteLength(staged, "utf8") + Buffer.byteLength(unstaged, "utf8"),
      "diffBytes must measure the full staged + unstaged binary diff",
    );
    assert.equal(
      collectReviewContext(dir, target, { maxInlineFiles: 8, maxInlineDiffBytes: measured })
        .inputMode,
      "inline-diff",
      "a diff exactly at the byte cap must still inline",
    );
    assert.equal(
      collectReviewContext(dir, target, { maxInlineFiles: 8, maxInlineDiffBytes: measured - 1 })
        .inputMode,
      "self-collect",
      "one byte past the cap must fall back to self-collect",
    );
  });
});

test("collectReviewContext: the inline file cap also applies to branch targets", () => {
  inTempRepo("main", (dir) => {
    write(dir, "a.txt", "one\n");
    commitAll(dir, "init");
    run(dir, "checkout", "-q", "-b", "feature");
    for (const name of ["a.txt", "b.txt", "c.txt"]) write(dir, name, "two\n");
    commitAll(dir, "work");
    const target = resolveReviewTarget(dir, { base: "main" });
    assert.equal(target.mode, "branch");
    assert.equal(
      collectReviewContext(dir, target, { maxInlineFiles: 3 }).inputMode,
      "inline-diff",
      "three changed files under a cap of three must inline",
    );
    const narrow = collectReviewContext(dir, target, { maxInlineFiles: 2 });
    assert.equal(narrow.changedFiles.length, 3);
    assert.equal(narrow.inputMode, "self-collect");
  });
});

test("collectReviewContext: the inline byte cap also applies to branch targets", () => {
  inTempRepo("main", (dir) => {
    write(dir, "a.txt", "one\n");
    writeBinary(dir, "blob.bin", [0, 1, 2, 253, 254, 255]);
    commitAll(dir, "init");
    run(dir, "checkout", "-q", "-b", "feature");
    write(dir, "a.txt", multiByteLines(40));
    writeBinary(dir, "blob.bin", [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    commitAll(dir, "work");
    const target = resolveReviewTarget(dir, { base: "main" });
    // Two changed files against a cap of eight, so only the byte cap can decide
    // — this is the arm whose byte cap once had no guard at all while the file
    // cap had two. One change is binary and one is multi-byte text, for the
    // reasons in writeBinary and multiByteLines.
    const baseline = collectReviewContext(dir, target, { maxInlineFiles: 8 });
    const measured = baseline.diffBytes;
    assert.ok(measured > 0, "the fixture must produce a non-empty branch diff");
    assert.equal(baseline.fileCount, 2, "two changed files, so the cap of 8 never decides");
    // Pin the measurement, not just which side of the cap it lands on — see the
    // working-tree byte test.
    //
    // Read this equality as a guard on the FLAGS and the unit, not on the range.
    // The range half is decoration here: `main` has not moved since the branch
    // point in this fixture, so every spelling of it — merge-base..HEAD,
    // main..HEAD, HEAD~1..HEAD — selects the same commits, and replacing the
    // code's merge-base with the raw base ref leaves the whole suite green.
    // Pinning the range needs a fixture where the base advanced independently,
    // and the behavior it would pin belongs to buildBranchComparison, which is
    // outside this test's subject. Tracked in the backlog, not guarded here.
    const mergeBase = run(dir, "merge-base", "HEAD", "main").trim();
    assert.equal(
      measured,
      Buffer.byteLength(
        run(dir, "diff", "--binary", "--no-ext-diff", "--submodule=diff", `${mergeBase}..HEAD`),
        "utf8",
      ),
      "diffBytes must measure the full binary diff over the merge-base range",
    );
    assert.equal(
      collectReviewContext(dir, target, { maxInlineFiles: 8, maxInlineDiffBytes: measured })
        .inputMode,
      "inline-diff",
      "a branch diff exactly at the byte cap must still inline",
    );
    assert.equal(
      collectReviewContext(dir, target, { maxInlineFiles: 8, maxInlineDiffBytes: measured - 1 })
        .inputMode,
      "self-collect",
      "a branch diff past the byte cap must fall back to self-collect",
    );
  });
});

test("collectReviewContext: an explicit includeDiff:false overrides a would-be-inline diff", () => {
  inTempRepo("main", (dir) => {
    repoWithChangedFiles(dir, 1);
    const target = resolveReviewTarget(dir, { scope: "working-tree" });
    assert.equal(collectReviewContext(dir, target).inputMode, "inline-diff");
    assert.equal(
      collectReviewContext(dir, target, { includeDiff: false }).inputMode,
      "self-collect",
      "an explicit false must not be treated as 'unset'",
    );
  });
});

test("collectReviewContext: a truncated self-collect diff is cut at a line boundary", () => {
  inTempRepo("main", (dir) => {
    write(dir, "a.txt", "one\n");
    commitAll(dir, "init");
    write(
      dir,
      "a.txt",
      `${Array.from({ length: 30 }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n")}\n`,
    );
    const target = resolveReviewTarget(dir, { scope: "working-tree" });
    const context = collectReviewContext(dir, target, {
      includeDiff: false,
      maxInlineDiffBytes: 233,
    });
    const section = context.content.split("## Truncated Diff\n\n")[1]?.split("\n## ")[0] ?? "";
    const lines = section.split("\n");
    const marker = lines.indexOf("... (diff truncated; read individual files for the rest)");
    assert.ok(marker > 0, "the fixture must be large enough to truncate");

    // Every surviving line must be a whole line of the real diff. A mid-line cut
    // hands the model a corrupted hunk it will read as fact.
    const full = run(dir, "diff", "--no-ext-diff", "--submodule=short").split("\n");
    const kept = lines.slice(0, marker - 1);
    assert.ok(kept.length > 1, "truncation must keep something");
    for (const [index, line] of kept.entries()) {
      assert.equal(line, full[index], `truncated line ${index} must be a whole original line`);
    }
  });
});
