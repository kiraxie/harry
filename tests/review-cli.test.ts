/**
 * `companion review` is a thin wrapper over the Codex CLI's `codex exec review`.
 *
 * These run the real CLI (`node src/companion.ts review …`) in temp git repos
 * with `tests/fake-codex-cli.mjs` installed as `codex` first on PATH, and pin
 * the contracts the wrapper owns: the flag surface, the exact argv it
 * spawns, the prompt it sends on stdin, where the review lands, and that every
 * failure is loud with no fallback.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { REVIEW_WRITTEN, reserveReviewFiles } from "../src/commands/review.ts";
import { NO_ERROR_LINE } from "../src/lib/run-codex.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "src/companion.ts");
const FAKE = path.join(REPO_ROOT, "tests/fake-codex-cli.mjs");
const RUBRIC = readFileSync(path.join(REPO_ROOT, "references/review-rubric.md"), "utf8");
const ARCH_RUBRIC = readFileSync(path.join(REPO_ROOT, "references/architecture-review.md"), "utf8");

const cleanup: string[] = [];
test.after(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(d);
  return d;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A repo on `main` with one commit. */
function makeRepo(): string {
  const repo = tempDir("harry-rcli-repo-");
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(repo, "a.txt"), "v1\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  return repo;
}

/**
 * A `sh -c` script that sets umask 022, then execs its arguments. A mode test
 * runs the CLI under it, so a file created without an owner-only mode comes out
 * 0644 and the 0600 assertion fails, whatever the test runner's own umask is.
 */
const UMASK_022_EXEC = 'umask 022; exec "$0" "$@"';

/** A bin dir whose `codex` execs the fake CLI. */
function makeBin(): string {
  const bin = tempDir("harry-rcli-bin-");
  const shim = path.join(bin, "codex");
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(shim, 0o755);
  return bin;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  record: string;
  dataDir: string;
}

function runReview(
  cwd: string,
  args: string[],
  opts: {
    fake?: Record<string, string>;
    bin?: string | null;
    input?: string;
    cli?: string;
    /** Put only the system dirs after `bin`, so no other `codex` is reachable. */
    systemPath?: boolean;
    /** Run the CLI under umask 022 (see {@link UMASK_022_EXEC}). */
    permissiveUmask?: boolean;
  } = {},
): Run {
  const record = tempDir("harry-rcli-record-");
  const dataDir = tempDir("harry-rcli-data-");
  const bin = opts.bin === undefined ? makeBin() : opts.bin;
  // With bin === null nothing named `codex` may be reachable: PATH keeps only
  // the system dirs, which is enough for git.
  const basePath =
    bin === null || opts.systemPath
      ? ["/usr/bin", "/bin"].join(path.delimiter)
      : (process.env.PATH ?? "");
  const argv = [opts.cli ?? CLI, "review", ...args];
  const [command, commandArgs] = opts.permissiveUmask
    ? ["/bin/sh", ["-c", UMASK_022_EXEC, process.execPath, ...argv]]
    : [process.execPath, argv];
  const res = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
    input: opts.input ?? "",
    env: {
      ...process.env,
      PATH: bin === null ? basePath : `${bin}${path.delimiter}${basePath}`,
      CLAUDE_PLUGIN_DATA: dataDir,
      FAKE_CODEX_CLI_RECORD_DIR: record,
      ...opts.fake,
    },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, record, dataDir };
}

function recordedArgv(run: Run): string[] {
  return JSON.parse(readFileSync(path.join(run.record, "argv.json"), "utf8"));
}

function recordedPrompt(run: Run): string {
  return readFileSync(path.join(run.record, "stdin.txt"), "utf8");
}

function outputPathOf(run: Run): string {
  const argv = recordedArgv(run);
  return argv[argv.indexOf("-o") + 1];
}

/** The log that sits next to a review file: same stem, `.log`. */
function logPathOf(run: Run): string {
  return outputPathOf(run).replace(/\.md$/, ".log");
}

/** One file per run: `codex-review-<YYYYMMDD-HHMMSS>[-N].md`. */
const REVIEW_FILE_RE = /codex-review-\d{8}-\d{6}(-\d+)?\.md$/;

/** A credential-shaped transcript line (codex echoing a `.env` it read). Fake value. */
const PLANTED_SECRET = "API_KEY=fake-planted-secret";

// ─── A1: flag surface ────────────────────────────────────────────────────────

for (const flag of [
  "--adversarial",
  "--simplify",
  "--full",
  "--fix",
  "--harry-fix",
  "--scope",
  "--model",
  "--timeout",
  "--wait",
  "--background",
]) {
  test(`A1: review rejects the removed flag ${flag}, naming it`, () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "a.txt"), "v2\n");
    const run = runReview(repo, [flag, "x"]);
    assert.notEqual(run.status, 0, `${flag} must exit non-zero`);
    const name = flag.slice(2);
    assert.match(run.stderr, new RegExp(`Unknown flag --${name}\\b`), run.stderr);
    assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
  });
}

