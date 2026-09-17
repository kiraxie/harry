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
import { ensureGitRepository, resolveReviewTarget, truncateUtf8 } from "../src/lib/git.ts";

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

// ---------------------------------------------------------------------------
// truncateUtf8 — the byte cap is a promise, not an estimate
//
// It cuts at a BYTE offset, so a multi-byte character can straddle the cut.
// Node decodes the orphaned bytes to U+FFFD, which is THREE bytes standing in
// for the one to three it replaced — so a naive cut can return MORE bytes than
// the cap it was asked to enforce (orphan of one or two bytes), and in every
// case injects a glyph the input never had.
//
// Reachability, measured rather than assumed, and narrower than it first looks.
// The line-boundary trim removes both symptoms whenever a newline precedes the
// cut, so only a cut landing before the FIRST newline can leak — and through
// `collectReviewContext` the input is always a git diff whose first line is
// `diff --git a/<path> b/<path>`. So the precondition is a **non-ASCII path in
// the diff header**, not CJK content: an ASCII filename yields zero leaking cut
// points no matter how much CJK the file contains. No shipped caller can reach
// even that — `src/commands/review.ts` passes no cap, so the 262144 default
// always lands thousands of newlines deep. The fix is provably a no-op on
// shipped output; it exists because `maxInlineDiffBytes` is a public field on
// the exported CollectContextOptions and the cap is stated as a promise.
//
// The sweeps below walk every cap rather than picking a lucky offset, because
// which offsets straddle a character is a property of the input, not something
// a test should encode. Note an upper bound alone is not enough: returning ""
// satisfies both "within the cap" and "no U+FFFD", so the maximality test is
// what makes the pair mean anything.
// ---------------------------------------------------------------------------

/** No newline anywhere, so the line-boundary trim cannot mask the defect. */
const CJK_NO_NEWLINE = "你好世界你好世界你好世界";

/**
 * Every UTF-8 width in one string: ASCII (1 byte), é (2), 漢 (3), 😀 (4).
 *
 * A uniform-width fixture cannot tell the continuation-byte walk apart from
 * plain arithmetic — replacing the whole test with `while (end % 3 !== 0) end--`
 * passes a CJK-only sweep, because every character there happens to be three
 * bytes. This is also the only fixture that reaches the case the implementation
 * comment argues explicitly: a 4-byte character cut after its third byte, where
 * the orphan is three bytes and so injects the glyph WITHOUT overrunning the
 * cap. A comment arguing a case no test exercises is the drift this file exists
 * to prevent.
 */
const MIXED_WIDTHS = "aé漢😀bé漢😀";

const SWEEP_FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["CJK", CJK_NO_NEWLINE],
  ["mixed widths", MIXED_WIDTHS],
];

test("truncateUtf8 never returns more bytes than its cap", () => {
  for (const [name, input] of SWEEP_FIXTURES) {
    const total = Buffer.byteLength(input, "utf8");
    for (let max = 1; max <= total; max++) {
      const got = Buffer.byteLength(truncateUtf8(input, max).text, "utf8");
      assert.ok(got <= max, `${name} cap ${max}: returned ${got} bytes — the cap is a promise`);
    }
  }
});

test("truncateUtf8 never invents a replacement character the input lacked", () => {
  for (const [name, input] of SWEEP_FIXTURES) {
    const total = Buffer.byteLength(input, "utf8");
    for (let max = 1; max <= total; max++) {
      const { text } = truncateUtf8(input, max);
      assert.ok(
        !text.includes("�"),
        `${name} cap ${max}: cut mid-character, leaving U+FFFD in ${JSON.stringify(text)}`,
      );
    }
  }
});

