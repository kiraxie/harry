import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  argAfter,
  collisionRepo,
  fakeBin,
  fiveSiteRepo,
  installCrapper,
  installStub,
  MUTATOR_FROM_MARKERS,
  makeRepo,
  mutatedFiles,
  mutatorHome,
  mutatorRuns,
  overlayChecks,
  PKG,
  runMetrics,
  runPlan,
  tempDir,
  toolSection,
} from "./metrics-harness.ts";
import { outline } from "./section.ts";

test("under a cap, a rejected file takes none of it and the cap is filled from the next file that passes", () => {
  const rejected = [
    "export const a = 1 > 0; // mut > >= survived // overlay unseen",
    "export const c = 2 > 0; // mut > >= survived",
    "",
  ].join("\n");
  const repo = makeRepo(
    { "package.json": PKG },
    {
      "src/a.ts": rejected,
      "src/b.ts":
        "export const b = 1 > 0; // mut > >= killed\nexport const d = 1; // mut 1 0 killed\n",
    },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--max-mutants", "1"] });

  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /Sites on changed lines: 4 · run: 1 · not run \(uncovered\): 0 · not measured: 2 · not selected \(--max-mutants\): 1$/m,
    mutator,
  );
  assert.deepEqual(mutatedFiles(home), [["src/b.ts"]]);
  assert.deepEqual(
    overlayChecks(home).map((args) => args[2]),
    ["src/a.ts", "src/b.ts"],
  );
  assert.match(
    mutator,
    /^Not measured:\n- src\/a\.ts: not measured: no test sees this file in mutator's worker\n\n/m,
    mutator,
  );
  assert.match(mutator, /^Not selected \(--max-mutants\):\n- src\/b\.ts:2$/m, mutator);
  assert.doesNotMatch(mutator, /- src\/a\.ts:2/, mutator);
});

test("once the cap is filled, the files after it are never checked and their sites are not selected", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    {
      "src/a.ts": "export const a = 1 > 0; // mut > >= killed\n",
      "src/b.ts": "export const b = 1 > 0; // mut > >= killed\n",
      "src/c.ts": "export const c = 1 > 0; // mut > >= killed\n",
    },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--max-mutants", "1"] });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    overlayChecks(home).map((args) => args[2]),
    ["src/a.ts"],
  );
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /^Not selected \(--max-mutants\):\n- src\/b\.ts:1\n- src\/c\.ts:1$/m,
    mutator,
  );
});

test("a cap that crosses from a rejected file finishes the passing file's line whole", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    {
      "src/a.ts": "export const a = 1 > 0; // mut > >= survived // overlay unseen\n",
      "src/b.ts": [
        "export const b = 1 + 2; // mut 1 0 killed // mut + - survived",
        "export const d = 3; // mut 3 0 killed",
        "",
      ].join("\n"),
    },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--max-mutants", "1"] });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(mutatedFiles(home), [["src/b.ts"]]);
  assert.deepEqual(
    overlayChecks(home).map((args) => args[2]),
    ["src/a.ts", "src/b.ts"],
  );
  assert.equal(argAfter(mutatorRuns(home)[0].args, "--lines"), "1");
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /Sites on changed lines: 4 · run: 2 · not run \(uncovered\): 0 · not measured: 1 · not selected \(--max-mutants\): 1$/m,
    mutator,
  );
  assert.match(mutator, /^Not selected \(--max-mutants\):\n- src\/b\.ts:2$/m, mutator);
});

test("with every left-out site in a rejected file, no Not selected list is printed", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    {
      "src/a.ts":
        "export const a = 1 > 0; // mut > >= survived // overlay unseen\nexport const c = 2 > 0; // mut > >= survived\n",
    },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--max-mutants", "1"] });

  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(mutator, /not measured: 2 · not selected \(--max-mutants\): 0$/m, mutator);
  assert.doesNotMatch(mutator, /Not selected/, mutator);
});

test("a section where only an off-line site ran never says no mutant ran", () => {
  const repo = makeRepo(
    {
      "package.json": PKG,
      "src/b.ts": "export const b = 1; // mut 1 0 killed\nexport const c = 2;\n",
    },
    {
      "src/a.ts": "export const a = 1; // mut 1 0 uncovered\n",
      "src/b.ts":
        "export const b = 1; // mut 1 0 killed\nexport const c = 3; // mut 3 0 uncovered\n",
    },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /^Executed by mutator, off-line sites included: 1 \(src\/a\.ts 0, src\/b\.ts 1\)$/m,
    mutator,
  );
  assert.match(mutator, /run: 0 · not run \(uncovered\): 2 · /, mutator);
  assert.match(mutator, /^No mutant survived\.$/m, mutator);
  assert.doesNotMatch(mutator, /No mutant ran/, mutator);
});

