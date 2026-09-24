#!/usr/bin/env node
// harry behavioral-evals runner — measure whether the resident laws (HARRY.md)
// actually change a model's FIRST-RESPONSE behavior, as a regression harness.
//
// Two conditions per case, same prompt, same pinned model:
//   baseline  — a fresh, empty CLAUDE_CONFIG_DIR (no global CLAUDE.md → no laws).
//   candidate — a CLAUDE_CONFIG_DIR whose CLAUDE.md inlines this repo's HARRY.md.
// The delta between them is the laws' effect. baseline is informative contrast;
// candidate is what must pass.
//
// Isolation is the whole point: we NEVER read or touch the operator's real
// ~/.claude config. Each condition gets its own mkdtemp config dir, so the
// operator's own global CLAUDE.md can't leak in and inflate the baseline.
//
// The `claude` binary is resolved from EVALS_CLAUDE_BIN (default `claude`) — the
// seam that lets tests substitute a fake shim without a real API call. Model is
// mandatory (--model or EVALS_MODEL): pinning is a hard rule, so results are
// attributable to a known model, and we refuse to run without one.
//
// Usage:
//   node scripts/run-evals.mjs validate
//   node scripts/run-evals.mjs run --condition candidate --model <id> [--cases a,b] [--out p]
//   node scripts/run-evals.mjs score --results <path>

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  cpSync,
  existsSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Text cases judge the model's first-response prose with regexes.
const CHECK_TYPES = new Set(["regex_must", "regex_must_not"]);
// Agentic cases judge the fixture REPO STATE after a full headless session.
const AGENTIC_CHECK_TYPES = new Set([
  "git_created_branch",
  "git_no_new_commits_on_initial",
  "file_contains",
  "file_not_contains",
  "repo_grep",
  "repo_grep_absent",
  "commit_message_matches",
  "test_command_passes",
]);
// Check types that carry a regex `pattern` (validated + compiled). The others
// (git_created_branch, test_command_passes) have no pattern.
const PATTERN_CHECK_TYPES = new Set([
  "regex_must",
  "regex_must_not",
  "file_contains",
  "file_not_contains",
  "repo_grep",
  "repo_grep_absent",
  "commit_message_matches",
]);
const SUPPORTED_MODES = new Set(["text", "agentic"]);
const CONDITIONS = new Set(["baseline", "candidate"]);
const DEFAULT_TEST_COMMAND = "node --test";
// How long the post-session step may take (runEvals opts.postSessionTimeoutMs
// overrides it). It bounds a hung model-written test, and, sandboxed, the whole
// jailed child — which gets a grace period on top so its own test timeout fires first.
const DEFAULT_POST_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const POST_SESSION_GRACE_MS = 15 * 1000;

function casesPath() {
  return join(pluginRoot, "evals", "cases.jsonl");
}

function lawsPath() {
  return join(pluginRoot, "HARRY.md");
}

function fixturesPath() {
  return join(pluginRoot, "evals", "fixtures");
}

// ---- child environments: an allowlist, never copy-then-strip ----------------

// The operator vars a child may inherit. Everything else stays behind: NODE_OPTIONS
// (code injection into every node child), SSH_AUTH_SOCK, GITHUB_TOKEN / AWS_* and the
// like, and every ANTHROPIC_* / CLAUDE_CODE_* var. Those last ones matter for auth, not
// just secrecy: Claude Code ranks CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY above
// ANTHROPIC_AUTH_TOKEN above ANTHROPIC_API_KEY above CLAUDE_CODE_OAUTH_TOKEN, so any of
// them reaching the child would silently replace the one credential the run chose.
const BASE_ENV_KEYS = ["HOME", "LANG", "USER", "LOGNAME", "SHELL", "TERM"];

// Proxy and CA vars, forwarded only when the operator sets EVALS_FORWARD_PROXY=1 (a
// corporate proxy or TLS-inspecting CA). A fixed set on purpose: an operator-supplied
// list could name ANTHROPIC_AUTH_TOKEN and reopen the hole the allowlist closes.
const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

// The env every process the runner spawns starts from, built key by key from `env`.
// PATH puts the running node's dir first, so a shim-managed node (mise/asdf/nvm)
// still resolves, then keeps only the operator's ABSOLUTE entries: an empty or
// relative entry resolves against the child's cwd, which is often a fixture repo
// the session wrote, where a planted `./git` or `./node` would then run as the
// runner. TMPDIR is the trial's own temp dir when one is given (the jail lets a
// trial write only its own dirs, so a child must not look for scratch space
// anywhere else), otherwise the runner's tmpdir(). The EVALS_FORWARD_PROXY opt-in
// is carried along with the vars it forwards, so filtering an already-filtered env
// (a jailed child building its own children's env) keeps them.
export function buildBaseEnv(env, tmpDir = tmpdir()) {
  const out = {};
  const entries = [dirname(process.execPath), ...(env.PATH ?? "").split(delimiter)];
  out.PATH = [...new Set(entries.filter((p) => isAbsolute(p)))].join(delimiter);
  for (const key of BASE_ENV_KEYS) {
    if (env[key] !== undefined) out[key] = env[key];
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith("LC_")) out[key] = env[key];
  }
  out.TMPDIR = tmpDir;
  if (env.EVALS_FORWARD_PROXY === "1") {
    out.EVALS_FORWARD_PROXY = "1";
    for (const key of PROXY_ENV_KEYS) {
      if (env[key] !== undefined) out[key] = env[key];
    }
  }
  return out;
}

// The base env plus a pinned git identity and no global or system git config, for
// every git the runner runs and for the claude child (whose session commits). The
// identity keeps fixture commits attributable and off the operator's real one; with
// GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1 git reads no config from
// outside the repo (the operator's hooks, fsmonitor, aliases, signing), and the jail
// never has to re-open ~/.gitconfig. The repo's own config is another matter: see
// restoreFixtureGitConfig and judgeFixture.
export function buildGitEnv(env, tmpDir = tmpdir()) {
  return {
    ...buildBaseEnv(env, tmpDir),
    GIT_AUTHOR_NAME: "Eval Fixture",
    GIT_AUTHOR_EMAIL: "eval@localhost",
    GIT_COMMITTER_NAME: "Eval Fixture",
    GIT_COMMITTER_EMAIL: "eval@localhost",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

// Look a command up on the allowlisted PATH in-process — no `which` child — and
// return its absolute path, or null. A name containing a slash is made absolute
// as given. runEvals resolves every binary it spawns this way BEFORE the first
// session, and never looks one up again: a PATH dir can be writable by the
// operator's user (Homebrew's bin is), and a session must not be able to put a
// `git` or `claude` there for the runner to pick up later.
export function findOnPath(name, env = process.env) {
  if (name.includes("/")) return resolve(name);
  for (const dir of buildBaseEnv(env).PATH.split(delimiter)) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not here: keep looking */
    }
  }
  return null;
}

function requireOnPath(name, env, what = name) {
  const found = findOnPath(name, env);
  if (!found) throw new Error(`cannot find ${what} on PATH; refusing to start the run`);
  return found;
}

function git(args, cwd, env = process.env, gitBin = requireOnPath("git", env)) {
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
    }).trim();
  } catch (err) {
    const firstLine =
      String(err?.stderr ?? "")
        .split("\n")
        .find((l) => l.trim()) ?? "";
    throw new Error(
      untrustedText(`git ${args[0] ?? ""} failed (exit ${err?.status ?? "?"}): ${firstLine}`, 400),
    );
  }
}

// ---- parsing & validation (pure) -------------------------------------------

// Parse JSONL into { cases, errors }. Blank lines are skipped; a malformed line
// becomes a parse error rather than throwing, so `validate` can report them all.
export function parseCasesJsonl(text) {
  const cases = [];
  const errors = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      cases.push(JSON.parse(line));
    } catch (err) {
      errors.push(`line ${i + 1}: not valid JSON (${err.message})`);
    }
  }
  return { cases, errors };
}

// Compile a check's pattern; throws on an invalid regex or flags.
export function compileCheck(check) {
  return new RegExp(check.pattern, check.flags ?? "");
}