test("A1: an invalid --reasoning value errors naming the flag", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, ["--reasoning", "extreme"]);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /--reasoning/);
  assert.ok(!existsSync(path.join(run.record, "argv.json")));
});

for (const flag of ["--base", "--context"]) {
  test(`F6: ${flag} with no value errors naming the flag instead of being ignored`, () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "a.txt"), "v2\n");
    const run = runReview(repo, [flag, "--reasoning", "high"]);
    assert.notEqual(run.status, 0, run.stderr);
    assert.ok(run.stderr.includes(`${flag} requires a value`), run.stderr);
    assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
  });
}

for (const flag of ["--base", "--context"]) {
  for (const form of ["space", "equals"] as const) {
    test(`F6: ${flag} with an empty value (${form} form) errors instead of reviewing another target`, () => {
      const repo = makeRepo();
      writeFileSync(path.join(repo, "a.txt"), "v2\n");
      for (const value of ["", "   "]) {
        const args = form === "space" ? [flag, value] : [`${flag}=${value}`];
        const run = runReview(repo, args);
        assert.notEqual(run.status, 0, `${JSON.stringify(args)}: ${run.stderr}`);
        assert.ok(
          run.stderr.includes(`${flag} requires a value; got an empty one`),
          `${JSON.stringify(args)}: ${run.stderr}`,
        );
        assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
      }
    });
  }
}

// ─── A2: exact spawned argv ─────────────────────────────────────────────────

test("A2: without --reasoning the argv carries no effort override and never -m", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, []);
  assert.equal(run.status, 0, run.stderr);
  const argv = recordedArgv(run);
  assert.deepEqual(argv, [
    "exec",
    "review",
    "--ephemeral",
    "-c",
    'sandbox_mode="read-only"',
    "-o",
    outputPathOf(run),
    "-",
  ]);
  assert.ok(!argv.includes("-m"));
});

test("A2: --reasoning adds exactly one TOML-quoted effort override before the stdin marker", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, ["--reasoning", "high"]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(recordedArgv(run), [
    "exec",
    "review",
    "--ephemeral",
    "-c",
    'sandbox_mode="read-only"',
    "-o",
    outputPathOf(run),
    "-c",
    'model_reasoning_effort="high"',
    "-",
  ]);
});

test("A2: codex runs at the repo root even when invoked from a subdirectory", () => {
  const repo = makeRepo();
  mkdirSync(path.join(repo, "sub"));
  writeFileSync(path.join(repo, "sub/b.txt"), "new\n");
  const shim = path.join(makeBin(), "codex");
  // Record the cwd codex was started in alongside the fake's own record.
  const bin = path.dirname(shim);
  writeFileSync(
    shim,
    `#!/bin/sh\npwd > "$FAKE_CODEX_CLI_RECORD_DIR/cwd.txt"\nexec "${process.execPath}" "${FAKE}" "$@"\n`,
  );
  const run = runReview(path.join(repo, "sub"), [], { bin });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(realpathSync(readFileSync(path.join(run.record, "cwd.txt"), "utf8").trim()), repo);
});

// ─── A3: prompt ─────────────────────────────────────────────────────────────

test("A3: branch mode names git diff <base>...HEAD, embeds the full rubric, and omits empty sections", () => {
  const repo = makeRepo();
  git(repo, ["checkout", "-q", "-b", "feature"]);
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  git(repo, ["commit", "-q", "-am", "change"]);
  const run = runReview(repo, ["--base", "main"]);
  assert.equal(run.status, 0, run.stderr);
  const prompt = recordedPrompt(run);

  assert.ok(prompt.startsWith("# Review target\n"), prompt.slice(0, 200));
  assert.match(prompt, /git diff main\.\.\.HEAD/);
  assert.match(prompt, /[Rr]un/);
  assert.match(prompt, /not a review target/);
  assert.match(prompt, /must not be reported/);

  const standardAt = prompt.indexOf("# Review standard\n");
  assert.ok(standardAt > 0, "review standard section missing");
  assert.ok(prompt.includes(RUBRIC.trim()), "the rubric must be embedded in full");
  assert.ok(prompt.indexOf(RUBRIC.trim()) > standardAt);

  assert.ok(!prompt.includes("## Background"), "no --context → no background section");
  assert.ok(!prompt.includes("## Focus"), "no focus text → no focus section");
});

test("A3: auto picks working-tree mode on a dirty tree and names staged, unstaged and untracked", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "new.txt"), "untracked only\n");
  const run = runReview(repo, []);
  assert.equal(run.status, 0, run.stderr);
  const prompt = recordedPrompt(run);
  assert.ok(prompt.startsWith("# Review target\n"));
  for (const needle of [
    "staged",
    "unstaged",
    "untracked",
    "git status --short --untracked-files=all",
    "git diff HEAD",
    "not a review target",
    "must not be reported",
  ]) {
    assert.ok(prompt.includes(needle), `working-tree prompt missing "${needle}"`);
  }
  assert.ok(!prompt.includes("...HEAD"), "working-tree mode must not name a branch range");
});

