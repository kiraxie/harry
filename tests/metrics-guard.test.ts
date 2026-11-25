import assert from "node:assert/strict";
import { existsSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  argAfter,
  calls,
  DRYER_ALL_PAIRS,
  FAKE_VENV_PYTHON,
  fakeBin,
  installCrapper,
  installStub,
  MUTATOR_FROM_MARKERS,
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
  write,
  writeExecutable,
} from "./metrics-harness.ts";

const STALE_SNAPSHOT =
  '{:outcomes {"[\\"src/m.ts\\",\\"m\\",\\"defn/m\\",0,1,\\"OLD\\",\\"STALE\\"]" :survived}}\n';

const PRE_EXISTING_ARTIFACTS: Record<string, string> = {
  ".metrics/mutate/stale.edn": STALE_SNAPSHOT,
  ".metrics/keep.edn": "old\n",
  "coverage/old/lcov.info": "stale\n",
  "target/keep.txt": "build output\n",
};

for (const kind of ["untracked", "tracked", "tracked, with an uncommitted edit,"] as const) {
  test(`after a run every ${kind} artifact path is as it was before, and mutator starts from no snapshot`, () => {
    const tracked = kind !== "untracked";
    const repo = makeRepo(
      {
        "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
        ...(tracked ? PRE_EXISTING_ARTIFACTS : {}),
      },
      { "src/m.ts": "// crap m 2 1\nexport const m = (a: number) => a > 1; // mut > >= killed\n" },
    );
    const expected = { ...PRE_EXISTING_ARTIFACTS };
    if (kind === "tracked, with an uncommitted edit,") expected[".metrics/keep.edn"] = "my edit\n";
    for (const [rel, text] of Object.entries(
      tracked ? { ".metrics/keep.edn": expected[".metrics/keep.edn"] } : expected,
    )) {
      write(repo, rel, text);
    }
    const home = tempDir("harry-metrics-home-");
    installCrapper(home);
    installStub(home, "mutator", MUTATOR_FROM_MARKERS);
    const before = status(repo);

    const run = runMetrics(repo, home, { binDir: fakeBin() });

    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.facts, /STALE/);
    assert.equal(status(repo), before);
    for (const [rel, text] of Object.entries(expected)) {
      assert.equal(readFileSync(path.join(repo, rel), "utf8"), text, rel);
    }
    assert.ok(!existsSync(path.join(repo, ".metrics/crap.edn")));
    assert.ok(!existsSync(path.join(repo, "target/coverage")));
  });
}

test("a run that leaves a path it cannot account for exits non-zero naming it", () => {
  const repo = makeRepo(
    { "package.json": JSON.stringify({ scripts: { test: "node --test" } }) },
    { "src/m.ts": "// crap m 2 1\nexport const m = 1;\n" },
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  const bin = fakeBin();
  writeFileSync(
    path.join(bin, "npx"),
    readFileSync(path.join(bin, "npx"), "utf8").replace(
      "process.exit(",
      'out("litter.txt", "x");\nprocess.exit(',
    ),
  );

  const run = runMetrics(repo, home, { binDir: bin });

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /litter\.txt/);
  assert.ok(!existsSync(path.join(repo, "target")), "created target/ is still removed");
});

test("a tool failure, a bad exit or an unparsable snapshot, is recorded with its commit without stopping the others", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    { "src/m.ts": "export const m = (a: number) => a > 1; // mut > >= survived\n" },
  );
  const home = tempDir("harry-metrics-home-");
  const dryerCommit = installStub(
    home,
    "dryer",
    'process.stderr.write("boom\\n"); process.exit(1);',
  );
  const crapperCommit = installStub(home, "crapper", 'out(".metrics/crap.edn", "{:entries [");');
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const dryer = toolSection(run.facts, "dryer");
  assert.match(dryer, /failed: dryer exited 1\nboom/);
  assert.match(dryer, new RegExp(`tool commit ${dryerCommit}`));
  const crapper = toolSection(run.facts, "crapper");
  assert.match(crapper, /failed: EDN: /);
  assert.match(crapper, new RegExp(`tool commit ${crapperCommit}`));
  assert.match(toolSection(run.facts, "mutator"), /src\/m\.ts:1 `>` → `>=`/);
});

function auditRepo(): string {
  const repo = makeRepo(
    {
      "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
      "src/a.ts": "// crap big 12 0\nfunction big() {} // mut > >= survived\n",
    },
    { "src/b.ts": "// crap small 2 1\nfunction small() {}\n" },
  );
  write(repo, ".worktrees/wt/src/a.ts", "// crap ghost 40 0\n");
  return repo;
}