// Return a list of human-readable schema violations ([] means valid).
export function validateCases(cases) {
  const violations = [];
  const seen = new Set();
  cases.forEach((c, idx) => {
    const where = c && typeof c.id === "string" ? `case "${c.id}"` : `case #${idx + 1}`;
    if (!c || typeof c !== "object") {
      violations.push(`${where}: not an object`);
      return;
    }
    if (typeof c.id !== "string" || !c.id.trim()) {
      violations.push(`${where}: missing/empty string "id"`);
    } else if (seen.has(c.id)) {
      violations.push(`${where}: duplicate id`);
    } else {
      seen.add(c.id);
    }
    if (!SUPPORTED_MODES.has(c.mode)) {
      violations.push(`${where}: "mode" must be one of ${[...SUPPORTED_MODES].join(", ")}`);
    }
    if (typeof c.prompt !== "string" || !c.prompt.trim()) {
      violations.push(`${where}: missing/empty string "prompt"`);
    }
    if (typeof c.law !== "string" || !c.law.trim()) {
      violations.push(`${where}: missing/empty string "law"`);
    }
    // An informative case is contrast-only: its failures never gate the run.
    if (c.informative !== undefined && typeof c.informative !== "boolean") {
      violations.push(`${where}: "informative" must be a boolean when present`);
    }
    const isAgentic = c.mode === "agentic";
    // Agentic cases name a committed fixture the runner materializes and runs in.
    if (isAgentic && (typeof c.fixture !== "string" || !c.fixture.trim())) {
      violations.push(`${where}: agentic case needs a non-empty string "fixture"`);
    }
    if (!Array.isArray(c.checks) || c.checks.length === 0) {
      violations.push(`${where}: "checks" must be a non-empty array`);
      return;
    }
    const allowedTypes = isAgentic ? AGENTIC_CHECK_TYPES : CHECK_TYPES;
    c.checks.forEach((check, ci) => {
      const cw = `${where} check #${ci + 1}`;
      if (!check || typeof check !== "object") {
        violations.push(`${cw}: not an object`);
        return;
      }
      if (!allowedTypes.has(check.type)) {
        violations.push(`${cw}: "type" must be one of ${[...allowedTypes].join(", ")}`);
      }
      // Pattern-bearing checks need a compilable regex; git_created_branch and
      // test_command_passes carry no pattern.
      if (PATTERN_CHECK_TYPES.has(check.type)) {
        if (typeof check.pattern !== "string" || !check.pattern) {
          violations.push(`${cw}: missing/empty string "pattern"`);
        } else {
          try {
            compileCheck(check);
          } catch (err) {
            violations.push(`${cw}: invalid regex (${err.message})`);
          }
        }
      }
      // file_contains/file_not_contains target a specific file.
      if (
        (check.type === "file_contains" || check.type === "file_not_contains") &&
        (typeof check.path !== "string" || !check.path)
      ) {
        violations.push(`${cw}: "${check.type}" needs a non-empty string "path"`);
      }
      if (
        check.type === "test_command_passes" &&
        check.command !== undefined &&
        typeof check.command !== "string"
      ) {
        violations.push(`${cw}: "command" must be a string when present`);
      }
      // repo_grep/repo_grep_absent may narrow to files whose relative path
      // matches an optional pathPattern regex before content-grepping.
      if (check.pathPattern !== undefined) {
        if (check.type !== "repo_grep" && check.type !== "repo_grep_absent") {
          violations.push(`${cw}: "pathPattern" only applies to repo_grep/repo_grep_absent`);
        } else if (typeof check.pathPattern !== "string" || !check.pathPattern) {
          violations.push(`${cw}: "pathPattern" must be a non-empty string when present`);
        } else {
          try {
            new RegExp(check.pathPattern);
          } catch (err) {
            violations.push(`${cw}: invalid pathPattern regex (${err.message})`);
          }
        }
      }
      if (check.flags !== undefined && typeof check.flags !== "string") {
        violations.push(`${cw}: "flags" must be a string when present`);
      }
    });
  });
  return violations;
}

// ---- scoring (pure) --------------------------------------------------------

// Evaluate one check against a response. regex_must → pattern must match;
// regex_must_not → pattern must NOT match.
export function evaluateCheck(check, responseText) {
  const re = compileCheck(check);
  const matched = re.test(responseText ?? "");
  const ok = check.type === "regex_must" ? matched : !matched;
  return { check, matched, ok };
}

// Score one result line's checks against its recorded response.
export function evaluateChecks(checks, responseText) {
  const results = (checks ?? []).map((check) => evaluateCheck(check, responseText));
  return { pass: results.every((r) => r.ok), results };
}

// ---- the post-session step ---------------------------------------------------

// The hidden subcommand the jailed post-session child runs (see runPostSession).
const POST_SESSION = "__post-session";

// Everything the runner does after an agentic session on paths the session
// controlled: check the fixture is still the directory materializeFixture made,
// put its .git/config back, collect the repo state, and evaluate every check
// (file reads and the model-written test command included). Returns one
// { ok, detail } per check, in order.
//
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
export function judgeFixture(payload, env = process.env) {
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
  const state = collectRepoState(fixtureDir, initialBranch, initialCommit, env, gitBin);
  state.testTimeoutMs = payload.timeoutMs;
  return evaluateArtifactChecks(checks, state).results.map((r) => ({
    ok: r.ok,
    detail: r.detail,
  }));
}

// Text from the jailed child is untrusted: control characters (C0, DEL, C1)
// become spaces, so no terminal escape or line break reaches a results file or a
// terminal, and it is capped.
function untrustedText(value, max = 1000) {
  const clean = Array.from(String(value), (c) => {
    const code = c.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : c;
  }).join("");
  return clean.length > max ? `${clean.slice(0, max)}…[truncated]` : clean;
}

// Validate the jailed child's stdout by shape, as untrusted input: exactly
// { outcomes: [{ ok: boolean, detail: string }] } with one outcome per check, or
// { error: string }. Anything else is refused without being echoed back.
export function parsePostSessionOutput(stdout, count) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `the jailed post-session step printed malformed output (${stdout.length} bytes)`,
    );
  }
  if (parsed !== null && typeof parsed === "object" && typeof parsed.error === "string") {
    throw new Error(`jailed post-session step: ${untrustedText(parsed.error)}`);
  }
  const outcomes = parsed?.outcomes;
  if (
    !Array.isArray(outcomes) ||
    outcomes.length !== count ||
    !outcomes.every(
      (o) =>
        o !== null &&
        typeof o === "object" &&
        typeof o.ok === "boolean" &&
        typeof o.detail === "string",
    )
  ) {
    throw new Error(
      `the jailed post-session step printed output of the wrong shape (${stdout.length} bytes)`,
    );
  }
  return outcomes.map((o) => ({ ok: o.ok, detail: untrustedText(o.detail) }));
}

