// Repo-detection safety for src/lib/git.ts: "could not run git" must never be
// reported as "here is your repo root". Everything here runs against throwaway
// temp dirs; no real repo is touched.
//
// The rest of the file covers `resolveReviewTarget` (which diff gets reviewed).
// A regression there silently reviews the WRONG diff — the model still returns
// a confident, well-formed review, so nothing looks broken. Each test below is
// pinned by a mutation that makes it fail; a plausible mutation no test notices
// is untested behavior.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureGitRepository, resolveReviewTarget } from "../src/lib/git.ts";

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

test("resolveReviewTarget: an explicit base outranks a dirty working tree", () => {
  inTempRepo("main", (dir) => {
    onFeatureBranch(dir);
    write(dir, "a.txt", "two\n"); // dirty, so auto would say working-tree
    assert.deepEqual(resolveReviewTarget(dir, { base: "release-2.0" }), {
      mode: "branch",
      label: "branch diff against release-2.0",
      baseRef: "release-2.0",
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
    assert.equal(resolveReviewTarget(dir, {}).baseRef, "origin/main");
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
    assert.equal(resolveReviewTarget(dir, {}).baseRef, "origin/trunk");
  });
});

test("resolveReviewTarget: an undetectable default branch throws instead of guessing", () => {
  inTempRepo("feature", (dir) => {
    write(dir, "a.txt", "one\n");
    commitAll(dir, "init"); // no main/master/trunk anywhere, no remote
    assert.throws(
      () => resolveReviewTarget(dir, {}),
      /Unable to detect the repository default branch/,
      "a silent fallback would diff against a ref the user never chose",
    );
  });
});
