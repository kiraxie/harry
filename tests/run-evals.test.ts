// The eval runner backs a regression harness that measures whether HARRY.md
// changes model behavior. These tests never call the real `claude` binary — a
// fake shim (tests/fake-claude.mjs) is wired via EVALS_CLAUDE_BIN — and never
// run a real eval. They cover: schema validation, run-time env isolation
// (baseline dir has no laws, candidate dir does), scoring pass/fail + exit code,
// and the model-pinning refusal.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateChecks,
  main,
  parseCasesJsonl,
  resolveModel,
  runEvals,
  scoreResults,
  validateCases,
} from "../scripts/run-evals.mjs";
import { installFakeClaude, readCalls } from "./fake-claude.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tmpDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---- validate --------------------------------------------------------------

test("validateCases: flags a case missing checks, a bad type, and a broken regex", () => {
  const bad = [
    { id: "no-checks", mode: "text", prompt: "hi", law: "§1", checks: [] },
    {
      id: "bad-type",
      mode: "text",
      prompt: "hi",
      law: "§1",
      checks: [{ type: "regex_maybe", pattern: "x" }],
    },
    {
      id: "bad-regex",
      mode: "text",
      prompt: "hi",
      law: "§1",
      checks: [{ type: "regex_must", pattern: "(" }],
    },
  ];
  const violations = validateCases(bad);
  assert.ok(
    violations.some((v) => v.includes("no-checks") && v.includes("non-empty")),
    "empty checks array is a violation",
  );
  assert.ok(
    violations.some((v) => v.includes("bad-type") && v.includes("type")),
    "unknown check type is a violation",
  );
  assert.ok(
    violations.some((v) => v.includes("bad-regex") && v.includes("invalid regex")),
    "an uncompilable pattern is a violation",
  );
});

test("validateCases: flags an unsupported mode and a duplicate id", () => {
  const bad = [
    {
      id: "dup",
      mode: "text",
      prompt: "hi",
      law: "§1",
      checks: [{ type: "regex_must", pattern: "x" }],
    },
    {
      id: "dup",
      mode: "agentic",
      prompt: "hi",
      law: "§1",
      checks: [{ type: "regex_must", pattern: "x" }],
    },
  ];
  const violations = validateCases(bad);
  assert.ok(
    violations.some((v) => v.includes("duplicate id")),
    "duplicate id caught",
  );
  assert.ok(
    violations.some((v) => v.includes("mode")),
    "unsupported mode caught",
  );
});

test("the shipped evals/cases.jsonl parses and validates clean", () => {
  const text = readFileSync(path.join(pluginRoot, "evals", "cases.jsonl"), "utf8");
  const { cases, errors } = parseCasesJsonl(text);
  assert.equal(errors.length, 0, "no JSONL parse errors");
  assert.ok(cases.length >= 12, "at least 12 cases shipped");
  assert.deepEqual(validateCases(cases), [], "shipped cases are schema-valid");
});

// ---- scoring (core red-green target) ---------------------------------------

test("scoreResults: candidate must pass; a failing candidate check sets candidateFailed", () => {
  const lines = [
    {
      id: "tier",
      condition: "candidate",
      law: "§3",
      response: "This is a Standard tier task; let me plan it.",
      checks: [{ type: "regex_must", pattern: "tier", flags: "i" }],
    },
    {
      id: "tier",
      condition: "baseline",
      law: "§3",
      response: "Sure, here's the code.",
      checks: [{ type: "regex_must", pattern: "tier", flags: "i" }],
    },
  ];
  const scored = scoreResults(lines);
  assert.equal(scored.candidateFailed, false, "candidate satisfied its must-match check");
  assert.equal(scored.summary.candidatePass, 1);
  assert.equal(scored.summary.baselinePass, 0, "baseline is informative contrast and may fail");

  const failing = scoreResults([
    {
      id: "tier",
      condition: "candidate",
      law: "§3",
      response: "Sure, here's the code.",
      checks: [{ type: "regex_must", pattern: "tier", flags: "i" }],
    },
  ]);
  assert.equal(failing.candidateFailed, true, "a candidate that misses a must-match fails the run");
});

test("evaluateChecks: regex_must_not passes only when the pattern is absent", () => {
  const checks = [{ type: "regex_must_not", pattern: "you're right", flags: "i" }];
  assert.equal(evaluateChecks(checks, "Switching to backoff now.").pass, true);
  assert.equal(evaluateChecks(checks, "You're right, switching now.").pass, false);
});