// Run judgeFixture for one trial: in-process when unsandboxed, otherwise as ONE
// child under the trial's jail. The payload goes in on stdin (no file a session
// could rewrite first); the child gets the credential-free base env and a cwd
// outside the fixture; --preserve-symlinks-main stops node's entry lookup from
// lstat-ing the jailed $HOME ancestors of this script.
function runPostSession(payload, jail, env) {
  if (!jail) return judgeFixture(payload, env);
  const script = realpathSync(fileURLToPath(import.meta.url));
  const wrapped = wrapWithSandbox(jail.sandboxExec, jail.profile, process.execPath, [
    "--preserve-symlinks-main",
    script,
    POST_SESSION,
  ]);
  let stdout;
  try {
    // All three streams piped: the child's stderr (and anything its git or tests
    // print there) never reaches the operator's terminal except through
    // untrustedText on the failure path.
    stdout = execFileSync(wrapped.bin, wrapped.args, {
      cwd: jail.tmpDir,
      env: buildBaseEnv({ ...env, PATH: jail.path }, jail.tmpDir),
      input: JSON.stringify(payload),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      timeout: payload.timeoutMs + POST_SESSION_GRACE_MS,
      killSignal: "SIGKILL",
    });
  } catch (err) {
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

// The jailed child's side: read the payload from stdin, judge, print one JSON line.
// A refusal is reported as { error } so the parent can surface it on the result line.
function cmdPostSession() {
  let out;
  try {
    out = { outcomes: judgeFixture(JSON.parse(readFileSync(0, "utf8"))) };
  } catch (err) {
    out = { error: String(err?.message ?? err) };
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return 0;
}

// ---- agentic: fixture materialization + repo state (side-effecting) --------

// Copy a committed fixture into a fresh temp dir, `git init` it there, and make
// one pinned initial commit. Returns the working dir plus the initial branch and
// commit SHA (the baseline the artifact checks diff against). NEVER runs inside
// the repo — the copy lands under `root` (default the OS temp dir).
export function materializeFixture(
  name,
  root = tmpdir(),
  env = process.env,
  gitBin = requireOnPath("git", env),
) {
  const src = join(fixturesPath(), name);
  if (!existsSync(src)) {
    throw new Error(`unknown fixture "${name}" (looked in ${fixturesPath()})`);
  }
  const dir = mkdtempSync(join(root, `harry-evals-fx-${name}-`));
  cpSync(src, dir, { recursive: true });
  // `-b main` isn't portable to older git; set the default branch via config so
  // the initial branch name is deterministic. We still read it back below.
  git(["-c", "init.defaultBranch=main", "init"], dir, env, gitBin);
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

// lstat that reports a missing path as null instead of throwing.
function lstatOrNull(p, opts) {
  try {
    return lstatSync(p, opts);
  } catch (err) {
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
// config from somewhere else: a .git that is not a plain directory (a symlink, or a
// `gitdir:` file pointing elsewhere), an added commondir or config.worktree, and a
// .git/config that is not a regular file. A symlinked config is refused, never
// written through: writing the constant through a link into ~/.gitconfig would
// clobber the operator's own. The write is O_EXCL after an unlink, so it can only
// ever create a fresh regular file.
export function restoreFixtureGitConfig(fixtureDir, gitConfig) {
  const refuse = (why) => {
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

// Snapshot the post-session repo state the artifact checks judge: the branches,
// the messages of commits that are NEW since the seed, and the tracked+untracked
// file list (minus .git). Reads only — deterministic given the repo on disk.
export function collectRepoState(
  fixtureDir,
  initialBranch,
  initialCommit,
  env = process.env,
  gitBin = requireOnPath("git", env),
) {
  const branches = git(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    fixtureDir,
    env,
    gitBin,
  )
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);
  // All commit messages across every branch, minus the seed commit's.
  const commitLog = git(["log", "--all", "--format=%H%x1f%s"], fixtureDir, env, gitBin);
  const newCommitMessages = commitLog
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\x1f"))
    .filter(([sha]) => sha !== initialCommit)
    .map(([, subject]) => subject ?? "");
  const tracked = git(["ls-files"], fixtureDir, env, gitBin).split("\n");
  const untracked = git(
    ["ls-files", "--others", "--exclude-standard"],
    fixtureDir,
    env,
    gitBin,
  ).split("\n");
  const files = [...new Set([...tracked, ...untracked])].map((f) => f.trim()).filter(Boolean);
  // Commits added ON the initial branch since the seed. A lawful session works
  // off a fresh branch, so this stays 0 even after it commits elsewhere. If the
  // initial branch is gone (renamed away), treat it as untouched (0).
  let newCommitsOnInitial = 0;
  if (branches.includes(initialBranch)) {
    const count = git(
      ["rev-list", "--count", `${initialCommit}..${initialBranch}`],
      fixtureDir,
      env,
      gitBin,
    );
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
    // The allowlisted env only: the state never carries the runner's credentials.
    env: buildBaseEnv(env),
  };
}

// Read a repo file's contents, or null if missing/unreadable (fixtures are text).
function readFileSafe(fixtureDir, relPath) {
  try {
    return readFileSync(join(fixtureDir, relPath), "utf8");
  } catch {
    return null;
  }
}

// Evaluate ONE artifact check against a collected repo state. Deterministic
// given the state (test_command_passes shells out to the fixture's test runner,
// which reads the same on-disk state). Returns { check, ok, detail }.
//
// Every check reads paths the session controlled, and test_command_passes runs
// tests the session WROTE, so in a sandboxed run this only ever executes inside
// the jailed post-session child (see judgeFixture / runPostSession).
export function evaluateArtifactCheck(check, state) {
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
      const content = readFileSafe(state.fixtureDir, check.path);
      if (content === null) return { check, ok: false, detail: `missing file ${check.path}` };
      return { check, ok: compileCheck(check).test(content), detail: check.path };
    }
    case "file_not_contains": {
      const content = readFileSafe(state.fixtureDir, check.path);
      // Missing file trivially can't contain the pattern → passes.
      if (content === null) return { check, ok: true, detail: `missing file ${check.path}` };
      return { check, ok: !compileCheck(check).test(content), detail: check.path };
    }
    case "repo_grep":
    case "repo_grep_absent": {
      const re = compileCheck(check);
      // Optionally narrow to files whose relative path matches pathPattern, so a
      // content match in an unrelated file (e.g. a prompt-echo in NOTES.md) can't
      // satisfy a grep meant for, say, test files.
      const pathRe = check.pathPattern ? new RegExp(check.pathPattern) : null;
      const scoped = pathRe ? state.files.filter((f) => pathRe.test(f)) : state.files;
      const hit = scoped.find((f) => {
        const content = readFileSafe(state.fixtureDir, f);
        return content !== null && re.test(content);
      });
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
      const timeoutMs = state.testTimeoutMs ?? DEFAULT_POST_SESSION_TIMEOUT_MS;
      // Model-written code: the credential-free base env, never the runner's own;
      // `node` is the running node by absolute path, not a PATH lookup; output is
      // discarded; and a hung test is killed at the timeout.
      try {
        execFileSync(cmd === "node" ? process.execPath : cmd, args, {
          cwd: state.fixtureDir,
          env: buildBaseEnv(state.env ?? process.env),
          stdio: "ignore",
          maxBuffer: 32 * 1024 * 1024,
          timeout: timeoutMs,
          killSignal: "SIGKILL",
        });
        return { check, ok: true, detail: `${command} exited 0` };
      } catch (err) {
        if (err?.code === "ETIMEDOUT" || err?.signal === "SIGKILL") {
          return { check, ok: false, detail: `${command} timed out after ${timeoutMs}ms` };
        }
        return { check, ok: false, detail: `${command} failed: ${err.status ?? err.message}` };
      }
    }
    default:
      return { check, ok: false, detail: `unknown check type ${check.type}` };
  }
}

// Evaluate a whole agentic case's checks against a repo state.
export function evaluateArtifactChecks(checks, state) {
  const results = (checks ?? []).map((check) => evaluateArtifactCheck(check, state));
  return { pass: results.every((r) => r.ok), results };
}

// Score one result line to a single-trial pass. Each result carries its own
// checks (embedded at run time) so scoring is self-contained and never drifts
// from a mutated cases file. A legacy line with no `trial` field is trial 1.
function scoreTrial(line) {
  // Agentic lines can't be re-judged offline (the fixture temp dir is gone), so
  // the run recorded per-check outcomes; text lines re-evaluate the response so
  // scoring stays independent of a later-edited cases file.
  const pass =
    line.mode === "agentic"
      ? (line.checkOutcomes ?? []).every((o) => o.ok)
      : evaluateChecks(line.checks, line.response).pass;
  return {
    id: line.id,
    condition: line.condition,
    trial: line.trial ?? 1,
    law: line.law,
    informative: line.informative === true,
    pass: line.error ? false : pass,
    error: line.error ?? null,
  };
}

// Score a whole results array. Trials are POOLED per (id, condition) group —
// every line for a group counts, whether it came from one --trials N run or
// several appended runs of the same condition (that is the documented way to
// add trials post-hoc). A group's verdict is a STRICT MAJORITY of its trials:
// it passes iff more than half passed (2/3, 2/2 — a 1/2 tie FAILS). An errored
// trial counts as a failing trial. candidateFailed (the CLI exit code) derives
// only from graded (non-informative) candidate GROUP verdicts; informative
// groups are tallied separately and never gate.
export function scoreResults(lines) {
  const groupMap = new Map();
  for (const line of lines) {
    const t = scoreTrial(line);
    // JSON-array key: an unambiguous (id, condition) tuple that can never
    // collide regardless of what characters an id contains.
    const key = JSON.stringify([t.id, t.condition]);
    let g = groupMap.get(key);
    if (!g) {
      g = {
        id: t.id,
        condition: t.condition,
        law: t.law,
        informative: t.informative,
        trials: 0,
        passCount: 0,
        errors: 0,
        // Every distinct law text this group's trials were taken under. More than
        // one means the group's verdict averages ACROSS law versions, which is the
        // one thing a law-effect measurement must never do silently: on 2026-07-30
        // a §3 probe read 3/3 twice on one text and 1/3 on the next, and pooling
        // them into a single "weak" hid both numbers. Legacy lines predate the
        // stamp and contribute no hash rather than a false one.
        lawShas: new Set(),
      };
      groupMap.set(key, g);
    }
    g.trials += 1;
    if (t.pass) g.passCount += 1;
    if (t.error) g.errors += 1;
    if (line.lawSha256) g.lawShas.add(line.lawSha256);
    // Backfill law/informative from any trial that carries them (a legacy line
    // may omit law; a later trial may supply it).
    if (!g.law && t.law) g.law = t.law;
    if (t.informative) g.informative = true;
  }
  const groups = [...groupMap.values()].map((g) => ({
    ...g,
    lawShas: [...g.lawShas].sort(),
    // A group whose trials span more than one law text is NOT a measurement of
    // either text. Surfaced per group so the table can say so; the verdict is
    // still computed (refusing to score would lose the run) but it is marked.
    mixedLaw: g.lawShas.size > 1,
    // Strict majority: passCount > trials/2  ⇔  2*passCount > trials.
    pass: g.passCount * 2 > g.trials,
  }));

  // Informative groups are contrast-only: split them out so they never gate the
  // run, and the gating counts (and exit code) consider only the graded groups.
  const graded = groups.filter((g) => !g.informative);
  const candidate = graded.filter((g) => g.condition === "candidate");
  const baseline = graded.filter((g) => g.condition === "baseline");
  const informative = groups.filter((g) => g.informative);
  return {
    rows: groups,
    groups,
    summary: {
      total: groups.length,
      trials: lines.length,
      candidatePass: candidate.filter((g) => g.pass).length,
      candidateTotal: candidate.length,
      baselinePass: baseline.filter((g) => g.pass).length,
      baselineTotal: baseline.length,
      informativePass: informative.filter((g) => g.pass).length,
      informativeTotal: informative.length,
    },
    candidateFailed: candidate.some((g) => !g.pass),
  };
}

// ---- run helpers -----------------------------------------------------------

// Resolve the trial count, or throw. Default 1. Must be a positive integer —
// a fractional or non-numeric --trials is a user error we refuse cleanly rather
// than silently coerce (a coerced "2.5"→2 or "abc"→1 would run a silently-wrong
// number of trials). Each selected case runs this many independent sessions.
export function resolveTrials(opts) {
  const raw = opts.trials;
  if (raw === undefined || raw === null) return 1;
  // Accept a plain positive integer ONLY: a string must be all digits (rejects
  // "", " 2", "2.5", "1e1", "0x2"); a number must itself be a positive integer.
  // No silent default on blank/garbage — that would run a wrong trial count.
  const isPlainInt = typeof raw === "string" ? /^\d+$/.test(raw) : Number.isInteger(raw);
  const n = Number(raw);
  if (!isPlainInt || !Number.isInteger(n) || n < 1) {
    throw new Error(`--trials must be a positive integer (got "${raw}")`);
  }
  return n;
}

// Resolve the pinned model, or throw. Pinning is a hard rule: an unattributable
// result is worse than no result.
export function resolveModel(opts, env) {
  const model = opts.model || env.EVALS_MODEL;
  if (!model?.trim()) {
    throw new Error(
      "no model specified: pass --model <id> or set EVALS_MODEL (pinning is required)",
    );
  }
  return model.trim();
}

// How to hand a credential to the runner without it ever being echoed: read it from a
// file only the operator can read. Part of every auth refusal.
const AUTH_HINT =
  "set exactly one of EVALS_ANTHROPIC_API_KEY (a console API key) or " +
  "EVALS_CLAUDE_CODE_OAUTH_TOKEN (a subscription token from `claude setup-token`), " +
  "read from a file only you can read so it is never printed, e.g. " +
  'EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)"';

// An empty or whitespace-only value is unset: `EVALS_X="$(cat missing-file)"` must not
// count as a choice. This only decides; the value itself is forwarded untouched.
function isSet(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Resolve the run's ONE auth path, or throw. A fresh config dir is logged out, so the
// child authenticates only from the env: either a console API key
// (EVALS_ANTHROPIC_API_KEY → the child's ANTHROPIC_API_KEY) or a subscription token
// from `claude setup-token` (EVALS_CLAUDE_CODE_OAUTH_TOKEN → CLAUDE_CODE_OAUTH_TOKEN).
// Both set is ambiguous and neither set cannot authenticate; both refuse. Bare
// ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN in the operator's shell never count —
// the EVALS_ prefix is the opt-in, so an unrelated credential is never billed by
// accident. No message carries a value: it reads only whether each var is set.
export function resolveAuth(env) {
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
  // A carriage return means a file saved with CRLF line endings: `$(cat …)` strips
  // the trailing \n but keeps the \r, and the credential would be sent with it.
  // Refused here, before any dir exists, rather than silently repaired.
  const name = apiKey ? "EVALS_ANTHROPIC_API_KEY" : "EVALS_CLAUDE_CODE_OAUTH_TOKEN";
  if (env[name].includes("\r")) {
    throw new Error(
      `${name} contains a carriage return (a file saved with CRLF line endings?); ` +
        `remove it from the file and retry. The value is not shown.`,
    );
  }
  return { kind: apiKey ? "api-key" : "oauth-token" };
}

// Create one trial's private dirs under a fresh mkdtemp root in `root`:
//   config/  — its CLAUDE_CONFIG_DIR: candidate gets a CLAUDE.md inlining the laws,
//              baseline an empty dir (no CLAUDE.md);
//   work/    — the text child's cwd, empty, so no project CLAUDE.md is found above it;
//   fixture/ — the parent a fixture is materialized under (agentic);
//   tmp/     — the TMPDIR every child of this trial gets.
// Nothing is shared between trials, so a jailed session — which may write only its
// own trial's config, fixture and tmp dirs — can never reach a dir a later trial or
// an unjailed text case reads.
//
// No credential file, settings or memory is ever written here. The child
// authenticates from its env (buildChildEnv), so no credential lands on disk for a
// session to read. The runner used to copy the operator's `.credentials.json` in as
// a fallback; that path is gone, because on macOS the file is a Keychain snapshot
// that goes stale on its own schedule, and copying real credentials into temp dirs
// was a liability in itself.
export function prepareTrialDirs(condition, lawsText, root = tmpdir()) {
  const trialDir = mkdtempSync(join(root, `harry-evals-trial-${condition}-`));
  const dirs = {
    trialDir,
    configDir: join(trialDir, "config"),
    workDir: join(trialDir, "work"),
    fixtureParent: join(trialDir, "fixture"),
    tmpDir: join(trialDir, "tmp"),
  };
  for (const key of ["configDir", "workDir", "fixtureParent", "tmpDir"]) mkdirSync(dirs[key]);
  if (condition === "candidate") {
    writeFileSync(join(dirs.configDir, "CLAUDE.md"), lawsText);
  }
  return dirs;
}

// The env for every `claude` child — text, agentic, and sandboxed agentic alike, since
// all three launch through invokeClaude: the git env (the allowlist plus pinned git
// identity and config), its config dir, and exactly one credential under its
// unprefixed name, set from its EVALS_ source (resolveAuth picks which). Nothing else
// from the operator's env survives — not a bare ANTHROPIC_API_KEY or
// CLAUDE_CODE_OAUTH_TOKEN, not the EVALS_ sources, not any var that would outrank the
// chosen credential.
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
export function buildChildEnv(env, configDir, tmpDir = tmpdir()) {
  const auth = resolveAuth(env);
  const childEnv = {
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
function extractResponse(stdout) {
  const parsed = JSON.parse(stdout);
  if (parsed.is_error === true) {
    const detail = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed);
    throw new Error(`claude returned an error result: ${untrustedText(detail)}`);
  }
  if (typeof parsed.result === "string") return parsed.result;
  return JSON.stringify(parsed);
}

// Run the claude CLI and decode its response. On an execFileSync failure
// (nonzero exit or spawn error), surface a structured {is_error} stdout if the
// child still printed one, otherwise name how it ended and attach stdout/stderr
// tails so a failing line carries a real diagnostic. Never execFileSync's own
// message: that is "Command failed: <the whole argv>" — the prompt and, jailed,
// the whole seatbelt profile — which crowds the child's own output out of the cap.
function invokeClaude(bin, args, cwd, configDir, env, tmpDir = tmpdir()) {
  const childEnv = buildChildEnv(env, configDir, tmpDir);
  let stdout;
  try {
    // All three streams piped: claude's stderr never reaches the operator's
    // terminal directly; a failure surfaces it only through untrustedText.
    stdout = execFileSync(bin, args, {
      cwd,
      env: childEnv,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    const printed = err?.stdout ? String(err.stdout) : "";
    if (printed.trim().startsWith("{")) {
      // The child exited nonzero but still emitted a JSON result — decode it
      // (this rethrows the readable is_error message when present).
      return extractResponse(printed);
    }
    const tail = (s) => (s ? untrustedText(String(s).trim().slice(-800), 800) : "");
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
// `--allowedTools ""` disables tools by relying on `-p`'s deny-by-default: it is
// an ALLOWLIST (an empty allowlist auto-approves nothing), not an explicit
// kill-switch. `claude --help` also exposes `--tools`/`--permission-mode`, but
// their exact `-p` semantics can't be confirmed without spending API, so we keep
// the brief's allowlist form. We measure first-response prose, not actions.
//
// `cwd` MUST be an empty dir with no CLAUDE.md above it: claude reads project
// memory by walking up from cwd, so running from the repo root would leak this
// repo's own CLAUDE.md (which enumerates the laws) into BOTH conditions —
// silently making the baseline "lawful" and collapsing the measured delta. This
// is the sibling isolation to CLAUDE_CONFIG_DIR (global memory).
function runTextCase(bin, model, prompt, configDir, workDir, env, tmpDir) {
  const args = ["-p", prompt, "--model", model, "--output-format", "json", "--allowedTools", ""];
  return invokeClaude(bin, args, workDir, configDir, env, tmpDir);
}

// The Bash commands an agentic session is allowed to run, comma-joined into one
// `--allowedTools` value (`claude --help`: "Comma or space-separated list of tool
// names to allow"; a single comma-separated arg avoids the variadic `<tools...>`
// swallowing later flags). WHY these: the artifact checks assert on git state
// (git_created_branch, git_no_new_commits_on_initial, commit messages) and on
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
// EVALS_SANDBOX=1 seatbelt jail (see buildSeatbeltProfile / sandboxContext): a
// deny-by-default profile that lets the session write only its own trial's dirs,
// read nothing under the operator's $HOME, and reach almost no system service —
// see the launchd exception in the DEBT note on buildSeatbeltProfile.
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

// Invoke the claude CLI for one AGENTIC case: a full headless session in the
// fixture repo. `--permission-mode acceptEdits` auto-approves file edits; the
// `--allowedTools` allowlist additionally auto-approves the git subcommands and
// `node` the artifact checks depend on (see AGENTIC_ALLOWED_TOOLS) so the session
// can branch, commit, and run the test suite. Both flags verified present in
// `claude --help`; not empty like the text kill-switch — here tools are enabled,
// narrowed to the commands the checks need (a surface reduction, not a sandbox).
function runAgenticCase(bin, model, prompt, configDir, fixtureDir, env, tmpDir, jail = null) {
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
    AGENTIC_ALLOWED_TOOLS,
  ];
  if (!jail) {
    return invokeClaude(bin, args, fixtureDir, configDir, env, tmpDir);
  }
  // Opt-in EVALS_SANDBOX: the child runs inside the trial's seatbelt jail (built in
  // runEvals by trialJail): deny-by-default, writes only to its own trial's dirs, no
  // reads under $HOME, almost no system service (the launchd exception is in the
  // DEBT note on buildSeatbeltProfile).
  const wrapped = wrapWithSandbox(jail.sandboxExec, jail.profile, bin, args);
  const jailedEnv = { ...env, PATH: jail.path };
  return invokeClaude(wrapped.bin, wrapped.args, fixtureDir, configDir, jailedEnv, tmpDir);
}

// One trial's jail, shared by the session and by the post-session child that judges
// it (see sandboxContext for the refusal path). The only writable paths are this
// trial's own config dir, fixture and temp dir (canonicalized with realpath) — not
// the fixture's parent, not the shared temp root, nothing another trial or an
// unjailed step reads. The runtime trees (readable and executable) are resolved
// inside buildAgenticSandboxProfile; this script itself is readable (never writable)
// so the post-session child can load it from under $HOME.
function trialJail(sandbox, { configDir, fixtureDir, tmpDir, bin, gitBin, env }) {
  if (!sandbox) return null;
  const trees = resolveRuntimeTrees(bin, env, gitBin);
  const profile = buildAgenticSandboxProfile({
    home: homedir(),
    allowWrite: [configDir, fixtureDir, tmpDir],
    allowRead: [realpathSync(fileURLToPath(import.meta.url))],
    trees,
    env,
  });
  // The PATH every jailed child starts from: only the dirs the profile lets it
  // exec from (see jailedPath), from the same trees the profile was built with.
  const jailPath = jailedPath(env, jailExecDirs(trees));
  return { sandboxExec: sandbox.sandboxExec, profile, tmpDir, path: jailPath };
}

// ---- opt-in OS sandbox (macOS seatbelt) ------------------------------------

// Build the seatbelt profile for an agentic session: the IO-doing wrapper around
// the pure buildSeatbeltProfile. It CANONICALIZES paths (realpath) before handing
// them to the generator, because seatbelt matches the kernel-canonical path — a
// symlinked entry left un-normalized would silently FAIL to match its subpath rule:
//   - I-1: an un-normalized $HOME jail root that doesn't match un-jails $HOME with
//     NO error while still reporting "sandboxed". So $HOME is realpath'd HARD — if
//     realpath throws (impossible in practice; $HOME must exist), the error
//     propagates and the session never launches, rather than emitting a profile
//     that doesn't actually jail (never a silent unsandboxed run).
//   - M-1: the writable dirs are realpath'd too (best-effort — one that can't be
//     resolved is dropped, safe-fail: it just stays unwritable), so they match real
//     kernel paths (/var → /private/var). Deduped by the Set in buildSeatbeltProfile
//     after normalization.
// The runtime trees come from resolveRuntimeTrees, which already includes canonical
// (dirname-of-realpath) forms; they are both readable and executable.
export function buildAgenticSandboxProfile({
  home,
  allowWrite = [],
  allowRead = [],
  bin,
  gitBin,
  env = process.env,
  trees = resolveRuntimeTrees(bin, env, gitBin),
}) {
  const home_ = realpathSync(home); // HARD: refuse (throw) rather than un-jail silently.
  const canonicalizeSafe = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return null; // unresolved defensive re-allow: drop it (safe-fail, jail stays closed)
    }
  };
  const writes = allowWrite.map(canonicalizeSafe).filter(Boolean);
  refuseUnsafeTrees(trees, home_, writes);
  return buildSeatbeltProfile({
    home: home_,
    allowWrite: writes,
    allowRead: [...trees, ...allowRead],
    allowExec: trees,
  });
}

// Trees are readable and executable and come after the $HOME deny (last match
// wins), so a tree at /, at or above $HOME re-opens every read under $HOME, and one
// overlapping a writable dir lets a session run what it writes. Refuse either.
function refuseUnsafeTrees(trees, home, writes) {
  const within = (p, dir) => dir === "/" || p === dir || p.startsWith(`${dir}/`);
  for (const tree of trees) {
    let real = tree;
    try {
      real = realpathSync(tree);
    } catch {
      /* unresolved: judge the spelling the profile carries */
    }
    const write = writes.find((w) => within(w, real) || within(real, w));
    const clash = within(home, real)
      ? `covers $HOME (${home})`
      : write && `overlaps the writable ${write}`;
    if (clash) {
      throw new Error(
        `refusing to build the jail: runtime tree ${tree} ${clash}; it would be readable and executable`,
      );
    }
  }
}

// The system services (mach-lookup global names) a jailed process may reach, by
// exact name. Every other service is denied by `(deny default)`, and that is what
// keeps LaunchServices (`open`) and Apple Events (`osascript`) from starting or
// driving a program OUTSIDE the jail, as the operator: both reach their broker
// through a mach-lookup global name this deny closes. launchd is different:
// `launchctl` reaches it over the task's bootstrap port, not a mach-lookup name,
// so this allowlist does not gate it at all — launchd applies its own checks per
// subcommand instead (see the DEBT note on buildSeatbeltProfile for what those
// checks still let through). Derived
// empirically: the jailed post-session step (git, node --test), `claude --version`
// and an HTTPS fetch all run with none; user lookup is the one thing that fails
// without it (node's os.userInfo() throws), and it answers directory queries only.
// A live `claude` session was not run to derive this list (API spend); if one needs
// another service (evals/README.md says how to read the denied name from the unified
// log), add that one exact name after checking it cannot launch, drive or act for
// the caller as a program (keychain, preferences and login-item services can), never
// a prefix or a bare `(allow mach-lookup)`. A test pins the whole generated
// profile as fixed text, so the addition is also a visible test edit.
const JAIL_MACH_SERVICES = [
  "com.apple.system.opendirectoryd.libinfo", // getpwuid/getgrgid: user and group lookup
];

// Generate a seatbelt (sandbox_init) profile as a string. Pure and unit-testable:
// no IO, deterministic given its inputs. The policy is deny-by-default: the first
// rule is `(deny default)`, and only the following are allowed back.
//   - PROCESSES: fork; exec of `allowExec` (the node, claude and git install trees)
//     and the system shells and tools in /bin and /usr/bin (sh, env, the xcrun git
//     shim); signals only to processes in the same jail; sysctl reads.
//   - READS everywhere EXCEPT under the operator's $HOME (ssh keys, credentials,
//     documents); under $HOME only `allowWrite` and the `allowRead` runtime trees.
//     Never a terminal: `/dev/tty` and the pty slaves `/dev/ttysN` are denied (the
//     last rule), so nothing the operator types during a run can be read. That
//     closes opening one by path only: a terminal fd already open reads freely,
//     and a shell's terminal is one read-write file on fds 0, 1 and 2 alike. So
//     fds 0, 1 and 2 of every jailed child must not be the terminal: each spawn
//     pipes or ignores all three (never "inherit"), and libuv passes no other fd.
//     A pty test pins this from inside each spawned process: the claude session
//     and the test command, jailed and not; the jailed post-session step; and the
//     runner's own git calls wherever PATH can shadow git (the jailed git calls
//     hold the post-session step's fds). The legacy BSD pty pairs
//     (`/dev/ttyp0`, `/dev/ptyp0`, ...) are left readable: no shell runs on them.
//   - WRITES only to `allowWrite` (the trial's own config dir, fixture and temp dir)
//     and /dev/null. Not a user-writable PATH dir such as /opt/homebrew/bin, not
//     another trial's dirs, not the runner's.
//   - SERVICES: only JAIL_MACH_SERVICES, by exact name.
//   - NETWORK: outbound IP (the session must reach the model API, directly or via
//     the operator's opt-in proxy) and the DNS resolver's socket. No other unix
//     socket, so no local daemon reachable that way (a Docker socket, say).
//
// DEBT: four allowances stay broad. (1) Reads outside $HOME: the session can read
// anything there the operator's user can but a terminal, other trials' dirs
// included; (2) exec of everything in /bin, /usr/bin and the runtime trees' whole
// dirs (`open`, `launchctl` and `osascript` included) — safe for `open` and
// `osascript` because the mach-lookup services they'd need to act outside the
// jail are denied, but NOT for `launchctl`, see (4); (3) outbound IP to any host
// and port, localhost included, so a local TCP service that runs commands on
// request would act for the session; (4) `launchctl` reaches launchd over the
// task's bootstrap port, which this profile cannot deny, and launchd applies its
// own checks per subcommand: `submit`, `bootstrap`, `load`, `kill`, `bootout` and
// `setenv` are refused, but `kickstart gui/<uid>/<label>` starts an already-loaded
// job of the operator's outside the jail, and `disable gui/<uid>/<label>` writes a
// disabled entry to launchd's override store that persists across reboot.
// Ceiling: fine for a maintainer-run gate on trusted, repo-authored cases — not
// for untrusted input. Upgrade path for (4): run untrusted cases on an ephemeral
// machine (a CI runner or a VM) instead of the operator's own session, since that
// also moves the jailed process out of the operator's launchd domain, which is
// what actually closes it. Upgrade path for (1)-(3): a read allowlist (the
// runtime trees, system libraries, the trial dirs) in place of (1), exec of
// exactly the resolved binaries in place of (2), and a forwarder that gives the
// session one loopback port to the API in place of (3) (the same one the
// credential DEBT on buildChildEnv names).
//
// SBPL is last-match-wins: the broad rules come first, then the narrow ones
// override them for their paths.
export function buildSeatbeltProfile({ home, allowWrite = [], allowRead = [], allowExec = [] }) {
  // Escape backslashes and quotes so a path with either can't break out of the
  // SBPL string literal (macOS paths rarely contain them, but never trust input).
  const esc = (p) => p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const subpaths = (paths) =>
    [...new Set(paths.filter((p) => typeof p === "string" && p))].map(
      (p) => `  (subpath "${esc(p)}")`,
    );
  const lines = [
    "(version 1)",
    ";; harry evals seatbelt profile (opt-in EVALS_SANDBOX=1, agentic sessions).",
    ";; Deny everything, then allow back only what node, claude and git need:",
    ";; no mach-lookup service can start a program outside this jail (launchd's",
    ";; bootstrap port is a separate, narrower exception; see the DEBT note).",
    "(deny default)",
    "(allow process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow file-read*)",
    `(deny file-read* (subpath "${esc(home)}"))`,
    '(allow file-read* file-write* (literal "/dev/null"))',
    "(allow mach-lookup",
    ...JAIL_MACH_SERVICES.map((name) => `  (global-name "${esc(name)}")`),
    ")",
    '(allow network-outbound (remote ip "*:*"))',
    '(allow network-outbound (literal "/private/var/run/mDNSResponder"))',
    "(allow process-exec",
    ...subpaths(jailExecDirs(allowExec)),
    ")",
  ];
  const writes = subpaths(allowWrite);
  if (writes.length) {
    lines.push(
      ";; read+write: this trial's config dir, fixture repo and temp dir only.",
      "(allow file-read* file-write*",
      ...writes,
      ")",
    );
  }
  const reads = subpaths(allowRead);
  if (reads.length) {
    lines.push(
      ";; read-only: claude + node runtime install trees, and the runner script.",
      "(allow file-read*",
      ...reads,
      ")",
    );
  }
  lines.push(
    ";; no terminal reads (what the operator types); last, so no allow above re-opens it.",
    '(deny file-read* (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))',
  );
  return `${lines.join("\n")}\n`;
}

// Every dir a jailed process may exec from: the system shells and tools, then the
// runtime trees. The one list both the profile's process-exec rule and the jailed
// PATH (jailedPath) are built from, so the two cannot drift apart.
export function jailExecDirs(trees = []) {
  return ["/bin", "/usr/bin", ...trees];
}

// The PATH for a jailed child: the base PATH (running node's dir first, absolute
// entries only) cut down to the entries whose canonical path lies inside a dir the
// jail may exec from, in their original order. A name lookup walks PATH, and
// libuv's walk (like execvp's) stops at the first entry that fails with anything
// but ENOENT: an entry the jail denies can answer EPERM, and the lookup then fails
// although an allowed copy sits further along. Kept entries can only miss (ENOENT)
// or hit an allowed binary. The binaries runEvals resolved (findOnPath) stay the
// first match: their dirs are runtime trees, and every entry dropped before them
// held no match, or findOnPath would have picked it.
export function jailedPath(env, execDirs) {
  const canonical = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return null; // missing entry: nothing to find there, drop it
    }
  };
  const allowed = [...new Set(execDirs.map(canonical).filter(Boolean))];
  const inside = (p) => allowed.some((d) => p === d || p.startsWith(`${d}/`));
  return buildBaseEnv(env)
    .PATH.split(delimiter)
    .filter((entry) => {
      const real = canonical(entry);
      return real !== null && inside(real);
    })
    .join(delimiter);
}

// Build the sandbox-exec argv that wraps the original `bin args...` under `profile`.
// Pure, so a test can assert the exact wrapped shape without executing sandbox-exec.
// `sandbox-exec -p <profile> <bin> <args...>` runs bin inside the seatbelt policy.
export function wrapWithSandbox(sandboxExec, profile, bin, args) {
  return { bin: sandboxExec, args: ["-p", profile, bin, ...args] };
}

// Resolve the claude, node and git install trees the jail must let a process read
// (under $HOME) and exec (everywhere). For each: take the resolved launcher path,
// follow symlinks (realpath), and allow BOTH the launcher's dir and the resolved
// target's dir — a launcher symlink and its real payload can live in different
// trees, and the kernel reads both to exec. Best-effort: a path that can't be
// resolved is simply skipped (the jail stays closed; a genuinely-needed missing
// tree surfaces as a session failure, not a leak).
function resolveRuntimeTrees(bin, env = process.env, gitBin = null) {
  const trees = new Set();
  const addDirs = (p) => {
    if (!p) return;
    try {
      trees.add(dirname(p));
    } catch {
      /* unresolved path: skip */
    }
    try {
      trees.add(dirname(realpathSync(p)));
    } catch {
      /* broken symlink / missing: skip */
    }
  };
  // node: the runtime that actually executes the session's `node` and claude's cli.
  addDirs(process.execPath);
  // claude: runEvals hands in an absolute path; a bare name (a direct caller) is
  // looked up in-process, never by spawning `which`.
  addDirs(bin ? findOnPath(bin, env) : null);
  // git: the resolved binary, plus the real git and its helpers behind it. The
  // pre-resolved gitBin reports its own exec path (<prefix>/libexec/git-core); the
  // real binary sits in <prefix>/bin, which is what /usr/bin/git (Apple's xcrun
  // shim) execs. The exec path is canonicalized first, and <prefix>/bin derived
  // from the canonical one: Homebrew's git reports it through the `opt` symlink
  // (/opt/homebrew/opt/git/libexec/git-core -> Cellar/git/<v>/...), and seatbelt
  // matches the canonical path, so a rule spelled through the symlink never matches.
  if (gitBin) {
    addDirs(gitBin);
    try {
      const execPath = git(["--exec-path"], tmpdir(), env, gitBin);
      if (isAbsolute(execPath)) {
        const real = realpathSync(execPath);
        trees.add(real);
        trees.add(resolve(real, "..", "..", "bin"));
      }
    } catch {
      /* no exec path: git's helpers stay unexecutable; the jailed step fails, closed */
    }
  }
  return [...trees];
}

// Pure gate: given the platform and the resolved sandbox-exec path, return the path
// or THROW. The whole point is "never silently unsandboxed": if EVALS_SANDBOX=1 is
// set but we can't sandbox (not macOS, or sandbox-exec absent), we refuse hard
// BEFORE any session starts rather than run an agentic session in the open.
//
// DEBT: the jail relies on `sandbox-exec`, which Apple has deprecated but still ships
// and honors. It is opt-in and macOS-only (a hard refusal elsewhere, never a silent
// unsandboxed run). Ceiling: works only while macOS keeps shipping and honoring
// sandbox-exec, which is accepted for a local maintainer tool rather than taking on a
// container/VM dependency now. Upgrade path: if Apple removes it or stops honoring
// profiles, move the agentic session and the post-session step into a disposable VM
// or container, which would also bring Linux into scope.
export function requireSandboxSupport(platform, sandboxExecPath) {
  if (platform !== "darwin") {
    throw new Error(
      `EVALS_SANDBOX=1 is macOS-only (seatbelt/sandbox-exec); refusing to run an ` +
        `agentic session unsandboxed on "${platform}". Unset EVALS_SANDBOX to run without the jail.`,
    );
  }
  if (!sandboxExecPath) {
    throw new Error(
      "EVALS_SANDBOX=1 is set but sandbox-exec was not found; refusing to run an agentic " +
        "session unsandboxed. (Expected /usr/bin/sandbox-exec; override with EVALS_SANDBOX_EXEC.)",
    );
  }
  return sandboxExecPath;
}

// Locate sandbox-exec. EVALS_SANDBOX_EXEC overrides (present-but-empty means "not
// found", a deterministic test/refusal seam); otherwise look it up on PATH
// in-process (findOnPath), once, before the first session.
function resolveSandboxExec(env) {
  if (env.EVALS_SANDBOX_EXEC !== undefined) {
    return env.EVALS_SANDBOX_EXEC ? resolve(env.EVALS_SANDBOX_EXEC) : null;
  }
  return findOnPath("sandbox-exec", env);
}

// Decide whether agentic sessions run inside the seatbelt jail, throwing on refusal.
// Null (no wrapping) when the flag is off, or when there is no runnable agentic case
// — text mode has no exec surface, so it ignores the flag entirely. When the flag is
// on AND an agentic case will run, support is mandatory: requireSandboxSupport
// refuses hard rather than silently run unsandboxed.
function sandboxContext(env, runnable) {
  if (env.EVALS_SANDBOX !== "1") return null;
  if (!runnable.some((c) => c.mode === "agentic")) return null;
  return { sandboxExec: requireSandboxSupport(process.platform, resolveSandboxExec(env)) };
}

// ---- run (side-effecting) --------------------------------------------------

export function runEvals(opts, env = process.env) {
  const condition = opts.condition;
  if (!CONDITIONS.has(condition)) {
    throw new Error(`--condition must be one of ${[...CONDITIONS].join(", ")}`);
  }
  const model = resolveModel(opts, env);
  const trials = resolveTrials(opts);
  const timeoutMs =
    Number.isInteger(opts.postSessionTimeoutMs) && opts.postSessionTimeoutMs > 0
      ? opts.postSessionTimeoutMs
      : DEFAULT_POST_SESSION_TIMEOUT_MS;

  const { cases, errors } = parseCasesJsonl(readFileSync(casesPath(), "utf8"));
  if (errors.length) throw new Error(`cases.jsonl parse errors:\n${errors.join("\n")}`);
  const violations = validateCases(cases);
  if (violations.length) throw new Error(`cases.jsonl is invalid:\n${violations.join("\n")}`);

  const explicitSelection = Boolean(opts.cases);
  const selected = opts.cases ? cases.filter((c) => opts.cases.includes(c.id)) : cases;
  if (selected.length === 0) throw new Error("no cases selected");

  // Cost gate: agentic cases run a FULL headless session each (real spend). They
  // require the explicit --agentic release gate. Naming one by id without the
  // flag is a hard refusal; a full run without it silently skips them (notice).
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
  // this throws (never a silent unsandboxed run). Null → run unwrapped as before.
  const sandbox = sandboxContext(env, runnable);

  // Same "before any dir/session starts" timing as the sandbox refusal above: with
  // both or neither EVALS_ auth var set, refuse now with one clear message rather
  // than mid-batch, trial by trial.
  resolveAuth(env);

  // Every binary the runner spawns is resolved to an absolute path HERE, before the
  // first session, and never looked up on PATH again (see findOnPath). Still before
  // any dir exists: a missing binary refuses the run up front.
  const claudeBin = requireOnPath(env.EVALS_CLAUDE_BIN || "claude", env, "the claude CLI");
  const gitBin = runnable.some((c) => c.mode === "agentic") ? requireOnPath("git", env) : null;

  const lawsText = condition === "candidate" ? readFileSync(lawsPath(), "utf8") : "";
  // Provenance stamped onto every result line. Without it a results file cannot be
  // attributed to a law text at all: on 2026-07-30 a probe's failure was read as a
  // regression, two law edits were made on that reading, and the only way anyone
  // could later recover WHICH text each run used was that the throwaway mkdtemp
  // config dirs happened not to have been reaped yet. That is luck, not a record.
  // `lawSha256` is what lets `score` refuse to pool trials across different texts.
  // The `claude` CLI version is deliberately NOT probed: it would cost one extra
  // invocation of the binary per run, and the tests count invocations because that
  // count IS the spend contract. A CLI change therefore remains indistinguishable
  // from a model-alias change after the fact — a known gap, not an oversight.
  const provenance = {
    lawBytes: Buffer.byteLength(lawsText),
    lawSha256: lawsText ? createHash("sha256").update(lawsText).digest("hex").slice(0, 16) : null,
    sandbox: Boolean(sandbox),
  };
  const outPath =
    opts.out ||
    join(pluginRoot, "evals", "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  mkdirSync(dirname(outPath), { recursive: true });

  // Each trial gets its own dirs under this root (prepareTrialDirs), left in place
  // for post-hoc inspection. EVALS_FIXTURE_ROOT names it; default the OS temp dir.
  const trialsRoot = env.EVALS_FIXTURE_ROOT || tmpdir();
  const written = [];
  for (const c of runnable) {
    if (!SUPPORTED_MODES.has(c.mode)) throw new Error(`case "${c.id}": unsupported mode ${c.mode}`);
    // Trials are 1-based on the wire (trial: 1..N); score treats a legacy line
    // with no `trial` field as trial 1, so the two formats pool coherently.
    for (let trial = 1; trial <= trials; trial++) {
      const dirs = prepareTrialDirs(condition, lawsText, trialsRoot);
      const line = {
        id: c.id,
        mode: c.mode,
        condition,
        trial,
        model,
        law: c.law,
        informative: c.informative === true,
        prompt: c.prompt,
        checks: c.checks,
        trialDir: dirs.trialDir,
        configDir: dirs.configDir,
        workDir: dirs.workDir,
        ...provenance,
        timestamp: new Date().toISOString(),
      };
      try {
        // mode dispatch: text judges first-response prose; agentic materializes a
        // throwaway fixture repo, runs a full session in it, then judges artifacts.
        if (c.mode === "agentic") {
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
            env,
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
          );
          // Record per-check outcomes (same shape as agentic lines) so an
          // inspector can see WHICH check failed without re-scoring. Scoring
          // still re-evaluates text lines from `response`, so these are
          // informational and never the source of truth.
          const { results } = evaluateChecks(c.checks, line.response);
          line.checkOutcomes = results.map((r) => ({
            check: r.check,
            ok: r.ok,
            detail: r.matched ? "pattern matched" : "pattern did not match",
          }));
        }
      } catch (err) {
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

// ---- CLI -------------------------------------------------------------------

const VALUE_FLAGS = new Set([
  "--condition",
  "--model",
  "--cases",
  "--out",
  "--results",
  "--trials",
]);

// Boolean flags take no value — presence is the whole signal.
const BOOL_FLAGS = new Set(["--agentic"]);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOL_FLAGS.has(a)) {
      if (a === "--agentic") opts.agentic = true;
      continue;
    }
    if (!VALUE_FLAGS.has(a)) throw new Error(`unknown or misplaced argument: ${a}`);
    // Guard the value: a flag as the last token (or a value that is itself the
    // next flag) is a user error — report it, don't TypeError on undefined.
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
  const { cases, errors } = parseCasesJsonl(readFileSync(casesPath(), "utf8"));
  const violations = [...errors, ...validateCases(cases)];
  if (violations.length) {
    console.error(`cases.jsonl: ${violations.length} problem(s):`);
    for (const v of violations) console.error(`  - ${v}`);
    return 1;
  }
  console.log(`cases.jsonl: OK (${cases.length} cases)`);
  return 0;
}

function cmdRun(opts, env) {
  const { outPath, lines, skipped } = runEvals(opts, env);
  const failed = lines.filter((l) => l.error).length;
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

function cmdScore(opts) {
  if (!opts.results) {
    console.error("score: --results <path> is required");
    return 1;
  }
  const { cases: lines, errors } = parseCasesJsonl(readFileSync(opts.results, "utf8"));
  if (errors.length) {
    for (const e of errors) console.error(`  - ${e}`);
    return 1;
  }
  const { groups, summary, candidateFailed } = scoreResults(lines);
  const pad = (s, n) => String(s).padEnd(n);
  // A group is one (case, condition): its verdict is a strict majority of its
  // pooled trials, shown as a tally, e.g. PASS (2/3) / FAIL (1/3). Graded groups
  // gate the run; informative groups are printed separately and never affect the
  // exit code.
  const graded = groups.filter((g) => !g.informative);
  const informative = groups.filter((g) => g.informative);
  // An errored trial counts as a failing trial (it is in the denominator); when
  // any trial errored, surface the count so `FAIL (0/3, 3 error)` is legible as
  // "all errored", not "all genuinely non-compliant".
  // A MIXED-LAW group averaged trials across more than one HARRY.md, so its
  // verdict describes no single text — say so on the row rather than printing a
  // number that reads like a measurement.
  const verdict = (g) =>
    `${g.pass ? "PASS" : "FAIL"} (${g.passCount}/${g.trials}${g.errors ? `, ${g.errors} error` : ""})${
      g.mixedLaw
        ? `  ⚠ MIXED LAW TEXT (${g.lawShas.length} versions — verdict describes neither)`
        : ""
    }`;
  // Column width spans EVERY printed id — graded AND informative — plus the
  // "case" header, so a long informative id can't overflow into the condition
  // column of either section (both use the same width). +2 for breathing room.
  const idWidth = Math.max(4, ...groups.map((g) => g.id.length), "case".length) + 2;
  const row = (g) =>
    `${pad(g.id, idWidth)}${pad(g.condition, 12)}${pad(g.law ?? "", 8)}${verdict(g)}`;
  console.log(`${pad("case", idWidth)}${pad("condition", 12)}${pad("law", 8)}result`);
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
  // Counts are GROUPS (case × condition), each a strict-majority verdict over
  // its pooled trials — the trailing count is how many raw trial lines pooled.
  console.log(
    `\ncandidate: ${summary.candidatePass}/${summary.candidateTotal} groups passed` +
      ` · baseline (contrast): ${summary.baselinePass}/${summary.baselineTotal} groups passed` +
      informativeLine +
      ` · (${summary.trials} trial line(s) pooled)`,
  );
  return candidateFailed ? 1 : 0;
}

export function main(argv, env = process.env) {
  const [sub, ...rest] = argv;
  try {
    // Inside the try: a malformed flag (e.g. a value flag with no value) is a
    // clean exit-1 with a message, not an uncaught throw.
    const opts = parseArgs(rest);
    if (sub === "validate") return cmdValidate();
    if (sub === "run") return cmdRun(opts, env);
    if (sub === "score") return cmdScore(opts);
    if (sub === POST_SESSION) return cmdPostSession();
    console.error("usage: run-evals.mjs <validate|run|score> [options]");
    return 2;
  } catch (err) {
    console.error(err.message);
    return 1;
  }
}

// Only run the CLI when invoked directly, not when imported by a test.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
