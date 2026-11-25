import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runCost } from "../src/lib/metrics/mutator.ts";
import {
  calls,
  collisionRepo,
  fakeBin,
  fiveSiteRepo,
  installStub,
  lastLine,
  makeRepo,
  mutatorHome,
  mutatorRuns,
  overlayChecks,
  PKG,
  pmCalls,
  runPlan,
  status,
  tempDir,
  writeExecutable,
} from "./metrics-harness.ts";

test("a scan that prints a handed file's header twice fails --plan, naming it", () => {
  const repo = collisionRepo();
  const home = tempDir("harry-metrics-home-");
  installStub(
    home,
    "mutator",
    `const a = "Scan: 1 mutation sites in src/a.ts\\n  src/a.ts:5 1 -> 0  [defn/fn]\\n";
process.stdout.write(a + a + "Scan: 0 mutation sites in src/b.ts\\n");`,
  );

  const plan = runPlan(repo, home, fakeBin());

  assert.notEqual(plan.status, 0, plan.stdout);
  assert.match(
    plan.stderr,
    /mutator --scan printed more than one header for src\/a\.ts/,
    plan.stderr,
  );
});

test("--plan prints the changed-line sites per group, the cores and the load, running nothing and changing nothing", () => {
  const repo = collisionRepo();
  const home = mutatorHome();
  const bin = fakeBin();
  const before = status(repo);

  const res = runPlan(repo, home, bin);

  assert.equal(res.status, 0, res.stderr);
  assert.match(
    res.stdout,
    /^- \. \(node\): 2 on changed lines, 3 executed, 2 rounds, 4 check runs$/m,
    res.stdout,
  );
  assert.match(
    res.stdout,
    /^ {2}- src\/a\.ts: 1 on changed lines, 1 executed, 1 worker, 1 round, 2 check runs$/m,
    res.stdout,
  );
  assert.match(
    res.stdout,
    /^ {2}- src\/b\.ts: 1 on changed lines, 2 executed, 2 workers, 1 round, 2 check runs$/m,
    res.stdout,
  );
  assert.match(res.stdout, /^Cores: 3$/m);
  assert.match(res.stdout, /^Load average: 1 min \d+\.\d\d · 5 min \d+\.\d\d$/m);
  assert.deepEqual(pmCalls(bin), []);
  assert.deepEqual(mutatorRuns(home), []);
  assert.deepEqual(calls(home, "crapper"), []);
  assert.equal(status(repo), before);
});

test("runCost takes mutator's workers per file, the fewest of sites, cores and --max-workers, and rounds up", () => {
  const rows: [number, number | null, number, { workers: number; rounds: number }][] = [
    [0, null, 8, { workers: 0, rounds: 0 }],
    [0, 4, 8, { workers: 0, rounds: 0 }],
    [1, null, 8, { workers: 1, rounds: 1 }],
    [2, null, 8, { workers: 2, rounds: 1 }],
    [5, 1, 8, { workers: 1, rounds: 5 }],
    [5, 2, 8, { workers: 2, rounds: 3 }],
    [17, null, 8, { workers: 8, rounds: 3 }],
    [17, 13, 8, { workers: 8, rounds: 3 }],
    [5, null, 0, { workers: 1, rounds: 5 }],
  ];
  for (const [executed, maxWorkers, cores, want] of rows) {
    const sites = Array.from({ length: executed }, (_, i) => ({ file: "f.ts", line: i + 1 }));
    const cost = runCost(sites, sites, maxWorkers, cores);
    const got = cost.files.get("f.ts");
    const row = `${executed}, ${maxWorkers}, ${cores}`;
    assert.deepEqual(
      got === undefined ? { workers: 0, rounds: 0 } : { workers: got.workers, rounds: got.rounds },
      want,
      row,
    );
    assert.equal(cost.rounds, want.rounds, row);
    assert.equal(cost.baselines, executed > 0 ? 1 : 0, row);
  }
});

test("--plan --max-workers sets the workers and rounds it prints", () => {
  const repo = fiveSiteRepo();
  const home = mutatorHome();

  const one = runPlan(repo, home, fakeBin(), ["--max-workers", "1"]);
  const four = runPlan(repo, home, fakeBin(), ["--max-workers", "4"]);

  assert.equal(one.status, 0, one.stderr);
  assert.equal(four.status, 0, four.stderr);
  assert.match(
    one.stdout,
    /^- \. \(node\): 5 on changed lines, 5 executed, 5 rounds, 2 check runs$/m,
    one.stdout,
  );
  assert.match(
    one.stdout,
    /^ {2}- src\/a\.ts: 5 on changed lines, 5 executed, 1 worker, 5 rounds, 2 check runs$/m,
    one.stdout,
  );
  assert.match(
    four.stdout,
    /^- \. \(node\): 5 on changed lines, 5 executed, 2 rounds, 2 check runs$/m,
    four.stdout,
  );
  assert.match(
    four.stdout,
    /^ {2}- src\/a\.ts: 5 on changed lines, 5 executed, 3 workers, 2 rounds, 2 check runs$/m,
    four.stdout,
  );
});

