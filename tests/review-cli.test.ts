/**
 * `companion review` is a thin wrapper over the Codex CLI's `codex exec`.
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
import { buildReviewPrompt, type ReviewPromptInput } from "../src/lib/review-modes.ts";
import { NO_ERROR_LINE } from "../src/lib/run-codex.ts";
import { type Block, cites, readProse } from "./citations.ts";
import { inDir, READER_CORPUS } from "./prose-dirs.ts";
import { headingLines, headingSection, inOrder, outline, section } from "./section.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "src/companion.ts");
const FAKE = path.join(REPO_ROOT, "tests/fake-codex-cli.mjs");
const RUBRIC = readFileSync(path.join(REPO_ROOT, "references/review-rubric.md"), "utf8");
const ARCH_RUBRIC = readFileSync(path.join(REPO_ROOT, "references/architecture-review.md"), "utf8");
const RED_GREEN = readFileSync(path.join(REPO_ROOT, "references/red-green.md"), "utf8");
const FIX_CHECK = readFileSync(path.join(REPO_ROOT, "references/fix-check.md"), "utf8");
const THREE_LEVELS = headingSection(FIX_CHECK, "references/fix-check.md", "## Three levels").trim();

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

function makeBranchRepo(): string {
  const repo = makeRepo();
  git(repo, ["checkout", "-q", "-b", "feature"]);
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  git(repo, ["commit", "-q", "-am", "change"]);
  return repo;
}

function handedFile(text: string): string {
  const file = path.join(tempDir("harry-rcli-handed-"), "handed.md");
  writeFileSync(file, text);
  return file;
}

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

for (const flag of ["--base", "--context", "--rereview", "--fix-check"]) {
  test(`F6: ${flag} with no value errors naming the flag instead of being ignored`, () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "a.txt"), "v2\n");
    const run = runReview(repo, [flag, "--reasoning", "high"]);
    assert.notEqual(run.status, 0, run.stderr);
    assert.ok(run.stderr.includes(`${flag} requires a value`), run.stderr);
    assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
  });
}

for (const flag of ["--base", "--context", "--rereview", "--fix-check"]) {
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
  assert.deepEqual(argv, ["exec", "--ephemeral", "-s", "read-only", "-o", outputPathOf(run), "-"]);
  assert.ok(!argv.includes("-m"));
});

test("A2: --reasoning adds exactly one TOML-quoted effort override before the stdin marker", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const run = runReview(repo, ["--reasoning", "high"]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(recordedArgv(run), [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
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

  inOrder(
    prompt,
    "the review prompt",
    "# Review standard\n",
    RUBRIC.trim(),
    "# Test standard (`references/red-green.md`)\n",
    RED_GREEN.trim(),
  );

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
  const background = "## Background (settled facts from the working session)\n";
  inOrder(prompt, "the review prompt", RUBRIC.trim(), background, "## Focus\n");
  assert.ok(
    section(prompt, "the review prompt", background, "## Focus\n").includes(
      "the cache is intentional",
    ),
  );
  assert.ok(section(prompt, "the review prompt", "## Focus\n").includes("watch the locking"));
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

for (const { missing, args } of [
  { missing: "review-rubric.md", args: [] },
  { missing: "red-green.md", args: [] },
  { missing: "architecture-review.md", args: ["--architecture"] },
  { missing: "fix-check.md", args: ["--base", "main", "--rereview", "4 · open"] },
  { missing: "fix-check.md", args: ["--base", "main", "--fix-check", "2 · fix"] },
]) {
  test(`A3: a missing ${missing} fails loudly and never spawns codex (${args.join(" ") || "review"})`, () => {
    const root = tempDir("harry-rcli-plugin-");
    cpSync(path.join(REPO_ROOT, "src"), path.join(root, "src"), { recursive: true });
    cpSync(path.join(REPO_ROOT, "package.json"), path.join(root, "package.json"));
    cpSync(path.join(REPO_ROOT, "references"), path.join(root, "references"), {
      recursive: true,
    });
    rmSync(path.join(root, "references", missing));
    const repo = makeBranchRepo();
    const run = runReview(repo, args, { cli: path.join(root, "src/companion.ts") });
    assert.notEqual(run.status, 0);
    assert.ok(run.stderr.includes(missing), run.stderr);
    assert.ok(
      !existsSync(path.join(run.record, "argv.json")),
      "no prompt may go out without every reference it embeds",
    );
  });
}

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
  inOrder(prompt, "the review prompt", "# Review standard\n", ARCH_RUBRIC.trim());
  assert.ok(!prompt.includes(RUBRIC.trim()), "--architecture must not embed review-rubric.md");
  assert.ok(!prompt.includes(RED_GREEN.trim()), "--architecture must not embed red-green.md");
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
    "--ephemeral",
    "-s",
    "read-only",
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

// ─── Re-review and fix check ────────────────────────────────────────────────

const OPEN_FINDINGS =
  "4 · a.txt:1 · the value is stale\nfix check: 4 · holds at all three levels\nlast number: 6";

test("AC-1: --rereview embeds the per-diff standard, Three levels, the mode, then the handed findings, in order", () => {
  const repo = makeBranchRepo();
  const run = runReview(repo, [
    "--base",
    "main",
    "--rereview",
    `@${handedFile(`${OPEN_FINDINGS}\n`)}`,
    "--context",
    "AC-1: a.txt holds v2",
    "watch",
    "zebra-lock",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const prompt = recordedPrompt(run);
  assert.ok(prompt.startsWith("# Review target\n"), prompt.slice(0, 200));
  assert.match(prompt, /git diff main\.\.\.HEAD/);
  assert.match(prompt, /must not be reported/, "a re-review keeps the per-diff rule");
  inOrder(
    prompt,
    "the re-review prompt",
    "# Review standard\n",
    RUBRIC.trim(),
    "# Test standard (`references/red-green.md`)\n",
    RED_GREEN.trim(),
    THREE_LEVELS,
    "# Re-review mode\n",
    "# Open findings handed to this re-review\n",
    OPEN_FINDINGS,
    "## Background (settled facts from the working session)\n",
    "AC-1: a.txt holds v2",
    "## Focus\n",
    "watch zebra-lock",
  );
});

test("AC-1: the re-review mode section names the re-review form, its verdicts, the numbering and the levels", () => {
  const repo = makeBranchRepo();
  const run = runReview(repo, ["--base", "main", "--rereview", OPEN_FINDINGS]);
  assert.equal(run.status, 0, run.stderr);
  const mode = section(
    recordedPrompt(run),
    "the re-review prompt",
    "# Re-review mode\n",
    "# Open findings handed to this re-review\n",
  ).replace(/\s+/g, " ");
  for (const needle of [
    "re-review form",
    "ADDRESSED",
    "NOT ADDRESSED",
    "under its handed number",
    "on from the last number handed",
    "Three levels",
  ])
    assert.ok(mode.includes(needle), `the mode section must say "${needle}": ${mode}`);
});

test("AC-1: a re-review carries fix-check.md's Three levels section and no other part of that file", () => {
  const repo = makeBranchRepo();
  const run = runReview(repo, ["--base", "main", "--rereview", OPEN_FINDINGS]);
  assert.equal(run.status, 0, run.stderr);
  const prompt = recordedPrompt(run);
  assert.ok(prompt.includes(THREE_LEVELS), "the Three levels section must be embedded whole");
  const rest = FIX_CHECK.replace(THREE_LEVELS, "\n\n");
  const paragraphs = rest
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);
  assert.ok(paragraphs.length >= 5, "expected the rest of fix-check.md to hold several paragraphs");
  for (const paragraph of paragraphs)
    assert.ok(
      !prompt.includes(paragraph),
      `a re-review must embed no part of fix-check.md outside Three levels: "${paragraph.slice(0, 60)}"`,
    );
});

const HANDED_FIXES =
  "2 · a.txt:1 · stale value · fix: read v2 from the source\nearlier findings: none";

test("AC-2: --fix-check embeds fix-check.md in full, then the handed fixes, Background and Focus, in order", () => {
  const repo = makeBranchRepo();
  const run = runReview(repo, [
    "--base",
    "main",
    "--fix-check",
    `@${handedFile(`${HANDED_FIXES}\n`)}`,
    "--context",
    "ruling: v2 is the source of truth",
    "watch",
    "zebra-lock",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const prompt = recordedPrompt(run);
  inOrder(
    prompt,
    "the fix-check prompt",
    "# Fix check target\n",
    "git diff main...HEAD",
    "# Fix check standard (`references/fix-check.md`)\n",
    FIX_CHECK.trim(),
    "# Fixes handed to this fix check\n",
    HANDED_FIXES,
    "## Background (settled facts from the working session)\n",
    "ruling: v2 is the source of truth",
    "## Focus\n",
    "watch zebra-lock",
  );
  assert.ok(!prompt.includes(RUBRIC.trim()), "a fix check must not embed the review rubric");
  assert.ok(!prompt.includes(RED_GREEN.trim()), "a fix check must not embed red-green.md");
  assert.deepEqual(recordedArgv(run), [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "-o",
    outputPathOf(run),
    "-",
  ]);
});

test("AC-2: the fix-check target sends the reader through the whole repo and judges only the handed fixes", () => {
  const repo = makeBranchRepo();
  const run = runReview(repo, ["--base", "main", "--fix-check", HANDED_FIXES]);
  assert.equal(run.status, 0, run.stderr);
  const prompt = recordedPrompt(run);
  const target = section(
    prompt,
    "the fix-check prompt",
    "# Fix check target\n",
    "# Fix check standard",
  ).replace(/\s+/g, " ");
  for (const needle of [
    "Read the whole repo",
    "trace the data flow",
    "Judge only the handed fixes",
    "under its finding's number",
    "never a number from the handed file's title",
  ])
    assert.ok(target.includes(needle), `the fix-check target must say "${needle}": ${target}`);
  // The fix check traces the flow beyond the diff on purpose; the per-diff ban would forbid it.
  assert.ok(
    !prompt.includes("must not be reported"),
    "a fix check must not carry the per-diff ban on findings outside the changes",
  );
});

for (const { flag, base } of [
  { flag: "--rereview", base: "the head the review it follows reviewed" },
  { flag: "--fix-check", base: "the unit's branch point" },
]) {
  test(`AC-3: ${flag} without --base fails naming the cause and never spawns codex`, () => {
    // A clean branch one commit ahead of main: without the guard, auto would review it.
    const repo = makeBranchRepo();
    const run = runReview(repo, [flag, "4 · open"]);
    assert.notEqual(run.status, 0, run.stderr);
    assert.ok(run.stderr.includes(`${flag} requires --base <ref>: ${base}.`), run.stderr);
    assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
  });
}

for (const pair of [
  ["--rereview", "--fix-check"],
  ["--rereview", "--architecture"],
  ["--fix-check", "--architecture"],
]) {
  test(`AC-3: ${pair.join(" with ")} fails naming both and never spawns codex`, () => {
    const repo = makeBranchRepo();
    const args = ["--base", "main"];
    for (const flag of pair)
      args.push(...(flag === "--architecture" ? [flag] : [flag, "4 · open"]));
    const run = runReview(repo, args);
    assert.notEqual(run.status, 0, run.stderr);
    assert.match(run.stderr, /cannot be combined/, run.stderr);
    for (const flag of pair) assert.ok(run.stderr.includes(flag), `${flag}: ${run.stderr}`);
    assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
  });
}

for (const flag of ["--rereview", "--fix-check"]) {
  test(`AC-3: an unreadable ${flag} @file fails naming the flag and path, and never spawns codex`, () => {
    const repo = makeBranchRepo();
    const missing = path.join(tempDir("harry-rcli-handed-"), "nope.md");
    const run = runReview(repo, ["--base", "main", flag, `@${missing}`]);
    assert.notEqual(run.status, 0, run.stderr);
    assert.ok(run.stderr.includes(`Could not read ${flag} file ${missing}`), run.stderr);
    assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
  });

  test(`AC-3: an empty ${flag} @file or @- fails naming the flag and source, and never spawns codex`, () => {
    const repo = makeBranchRepo();
    const empty = handedFile("  \n");
    for (const [value, source] of [
      [`@${empty}`, `file ${empty}`],
      ["@-", "from stdin"],
    ]) {
      const run = runReview(repo, ["--base", "main", flag, value], { input: "" });
      assert.notEqual(run.status, 0, `${value}: ${run.stderr}`);
      assert.ok(run.stderr.includes(`${flag} ${source} is empty`), `${value}: ${run.stderr}`);
      assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
    }
  });
}

test("AC-3: a fix-check.md with no `## Three levels` heading fails a re-review and never spawns codex", () => {
  const root = tempDir("harry-rcli-plugin-");
  cpSync(path.join(REPO_ROOT, "src"), path.join(root, "src"), { recursive: true });
  cpSync(path.join(REPO_ROOT, "package.json"), path.join(root, "package.json"));
  cpSync(path.join(REPO_ROOT, "references"), path.join(root, "references"), { recursive: true });
  const copy = path.join(root, "references", "fix-check.md");
  const renamed = FIX_CHECK.replace("## Three levels\n", "## Levels\n");
  assert.notEqual(renamed, FIX_CHECK, "the fixture must remove the heading");
  writeFileSync(copy, renamed);
  const repo = makeBranchRepo();
  const run = runReview(repo, ["--base", "main", "--rereview", "4 · open"], {
    cli: path.join(root, "src/companion.ts"),
  });
  assert.notEqual(run.status, 0, run.stderr);
  assert.ok(run.stderr.includes(copy), run.stderr);
  assert.ok(run.stderr.includes("## Three levels"), run.stderr);
  assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
});

for (const flag of ["--rereview", "--fix-check"]) {
  test(`${flag} with no changes under --base fails naming the flag instead of reporting nothing to review`, () => {
    const repo = makeBranchRepo();
    const run = runReview(repo, ["--base", "HEAD", flag, "4 · open"]);
    assert.notEqual(run.status, 0, run.stderr);
    assert.ok(run.stderr.includes(`${flag} has no changes to judge`), run.stderr);
    assert.ok(!run.stdout.includes("No changes to review"), run.stdout);
    assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
  });
}

test("a re-review with no changes still fails on a fix-check.md with no `## Three levels` heading first", () => {
  const root = tempDir("harry-rcli-plugin-");
  cpSync(path.join(REPO_ROOT, "src"), path.join(root, "src"), { recursive: true });
  cpSync(path.join(REPO_ROOT, "package.json"), path.join(root, "package.json"));
  cpSync(path.join(REPO_ROOT, "references"), path.join(root, "references"), { recursive: true });
  const copy = path.join(root, "references", "fix-check.md");
  writeFileSync(copy, FIX_CHECK.replace("## Three levels\n", "## Levels\n"));
  const repo = makeBranchRepo();
  const run = runReview(repo, ["--base", "HEAD", "--rereview", "4 · open"], {
    cli: path.join(root, "src/companion.ts"),
  });
  assert.notEqual(run.status, 0, run.stderr);
  assert.ok(run.stderr.includes(copy), run.stderr);
  assert.ok(run.stderr.includes("## Three levels"), run.stderr);
});

for (const flag of ["--rereview", "--fix-check"]) {
  test(`${flag} @- with --context @- fails naming both flags instead of an empty stdin`, () => {
    const repo = makeBranchRepo();
    const run = runReview(repo, ["--base", "main", flag, "@-", "--context", "@-"], {
      input: "4 · open\n",
    });
    assert.notEqual(run.status, 0, run.stderr);
    assert.ok(run.stderr.includes(`--context and ${flag} cannot both read stdin`), run.stderr);
    assert.ok(!existsSync(path.join(run.record, "argv.json")), "codex must not be spawned");
  });
}

test("AC-8: --rereview runs codex exec read-only, not codex exec review, and names the review file", () => {
  const repo = makeBranchRepo();
  const run = runReview(repo, ["--base", "main", "--rereview", OPEN_FINDINGS]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(recordedArgv(run), [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "-o",
    outputPathOf(run),
    "-",
  ]);
  assert.ok(run.stderr.includes(`${REVIEW_WRITTEN} ${outputPathOf(run)}`), run.stderr);
});

test("AC-8: --rereview with --reasoning adds one effort override before the stdin marker", () => {
  const repo = makeBranchRepo();
  const run = runReview(repo, [
    "--base",
    "main",
    "--rereview",
    OPEN_FINDINGS,
    "--reasoning",
    "high",
  ]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(recordedArgv(run), [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "-o",
    outputPathOf(run),
    "-c",
    'model_reasoning_effort="high"',
    "-",
  ]);
});

test("AC-8: a failed re-review names codex exec, the process that ran, not codex exec review", () => {
  const repo = makeBranchRepo();
  const run = runReview(repo, ["--base", "main", "--rereview", OPEN_FINDINGS], {
    fake: { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_STDERR: "Error: quota\n" },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /with codex exec…/);
  assert.match(run.stderr, /codex exec failed \(exit 1\)/);
  assert.doesNotMatch(run.stderr, /codex exec review/);
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
  assert.match(run.stderr, /codex exec failed \(exit 2\)/);
});

test("A5: a non-zero codex exit propagates with codex's error line and no fallback", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "a.txt"), "v2\n");
  const cause = "Error: model 'nope' is not supported when using Codex with a ChatGPT account\n";
  const run = runReview(repo, [], {
    fake: { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_STDERR: cause },
  });
  assert.notEqual(run.status, 0);
  assert.deepEqual(
    recordedArgv(run).slice(0, 2),
    ["exec", "--ephemeral"],
    "codex was never driven",
  );
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
      FAKE_CODEX_CLI_STDERR: `${cause}\n\nUsage: codex exec [OPTIONS] [PROMPT]\n`,
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
      prose
        .replace(/\s+/g, " ")
        .includes("`references/architecture-review.md` in place of the per-diff standard"),
      `${door} must say --architecture embeds architecture-review.md instead of the per-diff standard`,
    );
    assert.ok(
      prose
        .replace(/\s+/g, " ")
        .includes("scopes findings to the shapes the change adds or alters"),
      `${door} must say --architecture also scopes findings to shapes, not only swaps the standard`,
    );
    const flat = prose.replace(/\s+/g, " ");
    assert.ok(
      flat.includes("every file `references/review-rubric.md` declares as its standard"),
      `${door} must point at the rubric's declared standard, not list its files`,
    );
    for (const file of declaredStandardFiles().filter((f) => f !== "references/review-rubric.md"))
      assert.ok(
        !flat.includes(`\`${file}\``),
        `${door} names ${file} itself — the rubric's declaration is the only list`,
      );
  }
});

const REVIEW_DOORS = ["commands/review.md", "codex-skills/review/SKILL.md"];

function doorSynopsis(door: string, prose: string): string {
  const line =
    door === "commands/review.md"
      ? prose.match(/^argument-hint: (.+)$/m)?.[1]
      : prose.match(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/companion\.cjs" review \[.+$/m)?.[0];
  assert.ok(line, `${door} has no synopsis line`);
  return line;
}

test("AC-5: both review doors list --rereview and --fix-check in their synopsis", () => {
  for (const door of REVIEW_DOORS) {
    const synopsis = doorSynopsis(door, readFileSync(path.join(REPO_ROOT, door), "utf8"));
    for (const flag of ["[--rereview <text|@file|@->]", "[--fix-check <text|@file|@->]"])
      assert.ok(synopsis.includes(flag), `${door}'s synopsis must list ${flag}: ${synopsis}`);
  }
});

for (const { flag, others, holds } of [
  {
    flag: "--rereview",
    others: "`--architecture` and `--fix-check`",
    holds:
      "holds the open findings under their numbers, the fix check's verdicts and the last number in use",
  },
  {
    flag: "--fix-check",
    others: "`--architecture` and `--rereview`",
    holds: "holds each finding with its proposed fix",
  },
]) {
  test(`AC-5: both review doors say what ${flag}'s file holds, that it needs --base and what it excludes`, () => {
    for (const door of REVIEW_DOORS) {
      const raw = readFileSync(path.join(REPO_ROOT, door), "utf8");
      const own = headingSection(raw, door, `## \`${flag}\``).replace(/\s+/g, " ");
      for (const needle of [holds, "needs `--base`", `excludes ${others}`])
        assert.ok(own.includes(needle), `${door}'s \`${flag}\` section must say "${needle}"`);
    }
  });
}

test("both review doors say an empty range fails --rereview and --fix-check instead of reporting nothing", () => {
  for (const door of REVIEW_DOORS) {
    const prose = readFileSync(path.join(REPO_ROOT, door), "utf8").replace(/\s+/g, " ");
    const nothing = section(prose, door, "**Nothing to review:**", "## Failure");
    assert.ok(
      nothing.includes("With `--rereview` or `--fix-check`, an empty range fails instead"),
      `${door}'s Nothing to review paragraph must say an empty range fails the two handed modes`,
    );
  }
});

test("AC-15: the review doors, CLAUDE.md and README say review runs as codex exec, and why", () => {
  const because =
    "Not `codex exec review`: it answers in its own review-comment format and ignores the form the prompt asks for";
  for (const [rel, part] of [
    ...REVIEW_DOORS.map((door) => [door, "## What this does"]),
    ["CLAUDE.md", "## Runtime architecture"],
    ["README.md", "## Codex"],
  ]) {
    const raw = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const own = headingSection(raw, rel, part).replace(/\s+/g, " ");
    assert.ok(
      own.includes("spawns `codex exec") && !own.includes("spawns `codex exec review`"),
      `${rel} (${part}) must say review runs codex exec`,
    );
    assert.ok(own.includes(because), `${rel} (${part}) must say why`);
  }
  for (const door of REVIEW_DOORS) {
    const raw = readFileSync(path.join(REPO_ROOT, door), "utf8");
    assert.ok(
      !headingSection(raw, door, "## `--rereview`").includes("codex exec"),
      `${door}'s --rereview section still singles out the re-review's spawn`,
    );
  }
});

test("AC-11: only the review doors, CLAUDE.md's runtime section and README name review's codex subcommand", () => {
  const owners = new Set(["commands/review.md", "codex-skills/review/SKILL.md", "README.md"]);
  const hits = READER_CORPUS.filter((rel) => !owners.has(rel)).flatMap((rel) => {
    const raw = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const runtime = rel === "CLAUDE.md" ? headingLines(raw, rel, "## Runtime architecture") : null;
    return readProse(rel, raw).flatMap((block) =>
      [...block.text.matchAll(/codex\s+exec\s+review/g)]
        .map((match) => ({ at: match.index, line: block.lineAt(match.index) }))
        .filter(({ line }) => !runtime || line < runtime[0] || line > runtime[1])
        .map(
          ({ at, line }) => `${rel}:${line}: ${block.text.slice(at, at + 80).replace(/\s+/g, " ")}`,
        ),
    );
  });
  assert.deepEqual(hits, [], "callers name the review mode they run, not the codex subcommand");
});

test("AC-5: both review doors send a re-review's open findings to --rereview, not --context", () => {
  for (const door of REVIEW_DOORS) {
    const raw = readFileSync(path.join(REPO_ROOT, door), "utf8");
    const context = headingSection(raw, door, "## `--context`").replace(/\s+/g, " ");
    assert.ok(
      context.includes("A re-review's open findings go in `--rereview`, not `--context`"),
      `${door}'s \`--context\` section must route a re-review's open findings to --rereview`,
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

function rubricLine(label: string): Block {
  const found = readProse("references/review-rubric.md", RUBRIC).filter((block) =>
    block.text.startsWith(label),
  );
  assert.equal(found.length, 1, `review-rubric.md declares no single ${label} line`);
  return found[0] as Block;
}

function declaredStandardFiles(): string[] {
  return rubricLine("**Standard files:**")
    .code.filter((span) => span.path && span.value.endsWith(".md"))
    .map((span) => span.value);
}

test("the per-diff prompt embeds exactly the files the rubric declares as its standard", () => {
  const declared = declaredStandardFiles();
  for (const file of declared)
    assert.ok(file.startsWith("references/"), `${file}: the prompt loads only from references/`);
  const prompt = buildReviewPrompt({
    target: { mode: "working-tree", label: "working tree diff" },
    standard: "review",
  });
  const refs = inDir("references");
  const embedded = refs.filter((rel) =>
    prompt.includes(readFileSync(path.join(REPO_ROOT, rel), "utf8").trim()),
  );
  assert.deepEqual(embedded.sort(), [...declared].sort());
});

function declaredRereviewSections(): Array<{ file: string; heading: string }> {
  return cites(rubricLine("**Re-review standard:**")).map(({ path: file, name: heading }) => ({
    file,
    heading,
  }));
}

test("AC-4: the re-review prompt embeds the declared standard files whole and exactly the declared sections", () => {
  const declared = declaredStandardFiles();
  const sections = declaredRereviewSections();
  assert.ok(sections.length > 0, "the **Re-review standard:** line names no section");
  const prompt = buildReviewPrompt({
    target: { mode: "branch", label: "branch diff against main", baseRef: "main" },
    standard: "rereview",
    handed: "4 · open",
  });
  const refs = inDir("references");
  const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
  const whole = refs.filter((rel) => prompt.includes(read(rel).trim()));
  assert.deepEqual(whole.sort(), [...declared].sort());
  const embedded: Array<{ file: string; heading: string }> = [];
  for (const rel of refs.filter((r) => !declared.includes(r))) {
    const text = read(rel);
    for (const line of outline(text).filter((l) => l.level === 2))
      if (prompt.includes(headingSection(text, rel, line.text).trim()))
        embedded.push({ file: rel, heading: line.title });
  }
  assert.deepEqual(embedded, sections);
});

for (const standard of ["rereview", "fix-check"] as const) {
  test(`the builder refuses blank handed text for a ${standard}, naming the standard`, () => {
    assert.throws(
      () =>
        buildReviewPrompt({
          target: { mode: "branch", label: "branch diff against main", baseRef: "main" },
          standard,
          handed: "  ",
        }),
      { message: `A ${standard} prompt requires its handed text.` },
    );
  });
}

test("AC-10: typecheck holds the builder's handed text to the re-review and the fix check", () => {
  const target = { mode: "branch" as const, label: "branch diff against main", baseRef: "main" };
  // @ts-expect-error a re-review needs its handed text
  const rereview: ReviewPromptInput = { target, standard: "rereview" };
  // @ts-expect-error a fix check needs its handed text
  const fixCheck: ReviewPromptInput = { target, standard: "fix-check" };
  // @ts-expect-error the plain review takes no handed text
  const review: ReviewPromptInput = { target, standard: "review", handed: "4 · open" };
  assert.deepEqual(
    [rereview.standard, fixCheck.standard, review.standard],
    ["rereview", "fix-check", "review"],
  );
});

const flatProse = (text: string): string => text.replace(/\s+/g, " ").replace(/\*+|`/g, "");
const headingsIn = (raw: string): Set<string> => new Set(raw.match(/#{2,} [^`\n]+/g) ?? []);
const capsWordsIn = (raw: string): Set<string> => new Set(raw.match(/\b[A-Z]{2,}\b/g) ?? []);

function rubricRereviewForm(): string {
  const lines = section(RUBRIC, "references/review-rubric.md", "**Re-review standard:**").split(
    "\n",
  );
  const open = lines.findIndex((l) => l.startsWith("```"));
  const close = lines.findIndex((l, i) => i > open && l.startsWith("```"));
  assert.ok(open !== -1 && close !== -1, "the rubric's re-review form block is gone");
  return lines.slice(open + 1, close).join("\n");
}

test("AC-12: the re-review mode section and executing quote only what the rubric's re-review form holds", () => {
  const formRaw = rubricRereviewForm();
  const form = flatProse(formRaw);
  const modeRaw = section(
    buildReviewPrompt({
      target: { mode: "branch", label: "branch diff against main", baseRef: "main" },
      standard: "rereview",
      handed: "4 · open",
    }),
    "the re-review prompt",
    "# Re-review mode\n",
    "# Open findings handed to this re-review\n",
  );
  const executingRaw = section(
    readFileSync(path.join(REPO_ROOT, "skills/executing/SKILL.md"), "utf8"),
    "skills/executing/SKILL.md",
    "It reports in the rubric's re-review form",
    "adjudication.",
  );
  for (const [rel, raw, tokens] of [
    [
      "the re-review mode section",
      modeRaw,
      [
        "### Open findings",
        "ADDRESSED",
        "NOT ADDRESSED",
        "is not addressed",
        "on from the last number handed",
        "Three levels",
      ],
    ],
    [
      "skills/executing/SKILL.md",
      executingRaw,
      ["ADDRESSED / NOT ADDRESSED", "attempted is not addressed"],
    ],
  ] as const) {
    const restated = flatProse(raw);
    for (const token of tokens) {
      assert.ok(restated.includes(token), `${rel} no longer says "${token}"`);
      assert.ok(
        form.includes(token),
        `${rel} says "${token}", which the rubric's re-review form does not`,
      );
    }
    for (const heading of headingsIn(raw))
      assert.ok(
        headingsIn(formRaw).has(heading),
        `${rel} quotes the heading "${heading}", which the rubric's re-review form does not hold`,
      );
    for (const word of capsWordsIn(raw))
      assert.ok(
        capsWordsIn(formRaw).has(word),
        `${rel} quotes the verdict word "${word}", which the rubric's re-review form does not hold`,
      );
  }
});

test("the fix-check target quotes only what fix-check.md's Output holds", () => {
  const output = headingSection(FIX_CHECK, "references/fix-check.md", "## Output");
  const target = section(
    buildReviewPrompt({
      target: { mode: "branch", label: "branch diff against main", baseRef: "main" },
      standard: "fix-check",
      handed: "1 · a.txt:1 · fix",
    }),
    "the fix-check prompt",
    "Judge only the handed fixes",
    "raise no new findings.",
  );
  const phrase = "under its finding's number";
  assert.ok(flatProse(target).includes(phrase), `the fix-check target no longer says "${phrase}"`);
  assert.ok(flatProse(output).includes(phrase), `fix-check.md's Output no longer says "${phrase}"`);
  for (const heading of headingsIn(target))
    assert.ok(
      headingsIn(output).has(heading),
      `the fix-check target quotes the heading "${heading}"`,
    );
  for (const word of capsWordsIn(target))
    assert.ok(capsWordsIn(output).has(word), `the fix-check target quotes the word "${word}"`);
});
