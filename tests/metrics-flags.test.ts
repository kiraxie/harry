import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  argAfter,
  calls,
  collisionRepo,
  DRYER_ALL_PAIRS,
  fakeBin,
  fiveSiteRepo,
  installCrapper,
  installStub,
  makeRepo,
  mutatorHome,
  mutatorRuns,
  PKG,
  pmCalls,
  runAudit,
  runMetrics,
  status,
  tempDir,
  toolSection,
  writeExecutable,
} from "./metrics-harness.ts";

test("--test-command and --max-workers reach mutator's run, and --max-workers never its scan", () => {
  const repo = fiveSiteRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, {
    binDir: fakeBin(),
    extra: ["--test-command", "make check", "--max-workers", "3"],
  });

  assert.equal(run.status, 0, run.stderr);
  const [only] = mutatorRuns(home);
  assert.equal(argAfter(only.args, "--test-command"), "make check");
  assert.equal(argAfter(only.args, "--max-workers"), "3");
  const scans = calls(home, "mutator").filter((c) => c.args.includes("--scan"));
  assert.ok(scans.length > 0);
  for (const scan of scans) assert.ok(!scan.args.includes("--max-workers"), scan.args.join(" "));
  assert.match(toolSection(run.facts, "mutator"), /Test command: `make check`/);
});

test("with no command flag the facts state the default test and coverage commands", () => {
  const repo = fiveSiteRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(argAfter(mutatorRuns(home)[0].args, "--test-command"), "npm test");
  assert.match(
    toolSection(run.facts, "mutator"),
    /Test command: `npm test` · Coverage command: `npm run coverage`/,
  );
});

test("--coverage-command replaces the coverage plan, run through the shell in the group dir", () => {
  const repo = fiveSiteRepo();
  const home = mutatorHome();
  const bin = fakeBin();
  const command = "mkdir -p coverage && echo TN: > coverage/lcov.info";

  const run = runMetrics(repo, home, { binDir: bin, extra: ["--coverage-command", command] });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(pmCalls(bin), []);
  assert.ok(mutatorRuns(home)[0].args.includes("--use-existing-coverage"));
  const mutator = toolSection(run.facts, "mutator");
  assert.match(mutator, /— uncovered lines skipped/);
  assert.ok(mutator.includes(`Coverage command: \`${command}\``), mutator);
  assert.equal(status(repo), "");
});

