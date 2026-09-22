/**
 * `companion ask` — a thin wrapper over the Codex CLI's `codex exec`, and its
 * failure contract.
 *
 * The CLI tests run the real CLI (`node src/companion.ts ask …`) with
 * `tests/fake-codex-cli.mjs` installed as `codex` first on PATH, and pin the
 * argv it spawns, the prompt it sends on stdin, where the answer lands, and
 * that every failure is self-describing.
 *
 * Both of `ask`'s doors instruct their consumers to "Return the command stdout
 * verbatim, exactly as-is", and `/debate` folds that stdout into a three-voice
 * synthesis. So a failed run MUST be self-describing on stdout: `# Ask Failed`
 * as the first line, then the reason, and a non-zero exit.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ASK_PREAMBLE } from "../src/commands/ask.ts";
import { NO_ERROR_LINE } from "../src/lib/run-codex.ts";
import { pruneRunFiles, reserveRunFiles } from "../src/lib/run-files.ts";

const CLI = path.resolve(import.meta.dirname, "../src/companion.ts");

/**
 * `ask`'s failure signals, declared once. The CLI assertions below and the
 * prose contract at the bottom of this file both read these, so the code and
 * every door move together instead of drifting apart.
 *
 * `Fatal error:` comes from companion.ts's top-level handler rather than from
 * ask itself, and only for argument errors caught before ask runs (a failure ask
 * reports never reaches it), but two doors name it as a signal to watch for, so it needs the
 * same pinning — a door quoting a string nothing asserts is exactly the drift
 * this file exists to stop. (`Ask failed:` is asserted against the CLI too but
 * is deliberately absent here: no door names it, so it cannot go stale in prose.)
 */
const ASK_FAILED_MARKER = "# Ask Failed";
const FATAL_ERROR_PREFIX = "Fatal error:";

/**
 * The positional qualifier on the marker. Load-bearing, not decorative: `ask`
 * writes the marker as stdout's FIRST LINE, so that is the only correct way to
 * test for it. Prose calling it a "heading" invites a contains-check, which
 * false-positives on a successful answer that happens to quote the marker.
 * Pinned so the fix for that finding cannot silently revert.
 */
const MARKER_POSITION = "first line";

/**
 * The phantom guard the doors used to carry: `ask` has no JSON mode and no
 * `status` field, so an instruction to check one can never fire. It was removed
 * once; this keeps it from drifting back in.
 */
const PHANTOM_STATUS_GUARD = "is `failed`";

interface AskDoor {
  /** Repo-relative path. */
  path: string;
  /**
   * Strings this door must carry: the failure signals it tells its consumer to
   * watch for, plus any qualifier that makes a signal correctly checkable.
   */
  quotes: readonly string[];
  /**
   * The door's prohibition on relaying a failed body. A short fragment, not a
   * sentence — pinning whole sentences just moves the brittleness.
   */
  prohibition: string;
}

/**
 * Every door that tells a consumer to return `ask`'s stdout verbatim, and so
 * must also name the signals that say not to. Hand-maintained on purpose: this
 * is a declaration of intent (same as role-mapping-drift.test.ts's PAIRS), and
 * a derived list would also sweep in a future door that invokes `ask` without
 * relaying stdout verbatim — a false failure that would get silenced by an
 * allowlist, which is how a guard rots. The cross-check test below keeps the
 * hand list honest instead.
 *
 * `debate.md` differs on two counts, both by design. Its prohibition: a failed
 * `gpt` leg does not stop the debate — it drops that voice, continues with the
 * others, and reports the omission — so there is no "stop" instruction to
 * assert. And it does not pin MARKER_POSITION: it tells its consumer to gate on
 * the exit code rather than on the marker at all, so the marker is explanatory
 * there and the positional word carries no obligation. Pinning it anyway would
 * manufacture a contract rather than record one (same reasoning as
 * `Ask failed:` above).
 */
const ASK_DOORS: readonly AskDoor[] = [
  {
    path: "commands/ask.md",
    quotes: [ASK_FAILED_MARKER, MARKER_POSITION, FATAL_ERROR_PREFIX],
    prohibition: "never present",
  },
  {
    path: "codex-skills/ask/SKILL.md",
    quotes: [ASK_FAILED_MARKER, MARKER_POSITION, FATAL_ERROR_PREFIX],
    prohibition: "never present",
  },
  {
    path: "commands/debate.md",
    quotes: [ASK_FAILED_MARKER],
    prohibition: "never relay",
  },
];

