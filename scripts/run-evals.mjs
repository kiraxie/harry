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
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

// Score a whole results array. Each result carries its own checks (embedded at
// run time) so scoring is self-contained and never drifts from a mutated cases
// file. Returns per-(id,condition) rows plus a summary; candidateFailed drives
// the CLI exit code (candidate must pass; baseline is only contrast).
export function scoreResults(lines) {
  const rows = lines.map((line) => {
    // Agentic lines can't be re-judged offline (the fixture temp dir is gone),
    // so the run recorded per-check outcomes; text lines re-evaluate the
    // response so scoring stays independent of a later-edited cases file.
    const { pass, results } =
      line.mode === "agentic"
        ? {
            pass: (line.checkOutcomes ?? []).every((o) => o.ok),
            results: (line.checkOutcomes ?? []).map((o) => ({ check: o.check, ok: o.ok })),
          }
        : evaluateChecks(line.checks, line.response);
    const passed = line.error ? false : pass;
    return {
      id: line.id,
      condition: line.condition,
      trial: line.trial ?? 0,
      law: line.law,
      informative: line.informative === true,
      pass: passed,
      error: line.error ?? null,
      failures: results.filter((r) => !r.ok).map((r) => r.check),
    };
  });
  // Informative rows are contrast-only: split them out so they never gate the
  // run, and the gating counts (and exit code) consider only the graded rows.
  const graded = rows.filter((r) => !r.informative);
  const candidate = graded.filter((r) => r.condition === "candidate");
  const baseline = graded.filter((r) => r.condition === "baseline");
  const informative = rows.filter((r) => r.informative);
  return {
    rows,
    summary: {
      total: rows.length,
      candidatePass: candidate.filter((r) => r.pass).length,
      candidateTotal: candidate.length,
      baselinePass: baseline.filter((r) => r.pass).length,
      baselineTotal: baseline.length,
      informativePass: informative.filter((r) => r.pass).length,
      informativeTotal: informative.length,
    },
    candidateFailed: candidate.some((r) => !r.pass),
  };
}

// ---- run helpers -----------------------------------------------------------

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
// {"is_error":true,"result":"Not logged in · ..."}. We seed ONLY
// `.credentials.json` from the operator's real config dir (env.CLAUDE_CONFIG_DIR
// or ~/.claude) so the child is authenticated — and nothing else, because memory
// isolation (no leaked global CLAUDE.md) is the whole point. Absent (keychain or
// API-key auth) → proceed without it, don't fail. The copy is chmod 0600.
export function prepareConditionDir(condition, lawsText, root = tmpdir(), env = process.env) {
  const dir = mkdtempSync(join(root, `harry-evals-${condition}-`));
  if (condition === "candidate") {
    writeFileSync(join(dir, "CLAUDE.md"), lawsText);
  }
  const realConfigDir = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const credSrc = join(realConfigDir, ".credentials.json");
  if (existsSync(credSrc)) {
    const credDst = join(dir, ".credentials.json");
    copyFileSync(credSrc, credDst);
    chmodSync(credDst, 0o600);
  }
  return dir;
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
  try {
    const stdout = execFileSync(bin, args, {
      cwd,
      env: { ...env, CLAUDE_CONFIG_DIR: configDir },
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

// Invoke the claude CLI for one AGENTIC case: a full headless session in the
// fixture repo with tools ENABLED (no `--allowedTools ""` kill-switch) and
// `--permission-mode acceptEdits` for non-interactive file edits (a flag
// verified present in `claude --help`; the artifact checks judge what it did).
function runAgenticCase(bin, model, prompt, configDir, fixtureDir, env) {
  const args = [
    "-p",
    prompt,
    "--model",
    model,
    "--output-format",
    "json",
    "--permission-mode",
    "acceptEdits",
  ];
  return invokeClaude(bin, args, fixtureDir, configDir, env);
}

// ---- run (side-effecting) --------------------------------------------------

export function runEvals(opts, env = process.env) {
  const condition = opts.condition;
  if (!CONDITIONS.has(condition)) {
    throw new Error(`--condition must be one of ${[...CONDITIONS].join(", ")}`);
  }
  const model = resolveModel(opts, env);
  const bin = env.EVALS_CLAUDE_BIN || "claude";
  const trials = Math.max(1, Number(opts.trials) || 1);

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

  const lawsText = condition === "candidate" ? readFileSync(lawsPath(), "utf8") : "";
  // One config dir per condition, reused across cases (and left in place for
  // post-hoc inspection — each `run` makes at most one dir). The workDir is a
  // separate EMPTY dir used as the child's cwd for every case, so no project
  // CLAUDE.md (this repo's included) is discoverable by walking up from it.
  const configDir = prepareConditionDir(condition, lawsText, tmpdir(), env);
  const workDir = mkdtempSync(join(tmpdir(), "harry-evals-cwd-"));

  const outPath =
    opts.out ||
    join(pluginRoot, "evals", "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  mkdirSync(dirname(outPath), { recursive: true });

  const fixtureRoot = env.EVALS_FIXTURE_ROOT || tmpdir();
  const written = [];
  for (const c of runnable) {
    if (!SUPPORTED_MODES.has(c.mode)) throw new Error(`case "${c.id}": unsupported mode ${c.mode}`);
    for (let trial = 0; trial < trials; trial++) {
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
          line.response = runAgenticCase(bin, model, c.prompt, configDir, fx.dir, env);
          // Evaluate now, while the fixture dir exists, and record per-check
          // outcomes so `score` can judge offline (matching text mode's shape).
          const state = collectRepoState(fx.dir, fx.initialBranch, fx.initialCommit, env);
          const { results } = evaluateArtifactChecks(c.checks, state);
          line.checkOutcomes = results.map((r) => ({ check: r.check, ok: r.ok, detail: r.detail }));
        } else {
          line.response = runTextCase(bin, model, c.prompt, configDir, workDir, env);
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
  const { rows, summary, candidateFailed } = scoreResults(lines);
  const pad = (s, n) => String(s).padEnd(n);
  // Graded rows gate the run; informative rows are printed separately below and
  // never affect the exit code.
  const graded = rows.filter((r) => !r.informative);
  const informative = rows.filter((r) => r.informative);
  console.log(`${pad("case", 32)}${pad("condition", 12)}${pad("law", 8)}result`);
  for (const r of graded) {
    const mark = r.pass ? "PASS" : r.error ? "ERROR" : "FAIL";
    console.log(`${pad(r.id, 32)}${pad(r.condition, 12)}${pad(r.law ?? "", 8)}${mark}`);
  }
  if (informative.length) {
    console.log("\ninformative (contrast-only — does NOT gate the run):");
    for (const r of informative) {
      const mark = r.pass ? "PASS" : r.error ? "ERROR" : "FAIL";
      console.log(`${pad(r.id, 32)}${pad(r.condition, 12)}${pad(r.law ?? "", 8)}${mark}`);
    }
  }
  const informativeLine = summary.informativeTotal
    ? ` · informative: ${summary.informativePass}/${summary.informativeTotal} passed (ungated)`
    : "";
  console.log(
    `\ncandidate: ${summary.candidatePass}/${summary.candidateTotal} passed` +
      ` · baseline (contrast): ${summary.baselinePass}/${summary.baselineTotal} passed` +
      informativeLine,
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