/** A repo with `files` changed on `feat` and a `.venv` python whose every import succeeds. */
function repoWithPython(base: Record<string, string>, change: Record<string, string>): string {
  const repo = makeRepo(base, change);
  writeFileSync(path.join(repo, ".git/info/exclude"), ".venv/\n");
  writeExecutable(path.join(repo, ".venv/bin/python"), "#!/bin/sh\nexit 0\n");
  return repo;
}

test("--plan ends with one coverage run and one baseline per group, two groups at one dir included", () => {
  const repo = repoWithPython(
    { "package.json": PKG, "pyproject.toml": "[project]\nname = 'p'\n" },
    {
      "src/a.ts": "export const a = 1; // mut 1 0 killed\nexport const b = 2; // mut 2 0 killed\n",
      "src/p.py": "A = 1  # // mut 1 0 killed\n",
    },
  );
  const home = mutatorHome();
  const before = status(repo);

  const res = runPlan(repo, home, fakeBin(), ["--max-workers", "1"]);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(
    lastLine(res.stdout),
    "Estimate: 2 coverage runs + 2 baselines + 7 test-command rounds (3 for mutants, 4 for overlay checks)",
    res.stdout,
  );
  assert.equal(status(repo), before);
});

test("--plan counts no baseline for a group the cap leaves empty", () => {
  const repo = repoWithPython(
    { "package.json": PKG, "pyproject.toml": "[project]\nname = 'p'\n" },
    {
      "src/b.py": "B = 1  # // mut 1 0 killed\n",
      "src/c.ts": "export const c = 1; // mut 1 0 killed\n",
    },
  );
  const home = mutatorHome();

  const res = runPlan(repo, home, fakeBin(), ["--max-mutants", "1"]);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(
    lastLine(res.stdout),
    "Estimate: 2 coverage runs + 1 baseline + 3 test-command rounds (1 for mutants, 2 for overlay checks)",
    res.stdout,
  );
});

/** Three files, one changed-line site each. */
function threeFileRepo(): string {
  return makeRepo(
    { "package.json": PKG },
    {
      "src/a.ts": "export const a = 1; // mut 1 0 killed\n",
      "src/b.ts": "export const b = 1; // mut 1 0 killed\n",
      "src/c.ts": "export const c = 1; // mut 1 0 killed\n",
    },
  );
}

test("--plan under a cap counts check runs for the handed files only, assuming every checked file passes", () => {
  const repo = threeFileRepo();
  const home = mutatorHome();

  const res = runPlan(repo, home, fakeBin(), ["--max-mutants", "1"]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(overlayChecks(home), []);
  const lines = res.stdout.trimEnd().split("\n");
  assert.ok(
    lines.includes(
      "The estimate assumes every checked file passes the overlay check; each file it rejects adds 2 check runs and moves its share of the cap to later files.",
    ),
    res.stdout,
  );
  assert.equal(
    lastLine(res.stdout),
    "Estimate: 1 coverage run + 1 baseline + 3 test-command rounds (1 for mutants, 2 for overlay checks)",
    res.stdout,
  );
});

test("--plan without a cap counts check runs for every file, assuming every checked file passes", () => {
  const repo = threeFileRepo();
  const home = mutatorHome();

  const res = runPlan(repo, home, fakeBin());

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(overlayChecks(home), []);
  const lines = res.stdout.trimEnd().split("\n");
  assert.ok(
    lines.includes(
      "The estimate assumes every checked file passes the overlay check; a file it rejects runs none of its mutants.",
    ),
    res.stdout,
  );
  assert.equal(
    lastLine(res.stdout),
    "Estimate: 1 coverage run + 1 baseline + 9 test-command rounds (3 for mutants, 6 for overlay checks)",
    res.stdout,
  );
});

test("--plan counts no coverage run for a skipped coverage plan unless --coverage-command replaces it", () => {
  const repo = makeRepo(
    { "package.json": "{}\n" },
    { "src/a.ts": "export const a = 1; // mut 1 0 killed\n" },
  );
  const home = mutatorHome();

  const own = runPlan(repo, home, fakeBin());
  const replaced = runPlan(repo, home, fakeBin(), ["--coverage-command", "true"]);

  assert.equal(own.status, 0, own.stderr);
  assert.equal(
    lastLine(own.stdout),
    "Estimate: 0 coverage runs + 1 baseline + 3 test-command rounds (1 for mutants, 2 for overlay checks)",
    own.stdout,
  );
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(
    lastLine(replaced.stdout),
    "Estimate: 1 coverage run + 1 baseline + 3 test-command rounds (1 for mutants, 2 for overlay checks)",
    replaced.stdout,
  );
});

test("--plan with no changed source file estimates none, naming why", () => {
  const repo = makeRepo({}, { "README.md": "y\n" });
  const home = mutatorHome();

  const res = runPlan(repo, home, fakeBin());

  assert.equal(res.status, 0, res.stderr);
  assert.equal(lastLine(res.stdout), "Estimate: none (no changed source files)", res.stdout);
});

test("--plan exits non-zero when a scan's listed sites disagree with its own count", () => {
  const repo = collisionRepo();
  const home = tempDir("harry-metrics-home-");
  installStub(
    home,
    "mutator",
    'process.stdout.write("Scan: 3 mutation sites in src/a.ts\\n  src/a.ts:5 1 -> 0  [defn/fn]\\n");',
  );

  const res = runPlan(repo, home, fakeBin());

  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /lists 1 sites in src\/a\.ts but counts 3/, res.stderr);
});