/**
 * Doors that invoke `ask` but deliberately do NOT relay its stdout verbatim
 * (e.g. one that parses the answer). Each needs a stated reason; an entry here
 * is a conscious exemption, not a silencer.
 */
const ASK_DOORS_EXEMPT: ReadonlyArray<{ path: string; reason: string }> = [];

/** Dirs holding executable doors — prose a consumer follows, not commentary. */
const DOOR_DIRS = ["commands", "codex-skills", "skills", "references"];

const repoRoot = path.resolve(import.meta.dirname, "..");

function listMarkdownFiles(dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { recursive: true, encoding: "utf-8" })
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => path.join(dir, rel));
}

/** Read prose with whitespace collapsed, so substring checks survive wrapping. */
function readProse(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ");
}

/**
 * Every door that shells out to `companion.cjs ask`, discovered from the tree.
 *
 * Boundary — what this catches and what it does not. It matches the literal
 * invocation form every door uses today (`companion.cjs" ask`). It misses at
 * least two realistic spellings: a backslash-continuation that puts `ask` on the
 * next line, and indirection through a shell variable
 * (`COMPANION="…"; node "$COMPANION" ask`). A door written either way is invisible
 * to the cross-check below and gets no failure-instruction pinning at all.
 *
 * The floor guard does NOT backstop that miss, structurally: it asserts
 * `DISCOVERED >= ASK_DOORS.length`, which measures whether the *declared* doors
 * are still findable. An undiscovered door does not decrease DISCOVERED, so the
 * count stays satisfied and the floor stays green. The floor catches a coverage
 * regression on known doors; it is blind to absent coverage of unknown ones —
 * exactly the case the cross-check exists for. Credit it with no more reach
 * than that.
 *
 * DEBT: widening to `/\bcompanion\.cjs\b/` plus a separate `/\bask\b/` would
 * close both spellings, at the cost of false positives on prose that merely
 * mentions the command. That trade (false negatives for false positives, plus
 * the exemption-list churn it implies) is a deliberate call, deferred rather
 * than made reflexively. Revisit when a door is actually written in either form.
 */
const DISCOVERED_ASK_DOORS = DOOR_DIRS.flatMap(listMarkdownFiles).filter((rel) =>
  /companion\.cjs"?\s+ask\b/.test(fs.readFileSync(path.join(repoRoot, rel), "utf-8")),
);

const FAKE = path.join(repoRoot, "tests/fake-codex-cli.mjs");

const cleanup: string[] = [];
test.after(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

function makeTempDir(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(d);
  return d;
}

/**
 * A `sh -c` script that sets umask 022, then execs its arguments. A mode test
 * runs the CLI under it, so a file created without an owner-only mode comes out
 * 0644 and the 0600 assertion fails, whatever the test runner's own umask is.
 */
const UMASK_022_EXEC = 'umask 022; exec "$0" "$@"';

/** A bin dir whose `codex` records its cwd, then execs the fake CLI. */
function makeBin(): string {
  const bin = makeTempDir("harry-ask-bin-");
  const shim = path.join(bin, "codex");
  fs.writeFileSync(
    shim,
    `#!/bin/sh\npwd > "$FAKE_CODEX_CLI_RECORD_DIR/cwd.txt"\nexec "${process.execPath}" "${FAKE}" "$@"\n`,
  );
  fs.chmodSync(shim, 0o755);
  return bin;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  record: string;
  dataDir: string;
  cwd: string;
}

/**
 * Run `ask` in an isolated cwd + state dir. `bin: null` leaves no `codex` on PATH;
 * `systemPath` puts only the system dirs after `bin`, so no other `codex` is reachable.
 * `permissiveUmask` runs the CLI under umask 022 (see {@link UMASK_022_EXEC}).
 */
function runAsk(
  args: string[],
  opts: {
    cwd?: string;
    fake?: Record<string, string>;
    bin?: string | null;
    systemPath?: boolean;
    input?: string;
    permissiveUmask?: boolean;
    /** Reuse a plugin data dir, so runs from one cwd share one `asks/`. */
    dataDir?: string;
  } = {},
): Run {
  const record = makeTempDir("harry-ask-record-");
  const dataDir = opts.dataDir ?? makeTempDir("harry-ask-data-");
  const cwd = opts.cwd ?? makeTempDir("harry-ask-cwd-");
  const bin = opts.bin === undefined ? makeBin() : opts.bin;
  const basePath =
    bin === null || opts.systemPath
      ? ["/usr/bin", "/bin"].join(path.delimiter)
      : (process.env.PATH ?? "");
  const argv = [CLI, "ask", ...args];
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
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, record, dataDir, cwd };
}

