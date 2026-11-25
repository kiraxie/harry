import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { run as initRun } from "../scripts/lib/init-ignore.mjs";
import {
  fakeBin,
  installCrapper,
  installStub,
  lastLine,
  MUTATOR_FROM_MARKERS,
  makeRepo,
  mutatorHome,
  PKG,
  runMetrics,
  runPlan,
  status,
  tempDir,
  toolSection,
  write,
  writeExecutable,
} from "./metrics-harness.ts";

const OVERLAY_SCRIPT = path.resolve(import.meta.dirname, "../src/lib/metrics/overlay-check.py");

const REAL_MUTATOR_PYTHON = path.join(os.homedir(), ".claude/harry/tools/mutator/.venv/bin/python");

const NO_REAL_MUTATOR = existsSync(REAL_MUTATOR_PYTHON) ? false : "mutator is not installed";

/** Run dirs left under a group's target/mutation-workers. */
function runDirs(root: string): string[] {
  const dir = path.join(root, "target/mutation-workers");
  return existsSync(dir) ? readdirSync(dir).filter((d) => d.startsWith("run-")) : [];
}

test("the real overlay check reads a worker baseline, a canary, and an unseen file even behind a static step, leaving no run dir", {
  skip: NO_REAL_MUTATOR,
}, () => {
  const root = tempDir("harry-overlay-");
  write(root, "package.json", "{}\n");
  write(root, "src/a.js", "module.exports = 1;\n");
  write(root, "dist/x.txt", "built\n");
  const check = (command: string) => {
    const res = spawnSync(REAL_MUTATOR_PYTHON, [OVERLAY_SCRIPT, root, "src/a.js", command], {
      cwd: os.tmpdir(),
      encoding: "utf8",
    });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout) as { baseline: string; canary: string; tail: string };
  };

  const seen = check("node src/a.js");
  const unseen = check("cat src/a.js > /dev/null");
  // A static step parses the worker copy; the canary must pass it, so only loading the file counts.
  const parsedOnly = check("node --check src/a.js && cat src/a.js > /dev/null");
  // dist/ is never linked into a worker, so this passes in the root and fails there.
  const workerOnly = check("test -f dist/x.txt || { echo 'no dist/x.txt in the worker'; exit 1; }");

  assert.deepEqual([seen.baseline, seen.canary], ["pass", "fail"]);
  assert.match(seen.tail, /harry-overlay-canary/);
  assert.deepEqual([unseen.baseline, unseen.canary], ["pass", "pass"]);
  assert.deepEqual([parsedOnly.baseline, parsedOnly.canary], ["pass", "pass"]);
  assert.deepEqual([workerOnly.baseline, workerOnly.canary], ["fail", "fail"]);
  assert.match(workerOnly.tail, /no dist\/x\.txt in the worker/);
  assert.deepEqual(runDirs(root), []);
  assert.equal(readFileSync(path.join(root, "src/a.js"), "utf8"), "module.exports = 1;\n");
});

test("in mutator's worker a CLI test over the harness loads the worker's src, not the checkout's", {
  skip: NO_REAL_MUTATOR,
}, () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const fixture = tempDir("harry-overlay-harness-");
  for (const dir of ["src", "scripts/lib"]) {
    cpSync(path.join(repoRoot, dir), path.join(fixture, dir), {
      recursive: true,
      dereference: true,
    });
  }
  for (const file of [
    "package.json",
    "tests/metrics-harness.ts",
    "tests/section.ts",
    "tests/lines.ts",
    "tests/metrics-plan.test.ts",
  ]) {
    write(fixture, file, readFileSync(path.join(repoRoot, file), "utf8"));
  }
  const command = `"${process.execPath}" --preserve-symlinks-main --test --test-name-pattern="plan --max-workers sets the workers" tests/metrics-plan.test.ts`;

  // Under an inherited NODE_TEST_CONTEXT the nested runner skips every file and exits 0.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;

  const res = spawnSync(
    REAL_MUTATOR_PYTHON,
    [OVERLAY_SCRIPT, fixture, "src/commands/metrics.ts", command],
    { cwd: os.tmpdir(), encoding: "utf8", env },
  );

  assert.equal(res.status, 0, res.stderr);
  const answer = JSON.parse(res.stdout) as { baseline: string; canary: string; tail: string };
  assert.deepEqual([answer.baseline, answer.canary], ["pass", "fail"], answer.tail);
});

const HOST_GO = spawnSync("sh", ["-c", "command -v go"], { encoding: "utf8" }).stdout.trim();

/** PEP 8 E305, as flake8 and black hold it: a top-level line after an indented one needs two blank lines. */
const E305 = `import re, sys
text = open(sys.argv[1]).read()
sys.exit(1 if re.findall(r"\\n[ \\t]+\\S[^\\n]*\\n\\n?[^\\s]", text) else 0)
`;

