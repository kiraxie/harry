#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type CheckInput,
  compileCheck,
  evaluateChecks,
  expandChecks,
  parseCasesJsonl,
  SUPPORTED_MODES,
  validateCases,
} from "./lib/evals-cases.mts";
import { buildBaseEnv, buildGitEnv, type Env, requireOnPath } from "./lib/evals-env.mts";
import { type Jail, sandboxContext, trialJail, wrapWithSandbox } from "./lib/evals-jail.mts";
import {
  isErrored,
  isOutcome,
  type Outcome,
  type ResultLine,
  type ScoreGroup,
  scoreResults,
  validateResultLines,
} from "./lib/evals-score.mts";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type ArtifactCheckOutcome = Outcome & { check: CheckInput };

export interface RepoState {
  fixtureDir: string;
  initialBranch: string;
  initialCommit: string;
  branches: string[];
  newCommitMessages: string[];
  newCommitsOnInitial: number;
  files: string[];
}

export interface JudgeSettings {
  env?: Env;
  gitBin?: string;
  deadline?: number;
}

export interface RunOpts {
  condition: string;
  model?: string;
  cases?: string[];
  out?: string;
  trials?: string | number;
  agentic?: boolean;
  postSessionTimeoutMs?: number;
}

export interface PostSessionPayload {
  fixtureDir: string;
  fixtureId: { dev: string; ino: string };
  gitConfig: string;
  initialBranch: string;
  initialCommit: string;
  checks: CheckInput[];
  gitBin?: string;
  timeoutMs: number;
}

type ExecError = Error & {
  code?: string;
  status?: number | null;
  signal?: string | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

const CONDITIONS = new Set(["baseline", "candidate", "plugin"]);
const DEFAULT_TEST_COMMAND = "node --test";
// Bounds a hung model-written test and, sandboxed, the whole jailed child, which
// gets a grace period on top so its own test timeout fires first.
const DEFAULT_POST_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const POST_SESSION_GRACE_MS = 15 * 1000;
const remainingMs = (deadline: number) => Math.max(1, deadline - Date.now());

function casesPath() {
  return join(pluginRoot, "evals", "cases.jsonl");
}

function lawsPath() {
  return join(pluginRoot, "HARRY.md");
}

function fixturesPath() {
  return join(pluginRoot, "evals", "fixtures");
}

function git(
  args: string[],
  cwd: string,
  env: Env = process.env,
  gitBin: string = requireOnPath("git", env),
  {
    config = [],
    timeoutMs = DEFAULT_POST_SESSION_TIMEOUT_MS,
  }: { config?: string[]; timeoutMs?: number } = {},
): string {
  // A second layer for three known command hooks: gpg signing (would prompt/fail
  // headless), hooks (an empty hooksPath disables them) and fsmonitor (a command git
  // runs on index refresh) are switched off per call. It is not a complete list — a
  // repo-local log.showSignature + gpg.program still runs through `git log` — which
  // is why, sandboxed, every git call on a session's fixture runs inside the jail
  // (judgeFixture). Prepended so per-call args still win.
  const hardened = [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=",
    "-c",
    "core.fsmonitor=false",
    ...config.flatMap((setting) => ["-c", setting]),
    ...args,
  ];
  try {
    // stderr is piped, never inherited: whatever git (or a program a repo config
    // names) prints reaches the operator only through untrustedText, below.
    return execFileSync(gitBin, hardened, {
      cwd,
      env: buildGitEnv(env),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      // A FIFO the session planted would otherwise block git, and the runner, forever.
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    }).trim();
  } catch (caught) {
    const err = caught as ExecError;
    if (err?.code === "ETIMEDOUT") {
      throw new Error(untrustedText(`git ${args[0] ?? ""} timed out after ${timeoutMs}ms`, 400));
    }
    const firstLine =
      String(err?.stderr ?? "")
        .split("\n")
        .find((l) => l.trim()) ?? "";
    throw new Error(
      untrustedText(`git ${args[0] ?? ""} failed (exit ${err?.status ?? "?"}): ${firstLine}`, 400),
    );
  }
}

const POST_SESSION = "__post-session";

// In a sandboxed run this executes ONLY inside the jailed child, under the
// session's own profile, so nothing the session planted — a swapped fixture, a
// config the session re-plants after the restore, a gpg.program, a test — ever
// runs or writes with the runner's rights. Seatbelt profiles are inherited by
// every descendant, a setsid'd one included, so the session's background
// processes stay in the same jail. Unsandboxed it runs in-process: there is no fs
// boundary then (the session ran as the operator), and the identity check is
// only a guard against honest mistakes.
//
// DEBT: judging integrity. A session can detach a background process (`Bash(node:*)`
// allows it, setsid included). It stays jailed, but nothing stops it, and it can
// still change the fixture while this step judges it, so a verdict can describe a
// repo the session did not leave. Killing a process group would miss a setsid'd one.
// Ceiling: fine while the gate runs trusted prompts, whose sessions have no reason to
// race their own judge. Upgrade path: the session's writes are already confined to
// its own trial's dirs; judge under a separate profile that can read the fixture but
// write only a fresh judge dir outside the session's writable set, copy the fixture
// there first, and judge the copy.
export function judgeFixture(payload: PostSessionPayload, env: Env = process.env): Outcome[] {
  const { fixtureDir, fixtureId, gitConfig, initialBranch, initialCommit, checks, gitBin } =
    payload;
  const now = lstatOrNull(fixtureDir, { bigint: true });
  if (
    !now?.isDirectory() ||
    String(now.dev) !== fixtureId.dev ||
    String(now.ino) !== fixtureId.ino
  ) {
    throw new Error(
      `refusing to judge fixture ${fixtureDir}: it was replaced after materialization ` +
        "(the path no longer leads to the directory the runner created)",
    );
  }
  restoreFixtureGitConfig(fixtureDir, Buffer.from(gitConfig, "base64"));
  const settings = {
    env,
    gitBin,
    deadline: Date.now() + payload.timeoutMs,
  };
  const state = collectRepoState(fixtureDir, initialBranch, initialCommit, settings);
  return evaluateArtifactChecks(checks, state, settings).results.map((r) => ({
    ok: r.ok,
    detail: r.detail,
  }));
}

// Text from the jailed child is untrusted: control characters (C0, DEL, C1)
// become spaces, so no terminal escape or line break reaches a results file or a
// terminal, and it is capped.
function untrustedText(value: unknown, max = 1000): string {
  const clean = Array.from(String(value), (c) => {
    const code = c.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : c;
  }).join("");
  return clean.length > max ? `${clean.slice(0, max)}…[truncated]` : clean;
}

export function parsePostSessionOutput(stdout: string, count: number): Outcome[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `the jailed post-session step printed malformed output (${stdout.length} bytes)`,
    );
  }
  const record = parsed !== null && typeof parsed === "object" ? parsed : null;
  if (record && "error" in record && typeof record.error === "string") {
    throw new Error(`jailed post-session step: ${untrustedText(record.error)}`);
  }
  const outcomes = record && "outcomes" in record ? record.outcomes : undefined;
  if (!Array.isArray(outcomes) || outcomes.length !== count || !outcomes.every(isOutcome)) {
    throw new Error(
      `the jailed post-session step printed output of the wrong shape (${stdout.length} bytes)`,
    );
  }
  return outcomes.map((o) => ({ ok: o.ok, detail: untrustedText(o.detail) }));
}