function spawned(run: Run): boolean {
  return fs.existsSync(path.join(run.record, "argv.json"));
}

function recordedArgv(run: Run): string[] {
  return JSON.parse(fs.readFileSync(path.join(run.record, "argv.json"), "utf8"));
}

function recordedPrompt(run: Run): string {
  return fs.readFileSync(path.join(run.record, "stdin.txt"), "utf8");
}

function answerPathOf(run: Run): string {
  const argv = recordedArgv(run);
  return argv[argv.indexOf("-o") + 1];
}

function logPathOf(run: Run): string {
  return answerPathOf(run).replace(/\.md$/, ".log");
}

/** Stdout of a failed ask: the marker, a blank line, one reason line. */
function assertFailedStdout(run: Run, reason: RegExp): void {
  assert.notEqual(run.status, 0, "expected a non-zero exit status");
  assert.ok(
    run.stdout.startsWith(`${ASK_FAILED_MARKER}\n\n`),
    `expected stdout to open with "${ASK_FAILED_MARKER}" and a blank line, got:\n${run.stdout}`,
  );
  const rest = run.stdout.slice(`${ASK_FAILED_MARKER}\n\n`.length);
  assert.equal(rest.trimEnd().split("\n").length, 1, `expected one reason line, got:\n${rest}`);
  assert.match(rest, reason);
  // The reason reaches stderr once, as `Ask failed:` — not again as `Fatal error:`,
  // which the doors reserve for argument errors caught before ask runs.
  assert.equal(
    run.stderr.match(/^Ask failed: /gm)?.length,
    1,
    `expected exactly one "Ask failed:" line on stderr, got:\n${run.stderr}`,
  );
  assert.ok(
    !run.stderr.includes(FATAL_ERROR_PREFIX),
    `a failure ask reported must not also print "${FATAL_ERROR_PREFIX}", got:\n${run.stderr}`,
  );
}

/** One file per run: `ask-<YYYYMMDD-HHMMSS>[-N].md`. */
const ASK_FILE_RE = /ask-\d{8}-\d{6}(-\d+)?\.md$/;

/** A credential-shaped transcript line (codex echoing a `.env` it read). Fake value. */
const PLANTED_SECRET = "API_KEY=fake-planted-secret";

// ─── flag surface ───────────────────────────────────────────────────────────

for (const flag of ["--model", "--timeout"]) {
  test(`ask rejects the removed flag ${flag}, naming it, and never spawns codex`, () => {
    const run = runAsk(["hello", flag, "x"]);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, new RegExp(`Unknown flag ${flag}\\b`), run.stderr);
    assert.ok(run.stderr.includes(FATAL_ERROR_PREFIX), run.stderr);
    assert.equal(run.stdout, "", "an argument error prints nothing on stdout");
    assert.ok(!spawned(run), "codex must not be spawned");
  });
}

test("ask --context with no value errors naming the flag", () => {
  const run = runAsk(["hello", "--context", "--reasoning", "high"]);
  assert.notEqual(run.status, 0);
  assert.ok(
    run.stderr.includes(`${FATAL_ERROR_PREFIX} Flag --context requires a value`),
    run.stderr,
  );
  assert.ok(!spawned(run));
});

test("ask --context with an empty value errors naming the flag instead of dropping it", () => {
  for (const args of [
    ["hello", "--context", ""],
    ["hello", "--context", "  "],
    ["hello", "--context="],
  ]) {
    const run = runAsk(args);
    assert.notEqual(run.status, 0, JSON.stringify(args));
    assert.ok(
      run.stderr.includes(
        `${FATAL_ERROR_PREFIX} Flag --context requires a value; got an empty one`,
      ),
      `${JSON.stringify(args)}: ${run.stderr}`,
    );
    assert.equal(run.stdout, "", "an argument error prints nothing on stdout");
    assert.ok(!spawned(run), JSON.stringify(args));
  }
});

test("ask with an empty prompt fails and never spawns codex", () => {
  const run = runAsk(["   "]);
  assertFailedStdout(run, /empty prompt/);
  assert.ok(!spawned(run));
});

// ─── exact spawned argv + prompt ────────────────────────────────────────────

test("ask spawns codex exec read-only and ephemeral, prompt on stdin, no effort override and never -m", () => {
  const run = runAsk(["why", "is", "it", "slow"]);
  assert.equal(run.status, 0, run.stderr);
  const argv = recordedArgv(run);
  assert.deepEqual(argv, [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "-o",
    answerPathOf(run),
    "-",
  ]);
  assert.ok(!argv.includes("-m"));
  assert.equal(recordedPrompt(run), `${ASK_PREAMBLE}\n\nwhy is it slow\n`);
});

