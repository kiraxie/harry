import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  argAfter,
  BAD_ANSWERS,
  calls,
  collisionRepo,
  fakeBin,
  makeRepo,
  mutatedFiles,
  mutatorHome,
  mutatorRuns,
  overlayChecks,
  PKG,
  runMetrics,
  status,
  toolSection,
} from "./metrics-harness.ts";
import { headingSection } from "./section.ts";

test("mutator runs once per group on the changed lines and lists no survivor from an unchanged line", () => {
  const repo = collisionRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const runs = mutatorRuns(home);
  assert.equal(runs.length, 1);
  assert.equal(argAfter(runs[0].args, "--lines"), "2,5");
  const mutator = toolSection(run.facts, "mutator");
  assert.doesNotMatch(mutator, /src\/b\.ts:5/, mutator);
  assert.match(mutator, /No mutant survived\./, mutator);
  assert.match(mutator, /Sites on changed lines: 2 · run: 2 · /, mutator);
  assert.match(
    mutator,
    /^Executed by mutator, off-line sites included: 3 \(src\/a\.ts 1, src\/b\.ts 2\)$/m,
  );
});

/** `src/a.ts` passes the overlay check; `src/b.ts` carries `mark`. Both change line 1. */
function overlayRepo(mark: string): string {
  return makeRepo(
    { "package.json": PKG },
    {
      "src/a.ts": "export const a = 1 > 0; // mut > >= survived\n",
      "src/b.ts": `export const b = 2 > 0; // mut > >= survived ${mark}\n`,
    },
  );
}

test("every handed file is checked in mutator's worker with the command mutator gets, before mutator runs", () => {
  const repo = collisionRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  // By real path: in mutator's worker overlay this test and the CLI it spawns can reach
  // the script by different paths, one through a symlinked dir.
  const script = realpathSync(
    path.resolve(import.meta.dirname, "../src/lib/metrics/overlay-check.py"),
  );
  const checks = overlayChecks(home).map(([s, ...rest]) => [realpathSync(s), ...rest]);
  assert.deepEqual(checks, [
    [script, repo, "src/a.ts", "npm test"],
    [script, repo, "src/b.ts", "npm test"],
  ]);
  assert.deepEqual(mutatedFiles(home), [["src/a.ts", "src/b.ts"]]);
  assert.doesNotMatch(toolSection(run.facts, "mutator"), /Not measured/);
});

test("a file no test sees in mutator's worker is listed not measured, never as survivors", () => {
  const repo = overlayRepo("// overlay unseen");
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /^Not measured:\n- src\/b\.ts: not measured: no test sees this file in mutator's worker$/m,
    mutator,
  );
  assert.doesNotMatch(mutator, /src\/b\.ts:1 `>`/, mutator);
  assert.match(mutator, /src\/a\.ts:1 `>` → `>=`/, mutator);
  assert.match(
    mutator,
    /Sites on changed lines: 2 · run: 1 · not run \(uncovered\): 0 · not measured: 1 · /,
    mutator,
  );
  assert.deepEqual(mutatedFiles(home), [["src/a.ts"]]);
});

test("a file whose tests fail in mutator's worker without a mutant is listed not measured with the tail, and mutator never runs it", () => {
  const repo = overlayRepo("// overlay baseline-fail");
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /^- src\/b\.ts: not measured: tests fail in mutator's worker without a mutant\n {4}not ok 1 - reads dist\/x\.txt\n {4}ENOENT: dist\/x\.txt$/m,
    mutator,
  );
  assert.doesNotMatch(mutator, /src\/b\.ts:1 `>`/, mutator);
  assert.deepEqual(mutatedFiles(home), [["src/a.ts"]]);
});

test("with every handed file not measured, mutator does not run and the section says so", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    { "src/b.ts": "export const b = 2 > 0; // mut > >= survived // overlay unseen\n" },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(mutatorRuns(home), []);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(mutator, /run: 0 · not run \(uncovered\): 0 · not measured: 1 · /, mutator);
  assert.match(mutator, /- src\/b\.ts: not measured: no test sees/, mutator);
  assert.match(mutator, /^No mutant ran\.$/m, mutator);
  assert.doesNotMatch(mutator, /No mutant survived/, mutator);
});