// Run judgeFixture for one trial: in-process when unsandboxed, otherwise as ONE
// child under the trial's jail. The payload goes in on stdin (no file a session
// could rewrite first); the child gets the credential-free base env and a cwd
// outside the fixture; --preserve-symlinks-main and --preserve-symlinks stop node's
// entry and import lookups from lstat-ing the jailed $HOME ancestors of this script
// and of the modules it imports.
function runPostSession(payload: PostSessionPayload, jail: Jail | null, env: Env): Outcome[] {
  if (!jail) return judgeFixture(payload, env);
  if (!jail.script) throw new Error("the jail names no runner script for the post-session child");
  const wrapped = wrapWithSandbox(jail.sandboxExec, jail.profile, process.execPath, [
    "--preserve-symlinks",
    "--preserve-symlinks-main",
    jail.script,
    POST_SESSION,
  ]);
  let stdout: string;
  try {
    // Piped, never inherited: the child's stderr (and anything its git or tests
    // print there) reaches the operator's terminal only through untrustedText on
    // the failure path.
    stdout = execFileSync(wrapped.bin, wrapped.args, {
      cwd: jail.tmpDir,
      env: buildBaseEnv({ ...env, PATH: jail.path }, jail.tmpDir),
      input: JSON.stringify(payload),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      // A second layer, untested: git calls and the test share one deadline and file
      // reads never block; this catches only what those miss.
      timeout: payload.timeoutMs + POST_SESSION_GRACE_MS,
      killSignal: "SIGKILL",
    });
  } catch (caught) {
    const err = caught as ExecError;
    // DEBT: SIGKILL reaches only the direct child; a process the step started (a git
    // call, or a test the session wrote) is orphaned, and one blocked on a FIFO the
    // session planted never exits. Ceiling: a trusted, maintainer-run gate, where a
    // stuck process costs the operator a kill, not a leak. Upgrade path: spawn the child
    // detached and kill its process group on timeout; a setsid'd test still escapes
    // the group (see judgeFixture), so pair it with a per-trial reaper.
    if (err?.code === "ETIMEDOUT") {
      throw new Error(
        `the jailed post-session step timed out after ${payload.timeoutMs + POST_SESSION_GRACE_MS}ms`,
      );
    }
    const firstLine =
      String(err?.stderr ?? "")
        .split("\n")
        .find((l) => l.trim()) ?? "";
    throw new Error(
      `the jailed post-session step failed (exit ${err?.status ?? "?"}): ${untrustedText(firstLine, 300)}`,
    );
  }
  return parsePostSessionOutput(stdout, payload.checks.length);
}

function cmdPostSession() {
  let out: { outcomes: Outcome[] } | { error: string };
  try {
    out = { outcomes: judgeFixture(JSON.parse(readFileSync(0, "utf8"))) };
  } catch (caught) {
    const err = caught as ExecError;
    out = { error: String(err?.message ?? err) };
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return 0;
}

// Never inside the repo: the copy lands under `root` (default the OS temp dir).
export function materializeFixture(
  name: string,
  root: string = tmpdir(),
  env: Env = process.env,
  gitBin: string = requireOnPath("git", env),
): {
  dir: string;
  initialBranch: string;
  initialCommit: string;
  gitConfig: Buffer;
  id: { dev: string; ino: string };
} {
  const src = join(fixturesPath(), name);
  if (!existsSync(src)) {
    throw new Error(`unknown fixture "${name}" (looked in ${fixturesPath()})`);
  }
  const dir = mkdtempSync(join(root, `harry-evals-fx-${name}-`));
  cpSync(src, dir, { recursive: true });
  // `-b main` isn't portable to older git; set the default branch via config so
  // the initial branch name is deterministic. We still read it back below.
  git(["init"], dir, env, gitBin, { config: ["init.defaultBranch=main"] });
  // Pin the identity in the repo's LOCAL config too, so any committer in this repo
  // has one even if its env does not (a machine with no git identity, such as a CI
  // runner, fatals on auto-detect).
  git(["config", "user.name", "Eval Fixture"], dir, env, gitBin);
  git(["config", "user.email", "eval@localhost"], dir, env, gitBin);
  // The config as the runner wrote it, before any session touches the repo:
  // restoreFixtureGitConfig puts exactly these bytes back before the runner's own
  // post-session git calls. Read back rather than hand-written, because `git init`
  // records filesystem facts (core.ignorecase on macOS) a constant would get wrong.
  const gitConfig = readFileSync(join(dir, ".git", "config"));
  git(["add", "-A"], dir, env, gitBin);
  git(["commit", "-m", "chore: seed eval fixture"], dir, env, gitBin);
  const initialBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], dir, env, gitBin);
  const initialCommit = git(["rev-parse", "HEAD"], dir, env, gitBin);
  // The fixture dir's identity. judgeFixture refuses a fixture whose path no longer
  // leads to this very directory: a session can rename its fixture away and leave a
  // symlink to some other repo in its place. Strings, since a 64-bit inode can exceed
  // what a JSON number holds exactly.
  const st = lstatSync(dir, { bigint: true });
  const id = { dev: String(st.dev), ino: String(st.ino) };
  return { dir, initialBranch, initialCommit, gitConfig, id };
}