test("A3: auto on a clean tree reviews the branch against the detected default branch", () => {
  const repo = makeRepo();
  git(repo, ["checkout", "-q", "-b", "feature"]);
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  git(repo, ["commit", "-q", "-am", "change"]);
  const run = runReview(repo, []);
  assert.equal(run.status, 0, run.stderr);
  assert.match(recordedPrompt(run), /git diff main\.\.\.HEAD/);
});

test("A3: --context and focus text append Background then Focus, in that order, after the rubric", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, ["--context", "the cache is intentional", "watch", "the", "locking"]);
  assert.equal(run.status, 0, run.stderr);
  const prompt = recordedPrompt(run);
  const rubricAt = prompt.indexOf(RUBRIC.trim());
  const bgAt = prompt.indexOf("## Background (settled facts from the working session)\n");
  const focusAt = prompt.indexOf("## Focus\n");
  assert.ok(rubricAt > 0 && bgAt > rubricAt && focusAt > bgAt, prompt);
  assert.ok(prompt.slice(bgAt, focusAt).includes("the cache is intentional"));
  assert.ok(prompt.slice(focusAt).includes("watch the locking"));
});

test("A3: --context @file and @- are expanded", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const ctxFile = path.join(tempDir("harry-rcli-ctx-"), "ctx.md");
  writeFileSync(ctxFile, "from a file\n");
  const fromFile = runReview(repo, ["--context", `@${ctxFile}`]);
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.match(recordedPrompt(fromFile), /## Background[^\n]*\n+from a file/);

  const fromStdin = runReview(repo, ["--context", "@-"], { input: "from stdin\n" });
  assert.equal(fromStdin.status, 0, fromStdin.stderr);
  assert.match(recordedPrompt(fromStdin), /## Background[^\n]*\n+from stdin/);
});

test("F2: an unreadable --context @file fails naming the path and never spawns codex", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const missing = path.join(tempDir("harry-rcli-ctx-"), "nope.md");
  const run = runReview(repo, ["--context", `@${missing}`]);
  assert.notEqual(run.status, 0, run.stderr);
  assert.ok(run.stderr.includes(missing), run.stderr);
  assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
});

test("F2: --context @- with nothing on stdin fails naming stdin and never spawns codex", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, ["--context", "@-"], { input: "" });
  assert.notEqual(run.status, 0, run.stderr);
  assert.match(run.stderr, /--context .*stdin/);
  assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
});

test("A3: a missing rubric fails loudly and never spawns codex", () => {
  // A plugin copy with src/ and package.json but no references/.
  const root = tempDir("harry-rcli-plugin-");
  cpSync(path.join(REPO_ROOT, "src"), path.join(root, "src"), { recursive: true });
  cpSync(path.join(REPO_ROOT, "package.json"), path.join(root, "package.json"));
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, [], { cli: path.join(root, "src/companion.ts") });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /review-rubric\.md/);
  assert.ok(
    !existsSync(path.join(run.record, "argv.json")),
    "no prompt may go out without the rubric",
  );
});

test("A3: --architecture embeds architecture-review.md as the review standard, not the review rubric", () => {
  const repo = makeRepo();
  git(repo, ["checkout", "-q", "-b", "feature"]);
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  git(repo, ["commit", "-q", "-am", "change"]);
  const run = runReview(repo, [
    "--architecture",
    "the",
    "boundary",
    "--base",
    "main",
    "--context",
    "shape list: a.txt",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const prompt = recordedPrompt(run);
  assert.match(prompt, /git diff main\.\.\.HEAD/);
  const standardAt = prompt.indexOf("# Review standard\n");
  assert.ok(standardAt > 0, "review standard section missing");
  assert.ok(prompt.includes(ARCH_RUBRIC.trim()), "architecture-review.md must be embedded in full");
  assert.ok(prompt.indexOf(ARCH_RUBRIC.trim()) > standardAt);
  assert.ok(!prompt.includes(RUBRIC.trim()), "--architecture must not embed review-rubric.md");
  // The lens reads one level up and the history on purpose; the per-diff rule that bans
  // reporting anything outside the changes would forbid exactly that.
  assert.ok(
    !prompt.includes("must not be reported"),
    "--architecture must not carry the per-diff ban on findings outside the changes",
  );
  assert.match(
    prompt,
    /shapes this change adds or alters/,
    "--architecture scopes findings to shapes",
  );
  assert.ok(prompt.includes("shape list: a.txt"), "--context still reaches the Background section");
  // --architecture is boolean: the positional right after it stays focus text.
  assert.ok(prompt.includes("## Focus\n\nthe boundary"), prompt.slice(-200));
  // Same read-only spawn as the per-diff review.
  assert.deepEqual(recordedArgv(run), [
    "exec",
    "review",
    "--ephemeral",
    "-c",
    'sandbox_mode="read-only"',
    "-o",
    outputPathOf(run),
    "-",
  ]);
});

test("A3: without --architecture the prompt embeds the review rubric and not architecture-review.md", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, []);
  assert.equal(run.status, 0, run.stderr);
  const prompt = recordedPrompt(run);
  assert.ok(prompt.includes(RUBRIC.trim()), "the rubric must be embedded in full");
  assert.ok(
    !prompt.includes(ARCH_RUBRIC.trim()),
    "a plain review must not embed architecture-review.md",
  );
  assert.ok(
    prompt.includes("must not be reported"),
    "a plain review keeps its outside-the-diff ban",
  );
});