test("truncateUtf8 returns the LONGEST whole-character prefix that fits (no line breaks)", () => {
  // The lower bound, without which the two sweeps above are satisfied by an
  // implementation that always returns "". Stated as maximality rather than a
  // byte floor so it holds for any character width: one more character must
  // not fit. This is the assertion that kills a wrong continuation-byte mask
  // (`0b1000_0000`), which backs off past whole characters and empties the
  // result for every truncating cap while both upper bounds stay satisfied.
  for (const [name, input] of SWEEP_FIXTURES) {
    const chars = Array.from(input);
    const total = Buffer.byteLength(input, "utf8");
    for (let max = 0; max <= total; max++) {
      const { text } = truncateUtf8(input, max);
      assert.ok(input.startsWith(text), `${name} cap ${max}: result is not a prefix of the input`);
      const kept = Array.from(text).length;
      // At a cap large enough for the whole input there is no "one more" to test.
      // Assert WHY we are skipping: without this, an implementation that returns
      // the whole input at cap 0 makes the guard fire and swallows the defect,
      // leaving cap 0 covered only indirectly by the negative cases in the
      // normalization test below.
      if (kept === chars.length) {
        assert.equal(max, total, `${name} cap ${max}: returned the whole input when it cannot fit`);
        continue;
      }
      const oneMore = chars.slice(0, kept + 1).join("");
      assert.ok(
        Buffer.byteLength(oneMore, "utf8") > max,
        `${name} cap ${max}: returned ${JSON.stringify(text)} when one more character still fits`,
      );
    }
  }
});

test("truncateUtf8 normalizes a cap that is negative or fractional", () => {
  // Not hypothetical plumbing: `subarray(0, -5)` counts from the END of the
  // buffer and `buf[2.5]` is undefined, so an unnormalized cap of either shape
  // skips the boundary walk entirely and reproduces the original defect.
  for (const max of [-5, -1, 2.5, 7.9, 100.5]) {
    const { text } = truncateUtf8(CJK_NO_NEWLINE, max);
    // Equivalence, not just an upper bound. Bounds alone are satisfied by any
    // implementation that maps these caps to 0 — the exact hole that made the
    // two sweeps above meaningless before maximality was added, repeated here.
    // `truncateUtf8(x, 100.5)` must behave as `truncateUtf8(x, 100)`, not as "".
    assert.equal(
      text,
      truncateUtf8(CJK_NO_NEWLINE, Math.max(0, Math.trunc(max))).text,
      `cap ${max}: must behave as its normalized integer cap, not be discarded`,
    );
    assert.ok(!text.includes("�"), `cap ${max}: left U+FFFD in ${JSON.stringify(text)}`);
  }
});

test("truncateUtf8 handles a NaN cap as zero and an infinite cap as no limit", () => {
  // Neither previously asserted. The behaviour is already right; pin it so a
  // future change to the normalization cannot alter it unnoticed. Infinity must
  // NOT be normalized to zero — an unbounded cap means "no truncation", which is
  // a real answer.
  //
  // These no longer arrive from `maxInlineDiffBytes`: collectReviewContext now
  // normalizes that cap at its entry, so truncateUtf8's own guard covers direct
  // callers and this test. Keep it — the function is exported, and a NaN cap
  // reaching the boundary walk unguarded reintroduces the U+FFFD defect the
  // walk exists to prevent.
  assert.deepEqual(truncateUtf8(CJK_NO_NEWLINE, Number.NaN), { text: "", truncated: true });
  assert.deepEqual(truncateUtf8(CJK_NO_NEWLINE, Number.POSITIVE_INFINITY), {
    text: CJK_NO_NEWLINE,
    truncated: false,
  });
});

test("truncateUtf8 leaves input that fits the cap exactly as it was", () => {
  const total = Buffer.byteLength(CJK_NO_NEWLINE, "utf8");
  const { text, truncated } = truncateUtf8(CJK_NO_NEWLINE, total);
  assert.equal(text, CJK_NO_NEWLINE);
  assert.equal(truncated, false, "input at exactly the cap is not truncated");
});

test("truncateUtf8 still trims back to the last whole line", () => {
  // Asserted as an exact string, not as "does not end with 三": that weaker
  // shape passes even with the line trim deleted, because the untrimmed result
  // ends in 中. Two caps, because they exercise different paths — at 35 the
  // cut already sits on a character boundary and only the line trim runs; at 36
  // it lands mid-character, so the boundary walk runs first and the trim then
  // has to produce the same answer.
  const input = "一行中文\n二行中文\n三行中文\n";
  for (const max of [35, 36]) {
    const { text, truncated } = truncateUtf8(input, max);
    assert.equal(truncated, true, `cap ${max}: expected truncation`);
    assert.equal(text, "一行中文\n二行中文", `cap ${max}: wrong trim`);
  }
});