test("a --coverage-command that leaves no lcov.info is a coverage gap", () => {
  const repo = fiveSiteRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, {
    binDir: fakeBin(),
    extra: ["--coverage-command", "true"],
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(
    toolSection(run.facts, "crapper"),
    /complexity only: coverage command `true` produced no lcov\.info/,
  );
  assert.match(toolSection(run.facts, "mutator"), /— every site run \(no coverage\)/);
  assert.ok(mutatorRuns(home)[0].args.includes("--no-coverage"));
});

test("a --coverage-command scores a group whose own coverage plan would skip", () => {
  const repo = makeRepo(
    { "package.json": "{}\n" },
    { "src/r.ts": "// crap r 2 1\nfunction r() {}\n" },
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  const command = "mkdir -p coverage && echo TN: > coverage/lcov.info";

  const run = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--coverage-command", command] });

  assert.equal(run.status, 0, run.stderr);
  assert.ok(toolSection(run.facts, "crapper").includes(`— coverage: ${command}`), run.facts);
});

test("a --coverage-command that fails is named as typed", () => {
  const repo = fiveSiteRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, {
    binDir: fakeBin(),
    extra: ["--coverage-command", "exit 4"],
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(
    toolSection(run.facts, "crapper"),
    /complexity only: coverage command `exit 4` exited 4/,
  );
});

test("a default coverage plan whose first step fails names only that step", () => {
  const repo = makeRepo(
    { "pyproject.toml": "[project]\nname = 'p'\n" },
    { "src/p.py": "# // crap p 2 1\n" },
  );
  writeFileSync(path.join(repo, ".git/info/exclude"), ".venv/\n");
  writeExecutable(
    path.join(repo, ".venv/bin/python"),
    `#!/bin/sh\ncase "$*" in *"coverage run"*) exit 2 ;; esac\nexit 0\n`,
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const crapper = toolSection(run.facts, "crapper");
  assert.match(
    crapper,
    /complexity only: coverage command `python -m coverage run --data-file=target\/coverage\/python\/\.coverage -m pytest` exited 2/,
  );
  assert.doesNotMatch(crapper, /coverage lcov/, crapper);
});

test("a default coverage plan whose second step fails names only that step", () => {
  const repo = makeRepo(
    { "pyproject.toml": "[project]\nname = 'p'\n" },
    { "src/p.py": "# // crap p 2 1\n" },
  );
  writeFileSync(path.join(repo, ".git/info/exclude"), ".venv/\n");
  writeExecutable(
    path.join(repo, ".venv/bin/python"),
    `#!/bin/sh\ncase "$*" in *"coverage lcov"*) exit 3 ;; esac\nexit 0\n`,
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const crapper = toolSection(run.facts, "crapper");
  assert.match(
    crapper,
    /complexity only: coverage command `python -m coverage lcov --data-file=target\/coverage\/python\/\.coverage -o target\/coverage\/python\/lcov\.info` exited 3/,
  );
  assert.doesNotMatch(crapper, /coverage run/, crapper);
});

test("a Python group with no venv names the PATH interpreter in its coverage command", () => {
  const repo = makeRepo(
    { "pyproject.toml": "[project]\nname = 'p'\n" },
    { "src/p.py": "# // crap p 2 1\n" },
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  const bin = fakeBin();
  writeExecutable(
    path.join(bin, "python3"),
    `#!/bin/sh\ncase "$1" in -m) shift ;; -c) shift 2 ;; esac\ncase "$*" in "coverage lcov "*) mkdir -p target/coverage/python && echo TN: > target/coverage/python/lcov.info ;; esac\nexit 0\n`,
  );

  const run = runMetrics(repo, home, { binDir: bin });

  assert.equal(run.status, 0, run.stderr);
  assert.ok(
    run.facts.includes(
      "— coverage: python3 -m coverage run --data-file=target/coverage/python/.coverage -m pytest && python3 -m coverage lcov --data-file=target/coverage/python/.coverage -o target/coverage/python/lcov.info\n",
    ),
    run.facts,
  );
});

test("a site the coverage report leaves uncovered is counted as not run", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    {
      "src/a.ts":
        "export const a = 1; // mut 1 0 killed\nexport const b = 2; // mut 2 0 uncovered\n",
    },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  assert.match(
    toolSection(run.facts, "mutator"),
    /Sites on changed lines: 2 · run: 1 · not run \(uncovered\): 1 · not measured: 0 · not selected \(--max-mutants\): 0/,
  );
});

function twoPackageRepo(): string {
  return makeRepo(
    {
      "packages/x/package.json": PKG,
      "packages/y/package.json": PKG,
    },
    {
      "packages/x/src/x.ts": "export const x = 1; // mut 1 0 killed\n",
      "packages/y/src/y.ts": "export const y = 1; // mut 1 0 killed\n",
    },
  );
}

for (const flag of ["--test-command", "--coverage-command"]) {
  test(`${flag} with two group dirs in scope and no --only exits naming them and runs nothing`, () => {
    const repo = twoPackageRepo();
    const home = mutatorHome();
    installStub(home, "dryer", DRYER_ALL_PAIRS);
    const bin = fakeBin();

    const run = runMetrics(repo, home, { binDir: bin, extra: [flag, "make check"] });

    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /2 are in scope: packages\/x, packages\/y\. Pick one with --only/);
    assert.deepEqual(calls(home, "mutator"), []);
    assert.deepEqual(calls(home, "crapper"), []);
    assert.deepEqual(calls(home, "dryer"), []);
    assert.deepEqual(pmCalls(bin), []);
    assert.equal(run.facts, "");
  });
}

test("--max-workers needs no --only with two group dirs in scope", () => {
  const repo = twoPackageRepo();
  const home = mutatorHome();

  const run = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--max-workers", "2"] });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    mutatorRuns(home).map((c) => argAfter(c.args, "--max-workers")),
    ["2", "2"],
  );
});

test("--only <dir> limits the run to the groups at that dir", () => {
  const repo = twoPackageRepo();
  const home = mutatorHome();
  const bin = fakeBin();

  const run = runMetrics(repo, home, {
    binDir: bin,
    extra: ["--only", "packages/x", "--test-command", "make check"],
  });

  assert.equal(run.status, 0, run.stderr);
  const px = path.join(repo, "packages/x");
  assert.deepEqual(
    mutatorRuns(home).map((c) => [argAfter(c.args, "--root"), argAfter(c.args, "--test-command")]),
    [[px, "make check"]],
  );
  assert.deepEqual(
    pmCalls(bin).map((c) => c.cwd),
    [px],
  );
  assert.doesNotMatch(run.facts, /packages\/y/);
});

test("--only . with a command flag covers every group at the root, one per language", () => {
  const repo = makeRepo(
    { "package.json": PKG, "pyproject.toml": "[project]\nname = 'p'\n" },
    {
      "src/a.ts": "export const a = 1; // mut 1 0 killed\n",
      "src/p.py": "A = 1  # // mut 1 0 killed\n",
    },
  );
  const home = mutatorHome();

  const run = runMetrics(repo, home, {
    binDir: fakeBin(),
    extra: ["--only", ".", "--test-command", "make check", "--coverage-command", "true"],
  });

  assert.equal(run.status, 0, run.stderr);
  const runs = mutatorRuns(home).map((c) => [c.args.at(-1), argAfter(c.args, "--test-command")]);
  assert.deepEqual(runs.sort(), [
    ["src/a.ts", "make check"],
    ["src/p.py", "make check"],
  ]);
});

test("unit-only flags are refused with --audit, and --plan with --out", () => {
  const repo = collisionRepo();
  const home = mutatorHome();
  const audit = runAudit(repo, home, fakeBin(), ["--max-mutants", "2"]);
  assert.notEqual(audit.status, 0);
  assert.match(audit.stderr, /--max-mutants applies only to metrics --base/);

  const plan = runMetrics(repo, home, { binDir: fakeBin(), extra: ["--plan"] });
  assert.notEqual(plan.status, 0);
  assert.match(plan.stderr, /--plan writes no file; drop --out/);
  assert.deepEqual(calls(home, "mutator"), []);
});