test("A3: --architecture with a missing architecture-review.md fails loudly and never spawns codex", () => {
  // A plugin copy whose references/ holds the review rubric but not the architecture one.
  const root = tempDir("harry-rcli-plugin-");
  cpSync(path.join(REPO_ROOT, "src"), path.join(root, "src"), { recursive: true });
  cpSync(path.join(REPO_ROOT, "package.json"), path.join(root, "package.json"));
  mkdirSync(path.join(root, "references"));
  cpSync(
    path.join(REPO_ROOT, "references/review-rubric.md"),
    path.join(root, "references/review-rubric.md"),
  );
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, ["--architecture"], { cli: path.join(root, "src/companion.ts") });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /architecture-review\.md/);
  assert.ok(
    !existsSync(path.join(run.record, "argv.json")),
    "no architecture prompt may go out without its standard",
  );
});

// ─── A4: output path ────────────────────────────────────────────────────────

test("A4: from a linked worktree the review lands in the MAIN checkout's .local/tmp/<branch>/", () => {
  const main = makeRepo();
  mkdirSync(path.join(main, ".local"));
  const wt = path.join(tempDir("harry-rcli-wt-"), "wt");
  git(main, ["worktree", "add", "-q", "-b", "feature/x", wt]);
  writeFileSync(path.join(wt, "a.txt"), "v2\n");

  const run = runReview(wt, []);
  assert.equal(run.status, 0, run.stderr);
  const out = outputPathOf(run);
  assert.equal(path.dirname(out), path.join(main, ".local/tmp/feature/x"));
  assert.match(path.basename(out), REVIEW_FILE_RE);
  assert.ok(existsSync(out));
  assert.ok(!existsSync(path.join(wt, ".local")), "never create .local inside the worktree");
});

test("A4: a detached HEAD uses the short sha as the branch segment", () => {
  const main = makeRepo();
  mkdirSync(path.join(main, ".local"));
  git(main, ["checkout", "-q", "--detach"]);
  const sha = git(main, ["rev-parse", "--short", "HEAD"]);
  writeFileSync(path.join(main, "a.txt"), "v2\n");
  const run = runReview(main, []);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(path.dirname(outputPathOf(run)), path.join(main, `.local/tmp/${sha}`));
  assert.match(outputPathOf(run), REVIEW_FILE_RE);
});

test("A4: without a MAIN/.local the review goes under the plugin state dir and no .local is created", () => {
  const main = makeRepo();
  const wt = path.join(tempDir("harry-rcli-wt-"), "wt");
  git(main, ["worktree", "add", "-q", "-b", "topic", wt]);
  writeFileSync(path.join(wt, "a.txt"), "v2\n");

  const run = runReview(wt, []);
  assert.equal(run.status, 0, run.stderr);
  const out = outputPathOf(run);
  assert.ok(
    out.startsWith(`${run.dataDir}${path.sep}`),
    `expected under ${run.dataDir}, got ${out}`,
  );
  assert.ok(path.dirname(out).endsWith(path.join("reviews", "topic")), out);
  assert.match(out, REVIEW_FILE_RE);
  assert.ok(existsSync(out));
  assert.ok(!existsSync(path.join(main, ".local")), "never create MAIN/.local");
  assert.ok(!existsSync(path.join(wt, ".local")), "never create .local inside the worktree");
});

// ─── Success + empty target ─────────────────────────────────────────────────

test("success prints the -o file verbatim on stdout and the path on stderr", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const review = "## Findings\n\n- [P2] something odd\n";
  const run = runReview(repo, [], { fake: { FAKE_CODEX_CLI_REVIEW: review } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, review, "stdout must be exactly the review file (no codex stdout)");
  assert.ok(run.stderr.includes(`Review written to ${outputPathOf(run)}`), run.stderr);
});

