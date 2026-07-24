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
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CHECK_TYPES = new Set(["regex_must", "regex_must_not"]);
// Only text cases exist today. Agentic (fixture-repo) mode arrives separately;
// the run loop dispatches on `mode` so a second mode slots in without rework.
const SUPPORTED_MODES = new Set(["text"]);
const CONDITIONS = new Set(["baseline", "candidate"]);

function casesPath() {
  return join(pluginRoot, "evals", "cases.jsonl");
}

function lawsPath() {
  return join(pluginRoot, "HARRY.md");
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
    if (!Array.isArray(c.checks) || c.checks.length === 0) {
      violations.push(`${where}: "checks" must be a non-empty array`);
      return;
    }
    c.checks.forEach((check, ci) => {
      const cw = `${where} check #${ci + 1}`;
      if (!check || typeof check !== "object") {
        violations.push(`${cw}: not an object`);
        return;
      }
      if (!CHECK_TYPES.has(check.type)) {
        violations.push(`${cw}: "type" must be one of ${[...CHECK_TYPES].join(", ")}`);
      }
      if (typeof check.pattern !== "string" || !check.pattern) {
        violations.push(`${cw}: missing/empty string "pattern"`);
      } else {
        try {
          compileCheck(check);
        } catch (err) {
          violations.push(`${cw}: invalid regex (${err.message})`);
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

// Score a whole results array. Each result carries its own checks (embedded at
// run time) so scoring is self-contained and never drifts from a mutated cases
// file. Returns per-(id,condition) rows plus a summary; candidateFailed drives
// the CLI exit code (candidate must pass; baseline is only contrast).
export function scoreResults(lines) {
  const rows = lines.map((line) => {
    const { pass, results } = evaluateChecks(line.checks, line.response);
    const passed = line.error ? false : pass;
    return {
      id: line.id,
      condition: line.condition,
      trial: line.trial ?? 0,
      law: line.law,
      pass: passed,
      error: line.error ?? null,
      failures: results.filter((r) => !r.ok).map((r) => r.check),
    };
  });
  const candidate = rows.filter((r) => r.condition === "candidate");
  const baseline = rows.filter((r) => r.condition === "baseline");
  return {
    rows,
    summary: {
      total: rows.length,
      candidatePass: candidate.filter((r) => r.pass).length,
      candidateTotal: candidate.length,
      baselinePass: baseline.filter((r) => r.pass).length,
      baselineTotal: baseline.length,
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
export function prepareConditionDir(condition, lawsText, root = tmpdir()) {
  const dir = mkdtempSync(join(root, `harry-evals-${condition}-`));
  if (condition === "candidate") {
    writeFileSync(join(dir, "CLAUDE.md"), lawsText);
  }
  return dir;
}

// Extract the assistant text from `claude -p --output-format json` output.
function extractResponse(stdout) {
  const parsed = JSON.parse(stdout);
  if (typeof parsed.result === "string") return parsed.result;
  return JSON.stringify(parsed);
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
  const stdout = execFileSync(bin, args, {
    cwd: workDir,
    env: { ...env, CLAUDE_CONFIG_DIR: configDir },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return extractResponse(stdout);
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

  const selected = opts.cases ? cases.filter((c) => opts.cases.includes(c.id)) : cases;
  if (selected.length === 0) throw new Error("no cases selected");

  const lawsText = condition === "candidate" ? readFileSync(lawsPath(), "utf8") : "";
  // One config dir per condition, reused across cases (and left in place for
  // post-hoc inspection — each `run` makes at most one dir). The workDir is a
  // separate EMPTY dir used as the child's cwd for every case, so no project
  // CLAUDE.md (this repo's included) is discoverable by walking up from it.
  const configDir = prepareConditionDir(condition, lawsText);
  const workDir = mkdtempSync(join(tmpdir(), "harry-evals-cwd-"));

  const outPath =
    opts.out ||
    join(pluginRoot, "evals", "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  mkdirSync(dirname(outPath), { recursive: true });

  const written = [];
  for (const c of selected) {
    if (!SUPPORTED_MODES.has(c.mode)) throw new Error(`case "${c.id}": unsupported mode ${c.mode}`);
    for (let trial = 0; trial < trials; trial++) {
      const line = {
        id: c.id,
        mode: c.mode,
        condition,
        trial,
        model,
        law: c.law,
        prompt: c.prompt,
        checks: c.checks,
        configDir,
        workDir,
        timestamp: new Date().toISOString(),
      };
      try {
        // mode dispatch — text today; agentic mode plugs in here later.
        line.response = runTextCase(bin, model, c.prompt, configDir, workDir, env);
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
  return { outPath, configDir, workDir, lines: written };
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

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!VALUE_FLAGS.has(a)) throw new Error(`unknown or misplaced argument: ${a}`);
    // Guard the value: a flag as the last token (or a value that is itself the
    // next flag) is a user error — report it, don't TypeError on undefined.
    const value = argv[i + 1];
    if (value === undefined || VALUE_FLAGS.has(value)) {
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
  const { outPath, lines } = runEvals(opts, env);
  const failed = lines.filter((l) => l.error).length;
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
  console.log(`${pad("case", 32)}${pad("condition", 12)}${pad("law", 8)}result`);
  for (const r of rows) {
    const mark = r.pass ? "PASS" : r.error ? "ERROR" : "FAIL";
    console.log(`${pad(r.id, 32)}${pad(r.condition, 12)}${pad(r.law ?? "", 8)}${mark}`);
  }
  console.log(
    `\ncandidate: ${summary.candidatePass}/${summary.candidateTotal} passed` +
      ` · baseline (contrast): ${summary.baselinePass}/${summary.baselineTotal} passed`,
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
