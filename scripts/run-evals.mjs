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
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

function casesPath() {
  return join(pluginRoot, "evals", "cases.jsonl");
}

function lawsPath() {
  return join(pluginRoot, "HARRY.md");
}

function fixturesPath() {
  return join(pluginRoot, "evals", "fixtures");
}

// A git author/committer pinned so fixture commits are attributable and never
// depend on (or touch) the operator's real git identity.
function gitEnv(env) {
  return {
    ...env,
    GIT_AUTHOR_NAME: "Eval Fixture",
    GIT_AUTHOR_EMAIL: "eval@localhost",
    GIT_COMMITTER_NAME: "Eval Fixture",
    GIT_COMMITTER_EMAIL: "eval@localhost",
  };
}

function git(args, cwd, env = process.env) {
  // Neutralize operator git config that could break or side-effect fixture
  // commits: gpg signing (would prompt/fail headless) and repo/global hooks
  // (an empty hooksPath disables them). Prepended so per-call args still win.
  const hardened = ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...args];
  return execFileSync("git", hardened, {
    cwd,
    env: gitEnv(env),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
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

// ---- agentic: fixture materialization + repo state (side-effecting) --------

// Copy a committed fixture into a fresh temp dir, `git init` it there, and make
// one pinned initial commit. Returns the working dir plus the initial branch and
// commit SHA (the baseline the artifact checks diff against). NEVER runs inside
// the repo — the copy lands under `root` (default the OS temp dir).
export function materializeFixture(name, root = tmpdir(), env = process.env) {
  const src = join(fixturesPath(), name);
  if (!existsSync(src)) {
    throw new Error(`unknown fixture "${name}" (looked in ${fixturesPath()})`);
  }
  const dir = mkdtempSync(join(root, `harry-evals-fx-${name}-`));
  cpSync(src, dir, { recursive: true });
  // `-b main` isn't portable to older git; set the default branch via config so
  // the initial branch name is deterministic. We still read it back below.
  git(["-c", "init.defaultBranch=main", "init"], dir, env);
  // Pin the identity in the repo's LOCAL config: gitEnv() only shields the
  // runner's own git calls, but the session under test commits with its own
  // env, and a machine with no git identity (CI runners) fatals on
  // auto-detect. Local config covers every committer in this repo.
  git(["config", "user.name", "Eval Fixture"], dir, env);
  git(["config", "user.email", "eval@localhost"], dir, env);
  git(["add", "-A"], dir, env);
  git(["commit", "-m", "chore: seed eval fixture"], dir, env);
  const initialBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], dir, env);
  const initialCommit = git(["rev-parse", "HEAD"], dir, env);
  return { dir, initialBranch, initialCommit };
}

// Snapshot the post-session repo state the artifact checks judge: the branches,
// the messages of commits that are NEW since the seed, and the tracked+untracked
// file list (minus .git). Reads only — deterministic given the repo on disk.
export function collectRepoState(fixtureDir, initialBranch, initialCommit, env = process.env) {
  const branches = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], fixtureDir, env)
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);
  // All commit messages across every branch, minus the seed commit's.
  const commitLog = git(["log", "--all", "--format=%H%x1f%s"], fixtureDir, env);
  const newCommitMessages = commitLog
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\x1f"))
    .filter(([sha]) => sha !== initialCommit)
    .map(([, subject]) => subject ?? "");
  const tracked = git(["ls-files"], fixtureDir, env).split("\n");
  const untracked = git(["ls-files", "--others", "--exclude-standard"], fixtureDir, env).split(
    "\n",
  );
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
    env,
  };
}

