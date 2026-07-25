// The eval runner backs a regression harness that measures whether HARRY.md
// changes model behavior. These tests never call the real `claude` binary — a
// fake shim (tests/fake-claude.mjs) is wired via EVALS_CLAUDE_BIN — and never
// run a real eval. They cover: schema validation, run-time env isolation
// (baseline dir has no laws, candidate dir does), scoring pass/fail + exit code,
// and the model-pinning refusal.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { CheckInput } from "../scripts/run-evals.mjs";
import {
  collectRepoState,
  evaluateArtifactChecks,
  evaluateChecks,
  main,
  materializeFixture,
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

    // The shim was invoked in agentic form: tools NOT disabled, permission mode set.
    const calls = readCalls(binDir);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].allowedTools, undefined, "agentic run does NOT pass --allowedTools ''");
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

test("prepareConditionDir: seeds ONLY .credentials.json; baseline still has no CLAUDE.md", () => {
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

    // Both fresh config dirs are authenticated via the seeded credentials...
    assert.ok(
      existsSync(path.join(baseline.configDir, ".credentials.json")),
      "baseline config dir gets the seeded credentials (else claude -p is 'Not logged in')",
    );
    assert.ok(
      existsSync(path.join(candidate.configDir, ".credentials.json")),
      "candidate config dir gets the seeded credentials too",
    );
    // ...but nothing else leaks: baseline still has no CLAUDE.md (memory isolation).
    assert.ok(
      !existsSync(path.join(baseline.configDir, "CLAUDE.md")),
      "baseline stays law-free — only credentials were copied, not memory",
    );
    assert.ok(
      existsSync(path.join(candidate.configDir, "CLAUDE.md")),
      "candidate still has its laws",
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