test("an overlay check that crashes or prints no JSON fails the mutator section with its tail", () => {
  const repo = overlayRepo("// overlay crash");
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /failed: overlay check of src\/b\.ts exited 1 with no verdict\nTraceback: overlay boom/,
    mutator,
  );
  assert.doesNotMatch(mutator, /No mutant survived|Not measured/, mutator);
  assert.deepEqual(mutatorRuns(home), []);
});

test("an overlay check that errors in one group fails the whole mutator section, the other group's files included", () => {
  const repo = makeRepo(
    {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/x/package.json": PKG,
      "packages/y/package.json": PKG,
    },
    {
      "packages/x/src/x.ts": "export const x = 1; // mut 1 0 killed\n",
      "packages/y/src/y.ts": "export const y = 1; // mut 1 0 killed // overlay crash\n",
    },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /failed: packages\/y: overlay check of src\/y\.ts exited 1 with no verdict\nTraceback: overlay boom/,
    mutator,
  );
  assert.doesNotMatch(mutator, /### packages\/x/, mutator);
  assert.deepEqual(mutatorRuns(home), []);
});

test("two groups' files at the same group-relative path are each checked and reported in their own section", () => {
  const repo = makeRepo(
    {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/x/package.json": PKG,
      "packages/y/package.json": PKG,
    },
    {
      "packages/x/src/index.ts": "export const x = 1; // mut 1 0 killed // overlay unseen\n",
      "packages/y/src/index.ts": "export const y = 1; // mut 1 0 killed\n",
    },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    overlayChecks(home).map((args) => [path.relative(repo, args[1]), args[2]]),
    [
      ["packages/x", "src/index.ts"],
      ["packages/y", "src/index.ts"],
    ],
  );
  const mutator = toolSection(run.facts, "mutator");
  const x = headingSection(mutator, "mutator section", /### packages\/x\b/);
  const y = headingSection(mutator, "mutator section", /### packages\/y\b/);
  assert.match(x, /^- packages\/x\/src\/index\.ts: not measured: no test sees/m, mutator);
  assert.match(y, /Sites on changed lines: 1 · run: 1 · /, mutator);
  assert.doesNotMatch(y, /Not measured/, mutator);
});

test("an interrupt during a non-root group's overlay check exits 128+signal, not a failed section", () => {
  const repo = makeRepo(
    {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/x/package.json": PKG,
      "packages/y/package.json": PKG,
    },
    {
      "packages/x/src/x.ts": "export const x = 1; // mut 1 0 killed\n",
      "packages/y/src/y.ts": "export const y = 1; // mut 1 0 killed // overlay interrupt\n",
    },
  );
  const home = mutatorHome();
  const before = status(repo);

  const run = runMetrics(repo, home, { binDir: fakeBin(), detached: true });

  assert.equal(run.status, 130, `signal ${run.signal}\n${run.stderr}`);
  assert.match(run.stderr, /interrupted/i);
  assert.equal(status(repo), before);
  const interrupted = calls(home, "mutator", ".venv/bin").at(-1);
  assert.ok(interrupted, "no overlay check ran");
  assert.equal(existsSync(interrupted.cwd), false, `${interrupted.cwd} was left behind`);
});

for (const name of Object.keys(BAD_ANSWERS)) {
  test(`an overlay check that exits 0 with no verdict (${name}) fails the mutator section, never reads as a pass`, () => {
    const repo = overlayRepo(`// overlay prints ${name}`);
    const home = mutatorHome();

    const run = runMetrics(repo, home, { binDir: fakeBin() });

    assert.equal(run.status, 0, run.stderr);
    const mutator = toolSection(run.facts, "mutator");
    assert.match(mutator, /failed: overlay check of src\/b\.ts exited 0 with no verdict/, mutator);
    assert.deepEqual(mutatorRuns(home), []);
  });
}