test("audit runs dryer and complexity-only crapper on a tracked snapshot and writes substrate files", () => {
  const repo = auditRepo();
  const home = tempDir("harry-metrics-home-");
  installStub(home, "dryer", DRYER_ALL_PAIRS);
  installCrapper(home);
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);
  const bin = fakeBin();
  const before = status(repo);

  const run = runAudit(repo, home, bin);

  assert.equal(run.status, 0, run.stderr);
  const facts = readFileSync(path.join(run.out, "metrics.md"), "utf8");
  assert.match(readFileSync(path.join(run.out, "dry.edn"), "utf8"), /src\/a\.ts.*src\/b\.ts/s);
  assert.match(readFileSync(path.join(run.out, "crap.edn"), "utf8"), /"big"/);
  assert.match(toolSection(facts, "crapper"), /`big`/);
  assert.doesNotMatch(
    `${facts}${readFileSync(path.join(run.out, "crap.edn"), "utf8")}`,
    /ghost|\.worktrees/,
  );
  for (const c of [...calls(home, "dryer"), ...calls(home, "crapper")]) {
    const root = argAfter(c.args, "--root") ?? "";
    assert.ok(!root.startsWith(repo), `ran in the checkout: ${root}`);
  }
  assert.deepEqual(calls(home, "mutator"), []);
  assert.deepEqual(pmCalls(bin), []);
  assert.equal(status(repo), before);
});

test("audit --run-tests adds coverage and mutator in the checkout and leaves it as it was", () => {
  const repo = auditRepo();
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);
  const bin = fakeBin();
  const before = status(repo);

  const run = runAudit(repo, home, bin, ["--run-tests"]);

  assert.equal(run.status, 0, run.stderr);
  const facts = readFileSync(path.join(run.out, "metrics.md"), "utf8");
  assert.ok(
    calls(home, "crapper").some(
      (c) => argAfter(c.args, "--root") === repo && c.args[0] === "--use-existing-coverage",
    ),
  );
  assert.match(toolSection(facts, "crapper"), /^- `big` \(.*\) src\/a\.ts:2 — CC 12/m);
  assert.match(toolSection(facts, "mutator"), /src\/a\.ts:2 `>` → `>=`/);
  assert.equal(status(repo), before);
  assert.ok(!existsSync(path.join(repo, "target")));
});

test("audit --run-tests locates a nested package's function by its repo-relative path", () => {
  const repo = makeRepo(
    {
      "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
      "packages/x/package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    },
    { "packages/x/src/x.ts": "// crap deep 12 0\nfunction deep() {}\n" },
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  const run = runAudit(repo, home, fakeBin(), ["--run-tests"]);

  assert.equal(run.status, 0, run.stderr);
  const facts = readFileSync(path.join(run.out, "metrics.md"), "utf8");
  assert.match(toolSection(facts, "crapper"), /^- `deep` \(.*\) packages\/x\/src\/x\.ts:2 — /m);
});

function nodeRepo(): string {
  return makeRepo(
    { "package.json": JSON.stringify({ scripts: { test: "node --test" } }) },
    { "src/m.ts": "// crap m 2 1\nexport const m = 1;\n" },
  );
}

function binWhereNpx(does: string): string {
  const bin = fakeBin();
  const npx = path.join(bin, "npx");
  writeFileSync(npx, readFileSync(npx, "utf8").replace("process.exit(", `${does}\nprocess.exit(`));
  return bin;
}

const STASH = ".git/harry-metrics-stash";

test("a dirty file the test run rewrites in place exits non-zero naming it, though its status line is unchanged", () => {
  const repo = nodeRepo();
  write(repo, "README.md", "my edit\n");
  write(repo, "notes.txt", "mine\n");
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  const bin = binWhereNpx(
    'fs.writeFileSync("README.md", "rewritten\\n"); fs.writeFileSync("notes.txt", "rewritten\\n");',
  );
  const before = status(repo);

  const run = runMetrics(repo, home, { binDir: bin });

  assert.equal(status(repo), before);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /README\.md/);
  assert.match(run.stderr, /notes\.txt/);
});

test("an interrupt that stops the child exits 128+signal with the checkout restored", () => {
  const repo = nodeRepo();
  write(repo, ".metrics/keep.edn", "old\n");
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  const bin = binWhereNpx(
    'out("target/coverage/partial.txt", "x"); process.kill(0, "SIGINT"); setTimeout(() => {}, 5000);',
  );
  const before = status(repo);

  const run = runMetrics(repo, home, { binDir: bin, detached: true });

  assert.equal(run.status, 130, `signal ${run.signal}\n${run.stderr}`);
  assert.match(run.stderr, /interrupted/i);
  assert.equal(readFileSync(path.join(repo, ".metrics/keep.edn"), "utf8"), "old\n");
  assert.ok(!existsSync(path.join(repo, "target")));
  assert.ok(!existsSync(path.join(repo, STASH)));
  assert.equal(status(repo), before);
});

test("a stash left by an earlier run is never overwritten: the run refuses, naming what it holds", () => {
  const repo = nodeRepo();
  write(repo, `${STASH}/0/keep.edn`, "stranded\n");
  write(repo, `${STASH}/manifest`, `0\t${path.join(repo, ".metrics")}\n`);
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /harry-metrics-stash/);
  assert.match(run.stderr, new RegExp(`0 → ${path.join(repo, ".metrics").replace(/[.]/g, "\\.")}`));
  assert.equal(readFileSync(path.join(repo, `${STASH}/0/keep.edn`), "utf8"), "stranded\n");
  assert.ok(!existsSync(path.join(repo, ".metrics")));
});