/**
 * A scan that lists 14 sites for `src/a.ts`, more stdout than a 12-line tail
 * holds, and skips `src/b.ts` with a reason on stderr.
 */
const SCAN_SKIPS_B = `const site = "  src/a.ts:5 1 -> 0  [defn/fn]\\n";
process.stdout.write("Scan: 14 mutation sites in src/a.ts\\n" + site.repeat(14));
process.stderr.write("Skipping test file src/b.ts\\n");`;

test("a scan that prints no header for a handed file fails --plan and the mutator section, naming it", () => {
  const repo = collisionRepo();
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  installStub(home, "mutator", SCAN_SKIPS_B);

  const plan = runPlan(repo, home, fakeBin());
  assert.notEqual(plan.status, 0, plan.stdout);
  assert.match(plan.stderr, /mutator --scan printed no header for src\/b\.ts/, plan.stderr);
  assert.match(plan.stderr, /Skipping test file src\/b\.ts/, plan.stderr);

  const run = runMetrics(repo, home, { binDir: fakeBin() });
  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(mutator, /failed: .*mutator --scan printed no header for src\/b\.ts/s, mutator);
  assert.doesNotMatch(mutator, /No mutant survived/, mutator);
});

test("a scan error in one group fails the whole mutator section, naming the group", () => {
  const repo = makeRepo(
    {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/x/package.json": PKG,
      "packages/y/package.json": PKG,
    },
    {
      "packages/x/src/x.ts": "export const x = 1; // mut 1 0 killed\n",
      "packages/y/src/y.ts": "export const y = 1; // mut 1 0 killed\n",
    },
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  const skipsY = `if (args.includes("--scan") && root.endsWith("packages/y")) {
  process.stderr.write("Skipping test file src/y.ts\\n");
  process.exit(0);
}`;
  installStub(home, "mutator", `${skipsY}\n${MUTATOR_FROM_MARKERS}`);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /failed: packages\/y: mutator --scan printed no header for src\/y\.ts/,
    mutator,
  );
  assert.doesNotMatch(mutator, /### packages\/x/, mutator);
  assert.deepEqual(mutatorRuns(home), []);
});

test("--max-mutants runs the first n sites, finishing the line the cut falls in, and lists the rest", () => {
  const repo = fiveSiteRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--max-mutants", "3"] });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(argAfter(mutatorRuns(home)[0].args, "--lines"), "1,2");
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /Sites on changed lines: 5 · run: 4 · .* not selected \(--max-mutants\): 1/,
  );
  assert.match(mutator, /Not selected \(--max-mutants\):\n- src\/a\.ts:3$/m, mutator);
  assert.doesNotMatch(mutator, /src\/a\.ts:3 `5`/, mutator);
});

test("without --max-mutants every changed-line site runs and none is listed as not selected", () => {
  const repo = fiveSiteRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(argAfter(mutatorRuns(home)[0].args, "--lines"), "1,2,3");
  const mutator = toolSection(run.facts, "mutator");
  assert.match(
    mutator,
    /Sites on changed lines: 5 · run: 5 · .* not selected \(--max-mutants\): 0/,
  );
  assert.doesNotMatch(mutator, /Not selected/);
  assert.match(mutator, /src\/a\.ts:3 `5` → `0`/, mutator);
});

test("--max-mutants takes sites by file before line across files", () => {
  const repo = collisionRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--max-mutants", "1"] });

  assert.equal(run.status, 0, run.stderr);
  const [only] = mutatorRuns(home);
  assert.equal(argAfter(only.args, "--lines"), "5");
  assert.equal(only.args.at(-1), "src/a.ts");
  assert.ok(!only.args.includes("src/b.ts"), only.args.join(" "));
  const mutator = toolSection(run.facts, "mutator");
  assert.match(mutator, /Sites on changed lines: 2 · run: 1 · /, mutator);
  assert.match(mutator, /Not selected \(--max-mutants\):\n- src\/b\.ts:2$/m, mutator);
});

/**
 * Two groups at the root. `src/a.ts` changes a line with no site, so the node
 * group comes first and hands `src/c.ts`'s site ahead of the python group's
 * `src/b.py`: only the shared comparator puts `src/b.py` first.
 */
function crossGroupRepo(): string {
  return makeRepo(
    { "package.json": PKG, "pyproject.toml": "[project]\nname = 'p'\n" },
    {
      "src/a.ts": "export const a = 'x';\n",
      "src/b.py": "B = 1  # // mut 1 0 killed\n",
      "src/c.ts": "export const c = 1; // mut 1 0 killed\n",
    },
  );
}