test("score CLI: exits non-zero when a candidate result fails a check", () => {
  const dir = tmpDir("harry-evals-score-");
  try {
    const results = path.join(dir, "r.jsonl");
    writeFileSync(
      results,
      [
        JSON.stringify({
          id: "debt",
          condition: "candidate",
          law: "§4",
          response: "I'll just hardcode it (no marker).",
          checks: [{ type: "regex_must", pattern: "DEBT:" }],
        }),
      ].join("\n"),
    );
    assert.equal(main(["score", "--results", results]), 1, "failing candidate → exit 1");

    writeFileSync(
      results,
      [
        JSON.stringify({
          id: "debt",
          condition: "candidate",
          law: "§4",
          response: "Hardcoding for now with a DEBT: make configurable post-launch.",
          checks: [{ type: "regex_must", pattern: "DEBT:" }],
        }),
      ].join("\n"),
    );
    assert.equal(main(["score", "--results", results]), 0, "passing candidate → exit 0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- run: env isolation via the shim ---------------------------------------

test("runEvals: baseline gives an empty config dir; candidate's inlines the laws", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir);
    const env = { ...process.env, EVALS_CLAUDE_BIN: path.join(binDir, "claude") };

    const baseline = runEvals(
      {
        condition: "baseline",
        model: "test-model",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "b.jsonl"),
      },
      env,
    );
    const candidate = runEvals(
      {
        condition: "candidate",
        model: "test-model",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "c.jsonl"),
      },
      env,
    );

    // The runner's own view of the two isolated config dirs.
    assert.ok(
      !existsSync(path.join(baseline.configDir, "CLAUDE.md")),
      "baseline config dir has no CLAUDE.md → no laws leak",
    );
    const candidateMd = path.join(candidate.configDir, "CLAUDE.md");
    assert.ok(existsSync(candidateMd), "candidate config dir has a CLAUDE.md");
    assert.ok(
      readFileSync(candidateMd, "utf8").includes("Resident Engineering Laws"),
      "candidate CLAUDE.md inlines HARRY.md",
    );

    // The shim's independent record of what env it actually received.
    const calls = readCalls(binDir);
    assert.equal(calls.length, 2, "two invocations recorded");
    const seenBaseline = calls.find((c) => c.configDir === baseline.configDir);
    const seenCandidate = calls.find((c) => c.configDir === candidate.configDir);
    assert.equal(seenBaseline?.lawsPresent, false, "shim saw no laws under baseline");
    assert.equal(seenCandidate?.lawsPresent, true, "shim saw laws under candidate");
    assert.equal(seenCandidate?.allowedTools, "", "tools disabled via --allowedTools ''");

    // cwd isolation: the child ran from an empty dir with no CLAUDE.md above it,
    // so this repo's own project CLAUDE.md can't leak into EITHER condition.
    for (const c of calls) {
      assert.ok(c.cwd, "shim recorded its cwd");
      assert.notEqual(c.cwd, pluginRoot, "child cwd is not the repo root");
      assert.equal(c.cwdHasClaudeMd, false, "child cwd has no CLAUDE.md");
      assert.notEqual(c.cwd, c.configDir, "cwd is separate from the config dir");
    }
    assert.notEqual(seenCandidate?.cwd, candidate.configDir, "candidate cwd is not its laws dir");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runEvals: appends both conditions into ONE --out file so score contrasts them", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir, "Confirm first: deleting production rows is irreversible.");
    const env = { ...process.env, EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
    const out = path.join(binDir, "shared.jsonl");

    // The documented flow: two separate invocations, same --out. Append (not
    // truncate) must keep both.
    runEvals({ condition: "baseline", model: "m", cases: ["destructive-confirmation"], out }, env);
    runEvals({ condition: "candidate", model: "m", cases: ["destructive-confirmation"], out }, env);

    const { cases: lines, errors } = parseCasesJsonl(readFileSync(out, "utf8"));
    assert.equal(errors.length, 0);
    assert.equal(lines.length, 2, "both runs survive in the one file");
    const scored = scoreResults(lines);
    assert.equal(scored.summary.baselineTotal, 1, "baseline contrast arm is populated");
    assert.equal(scored.summary.candidateTotal, 1, "candidate arm is populated");
    // The shim's canned reply is lawful, so both pass here; the point is that the
    // contrast table is no longer dead (0/0).
    assert.equal(main(["score", "--results", out]), 0);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runEvals: writes one result line per case with the response and embedded checks", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir, "This is a Major tier task; let me plan the approach first.");
    const env = { ...process.env, EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
    const out = path.join(binDir, "out.jsonl");
    const { lines } = runEvals(
      { condition: "candidate", model: "test-model", cases: ["tier-cross-subsystem"], out },
      env,
    );
    assert.equal(lines.length, 1);
    const { cases } = parseCasesJsonl(readFileSync(out, "utf8"));
    assert.equal(cases[0].id, "tier-cross-subsystem");
    assert.ok(cases[0].response.includes("Major"), "response captured from the shim");
    assert.ok(Array.isArray(cases[0].checks) && cases[0].checks.length > 0, "checks embedded");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

// ---- model pinning ---------------------------------------------------------

test("resolveModel / runEvals: refuse to run without a pinned model", () => {
  assert.throws(() => resolveModel({}, {}), /pinning is required/, "no model → throws");
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir);
    const env = { ...process.env, EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
    delete (env as Record<string, string>).EVALS_MODEL;
    assert.throws(
      () => runEvals({ condition: "baseline", cases: ["destructive-confirmation"] }, env),
      /pinning is required/,
      "run without --model or EVALS_MODEL is refused",
    );
    assert.equal(readCalls(binDir).length, 0, "no claude invocation happened");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

// ---- argument parsing ------------------------------------------------------

test("CLI: a value flag with no value errors cleanly (no TypeError, exit 1)", () => {
  // --model as the last token would have crashed on argv[++i].split(...).
  assert.equal(main(["run", "--condition", "baseline", "--model"]), 1, "missing value → exit 1");
  assert.equal(main(["run", "--model", "--condition"]), 1, "a flag as another's value → exit 1");
});