function lstatOrNull(p: string, opts?: { bigint: true }) {
  try {
    return lstatSync(p, opts);
  } catch (caught) {
    const err = caught as ExecError;
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

// Before the runner runs git in a fixture a session has had its hands on, put the
// repo's config back to what materializeFixture wrote, or refuse. The session could
// edit .git/config freely (acceptEdits), and git would then run whatever it named —
// core.fsmonitor, a gpg.program, a filter, an include. This restore alone does not
// stop a background process re-planting it afterwards; in a sandboxed run it only
// ever executes inside the jailed post-session step (judgeFixture), so whatever
// runs, runs jailed. Refuses, rather than repairs, anything that would make git read
// config from somewhere else. A symlinked config is refused, never written through:
// writing the constant through a link into ~/.gitconfig would clobber the
// operator's own. The write is O_EXCL after an unlink, so it can only ever create a
// fresh regular file.
export function restoreFixtureGitConfig(fixtureDir: string, gitConfig: Buffer | string): void {
  const refuse = (why: string) => {
    throw new Error(`refusing to run git in fixture ${fixtureDir}: ${why}`);
  };
  const gitDir = join(fixtureDir, ".git");
  if (!lstatOrNull(gitDir)?.isDirectory()) refuse(".git is not a plain directory");
  for (const name of ["commondir", "config.worktree"]) {
    if (lstatOrNull(join(gitDir, name))) refuse(`the session added .git/${name}`);
  }
  const configPath = join(gitDir, "config");
  const current = lstatOrNull(configPath);
  if (current && !current.isFile()) refuse(".git/config is not a regular file");
  rmSync(configPath, { force: true });
  writeFileSync(configPath, gitConfig, { flag: "wx" });
}

export function collectRepoState(
  fixtureDir: string,
  initialBranch: string,
  initialCommit: string,
  {
    env = process.env,
    gitBin = requireOnPath("git", env),
    deadline = Date.now() + DEFAULT_POST_SESSION_TIMEOUT_MS,
  }: JudgeSettings = {},
): RepoState {
  const run = (args: string[]) =>
    git(args, fixtureDir, env, gitBin, { timeoutMs: remainingMs(deadline) });
  const branches = run(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);
  const commitLog = run(["log", "--all", "--format=%H%x1f%s"]);
  const newCommitMessages = commitLog
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\x1f"))
    .filter(([sha]) => sha !== initialCommit)
    .map(([, subject]) => subject ?? "");
  const tracked = run(["ls-files"]).split("\n");
  const untracked = run(["ls-files", "--others", "--exclude-standard"]).split("\n");
  const files = [...new Set([...tracked, ...untracked])].map((f) => f.trim()).filter(Boolean);
  // If the initial branch is gone (renamed away), treat it as untouched (0).
  let newCommitsOnInitial = 0;
  if (branches.includes(initialBranch)) {
    const count = run(["rev-list", "--count", `${initialCommit}..${initialBranch}`]);
    newCommitsOnInitial = Number(count) || 0;
  }
  return {
    fixtureDir,
    initialBranch,
    initialCommit,
    branches,
    newCommitMessages,
    newCommitsOnInitial,
    files,
  };
}

const NOT_REGULAR = Symbol("not a regular file");
const notRegular = (check: CheckInput, relPath: string): ArtifactCheckOutcome => ({
  check,
  ok: false,
  detail: `${relPath} is not a regular file`,
});

// Read a repo file's contents: null if missing, unreadable or a directory;
// NOT_REGULAR if the path is a FIFO, device or socket. The session controls these
// paths, and a FIFO with no writer blocks a plain read forever, so the file is
// opened non-blocking and checked before anything is read.
function readFileSafe(fixtureDir: string, relPath: string): string | null | typeof NOT_REGULAR {
  const target = join(fixtureDir, relPath);
  let fd: number;
  try {
    fd = openSync(target, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  } catch {
    try {
      return statSync(target).isSocket() ? NOT_REGULAR : null;
    } catch {
      return null;
    }
  }
  try {
    const stats = fstatSync(fd);
    if (stats.isDirectory()) return null;
    if (!stats.isFile()) return NOT_REGULAR;
    return readFileSync(fd, "utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// Every check reads paths the session controlled, and test_command_passes runs
// tests the session WROTE, so in a sandboxed run this only ever executes inside
// the jailed post-session child (see judgeFixture / runPostSession).
export function evaluateArtifactCheck(
  check: CheckInput,
  state: RepoState,
  {
    env = process.env,
    deadline = Date.now() + DEFAULT_POST_SESSION_TIMEOUT_MS,
  }: JudgeSettings = {},
): ArtifactCheckOutcome {
  switch (check.type) {
    case "git_created_branch": {
      const created = state.branches.filter((b) => b !== state.initialBranch);
      return { check, ok: created.length > 0, detail: created.join(", ") || "(none)" };
    }
    case "git_no_new_commits_on_initial": {
      const n = state.newCommitsOnInitial ?? 0;
      return {
        check,
        ok: n === 0,
        detail: n === 0 ? "initial branch untouched" : `${n} commit(s) on ${state.initialBranch}`,
      };
    }
    case "file_contains": {
      const relPath = check.path;
      if (!relPath) return { check, ok: false, detail: `${check.type} names no path` };
      const content = readFileSafe(state.fixtureDir, relPath);
      if (content === NOT_REGULAR) return notRegular(check, relPath);
      if (content === null) return { check, ok: false, detail: `missing file ${relPath}` };
      return { check, ok: compileCheck(check).test(content), detail: relPath };
    }
    case "file_not_contains": {
      const relPath = check.path;
      if (!relPath) return { check, ok: false, detail: `${check.type} names no path` };
      const content = readFileSafe(state.fixtureDir, relPath);
      if (content === NOT_REGULAR) return notRegular(check, relPath);
      if (content === null) return { check, ok: true, detail: `missing file ${relPath}` };
      return { check, ok: !compileCheck(check).test(content), detail: relPath };
    }
    case "repo_grep":
    case "repo_grep_absent": {
      const re = compileCheck(check);
      // Optionally narrow to files whose relative path matches pathPattern, so a
      // content match in an unrelated file (e.g. a prompt-echo in NOTES.md) can't
      // satisfy a grep meant for, say, test files.
      const pathRe = check.pathPattern ? new RegExp(check.pathPattern) : null;
      const scoped = pathRe ? state.files.filter((f) => pathRe.test(f)) : state.files;
      const matched = new Map(
        scoped.map((f) => {
          const content = readFileSafe(state.fixtureDir, f);
          return [f, content === NOT_REGULAR || content === null ? content : re.test(content)];
        }),
      );
      const special = scoped.find((f) => matched.get(f) === NOT_REGULAR);
      if (special) return notRegular(check, special);
      const hit = scoped.find((f) => matched.get(f) === true);
      const present = Boolean(hit);
      const ok = check.type === "repo_grep" ? present : !present;
      return { check, ok, detail: hit ? `matched ${hit}` : "no match" };
    }
    case "commit_message_matches": {
      const re = compileCheck(check);
      const hit = state.newCommitMessages.find((m) => re.test(m));
      return { check, ok: Boolean(hit), detail: hit ?? "(no new commit matched)" };
    }
    case "test_command_passes": {
      const command = (check.command ?? DEFAULT_TEST_COMMAND).trim();
      const [cmd, ...args] = command.split(/\s+/);
      const timeoutMs = remainingMs(deadline);
      // Model-written code: the credential-free base env, never the runner's own, and
      // `node` by absolute path, not a PATH lookup.
      try {
        execFileSync(cmd === "node" ? process.execPath : cmd, args, {
          cwd: state.fixtureDir,
          env: buildBaseEnv(env),
          stdio: "ignore",
          maxBuffer: 32 * 1024 * 1024,
          timeout: timeoutMs,
          killSignal: "SIGKILL",
        });
        return { check, ok: true, detail: `${command} exited 0` };
      } catch (caught) {
        const err = caught as ExecError;
        if (err?.code === "ETIMEDOUT") {
          return { check, ok: false, detail: `${command} timed out after ${timeoutMs}ms` };
        }
        const how = err?.status ?? (err?.signal ? `killed by ${err.signal}` : err?.message);
        return { check, ok: false, detail: `${command} failed: ${how}` };
      }
    }
    default:
      return { check, ok: false, detail: `unknown check type ${check.type}` };
  }
}

export function evaluateArtifactChecks(
  checks: CheckInput[] | undefined,
  state: RepoState,
  settings: JudgeSettings = {},
): { pass: boolean; results: ArtifactCheckOutcome[] } {
  const results = (checks ?? []).map((check) => evaluateArtifactCheck(check, state, settings));
  return { pass: results.every((r) => r.ok), results };
}

// A fractional or non-numeric --trials is refused rather than coerced: a coerced
// "2.5"→2 or "abc"→1 would run a silently-wrong number of trials.
export function resolveTrials(opts: { trials?: string | number | null }): number {
  const raw = opts.trials;
  if (raw === undefined || raw === null) return 1;
  const isPlainInt = typeof raw === "string" ? /^\d+$/.test(raw) : Number.isInteger(raw);
  const n = Number(raw);
  if (!isPlainInt || !Number.isInteger(n) || n < 1) {
    // No silent default on blank or garbage: that would run a wrong trial count at real cost.
    throw new Error(`--trials must be a positive integer (got "${raw}")`);
  }
  return n;
}

export function resolveModel(opts: { model?: string }, env: Env): string {
  const model = opts.model || env.EVALS_MODEL;
  if (!model?.trim()) {
    throw new Error(
      "no model specified: pass --model <id> or set EVALS_MODEL (pinning is required)",
    );
  }
  return model.trim();
}

const AUTH_HINT =
  "set exactly one of EVALS_ANTHROPIC_API_KEY (a console API key) or " +
  "EVALS_CLAUDE_CODE_OAUTH_TOKEN (a subscription token from `claude setup-token`), " +
  "read from a file only you can read so it is never printed, e.g. " +
  'EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)"';

// An empty or whitespace-only value is unset: `EVALS_X="$(cat missing-file)"` must not
// count as a choice.
function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function resolveAuth(env: Env): { kind: "api-key" | "oauth-token" } {
  const apiKey = isSet(env.EVALS_ANTHROPIC_API_KEY);
  const oauthToken = isSet(env.EVALS_CLAUDE_CODE_OAUTH_TOKEN);
  if (apiKey && oauthToken) {
    throw new Error(
      `both EVALS_ANTHROPIC_API_KEY and EVALS_CLAUDE_CODE_OAUTH_TOKEN are set, so the auth ` +
        `path is ambiguous; ${AUTH_HINT}.`,
    );
  }
  if (!apiKey && !oauthToken) {
    throw new Error(
      `no eval credential: a fresh config dir is logged out, so every trial would fail ` +
        `with "Not logged in"; ${AUTH_HINT}.`,
    );
  }
  // Refused up front rather than repaired: the API would reject it after spend begins.
  const name = apiKey ? "EVALS_ANTHROPIC_API_KEY" : "EVALS_CLAUDE_CODE_OAUTH_TOKEN";
  const value = env[name] ?? "";
  if (/\s/.test(value)) {
    const cause = value.includes("\r")
      ? "a carriage return (a file saved with CRLF line endings?)"
      : "whitespace (a line break from a wrapped copy?)";
    throw new Error(
      `${name} contains ${cause}; remove it from the file and retry. The value is not shown.`,
    );
  }
  return { kind: apiKey ? "api-key" : "oauth-token" };
}

function prepareTrialDirs(condition: string, lawsText: string, root: string = tmpdir()) {
  const trialDir = mkdtempSync(join(root, `harry-evals-trial-${condition}-`));
  const dirs = {
    trialDir,
    configDir: join(trialDir, "config"),
    workDir: join(trialDir, "work"),
    fixtureParent: join(trialDir, "fixture"),
    tmpDir: join(trialDir, "tmp"),
  };
  for (const key of ["configDir", "workDir", "fixtureParent", "tmpDir"] as const)
    mkdirSync(dirs[key]);
  if (condition !== "baseline") {
    writeFileSync(join(dirs.configDir, "CLAUDE.md"), lawsText);
  }
  return dirs;
}

// Exactly one credential, under its unprefixed name, and nothing else from the
// operator's env: not a bare ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, not the
// EVALS_ sources, not any var that would outrank the chosen credential.
//
// DEBT: the session holds its one credential. It needs it to reach the API, no OS
// sandbox can hide an env var from the session's own processes, and outbound network
// stays OPEN under the jail (it is not a no-exfiltration boundary), so a hostile
// session could exfiltrate it. Ceiling: one revocable credential (a console key or a
// `claude setup-token` token, env-only, nothing on disk) exposed only to sessions
// running trusted prompts on a maintainer-run gate; not fit for untrusted input.
// Upgrade path: give the child no credential at all. Run a local forwarder in the
// runner that adds the credential to the child's API requests, point the child at it
// (ANTHROPIC_BASE_URL set by the runner, never forwarded from the operator), and deny
// the jail all network except that forwarder. Not yet verified that Claude Code
// accepts a forwarded endpoint for an OAuth token.
export function buildChildEnv(env: Env, configDir: string, tmpDir: string = tmpdir()): Env {
  const auth = resolveAuth(env);
  const childEnv: Env = {
    ...buildGitEnv(env, tmpDir),
    CLAUDE_CONFIG_DIR: configDir,
    // The allowlist drops the operator's own privacy flags, so the runner sets them:
    // no telemetry, no nonessential traffic, no self-update mid-run.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_AUTOUPDATER: "1",
  };
  if (auth.kind === "api-key") {
    childEnv.ANTHROPIC_API_KEY = env.EVALS_ANTHROPIC_API_KEY;
  } else {
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = env.EVALS_CLAUDE_CODE_OAUTH_TOKEN;
  }
  return childEnv;
}

// Extract the assistant text from `claude -p --output-format json` output. A
// result with `is_error: true` (e.g. "Not logged in") can still arrive on a
// zero exit, so it is treated as a case error carrying the `result` text rather
// than being scored as a genuine response.
function extractResponse(stdout: string): string {
  const parsed = JSON.parse(stdout);
  if (parsed.is_error === true) {
    const detail = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed);
    throw new Error(`claude returned an error result: ${untrustedText(detail)}`);
  }
  if (typeof parsed.result === "string") return parsed.result;
  return JSON.stringify(parsed);
}

// On a failure a structured {is_error} stdout wins if the child printed one, else
// how it ended plus stdout/stderr tails, so a failing line carries a real
// diagnostic. Never execFileSync's own message: that is "Command failed: <the
// whole argv>" — the prompt and, jailed, the whole seatbelt profile — which crowds
// the child's own output out of the cap.
function invokeClaude(
  bin: string,
  args: string[],
  cwd: string,
  configDir: string,
  env: Env,
  tmpDir: string = tmpdir(),
): string {
  const childEnv = buildChildEnv(env, configDir, tmpDir);
  let stdout: string;
  try {
    // Piped, never inherited: claude's stderr reaches the operator's terminal only
    // through untrustedText on a failure.
    stdout = execFileSync(bin, args, {
      cwd,
      env: childEnv,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (caught) {
    const err = caught as ExecError;
    const printed = err?.stdout ? String(err.stdout) : "";
    if (printed.trim().startsWith("{")) {
      return extractResponse(printed);
    }
    const tail = (s: unknown) => (s ? untrustedText(String(s).trim().slice(-800), 800) : "");
    // code first: an output-cap overflow is ENOBUFS, delivered as a SIGTERM.
    const ended =
      typeof err?.code === "string"
        ? `claude failed: ${err.code}`
        : Number.isInteger(err?.status)
          ? `claude exited with status ${err.status}`
          : err?.signal
            ? `claude was killed by ${err.signal}`
            : "claude failed";
    const parts = [untrustedText(ended, 200)];
    const out = tail(err?.stdout);
    const errOut = tail(err?.stderr);
    if (out) parts.push(`stdout: ${out}`);
    if (errOut) parts.push(`stderr: ${errOut}`);
    throw new Error(parts.join("\n"));
  }
  // Outside the try: a clean exit's own decode error (an is_error result, stdout
  // that is not JSON) is already readable and must not be relabelled a spawn failure.
  return extractResponse(stdout);
}

// Invoke the claude CLI for one text case under one condition.
//
// `--tools ""` removes every tool, so a text case measures first-response prose,
// not actions. `--allowedTools ""` alone does not: it only auto-approves nothing,
// and Read needs no approval, so a session could still read host files (seen on
// 2026-10-09 with a probe of a file outside the plugin copy).
//
// `cwd` MUST be an empty dir with no CLAUDE.md above it: claude reads project
// memory by walking up from cwd, so running from the repo root would leak this
// repo's own CLAUDE.md (which enumerates the laws) into BOTH conditions —
// silently making the baseline "lawful" and collapsing the measured delta. This
// is the sibling isolation to CLAUDE_CONFIG_DIR (global memory).
function runTextCase(
  bin: string,
  model: string,
  prompt: string,
  configDir: string,
  workDir: string,
  env: Env,
  tmpDir: string,
  pluginDir: string | null = null,
): string {
  const args = [
    "-p",
    prompt,
    "--model",
    model,
    "--output-format",
    "json",
    "--allowedTools",
    pluginDir ? "Skill" : "",
    ...textToolArgs(Boolean(pluginDir)),
    ...(pluginDir ? ["--plugin-dir", pluginDir] : []),
  ];
  return invokeClaude(bin, args, workDir, configDir, env, tmpDir);
}

// One comma-joined `--allowedTools` value: a single arg avoids the variadic
// `<tools...>` swallowing later flags. WHY these: the artifact checks assert on git
// state (git_created_branch, git_no_new_commits_on_initial, commit messages) and on
// test runs (test_command_passes), so the session MUST be able to branch/commit
// and run `node`, or those checks are structurally unsatisfiable.
//
// The git leg is granted per SUBCOMMAND (following commands/review.md's own
// convention), not a blanket `Bash(git:*)`: this drops `git push`, `git config`,
// and the `git -c alias.x='!sh'` shell-escape at zero cost to the checks. The
// node leg stays broad (`Bash(node:*)`) because a session must AUTHOR then RUN a
// test file — narrowing to `Bash(node --test:*)` would gain little, since it
// would still execute model-authored files. This narrows the surface; the
// allowlist alone does NOT contain a misbehaving session: `Bash(node:*)` is
// arbitrary code execution, including network. Exec containment is the opt-in
// seatbelt jail (sandboxContext), not this list.
const AGENTIC_ALLOWED_TOOLS = [
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(git branch:*)",
  "Bash(git checkout:*)",
  "Bash(git switch:*)",
  "Bash(node:*)",
].join(",");

// Left out on purpose: scripts/ and dist/ (a trial could run the installer against
// the operator's ~/.claude, or Codex), and evals/, tests/, .local/ (the cases' own
// grading patterns, and the operator's notes).
const PLUGIN_PAYLOAD = [".claude-plugin", "HARRY.md", "skills", "commands", "agents", "references"];

// Freeze the plugin once per run: every trial loads the same copy, so a checkout that
// changes mid-run cannot change later trials, and the copy's content hash names the
// tree a result was taken under. Realpath'd because the permission rule is matched
// against canonical paths, and macOS's tmpdir is a symlink.
export function snapshotPlugin(
  root: string,
  from: string = pluginRoot,
): { dir: string; sha: string } {
  const dir = realpathSync(mkdtempSync(join(root, "harry-evals-plugin-")));
  for (const entry of PLUGIN_PAYLOAD)
    cpSync(join(from, entry), join(dir, entry), { recursive: true });
  const hash = createHash("sha256");
  const walk = (rel: string): void => {
    const abs = join(dir, rel);
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(rel ? join(rel, name) : name);
    } else {
      hash.update(rel).update("\0").update(readFileSync(abs)).update("\0");
    }
  };
  walk("");
  return { dir, sha: hash.digest("hex").slice(0, 16) };
}

// Read needs no permission, so an allowlist never withholds it, and restricted mode,
// which would confine it, also drops the laws (CLAUDE.md is not loaded; probed
// 2026-10-09). So a plugin session is denied Read under the operator's home, where
// the checkout and its grading patterns live; the copy and the trial dirs sit outside
// it (runEvals refuses a trial root under the home).
const HOME_READ_DENY = ["--disallowedTools", "Read(~/**)"];

// `--allowedTools ""` alone would still leave Read, hence `--tools`. A result line
// records the flags, so score can flag trials taken under different setups.
function textToolArgs(withPlugin: boolean): string[] {
  return withPlugin ? ["--tools", "Skill,Read", ...HOME_READ_DENY] : ["--tools", ""];
}
// Once per run, before any trial, with the base env, no credential and a throwaway
// config dir, so it touches neither the operator's ~/.claude nor the API; a failure
// refuses the run like a missing binary.
function claudeVersion(bin: string, env: Env): string {
  const configDir = mkdtempSync(join(tmpdir(), "harry-evals-version-"));
  try {
    return execFileSync(bin, ["--version"], {
      env: {
        ...buildBaseEnv(env),
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_TELEMETRY: "1",
        DISABLE_AUTOUPDATER: "1",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    }).trim();
  } catch (err) {
    throw new Error(`could not read the claude CLI version: ${(err as Error).message}`);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
}

const toolSetup = (args: string[]): string => args.map((a) => (a === "" ? '""' : a)).join(" ");

function runAgenticCase(
  bin: string,
  model: string,
  prompt: string,
  configDir: string,
  fixtureDir: string,
  env: Env,
  tmpDir: string,
  jail: Jail | null = null,
  pluginDir: string | null = null,
): string {
  const args = [
    "-p",
    prompt,
    "--model",
    model,
    "--output-format",
    "json",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    pluginDir ? `${AGENTIC_ALLOWED_TOOLS},Skill` : AGENTIC_ALLOWED_TOOLS,
    // The session's node commands can still read the host; only the sandbox contains
    // that.
    ...(pluginDir ? [...HOME_READ_DENY, "--plugin-dir", pluginDir] : []),
  ];
  if (!jail) {
    return invokeClaude(bin, args, fixtureDir, configDir, env, tmpDir);
  }
  const wrapped = wrapWithSandbox(jail.sandboxExec, jail.profile, bin, args);
  const jailedEnv = { ...env, PATH: jail.path };
  return invokeClaude(wrapped.bin, wrapped.args, fixtureDir, configDir, jailedEnv, jail.tmpDir);
}

export type RunLine = ResultLine & {
  trialDir: string;
  configDir: string;
  workDir: string;
  checks: CheckInput[];
  checkOutcomes?: ArtifactCheckOutcome[];
  response?: string;
  error?: string;
};

export function runEvals(
  opts: RunOpts,
  env: Env = process.env,
): { outPath: string; lines: RunLine[]; skipped: string[] } {
  const condition = opts.condition;
  if (!CONDITIONS.has(condition)) {
    throw new Error(`--condition must be one of ${[...CONDITIONS].join(", ")}`);
  }
  const model = resolveModel(opts, env);
  const trials = resolveTrials(opts);
  const requested = opts.postSessionTimeoutMs;
  const timeoutMs =
    typeof requested === "number" && Number.isInteger(requested) && requested > 0
      ? requested
      : DEFAULT_POST_SESSION_TIMEOUT_MS;

  const { entries, errors } = parseCasesJsonl(readFileSync(casesPath(), "utf8"));
  if (errors.length) throw new Error(`cases.jsonl parse errors:\n${errors.join("\n")}`);
  const violations = validateCases(entries);
  if (violations.length) throw new Error(`cases.jsonl is invalid:\n${violations.join("\n")}`);
  const cases = entries.map((e) => e.record);

  const explicitSelection = Boolean(opts.cases);
  const wanted = opts.cases;
  const selected = wanted ? cases.filter((c) => wanted.includes(c.id)) : cases;
  if (selected.length === 0) throw new Error("no cases selected");

  const skipped = [];
  const runnable = [];
  for (const c of selected) {
    if (c.mode === "agentic" && !opts.agentic) {
      if (explicitSelection) {
        throw new Error(
          `agentic case "${c.id}" requires the --agentic flag (release gate: agentic runs are expensive)`,
        );
      }
      skipped.push(c.id);
      continue;
    }
    runnable.push(c);
  }

  // Resolve the opt-in seatbelt jail BEFORE any dir is created or session starts:
  // if EVALS_SANDBOX=1 is set with a runnable agentic case but we can't sandbox,
  // this throws (never a silent unsandboxed run). Only agentic cases are jailed:
  // text mode has no exec surface, so a text-only run ignores the flag entirely.
  const agenticWillRun = runnable.some((c) => c.mode === "agentic");
  // The jail's read allowlist does not include the plugin copy, and it jails no text
  // case, while plugin text cases have Read: so the flag is refused for every plugin
  // run rather than silently ignored for a text-only one.
  if (condition === "plugin" && env.EVALS_SANDBOX === "1") {
    throw new Error(
      "the plugin condition is not wired into the sandbox: the jail is not allowed to read the plugin copy, and it covers no text case while plugin text cases have Read. Unset EVALS_SANDBOX.",
    );
  }
  const sandbox = sandboxContext(env, agenticWillRun);

  // Same "before any dir/session starts" timing as the sandbox refusal above: with
  // both or neither EVALS_ auth var set, refuse now with one clear message rather
  // than mid-batch, trial by trial.
  resolveAuth(env);

  // Every binary the runner spawns is resolved to an absolute path HERE, before the
  // first session, and never looked up on PATH again (requireOnPath). Still before
  // any dir exists: a missing binary refuses the run up front.
  const claudeBin = requireOnPath(env.EVALS_CLAUDE_BIN || "claude", env, "the claude CLI");
  // git is needed only for agentic cases. The jail lets its helpers run from the exec
  // path git reports, asked once here, not per trial; none (no jail, or git would not
  // say) leaves them unexecutable, and the jailed step fails closed.
  const agenticGit: { gitBin: string; gitExecPath: string | null } | null = agenticWillRun
    ? { gitBin: requireOnPath("git", env), gitExecPath: null }
    : null;
  if (sandbox && agenticGit) {
    try {
      agenticGit.gitExecPath = git(["--exec-path"], tmpdir(), env, agenticGit.gitBin);
    } catch {
      agenticGit.gitExecPath = null;
    }
  }

  const trialsRoot = env.EVALS_FIXTURE_ROOT || tmpdir();
  if (condition === "plugin") {
    const home = realpathSync(homedir());
    const rootAbs = resolve(trialsRoot);
    const real = existsSync(rootAbs) ? realpathSync(rootAbs) : rootAbs;
    if (real === home || real.startsWith(`${home}/`) || rootAbs.startsWith(`${homedir()}/`)) {
      throw new Error(
        `the plugin condition denies Read under the home directory, so its trial root ${trialsRoot} cannot sit under the home directory; point EVALS_FIXTURE_ROOT elsewhere.`,
      );
    }
  }
  const plugin = condition === "plugin" ? snapshotPlugin(trialsRoot) : null;
  // Under the plugin condition the laws come from the copy, so law and tree agree.
  const lawsText =
    condition === "baseline"
      ? ""
      : readFileSync(plugin ? join(plugin.dir, "HARRY.md") : lawsPath(), "utf8");
  // Without provenance a results file cannot be attributed to a law text: on
  // 2026-07-30 a probe's failure was read as a regression and two law edits made on
  // it, and which text each run used was recoverable only from unreaped mkdtemp
  // config dirs. `lawSha256` is what lets `score` refuse to pool trials across
  // different texts. The `claude` CLI version is read once per run with `--version`:
  // no session, no credential, a throwaway config dir. The CLI enforces the tool
  // limits a trial ran under, so a result names the CLI that held them. Recorded,
  // not pooled by score.
  const provenance = {
    claudeVersion: claudeVersion(claudeBin, env),
    lawBytes: Buffer.byteLength(lawsText),
    lawSha256: lawsText ? createHash("sha256").update(lawsText).digest("hex").slice(0, 16) : null,
    sandbox: Boolean(sandbox),
    ...(plugin ? { pluginDir: plugin.dir, pluginSha256: plugin.sha } : {}),
  };
  const outPath =
    opts.out ||
    join(pluginRoot, "evals", "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  mkdirSync(dirname(outPath), { recursive: true });

  const written: RunLine[] = [];
  for (const c of runnable) {
    if (!SUPPORTED_MODES.has(c.mode)) throw new Error(`case "${c.id}": unsupported mode ${c.mode}`);
    // Trials are 1-based on the wire (trial: 1..N); score treats a legacy line
    // with no `trial` field as trial 1, so the two formats pool coherently.
    for (let trial = 1; trial <= trials; trial++) {
      const dirs = prepareTrialDirs(condition, lawsText, trialsRoot);
      const line: RunLine = {
        id: c.id,
        mode: c.mode,
        condition,
        trial,
        model,
        law: c.law,
        informative: c.informative === true,
        prompt: c.prompt,
        checks: expandChecks(c.checks),
        toolSetup:
          c.mode === "agentic"
            ? toolSetup(plugin ? ["agentic", ...HOME_READ_DENY] : ["agentic"])
            : toolSetup(textToolArgs(Boolean(plugin))),
        trialDir: dirs.trialDir,
        configDir: dirs.configDir,
        workDir: dirs.workDir,
        ...provenance,
        timestamp: new Date().toISOString(),
      };
      try {
        if (c.mode === "agentic") {
          if (!agenticGit) throw new Error(`case "${c.id}" is agentic, but git was not resolved`);
          const { gitBin, gitExecPath } = agenticGit;
          const fx = materializeFixture(c.fixture, dirs.fixtureParent, env, gitBin);
          line.fixture = c.fixture;
          line.fixtureDir = fx.dir;
          line.initialBranch = fx.initialBranch;
          line.initialCommit = fx.initialCommit;
          const jail = trialJail(sandbox, {
            configDir: dirs.configDir,
            fixtureDir: fx.dir,
            tmpDir: dirs.tmpDir,
            bin: claudeBin,
            gitBin,
            gitExecPath,
            env,
            home: homedir(),
            script: fileURLToPath(import.meta.url),
            allowRead: [fileURLToPath(new URL("./lib", import.meta.url))],
          });
          line.response = runAgenticCase(
            claudeBin,
            model,
            c.prompt,
            dirs.configDir,
            fx.dir,
            env,
            dirs.tmpDir,
            jail,
            plugin?.dir ?? null,
          );
          // Judge now, while the fixture dir exists — inside the jail when there is
          // one — and record per-check outcomes so `score` can judge offline
          // (matching text mode's shape). The check objects are the runner's own,
          // never echoed back from the child.
          const outcomes = runPostSession(
            {
              fixtureDir: fx.dir,
              fixtureId: fx.id,
              gitConfig: fx.gitConfig.toString("base64"),
              initialBranch: fx.initialBranch,
              initialCommit: fx.initialCommit,
              checks: c.checks,
              gitBin,
              timeoutMs,
            },
            jail,
            env,
          );
          line.checkOutcomes = outcomes.map((o, i) => ({
            check: c.checks[i],
            ok: o.ok,
            detail: o.detail,
          }));
        } else {
          line.response = runTextCase(
            claudeBin,
            model,
            c.prompt,
            dirs.configDir,
            dirs.workDir,
            env,
            dirs.tmpDir,
            plugin?.dir ?? null,
          );
          // Record per-check outcomes (same shape as agentic lines) so an
          // inspector can see WHICH check failed without re-scoring. Scoring
          // still re-evaluates text lines from `response`, so these are
          // informational and never the source of truth.
          const { results } = evaluateChecks(line.checks, line.response);
          line.checkOutcomes = results.map((r) => ({
            check: r.check,
            ok: r.ok,
            detail: r.matched ? "pattern matched" : "pattern did not match",
          }));
        }
      } catch (caught) {
        const err = caught as ExecError;
        line.response = "";
        line.error = untrustedText(err.message, 2000);
      }
      // Append (never truncate): the documented flow runs baseline and candidate
      // as two separate invocations into the SAME --out file, so score can
      // contrast both conditions. Truncating would keep only the last run.
      appendFileSync(outPath, `${JSON.stringify(line)}\n`);
      written.push(line);
    }
  }
  return { outPath, lines: written, skipped };
}

const VALUE_FLAGS = new Set([
  "--condition",
  "--model",
  "--cases",
  "--out",
  "--results",
  "--trials",
]);

const BOOL_FLAGS = new Set(["--agentic"]);

type CliOpts = Partial<RunOpts> & { results?: string };

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOL_FLAGS.has(a)) {
      if (a === "--agentic") opts.agentic = true;
      continue;
    }
    if (!VALUE_FLAGS.has(a)) throw new Error(`unknown or misplaced argument: ${a}`);
    const value = argv[i + 1];
    if (value === undefined || VALUE_FLAGS.has(value) || BOOL_FLAGS.has(value)) {
      throw new Error(`${a} requires a value`);
    }
    i++;
    if (a === "--condition") opts.condition = value;
    else if (a === "--model") opts.model = value;
    else if (a === "--cases") opts.cases = value.split(",").map((s) => s.trim());
    else if (a === "--out") opts.out = value;
    else if (a === "--results") opts.results = value;
    else if (a === "--trials") opts.trials = value;
  }
  return opts;
}

function cmdValidate() {
  const { entries, errors } = parseCasesJsonl(readFileSync(casesPath(), "utf8"));
  const violations = [...errors, ...validateCases(entries)];
  if (violations.length) {
    console.error(`cases.jsonl: ${violations.length} problem(s):`);
    for (const v of violations) console.error(`  - ${v}`);
    return 1;
  }
  console.log(`cases.jsonl: OK (${entries.length} cases)`);
  return 0;
}

function cmdRun(opts: CliOpts, env: Env) {
  const { outPath, lines, skipped } = runEvals({ ...opts, condition: opts.condition ?? "" }, env);
  const failed = lines.filter(isErrored).length;
  if (skipped.length) {
    console.log(
      `Skipped ${skipped.length} agentic case(s) — pass --agentic to run them (real spend): ${skipped.join(", ")}`,
    );
  }
  console.log(
    `Wrote ${lines.length} result(s) to ${outPath}${failed ? ` (${failed} errored)` : ""}`,
  );
  return 0;
}

function cmdScore(opts: CliOpts) {
  if (!opts.results) {
    console.error("score: --results <path> is required");
    return 1;
  }
  const parsed = parseCasesJsonl(readFileSync(opts.results, "utf8"));
  const { lines, errors } = validateResultLines(parsed.entries);
  if (parsed.errors.length || errors.length) {
    for (const e of [...parsed.errors, ...errors]) console.error(`  - ${e}`);
    return 1;
  }
  const { groups, summary, candidateFailed, pluginFailed } = scoreResults(lines);
  const pad = (s: unknown, n: number) => String(s).padEnd(n);
  const graded = groups.filter((g) => !g.informative);
  const informative = groups.filter((g) => g.informative);
  // A MIXED-LAW group averaged trials across more than one HARRY.md, so its
  // verdict describes no single text — say so on the row rather than printing a
  // number that reads like a measurement.
  const verdict = (g: ScoreGroup) =>
    `${g.pass ? "PASS" : "FAIL"} (${g.passCount}/${g.trials}${g.errors ? `, ${g.errors} error` : ""})${
      g.mixedLaw
        ? `  ⚠ MIXED LAW TEXT (${g.lawShas.length} versions — verdict describes neither)`
        : ""
    }${
      g.mixedTools
        ? `  ⚠ MIXED TOOL SETUP (${g.toolSetups.length} setups — verdict describes neither)`
        : ""
    }${
      g.mixedPlugin
        ? `  ⚠ MIXED PLUGIN COPY (${g.pluginShas.length} versions — verdict describes neither)`
        : ""
    }`;
  // Spans every printed id, graded and informative, so a long informative id cannot
  // overflow into the condition column of either section.
  const idWidth = Math.max(4, ...groups.map((g) => g.id.length), "case".length) + 2;
  const row = (g: ScoreGroup) =>
    `${pad(g.id, idWidth)}${pad(g.condition, 12)}${pad(g.law ?? "", 14)}${verdict(g)}`;
  console.log(`${pad("case", idWidth)}${pad("condition", 12)}${pad("law", 14)}result`);
  for (const g of graded) {
    console.log(row(g));
  }
  if (informative.length) {
    console.log("\ninformative (contrast-only — does NOT gate the run):");
    for (const g of informative) {
      console.log(row(g));
    }
  }
  const informativeLine = summary.informativeTotal
    ? ` · informative: ${summary.informativePass}/${summary.informativeTotal} groups passed (ungated)`
    : "";
  console.log(
    `\ncandidate: ${summary.candidatePass}/${summary.candidateTotal} groups passed` +
      ` · baseline (contrast): ${summary.baselinePass}/${summary.baselineTotal} groups passed` +
      (summary.pluginTotal
        ? ` · plugin: ${summary.pluginPass}/${summary.pluginTotal} groups passed`
        : "") +
      informativeLine +
      ` · (${summary.trials} trial line(s) pooled)`,
  );
  return candidateFailed || pluginFailed ? 1 : 0;
}

export function main(argv: string[], env: Env = process.env): number {
  const [sub, ...rest] = argv;
  try {
    const opts = parseArgs(rest);
    if (sub === "validate") return cmdValidate();
    if (sub === "run") return cmdRun(opts, env);
    if (sub === "score") return cmdScore(opts);
    if (sub === POST_SESSION) return cmdPostSession();
    console.error("usage: run-evals.mts <validate|run|score> [options]");
    return 2;
  } catch (caught) {
    const err = caught as ExecError;
    console.error(err.message);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
