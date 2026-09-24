// The eval runner backs a regression harness that measures whether HARRY.md
// changes model behavior. These tests never call the real `claude` binary — a
// fake shim (tests/fake-claude.mjs) is wired via EVALS_CLAUDE_BIN — and never
// run a real eval. They cover: schema validation, run-time env isolation
// (baseline dir has no laws, candidate dir does), scoring pass/fail + exit code,
// and the model-pinning refusal.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CheckInput, RepoState } from "../scripts/run-evals.mjs";
import {
  buildAgenticSandboxProfile,
  buildBaseEnv,
  buildChildEnv,
  buildGitEnv,
  buildSeatbeltProfile,
  collectRepoState,
  evaluateArtifactCheck,
  evaluateArtifactChecks,
  evaluateChecks,
  judgeFixture,
  main,
  materializeFixture,
  parseCasesJsonl,
  parsePostSessionOutput,
  requireSandboxSupport,
  resolveAuth,
  resolveModel,
  resolveTrials,
  restoreFixtureGitConfig,
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

// The running node's dir: first on every child's PATH (see buildBaseEnv).
const NODE_DIR = path.dirname(process.execPath);

// The runner refuses a run with both EVALS_ auth vars set, so a test that spread the
// operator's own env would go red whenever the shell running the suite exports one
// (an AC-5-style live run does). Every runEvals test starts from this instead and
// sets exactly the auth var it means to exercise.
function authFreeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.EVALS_ANTHROPIC_API_KEY;
  delete env.EVALS_CLAUDE_CODE_OAUTH_TOKEN;
  return env;
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
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };

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
      !existsSync(path.join(baseline.lines[0].configDir, "CLAUDE.md")),
      "baseline config dir has no CLAUDE.md → no laws leak",
    );
    const candidateMd = path.join(candidate.lines[0].configDir, "CLAUDE.md");
    assert.ok(existsSync(candidateMd), "candidate config dir has a CLAUDE.md");
    assert.ok(
      readFileSync(candidateMd, "utf8").includes("Resident Engineering Laws"),
      "candidate CLAUDE.md inlines HARRY.md",
    );

    // The shim's independent record of what env it actually received.
    const calls = readCalls(binDir);
    assert.equal(calls.length, 2, "two invocations recorded");
    const seenBaseline = calls.find((c) => c.configDir === baseline.lines[0].configDir);
    const seenCandidate = calls.find((c) => c.configDir === candidate.lines[0].configDir);
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
    assert.notEqual(
      seenCandidate?.cwd,
      candidate.lines[0].configDir,
      "candidate cwd is not its laws dir",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runEvals: appends both conditions into ONE --out file so score contrasts them", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir, "Confirm first: deleting production rows is irreversible.");
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };
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
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };
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
    const env = { ...authFreeEnv(), EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
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
    const env = { ...authFreeEnv(), EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
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
    installFakeClaude(binDir, "Hardcoding for now with a DEBT: make it configurable post-launch.", {
      failOnNth: [2],
      failReply: "Just hardcoded it, no marker.",
    });
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
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
    installFakeClaude(binDir, "Hardcoding for now with a DEBT: make it configurable post-launch.", {
      failOnNth: [2, 3],
      failReply: "Just hardcoded it, no marker.",
    });
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
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
    installFakeClaude(binDir, "Hardcoding for now with a DEBT: make it configurable post-launch.", {
      failOnNth: [2],
      failReply: "Just hardcoded it, no marker.",
    });
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
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
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...args], {
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

test("materializeFixture: pins the fixture's git identity in its LOCAL config", () => {
  // Every child's env also carries a pinned identity, which would mask a lost local
  // pin; this keeps the pin itself guarded.
  const root = tmpDir("harry-evals-fxroot-");
  try {
    const { dir } = materializeFixture("tiny-node", root);
    const local = (key: string) =>
      execFileSync("git", ["config", "--local", key], { cwd: dir, encoding: "utf8" }).trim();
    assert.equal(local("user.name"), "Eval Fixture");
    assert.equal(local("user.email"), "eval@localhost");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A materialized fixture the test then tampers with as a session could.
function withFixture(fn: (fx: ReturnType<typeof materializeFixture>, root: string) => void) {
  const root = tmpDir("harry-evals-fxroot-");
  try {
    fn(materializeFixture("tiny-node", root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("restoreFixtureGitConfig: puts back exactly the config materializeFixture wrote", () => {
  withFixture((fx) => {
    const configPath = path.join(fx.dir, ".git", "config");
    writeFileSync(configPath, "[core]\n\tfsmonitor = /tmp/anything\n[include]\n\tpath = /x\n");
    restoreFixtureGitConfig(fx.dir, fx.gitConfig);
    assert.deepEqual(readFileSync(configPath), fx.gitConfig);
    // A session that deleted it gets it back too.
    rmSync(configPath);
    restoreFixtureGitConfig(fx.dir, fx.gitConfig);
    assert.deepEqual(readFileSync(configPath), fx.gitConfig);
  });
});

test("restoreFixtureGitConfig: refuses a commondir or config.worktree the session added", () => {
  for (const name of ["commondir", "config.worktree"]) {
    withFixture((fx) => {
      writeFileSync(path.join(fx.dir, ".git", name), "../elsewhere\n");
      assert.throws(
        () => restoreFixtureGitConfig(fx.dir, fx.gitConfig),
        new RegExp(`refusing to run git.*\\.git/${name.replace(".", "\\.")}`),
      );
    });
  }
});

test("restoreFixtureGitConfig: refuses a .git that is a gitdir file or a symlink", () => {
  withFixture((fx, root) => {
    const gitDir = path.join(fx.dir, ".git");
    const moved = path.join(root, "moved.git");
    execFileSync("mv", [gitDir, moved]);
    writeFileSync(gitDir, `gitdir: ${moved}\n`);
    assert.throws(() => restoreFixtureGitConfig(fx.dir, fx.gitConfig), /not a plain directory/);
    rmSync(gitDir);
    symlinkSync(moved, gitDir);
    assert.throws(() => restoreFixtureGitConfig(fx.dir, fx.gitConfig), /not a plain directory/);
  });
});

test("restoreFixtureGitConfig: refuses a symlinked .git/config and never writes through it", () => {
  withFixture((fx, root) => {
    // Stands in for ~/.gitconfig: the file a malicious link would aim the write at.
    const target = path.join(root, "operator.gitconfig");
    writeFileSync(target, "[user]\n\tname = Operator\n");
    const configPath = path.join(fx.dir, ".git", "config");
    rmSync(configPath);
    symlinkSync(target, configPath);
    assert.throws(() => restoreFixtureGitConfig(fx.dir, fx.gitConfig), /not a regular file/);
    assert.equal(readFileSync(target, "utf8"), "[user]\n\tname = Operator\n", "target untouched");
  });
});

// A scratch repo standing in for any repo the operator owns: the target of a fixture
// swap. Returns its dir and the exact config bytes that must survive.
function makeVictimRepo(): { dir: string; config: string } {
  const dir = tmpDir("harry-evals-victim-");
  execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: dir });
  const configPath = path.join(dir, ".git", "config");
  writeFileSync(configPath, `${readFileSync(configPath, "utf8")}[user]\n\tname = Victim\n`);
  return { dir, config: readFileSync(configPath, "utf8") };
}

// A session script that moves its fixture aside and leaves a symlink to `target` in
// its place: the swap that would aim the runner's restore at another repo.
function swapFixtureScript(binDir: string, target: string): string {
  const script = path.join(binDir, "swap.mjs");
  writeFileSync(
    script,
    [
      'import { renameSync, symlinkSync } from "node:fs";',
      "const here = process.cwd();",
      'renameSync(here, here + "-moved");',
      `symlinkSync(${JSON.stringify(target)}, here);`,
    ].join("\n"),
  );
  return script;
}

test("parsePostSessionOutput: accepts exactly one { ok, detail } per check, sanitized", () => {
  const out = JSON.stringify({
    outcomes: [
      { ok: true, detail: "fine" },
      { ok: false, detail: `a\u001b[31mred\u0007\nline${"x".repeat(2000)}` },
    ],
  });
  const [first, second] = parsePostSessionOutput(out, 2);
  assert.deepEqual(first, { ok: true, detail: "fine" });
  assert.equal(second.ok, false);
  const controls = Array.from(second.detail).filter((c) => {
    const code = c.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
  assert.deepEqual(controls, [], "no control characters survive");
  assert.ok(second.detail.endsWith("…[truncated]"), "capped");
  assert.ok(second.detail.length < 1100);
});

test("parsePostSessionOutput: refuses malformed or mis-shaped output without echoing it", () => {
  const secretish = "sk-ant-oat01-fake-echo-probe-Zz9";
  for (const [label, out, count] of [
    ["not JSON", `garbage ${secretish}`, 1],
    ["no outcomes", JSON.stringify({ note: secretish }), 1],
    ["too few", JSON.stringify({ outcomes: [] }), 1],
    [
      "too many",
      JSON.stringify({
        outcomes: [
          { ok: true, detail: "" },
          { ok: true, detail: "" },
        ],
      }),
      1,
    ],
    ["ok not boolean", JSON.stringify({ outcomes: [{ ok: "yes", detail: secretish }] }), 1],
    ["detail not string", JSON.stringify({ outcomes: [{ ok: true, detail: 5 }] }), 1],
    ["null outcome", JSON.stringify({ outcomes: [null] }), 1],
    ["null", "null", 1],
  ] as const) {
    const message = refusalOf(() => parsePostSessionOutput(out, count));
    assert.match(message, /post-session step printed/, label);
    assert.deepEqual(leakedFragments(message, secretish), [], `${label}: nothing echoed`);
  }
});

test("parsePostSessionOutput: an { error } is surfaced as a sanitized refusal", () => {
  const message = refusalOf(() =>
    parsePostSessionOutput(JSON.stringify({ error: "refusing to run git\u001b[2J here" }), 3),
  );
  assert.equal(message, "jailed post-session step: refusing to run git [2J here");
});

test("judgeFixture: refuses a fixture path that no longer leads to the materialized directory", () => {
  withFixture((fx, root) => {
    const payload = {
      fixtureDir: fx.dir,
      fixtureId: fx.id,
      gitConfig: fx.gitConfig.toString("base64"),
      initialBranch: fx.initialBranch,
      initialCommit: fx.initialCommit,
      checks: [{ type: "git_created_branch" }],
    };
    assert.deepEqual(judgeFixture(payload), [{ ok: false, detail: "(none)" }], "untouched: judged");
    // Same path, a different directory: moved aside and recreated.
    execFileSync("mv", [fx.dir, path.join(root, "moved")]);
    mkdirSync(fx.dir);
    assert.throws(() => judgeFixture(payload), /refusing to judge fixture .* replaced/);
  });
});

test("runEvals: every trial gets its own config, work and temp dirs, never another trial's", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const root = tmpDir("harry-evals-root-");
  try {
    installFakeClaude(binDir);
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: root,
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["destructive-confirmation", "agentic-isolate-branch"],
        out: path.join(binDir, "o.jsonl"),
        trials: 2,
        agentic: true,
      },
      env,
    );
    assert.equal(lines.length, 4);
    for (const key of ["trialDir", "configDir", "workDir"]) {
      const values = lines.map((l: Record<string, unknown>) => l[key]);
      assert.equal(new Set(values).size, 4, `${key}: one per trial`);
    }
    for (const l of lines as Record<string, string>[]) {
      assert.equal(path.dirname(l.trialDir), root, "each trial dir sits in the root");
      assert.equal(path.dirname(l.configDir), l.trialDir, "config dir inside its own trial");
      assert.equal(path.dirname(l.workDir), l.trialDir, "work dir inside its own trial");
      if (l.fixtureDir) {
        assert.equal(path.dirname(path.dirname(l.fixtureDir)), l.trialDir, "fixture inside it too");
      }
    }
    assert.ok(
      lines.every((l: Record<string, string>) =>
        readFileSync(path.join(l.configDir, "CLAUDE.md"), "utf8").includes("Resident"),
      ),
      "each trial's own config dir carries its own copy of the laws",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "runEvals: git and claude are resolved before the first session and never looked up again",
  shadowedBy("git"),
  () => {
    const binDir = tmpDir("harry-evals-bin-");
    const plant = tmpDir("harry-evals-plant-");
    const root = tmpDir("harry-evals-root-");
    try {
      // Trial 1's session drops a `git` and a `claude` into a directory that sits on
      // PATH ahead of the real ones — what a session could do to a user-writable dir
      // such as /opt/homebrew/bin. Each leaves a marker if the runner ever ran it.
      const marker = path.join(plant, "planted-ran");
      const script = path.join(binDir, "plant.mjs");
      const planted = `#!/bin/sh\ntouch '${marker}'\nexit 1\n`;
      writeFileSync(
        script,
        [
          'import { writeFileSync } from "node:fs";',
          'for (const name of ["git", "claude"])',
          `  writeFileSync(${JSON.stringify(plant)} + "/" + name, ${JSON.stringify(planted)}, { mode: 0o755 });`,
        ].join("\n"),
      );
      installFakeClaude(binDir, undefined, { script });
      const env = {
        ...authFreeEnv(),
        PATH: `${plant}:${binDir}:${process.env.PATH}`,
        EVALS_CLAUDE_BIN: "claude",
        EVALS_FIXTURE_ROOT: root,
        EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
      };
      const { lines } = runEvals(
        {
          condition: "candidate",
          model: "m",
          cases: ["agentic-isolate-branch", "destructive-confirmation"],
          out: path.join(binDir, "o.jsonl"),
          trials: 2,
          agentic: true,
        },
        env,
      );
      assert.ok(!existsSync(marker), "neither planted binary ever ran");
      assert.equal(readCalls(binDir).length, 4, "every session ran the claude resolved up front");
      assert.deepEqual(
        lines.map((l: Record<string, unknown>) => l.error),
        [undefined, undefined, undefined, undefined],
      );
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(plant, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("run CLI: control characters in a child's stderr never reach the operator's terminal", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const root = tmpDir("harry-evals-root-");
  try {
    installFakeClaude(binDir, undefined, { stderr: "\u001b]0;pwned\u0007\u001b[2Jcleared\n" });
    const result = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, "scripts", "run-evals.mjs"),
        "run",
        "--condition",
        "candidate",
        "--model",
        "m",
        "--cases",
        "destructive-confirmation",
        "--out",
        path.join(binDir, "o.jsonl"),
      ],
      {
        encoding: "utf8",
        env: {
          ...authFreeEnv(),
          EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
          EVALS_FIXTURE_ROOT: root,
          EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
        },
      },
    );
    assert.equal(result.status, 0, "the run itself succeeded");
    assert.ok(!result.stderr.includes("\u001b"), "no escape sequence on the CLI's stderr");
    assert.ok(!result.stdout.includes("\u001b"), "none on its stdout either");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "collectRepoState: git's stderr is piped, never passed through to the terminal",
  shadowedBy("git"),
  () => {
    const { dir, initialBranch, initialCommit } = buildSimulatedRepo();
    const fake = tmpDir("harry-evals-fakebin-");
    try {
      const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      installEnvLogger(fake, "git", realGit, "\u001b[2Jgit-noise\n");
      const runner = pathToFileURL(path.join(pluginRoot, "scripts", "run-evals.mjs")).href;
      const call = `collectRepoState(${JSON.stringify(dir)}, ${JSON.stringify(initialBranch)}, ${JSON.stringify(initialCommit)}, { PATH: ${JSON.stringify(`${fake}:${NODE_DIR}:/usr/bin:/bin`)} });`;
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { collectRepoState } from ${JSON.stringify(runner)};\n${call}`,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, "collectRepoState itself succeeded");
      assert.ok(!result.stderr.includes("\u001b"), "git's escape sequence stayed in the pipe");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(fake, { recursive: true, force: true });
    }
  },
);

test("buildBaseEnv: filtering twice keeps the proxy opt-in (idempotent)", () => {
  const once = buildBaseEnv({ ...syntheticOperatorEnv(), EVALS_FORWARD_PROXY: "1" });
  assert.equal(once.HTTPS_PROXY, "http://proxy.invalid:3128");
  assert.deepEqual(buildBaseEnv(once), once);
});

test("runEvals --agentic: a hung model-written test is cut off by the post-session timeout", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const root = tmpDir("harry-evals-root-");
  try {
    // The session writes a test that hangs for 8s (then exits, so nothing lingers).
    const hung =
      'import test from "node:test";\ntest("hang", () => new Promise((r) => setTimeout(r, 8000)));\n';
    const script = path.join(binDir, "hang.mjs");
    writeFileSync(
      script,
      `import { writeFileSync } from "node:fs";\nwriteFileSync("hang.test.mjs", ${JSON.stringify(hung)});\n`,
    );
    installFakeClaude(binDir, undefined, { script });
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: root,
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };
    const started = Date.now();
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["agentic-isolate-branch"],
        out: path.join(binDir, "o.jsonl"),
        agentic: true,
        postSessionTimeoutMs: 1500,
      },
      env,
    );
    assert.ok(Date.now() - started < 7000, "the run did not wait for the hung test");
    const outcomes = lines[0].checkOutcomes as {
      check: { type: string };
      ok: boolean;
      detail: string;
    }[];
    const run = outcomes.find((o) => o.check.type === "test_command_passes");
    assert.equal(run?.ok, false);
    assert.match(run?.detail ?? "", /timed out/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("runEvals --agentic: a fixture swapped for a symlink to another repo is refused, the repo untouched", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const fxRoot = tmpDir("harry-evals-fxroot-");
  const victim = makeVictimRepo();
  try {
    installFakeClaude(binDir, undefined, { script: swapFixtureScript(binDir, victim.dir) });
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: fxRoot,
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["agentic-isolate-branch"],
        out: path.join(binDir, "o.jsonl"),
        agentic: true,
      },
      env,
    );
    assert.equal(readFileSync(path.join(victim.dir, ".git", "config"), "utf8"), victim.config);
    assert.match(lines[0].error ?? "", /fixture .* (replaced|not the directory)/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(fxRoot, { recursive: true, force: true });
    rmSync(victim.dir, { recursive: true, force: true });
  }
});

test("runEvals --agentic: a session that adds .git/commondir gets the trial refused, not judged", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const fxRoot = tmpDir("harry-evals-fxroot-");
  try {
    const sessionScript = path.join(binDir, "session.mjs");
    writeFileSync(
      sessionScript,
      'import { writeFileSync } from "node:fs";\nwriteFileSync(".git/commondir", "../x\\n");\n',
    );
    installFakeClaude(binDir, undefined, { script: sessionScript });
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: fxRoot,
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["agentic-isolate-branch"],
        out: path.join(binDir, "o.jsonl"),
        agentic: true,
      },
      env,
    );
    assert.match(lines[0].error ?? "", /refusing to run git.*commondir/);
    assert.equal(lines[0].checkOutcomes, undefined, "no check was judged on a refused repo");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(fxRoot, { recursive: true, force: true });
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
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };
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
    const env = { ...authFreeEnv(), EVALS_CLAUDE_BIN: path.join(binDir, "claude") };
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
    installFakeClaude(binDir, undefined, { script: sessionScript });
    // The session's git identity comes from the env the runner pins for every
    // child; materializeFixture's LOCAL identity pin is guarded by its own test.
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: fxRoot,
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
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
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: fxRoot,
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
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

// ---- auth: exactly one explicit path, no credential on disk -----------------

// A fake operator config dir carrying only a .credentials.json, pointed at by
// env.CLAUDE_CONFIG_DIR: the file the removed seeded-credential path used to copy.
// The runner must never read it or copy it now.
function fakeOperatorConfig(withCreds: boolean): string {
  const dir = tmpDir("harry-evals-opcfg-");
  if (withCreds) {
    writeFileSync(path.join(dir, ".credentials.json"), '{"fake":"token"}');
  }
  return dir;
}

// Obvious fakes, shaped like the real thing so a leak test means something. None is
// a real credential.
const FAKE_EVALS_OAUTH = "sk-ant-oat01-fake-Qz9XvW7pLmK3jHfYtR";
const FAKE_EVALS_API_KEY = "sk-ant-api03-fake-Hj3KtY8wQeN5mB2cVx";
const FAKE_INHERITED_OAUTH = "sk-ant-oat01-fake-inherited-Lp4Rs6Tu";
const FAKE_INHERITED_API_KEY = "sk-ant-api03-fake-inherited-Wd7Ef9Gh";

// Every 6-char window of `secret` that appears in `text`; [] means no leak, whole
// or partial.
function leakedFragments(text: string, secret: string): string[] {
  const leaked: string[] = [];
  for (let i = 0; i + 6 <= secret.length; i++) {
    const fragment = secret.slice(i, i + 6);
    if (text.includes(fragment)) leaked.push(fragment);
  }
  return leaked;
}

function runOne(env: Record<string, string | undefined>, binDir: string, condition = "candidate") {
  return runEvals(
    {
      condition,
      model: "m",
      cases: ["destructive-confirmation"],
      out: path.join(binDir, `${condition}.jsonl`),
    },
    env,
  );
}

// Throws, and returns the message, so a test can inspect exactly what the operator sees.
function refusalOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  assert.fail("expected a refusal, got none");
}

test("resolveAuth: each single EVALS_ var selects its own path", () => {
  assert.deepEqual(resolveAuth({ EVALS_ANTHROPIC_API_KEY: FAKE_EVALS_API_KEY }), {
    kind: "api-key",
  });
  assert.deepEqual(resolveAuth({ EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH }), {
    kind: "oauth-token",
  });
});

test("resolveAuth: an empty string counts as unset", () => {
  assert.deepEqual(
    resolveAuth({ EVALS_ANTHROPIC_API_KEY: FAKE_EVALS_API_KEY, EVALS_CLAUDE_CODE_OAUTH_TOKEN: "" }),
    { kind: "api-key" },
  );
  assert.deepEqual(
    resolveAuth({ EVALS_ANTHROPIC_API_KEY: "", EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH }),
    { kind: "oauth-token" },
  );
  const both = refusalOf(() =>
    resolveAuth({ EVALS_ANTHROPIC_API_KEY: "", EVALS_CLAUDE_CODE_OAUTH_TOKEN: "" }),
  );
  assert.match(both, /EVALS_ANTHROPIC_API_KEY/, "two empties are neither set");
});

test("resolveAuth: neither set → refuses; bare inherited vars do not count", () => {
  const message = refusalOf(() =>
    resolveAuth({
      ANTHROPIC_API_KEY: FAKE_INHERITED_API_KEY,
      CLAUDE_CODE_OAUTH_TOKEN: FAKE_INHERITED_OAUTH,
    }),
  );
  assert.match(message, /EVALS_ANTHROPIC_API_KEY/);
  assert.match(message, /EVALS_CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(message, /claude setup-token/);
  assert.match(message, /\$\(cat /, "says how to hand a value over without printing it");
  assert.deepEqual(leakedFragments(message, FAKE_INHERITED_API_KEY), []);
  assert.deepEqual(leakedFragments(message, FAKE_INHERITED_OAUTH), []);
});

test("resolveAuth: both set → refuses as ambiguous, echoing no value", () => {
  const message = refusalOf(() =>
    resolveAuth({
      EVALS_ANTHROPIC_API_KEY: FAKE_EVALS_API_KEY,
      EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH,
    }),
  );
  assert.match(message, /EVALS_ANTHROPIC_API_KEY/);
  assert.match(message, /EVALS_CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(message, /claude setup-token/);
  assert.match(message, /\$\(cat /, "says how to hand a value over without printing it");
  assert.deepEqual(leakedFragments(message, FAKE_EVALS_API_KEY), []);
  assert.deepEqual(leakedFragments(message, FAKE_EVALS_OAUTH), []);
});

test("resolveAuth: a whitespace-only value counts as unset", () => {
  assert.deepEqual(
    resolveAuth({
      EVALS_ANTHROPIC_API_KEY: " \t ",
      EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH,
    }),
    { kind: "oauth-token" },
  );
  const message = refusalOf(() => resolveAuth({ EVALS_CLAUDE_CODE_OAUTH_TOKEN: "  \n" }));
  assert.match(message, /claude setup-token/, "whitespace alone is neither set");
});

test("resolveAuth: a value containing \\r is refused up front, naming the var and never the value", () => {
  for (const [name, value] of [
    ["EVALS_CLAUDE_CODE_OAUTH_TOKEN", `${FAKE_EVALS_OAUTH}\r`],
    ["EVALS_ANTHROPIC_API_KEY", `${FAKE_EVALS_API_KEY}\r`],
  ]) {
    const message = refusalOf(() => resolveAuth({ [name]: value }));
    assert.match(message, new RegExp(name));
    assert.match(message, /carriage return/);
    assert.deepEqual(leakedFragments(message, value.trim()), [], `${name}: no value content`);
  }
});

test("buildChildEnv: forwards the chosen value untouched (never trimmed or rewritten)", () => {
  const padded = ` ${FAKE_EVALS_OAUTH} `;
  const env = buildChildEnv({ EVALS_CLAUDE_CODE_OAUTH_TOKEN: padded }, "/cfg");
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, padded);
});

test("buildChildEnv: built from the allowlist plus one credential; nothing else survives", () => {
  const inherited = {
    PATH: "/usr/bin:relative/bin::/bin",
    HOME: "/home/evaluser",
    TMPDIR: "/somewhere/else",
    ANTHROPIC_API_KEY: FAKE_INHERITED_API_KEY,
    CLAUDE_CODE_OAUTH_TOKEN: FAKE_INHERITED_OAUTH,
    ANTHROPIC_AUTH_TOKEN: FAKE_INHERITED_OAUTH,
    ANTHROPIC_BASE_URL: "http://fake.invalid",
    CLAUDE_CODE_USE_BEDROCK: "1",
    NODE_OPTIONS: "--no-warnings",
    SSH_AUTH_SOCK: "/nonexistent/agent.sock",
    GIT_CONFIG_GLOBAL: "/home/evaluser/.gitconfig",
    DISABLE_TELEMETRY: "0",
  };
  const pinned = {
    // Relative and empty PATH entries resolve against the cwd (a fixture repo the
    // session wrote), so only absolute ones survive, behind the running node's dir.
    PATH: `${NODE_DIR}:/usr/bin:/bin`,
    HOME: "/home/evaluser",
    TMPDIR: os.tmpdir(),
    GIT_AUTHOR_NAME: "Eval Fixture",
    GIT_AUTHOR_EMAIL: "eval@localhost",
    GIT_COMMITTER_NAME: "Eval Fixture",
    GIT_COMMITTER_EMAIL: "eval@localhost",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    CLAUDE_CONFIG_DIR: "/cfg",
    // Privacy constants, set whatever the operator's shell said: the allowlist drops
    // the operator's own flags, so the runner states them itself.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_AUTOUPDATER: "1",
  };
  const oauth = buildChildEnv(
    { ...inherited, EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH },
    "/cfg",
  );
  assert.deepEqual(oauth, { ...pinned, CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH });
  const key = buildChildEnv({ ...inherited, EVALS_ANTHROPIC_API_KEY: FAKE_EVALS_API_KEY }, "/cfg");
  assert.deepEqual(key, { ...pinned, ANTHROPIC_API_KEY: FAKE_EVALS_API_KEY });
  // Called outside runEvals it still refuses rather than launch an unauthenticated child.
  assert.throws(() => buildChildEnv(inherited, "/cfg"), /EVALS_CLAUDE_CODE_OAUTH_TOKEN/);
});

test("runEvals: EVALS_CLAUDE_CODE_OAUTH_TOKEN reaches the child as CLAUDE_CODE_OAUTH_TOKEN, alone", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const opCfg = fakeOperatorConfig(true); // a .credentials.json the runner must ignore
  try {
    installFakeClaude(binDir);
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      CLAUDE_CONFIG_DIR: opCfg,
      EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH,
      // Inherited from the operator's shell: both must be stripped, never used.
      CLAUDE_CODE_OAUTH_TOKEN: FAKE_INHERITED_OAUTH,
      ANTHROPIC_API_KEY: FAKE_INHERITED_API_KEY,
    };
    runOne(env, binDir);
    const [call] = readCalls(binDir);
    assert.equal(call.oauthToken, FAKE_EVALS_OAUTH, "the EVALS_ token is the child's token");
    assert.equal(call.apiKey, null, "the inherited ANTHROPIC_API_KEY was stripped");
    assert.equal(call.evalsOauthForwarded, false, "EVALS_CLAUDE_CODE_OAUTH_TOKEN not forwarded");
    assert.equal(call.evalsApiKeyForwarded, false, "EVALS_ANTHROPIC_API_KEY not forwarded");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

test("runEvals: EVALS_ANTHROPIC_API_KEY reaches the child as ANTHROPIC_API_KEY, alone", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir);
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: FAKE_EVALS_API_KEY,
      CLAUDE_CODE_OAUTH_TOKEN: FAKE_INHERITED_OAUTH,
      ANTHROPIC_API_KEY: FAKE_INHERITED_API_KEY,
    };
    runOne(env, binDir);
    const [call] = readCalls(binDir);
    assert.equal(call.apiKey, FAKE_EVALS_API_KEY, "the EVALS_ key is the child's key");
    assert.equal(call.oauthToken, null, "the inherited CLAUDE_CODE_OAUTH_TOKEN was stripped");
    assert.equal(call.evalsApiKeyForwarded, false, "EVALS_ANTHROPIC_API_KEY not forwarded");
    assert.equal(call.evalsOauthForwarded, false, "EVALS_CLAUDE_CODE_OAUTH_TOKEN not forwarded");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runEvals: no credential file ever lands in a condition dir, even with one in CLAUDE_CONFIG_DIR", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const opCfg = fakeOperatorConfig(true);
  try {
    installFakeClaude(binDir);
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      CLAUDE_CONFIG_DIR: opCfg,
      EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH,
    };
    const baseline = runOne(env, binDir, "baseline");
    const candidate = runOne(env, binDir, "candidate");
    const calls = readCalls(binDir);
    assert.equal(calls.length, 2, "two sessions ran");
    assert.ok(
      calls.every((c) => c.hasCredentials === false),
      "no credential file was present during any session",
    );
    // The whole listing, not one filename: nothing but the laws is ever written.
    assert.deepEqual(readdirSync(baseline.lines[0].configDir), [], "baseline dir stays empty");
    assert.deepEqual(
      readdirSync(candidate.lines[0].configDir),
      ["CLAUDE.md"],
      "candidate holds only laws",
    );
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

test("runEvals: both EVALS_ auth vars set → refuses before any session, naming both, echoing neither", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const root = tmpDir("harry-evals-root-");
  try {
    installFakeClaude(binDir);
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: root,
      EVALS_ANTHROPIC_API_KEY: FAKE_EVALS_API_KEY,
      EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH,
    };
    const message = refusalOf(() => runOne(env, binDir));
    assert.match(message, /EVALS_ANTHROPIC_API_KEY/);
    assert.match(message, /EVALS_CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(message, /claude setup-token/);
    assert.deepEqual(leakedFragments(message, FAKE_EVALS_API_KEY), [], "no API key content");
    assert.deepEqual(leakedFragments(message, FAKE_EVALS_OAUTH), [], "no token content");
    assert.equal(readCalls(binDir).length, 0, "no session was launched before the refusal");
    assert.deepEqual(readdirSync(root), [], "no trial dir (config dir included) was created");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("runEvals: neither EVALS_ auth var set → refuses before any session, even with bare ones inherited", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const root = tmpDir("harry-evals-root-");
  const opCfg = fakeOperatorConfig(true); // the old seed source must not rescue the run
  try {
    installFakeClaude(binDir);
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: root,
      CLAUDE_CONFIG_DIR: opCfg,
      CLAUDE_CODE_OAUTH_TOKEN: FAKE_INHERITED_OAUTH,
      ANTHROPIC_API_KEY: FAKE_INHERITED_API_KEY,
    };
    const message = refusalOf(() => runOne(env, binDir));
    assert.match(message, /EVALS_ANTHROPIC_API_KEY/);
    assert.match(message, /EVALS_CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(message, /claude setup-token/);
    assert.deepEqual(leakedFragments(message, FAKE_INHERITED_OAUTH), [], "no token content");
    assert.deepEqual(leakedFragments(message, FAKE_INHERITED_API_KEY), [], "no key content");
    assert.equal(readCalls(binDir).length, 0, "no session was launched before the refusal");
    assert.deepEqual(readdirSync(root), [], "no trial dir (config dir included) was created");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(opCfg, { recursive: true, force: true });
  }
});

// A hostile-by-construction operator env: every value fake, and every var but the
// allowlisted ones must be dropped before any child sees it.
function syntheticOperatorEnv(): Record<string, string> {
  return {
    PATH: `${NODE_DIR}:/usr/bin:/bin`,
    HOME: "/nonexistent-eval-home",
    USER: "evaluser",
    LOGNAME: "evaluser",
    SHELL: "/bin/sh",
    TERM: "dumb",
    LANG: "C.UTF-8",
    LC_CTYPE: "C.UTF-8",
    TMPDIR: "/nonexistent-eval-tmp",
    NODE_OPTIONS: "--no-warnings",
    SSH_AUTH_SOCK: "/nonexistent/agent.sock",
    ANTHROPIC_API_KEY: FAKE_INHERITED_API_KEY,
    CLAUDE_CODE_OAUTH_TOKEN: FAKE_INHERITED_OAUTH,
    ANTHROPIC_AUTH_TOKEN: FAKE_INHERITED_OAUTH,
    ANTHROPIC_BASE_URL: "http://fake.invalid",
    ANTHROPIC_MODEL: "fake-model",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
    CLAUDE_CODE_USE_FOUNDRY: "1",
    HTTPS_PROXY: "http://proxy.invalid:3128",
    NODE_EXTRA_CA_CERTS: "/nonexistent/ca.pem",
    GITHUB_TOKEN: "ghp_fake_not_a_real_token",
    AWS_SECRET_ACCESS_KEY: "fake-not-a-real-secret",
  };
}
const BASE_KEYS = [
  "HOME",
  "LANG",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
];
// macOS CoreFoundation sets __CF_USER_TEXT_ENCODING inside any process that loads
// it, node included, so it shows up in a child's env whatever env it was handed.
// The builder tests pin that the runner never passes it; the spawn tests drop it.
function spawnedKeys(keys: string[]): string[] {
  return keys.filter((k) => k !== "__CF_USER_TEXT_ENCODING");
}
const PRIVACY_KEYS = [
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "DISABLE_AUTOUPDATER",
  "DISABLE_TELEMETRY",
];
const GIT_KEYS = [
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
];

test("buildBaseEnv: the allowlist only; proxy/CA vars only on EVALS_FORWARD_PROXY=1", () => {
  const operator = { ...syntheticOperatorEnv(), PATH: "relative:/usr/bin::/usr/bin:/bin" };
  const base = {
    PATH: `${NODE_DIR}:/usr/bin:/bin`,
    HOME: "/nonexistent-eval-home",
    USER: "evaluser",
    LOGNAME: "evaluser",
    SHELL: "/bin/sh",
    TERM: "dumb",
    LANG: "C.UTF-8",
    LC_CTYPE: "C.UTF-8",
    TMPDIR: os.tmpdir(),
  };
  assert.deepEqual(buildBaseEnv(operator), base);
  assert.deepEqual(
    buildBaseEnv({ ...operator, EVALS_FORWARD_PROXY: "1", no_proxy: "localhost" }),
    {
      ...base,
      HTTPS_PROXY: "http://proxy.invalid:3128",
      NODE_EXTRA_CA_CERTS: "/nonexistent/ca.pem",
      no_proxy: "localhost",
      // The flag rides along so a second filter (a jailed child's own) keeps these.
      EVALS_FORWARD_PROXY: "1",
    },
    "the fixed proxy/CA set and the flag only; everything else stays out",
  );
  assert.equal(buildBaseEnv({}).PATH, NODE_DIR, "no operator PATH: the running node's dir alone");
});

test("buildGitEnv: the allowlist plus a pinned identity and no global or system config", () => {
  assert.deepEqual(buildGitEnv(syntheticOperatorEnv()), {
    ...buildBaseEnv(syntheticOperatorEnv()),
    GIT_AUTHOR_NAME: "Eval Fixture",
    GIT_AUTHOR_EMAIL: "eval@localhost",
    GIT_COMMITTER_NAME: "Eval Fixture",
    GIT_COMMITTER_EMAIL: "eval@localhost",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  });
});

test("runEvals: the claude child's env is exactly the allowlist, its config dir, and one credential", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir);
    const env = {
      ...syntheticOperatorEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH,
    };
    runOne(env, binDir);
    const [call] = readCalls(binDir);
    assert.deepEqual(
      spawnedKeys(call.envKeys),
      [
        ...BASE_KEYS,
        ...GIT_KEYS,
        ...PRIVACY_KEYS,
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CONFIG_DIR",
      ].sort(),
    );
    assert.equal(call.oauthToken, FAKE_EVALS_OAUTH);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("test_command_passes: model-written tests run with the credential-free allowlist env", () => {
  const dir = tmpDir("harry-evals-probe-");
  try {
    // The command the check runs is model-written code: here, a probe that records
    // the names of every env var it was handed.
    writeFileSync(
      path.join(dir, "probe.mjs"),
      'import { writeFileSync } from "node:fs";\n' +
        'writeFileSync("env-keys.json", JSON.stringify(Object.keys(process.env).sort()));\n',
    );
    const state = {
      fixtureDir: dir,
      env: {
        ...syntheticOperatorEnv(),
        EVALS_ANTHROPIC_API_KEY: FAKE_EVALS_API_KEY,
        EVALS_CLAUDE_CODE_OAUTH_TOKEN: FAKE_EVALS_OAUTH,
      },
    } as unknown as RepoState;
    const outcome = evaluateArtifactCheck(
      { type: "test_command_passes", command: "node probe.mjs" },
      state,
    );
    assert.equal(outcome.ok, true, outcome.detail);
    const keys = spawnedKeys(JSON.parse(readFileSync(path.join(dir, "env-keys.json"), "utf8")));
    assert.deepEqual(
      keys,
      BASE_KEYS,
      "no credential, no config dir, nothing outside the allowlist",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A hook that leaves a marker file when git runs it: the probe for config-borne
// command execution in the runner's own git calls.
function plantHook(dir: string): { hook: string; marker: string } {
  const hook = path.join(dir, "hook.sh");
  const marker = path.join(dir, "hook-ran");
  writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  return { hook, marker };
}

// A logging stand-in for a real binary, put first on a test PATH: it appends the
// names (never values) of the env vars it was spawned with, then either runs the
// real binary with the same argv or exits 1.
function installEnvLogger(
  dir: string,
  name: string,
  realBin: string | null,
  stderrText = "",
): { log: string; readKeys: () => string[][] } {
  const log = path.join(dir, `${name}-env.jsonl`);
  writeFileSync(
    path.join(dir, name),
    [
      "#!/usr/bin/env node",
      'const { appendFileSync } = require("node:fs");',
      'const { execFileSync } = require("node:child_process");',
      `appendFileSync(${JSON.stringify(log)}, JSON.stringify(Object.keys(process.env).sort()) + "\\n");`,
      `process.stderr.write(${JSON.stringify(stderrText)});`,
      realBin === null
        ? "process.exit(1);"
        : [
            "try {",
            `  execFileSync(${JSON.stringify(realBin)}, process.argv.slice(2), { stdio: "inherit" });`,
            "} catch (err) {",
            "  process.exit(err.status ?? 1);",
            "}",
          ].join("\n"),
    ].join("\n"),
    { mode: 0o755 },
  );
  const readKeys = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((l) => spawnedKeys(JSON.parse(l)))
      : [];
  return { log, readKeys };
}

// The allowlist puts the running node's dir first on PATH; a logger placed after it
// is shadowed if that dir also holds the real binary (e.g. /usr/bin on some Linux).
function shadowedBy(name: string): { skip: string | false } {
  return {
    skip: existsSync(path.join(NODE_DIR, name))
      ? `${name} lives next to node, so a PATH logger cannot shadow it`
      : false,
  };
}

test(
  "collectRepoState: every git spawn gets exactly the base allowlist plus the git pins",
  shadowedBy("git"),
  () => {
    const { dir, initialBranch, initialCommit } = buildSimulatedRepo();
    const fake = tmpDir("harry-evals-fakebin-");
    try {
      const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      const { readKeys } = installEnvLogger(fake, "git", realGit);
      collectRepoState(dir, initialBranch, initialCommit, {
        ...syntheticOperatorEnv(),
        PATH: `${fake}:${NODE_DIR}:/usr/bin:/bin`,
      });
      const spawns = readKeys();
      assert.ok(spawns.length >= 5, "each of collectRepoState's git calls went through the logger");
      for (const keys of spawns) assert.deepEqual(keys, [...BASE_KEYS, ...GIT_KEYS].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(fake, { recursive: true, force: true });
    }
  },
);

test(
  "buildAgenticSandboxProfile: resolves a bare claude in-process, never by spawning `which`",
  shadowedBy("which"),
  () => {
    const fake = tmpDir("harry-evals-fakebin-");
    try {
      const { readKeys } = installEnvLogger(fake, "which", null);
      buildAgenticSandboxProfile({
        home: os.homedir(),
        bin: "claude",
        env: { ...syntheticOperatorEnv(), PATH: `${fake}:${NODE_DIR}:/usr/bin:/bin` },
      });
      assert.deepEqual(readKeys(), [], "`which` was never spawned");
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  },
);

test(
  "runEvals: sandbox-exec is resolved in-process, never by spawning `which`",
  shadowedBy("which"),
  () => {
    const binDir = tmpDir("harry-evals-bin-");
    const fake = tmpDir("harry-evals-fakebin-");
    try {
      installFakeClaude(binDir);
      // A `which` logger first on a PATH that holds no sandbox-exec: the run must
      // refuse (not found on macOS, unsupported elsewhere) without spawning it.
      const { readKeys } = installEnvLogger(fake, "which", null);
      const env = {
        ...syntheticOperatorEnv(),
        PATH: `${fake}:${NODE_DIR}`,
        EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
        EVALS_SANDBOX: "1",
        EVALS_ANTHROPIC_API_KEY: FAKE_EVALS_API_KEY,
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
      );
      assert.deepEqual(readKeys(), [], "`which` was never spawned");
      assert.equal(readCalls(binDir).length, 0, "no session was launched");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(fake, { recursive: true, force: true });
    }
  },
);

test("collectRepoState: the state carries the allowlisted env, never the runner's own", () => {
  const { dir, initialBranch, initialCommit } = buildSimulatedRepo();
  try {
    const env = { ...syntheticOperatorEnv(), PATH: process.env.PATH ?? "" };
    const state = collectRepoState(dir, initialBranch, initialCommit, env);
    assert.deepEqual(state.env, buildBaseEnv(env));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectRepoState: a repo-local core.fsmonitor never runs, even with no restore", () => {
  // The second layer on its own: collectRepoState does not restore .git/config, so
  // only the runner's `-c core.fsmonitor=false` stands between this hook and git.
  const { dir, initialBranch, initialCommit } = buildSimulatedRepo();
  try {
    const { hook, marker } = plantHook(dir);
    writeFileSync(
      path.join(dir, ".git", "config"),
      `${readFileSync(path.join(dir, ".git", "config"), "utf8")}[core]\n\tfsmonitor = ${hook}\n`,
    );
    collectRepoState(dir, initialBranch, initialCommit, { PATH: process.env.PATH });
    assert.ok(!existsSync(marker), "the repo-local fsmonitor hook never ran");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectRepoState: the runner's git calls ignore the operator's global git config", () => {
  const { dir, initialBranch, initialCommit } = buildSimulatedRepo();
  const home = tmpDir("harry-evals-home-");
  try {
    const { hook, marker } = plantHook(home);
    writeFileSync(path.join(home, ".gitconfig"), `[core]\n\tfsmonitor = ${hook}\n`);
    collectRepoState(dir, initialBranch, initialCommit, { PATH: process.env.PATH, HOME: home });
    assert.ok(!existsSync(marker), "a hook in ~/.gitconfig never ran under the runner's git");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("runEvals --agentic: a session that plants core.fsmonitor in .git/config never gets it run", () => {
  const binDir = tmpDir("harry-evals-bin-");
  const fxRoot = tmpDir("harry-evals-fxroot-");
  try {
    const { hook, marker } = plantHook(binDir);
    const sessionScript = path.join(binDir, "session.mjs");
    writeFileSync(
      sessionScript,
      'import { appendFileSync } from "node:fs";\n' +
        `appendFileSync(".git/config", ${JSON.stringify(`[core]\n\tfsmonitor = ${hook}\n`)});\n`,
    );
    installFakeClaude(binDir, undefined, { script: sessionScript });
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_FIXTURE_ROOT: fxRoot,
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };
    const { lines } = runEvals(
      {
        condition: "candidate",
        model: "m",
        cases: ["agentic-isolate-branch"],
        out: path.join(binDir, "o.jsonl"),
        agentic: true,
      },
      env,
    );
    assert.equal(readCalls(binDir).length, 1, "the session ran");
    assert.ok(!existsSync(marker), "the planted fsmonitor hook never ran");
    assert.equal(lines[0].error, undefined, "the restored config let the checks run");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(fxRoot, { recursive: true, force: true });
  }
});

test("runEvals: an is_error result (e.g. 'Not logged in') lands as a case error, not a response", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    installFakeClaude(binDir, "Not logged in · Please run /login", { isError: true });
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
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
  }
});

test("runEvals: text lines record per-check outcomes (same shape as agentic)", () => {
  const binDir = tmpDir("harry-evals-bin-");
  try {
    // A lawful reply that satisfies debt-shortcut's DEBT: check.
    installFakeClaude(binDir, "Hardcoding for now with a DEBT: make it configurable post-launch.");
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    };
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
  try {
    installFakeClaude(binDir, "boom: some diagnostic on stderr", { fail: true });
    const env = {
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
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
  }
});

// ---- opt-in OS sandbox (EVALS_SANDBOX=1, macOS seatbelt) --------------------

const DARWIN_ONLY = { skip: process.platform !== "darwin" ? "macOS-only (seatbelt)" : false };
// Mirror of AGENTIC_ALLOWED_TOOLS (not exported) — the args must pass through the
// sandbox-exec wrapper unchanged, so the shim still sees this exact allowlist.
const AGENTIC_TOOLS =
  "Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git add:*),Bash(git commit:*)," +
  "Bash(git branch:*),Bash(git checkout:*),Bash(git switch:*),Bash(node:*)";

// The whole profile, pinned as fixed text for fixed inputs: any rule added,
// removed, widened or reordered is an edit here that review sees, not only a
// change to the names or paths some narrower check extracts. SBPL is
// last-match-wins, so the order is policy too: `(deny default)` first, the broad
// read allow, then the $HOME deny, the narrow allows, and the terminal deny LAST so
// no read allow (of /dev, say) can re-open it. Literal on purpose: never build the
// expectation from the code's own constants.
test("buildSeatbeltProfile: the whole profile is exactly this text (golden)", () => {
  const profile = buildSeatbeltProfile({
    home: "/Users/op",
    // Deduped, in order of first appearance.
    allowWrite: [
      "/private/var/folders/t/trial/config",
      "/private/var/folders/t/trial/fixture/repo",
      "/private/var/folders/t/trial/tmp",
      "/private/var/folders/t/trial/tmp",
    ],
    // An empty path is dropped, never emitted as a (subpath "").
    allowRead: [
      "/Users/op/.local/share/claude/versions",
      "/opt/homebrew/Cellar/node/26.9.0/bin",
      "",
      "/Users/op/Projects/harry/scripts/run-evals.mjs",
    ],
    // /usr/bin, the xcrun git shim's tree, is already allowed and is not repeated.
    allowExec: [
      "/Users/op/.local/share/claude/versions",
      "/opt/homebrew/Cellar/node/26.9.0/bin",
      "/usr/bin",
    ],
  });
  assert.equal(
    profile,
    `(version 1)
;; harry evals seatbelt profile (opt-in EVALS_SANDBOX=1, agentic sessions).
;; Deny everything, then allow back only what node, claude and git need:
;; no system service that could start a program outside this jail.
(deny default)
(allow process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read*)
(deny file-read* (subpath "/Users/op"))
(allow file-read* file-write* (literal "/dev/null"))
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
)
(allow network-outbound (remote ip "*:*"))
(allow network-outbound (literal "/private/var/run/mDNSResponder"))
(allow process-exec
  (subpath "/bin")
  (subpath "/usr/bin")
  (subpath "/Users/op/.local/share/claude/versions")
  (subpath "/opt/homebrew/Cellar/node/26.9.0/bin")
)
;; read+write: this trial's config dir, fixture repo and temp dir only.
(allow file-read* file-write*
  (subpath "/private/var/folders/t/trial/config")
  (subpath "/private/var/folders/t/trial/fixture/repo")
  (subpath "/private/var/folders/t/trial/tmp")
)
;; read-only: claude + node runtime install trees, and the runner script.
(allow file-read*
  (subpath "/Users/op/.local/share/claude/versions")
  (subpath "/opt/homebrew/Cellar/node/26.9.0/bin")
  (subpath "/Users/op/Projects/harry/scripts/run-evals.mjs")
)
;; no terminal reads (what the operator types); last, so no allow above re-opens it.
(deny file-read* (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))
`,
  );
});

test("buildSeatbeltProfile: with no trial dirs or runtime trees, those sections are left out (golden)", () => {
  assert.equal(
    buildSeatbeltProfile({ home: "/Users/op" }),
    `(version 1)
;; harry evals seatbelt profile (opt-in EVALS_SANDBOX=1, agentic sessions).
;; Deny everything, then allow back only what node, claude and git need:
;; no system service that could start a program outside this jail.
(deny default)
(allow process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read*)
(deny file-read* (subpath "/Users/op"))
(allow file-read* file-write* (literal "/dev/null"))
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
)
(allow network-outbound (remote ip "*:*"))
(allow network-outbound (literal "/private/var/run/mDNSResponder"))
(allow process-exec
  (subpath "/bin")
  (subpath "/usr/bin")
)
;; no terminal reads (what the operator types); last, so no allow above re-opens it.
(deny file-read* (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))
`,
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
      // Writes: denied everywhere but the allowed dirs, OUTSIDE $HOME too (a
      // user-writable PATH dir such as /opt/homebrew/bin is outside $HOME).
      const outside = realpathSync(tmpDir("harry-sb-outside-"));
      try {
        const touchUnder = (file: string): boolean => {
          try {
            execFileSync("sandbox-exec", ["-p", profile, "touch", file], { stdio: "ignore" });
            return true;
          } catch {
            return false;
          }
        };
        assert.equal(
          touchUnder(path.join(outside, "planted")),
          false,
          "write outside $HOME denied",
        );
        assert.equal(
          touchUnder(path.join(exception, "made")),
          true,
          "write to an allowed dir works",
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
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
      profile.includes(`(deny file-read* (subpath "${real}"))`),
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

test(
  "buildAgenticSandboxProfile under REAL sandbox-exec: a jailed process cannot read the terminal it runs in",
  DARWIN_ONLY,
  () => {
    // A real pty: script(1) runs the command with a fresh pty slave as its
    // controlling terminal and copies its own stdin into it, standing in for the
    // operator typing during a run. script's stdin must be one tcgetattr fails on
    // with ENOTTY (a file); node's own stdio pipes are sockets, which script rejects.
    const dir = realpathSync(tmpDir("harry-sb-tty-"));
    try {
      const profile = buildAgenticSandboxProfile({
        home: os.homedir(),
        allowWrite: [dir],
        bin: process.execPath,
      });
      const typed = path.join(dir, "typed.txt");
      writeFileSync(typed, "typed-secret\n");
      const result = path.join(dir, "result.json");
      // Opens the controlling tty by both names, records each outcome, then reads
      // what was typed from the first one that opened.
      const reader = [
        'const fs = require("node:fs");',
        "const dir = process.argv[1];",
        "const r = { open: {}, read: null };",
        "const fds = [];",
        'for (const p of ["/dev/tty", fs.readFileSync(dir + "/ttyname", "utf8").trim()]) {',
        '  try { fds.push(fs.openSync(p, "r")); r.open[p] = "ok"; } catch (e) { r.open[p] = e.code; }',
        "}",
        'const save = () => fs.writeFileSync(dir + "/result.json", JSON.stringify(r));',
        "save();",
        "if (fds.length) {",
        '  let text = ""; const b = Buffer.alloc(256);',
        '  for (let i = 0; i < 5 && !text.includes("typed-secret"); i++)',
        "    text += b.subarray(0, fs.readSync(fds[0], b)).toString();",
        "  r.read = text; save();",
        "}",
      ].join("\n");
      const inner =
        '/usr/bin/tty > "$1/ttyname"; ' +
        'if [ -n "$5" ]; then exec /usr/bin/sandbox-exec -p "$2" "$3" -e "$4" "$1"; fi; ' +
        'exec "$3" -e "$4" "$1"';
      const inPty = (jailed: boolean) => {
        rmSync(result, { force: true });
        const stdin = openSync(typed, "r");
        try {
          const shArgs = [dir, profile, process.execPath, reader, jailed ? "1" : ""];
          spawnSync(
            "/usr/bin/script",
            ["-q", "/dev/null", "/bin/sh", "-c", inner, "sh", ...shArgs],
            {
              stdio: [stdin, "ignore", "ignore"],
              timeout: 10_000,
              killSignal: "SIGKILL",
            },
          );
        } finally {
          closeSync(stdin);
        }
        return JSON.parse(readFileSafe(result) || "{}") as {
          open?: Record<string, string>;
          read?: string | null;
        };
      };
      const ttyOf = () => readFileSync(path.join(dir, "ttyname"), "utf8").trim();

      // Not vacuous: unjailed, the same process opens the terminal by both names and
      // reads what was typed into it.
      const free = inPty(false);
      assert.match(ttyOf(), /^\/dev\/ttys[0-9]+$/, "script gave the child a real pty slave");
      assert.deepEqual(free.open, { "/dev/tty": "ok", [ttyOf()]: "ok" }, "unjailed: both open");
      assert.match(String(free.read), /typed-secret/, "unjailed: the typed text is readable");

      const jailed = inPty(true);
      assert.deepEqual(
        jailed.open,
        { "/dev/tty": "EPERM", [ttyOf()]: "EPERM" },
        "jailed: the terminal cannot be opened for reading by either name",
      );
      assert.equal(jailed.read, null, "jailed: nothing typed was read");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("requireSandboxSupport: refuses non-macOS and a missing sandbox-exec; passes on both present", () => {
  assert.throws(
    () => requireSandboxSupport("linux", "/usr/bin/sandbox-exec"),
    /macOS-only/,
    "non-darwin is a hard refusal (never silently unsandboxed)",
  );
  assert.throws(
    () => requireSandboxSupport("freebsd", "/x"),
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
      ...authFreeEnv(),
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
      ...authFreeEnv(),
      EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
      EVALS_SANDBOX: "1",
      EVALS_SANDBOX_EXEC: "",
      EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
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
      // Jailed, the shim may write only its trial's dirs: it logs into its config dir.
      installFakeClaude(binDir, undefined, { callsInConfigDir: true });
      // Real sandbox-exec, fake shim (no API spend, no real claude session). Proves
      // the wrapper resolves so the shim still runs under the jail AND that the
      // original args pass through the sandbox-exec wrapper untouched.
      const env = {
        ...authFreeEnv(),
        EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
        EVALS_FIXTURE_ROOT: fxRoot,
        EVALS_SANDBOX: "1",
        EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
        CLAUDE_CODE_OAUTH_TOKEN: FAKE_INHERITED_OAUTH,
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
      const calls = readCalls(lines[0].configDir);
      assert.equal(calls.length, 1, "the fake shim executed inside the seatbelt jail");
      assert.equal(
        calls[0].allowedTools,
        AGENTIC_TOOLS,
        "the git+node allowlist passed through the sandbox-exec wrapper intact",
      );
      assert.equal(calls[0].permissionMode, "acceptEdits", "permission mode survived the wrapper");
      // The sandboxed env is built by the same child-env function as the others.
      assert.equal(calls[0].apiKey, "sk-ant-test", "the EVALS_ key reached the jailed child");
      assert.equal(calls[0].oauthToken, null, "the inherited token was stripped under the jail");
      assert.equal(calls[0].evalsApiKeyForwarded, false, "EVALS_ANTHROPIC_API_KEY not forwarded");
      const testRun = lines[0].checkOutcomes.find(
        (o: { check: { type: string } }) => o.check.type === "test_command_passes",
      );
      assert.equal(testRun?.ok, true, "the fixture's own tests pass under the jail");
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

// Stands in for sandbox-exec: logs its argv (the profile and the wrapped command),
// then hands the same argv to the real /usr/bin/sandbox-exec, so the jail still
// applies and a test can compare what each spawn was wrapped with. It is the child
// each jailed spawn starts, holding exactly the fds that spawn handed it, so it
// also logs whether its fds 0, 1 and 2 are a terminal, one JSON array per spawn.
function installLoggingSandboxExec(binDir: string): {
  wrapper: string;
  log: string;
  ttyLog: string;
} {
  const wrapper = path.join(binDir, "sandbox-exec-logger");
  const log = path.join(binDir, "sandbox-exec-log.jsonl");
  const ttyLog = path.join(binDir, "sandbox-exec-tty.jsonl");
  writeFileSync(
    wrapper,
    [
      "#!/usr/bin/env node",
      'const { appendFileSync } = require("node:fs");',
      'const { execFileSync } = require("node:child_process");',
      'const { isatty } = require("node:tty");',
      "const argv = process.argv.slice(2);",
      `appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + "\\n");`,
      `appendFileSync(${JSON.stringify(ttyLog)}, JSON.stringify([0, 1, 2].map((fd) => isatty(fd))) + "\\n");`,
      "try {",
      '  execFileSync("/usr/bin/sandbox-exec", argv, { stdio: "inherit" });',
      "} catch (err) {",
      "  process.exit(err.status ?? 1);",
      "}",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { wrapper, log, ttyLog };
}

// Runs one sandboxed agentic trial of `agentic-isolate-branch` with a scripted session.
function runJailedTrial(
  binDir: string,
  fxRoot: string,
  extraEnv: Record<string, string> = {},
): Record<string, unknown>[] {
  const env = {
    ...authFreeEnv(),
    EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
    EVALS_FIXTURE_ROOT: fxRoot,
    EVALS_SANDBOX: "1",
    EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
    ...extraEnv,
  };
  return runEvals(
    {
      condition: "candidate",
      model: "m",
      cases: ["agentic-isolate-branch"],
      out: path.join(binDir, "o.jsonl"),
      agentic: true,
    },
    env,
  ).lines;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

test(
  "runEvals --agentic under EVALS_SANDBOX=1: the post-session step is ONE child under the session's profile",
  DARWIN_ONLY,
  () => {
    const binDir = tmpDir("harry-evals-bin-");
    const fxRoot = tmpDir("harry-evals-fxroot-");
    try {
      installFakeClaude(binDir, undefined, { callsInConfigDir: true });
      const { wrapper, log } = installLoggingSandboxExec(binDir);
      const lines = runJailedTrial(binDir, fxRoot, { EVALS_SANDBOX_EXEC: wrapper });
      const spawns = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as string[]);
      assert.equal(spawns.length, 2, "the session, then exactly one post-session child");
      const [session, post] = spawns;
      assert.equal(session[2], path.join(binDir, "claude"), "first: the claude session");
      assert.equal(post[1], session[1], "the post-session child runs under the session's profile");
      assert.equal(post[2], process.execPath);
      assert.deepEqual(post.slice(-1), ["__post-session"]);
      // AC-15: the one profile lets the jail write ONLY this trial's config dir,
      // fixture and temp dir (plus /dev/null) — no shared temp root, no fixture
      // parent, nothing a later unjailed step reads.
      const line = lines[0] as Record<string, string>;
      const writable = session[1]
        .split("\n(")
        .filter((rule) => /^allow file-(read\* file-)?write\*/.test(rule))
        .flatMap((rule) =>
          Array.from(rule.matchAll(/\((?:subpath|literal) "([^"]+)"\)/g), (m) => m[1]),
        );
      assert.deepEqual(
        writable.sort(),
        [
          "/dev/null",
          realpathSync(line.configDir),
          realpathSync(line.fixtureDir),
          realpathSync(path.join(line.trialDir, "tmp")),
        ].sort(),
      );
      assert.equal(lines[0].error, undefined, String(lines[0].error));
      const outcomes = lines[0].checkOutcomes as { check: { type: string }; ok: boolean }[];
      assert.deepEqual(
        outcomes.map((o) => [o.check.type, o.ok]),
        [
          ["git_created_branch", false],
          ["git_no_new_commits_on_initial", true],
          ["test_command_passes", true],
        ],
        "judged inside the jail: no branch made, seed tests green",
      );
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(fxRoot, { recursive: true, force: true });
    }
  },
);

test("run CLI under a real pty, EVALS_SANDBOX=1: no spawned child holds the terminal on fd 0, 1 or 2", {
  skip: DARWIN_ONLY.skip || shadowedBy("git").skip,
}, () => {
  // The jail denies OPENING a terminal (its last rule), not reading one a process
  // already holds: a terminal handed over on fd 0, 1 or 2 reads freely under the
  // jail. So a runner started from a terminal must hand every child pipes or
  // /dev/null, never "inherit". script(1) gives the runner a real pty on all three
  // fds, as the operator's shell would, and each spawned child records its own:
  //   - the sandbox-exec stand-in, which IS the child the session spawn and the
  //     post-session spawn start (the jailed process keeps its fds);
  //   - the fake claude, from inside the jail;
  //   - a git logger on PATH, for the runner's own git spawns. The jailed git
  //     calls cannot write its log, and hold the post-session child's fds,
  //     recorded above; so does the model-written test command.
  const dir = realpathSync(tmpDir("harry-evals-pty-fds-"));
  try {
    const binDir = path.join(dir, "bin");
    const gitDir = path.join(dir, "git");
    const fxRoot = path.join(dir, "root");
    for (const d of [binDir, gitDir, fxRoot]) mkdirSync(d);
    installFakeClaude(binDir, undefined, { callsInConfigDir: true });
    const { wrapper, ttyLog } = installLoggingSandboxExec(binDir);
    const gitLog = path.join(gitDir, "git-tty.jsonl");
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    writeFileSync(
      path.join(gitDir, "git"),
      [
        "#!/usr/bin/env node",
        'const { appendFileSync } = require("node:fs");',
        'const { execFileSync } = require("node:child_process");',
        'const { isatty } = require("node:tty");',
        "try {",
        `  appendFileSync(${JSON.stringify(gitLog)}, JSON.stringify([0, 1, 2].map((fd) => isatty(fd))) + "\\n");`,
        "} catch {}",
        "try {",
        `  execFileSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: "inherit" });`,
        "} catch (err) {",
        "  process.exit(err.status ?? 1);",
        "}",
      ].join("\n"),
      { mode: 0o755 },
    );
    // script's stdin must be a file (see the terminal-read test above).
    const typed = path.join(dir, "typed.txt");
    writeFileSync(typed, "typed\n");
    const inPty = (argv: string[], env: Record<string, string | undefined>) => {
      const stdin = openSync(typed, "r");
      try {
        spawnSync("/usr/bin/script", ["-q", "/dev/null", ...argv], {
          stdio: [stdin, "ignore", "ignore"],
          env,
          timeout: 120_000,
          killSignal: "SIGKILL",
        });
      } finally {
        closeSync(stdin);
      }
    };
    const ttyRecords = (file: string) =>
      readFileSafe(file)
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as boolean[]);

    // Not vacuous: the same harness puts a terminal on all three fds, and isatty
    // reports it from inside the jail as well as outside it.
    const control = path.join(dir, "control.jsonl");
    const probe = `require("node:fs").appendFileSync(${JSON.stringify(control)}, JSON.stringify([0, 1, 2].map((fd) => require("node:tty").isatty(fd))) + "\\n")`;
    const profile = buildAgenticSandboxProfile({
      home: os.homedir(),
      allowWrite: [dir],
      bin: process.execPath,
    });
    inPty([process.execPath, "-e", probe], process.env);
    inPty(["/usr/bin/sandbox-exec", "-p", profile, process.execPath, "-e", probe], process.env);
    assert.deepEqual(
      ttyRecords(control),
      [
        [true, true, true],
        [true, true, true],
      ],
      "script gives a process the terminal on fds 0-2, and isatty sees it jailed too",
    );

    const out = path.join(dir, "o.jsonl");
    const runner = path.join(pluginRoot, "scripts", "run-evals.mjs");
    inPty(
      [
        process.execPath,
        runner,
        "run",
        "--condition",
        "candidate",
        "--model",
        "m",
        "--cases",
        "agentic-isolate-branch",
        "--out",
        out,
        "--agentic",
      ],
      {
        ...authFreeEnv(),
        PATH: `${gitDir}:${process.env.PATH}`,
        EVALS_CLAUDE_BIN: path.join(binDir, "claude"),
        EVALS_FIXTURE_ROOT: fxRoot,
        EVALS_SANDBOX: "1",
        EVALS_SANDBOX_EXEC: wrapper,
        EVALS_ANTHROPIC_API_KEY: "sk-ant-test",
      },
    );
    const lines = readFileSafe(out)
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, string>);
    assert.equal(lines.length, 1, "the run wrote its one result line");
    assert.equal(lines[0].error, undefined, String(lines[0].error));
    assert.deepEqual(
      ttyRecords(ttyLog),
      [
        [false, false, false],
        [false, false, false],
      ],
      "the session spawn and the post-session spawn: no fd is the terminal",
    );
    assert.deepEqual(
      readCalls(lines[0].configDir).map((c) => c.tty),
      [[false, false, false]],
      "inside the jail, the session holds no terminal fd",
    );
    const gitSpawns = ttyRecords(gitLog);
    assert.ok(gitSpawns.length >= 5, `the runner's git spawns were logged (${gitSpawns.length})`);
    for (const fds of gitSpawns) assert.deepEqual(fds, [false, false, false], "a git spawn");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "runEvals --agentic under EVALS_SANDBOX=1: model-written tests cannot read the operator's $HOME",
  DARWIN_ONLY,
  () => {
    const binDir = tmpDir("harry-evals-bin-");
    const fxRoot = tmpDir("harry-evals-fxroot-");
    try {
      // The session writes a test that passes only if it can list the real home.
      const script = path.join(binDir, "probe-session.mjs");
      writeFileSync(
        script,
        [
          'import { writeFileSync } from "node:fs";',
          `writeFileSync("probe.test.mjs", ${JSON.stringify(
            `import { readdirSync } from "node:fs";\nimport test from "node:test";\ntest("home", () => { readdirSync(${JSON.stringify(os.homedir())}); });\n`,
          )});`,
        ].join("\n"),
      );
      installFakeClaude(binDir, undefined, { script, callsInConfigDir: true });
      const outcome = (lines: Record<string, unknown>[]) =>
        (lines[0].checkOutcomes as { check: { type: string }; ok: boolean }[]).find(
          (o) => o.check.type === "test_command_passes",
        )?.ok;
      assert.equal(outcome(runJailedTrial(binDir, fxRoot)), false, "jailed: the read is denied");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(fxRoot, { recursive: true, force: true });
    }
  },
);

test(
  "runEvals --agentic under EVALS_SANDBOX=1: a jailed fixture swap leaves the target repo untouched",
  DARWIN_ONLY,
  () => {
    const binDir = tmpDir("harry-evals-bin-");
    const fxRoot = tmpDir("harry-evals-fxroot-");
    const victim = makeVictimRepo();
    try {
      installFakeClaude(binDir, undefined, {
        script: swapFixtureScript(binDir, victim.dir),
        callsInConfigDir: true,
      });
      const lines = runJailedTrial(binDir, fxRoot);
      assert.equal(readFileSync(path.join(victim.dir, ".git", "config"), "utf8"), victim.config);
      // The jail no longer lets the session write its fixture's parent, so the rename
      // itself is denied; either way the trial errors and nothing is judged.
      assert.ok(lines[0].error, "the trial errored");
      assert.equal(lines[0].checkOutcomes, undefined, "nothing was judged");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(fxRoot, { recursive: true, force: true });
      rmSync(victim.dir, { recursive: true, force: true });
    }
  },
);

test(
  "runEvals --agentic under EVALS_SANDBOX=1: a setsid'd writer stays jailed, and so does the gpg.program it plants",
  DARWIN_ONLY,
  () => {
    const binDir = tmpDir("harry-evals-bin-");
    const fxRoot = tmpDir("harry-evals-fxroot-");
    try {
      const home = JSON.stringify(os.homedir());
      // Jailed code may write only its trial's dirs, so every marker goes to the
      // trial's own TMPDIR (inherited by the session, its writer, and git's gpg).
      const logName = "jail-status.log";
      // gpg.program: records whether it could list the real home when git ran it.
      const gpg = path.join(binDir, "gpg.sh");
      writeFileSync(
        gpg,
        `#!/bin/sh\nLOG="$TMPDIR/${logName}"\nif ls ${home} >/dev/null 2>&1; then echo gpg-free >> "$LOG"; ` +
          'else echo gpg-jailed >> "$LOG"; fi\ncat >/dev/null\nexit 1\n',
        { mode: 0o755 },
      );
      // The background writer: detached (setsid) so a process-group kill would miss it.
      // It records its own jail status, then keeps re-planting log.showSignature +
      // gpg.program into .git/config for 5s, racing the runner's restore.
      const writer = path.join(binDir, "writer.cjs");
      writeFileSync(
        writer,
        [
          'const fs = require("node:fs");',
          `const log = require("node:path").join(process.env.TMPDIR, ${JSON.stringify(logName)});`,
          `try { fs.readdirSync(${home}); fs.appendFileSync(log, "bg-free\\n"); }`,
          '  catch { fs.appendFileSync(log, "bg-jailed\\n"); }',
          'fs.appendFileSync(log, "bg-started\\n");',
          'const cfg = ".git/config";',
          `const plant = ${JSON.stringify(`[log]\n\tshowSignature = true\n[gpg]\n\tprogram = ${gpg}\n`)};`,
          "const until = Date.now() + 5000;",
          "while (Date.now() < until) {",
          "  try {",
          '    if (fs.existsSync(cfg) && !fs.readFileSync(cfg, "utf8").includes("showSignature"))',
          "      fs.appendFileSync(cfg, plant);",
          "  } catch {}",
          "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);",
          "}",
          'fs.appendFileSync(log, "bg-done\\n");',
        ].join("\n"),
      );
      // The session: a commit carrying a gpgsig header (so `git log` with
      // log.showSignature calls gpg.program), then the detached writer.
      const session = path.join(binDir, "session.mjs");
      writeFileSync(
        session,
        [
          'import { execFileSync, spawn } from "node:child_process";',
          "const g = (args, input) => execFileSync('git', args, { encoding: 'utf8', input }).trim();",
          "const tree = g(['rev-parse', 'HEAD^{tree}']);",
          "const plain = g(['cat-file', 'commit', g(['commit-tree', tree, '-p', 'HEAD', '-m', 'signed'])]);",
          "const sig = 'gpgsig -----BEGIN PGP SIGNATURE-----\\n \\n iQ==\\n -----END PGP SIGNATURE-----\\n';",
          "const signed = plain.replace(/\\n\\n/, '\\n' + sig + '\\n') + '\\n';",
          "g(['update-ref', 'refs/heads/signed', g(['hash-object', '-t', 'commit', '-w', '--stdin'], signed)]);",
          `spawn(process.execPath, [${JSON.stringify(writer)}], { detached: true, stdio: "ignore" }).unref();`,
          // End the session only once the writer is running, so it is already
          // re-planting when the runner's post-session git calls start.
          'import { existsSync, readFileSync } from "node:fs";',
          `const log = process.env.TMPDIR + "/" + ${JSON.stringify(logName)};`,
          "const until = Date.now() + 5000;",
          'while (Date.now() < until && !(existsSync(log) && readFileSync(log, "utf8").includes("bg-started")))',
          "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);",
        ].join("\n"),
      );
      installFakeClaude(binDir, undefined, { script: session, callsInConfigDir: true });
      const [line] = runJailedTrial(binDir, fxRoot);
      const log = path.join(String(line.trialDir), "tmp", logName);
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !readFileSafe(log).includes("bg-done")) sleepMs(50);
      const status = readFileSafe(log).trim().split("\n");
      assert.ok(status.includes("bg-done"), "the writer ran to completion");
      assert.ok(status.includes("bg-jailed"), "the setsid'd writer is still inside the jail");
      assert.ok(!status.includes("bg-free"), "the setsid'd writer never escaped");
      // Not vacuous: the re-planted gpg.program did run, just inside the jail. The
      // session only ends once the writer is running, so the writer wins the race.
      assert.ok(status.includes("gpg-jailed"), "the planted gpg.program ran, jailed");
      assert.ok(!status.includes("gpg-free"), "gpg.program never ran outside the jail");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(fxRoot, { recursive: true, force: true });
    }
  },
);

test(
  "runEvals --agentic under EVALS_SANDBOX=1: a session cannot launch a program outside the jail through a system service",
  DARWIN_ONLY,
  () => {
    const binDir = tmpDir("harry-evals-bin-");
    const fxRoot = tmpDir("harry-evals-fxroot-");
    // The markers land here: outside every trial dir, so the jail cannot write it.
    // Only a program started OUTSIDE the jail, as the operator, can.
    const outside = realpathSync(tmpDir("harry-evals-outside-"));
    const tag = `${process.pid}-${Date.now()}`;
    const label = `dev.harry.evals.escape-probe.${tag}`;
    const logName = "escape-attempts.log";
    const appName = `HarryEscapeProbe-${tag}.app`;
    let trialDir = "";
    try {
      // The session builds an app bundle in its own trial TMPDIR (writable), then
      // asks LaunchServices (`open`) and launchd (`launchctl submit`) to run it.
      // Either service would start the program itself, unjailed, if the profile
      // let the session reach it. Every attempt is bounded, so a hang fails the
      // assertion rather than the suite.
      const session = path.join(binDir, "escape-session.mjs");
      writeFileSync(
        session,
        [
          'import { spawnSync } from "node:child_process";',
          'import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";',
          'import { join } from "node:path";',
          "const tmp = process.env.TMPDIR;",
          `const log = join(tmp, ${JSON.stringify(logName)});`,
          `const app = join(tmp, ${JSON.stringify(appName)});`,
          'mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });',
          `writeFileSync(join(app, "Contents", "Info.plist"), ${JSON.stringify(
            '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>' +
              "<key>CFBundleExecutable</key><string>probe</string>" +
              `<key>CFBundleIdentifier</key><string>${label}</string>` +
              "<key>CFBundlePackageType</key><string>APPL</string>" +
              "<key>LSUIElement</key><true/></dict></plist>\n",
          )});`,
          `const probe = join(app, "Contents", "MacOS", "probe");`,
          `writeFileSync(probe, ${JSON.stringify(`#!/bin/sh\necho escaped > "${outside}/open-marker"\n`)});`,
          "chmodSync(probe, 0o755);",
          "const run = (name, bin, args) => {",
          '  const r = spawnSync(bin, args, { timeout: 10000, killSignal: "SIGKILL", stdio: "ignore" });',
          '  appendFileSync(log, name + "-tried " + r.status + " " + (r.signal ?? "") + "\\n");',
          "};",
          'run("open", "/usr/bin/open", [app]);',
          `run("launchctl", "/bin/launchctl", ["submit", "-l", ${JSON.stringify(label)}, "--", "/bin/sh", "-c", ${JSON.stringify(`echo escaped > "${outside}/launchctl-marker"`)}]);`,
        ].join("\n"),
      );
      installFakeClaude(binDir, undefined, { script: session, callsInConfigDir: true });
      const [line] = runJailedTrial(binDir, fxRoot);
      trialDir = String(line.trialDir);
      // Not vacuous: the session did make both attempts.
      const attempts = readFileSafe(path.join(trialDir, "tmp", logName));
      assert.match(attempts, /^open-tried /m, "the session tried `open`");
      assert.match(attempts, /^launchctl-tried /m, "the session tried `launchctl submit`");
      // And each attempt was refused: a launch tool that exits 0 was let through, and
      // one killed by the timeout (status null) hung rather than being denied. Either
      // would leave the marker check below passing on a slow or broken probe alone.
      for (const name of ["open", "launchctl"]) {
        const status = attempts.match(new RegExp(`^${name}-tried (\\S+)`, "m"))?.[1];
        assert.ok(Number(status) > 0, `jailed \`${name}\` exits nonzero (got ${status})`);
      }
      // Both services answer asynchronously; the unjailed positive landed in under
      // 0.5s, so a 3s window with no marker is a clean negative.
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && readdirSync(outside).length === 0) sleepMs(100);
      assert.deepEqual(
        readdirSync(outside),
        [],
        "no program the session asked a system service to launch ran outside the jail",
      );
      // The jail still judges the trial normally.
      assert.equal(line.error, undefined, String(line.error));
      const outcomes = line.checkOutcomes as { check: { type: string }; ok: boolean }[];
      assert.deepEqual(
        outcomes.map((o) => [o.check.type, o.ok]),
        [
          ["git_created_branch", false],
          ["git_no_new_commits_on_initial", true],
          ["test_command_passes", true],
        ],
        "the jailed post-session step still passes",
      );
    } finally {
      // A probe that did escape must not linger: drop the launchd job, kill the app
      // and forget its LaunchServices registration.
      spawnSync("/bin/launchctl", ["remove", label], { stdio: "ignore" });
      spawnSync("/usr/bin/pkill", ["-f", appName], { stdio: "ignore" });
      if (trialDir) {
        spawnSync(
          "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
          ["-u", path.join(trialDir, "tmp", appName)],
          { stdio: "ignore" },
        );
      }
      rmSync(binDir, { recursive: true, force: true });
      rmSync(fxRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  },
);

function readFileSafe(p: string): string {
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

// A check set that judges only by ABSENCE certifies nothing: an empty, truncated,
// or refusing reply satisfies every `regex_must_not` there is. Five cases shipped
// that way until 2026-07-30, and their "3/3 baseline" was read as evidence the model
// complied when it was evidence a forbidden token had not appeared. This pins the
// property so a future check edit cannot quietly reintroduce it — the one-time
// manual sweep that found it lived only in a commit message.
const POSITIVE_CHECK_TYPES = new Set([
  "regex_must",
  "file_contains",
  "repo_grep",
  "test_command_passes",
  "commit_message_matches",
  "git_created_branch",
]);

test("every case carries at least one POSITIVE check (absence alone certifies nothing)", () => {
  const { cases } = parseCasesJsonl(
    readFileSync(path.join(pluginRoot, "evals", "cases.jsonl"), "utf-8"),
  );
  assert.ok(cases.length > 0, "no cases parsed — the guard would be vacuous");
  const absenceOnly = cases
    .filter((c) => !c.checks.some((k: { type: string }) => POSITIVE_CHECK_TYPES.has(k.type)))
    .map((c) => c.id);
  assert.deepEqual(absenceOnly, [], "cases judged only by absence");
});

test("every text case REJECTS a degenerate reply corpus", () => {
  // Includes the long forms deliberately: a 60-char length floor stops "" and "ok"
  // but not a verbose refusal or a rate-limit message, and those are exactly what a
  // blocked session actually returns. A corpus of only short strings would pass a
  // floor that admits every real non-answer.
  const CORPUS = [
    "",
    "ok",
    "Done.",
    "Error: request timed out",
    "Error: 429 rate_limit_error: number of request tokens has exceeded your per-minute rate limit",
    "I cannot write files in this environment. Nothing has been created yet.",
  ];
  const { cases } = parseCasesJsonl(
    readFileSync(path.join(pluginRoot, "evals", "cases.jsonl"), "utf-8"),
  );
  const textCases = cases.filter((c) => c.mode === "text");
  assert.ok(textCases.length > 0, "no text cases — the guard would be vacuous");
  const leaks: string[] = [];
  for (const c of textCases) {
    for (const reply of CORPUS) {
      const passes = c.checks.every((k: { type: string; pattern: string; flags?: string }) => {
        const re = new RegExp(k.pattern, k.flags ?? "");
        return k.type === "regex_must" ? re.test(reply) : !re.test(reply);
      });
      if (passes) leaks.push(`${c.id} <= ${JSON.stringify(reply.slice(0, 40))}`);
    }
  }
  assert.deepEqual(leaks, [], "degenerate replies that score as compliant");
});