// Read a repo file's contents, or "" if missing/unreadable (fixtures are text).
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
      try {
        execFileSync(cmd, args, {
          cwd: state.fixtureDir,
          env: state.env ?? process.env,
          stdio: "ignore",
          maxBuffer: 32 * 1024 * 1024,
        });
        return { check, ok: true, detail: `${command} exited 0` };
      } catch (err) {
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

// Create an isolated CLAUDE_CONFIG_DIR for a condition. candidate gets a
// CLAUDE.md inlining the laws; baseline gets an empty dir (no CLAUDE.md).
//
// A fresh config dir also strips login credentials, so `claude -p` returns
// {"is_error":true,"result":"Not logged in · ..."}. Two auth paths:
//
//   1. SCRATCH TOKEN (preferred, containment): if `EVALS_ANTHROPIC_API_KEY` is
//      set we seed NO credential file at all — invokeClaude passes the key to the
//      child as `ANTHROPIC_API_KEY`. A console API key is independently
//      revocable, and nothing lands on disk to leak into a session's fs.
//   2. SEEDED CREDENTIAL (fallback): otherwise we copy ONLY `.credentials.json`
//      from the operator's real config dir (env.CLAUDE_CONFIG_DIR or ~/.claude),
//      chmod 0600 — and nothing else, because memory isolation (no leaked global
//      CLAUDE.md) is the whole point. runEvals scrubs this copy post-run.
//
// Precedence: EVALS_ANTHROPIC_API_KEY > seeded credentials. Absent both (keychain
// auth) → proceed without either, don't fail.
export function prepareConditionDir(condition, lawsText, root = tmpdir(), env = process.env) {
  const dir = mkdtempSync(join(root, `harry-evals-${condition}-`));
  if (condition === "candidate") {
    writeFileSync(join(dir, "CLAUDE.md"), lawsText);
  }
  // API-key mode authenticates via the child env (invokeClaude), so there is no
  // credential file to seed — the containment win is that nothing is on disk.
  if (env.EVALS_ANTHROPIC_API_KEY) return dir;
  const realConfigDir = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const credSrc = join(realConfigDir, ".credentials.json");
  if (existsSync(credSrc)) {
    const credDst = join(dir, ".credentials.json");
    copyFileSync(credSrc, credDst);
    chmodSync(credDst, 0o600);
  }
  return dir;
}

// Delete a seeded `.credentials.json` from a config dir, if present. The config
// dir itself may stay (post-hoc inspection value) — but never with a live
// credential inside it. Idempotent and missing-safe (force).
function scrubCredential(configDir) {
  rmSync(join(configDir, ".credentials.json"), { force: true });
}

// Extract the assistant text from `claude -p --output-format json` output. A
// result with `is_error: true` (e.g. "Not logged in") can still arrive on a
// zero exit, so it is treated as a case error carrying the `result` text rather
// than being scored as a genuine response.
function extractResponse(stdout) {
  const parsed = JSON.parse(stdout);
  if (parsed.is_error === true) {
    const detail = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed);
    throw new Error(`claude returned an error result: ${detail}`);
  }
  if (typeof parsed.result === "string") return parsed.result;
  return JSON.stringify(parsed);
}