test("F1: codex's stderr transcript goes to a .log next to the review, not to the caller", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const noise = "codex-session-transcript-noise\n".repeat(200);
  const run = runReview(repo, [], { fake: { FAKE_CODEX_CLI_STDERR: noise } });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!run.stderr.includes("codex-session-transcript-noise"), run.stderr);
  const log = logPathOf(run);
  assert.ok(run.stderr.includes(`Log: ${log}`), run.stderr);
  assert.equal(readFileSync(log, "utf8"), noise, "the transcript must land in the log");
});

/** A file's permission bits. */
function modeOf(file: string): number {
  return statSync(file).mode & 0o777;
}

test("F8: the run log is owner-only (0600)", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const ok = runReview(repo, [], { permissiveUmask: true });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(modeOf(logPathOf(ok)).toString(8), "600");
  const failed = runReview(repo, [], {
    fake: { FAKE_CODEX_CLI_EXIT: "1" },
    permissiveUmask: true,
  });
  assert.notEqual(failed.status, 0);
  assert.equal(modeOf(logPathOf(failed)).toString(8), "600");
});

test("F8: the review file is owner-only (0600) after a successful run", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, [], { permissiveUmask: true });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(modeOf(outputPathOf(run)).toString(8), "600");
});

test("F8: a failed run's review file, when codex wrote one, is owner-only (0600) too", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const cases: Record<string, string>[] = [
    { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_OUTPUT: "always" },
    { FAKE_CODEX_CLI_OUTPUT: "empty" },
  ];
  for (const fake of cases) {
    const run = runReview(repo, [], { fake, permissiveUmask: true });
    assert.notEqual(run.status, 0, run.stderr);
    assert.ok(existsSync(outputPathOf(run)), `${JSON.stringify(fake)}: no review file`);
    assert.equal(modeOf(outputPathOf(run)).toString(8), "600", JSON.stringify(fake));
  }
});

test("F8: a spawn error's review file, when codex wrote one, is owner-only (0600) too", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  // Writes its -o file, then exits 0 without reading its prompt: EPIPE.
  const bin = makeShimBin(
    'while [ $# -gt 0 ]; do [ "$1" = -o ] && echo partial > "$2"; shift; done\nexit 0',
  );
  const run = runReview(repo, ["--context", `@${hugeContextFile()}`], {
    bin,
    permissiveUmask: true,
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /EPIPE/);
  const review = readdirSync(run.dataDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md"));
  assert.equal(review.length, 1, run.stderr);
  assert.equal(modeOf(path.join(run.dataDir, review[0])).toString(8), "600");
});

test("F7: each run writes its own file, so a second run never clobbers the first", () => {
  const repo = makeRepo();
  mkdirSync(path.join(repo, ".local"));
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const first = runReview(repo, [], { fake: { FAKE_CODEX_CLI_REVIEW: "## round one\n" } });
  assert.equal(first.status, 0, first.stderr);
  const second = runReview(repo, [], { fake: { FAKE_CODEX_CLI_REVIEW: "## round two\n" } });
  assert.equal(second.status, 0, second.stderr);
  assert.notEqual(outputPathOf(first), outputPathOf(second));
  assert.equal(readFileSync(outputPathOf(first), "utf8"), "## round one\n");
  assert.equal(readFileSync(outputPathOf(second), "utf8"), "## round two\n");
});

test("F7: the file name is a local timestamp, suffixed -2, -3 rather than overwriting", () => {
  const dir = tempDir("harry-rcli-names-");
  const now = new Date(2026, 8, 17, 9, 5, 7);
  const a = reserveReviewFiles(dir, now);
  assert.equal(a.reviewPath, path.join(dir, "codex-review-20260917-090507.md"));
  assert.equal(a.logPath, path.join(dir, "codex-review-20260917-090507.log"));
  assert.ok(existsSync(a.logPath), "the log is created to reserve the stem");
  const b = reserveReviewFiles(dir, now);
  assert.equal(b.reviewPath, path.join(dir, "codex-review-20260917-090507-2.md"));
  // A review file alone (no log) also holds its stem.
  writeFileSync(path.join(dir, "codex-review-20260917-090507-3.md"), "old\n");
  const c = reserveReviewFiles(dir, now);
  assert.equal(c.reviewPath, path.join(dir, "codex-review-20260917-090507-4.md"));
  assert.equal(readFileSync(path.join(dir, "codex-review-20260917-090507-3.md"), "utf8"), "old\n");
});

test("an empty target prints the no-changes summary and never spawns codex", () => {
  const repo = makeRepo();
  git(repo, ["checkout", "-q", "-b", "feature"]);
  const run = runReview(repo, []);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^# Review Summary\n\nNo changes to review/);
  assert.ok(!existsSync(path.join(run.record, "argv.json")));
});

// ─── A5: explicit failure, no fallback ──────────────────────────────────────

test("A5: codex missing from PATH fails naming the Codex CLI", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, [], { bin: null });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Codex CLI was not found on PATH/);
  assert.equal(run.stdout, "");
  const leftovers = readdirSync(run.dataDir, { recursive: true }).filter((f) =>
    String(f).endsWith(".log"),
  );
  assert.deepEqual(leftovers, [], "a run that never started codex leaves no log behind");
});