/**
 * Per CANARIES row the real helper can run here: a fixture whose file ends in a
 * top-level definition, a command that loads it (the canary must fail it, naming
 * the marker), and one that only checks it statically (the canary must pass it).
 */
const CANARY_ROWS: {
  language: string;
  skip: string | false;
  files: Record<string, string>;
  file: string;
  loads: string;
  checksOnly: string;
}[] = [
  {
    language: "python",
    skip: NO_REAL_MUTATOR,
    files: { "pkg/b.py": "def f():\n    return 1\n", "e305.py": E305 },
    file: "pkg/b.py",
    loads: `"${REAL_MUTATOR_PYTHON}" -c "import sys; sys.path.insert(0, 'pkg'); import b"`,
    checksOnly: `"${REAL_MUTATOR_PYTHON}" -m py_compile pkg/b.py && "${REAL_MUTATOR_PYTHON}" e305.py pkg/b.py`,
  },
  {
    language: "go",
    skip: NO_REAL_MUTATOR || (HOST_GO === "" ? "no go on PATH" : false),
    files: {
      "go.mod": "module m\n\ngo 1.21\n",
      "pkg/b.go": "package pkg\n\nfunc F() int { return 1 }\n",
      "pkg/b_test.go":
        'package pkg\n\nimport "testing"\n\nfunc TestF(t *testing.T) {\n\tif F() != 1 {\n\t\tt.Fatal("F")\n\t}\n}\n',
    },
    file: "pkg/b.go",
    loads: "go test ./...",
    checksOnly: 'go vet ./... && test -z "$(gofmt -l .)"',
  },
];

for (const row of CANARY_ROWS) {
  test(`the ${row.language} canary fails a run that loads the file and passes a static check of it`, {
    skip: row.skip,
  }, () => {
    const root = tempDir("harry-overlay-row-");
    for (const [rel, text] of Object.entries(row.files)) write(root, rel, text);
    const check = (command: string) => {
      const res = spawnSync(REAL_MUTATOR_PYTHON, [OVERLAY_SCRIPT, root, row.file, command], {
        cwd: os.tmpdir(),
        encoding: "utf8",
      });
      assert.equal(res.status, 0, res.stderr);
      return JSON.parse(res.stdout) as { baseline: string; canary: string; tail: string };
    };

    const loaded = check(row.loads);
    const checked = check(row.checksOnly);

    assert.deepEqual([loaded.baseline, loaded.canary], ["pass", "fail"], loaded.tail);
    assert.match(loaded.tail, /harry-overlay-canary/);
    assert.deepEqual([checked.baseline, checked.canary], ["pass", "pass"], checked.tail);
    assert.deepEqual(runDirs(root), []);
  });
}

/** Runs `code` in mutator's venv python with the helper's globals loaded as `m` (runpy, so main() does not run). */
function withHelper(code: string, args: string[]) {
  const prelude = "import json, runpy, sys\nm = runpy.run_path(sys.argv[1])\n";
  return spawnSync(REAL_MUTATOR_PYTHON, ["-c", prelude + code, OVERLAY_SCRIPT, ...args], {
    cwd: os.tmpdir(),
    encoding: "utf8",
  });
}

test("a language crapper names with no canary row fails the check, naming it, with no run and no target/", {
  skip: NO_REAL_MUTATOR,
}, () => {
  const root = tempDir("harry-overlay-kt-");
  write(root, "src/a.kt", "fun a() = 1\n");

  const res = withHelper(
    'm["ensure_crapper"]().discover.EXTENSIONS[".kt"] = "kotlin"\nm["main"]([sys.argv[2], "src/a.kt", "true"])\n',
    [root],
  );

  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stderr, /kotlin/);
  assert.match(res.stderr, /src\/a\.kt/);
  assert.equal(res.stdout, "");
  assert.ok(!existsSync(path.join(root, "target")), "target/ is left");
});

test("every language the installed crapper names has a canary row or is a named syntax-canary language", {
  skip: NO_REAL_MUTATOR,
}, () => {
  const res = withHelper(
    'print(json.dumps({"syntax": sorted(m["SYNTAX_LANGUAGES"]), "known": sorted(set(m["CANARIES"]) | m["SYNTAX_LANGUAGES"]), "crapper": sorted(set(m["ensure_crapper"]().discover.EXTENSIONS.values()))}))\n',
    [],
  );

  assert.equal(res.status, 0, res.stderr);
  const sets = JSON.parse(res.stdout) as { syntax: string[]; known: string[]; crapper: string[] };
  assert.deepEqual(sets.syntax, ["java", "rust"]);
  assert.deepEqual(sets.known, sets.crapper);
});