test("within a group, the cap and --plan's listing take paths in code-unit order", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    {
      "src/api.ts": "export const a = 1; // mut 1 0 killed\n",
      "src/Button.ts": "export const b = 1; // mut 1 0 killed\n",
    },
  );
  const home = mutatorHome();

  const plan = runPlan(repo, home, fakeBin(), ["--max-mutants", "1"]);

  assert.equal(plan.status, 0, plan.stderr);
  assert.match(
    plan.stdout,
    /: on changed lines, selected by the cap, and executed .*\n.*\n {2}- src\/Button\.ts: 1 on changed lines, 1 selected, 1 executed, 1 worker, 1 round, 2 check runs\n {2}- src\/api\.ts: 1 on changed lines, 0 selected, 0 executed, 0 workers, 0 rounds, 0 check runs$/m,
    plan.stdout,
  );
});

test("the survivor list and the Not selected list take paths in code-unit order", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    {
      "src/A.ts": "export const z = 1; // mut 1 0 killed\n",
      "src/api.ts": "export const a = 1; // mut 1 0 survived\n",
      "src/Button.ts": "export const b = 1; // mut 1 0 survived\n",
    },
  );
  const home = mutatorHome();

  const all = runMetrics(repo, home, { binDir: fakeBin() });
  assert.equal(all.status, 0, all.stderr);
  assert.match(
    toolSection(all.facts, "mutator"),
    /^- src\/Button\.ts:1 .*\n- src\/api\.ts:1 /m,
    all.facts,
  );

  const capped = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--max-mutants", "1"] });
  assert.equal(capped.status, 0, capped.stderr);
  assert.match(
    toolSection(capped.facts, "mutator"),
    /Not selected \(--max-mutants\):\n- src\/Button\.ts:1\n- src\/api\.ts:1$/m,
    capped.facts,
  );
});

test("groups list in the order the cap reaches them, mixed-case and prefix-named dirs included", () => {
  const pkg = (name: string) => ({ [`${name}/package.json`]: PKG });
  const site = (name: string) => ({
    [`${name}/src/m.ts`]: "export const m = 1; // mut 1 0 killed\n",
  });
  const names = ["api", "app", "app-web", "Web"];
  const repo = makeRepo(
    Object.assign({}, ...names.map(pkg)),
    Object.assign({}, ...names.map(site)),
  );
  const home = mutatorHome();

  const plan = runPlan(repo, home, fakeBin(), ["--max-mutants", "1"]);
  assert.equal(plan.status, 0, plan.stderr);
  const listed = [...plan.stdout.matchAll(/^- (\S+) \(node\): .*$/gm)];
  assert.deepEqual(
    listed.map((m) => m[1]),
    ["Web", "api", "app-web", "app"],
    plan.stdout,
  );
  assert.match(listed[0][0], / 1 selected /, plan.stdout);

  const run = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--max-mutants", "1"] });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    outline(toolSection(run.facts, "mutator"))
      .filter((l) => l.level === 3 && !l.fenced)
      .map((l) => l.title.split(" ")[0]),
    ["Web", "api", "app-web", "app"],
    run.facts,
  );
});

test("no localeCompare and no comparator-less sort in the metrics modules", () => {
  const dir = path.resolve(import.meta.dirname, "../src/lib/metrics");
  const files = [
    ...readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(dir, f)),
    path.resolve(import.meta.dirname, "../src/commands/metrics.ts"),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /localeCompare\(/, file);
    assert.doesNotMatch(text, /\.sort\(\)/, file);
  }
});

test("the cap and --plan take files by repo path across groups, whatever order the groups come in", () => {
  const repo = crossGroupRepo();
  const home = mutatorHome();

  const plan = runPlan(repo, home, fakeBin(), ["--max-mutants", "1"]);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(
    plan.stdout,
    /^ {2}- src\/b\.py: 1 on changed lines, 1 selected, 1 executed, 1 worker, 1 round, 2 check runs$/m,
  );
  assert.match(
    plan.stdout,
    /^ {2}- src\/c\.ts: 1 on changed lines, 0 selected, 0 executed, 0 workers, 0 rounds, 0 check runs$/m,
  );

  const run = runMetrics(repo, home, {
    binDir: fakeBin(),
    extra: ["--max-mutants", "1", "--coverage-command", "true"],
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    mutatorRuns(home).map((c) => c.args.at(-1)),
    ["src/b.py"],
  );
});