test("A5: a reviewed repo's own `codex` or `git` is never run through an empty or relative PATH entry", () => {
  // review runs codex and git with cwd = the repo under review; execvp would
  // resolve an empty or relative PATH entry against it and run the repo's own.
  const repo = makeRepo();
  const markers = tempDir("harry-rcli-marker-");
  for (const name of ["codex", "git"]) {
    writeFileSync(path.join(repo, name), `#!/bin/sh\n: > "${path.join(markers, name)}"\nexit 0\n`);
    chmodSync(path.join(repo, name), 0o755);
  }
  for (const PATH of [":/usr/bin:/bin", "/usr/bin:/bin:", "/usr/bin::/bin", ".:/usr/bin:/bin"]) {
    const run = runReview(repo, [], { bin: null, fake: { PATH } });
    assert.deepEqual(readdirSync(markers), [], `PATH=${JSON.stringify(PATH)} ran the repo's own`);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Codex CLI was not found on PATH/);
  }
});

/** Every `.log` left under a run's state dir. */
function logsIn(run: Run): string[] {
  return readdirSync(run.dataDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".log"));
}

/** A bin dir whose only file is a `codex` shell script with `body`. */
function makeShimBin(body: string): string {
  const bin = tempDir("harry-rcli-bin-");
  writeFileSync(path.join(bin, "codex"), `#!/bin/sh\n${body}\n`);
  chmodSync(path.join(bin, "codex"), 0o755);
  return bin;
}

/** A `--context` file far bigger than a pipe buffer, so a codex that never reads stdin EPIPEs. */
function hugeContextFile(): string {
  const file = path.join(tempDir("harry-rcli-ctx-"), "big.md");
  writeFileSync(file, "x".repeat(2_000_000));
  return file;
}

test("A5: a codex that cannot be executed (EACCES) fails loudly and leaves no empty log", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  // The only `codex` on PATH is executable, so it resolves, but its `#!`
  // interpreter is not: the spawn itself fails with EACCES. (A non-executable
  // `codex` is never resolved at all — it reports as missing.)
  const bin = makeShimBin("exit 0");
  const interp = path.join(bin, "interp");
  writeFileSync(interp, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  writeFileSync(path.join(bin, "codex"), `#!${interp}\nexit 0\n`);
  const run = runReview(repo, [], { bin, systemPath: true });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /EACCES/);
  assert.equal(run.stdout, "");
  assert.deepEqual(logsIn(run), [], "a spawn that never ran codex leaves no log behind");
});

test("A5: a spawn error after codex wrote to its log keeps the log and names it", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  // Exits 0 without reading its prompt: writing the rest of stdin fails with EPIPE.
  const bin = makeShimBin(`echo "${PLANTED_SECRET}" >&2\nexit 0`);
  const run = runReview(repo, ["--context", `@${hugeContextFile()}`], { bin });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /EPIPE/);
  const logs = logsIn(run);
  assert.equal(logs.length, 1, run.stderr);
  const log = path.join(run.dataDir, logs[0]);
  assert.ok(run.stderr.includes(`Log: ${log}\n`), run.stderr);
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
  assert.equal(readFileSync(log, "utf8"), `${PLANTED_SECRET}\n`);
});

test("A5: a codex that exits non-zero without reading its prompt still reports its error line", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  // clap rejects argv before codex reads stdin: the exit, not the EPIPE, is the failure.
  const cause = "error: unexpected argument '--bogus' found";
  const bin = makeShimBin(`echo "${cause}" >&2\nexit 2`);
  const run = runReview(repo, ["--context", `@${hugeContextFile()}`], { bin });
  assert.notEqual(run.status, 0);
  const logs = logsIn(run);
  assert.equal(logs.length, 1, run.stderr);
  assert.ok(run.stderr.includes(`${cause}\nLog: ${path.join(run.dataDir, logs[0])}\n`), run.stderr);
  assert.match(run.stderr, /codex exec review failed \(exit 2\)/);
});

test("A5: a non-zero codex exit propagates with codex's error line and no fallback", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const cause = "Error: model 'nope' is not supported when using Codex with a ChatGPT account\n";
  const run = runReview(repo, [], {
    fake: { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_STDERR: cause },
  });
  assert.notEqual(run.status, 0);
  assert.deepEqual(recordedArgv(run).slice(0, 2), ["exec", "review"], "codex was never driven");
  assert.ok(run.stderr.includes(cause), run.stderr);
  assert.doesNotMatch(run.stderr, /continu|fall(ing)? ?back/i);
  assert.equal(run.stdout, "", "no markdown may pretend to be a review");
});