test("a run with the real overlay check leaves git status and target/ as they were", {
  skip: NO_REAL_MUTATOR,
}, () => {
  const repo = makeRepo(
    { "package.json": PKG },
    { "src/a.ts": "export const a = 1 > 0; // mut > >= survived\n" },
  );
  const home = mutatorHome();
  writeExecutable(
    path.join(home, ".claude/harry/tools/mutator/.venv/bin/python"),
    `#!/bin/sh\nexec "${REAL_MUTATOR_PYTHON}" "$@"\n`,
  );
  const before = status(repo);

  // The fake npm passes every run, the canary's included: nothing sees the file.
  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  assert.match(
    toolSection(run.facts, "mutator"),
    /- src\/a\.ts: not measured: no test sees this file in mutator's worker/,
    run.facts,
  );
  assert.equal(status(repo), before);
  assert.ok(!existsSync(path.join(repo, "target")), "target/ is removed");
});

const HOST_PYTHON = spawnSync("sh", ["-c", "command -v python3"], {
  encoding: "utf8",
}).stdout.trim();

/**
 * A Python group whose root holds a `coverage.py` and a `runpy.py`, each writing `marker` when
 * imported. `runpy` is frozen from 3.11 on, so its shadow only bites on an older host python.
 */
function shadowedPythonRepo(marker: string): string {
  const repo = makeRepo(
    { "pyproject.toml": "[project]\nname = 'p'\n" },
    { "src/p.py": "A = 1  # // mut 1 0 killed\n" },
  );
  writeFileSync(
    path.join(repo, ".git/info/exclude"),
    ".venv/\n__pycache__/\ncoverage.py\nrunpy.py\n",
  );
  // A real venv runs site, which turns an empty PYTHONPATH component into the cwd's absolute
  // path, and keeps the host's site-packages out: only PYTHONPATH or the group dir can answer.
  execFileSync(HOST_PYTHON, ["-m", "venv", "--without-pip", path.join(repo, ".venv")]);
  write(repo, "coverage.py", `open(${JSON.stringify(marker)}, "w").write("x")\n`);
  write(repo, "runpy.py", `open(${JSON.stringify(marker)}, "w").write("x")\n`);
  return repo;
}

/** PYTHONPATH forms: none (the cwd alone), then each that puts the group dir on sys.path again. */
const GROUP_ON_PYTHONPATH: { name: string; entry: (repo: string) => string }[] = [
  { name: "nothing", entry: () => "" },
  { name: "an empty component", entry: () => "/nonexistent:" },
  { name: "`.`", entry: () => "." },
  { name: "the group's absolute dir", entry: (repo) => repo },
];

for (const form of GROUP_ON_PYTHONPATH) {
  test(`with ${form.name} on PYTHONPATH, --plan's python import probe never imports a module from the group dir`, {
    skip: HOST_PYTHON === "" ? "no python3 on PATH" : false,
  }, () => {
    const marker = path.join(tempDir("harry-metrics-marker-"), "imported");
    const repo = shadowedPythonRepo(marker);
    const home = mutatorHome();
    const before = status(repo);

    const res = runPlan(repo, home, fakeBin(), [], { PYTHONPATH: form.entry(repo) });

    assert.equal(res.status, 0, res.stderr);
    assert.equal(
      lastLine(res.stdout),
      "Estimate: 0 coverage runs + 1 baseline + 3 test-command rounds (1 for mutants, 2 for overlay checks)",
      res.stdout,
    );
    assert.equal(
      existsSync(marker),
      false,
      "a coverage.py or runpy.py in the group dir was imported",
    );
    assert.equal(status(repo), before);
  });

  test(`with ${form.name} on PYTHONPATH, the run's python import probe never imports a module from the group dir`, {
    skip: HOST_PYTHON === "" ? "no python3 on PATH" : false,
  }, () => {
    const marker = path.join(tempDir("harry-metrics-marker-"), "imported");
    const repo = shadowedPythonRepo(marker);
    const home = tempDir("harry-metrics-home-");
    installCrapper(home);
    const before = status(repo);

    const run = runMetrics(repo, home, {
      binDir: fakeBin(),
      env: { PYTHONPATH: form.entry(repo) },
    });

    assert.equal(run.status, 0, run.stderr);
    assert.match(toolSection(run.facts, "crapper"), /complexity only: coverage is not installed/);
    assert.equal(
      existsSync(marker),
      false,
      "a coverage.py or runpy.py in the group dir was imported",
    );
    assert.equal(status(repo), before);
  });
}

/**
 * A `coverage` package that stands in for the real one: `run` writes its data file where
 * coverage.py would (`--data-file=`, else `./.coverage`), first importing `imports`, as the
 * tests it runs would; `lcov -o <file>` reads that data file and writes an empty report.
 */