// Run the claude CLI and decode its response. On an execFileSync failure
// (nonzero exit or spawn error), surface a structured {is_error} stdout if the
// child still printed one, otherwise attach stdout/stderr tails so a failing
// line carries a real diagnostic instead of a bare "Command failed".
function invokeClaude(bin, args, cwd, configDir, env) {
  const childEnv = { ...env, CLAUDE_CONFIG_DIR: configDir };
  // Auth is deterministic and opt-in. EVALS_ANTHROPIC_API_KEY (the scratch-token
  // path) is the ONLY thing that activates API-key auth for the child. We
  // deliberately do NOT honor a bare `ANTHROPIC_API_KEY` inherited from the
  // operator's shell — requiring the EVALS_ prefix means an unrelated key sitting
  // in the environment can never be billed by accident. So: set it from the
  // EVALS_ var when present, otherwise STRIP any inherited one so seeded-
  // credential auth is what's actually used.
  if (env.EVALS_ANTHROPIC_API_KEY) {
    childEnv.ANTHROPIC_API_KEY = env.EVALS_ANTHROPIC_API_KEY;
  } else {
    delete childEnv.ANTHROPIC_API_KEY;
  }
  try {
    const stdout = execFileSync(bin, args, {
      cwd,
      env: childEnv,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return extractResponse(stdout);
  } catch (err) {
    const stdout = err?.stdout ? String(err.stdout) : "";
    if (stdout.trim().startsWith("{")) {
      // The child exited nonzero but still emitted a JSON result — decode it
      // (this rethrows the readable is_error message when present).
      return extractResponse(stdout);
    }
    const tail = (s) => (s ? String(s).trim().slice(-800) : "");
    const parts = [err?.message ?? "claude invocation failed"];
    const out = tail(err?.stdout);
    const errOut = tail(err?.stderr);
    if (out) parts.push(`stdout: ${out}`);
    if (errOut) parts.push(`stderr: ${errOut}`);
    throw new Error(parts.join("\n"));
  }
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
function runTextCase(bin, model, prompt, configDir, workDir, env) {
  const args = ["-p", prompt, "--model", model, "--output-format", "json", "--allowedTools", ""];
  return invokeClaude(bin, args, workDir, configDir, env);
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
// EVALS_SANDBOX=1 seatbelt jail (see buildSeatbeltProfile / sandboxContext),
// which denies the session reads/writes across the operator's wider $HOME.
//
// DEBT: two residuals remain by accepted design, both scoped to a maintainer-run,
// local release gate on trusted prompts. (1) The child inherits the operator's WHOLE
// environment (the API credential — the revocable scratch key EVALS_ANTHROPIC_API_KEY,
// preferred, nothing on disk, or the fallback seeded credential scrubbed post-run —
// but also any GITHUB_TOKEN / AWS_* / other secret sitting in the shell). No OS
// sandbox can hide an env var from the session's own processes, and network stays
// OPEN under the jail (the session must reach the API), so a hostile session could
// exfiltrate any of them. The seatbelt jail contains the FILESYSTEM ($HOME reads /
// out-of-fixture writes), not the env or the network — this is fs-containment, not a
// no-exfiltration boundary. The mitigation is scope: trusted prompts + a revocable
// scratch key + a shell that doesn't carry secrets you'd mind. (2) EVALS_SANDBOX
// relies on `sandbox-exec`, which Apple has deprecated but still ships and honors;
// it is opt-in and macOS-only (a hard refusal, never a silent unsandboxed run,
// elsewhere), so we accept the deprecated tool for this local use rather than take
// on a container/VM dependency.
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
function runAgenticCase(bin, model, prompt, configDir, fixtureDir, env, sandbox = null) {
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
  if (!sandbox) {
    return invokeClaude(bin, args, fixtureDir, configDir, env);
  }
  // Opt-in EVALS_SANDBOX: wrap the child in a seatbelt jail that denies fs access
  // across the operator's wider $HOME (see sandboxContext for the refusal path).
  // The jail root and the writable exceptions are canonicalized (realpath) — the
  // throwaway config dir, the materialized fixture repo, and the OS temp roots they
  // live under (normally outside $HOME; re-allowed defensively for a $HOME-based
  // TMPDIR). The runtime read trees are resolved inside buildAgenticSandboxProfile.
  const profile = buildAgenticSandboxProfile({
    home: homedir(),
    allowWrite: [configDir, fixtureDir, env.EVALS_FIXTURE_ROOT || tmpdir(), tmpdir()],
    bin,
  });
  const wrapped = wrapWithSandbox(sandbox.sandboxExec, profile, bin, args);
  // Pin a git identity + steer git off $HOME's global config, so the session can
  // commit (the artifact checks require it) without the jail having to re-open
  // ~/.gitconfig — keeping the $HOME fs-jail fully closed. GIT_CONFIG_GLOBAL points
  // git at /dev/null (an empty global config) instead of ~/.gitconfig.
  const sandboxEnv = { ...gitEnv(env), GIT_CONFIG_GLOBAL: "/dev/null" };
  return invokeClaude(wrapped.bin, wrapped.args, fixtureDir, configDir, sandboxEnv);
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
//   - M-1: the writable exceptions are realpath'd too (best-effort — a defensive
//     re-allow that can't be resolved is dropped, safe-fail), so the documented
//     re-allow for a $HOME-based TMPDIR matches real kernel paths. Deduped by the
//     Set in buildSeatbeltProfile after normalization.
// Read trees come from resolveRuntimeTrees, which already includes canonical
// (dirname-of-realpath) forms.
export function buildAgenticSandboxProfile({ home, allowWrite = [], bin }) {
  const home_ = realpathSync(home); // HARD: refuse (throw) rather than un-jail silently.
  const canonicalizeSafe = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return null; // unresolved defensive re-allow: drop it (safe-fail, jail stays closed)
    }
  };
  const writes = allowWrite.map(canonicalizeSafe).filter(Boolean);
  return buildSeatbeltProfile({
    home: home_,
    allowWrite: writes,
    allowRead: resolveRuntimeTrees(bin),
  });
}

// Generate a seatbelt (sandbox_init) profile as a string. Pure and unit-testable:
// no IO, deterministic given its inputs. The policy is "allow everything, then jail
// the operator's $HOME filesystem": a misbehaving or prompt-injected agentic
// session can't read ssh keys / other credentials / documents under $HOME, nor
// write outside the fixture. Network is intentionally NOT restricted — the session
// must reach the model API, and the env-held key is visible by design (see DEBT).
//
// SBPL is last-match-wins: the broad `(deny ... (subpath HOME))` comes first, then
// the narrow `(allow ...)` exceptions override it for their subpaths.
export function buildSeatbeltProfile({ home, allowWrite = [], allowRead = [] }) {
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
    ";; Allow everything, then jail the operator's $HOME filesystem so a misbehaving",
    ";; or prompt-injected session can't read ssh keys / other credentials /",
    ";; documents, or write outside the fixture. Network stays allowed by design.",
    "(allow default)",
    `(deny file-read* file-write* (subpath "${esc(home)}"))`,
  ];
  const writes = subpaths(allowWrite);
  if (writes.length) {
    lines.push(
      ";; read+write: throwaway config dir, materialized fixture repo, OS temp root.",
      "(allow file-read* file-write*",
      ...writes,
      ")",
    );
  }
  const reads = subpaths(allowRead);
  if (reads.length) {
    lines.push(
      ";; read-only: claude + node runtime install trees (resolved via which+realpath).",
      "(allow file-read*",
      ...reads,
      ")",
    );
  }
  return `${lines.join("\n")}\n`;
}

// Build the sandbox-exec argv that wraps the original `bin args...` under `profile`.
// Pure, so a test can assert the exact wrapped shape without executing sandbox-exec.
// `sandbox-exec -p <profile> <bin> <args...>` runs bin inside the seatbelt policy.
export function wrapWithSandbox(sandboxExec, profile, bin, args) {
  return { bin: sandboxExec, args: ["-p", profile, bin, ...args] };
}

// Resolve the claude + node runtime install trees that must stay readable under the
// $HOME jail. For each: resolve the on-PATH launcher (which), follow symlinks
// (realpath), and allow BOTH the launcher's dir and the resolved target's dir — a
// launcher symlink and its real payload can live in different trees, and the kernel
// reads both to exec. Trees outside $HOME (e.g. Homebrew node) are harmless no-ops.
// Best-effort: a path that can't be resolved is simply skipped (the jail stays
// closed; a genuinely-needed missing tree surfaces as a session failure, not a leak).
function resolveRuntimeTrees(bin) {
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
  // claude: resolve a bare command name via `which`; an explicit path is used as-is.
  let claudePath = bin;
  if (bin && !bin.includes("/")) {
    try {
      claudePath = execFileSync("which", [bin], { encoding: "utf8" }).trim() || bin;
    } catch {
      /* not on PATH: fall through, addDirs will skip an unresolved bare name */
    }
  }
  if (claudePath.includes("/")) addDirs(claudePath);
  return [...trees];
}

// Pure gate: given the platform and the resolved sandbox-exec path, return the path
// or THROW. The whole point is "never silently unsandboxed": if EVALS_SANDBOX=1 is
// set but we can't sandbox (not macOS, or sandbox-exec absent), we refuse hard
// BEFORE any session starts rather than run an agentic session in the open.
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
// found", a deterministic test/refusal seam); otherwise probe PATH via `which`.
function resolveSandboxExec(env) {
  if (env.EVALS_SANDBOX_EXEC !== undefined) return env.EVALS_SANDBOX_EXEC || null;
  try {
    return execFileSync("which", ["sandbox-exec"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
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
  const bin = env.EVALS_CLAUDE_BIN || "claude";
  const trials = resolveTrials(opts);

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
  // One config dir per condition, reused across cases (and left in place for
  // post-hoc inspection — each `run` makes at most one dir). The workDir is a
  // separate EMPTY dir used as the child's cwd for every case, so no project
  // CLAUDE.md (this repo's included) is discoverable by walking up from it.
  const configDir = prepareConditionDir(condition, lawsText, tmpdir(), env);
  // Everything after the config dir exists runs inside try/finally so the seeded
  // credential is scrubbed no matter how we leave — normal return, a per-trial
  // error (those are caught and recorded), or a thrown exception mid-run. The
  // credential's on-disk exposure is thus bounded to the session lifetime.
  try {
    const workDir = mkdtempSync(join(tmpdir(), "harry-evals-cwd-"));

    const outPath =
      opts.out ||
      join(
        pluginRoot,
        "evals",
        "results",
        `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
      );
    mkdirSync(dirname(outPath), { recursive: true });

    const fixtureRoot = env.EVALS_FIXTURE_ROOT || tmpdir();
    const written = [];
    for (const c of runnable) {
      if (!SUPPORTED_MODES.has(c.mode))
        throw new Error(`case "${c.id}": unsupported mode ${c.mode}`);
      // Trials are 1-based on the wire (trial: 1..N); score treats a legacy line
      // with no `trial` field as trial 1, so the two formats pool coherently.
      for (let trial = 1; trial <= trials; trial++) {
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
          configDir,
          workDir,
          ...provenance,
          timestamp: new Date().toISOString(),
        };
        try {
          // mode dispatch: text judges first-response prose; agentic materializes a
          // throwaway fixture repo, runs a full session in it, then judges artifacts.
          if (c.mode === "agentic") {
            const fx = materializeFixture(c.fixture, fixtureRoot, env);
            line.fixture = c.fixture;
            line.fixtureDir = fx.dir;
            line.initialBranch = fx.initialBranch;
            line.initialCommit = fx.initialCommit;
            line.response = runAgenticCase(bin, model, c.prompt, configDir, fx.dir, env, sandbox);
            // Evaluate now, while the fixture dir exists, and record per-check
            // outcomes so `score` can judge offline (matching text mode's shape).
            const state = collectRepoState(fx.dir, fx.initialBranch, fx.initialCommit, env);
            const { results } = evaluateArtifactChecks(c.checks, state);
            line.checkOutcomes = results.map((r) => ({
              check: r.check,
              ok: r.ok,
              detail: r.detail,
            }));
          } else {
            line.response = runTextCase(bin, model, c.prompt, configDir, workDir, env);
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
          line.error = err.message;
        }
        // Append (never truncate): the documented flow runs baseline and candidate
        // as two separate invocations into the SAME --out file, so score can
        // contrast both conditions. Truncating would keep only the last run.
        appendFileSync(outPath, `${JSON.stringify(line)}\n`);
        written.push(line);
      }
    }
    return { outPath, configDir, workDir, lines: written, skipped };
  } finally {
    scrubCredential(configDir);
  }
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