test("F1: a failure writes only the error lines of codex's log tail to stderr, then the log path", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  // The transcript echoes files the model read; a planted `.env` line sits in the tail.
  const lines = Array.from({ length: 60 }, (_, i) => `transcript line ${i + 1}`);
  lines.push(PLANTED_SECRET);
  lines.push('ERROR: {"type":"error","status":400,"error":{"message":"model rejected"}}');
  const run = runReview(repo, [], {
    fake: { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_STDERR: `${lines.join("\n")}\n` },
  });
  assert.notEqual(run.status, 0);
  const log = logPathOf(run);
  assert.ok(run.stderr.includes(`${lines.at(-1)}\nLog: ${log}\n`), run.stderr);
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
  assert.ok(!run.stderr.includes("transcript line"), run.stderr);
  assert.ok(readFileSync(log, "utf8").includes(PLANTED_SECRET), "the log keeps the transcript");
  assert.equal(run.stdout, "");
});

test("F1: codex's clap `error:` line reaches stderr", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const cause = "error: unexpected argument '--bogus' found";
  const run = runReview(repo, [], {
    fake: {
      FAKE_CODEX_CLI_EXIT: "2",
      FAKE_CODEX_CLI_STDERR: `${cause}\n\nUsage: codex exec review [OPTIONS]\n`,
    },
  });
  assert.notEqual(run.status, 0);
  assert.ok(run.stderr.includes(`${cause}\nLog: ${logPathOf(run)}\n`), run.stderr);
  assert.ok(!run.stderr.includes("Usage:"), run.stderr);
});

test("F1: an indented `error:` line (file content, not codex's) never reaches stderr", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  // A JSON or YAML file codex read, echoed indented into its transcript.
  const run = runReview(repo, [], {
    fake: {
      FAKE_CODEX_CLI_EXIT: "1",
      FAKE_CODEX_CLI_STDERR: `  error: "fake-planted-secret token"\n\tERROR: fake-planted-secret\n`,
    },
  });
  assert.notEqual(run.status, 0);
  assert.ok(run.stderr.includes(`${NO_ERROR_LINE}\nLog: ${logPathOf(run)}\n`), run.stderr);
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
});

test("F1: log lines split on a lone CR too, and printed error lines carry no control characters", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  // A lone CR (a progress line redrawn in place) must not hide a transcript line
  // behind an error prefix, and an ANSI/OSC sequence must not reach the caller.
  const stderr = [
    `ERROR: first\r${PLANTED_SECRET}`,
    "progress 50%\rError: \x1b[31mboom\x1b]0;title\x07\x1b[0m\x7f",
    "error: crlf\r",
  ].join("\n");
  const run = runReview(repo, [], {
    fake: { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_STDERR: `${stderr}\n` },
  });
  assert.notEqual(run.status, 0);
  assert.ok(
    run.stderr.includes(
      `ERROR: first\nError: [31mboom]0;title[0m\nerror: crlf\nLog: ${logPathOf(run)}\n`,
    ),
    JSON.stringify(run.stderr),
  );
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
  assert.doesNotMatch(run.stderr, /[^\P{Cc}\t\n]/u, JSON.stringify(run.stderr));
});

test("F1: a failure with no error line in the log tail says so and names the log", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, [], {
    fake: {
      FAKE_CODEX_CLI_EXIT: "1",
      FAKE_CODEX_CLI_STDERR: `${PLANTED_SECRET}\nsomething broke\n`,
    },
  });
  assert.notEqual(run.status, 0);
  assert.ok(run.stderr.includes(`${NO_ERROR_LINE}\nLog: ${logPathOf(run)}\n`), run.stderr);
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
  assert.ok(!run.stderr.includes("something broke"), run.stderr);
});

test("F1: an oversized multibyte error line reaches stderr cut to 1000 bytes of valid UTF-8", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  // 2-, 3- and 4-byte code points, ~5 KB: the cut lands mid-code-point unless it is careful.
  const huge = `ERROR: ${"é€𝄞".repeat(560)}`;
  const run = runReview(repo, [], {
    fake: { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_STDERR: `${huge}\n` },
  });
  assert.notEqual(run.status, 0);
  const printed = run.stderr.split("\n").find((l) => l.startsWith("ERROR: "));
  assert.ok(printed, run.stderr);
  assert.ok(Buffer.byteLength(printed) <= 1000, `${Buffer.byteLength(printed)} bytes`);
  assert.ok(printed.endsWith("…[truncated]"), printed.slice(-40));
  assert.ok(!printed.includes("�"), "a code point was split");
  assert.ok(huge.startsWith(printed.slice(0, -"…[truncated]".length)));
  assert.ok(run.stderr.includes(`\nLog: ${logPathOf(run)}\n`), run.stderr.slice(-300));
});