function coverageStandIn(imports: string | null = null): string {
  const dir = tempDir("harry-metrics-coverage-");
  write(dir, "coverage/__init__.py", "");
  write(
    dir,
    "coverage/__main__.py",
    [
      "import os, sys",
      "args = sys.argv[1:]",
      "flag = [a for a in args if a.startswith('--data-file=')]",
      "data = flag[0].split('=', 1)[1] if flag else '.coverage'",
      "if args[:1] == ['run']:",
      ...(imports === null ? [] : [`    import ${imports}`]),
      "    os.makedirs(os.path.dirname(data) or '.', exist_ok=True)",
      "    open(data, 'w').write('')",
      "if args[:1] == ['lcov']:",
      "    if not os.path.exists(data):",
      "        sys.exit('No data to report.')",
      "    out = args[args.index('-o') + 1]",
      "    os.makedirs(os.path.dirname(out), exist_ok=True)",
      "    open(out, 'w').write('TN:\\nend_of_record\\n')",
      "",
    ].join("\n"),
  );
  return dir;
}

/** Stub mutator that records the checkout's untracked files each time it runs mutants. */
const MUTATOR_RECORDING_STATUS = `
if (!args.includes("--scan")) {
  const seen = require("node:child_process").execFileSync(
    "git",
    ["-c", "core.excludesFile=/dev/null", "status", "--porcelain", "-uall"],
    { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } },
  );
  fs.appendFileSync(process.env.STATUS_LOG, seen);
}
${MUTATOR_FROM_MARKERS}`;

// A consumer test that lists untracked files reads whatever metrics leaves in a group dir
// while mutator runs it; init's .gitignore is what keeps that list empty.
test("while mutator runs a nested Python group's tests, the checkout under init's .gitignore has nothing untracked", {
  skip: HOST_PYTHON === "" ? "no python3 on PATH" : false,
}, () => {
  const ignores = tempDir("harry-metrics-ignore-");
  initRun(ignores);
  const repo = makeRepo(
    {
      ".gitignore": readFileSync(path.join(ignores, ".gitignore"), "utf8"),
      "packages/api/pyproject.toml": "[project]\nname = 'api'\n",
    },
    { "packages/api/src/p.py": "# // crap p 2 1\nA = 1  # // mut 1 0 killed\n" },
  );
  writeFileSync(path.join(repo, ".git/info/exclude"), ".venv/\n__pycache__/\n");
  execFileSync(HOST_PYTHON, ["-m", "venv", "--without-pip", path.join(repo, "packages/api/.venv")]);
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  installStub(home, "mutator", MUTATOR_RECORDING_STATUS);
  const log = path.join(tempDir("harry-metrics-status-"), "status.log");

  const run = runMetrics(repo, home, {
    binDir: fakeBin(),
    env: { PYTHONPATH: coverageStandIn(), STATUS_LOG: log },
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(toolSection(run.facts, "crapper"), /— coverage: /, run.facts);
  assert.ok(existsSync(log), `mutator ran no mutants\n${run.facts}`);
  assert.equal(readFileSync(log, "utf8"), "");
});

test("the coverage run's target still imports a module from the group dir when PYTHONPATH names another dir", {
  skip: HOST_PYTHON === "" ? "no python3 on PATH" : false,
}, () => {
  const marker = path.join(tempDir("harry-metrics-marker-"), "imported");
  const repo = shadowedPythonRepo(marker);
  write(repo, "helpers.py", "");
  writeFileSync(
    path.join(repo, ".git/info/exclude"),
    ".venv/\n__pycache__/\ncoverage.py\nrunpy.py\nhelpers.py\ntarget/\n",
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);

  const run = runMetrics(repo, home, {
    binDir: fakeBin(),
    env: { PYTHONPATH: coverageStandIn("helpers") },
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(toolSection(run.facts, "crapper"), /— coverage: python -m coverage run/, run.facts);
  assert.equal(existsSync(marker), false, "a coverage.py or runpy.py in the group dir ran");
});

test("the coverage run executes the coverage package on PYTHONPATH, never a coverage.py in the group dir", {
  skip: HOST_PYTHON === "" ? "no python3 on PATH" : false,
}, () => {
  const marker = path.join(tempDir("harry-metrics-marker-"), "imported");
  const repo = shadowedPythonRepo(marker);
  writeFileSync(
    path.join(repo, ".git/info/exclude"),
    ".venv/\n__pycache__/\ncoverage.py\nrunpy.py\ntarget/\n",
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);

  const run = runMetrics(repo, home, { binDir: fakeBin(), env: { PYTHONPATH: coverageStandIn() } });

  assert.equal(run.status, 0, run.stderr);
  assert.match(toolSection(run.facts, "crapper"), /— coverage: python -m coverage run/, run.facts);
  assert.equal(existsSync(marker), false, "a coverage.py or runpy.py in the group dir ran");
});