/**
 * Only lines carrying a changed-line site are handed: `a.ts` and `c.ts` change a
 * line with no site, so `b.ts`'s unchanged site on line 3 and `c.ts`'s on line 5
 * are scanned but never executed, and `c.ts` is not handed at all.
 */
test("--plan counts the sites mutator executes on the handed lines, not every scanned site", () => {
  const lines = (marks: Record<number, string>) =>
    Array.from({ length: 6 }, (_, i) => `export const v${i + 1} = ${marks[i + 1] ?? "1;"}`).join(
      "\n",
    );
  const repo = makeRepo(
    {
      "package.json": PKG,
      "src/a.ts": lines({}),
      "src/b.ts": lines({ 3: "1; // mut 1 0 killed", 5: "1; // mut 1 0 killed" }),
      "src/c.ts": lines({ 5: "1; // mut 1 0 killed" }),
    },
    {
      "src/a.ts": lines({ 3: "2;", 5: "1; // mut 1 0 killed" }),
      "src/b.ts": lines({
        2: "1; // mut 1 0 killed",
        3: "1; // mut 1 0 killed",
        5: "1; // mut 1 0 killed",
      }),
      "src/c.ts": lines({ 1: "2;", 5: "1; // mut 1 0 killed" }),
    },
  );
  const home = mutatorHome();

  const res = runPlan(repo, home, fakeBin());

  assert.equal(res.status, 0, res.stderr);
  assert.match(
    res.stdout,
    /^- \. \(node\): 2 on changed lines, 3 executed, 2 rounds, 4 check runs$/m,
    res.stdout,
  );
  assert.match(
    res.stdout,
    /^ {2}- src\/a\.ts: 1 on changed lines, 1 executed, 1 worker, 1 round, 2 check runs$/m,
    res.stdout,
  );
  assert.match(
    res.stdout,
    /^ {2}- src\/b\.ts: 1 on changed lines, 2 executed, 2 workers, 1 round, 2 check runs$/m,
    res.stdout,
  );
  assert.doesNotMatch(res.stdout, /src\/c\.ts/, res.stdout);
});

test("--plan --max-mutants prints the cap's selection and what mutator executes for it", () => {
  const repo = collisionRepo();
  const home = mutatorHome();
  const bin = fakeBin();
  const before = status(repo);

  const res = runPlan(repo, home, bin, ["--max-mutants", "1"]);

  assert.equal(res.status, 0, res.stderr);
  assert.match(
    res.stdout,
    /^- \. \(node\): 2 on changed lines, 1 selected \(--max-mutants 1\), 1 executed, 1 round, 2 check runs$/m,
    res.stdout,
  );
  assert.match(
    res.stdout,
    /^ {2}- src\/a\.ts: 1 on changed lines, 1 selected, 1 executed, 1 worker, 1 round, 2 check runs$/m,
  );
  assert.match(
    res.stdout,
    /^ {2}- src\/b\.ts: 1 on changed lines, 0 selected, 0 executed, 0 workers, 0 rounds, 0 check runs$/m,
  );
  assert.deepEqual(mutatorRuns(home), []);
  assert.deepEqual(pmCalls(bin), []);
  assert.equal(status(repo), before);
});