test("A5: a review from an earlier run is never passed off as this run's output", () => {
  const repo = makeRepo();
  mkdirSync(path.join(repo, ".local"));
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const earlier = runReview(repo, [], { fake: { FAKE_CODEX_CLI_REVIEW: "## from last week\n" } });
  assert.equal(earlier.status, 0, earlier.stderr);
  const run = runReview(repo, [], { fake: { FAKE_CODEX_CLI_OUTPUT: "skip" } });
  assert.notEqual(run.status, 0);
  assert.notEqual(outputPathOf(run), outputPathOf(earlier));
  assert.equal(run.stdout, "");
  assert.ok(!run.stderr.includes("from last week"), run.stderr);
});

for (const mode of ["skip", "empty"] as const) {
  test(`A5: codex exit 0 with a ${mode === "skip" ? "missing" : "empty"} -o file fails naming the path`, () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "a.txt"), "v2\n");
    const run = runReview(repo, [], {
      fake: { FAKE_CODEX_CLI_OUTPUT: mode, FAKE_CODEX_CLI_STDERR: `${PLANTED_SECRET}\n` },
    });
    assert.notEqual(run.status, 0);
    assert.ok(run.stderr.includes(outputPathOf(run)), run.stderr);
    assert.ok(run.stderr.includes(`${NO_ERROR_LINE}\nLog: ${logPathOf(run)}\n`), run.stderr);
    assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
    assert.equal(run.stdout, "");
  });
}

// ─── Prose ↔ code: where the review lands ────────────────────────────────────

test("F1: every door that runs review tells the caller to read the `Review written to` path", () => {
  const source = readFileSync(path.join(REPO_ROOT, "src/commands/review.ts"), "utf8");
  assert.ok(
    source.includes(`\${REVIEW_WRITTEN} \${`),
    "review.ts must print REVIEW_WRITTEN followed by the path",
  );
  for (const door of [
    "commands/review.md",
    "codex-skills/review/SKILL.md",
    "skills/executing/SKILL.md",
    "skills/finishing/SKILL.md",
  ]) {
    const text = readFileSync(path.join(REPO_ROOT, door), "utf8");
    assert.ok(text.includes(REVIEW_WRITTEN), `${door} must name the \`${REVIEW_WRITTEN}\` line`);
  }
});

test("both review doors document --architecture and the standard it embeds", () => {
  for (const door of ["commands/review.md", "codex-skills/review/SKILL.md"]) {
    const prose = readFileSync(path.join(REPO_ROOT, door), "utf8");
    assert.ok(
      prose.includes("[--architecture]"),
      `${door} must list --architecture in its synopsis`,
    );
    assert.ok(
      prose.includes(
        "`references/architecture-review.md` in place of `references/review-rubric.md`",
      ),
      `${door} must say --architecture embeds architecture-review.md instead of the rubric`,
    );
    assert.ok(
      prose
        .replace(/\s+/g, " ")
        .includes("scopes findings to the shapes the change adds or alters"),
      `${door} must say --architecture also scopes findings to shapes, not only swaps the standard`,
    );
  }
});

test("F1: every review and ask door quotes the no-error-line notice and names no tail size", () => {
  // The notice is run-codex's, printed by both commands, so all four doors are
  // pinned here. A door quoting a stale copy tells its consumer to watch for a
  // line that never comes; a door naming the tail size drifts when it changes.
  for (const door of [
    "commands/review.md",
    "codex-skills/review/SKILL.md",
    "commands/ask.md",
    "codex-skills/ask/SKILL.md",
  ]) {
    const prose = readFileSync(path.join(REPO_ROOT, door), "utf8").replace(/\s+/g, " ");
    assert.ok(prose.includes(NO_ERROR_LINE), `${door} must quote \`${NO_ERROR_LINE}\``);
    assert.doesNotMatch(prose, /\blast \d+ lines\b/i, `${door} must not name the tail size`);
  }
});

test("F3: commands/review.md pre-approves only the review invocation, and every command matches it", () => {
  // allowed-tools PRE-APPROVES; it does not restrict the model. An invocation
  // that drifts from the pattern only costs a permission prompt, but a broad
  // `Bash(node:*)` would pre-approve any node script.
  const doc = readFileSync(path.join(REPO_ROOT, "commands/review.md"), "utf8");
  const allowed = doc.match(/^allowed-tools: (.+)$/m)?.[1] ?? "";
  const invocation = `node "\${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" review`;
  assert.equal(
    allowed,
    `Read, Bash(git status:*), Bash(git diff:*), Bash(${invocation}:*)`,
    "allowed-tools must name exactly the review invocation plus read-only git and Read",
  );
  const commands = doc.split("\n").filter((l) => /^\s*(?:command: `)?node /.test(l));
  assert.ok(commands.length >= 2, "expected the foreground and background command lines");
  for (const line of commands) {
    assert.ok(
      line
        .trim()
        .replace(/^command: `/, "")
        .startsWith(invocation),
      `command line does not start with the allowlisted invocation: ${line}`,
    );
  }
});