test("a dangling symlink at an artifact path is kept, not taken for absent and deleted", () => {
  const repo = nodeRepo();
  symlinkSync("/nonexistent/harry-cov", path.join(repo, "coverage"));
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  const before = status(repo);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readlinkSync(path.join(repo, "coverage")), "/nonexistent/harry-cov");
  assert.equal(status(repo), before);
});

test("an interrupted run still names the files it left changed", () => {
  const repo = nodeRepo();
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  const bin = binWhereNpx(
    'out("stray.txt", "x"); process.kill(0, "SIGINT"); setTimeout(() => {}, 5000);',
  );

  const run = runMetrics(repo, home, { binDir: bin, detached: true });

  assert.equal(run.status, 130, run.stderr);
  assert.match(run.stderr, /stray\.txt/);
});

test("an interrupt during one group's mutator run exits 128+signal and starts no later group's", () => {
  const repo = makeRepo(
    {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/x/package.json": PKG,
      "packages/y/package.json": PKG,
    },
    {
      "packages/x/src/x.ts": "export const x = 1; // mut 1 0 killed // mutator interrupt\n",
      "packages/y/src/y.ts": "export const y = 1; // mut 1 0 killed\n",
    },
  );
  const home = mutatorHome();
  const before = status(repo);

  const run = runMetrics(repo, home, { binDir: fakeBin(), detached: true });

  assert.equal(run.status, 130, `signal ${run.signal}\n${run.stderr}`);
  assert.match(run.stderr, /interrupted/i);
  assert.equal(status(repo), before);
  assert.deepEqual(
    mutatorRuns(home).map((c) => path.relative(repo, argAfter(c.args, "--root") ?? "")),
    ["packages/x"],
  );
});

test("a stdlib-named file at a Python group root shadows no tool", () => {
  const repo = makeRepo(
    { "pyproject.toml": "[project]\nname = 'p'\n", "json.py": "raise ImportError\n" },
    { "src/p.py": "# // crap p 12 0\ndef p(a):\n    return a > 1  # // mut > >= survived\n" },
  );
  writeExecutable(path.join(repo, ".venv/bin/python"), FAKE_VENV_PYTHON);
  writeFileSync(path.join(repo, ".git/info/exclude"), ".venv/\n");
  const home = tempDir("harry-metrics-home-");
  installStub(home, "dryer", DRYER_ALL_PAIRS);
  installCrapper(home);
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.facts, /failed|shadowed/, run.facts);
  assert.match(toolSection(run.facts, "crapper"), /`p` \(.*\) src\/p\.py:2 /, run.facts);
  assert.match(toolSection(run.facts, "mutator"), /src\/p\.py:3 `>` → `>=`/, run.facts);
  for (const tool of ["crapper", "mutator"]) {
    const roots = calls(home, tool).map((c) => argAfter(c.args, "--root"));
    assert.ok(roots.includes(repo), `${tool} --root ${roots.join(", ")}`);
  }
});

test("every tool start runs in its own fresh empty dir outside the checkout, gone once it returns, -P on the venv python only", () => {
  const repo = makeRepo(
    { "pyproject.toml": "[project]\nname = 'p'\n" },
    { "src/p.py": "# // crap p 12 0\ndef p(a):\n    return a > 1  # // mut > >= survived\n" },
  );
  writeExecutable(path.join(repo, ".venv/bin/python"), FAKE_VENV_PYTHON);
  writeFileSync(path.join(repo, ".git/info/exclude"), ".venv/\n");
  const home = tempDir("harry-metrics-home-");
  installStub(home, "dryer", DRYER_ALL_PAIRS);
  installCrapper(home);
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const launcher = ["dryer", "crapper", "mutator"].flatMap((t) => calls(home, t));
  const python = ["crapper", "mutator"].flatMap((t) => calls(home, t, ".venv/bin"));
  assert.ok(launcher.length >= 3, `launcher starts: ${launcher.length}`);
  assert.equal(python.length, 2, "the crapper spans script and one overlay check");
  const all = [...launcher, ...python];
  assert.equal(new Set(all.map((c) => c.cwd)).size, all.length, "a cwd was reused");
  for (const c of all) {
    assert.deepEqual(c.entries, [], `${c.cwd} was not empty`);
    assert.equal(existsSync(c.cwd), false, `${c.cwd} was left behind`);
    assert.ok(!c.cwd.startsWith(`${repo}/`) && !c.cwd.startsWith(`${home}/`), c.cwd);
  }
  for (const c of launcher) assert.notEqual(c.argv[0], "-P", c.argv.join(" "));
  for (const c of python) assert.equal(c.argv[0], "-P", c.argv.join(" "));
});
