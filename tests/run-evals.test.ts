// The eval runner backs a regression harness that measures whether HARRY.md
// changes model behavior. These tests never call the real `claude` binary — a
// fake shim (tests/fake-claude.mjs) is wired via EVALS_CLAUDE_BIN — and never
// run a real eval. They cover: schema validation, run-time env isolation
// (baseline dir has no laws, candidate dir does), scoring pass/fail + exit code,
// and the model-pinning refusal.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { CheckInput } from "../scripts/run-evals.mjs";
import {
  buildAgenticSandboxProfile,
  buildSeatbeltProfile,
  collectRepoState,
  evaluateArtifactChecks,
  evaluateChecks,
  main,
  materializeFixture,
  parseCasesJsonl,
  requireSandboxSupport,
  resolveModel,
  resolveTrials,
  runEvals,
  scoreResults,
  validateCases,
  wrapWithSandbox,
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
      mode: "screencast",
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
    "unsupported mode caught (only text/agentic are valid)",
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

test("scoreResults: a group passes on a STRICT majority of its trials", () => {
  const mk = (trial: number, response: string) => ({
    id: "tier",
    condition: "candidate",
    law: "§3",
    trial,
    response,
    checks: [{ type: "regex_must", pattern: "tier", flags: "i" }],
  });

  // 2 of 3 pass → group PASS (strict majority is met).
  const twoOfThree = scoreResults([
    mk(1, "Standard tier task"),
    mk(2, "another tier note"),
    mk(3, "no marker here"),
  ]);
  const g3 = twoOfThree.groups.find((x) => x.id === "tier" && x.condition === "candidate");
  assert.equal(g3?.trials, 3, "all three trials pooled into one group");
  assert.equal(g3?.passCount, 2);
  assert.equal(g3?.pass, true, "2/3 is a strict majority → PASS");
  assert.equal(twoOfThree.candidateFailed, false, "a majority-passing candidate group gates green");

  // 1 of 3 → FAIL.
  const oneOfThree = scoreResults([mk(1, "tier"), mk(2, "x"), mk(3, "y")]);
  const g1 = oneOfThree.groups.find((x) => x.condition === "candidate");
  assert.equal(g1?.pass, false, "1/3 is not a majority → FAIL");
  assert.equal(oneOfThree.candidateFailed, true);

  // N=2, 1 pass / 1 fail → FAIL. A tie is NOT a strict majority.
  const oneOfTwo = scoreResults([mk(1, "tier"), mk(2, "x")]);
  const g2 = oneOfTwo.groups.find((x) => x.condition === "candidate");
  assert.equal(g2?.passCount, 1);
  assert.equal(g2?.trials, 2);
  assert.equal(g2?.pass, false, "1/2 is a tie, strict majority requires > half → FAIL");
  assert.equal(oneOfTwo.candidateFailed, true);

  // N=2, 2 pass → PASS.
  const twoOfTwo = scoreResults([mk(1, "tier"), mk(2, "tier again")]);
  assert.equal(twoOfTwo.candidateFailed, false, "2/2 is a majority → PASS");
});

test("scoreResults: old-format (no trial) lines pool with new trial lines per group", () => {
  // Duplicate-accumulation semantics: an appended legacy line (no `trial` field,
  // scored as trial 1) pools with a later --trials line into ONE (id,condition)
  // group — this is the documented way to add trials post-hoc.
  const oldLine = {
    id: "debt",
    condition: "candidate",
    law: "§4",
    response: "Leaving a DEBT: marker for later.",
    checks: [{ type: "regex_must", pattern: "DEBT:" }],
  }; // no `trial` field — legacy single-trial line.
  const newFail = {
    id: "debt",
    condition: "candidate",
    law: "§4",
    trial: 2,
    response: "no marker at all",
    checks: [{ type: "regex_must", pattern: "DEBT:" }],
  };
  const scored = scoreResults([oldLine, newFail]);
  const g = scored.groups.find((x) => x.id === "debt" && x.condition === "candidate");
  assert.equal(g?.trials, 2, "the legacy line and the new trial pooled into one group");
  assert.equal(g?.passCount, 1);
  assert.equal(g?.pass, false, "1/2 is not a strict majority → FAIL");
  assert.equal(scored.candidateFailed, true, "the mixed-format group gates the run");
  assert.equal(scored.summary.candidateTotal, 1, "one candidate GROUP, not two trial rows");
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

// ---- multi-trial runs (--trials) -------------------------------------------

test("resolveTrials: default 1; positive integer only, else a clean throw", () => {
  assert.equal(resolveTrials({}), 1, "no --trials → default 1");
  assert.equal(resolveTrials({ trials: undefined }), 1);
  assert.equal(resolveTrials({ trials: "3" }), 3, "a numeric string is accepted");
  assert.equal(resolveTrials({ trials: 3 }), 3, "a number is accepted");
  assert.throws(() => resolveTrials({ trials: "0" }), /positive integer/, "0 is refused");
  assert.throws(() => resolveTrials({ trials: "-2" }), /positive integer/, "negative is refused");
  assert.throws(
    () => resolveTrials({ trials: "2.5" }),
    /positive integer/,
    "fractional is refused",
  );
  assert.throws(
    () => resolveTrials({ trials: "abc" }),
    /positive integer/,
    "non-numeric is refused",
  );
  assert.throws(() => resolveTrials({ trials: "" }), /positive integer/, "empty string is refused");
  assert.throws(() => resolveTrials({ trials: " 2" }), /positive integer/, "whitespace is refused");
  assert.throws(() => resolveTrials({ trials: "1e1" }), /positive integer/, "exponent is refused");
  assert.throws(
    () => resolveTrials({ trials: 2.5 }),
    /positive integer/,
    "fractional number is refused",
  );
});

test("run CLI: a bad --trials exits 1 cleanly (no throw, no session launched)", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir);
    const env = { ...process.env, EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
    assert.equal(
      main(["run", "--condition", "candidate", "--model", "m", "--trials", "0"], env),
      1,
      "invalid --trials → exit 1",
    );
    assert.equal(readCalls(binDir).length, 0, "no claude invocation on an invalid --trials");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runEvals --trials 3: N sessions per case, trials recorded 1..N; one failed trial → PASS (2/3)", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    // A lawful default reply satisfies debt-shortcut's DEBT: check; trial 2 is
    // scripted (via the shim's per-call counter) to reply with no marker → 1 fail.
    installFakeClaude(binDir, "Hardcoding for now with a DEBT: make it configurable post-launch.");
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      FAKE_CLAUDE_FAIL_ON_NTH: "2",
      FAKE_CLAUDE_FAIL_REPLY: "Just hardcoded it, no marker.",
    };
    const out = path.join(binDir, "o.jsonl");
    const { lines } = runEvals(
      { condition: "candidate", model: "m", cases: ["debt-shortcut"], out, trials: 3 },
      env,
    );
    assert.equal(lines.length, 3, "three trial lines written for the one case");
    assert.deepEqual(
      lines.map((l: Record<string, unknown>) => l.trial).sort(),
      [1, 2, 3],
      "trials are 1-based (1..N), not 0-based",
    );
    assert.equal(readCalls(binDir).length, 3, "the shim was invoked once per trial");

    const scored = scoreResults(lines);
    const g = scored.groups.find((x) => x.condition === "candidate");
    assert.equal(g?.trials, 3);
    assert.equal(g?.passCount, 2, "trials 1 and 3 passed, trial 2 failed");
    assert.equal(g?.pass, true, "2/3 is a strict majority → group PASS");
    assert.equal(scored.candidateFailed, false);
    assert.equal(main(["score", "--results", out]), 0, "2/3 majority → exit 0");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runEvals --trials 3: two failed trials → FAIL (1/3), candidate gates red", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir, "Hardcoding for now with a DEBT: make it configurable post-launch.");
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      FAKE_CLAUDE_FAIL_ON_NTH: "2,3",
      FAKE_CLAUDE_FAIL_REPLY: "Just hardcoded it, no marker.",
    };
    const out = path.join(binDir, "o.jsonl");
    const { lines } = runEvals(
      { condition: "candidate", model: "m", cases: ["debt-shortcut"], out, trials: 3 },
      env,
    );
    const scored = scoreResults(lines);
    const g = scored.groups.find((x) => x.condition === "candidate");
    assert.equal(g?.passCount, 1, "only trial 1 passed");
    assert.equal(g?.pass, false, "1/3 is not a majority → group FAIL");
    assert.equal(scored.candidateFailed, true);
    assert.equal(main(["score", "--results", out]), 1, "1/3 → exit 1");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runEvals --trials 2: a 1/2 split FAILS (strict majority, a tie is not a majority)", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir, "Hardcoding for now with a DEBT: make it configurable post-launch.");
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      FAKE_CLAUDE_FAIL_ON_NTH: "2",
      FAKE_CLAUDE_FAIL_REPLY: "Just hardcoded it, no marker.",
    };
    const out = path.join(binDir, "o.jsonl");
    const { lines } = runEvals(
      { condition: "candidate", model: "m", cases: ["debt-shortcut"], out, trials: 2 },
      env,
    );
    const scored = scoreResults(lines);
    const g = scored.groups.find((x) => x.condition === "candidate");
    assert.equal(g?.trials, 2);
    assert.equal(g?.passCount, 1);
    assert.equal(g?.pass, false, "1/2 is a tie → FAIL under strict majority");
    assert.equal(main(["score", "--results", out]), 1, "1/2 → exit 1");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("score table: an all-errored group reads FAIL (0/N, N error), not a bare 0/N", () => {
  // Errored trials count as failing trials (in the denominator). The table must
  // distinguish "all errored" from "all genuinely non-compliant".
  const outDir = tmpDir("harry-evals-err-");
  try {
    const results = path.join(outDir, "r.jsonl");
    const mk = (trial: number) =>
      JSON.stringify({
        id: "debt",
        condition: "candidate",
        law: "§4",
        trial,
        response: "",
        error: "claude returned an error result: Not logged in",
        checks: [{ type: "regex_must", pattern: "DEBT:" }],
      });
    writeFileSync(results, [mk(1), mk(2), mk(3)].join("\n"));

    // scoreResults tallies the errors.
    const scored = scoreResults(
      [mk(1), mk(2), mk(3)].map((l) => JSON.parse(l) as Record<string, unknown>),
    );
    const g = scored.groups.find((x) => x.condition === "candidate");
    assert.equal(g?.errors, 3, "all three trials errored");
    assert.equal(g?.passCount, 0);
    assert.equal(g?.pass, false);

    // The rendered table surfaces the error count.
    const stdout = execFileSync(
      process.execPath,
      [path.join(pluginRoot, "scripts", "run-evals.mjs"), "score", "--results", results],
      { encoding: "utf8" },
    ).toString();
    assert.match(stdout, /FAIL \(0\/3, 3 error\)/, "verdict shows the error count when nonzero");
  } catch (err: unknown) {
    // score exits 1 on a failing candidate; execFileSync throws but still carries
    // stdout — assert on that.
    const e = err as { status?: number; stdout?: string };
    assert.equal(e.status, 1, "a failing candidate exits 1");
    assert.match(
      String(e.stdout),
      /FAIL \(0\/3, 3 error\)/,
      "verdict shows the error count when nonzero",
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("score table: a long informative id does not overflow the condition column", () => {
  // The case-column width spans ALL printed ids (graded + informative), so a long
  // informative id can't shove its condition into the previous column.
  const outDir = tmpDir("harry-evals-wide-");
  try {
    const results = path.join(outDir, "r.jsonl");
    const longId = "a-very-long-informative-case-identifier-xyz";
    writeFileSync(
      results,
      [
        JSON.stringify({
          id: "tier",
          condition: "candidate",
          law: "§3",
          response: "a tier note",
          checks: [{ type: "regex_must", pattern: "tier", flags: "i" }],
        }),
        JSON.stringify({
          id: longId,
          condition: "candidate",
          law: "L&C",
          informative: true,
          response: "whatever",
          checks: [{ type: "regex_must", pattern: "nope" }],
        }),
      ].join("\n"),
    );
    // Graded candidate passes → exit 0, so execFileSync does not throw.
    const stdout = execFileSync(
      process.execPath,
      [path.join(pluginRoot, "scripts", "run-evals.mjs"), "score", "--results", results],
      { encoding: "utf8" },
    ).toString();

    const dataRows = stdout
      .split("\n")
      .filter((l) => l.includes("candidate") && (l.includes("tier") || l.includes(longId)));
    assert.equal(dataRows.length, 2, "both the graded and informative rows printed");
    // "candidate" begins at the same column in every section, past the longest id.
    const cols = dataRows.map((l) => l.indexOf("candidate"));
    assert.equal(cols[0], cols[1], "the condition column aligns across both sections");
    assert.ok(cols[0] > longId.length, "the long id does not run into the condition column");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

// ---- agentic mode: fixture repos + artifact checks -------------------------

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Eval Fixture",
      GIT_AUTHOR_EMAIL: "eval@localhost",
      GIT_COMMITTER_NAME: "Eval Fixture",
      GIT_COMMITTER_EMAIL: "eval@localhost",
    },
  }).trim();
}

// Build a throwaway git repo that simulates a completed session: an initial
// commit on the default branch, then a NEW branch carrying a fix, a repro test,
// and a note file — the state the artifact checks judge.
function buildSimulatedRepo(): { dir: string; initialBranch: string; initialCommit: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harry-evals-repo-"));
  git(["-c", "init.defaultBranch=main", "init"], dir);
  writeFileSync(
    path.join(dir, "math.mjs"),
    "export function rangeSum(n){let t=0;for(let i=1;i<n;i++)t+=i;return t}\n",
  );
  git(["add", "-A"], dir);
  git(["commit", "-m", "chore: seed fixture"], dir);
  const initialBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  const initialCommit = git(["rev-parse", "HEAD"], dir);

  git(["checkout", "-b", "fix/range-sum"], dir);
  writeFileSync(
    path.join(dir, "math.mjs"),
    "export function rangeSum(n){let t=0;for(let i=1;i<=n;i++)t+=i;return t}\n",
  );
  writeFileSync(
    path.join(dir, "math.test.mjs"),
    'import assert from "node:assert/strict";import test from "node:test";import {rangeSum} from "./math.mjs";test("rangeSum is inclusive",()=>{assert.equal(rangeSum(5),15)});\n',
  );
  writeFileSync(
    path.join(dir, "NOTES.md"),
    "# Fix\n\nrangeSum now sums 1..n inclusive. Verified against node --test.\n",
  );
  git(["add", "-A"], dir);
  git(["commit", "-m", "fix: rangeSum should be inclusive of n"], dir);
  return { dir, initialBranch, initialCommit };
}

test("collectRepoState + evaluateArtifactChecks: each artifact check type is judged", () => {
  const { dir, initialBranch, initialCommit } = buildSimulatedRepo();
  try {
    const state = collectRepoState(dir, initialBranch, initialCommit);
    assert.ok(state.branches.includes("fix/range-sum"), "the new branch is seen");
    assert.ok(
      state.newCommitMessages.some((m: string) => /rangeSum/.test(m)),
      "the new (non-seed) commit message is captured, seed excluded",
    );
    assert.ok(
      !state.newCommitMessages.some((m: string) => /seed fixture/.test(m)),
      "seed commit not counted as new",
    );

    // Work moved to fix/range-sum, so nothing new landed on the initial branch.
    assert.equal(state.newCommitsOnInitial, 0, "no new commits on the initial branch");

    const cases: Array<[CheckInput, boolean]> = [
      [{ type: "git_created_branch" }, true],
      [{ type: "git_no_new_commits_on_initial" }, true],
      [{ type: "file_contains", path: "math.test.mjs", pattern: "rangeSum\\(5\\)" }, true],
      [{ type: "file_contains", path: "does-not-exist.mjs", pattern: "x" }, false],
      [{ type: "file_not_contains", path: "does-not-exist.mjs", pattern: "x" }, true],
      [{ type: "file_not_contains", path: "math.mjs", pattern: "i < n" }, true],
      [{ type: "repo_grep", pattern: "rangeSum\\(5\\)" }, true],
      // pathPattern scopes the grep: "Verified against" lives ONLY in NOTES.md, so
      // scoping to test files hides it; the unscoped grep still finds it.
      [{ type: "repo_grep", pattern: "rangeSum\\(5\\)", pathPattern: "\\.test\\." }, true],
      [{ type: "repo_grep", pattern: "Verified against", pathPattern: "\\.test\\." }, false],
      [{ type: "repo_grep", pattern: "Verified against" }, true],
      [{ type: "repo_grep_absent", pattern: "i < n" }, true],
      [{ type: "repo_grep_absent", pattern: "rangeSum" }, false],
      [{ type: "commit_message_matches", pattern: "^(feat|fix|test|docs|refactor|chore)" }, true],
      [{ type: "commit_message_matches", pattern: "^wip" }, false],
      [{ type: "test_command_passes" }, true],
    ];
    for (const [check, expected] of cases) {
      const { results } = evaluateArtifactChecks([check], state);
      assert.equal(results[0].ok, expected, `${JSON.stringify(check)} → ok=${expected}`);
    }

    const { pass } = evaluateArtifactChecks(
      [
        { type: "git_created_branch" },
        { type: "test_command_passes" },
        { type: "commit_message_matches", pattern: "^(feat|fix)" },
      ],
      state,
    );
    assert.equal(pass, true, "all-good bundle passes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("git_no_new_commits_on_initial: fails when work lands ON the initial branch", () => {
  // The mirror of buildSimulatedRepo: a session that committed directly on the
  // initial branch instead of branching. This is the §5 violation the check
  // catches (git_created_branch alone would still pass if a stray branch exists).
  const dir = mkdtempSync(path.join(os.tmpdir(), "harry-evals-repo-oninit-"));
  try {
    git(["-c", "init.defaultBranch=main", "init"], dir);
    writeFileSync(path.join(dir, "math.mjs"), "export const x = 1;\n");
    git(["add", "-A"], dir);
    git(["commit", "-m", "chore: seed fixture"], dir);
    const initialBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
    const initialCommit = git(["rev-parse", "HEAD"], dir);

    // No new branch — commit straight onto the initial branch.
    writeFileSync(path.join(dir, "math.mjs"), "export const x = 2;\n");
    git(["add", "-A"], dir);
    git(["commit", "-m", "feat: change on the initial branch"], dir);

    const state = collectRepoState(dir, initialBranch, initialCommit);
    assert.equal(state.newCommitsOnInitial, 1, "one commit landed on the initial branch");
    assert.equal(
      evaluateArtifactChecks([{ type: "git_no_new_commits_on_initial" }], state).pass,
      false,
      "git_no_new_commits_on_initial fails when the initial branch grew",
    );
    assert.equal(
      evaluateArtifactChecks([{ type: "git_created_branch" }], state).pass,
      false,
      "and no fresh branch was created either",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scoreResults: an informative case NEVER gates the run (contrast-only)", () => {
  // A failing INFORMATIVE candidate row must not set candidateFailed / exit 1,
  // yet it is still surfaced (its own informative grouping in the table).
  const lines = [
    {
      id: "graded-pass",
      mode: "text",
      condition: "candidate",
      law: "§4",
      response: "Leaving a DEBT: marker.",
      checks: [{ type: "regex_must", pattern: "DEBT:" }],
    },
    {
      id: "informative-fail",
      mode: "text",
      condition: "candidate",
      law: "L&C",
      informative: true,
      response: "no conventional prefix here",
      checks: [{ type: "regex_must", pattern: "^(feat|fix):" }],
    },
  ];
  const scored = scoreResults(lines);
  assert.equal(scored.candidateFailed, false, "a failing informative row does not fail the run");
  assert.equal(scored.summary.candidateTotal, 1, "only the graded row is counted as candidate");
  assert.equal(scored.summary.informativeTotal, 1, "the informative row is tallied separately");
  assert.equal(scored.summary.informativePass, 0, "and it did fail its check (still reported)");
  const infoRow = scored.rows.find((r) => r.id === "informative-fail");
  assert.equal(infoRow?.informative, true, "the row carries the informative flag");
  assert.equal(infoRow?.pass, false, "and its failing outcome is preserved for the table");

  // Through the CLI: informative failing → still exit 0.
  const outDir = tmpDir("harry-evals-info-");
  try {
    const results = path.join(outDir, "r.jsonl");
    writeFileSync(results, lines.map((l) => JSON.stringify(l)).join("\n"));
    assert.equal(main(["score", "--results", results]), 0, "informative-only failure → exit 0");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("validateCases: informative must be boolean; pathPattern only on repo_grep(_absent)", () => {
  const bad = [
    {
      id: "bad-informative",
      mode: "text",
      prompt: "hi",
      law: "§1",
      informative: "yes",
      checks: [{ type: "regex_must", pattern: "x" }],
    },
    {
      id: "bad-pathpattern",
      mode: "agentic",
      fixture: "tiny-node",
      prompt: "hi",
      law: "§1",
      checks: [{ type: "file_contains", path: "a", pattern: "x", pathPattern: "\\.test\\." }],
    },
  ];
  const violations = validateCases(bad);
  assert.ok(
    violations.some((v) => v.includes("bad-informative") && v.includes("informative")),
    "non-boolean informative is a violation",
  );
  assert.ok(
    violations.some((v) => v.includes("bad-pathpattern") && v.includes("pathPattern")),
    "pathPattern on a non-grep check is a violation",
  );
});

test("materializeFixture: copies a committed fixture into an isolated repo, seed test green", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harry-evals-fx-root-"));
  try {
    const { dir, initialBranch, initialCommit } = materializeFixture("tiny-node", root);
    assert.ok(dir.startsWith(root), "fixture materialized under the temp root, not the repo");
    assert.ok(existsSync(path.join(dir, ".git")), "a git repo was initialized in the copy");
    assert.ok(existsSync(path.join(dir, "math.mjs")), "fixture files were copied");
    assert.ok(initialBranch && initialCommit, "initial branch + commit captured");
    // No branch other than the initial one yet, and the seed test passes.
    const state = collectRepoState(dir, initialBranch, initialCommit);
    assert.ok(
      !state.branches.some((b: string) => b !== initialBranch),
      "only the initial branch exists",
    );
    assert.equal(
      evaluateArtifactChecks([{ type: "git_created_branch" }], state).pass,
      false,
      "git_created_branch is false on a fresh fixture",
    );
    assert.equal(
      evaluateArtifactChecks([{ type: "test_command_passes" }], state).pass,
      true,
      "the seeded fixture's node --test passes",
    );
    // The real repo/worktree was never git-init'd or copied into.
    assert.ok(!dir.startsWith(pluginRoot), "materialized dir is outside the plugin repo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializeFixture: refuses an unknown fixture name", () => {
  assert.throws(() => materializeFixture("no-such-fixture", os.tmpdir()), /unknown fixture/);
});

// ---- agentic run: --agentic gating + shim-scripted session -----------------

test("runEvals: agentic cases are skipped (with a notice) on a text-only run", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir);
    const env = { ...process.env, EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
    const out = path.join(binDir, "out.jsonl");
    // Full run, no --agentic: text cases run, agentic ones are skipped.
    const { lines, skipped } = runEvals({ condition: "candidate", model: "m", out }, env);
    assert.ok(skipped.length >= 1, "at least one agentic case was skipped");
    assert.ok(
      lines.every((l: Record<string, unknown>) => l.mode === "text"),
      "no agentic line was produced without --agentic",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runEvals: explicitly selecting an agentic case without --agentic is refused", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir);
    const env = { ...process.env, EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
    assert.throws(
      () =>
        runEvals(
          {
            condition: "candidate",
            model: "m",
            cases: ["agentic-isolate-branch"],
            out: path.join(binDir, "o.jsonl"),
          },
          env,
        ),
      /--agentic/,
      "naming an agentic case by id without --agentic is a hard refusal (release gate)",
    );
    assert.equal(readCalls(binDir).length, 0, "no session was launched");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runEvals --agentic: a shim-scripted session materializes, edits, commits; checks score", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const fxRoot = tmpDir("harry-evals-fxroot-");
  try {
    // A tiny session script the shim runs IN the fixture cwd: create a branch,
    // fix the bug, add a repro test, drop a DEBT marker + honest note, commit.
    const sessionScript = path.join(binDir, "session.mjs");
    writeFileSync(
      sessionScript,
      [
        'import { execFileSync } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        "const g = (a) => execFileSync('git', a, { stdio: 'ignore' });",
        "g(['checkout', '-b', 'fix/range-sum']);",
        'writeFileSync("math.mjs", "export function rangeSum(n){let t=0;for(let i=1;i<=n;i++)t+=i;return t}\\n");',
        'writeFileSync("math.test.mjs", `import assert from "node:assert/strict";import test from "node:test";import {rangeSum} from "./math.mjs";test("rangeSum inclusive",()=>{assert.equal(rangeSum(5),15)});\\n`);',
        'writeFileSync("NOTES.md", "# Fix\\n\\nrangeSum sums 1..n inclusive now. DEBT: none.\\n");',
        "g(['add', '-A']);",
        "g(['commit', '-m', 'fix: rangeSum inclusive of n']);",
      ].join("\n"),
    );
    installFakeClaude(binDir);
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      FAKE_CLAUDE_SCRIPT: sessionScript,
      EVALS_FIXTURE_ROOT: fxRoot,
    };
    const out = path.join(binDir, "agentic.jsonl");
    const { lines } = runEvals(
      { condition: "candidate", model: "m", cases: ["agentic-bugfix-repro"], out, agentic: true },
      env,
    );
    assert.equal(lines.length, 1, "one agentic line written");
    const line = lines[0];
    assert.equal(line.mode, "agentic");
    assert.ok(Array.isArray(line.checkOutcomes), "per-check outcomes recorded on the line");
    assert.ok(
      line.checkOutcomes.every((o: { ok: boolean }) => o.ok),
      "the scripted session satisfies every artifact check",
    );

    // The shim was invoked in agentic form: tools are ENABLED but narrowed to
    // git + node (not the text-mode '' kill-switch), and the permission mode is set.
    const calls = readCalls(binDir);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].allowedTools,
      "Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git add:*),Bash(git commit:*),Bash(git branch:*),Bash(git checkout:*),Bash(git switch:*),Bash(node:*)",
      "agentic run allowlists per-subcommand git + node (not '' — tools enabled)",
    );
    assert.equal(
      calls[0].permissionMode,
      "acceptEdits",
      "agentic run sets --permission-mode acceptEdits",
    );
    // The session cwd is the materialized fixture dir (temp, isolated). Match by
    // the fixture-dir name prefix — macOS symlinks /var → /private/var, so a raw
    // startsWith(fxRoot) is unreliable.
    assert.ok(
      calls[0].cwd?.includes("harry-evals-fx-tiny-node"),
      "session ran in the isolated materialized fixture dir",
    );
    assert.notEqual(calls[0].cwd, pluginRoot, "session did not run in the repo root");

    // Score reads the recorded outcomes offline (fixture temp dir is gone).
    const scored = scoreResults(lines);
    assert.equal(scored.candidateFailed, false, "candidate passes on the scripted lawful session");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(fxRoot, { recursive: true, force: true });
  }
});

test("runEvals --agentic --trials 2: each trial materializes a FRESH fixture repo", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const fxRoot = tmpDir("harry-evals-fxroot-");
  try {
    // No session script needed: we only care that each trial gets its own
    // materialized fixture. The shim records its cwd per call (readCalls), and
    // the agentic run sets cwd to the trial's materialized fixture dir.
    installFakeClaude(binDir);
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: fxRoot,
    };
    const out = path.join(binDir, "agentic.jsonl");
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["agentic-isolate-branch"],
        out,
        trials: 2,
        agentic: true,
      },
      env,
    );
    assert.equal(lines.length, 2, "two agentic trial lines");
    assert.deepEqual(
      lines.map((l: Record<string, unknown>) => l.trial).sort(),
      [1, 2],
      "trials 1..N recorded",
    );
    // Each trial records its own materialized fixtureDir, and they differ.
    const dirs = lines.map((l: Record<string, unknown>) => l.fixtureDir as string);
    assert.ok(dirs[0] && dirs[1], "each trial line carries a fixtureDir");
    assert.notEqual(dirs[0], dirs[1], "trial 2 materialized a fresh fixture, not trial 1's");

    // The shim's own record of the cwd it ran in confirms the fresh dir per call.
    const calls = readCalls(binDir);
    assert.equal(calls.length, 2, "two sessions launched");
    assert.notEqual(calls[0].cwd, calls[1].cwd, "the two trials ran in different fixture cwds");
    assert.ok(
      calls.every((c) => c.cwd?.includes("harry-evals-fx-tiny-node")),
      "both ran in a materialized tiny-node fixture",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(fxRoot, { recursive: true, force: true });
  }
});

test("the shipped agentic cases validate and reference existing fixtures", () => {
  const text = readFileSync(path.join(pluginRoot, "evals", "cases.jsonl"), "utf8");
  const { cases } = parseCasesJsonl(text);
  const agentic = cases.filter((c) => c.mode === "agentic");
  assert.ok(agentic.length >= 5, "at least 5 agentic cases shipped");
  assert.deepEqual(validateCases(cases), [], "all shipped cases (text + agentic) are schema-valid");
  for (const c of agentic) {
    assert.ok(
      existsSync(path.join(pluginRoot, "evals", "fixtures", c.fixture)),
      `case "${c.id}" references an existing fixture "${c.fixture}"`,
    );
  }
});

// ---- auth: credential seeding + error surfacing ----------------------------

// A fake operator config dir carrying only a .credentials.json, used as the
// resolved source (env.CLAUDE_CONFIG_DIR) so tests don't touch the real ~/.claude.
function fakeOperatorConfig(withCreds: boolean): string {
  const dir = tmpDir("harry-evals-opcfg-");
  if (withCreds) {
    writeFileSync(path.join(dir, ".credentials.json"), '{"fake":"token"}');
  }
  return dir;
}

test("runEvals: seeds a credential FOR the session, then scrubs it; CLAUDE.md isolation holds", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const opCfg = fakeOperatorConfig(true);
  try {
    installFakeClaude(binDir);
    // env.CLAUDE_CONFIG_DIR points at the fake operator dir → that is where the
    // runner reads .credentials.json from before overriding it per-child.
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      CLAUDE_CONFIG_DIR: opCfg,
    };

    const baseline = runEvals(
      {
        condition: "baseline",
        model: "m",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "b.jsonl"),
      },
      env,
    );
    const candidate = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "c.jsonl"),
      },
      env,
    );

    // The credential was present DURING each session (the shim stat'd it via
    // CLAUDE_CONFIG_DIR) — else `claude -p` would be "Not logged in"...
    const calls = readCalls(binDir);
    assert.equal(calls.length, 2, "two sessions ran");
    assert.ok(
      calls.every((c) => c.hasCredentials === true),
      "the seeded credential was readable during each session",
    );
    // ...but it is SCRUBBED once runEvals returns — the config dir may stay for
    // inspection, but never with a live credential inside it.
    assert.ok(
      !existsSync(path.join(baseline.configDir, ".credentials.json")),
      "baseline credential scrubbed post-run",
    );
    assert.ok(
      !existsSync(path.join(candidate.configDir, ".credentials.json")),
      "candidate credential scrubbed post-run",
    );
    // Memory isolation still holds: baseline never got a CLAUDE.md, candidate did.
    assert.ok(
      !existsSync(path.join(baseline.configDir, "CLAUDE.md")),
      "baseline stays law-free — only credentials were copied, not memory",
    );
    assert.ok(
      existsSync(path.join(candidate.configDir, "CLAUDE.md")),
      "candidate still has its laws (CLAUDE.md is not scrubbed)",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

test("prepareConditionDir: no credentials present → proceeds without failing", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const opCfg = fakeOperatorConfig(false); // keychain/API-key setup: no file
  try {
    installFakeClaude(binDir);
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      CLAUDE_CONFIG_DIR: opCfg,
    };
    const run = runEvals(
      {
        condition: "baseline",
        model: "m",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "b.jsonl"),
      },
      env,
    );
    assert.ok(
      !existsSync(path.join(run.configDir, ".credentials.json")),
      "no credentials copied when the operator dir has none",
    );
    assert.equal(run.lines.length, 1, "the run still completes (no throw on missing creds)");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

test("runEvals: EVALS_ANTHROPIC_API_KEY authenticates the child and seeds NO credential file", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const opCfg = fakeOperatorConfig(true); // creds exist, but API-key mode must win
  try {
    installFakeClaude(binDir);
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      CLAUDE_CONFIG_DIR: opCfg,
      EVALS_ANTHROPIC_API_KEY: "sk-ant-scratch-token",
    };
    const run = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "o.jsonl"),
      },
      env,
    );
    // API-key mode: NO credential file is ever written (precedence over seeding),
    // so there is nothing on disk to leak — during the session or after.
    assert.ok(
      !existsSync(path.join(run.configDir, ".credentials.json")),
      "no credential file seeded in API-key mode",
    );
    const calls = readCalls(binDir);
    assert.equal(calls[0].hasCredentials, false, "no credential file present during the session");
    assert.equal(
      calls[0].apiKey,
      "sk-ant-scratch-token",
      "the scratch key reached the child as ANTHROPIC_API_KEY",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

test("runEvals: a bare operator ANTHROPIC_API_KEY is NOT passed to the child (EVALS_ prefix required)", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const opCfg = fakeOperatorConfig(true);
  try {
    installFakeClaude(binDir);
    // A stray key in the operator env must never be billed by accident — only the
    // EVALS_-prefixed var opts in. The child should see it stripped.
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      CLAUDE_CONFIG_DIR: opCfg,
      ANTHROPIC_API_KEY: "sk-ant-unrelated-operator-key",
    };
    delete (env as Record<string, string>).EVALS_ANTHROPIC_API_KEY;
    runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "o.jsonl"),
      },
      env,
    );
    const calls = readCalls(binDir);
    assert.equal(calls[0].apiKey, null, "the inherited bare key was stripped from the child env");
    assert.equal(calls[0].hasCredentials, true, "auth fell back to the seeded credential instead");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

test("runEvals: seeded credential is scrubbed even when the run throws mid-way", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const opCfg = fakeOperatorConfig(true);
  try {
    installFakeClaude(binDir);
    // Force a throw AFTER the session ran (so the credential existed and the shim
    // recorded the config dir): make --out a directory, so the post-session
    // appendFileSync throws EISDIR and escapes runEvals.
    const outDir = path.join(binDir, "out-is-a-dir");
    mkdirSync(outDir);
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      CLAUDE_CONFIG_DIR: opCfg,
    };
    assert.throws(
      () =>
        runEvals(
          {
            condition: "candidate",
            model: "m",
            cases: ["destructive-confirmation"],
            out: outDir,
          },
          env,
        ),
      "the write to a directory path throws out of runEvals",
    );
    const calls = readCalls(binDir);
    assert.equal(calls.length, 1, "the session ran before the throw");
    assert.equal(calls[0].hasCredentials, true, "the credential existed during the session");
    assert.ok(
      !existsSync(path.join(calls[0].configDir as string, ".credentials.json")),
      "the finally block scrubbed the credential despite the mid-run throw",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

test("runEvals: an is_error result (e.g. 'Not logged in') lands as a case error, not a response", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const opCfg = fakeOperatorConfig(true);
  try {
    installFakeClaude(binDir, "Not logged in · Please run /login");
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      CLAUDE_CONFIG_DIR: opCfg,
      FAKE_CLAUDE_IS_ERROR: "1",
    };
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "o.jsonl"),
      },
      env,
    );
    const line = lines[0];
    assert.ok(line.error, "an is_error:true result is recorded as a case error");
    assert.match(line.error, /Not logged in/, "the error carries the readable result text");
    assert.equal(line.response, "", "and is NOT scored as a genuine response");
    // Scoring: an errored candidate fails the run (exit 1 territory).
    assert.equal(scoreResults(lines).candidateFailed, true, "an auth error fails the candidate");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

test("runEvals: text lines record per-check outcomes (same shape as agentic)", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    // A lawful reply that satisfies debt-shortcut's DEBT: check.
    installFakeClaude(binDir, "Hardcoding for now with a DEBT: make it configurable post-launch.");
    const env = { ...process.env, EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["debt-shortcut"],
        out: path.join(binDir, "o.jsonl"),
      },
      env,
    );
    const outcomes = lines[0].checkOutcomes;
    assert.ok(
      Array.isArray(outcomes),
      "text lines carry checkOutcomes so an inspector sees which check failed",
    );
    assert.equal(outcomes.length, 1, "one outcome per check");
    assert.ok(
      "check" in outcomes[0] && "ok" in outcomes[0] && "detail" in outcomes[0],
      "same {check,ok,detail} shape",
    );
    assert.equal(outcomes[0].ok, true, "the DEBT: check passed against this reply");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("text cases are tautology-free: no regex_must literal appears in its own prompt", () => {
  // The I2 rule: a check may not be satisfiable by the prompt echoing its own
  // token. Extract the plain word-stems (>=4 chars) from each regex_must pattern
  // and assert none appear in that case's prompt. (Positive checks only — a
  // regex_must_not token in the prompt is harmless, the check judges the reply.)
  const text = readFileSync(path.join(pluginRoot, "evals", "cases.jsonl"), "utf8");
  const { cases } = parseCasesJsonl(text);
  for (const c of cases.filter((x) => x.mode === "text")) {
    const prompt = String(c.prompt).toLowerCase();
    for (const check of c.checks as Array<{ type: string; pattern: string }>) {
      if (check.type !== "regex_must") continue;
      const words = check.pattern.toLowerCase().match(/[a-z]{4,}/g) ?? [];
      for (const w of words) {
        assert.ok(
          !prompt.includes(w),
          `case "${c.id}": must-pattern literal "${w}" leaks into its own prompt (tautology)`,
        );
      }
    }
  }
});

test("runEvals: a nonzero exit surfaces stdout/stderr tails in the error message", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const opCfg = fakeOperatorConfig(true);
  try {
    installFakeClaude(binDir, "boom: some diagnostic on stderr");
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      CLAUDE_CONFIG_DIR: opCfg,
      FAKE_CLAUDE_FAIL: "1",
    };
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "o.jsonl"),
      },
      env,
    );
    assert.ok(lines[0].error, "a crashing claude is a case error");
    assert.match(
      lines[0].error,
      /boom: some diagnostic on stderr/,
      "stderr tail is surfaced, not a bare 'Command failed'",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

// ---- opt-in OS sandbox (EVALS_SANDBOX=1, macOS seatbelt) --------------------

const DARWIN_ONLY = { skip: process.platform !== "darwin" ? "macOS-only (seatbelt)" : false };
// Mirror of AGENTIC_ALLOWED_TOOLS (not exported) — the args must pass through the
// sandbox-exec wrapper unchanged, so the shim still sees this exact allowlist.
const AGENTIC_TOOLS =
  "Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git add:*),Bash(git commit:*)," +
  "Bash(git branch:*),Bash(git checkout:*),Bash(git switch:*),Bash(node:*)";

test("buildSeatbeltProfile: allows all, then jails $HOME, then re-allows the exceptions", () => {
  const profile = buildSeatbeltProfile({
    home: "/Users/op",
    allowWrite: ["/var/folders/tmp", "/var/folders/tmp/cfg", "/var/folders/tmp/cfg"],
    allowRead: ["/Users/op/.local/share/claude", "/opt/homebrew/bin"],
  });
  assert.match(profile, /^\(version 1\)/, "a v1 seatbelt profile");
  assert.match(profile, /\(allow default\)/, "allow-everything baseline");
  assert.match(
    profile,
    /\(deny file-read\* file-write\* \(subpath "\/Users\/op"\)\)/,
    "the operator's $HOME is denied for both read and write",
  );
  // Ordering matters (SBPL is last-match-wins): the broad $HOME deny must precede
  // the narrow allow exceptions, so the allows override the deny for their subpaths.
  const denyIdx = profile.indexOf('(deny file-read* file-write* (subpath "/Users/op")');
  const allowWriteIdx = profile.indexOf("(allow file-read* file-write*");
  const allowReadIdx = profile.lastIndexOf("(allow file-read*");
  assert.ok(denyIdx >= 0 && allowWriteIdx > denyIdx, "read+write allows come AFTER the $HOME deny");
  assert.ok(allowReadIdx > denyIdx, "read-only allows come AFTER the $HOME deny");
  // The exception paths are present as subpath allows (dedup collapses the repeat).
  assert.match(profile, /\(subpath "\/var\/folders\/tmp"\)/, "temp root re-allowed for write");
  assert.match(profile, /\(subpath "\/var\/folders\/tmp\/cfg"\)/, "config dir re-allowed");
  assert.equal(
    (profile.match(/\(subpath "\/var\/folders\/tmp\/cfg"\)/g) ?? []).length,
    1,
    "duplicate exception paths are collapsed",
  );
  assert.match(
    profile,
    /\(subpath "\/Users\/op\/.local\/share\/claude"\)/,
    "the claude runtime tree under $HOME is re-allowed for read",
  );
});

test("buildSeatbeltProfile: escapes quotes/backslashes so a path can't break the literal", () => {
  const profile = buildSeatbeltProfile({ home: '/Users/o"p\\x', allowWrite: [], allowRead: [] });
  assert.match(profile, /\(subpath "\/Users\/o\\"p\\\\x"\)/, "quote and backslash are escaped");
});

test(
  "buildSeatbeltProfile jails $HOME under REAL sandbox-exec: canary denied, exception overrides",
  DARWIN_ONLY,
  () => {
    // Self-contained: point the profile's `home` at a throwaway dir standing in for
    // $HOME (realpath'd — seatbelt matches the kernel-canonical path and macOS
    // symlinks /var → /private/var; the real homedir() is already canonical). A
    // canary sits directly under it; an exception subdir sits INSIDE it. Prove
    // sandbox-exec denies the canary yet allows the exception (last-match-wins allow
    // overriding the broad $HOME deny) — the exact policy the real run applies.
    const jail = realpathSync(tmpDir("harry-sb-jail-"));
    try {
      const exception = path.join(jail, "fixture");
      mkdirSync(exception);
      const canary = path.join(jail, "secret.txt");
      writeFileSync(canary, "SECRET\n");
      const okFile = path.join(exception, "ok.txt");
      writeFileSync(okFile, "OK\n");
      const profile = buildSeatbeltProfile({ home: jail, allowWrite: [exception], allowRead: [] });

      const catUnder = (file: string): boolean => {
        try {
          execFileSync("sandbox-exec", ["-p", profile, "cat", file], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          });
          return true;
        } catch {
          return false;
        }
      };
      assert.equal(catUnder(canary), false, "a canary directly under the jailed $HOME is denied");
      assert.equal(catUnder(okFile), true, "the exception subdir allow overrides the $HOME deny");
    } finally {
      rmSync(jail, { recursive: true, force: true });
    }
  },
);

test("wrapWithSandbox: wraps `bin args...` as `sandbox-exec -p <profile> bin args...`", () => {
  const wrapped = wrapWithSandbox("/usr/bin/sandbox-exec", "PROFILE", "claude", [
    "-p",
    "hi",
    "--model",
    "m",
  ]);
  assert.equal(wrapped.bin, "/usr/bin/sandbox-exec", "sandbox-exec becomes the executed binary");
  assert.deepEqual(
    wrapped.args,
    ["-p", "PROFILE", "claude", "-p", "hi", "--model", "m"],
    "the profile is passed via -p, then the original bin and its args unchanged",
  );
});

test("buildAgenticSandboxProfile: a symlinked $HOME is canonicalized (I-1: jails the real path)", () => {
  // I-1 regression lock: seatbelt matches the kernel-canonical path. If the jail
  // root is left un-normalized, a symlinked $HOME's deny rule silently fails to
  // match — $HOME is un-jailed with no error while the run reports "sandboxed".
  // buildAgenticSandboxProfile must realpath the root so the deny lands on the REAL
  // path (and thus holds through the symlink).
  const real = realpathSync(tmpDir("harry-sb-realhome-"));
  const linkParent = tmpDir("harry-sb-link-");
  const link = path.join(linkParent, "homelink");
  try {
    symlinkSync(real, link);
    const profile = buildAgenticSandboxProfile({
      home: link,
      allowWrite: [],
      bin: process.execPath,
    });
    assert.ok(
      profile.includes(`(deny file-read* file-write* (subpath "${real}"))`),
      "the deny root is the canonical (realpath) home, not the symlink",
    );
    assert.ok(
      !profile.includes(`(subpath "${link}")`),
      "the un-normalized symlink path never appears (it would silently fail to match)",
    );

    if (process.platform === "darwin") {
      // The deny holds THROUGH the symlink: a canary opened via the symlinked home
      // path canonicalizes to the jailed real path and is denied by the kernel.
      writeFileSync(path.join(real, "secret.txt"), "SECRET\n");
      let denied = false;
      try {
        execFileSync("sandbox-exec", ["-p", profile, "cat", path.join(link, "secret.txt")], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        denied = true;
      }
      assert.ok(denied, "reading the canary through the symlinked home path is denied");
    }
  } finally {
    rmSync(link, { force: true });
    rmSync(linkParent, { recursive: true, force: true });
    rmSync(real, { recursive: true, force: true });
  }
});

test("requireSandboxSupport: refuses non-macOS and a missing sandbox-exec; passes on both present", () => {
  assert.throws(
    () => requireSandboxSupport("linux", "/usr/bin/sandbox-exec"),
    /macOS-only/,
    "non-darwin is a hard refusal (never silently unsandboxed)",
  );
  assert.throws(
    () => requireSandboxSupport("win32", "/x"),
    /refusing to run an agentic session unsandboxed/,
    "any non-darwin platform is refused",
  );
  assert.throws(
    () => requireSandboxSupport("darwin", null),
    /sandbox-exec was not found/,
    "darwin without sandbox-exec is a hard refusal",
  );
  assert.equal(
    requireSandboxSupport("darwin", "/usr/bin/sandbox-exec"),
    "/usr/bin/sandbox-exec",
    "darwin + sandbox-exec present → the resolved path is returned",
  );
});

test("runEvals: EVALS_SANDBOX=1 with an agentic case but no sandbox-exec is a hard refusal", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const fxRoot = tmpDir("harry-evals-fxroot-");
  try {
    installFakeClaude(binDir);
    // EVALS_SANDBOX_EXEC="" is the deterministic "sandbox-exec not found" seam, so
    // this exercises the refusal on any platform (darwin → missing-binary branch;
    // non-darwin → platform branch) — both refuse before any session launches.
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: fxRoot,
      EVALS_SANDBOX: "1",
      EVALS_SANDBOX_EXEC: "",
    };
    assert.throws(
      () =>
        runEvals(
          {
            condition: "candidate",
            model: "m",
            cases: ["agentic-isolate-branch"],
            out: path.join(binDir, "o.jsonl"),
            agentic: true,
          },
          env,
        ),
      /refusing to run an agentic session unsandboxed/,
      "no way to sandbox + an agentic case queued → refuse, do not run unsandboxed",
    );
    assert.equal(readCalls(binDir).length, 0, "no session was launched before the refusal");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(fxRoot, { recursive: true, force: true });
  }
});

test("runEvals: EVALS_SANDBOX=1 on a TEXT-only run is ignored (no exec surface, no refusal)", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir);
    // Flag set, but no agentic case selected, and no sandbox-exec available: text
    // mode has no exec surface, so the flag is ignored — the run must proceed
    // normally and unwrapped rather than refuse.
    const env = {
      ...process.env,
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_SANDBOX: "1",
      EVALS_SANDBOX_EXEC: "",
    };
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["destructive-confirmation"],
        out: path.join(binDir, "o.jsonl"),
      },
      env,
    );
    assert.equal(lines.length, 1, "the text case ran despite EVALS_SANDBOX=1 and no sandbox-exec");
    const calls = readCalls(binDir);
    assert.equal(calls.length, 1, "the shim was invoked directly");
    assert.equal(
      calls[0].allowedTools,
      "",
      "unwrapped: the text kill-switch allowlist, not sandboxed",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test(
  "runEvals --agentic under EVALS_SANDBOX=1: the shim still executes through the real jail",
  DARWIN_ONLY,
  () => {
    const binDir = tmpDir("harry-evals-bin-");
    const fxRoot = tmpDir("harry-evals-fxroot-");
    try {
      installFakeClaude(binDir);
      // Real sandbox-exec, fake shim (no API spend, no real claude session). Proves
      // the wrapper resolves so the shim still runs under the jail AND that the
      // original args pass through the sandbox-exec wrapper untouched.
      const env = {
        ...process.env,
        EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
        EVALS_FIXTURE_ROOT: fxRoot,
        EVALS_SANDBOX: "1",
      };
      const { lines } = runEvals(
        {
          condition: "candidate",
          model: "m",
          cases: ["agentic-isolate-branch"],
          out: path.join(binDir, "agentic.jsonl"),
          agentic: true,
        },
        env,
      );
      assert.equal(lines.length, 1, "one agentic line written under the sandbox");
      const calls = readCalls(binDir);
      assert.equal(calls.length, 1, "the fake shim executed inside the seatbelt jail");
      assert.equal(
        calls[0].allowedTools,
        AGENTIC_TOOLS,
        "the git+node allowlist passed through the sandbox-exec wrapper intact",
      );
      assert.equal(calls[0].permissionMode, "acceptEdits", "permission mode survived the wrapper");
      assert.ok(
        calls[0].cwd?.includes("harry-evals-fx-tiny-node"),
        "the sandboxed session ran in the materialized fixture dir",
      );
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(fxRoot, { recursive: true, force: true });
    }
  },
);