test("ask --reasoning adds exactly one TOML-quoted effort override before the stdin marker", () => {
  const run = runAsk(["hello", "--reasoning", "xhigh"]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(recordedArgv(run), [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "-o",
    answerPathOf(run),
    "-c",
    'model_reasoning_effort="xhigh"',
    "-",
  ]);
});

test("ask takes the prompt from --task when there are no positionals", () => {
  const run = runAsk(["--task", "from the flag"]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(recordedPrompt(run), `${ASK_PREAMBLE}\n\nfrom the flag\n`);
});

test("ask runs codex in the invoking cwd, which need not be a git repo", () => {
  const run = runAsk(["hello"]);
  assert.equal(run.status, 0, run.stderr);
  const cwd = fs.readFileSync(path.join(run.record, "cwd.txt"), "utf8").trim();
  assert.equal(fs.realpathSync(cwd), run.cwd);
});

test("ask opens every prompt with the independent-voice preamble", () => {
  // codex exec is an agentic harness in the user's repo; without the framing the
  // model treats the question as a task and explores instead of answering.
  assert.match(ASK_PREAMBLE, /one independent voice/);
  assert.match(ASK_PREAMBLE, /Do not explore the working directory or run commands unless/);
  assert.match(ASK_PREAMBLE, /strongest counter-argument/);
  const run = runAsk(["hello"]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(recordedPrompt(run).startsWith(`${ASK_PREAMBLE}\n\n`), recordedPrompt(run));
});

test("ask --context prepends a Background section, then the prompt under ## Prompt", () => {
  const run = runAsk(["what", "next", "--context", "the cache is intentional"]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    recordedPrompt(run),
    `${ASK_PREAMBLE}\n\n## Background (settled facts from the working session)\n\nthe cache is intentional\n\n## Prompt\n\nwhat next\n`,
  );
});

test("ask --context @file and @- are expanded", () => {
  const ctxFile = path.join(makeTempDir("harry-ask-ctx-"), "ctx.md");
  fs.writeFileSync(ctxFile, "from a file\n");
  const fromFile = runAsk(["q", "--context", `@${ctxFile}`]);
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.match(recordedPrompt(fromFile), /## Background[^\n]*\n\nfrom a file\n\n## Prompt\n\nq\n$/);

  const fromStdin = runAsk(["q", "--context", "@-"], { input: "from stdin\n" });
  assert.equal(fromStdin.status, 0, fromStdin.stderr);
  assert.match(recordedPrompt(fromStdin), /## Background[^\n]*\n\nfrom stdin\n\n## Prompt/);
});

test("ask with an unreadable --context @file fails naming the path and never spawns codex", () => {
  const missing = path.join(makeTempDir("harry-ask-ctx-"), "nope.md");
  const run = runAsk(["q", "--context", `@${missing}`]);
  assertFailedStdout(run, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(!spawned(run), "codex must not be spawned");
});

test("ask with --context @- and nothing on stdin fails naming stdin and never spawns codex", () => {
  const run = runAsk(["q", "--context", "@-"], { input: "" });
  assertFailedStdout(run, /--context .*stdin/);
  assert.ok(!spawned(run), "codex must not be spawned");
});

// ─── pruning asks/ ──────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Set a path's atime and mtime to `ageMs` before now. */
function age(p: string, ageMs: number): void {
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(p, t, t);
}

test("ask prunes its own run files older than 7 days before writing, and nothing else", () => {
  const first = runAsk(["first"]);
  assert.equal(first.status, 0, first.stderr);
  const asks = path.dirname(logPathOf(first));
  assert.equal(path.basename(asks), "asks");
  age(answerPathOf(first), 8 * DAY_MS);
  age(logPathOf(first), 8 * DAY_MS);

  // Named by reserveRunFiles itself, so a change to the run-file name that
  // pruning does not follow fails here rather than silently pruning nothing.
  // Each call claims a stem; its placeholder log is removed so only the files
  // written below exist.
  const names = (prefix: string, day: number): { md: string; log: string } => {
    const r = reserveRunFiles(asks, prefix, new Date(2020, 0, day));
    fs.rmSync(r.logPath);
    return { md: path.basename(r.outputPath), log: path.basename(r.logPath) };
  };
  const jan1 = names("ask", 1);
  const stale = [jan1.md, jan1.log];
  const justStale = names("ask", 2).md;
  const fresh = names("ask", 3).log;
  const dirEntry = names("ask", 4).md;
  // Not harry's run files, or not old enough: all survive.
  const foreign = ["notes.md", "ask-notes.md", names("codex-review", 1).md, "ask-20200101.md"];
  for (const f of [...stale, justStale, ...foreign, fresh]) {
    fs.writeFileSync(path.join(asks, f), "x\n");
  }
  // A -N suffixed stem: reserved while the first stem is taken.
  const suffixed = path.basename(reserveRunFiles(asks, "ask", new Date(2020, 0, 1)).outputPath);
  assert.match(suffixed, /-2\.md$/);
  fs.writeFileSync(path.join(asks, suffixed), "x\n");
  stale.push(suffixed, suffixed.replace(/\.md$/, ".log"));
  fs.mkdirSync(path.join(asks, dirEntry));
  for (const f of [...stale, ...foreign, dirEntry]) age(path.join(asks, f), 30 * DAY_MS);
  age(path.join(asks, justStale), 7 * DAY_MS + 60_000);
  age(path.join(asks, fresh), 7 * DAY_MS - 60_000);

  const second = runAsk(["second"], { cwd: first.cwd, dataDir: first.dataDir });
  assert.equal(second.status, 0, second.stderr);
  const left = new Set(fs.readdirSync(asks));
  for (const f of stale) assert.ok(!left.has(f), `${f} is older than 7 days and must be pruned`);
  assert.ok(!left.has(justStale), `${justStale} is older than 7 days and must be pruned`);
  // The second run may reuse the first run's stem (same second, once it is pruned),
  // so the first run's files are gone when their names are absent or hold a fresh file.
  for (const f of [answerPathOf(first), logPathOf(first)]) {
    const mtime = fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs;
    assert.ok(
      mtime === undefined || Date.now() - mtime < DAY_MS,
      `${f} is older than 7 days and must be pruned`,
    );
  }
  for (const f of [...foreign, fresh, dirEntry]) assert.ok(left.has(f), `${f} must survive`);
  assert.ok(left.has(path.basename(answerPathOf(second))), "this run's answer must survive");
  assert.ok(left.has(path.basename(logPathOf(second))), "this run's log must survive");
});

test("pruneRunFiles never throws: a missing dir or an entry it cannot remove is skipped", {
  skip: process.platform === "win32",
}, () => {
  const missing = path.join(makeTempDir("harry-ask-prune-"), "nope");
  assert.doesNotThrow(() => pruneRunFiles(missing, "ask", 7 * DAY_MS));

  const dir = makeTempDir("harry-ask-prune-");
  const reserved = reserveRunFiles(dir, "ask", new Date(2020, 0, 1));
  fs.rmSync(reserved.logPath);
  const old = reserved.outputPath;
  fs.writeFileSync(old, "x\n");
  age(old, 30 * DAY_MS);
  fs.chmodSync(dir, 0o500); // entries can be listed and stat'ed, not removed
  try {
    assert.doesNotThrow(() => pruneRunFiles(dir, "ask", 7 * DAY_MS));
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  assert.ok(fs.existsSync(old), "the unremovable entry is left in place");
});

// ─── where the answer lands ─────────────────────────────────────────────────

test("ask writes its answer and log under the plugin state dir, never into a .local/", () => {
  const repo = makeTempDir("harry-ask-repo-");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  fs.mkdirSync(path.join(repo, ".local"));
  const run = runAsk(["hello"], { cwd: repo });
  assert.equal(run.status, 0, run.stderr);
  const out = answerPathOf(run);
  assert.ok(out.startsWith(`${run.dataDir}${path.sep}`), `expected under ${run.dataDir}: ${out}`);
  assert.equal(path.basename(path.dirname(out)), "asks");
  assert.match(path.basename(out), ASK_FILE_RE);
  assert.deepEqual(fs.readdirSync(path.join(repo, ".local")), [], "nothing lands in .local/");
});

// ─── success ────────────────────────────────────────────────────────────────

test("ask prints the answer file verbatim on stdout and the log path on stderr", () => {
  const answer = "The three main causes are:\n\n1. locking\n";
  const noise = "codex-session-transcript-noise\n".repeat(50);
  const run = runAsk(["hello there"], {
    fake: { FAKE_CODEX_CLI_REVIEW: answer, FAKE_CODEX_CLI_STDERR: noise },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, answer, "stdout must be exactly the answer file (no codex stdout)");
  assert.ok(run.stderr.includes(`Log: ${logPathOf(run)}`), run.stderr);
  assert.ok(
    !run.stderr.includes("codex-session-transcript-noise"),
    "the transcript stays in the log",
  );
  assert.equal(fs.readFileSync(logPathOf(run), "utf8"), noise);
});

/** A file's permission bits, in octal. */
function modeOf(file: string): string {
  return (fs.statSync(file).mode & 0o777).toString(8);
}

test("ask's run log is owner-only (0600)", { skip: process.platform === "win32" }, () => {
  const ok = runAsk(["hello"], { permissiveUmask: true });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(modeOf(logPathOf(ok)), "600");
  const failed = runAsk(["hello"], { fake: { FAKE_CODEX_CLI_EXIT: "1" }, permissiveUmask: true });
  assert.notEqual(failed.status, 0);
  assert.equal(modeOf(logPathOf(failed)), "600");
});

test("ask's answer file is owner-only (0600) after a successful run", {
  skip: process.platform === "win32",
}, () => {
  const run = runAsk(["hello"], { permissiveUmask: true });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(modeOf(answerPathOf(run)), "600");
});

test("a failed ask's answer file, when codex wrote one, is owner-only (0600) too", {
  skip: process.platform === "win32",
}, () => {
  const cases: Record<string, string>[] = [
    { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_OUTPUT: "always" },
    { FAKE_CODEX_CLI_OUTPUT: "empty" },
  ];
  for (const fake of cases) {
    const run = runAsk(["hello"], { fake, permissiveUmask: true });
    assert.notEqual(run.status, 0, run.stderr);
    assert.ok(fs.existsSync(answerPathOf(run)), `${JSON.stringify(fake)}: no answer file`);
    assert.equal(modeOf(answerPathOf(run)), "600", JSON.stringify(fake));
  }
});

test("ask leaves the failure marker off a successful answer", () => {
  // The marker is a discriminator, so it needs both poles: proving it appears on
  // failure is only half. If it also appeared on success, every door-following
  // consumer would refuse every good answer — and the failure-path tests would
  // still pass.
  const run = runAsk(["hello there"]);
  assert.equal(run.status, 0, `ask failed:\n${run.stderr}`);
  assert.ok(
    !run.stdout.includes(ASK_FAILED_MARKER),
    `a successful ask must not emit the "${ASK_FAILED_MARKER}" marker, got:\n${run.stdout}`,
  );
  assert.ok(
    !run.stderr.includes(FATAL_ERROR_PREFIX),
    `a successful ask must not emit a "${FATAL_ERROR_PREFIX}" line, got:\n${run.stderr}`,
  );
});

// ─── failure ────────────────────────────────────────────────────────────────

test("ask surfaces codex's last ERROR: line as the reason on a non-zero exit", () => {
  const lines = Array.from({ length: 60 }, (_, i) => `transcript line ${i + 1}`);
  lines.push("ERROR: unexpected status 400 Bad Request: first");
  lines.push(PLANTED_SECRET);
  lines.push("ERROR: unexpected status 401 Unauthorized: token expired");
  const run = runAsk(["hello"], {
    fake: { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_STDERR: `${lines.join("\n")}\n` },
  });
  assertFailedStdout(run, /^ERROR: unexpected status 401 Unauthorized: token expired$/m);
  // stderr carries the tail's error lines only, then the log path.
  assert.ok(
    run.stderr.includes(`${lines.at(-3)}\n${lines.at(-1)}\nLog: ${logPathOf(run)}\n`),
    run.stderr,
  );
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
  assert.ok(!run.stderr.includes("transcript line"), run.stderr);
});

test("ask ignores an ERROR: line that scrolled out of the log tail (command output, not codex's)", () => {
  // Early in the transcript an ERROR: line is output of a command the model ran
  // (a grep, a test log), not codex's own closing error.
  const lines = ["exec: grep -rn ERROR: src", "ERROR: from grep output"];
  for (let i = 0; i < 45; i++) lines.push(`transcript line ${i + 1}`);
  const run = runAsk(["hello"], {
    fake: { FAKE_CODEX_CLI_EXIT: "2", FAKE_CODEX_CLI_STDERR: `${lines.join("\n")}\n` },
  });
  assertFailedStdout(run, /codex exec failed \(exit 2\)/);
  assert.ok(!run.stdout.includes("from grep output"), run.stdout);
  assert.ok(!run.stderr.includes("from grep output"), run.stderr);
});

test("ask names the exit code when codex fails without an ERROR: line", () => {
  const run = runAsk(["hello"], {
    fake: {
      FAKE_CODEX_CLI_EXIT: "3",
      FAKE_CODEX_CLI_STDERR: `${PLANTED_SECRET}\nsomething broke\n`,
    },
  });
  assertFailedStdout(run, /codex exec failed \(exit 3\)/);
  assert.ok(run.stderr.includes(`${NO_ERROR_LINE}\nLog: ${logPathOf(run)}\n`), run.stderr);
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
  assert.ok(!run.stderr.includes("something broke"), run.stderr);
});

test("ask never takes an indented error line (file content, not codex's) as its reason or prints it", () => {
  // A JSON or YAML file codex read, echoed indented into its transcript.
  const run = runAsk(["hello"], {
    fake: {
      FAKE_CODEX_CLI_EXIT: "4",
      FAKE_CODEX_CLI_STDERR: `  error: "fake-planted-secret token"\n\tERROR: fake-planted-secret\n`,
    },
  });
  assertFailedStdout(run, /codex exec failed \(exit 4\)/);
  assert.ok(!run.stdout.includes("fake-planted-secret"), run.stdout);
  assert.ok(run.stderr.includes(`${NO_ERROR_LINE}\nLog: ${logPathOf(run)}\n`), run.stderr);
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
});

test("ask's reason splits on a lone CR and carries no control characters", () => {
  // A lone CR must not glue a transcript line onto the reason, and an ANSI
  // sequence must not reach stdout.
  const run = runAsk(["hello"], {
    fake: {
      FAKE_CODEX_CLI_EXIT: "1",
      FAKE_CODEX_CLI_STDERR: `ERROR: \x1b[31mdenied\x1b[0m\r${PLANTED_SECRET}\n`,
    },
  });
  assertFailedStdout(run, /^ERROR: \[31mdenied\[0m$/m);
  assert.ok(!run.stdout.includes("fake-planted-secret"), run.stdout);
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
  assert.doesNotMatch(run.stdout, /[^\P{Cc}\t\n]/u, JSON.stringify(run.stdout));
});

test("ask passes a pre-run `Error:` line to stderr", () => {
  const cause = "Error: model 'nope' is not supported when using Codex with a ChatGPT account";
  const run = runAsk(["hello"], {
    fake: { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_STDERR: `${PLANTED_SECRET}\n${cause}\n` },
  });
  assertFailedStdout(run, /codex exec failed \(exit 1\)/);
  assert.ok(run.stderr.includes(`${cause}\nLog: ${logPathOf(run)}\n`), run.stderr);
  assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
});

test("ask cuts an oversized multibyte ERROR: reason to 1000 bytes of valid UTF-8, on stdout and stderr", () => {
  // 2-, 3- and 4-byte code points, ~5 KB: the cut lands mid-code-point unless it is careful.
  const huge = `ERROR: ${"é€𝄞".repeat(560)}`;
  const run = runAsk(["hello"], {
    fake: { FAKE_CODEX_CLI_EXIT: "1", FAKE_CODEX_CLI_STDERR: `${huge}\n` },
  });
  assertFailedStdout(run, /^ERROR: /m);
  const reason = run.stdout.slice(`${ASK_FAILED_MARKER}\n\n`.length).trimEnd();
  const logLine = run.stderr.split("\n").find((l) => l.startsWith("ERROR: "));
  assert.ok(logLine, run.stderr);
  for (const line of [reason, logLine]) {
    assert.ok(Buffer.byteLength(line) <= 1000, `${Buffer.byteLength(line)} bytes`);
    assert.ok(line.endsWith("…[truncated]"), line.slice(-40));
    assert.ok(!line.includes("�"), "a code point was split");
    assert.ok(huge.startsWith(line.slice(0, -"…[truncated]".length)));
  }
});

for (const mode of ["skip", "empty"] as const) {
  test(`ask fails when codex exits 0 with a ${mode === "skip" ? "missing" : "empty"} answer file`, () => {
    const run = runAsk(["hello"], {
      fake: { FAKE_CODEX_CLI_OUTPUT: mode, FAKE_CODEX_CLI_STDERR: `${PLANTED_SECRET}\n` },
    });
    assertFailedStdout(run, new RegExp(`wrote no answer to ${answerPathOf(run)}`));
    assert.ok(run.stderr.includes(`${NO_ERROR_LINE}\nLog: ${logPathOf(run)}\n`), run.stderr);
    assert.ok(!run.stderr.includes("fake-planted-secret"), run.stderr);
    assert.ok(!run.stdout.includes("fake-planted-secret"), run.stdout);
  });
}

test("ask with codex missing from PATH fails naming the Codex CLI and leaves no log", () => {
  const run = runAsk(["hello"], { bin: null });
  assertFailedStdout(run, /Codex CLI was not found on PATH/);
  const leftovers = fs
    .readdirSync(run.dataDir, { recursive: true })
    .filter((f) => String(f).endsWith(".log"));
  assert.deepEqual(leftovers, [], "a run that never started codex leaves no log behind");
});

test("ask with a codex that cannot be executed (EACCES) fails loudly and leaves no empty log", {
  skip: process.platform === "win32",
}, () => {
  // The only `codex` on PATH is executable, so it resolves, but its `#!`
  // interpreter is not: the spawn itself fails with EACCES. (A non-executable
  // `codex` is never resolved at all — it reports as missing.)
  const bin = makeTempDir("harry-ask-bin-");
  const interp = path.join(bin, "interp");
  fs.writeFileSync(interp, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  fs.writeFileSync(path.join(bin, "codex"), `#!${interp}\nexit 0\n`, { mode: 0o755 });
  const run = runAsk(["hello"], { bin, systemPath: true });
  assertFailedStdout(run, /EACCES/);
  const leftovers = fs
    .readdirSync(run.dataDir, { recursive: true })
    .filter((f) => String(f).endsWith(".log"));
  assert.deepEqual(leftovers, [], "a spawn that never ran codex leaves no log behind");
});

test("every door that tells a consumer to trust ask's stdout quotes the failure signals", () => {
  // Live prose↔code contract, the same shape as tests/review-cli.test.ts's
  // `Review written to` door guard. Each door instructs consumers to return ask's stdout verbatim and
  // names these signals as the reasons not to. The signals are declared once
  // above and asserted against the LIVE CLI by the tests above, so renaming one
  // in src/ fails there and rewording any single door fails here — neither side
  // can move alone.
  for (const { path: door, quotes, prohibition } of ASK_DOORS) {
    const prose = readProse(door);
    for (const signal of quotes) {
      assert.ok(
        prose.includes(signal),
        `${door} no longer carries "${signal}". That door is now stale: its ` +
          `failure instructions no longer match what ask actually emits, so a ` +
          `consumer following them will misjudge a run — relaying a failed body, ` +
          `or rejecting a good one.`,
      );
    }
    // Quoting the signal is not enough — the door must also tell the consumer
    // NOT to relay the body. A door can name the marker and still say "ignore
    // it and return the body verbatim", which is worse than silence.
    //
    // Two blind spots, accepted as the ceiling of any substring prose check
    // rather than fixed. Positional: this asks whether the FILE contains the
    // fragment, not whether the paragraph naming the signal does — so deleting
    // the prohibition from the failure paragraph and using the same words
    // elsewhere (debate.md is ~168 lines) still passes. Collapse: readProse
    // flattens whitespace, so a fragment split across a sentence that inverts
    // the meaning ("never present as an answer? No: return the body regardless")
    // satisfies includes() while instructing the opposite. Both take deliberate
    // effort to construct; the natural inversion — rewording the bullet to say
    // "ignore it" — is caught, which is what this check is for.
    assert.ok(
      prose.includes(prohibition),
      `${door} quotes ask's failure signals but no longer prohibits relaying the body ` +
        `("${prohibition}"). Naming a signal without a directive leaves the consumer free to present it as the answer.`,
    );
    assert.ok(
      !prose.includes(PHANTOM_STATUS_GUARD),
      `${door} has regrown the phantom status guard ("${PHANTOM_STATUS_GUARD}"). ` +
        `ask has no JSON mode and no status field, so that instruction can never fire.`,
    );
  }
});

test("every discovered ask-invoking door is declared in ASK_DOORS or explicitly exempt", () => {
  // Keeps the hand-maintained list above honest: a new door that shells out to
  // `ask` must be classified, not silently skipped. A derived list that matches
  // nothing would be worse than no list, so pin the floor first.
  assert.ok(
    DISCOVERED_ASK_DOORS.length >= ASK_DOORS.length,
    `door discovery matched only ${DISCOVERED_ASK_DOORS.length} file(s) but ${ASK_DOORS.length} are declared — ` +
      `the invocation pattern has drifted and this guard is now vacuous.`,
  );

  for (const door of DISCOVERED_ASK_DOORS) {
    const declared =
      ASK_DOORS.some((d) => d.path === door) || ASK_DOORS_EXEMPT.some((e) => e.path === door);
    assert.ok(
      declared,
      `${door} invokes \`ask\` but is not in ASK_DOORS. Either it relays stdout verbatim ` +
        `(add it to ASK_DOORS so its failure instructions are pinned), or it does not ` +
        `(add it to ASK_DOORS_EXEMPT with a reason).`,
    );
  }
});
