import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { failureTail } from "../src/lib/metrics/tools.ts";
import {
  argAfter,
  calls,
  commitAll,
  DRYER_ALL_PAIRS,
  distInfo,
  FAKE_VENV_PYTHON,
  fakeBin,
  git,
  installCrapper,
  installStub,
  MUTATOR_FROM_MARKERS,
  makeRepo,
  mutatorHome,
  mutatorRuns,
  PKG,
  pmCalls,
  runMetrics,
  runPlan,
  status,
  tempDir,
  toolSection,
  write,
  writeExecutable,
} from "./metrics-harness.ts";

test("dryer lists only pairs touching a changed file, and never an untracked path", () => {
  const repo = makeRepo(
    { "src/a.ts": "export const a = 1;\n", "src/c.ts": "export const c = 3;\n" },
    { "src/b.ts": "export const b = 2;\n" },
  );
  write(repo, ".worktrees/wt/src/b.ts", "export const b = 2;\n");
  const home = tempDir("harry-metrics-home-");
  const commit = installStub(home, "dryer", DRYER_ALL_PAIRS);

  const run = runMetrics(repo, home);

  assert.equal(run.status, 0, run.stderr);
  const dryer = toolSection(run.facts, "dryer");
  assert.ok(dryer.startsWith(` (${commit.slice(0, 7)})`), dryer);
  assert.match(dryer, /src\/a\.ts:1-9 .* src\/b\.ts:1-9/);
  assert.match(dryer, /src\/b\.ts:1-9 .* src\/c\.ts:1-9/);
  assert.doesNotMatch(dryer, /src\/a\.ts:1-9 .* src\/c\.ts/);
  assert.doesNotMatch(run.facts, /\.worktrees/);
  assert.notEqual(argAfter(calls(home, "dryer")[0].args, "--root"), repo);
});

test("with no tool installed, every tool is reported not installed and the checkout is untouched", () => {
  const repo = makeRepo(
    { "src/a.ts": "export const a = 1;\n" },
    { "src/b.ts": "export const b = 2;\n" },
  );
  const home = tempDir("harry-metrics-home-");
  const before = status(repo);

  const run = runMetrics(repo, home);

  assert.equal(run.status, 0, run.stderr);
  for (const tool of ["dryer", "crapper", "mutator"]) {
    assert.match(
      run.facts,
      new RegExp(`## ${tool}\\n+not installed \\(expected at .*/${tool}/${tool}; `),
      run.facts,
    );
  }
  assert.equal(status(repo), before);
});

/** As the real launchers do on a run with no venv Python: build it. */
const BUILDS_VENV_PYTHON = `
const venvPython = path.join(__dirname, ".venv", "bin", "python");
if (!fs.existsSync(venvPython)) {
  fs.mkdirSync(path.dirname(venvPython), { recursive: true });
  fs.writeFileSync(venvPython, "#!/bin/sh\\n", { mode: 0o755 });
}
`;

test("a tool with no venv Python is reported not installed: its launcher never runs, no venv is built, no test runs", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    { "src/a.ts": "// crap a 2 1\nfunction a() {} // mut > >= survived\n" },
  );
  const home = tempDir("harry-metrics-home-");
  const tools = ["dryer", "crapper", "mutator"];
  for (const tool of tools) {
    installStub(home, tool, BUILDS_VENV_PYTHON);
    rmSync(path.join(home, ".claude", "harry", "tools", tool, ".venv"), {
      recursive: true,
      force: true,
    });
  }
  const bin = fakeBin();

  const run = runMetrics(repo, home, { binDir: bin });

  assert.equal(run.status, 0, run.stderr);
  for (const tool of tools) {
    const clone = path.join(home, ".claude", "harry", "tools", tool);
    const section = toolSection(run.facts, tool);
    assert.match(section, /^\n+not installed \(/, section);
    assert.ok(section.includes(`${tool}/.venv/bin/python`), section);
    assert.match(section, /`\/harry:sync --tools` builds it/);
    assert.match(section, /run the launcher once by hand when sync leaves the clone as is/);
    assert.deepEqual(calls(home, tool), [], `${tool}'s launcher ran`);
    assert.ok(!existsSync(path.join(clone, ".venv")), `${tool} got a venv`);
  }
  assert.deepEqual(pmCalls(bin), []);
});

test("a tool whose venv Python is not executable is not installed, while a built tool beside it still runs", () => {
  const repo = makeRepo(
    { "package.json": PKG, "src/a.ts": "export const a = 1;\n" },
    { "src/b.ts": "export const b = 2; // mut > >= survived\n" },
  );
  const home = tempDir("harry-metrics-home-");
  const dryerCommit = installStub(home, "dryer", DRYER_ALL_PAIRS);
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);
  chmodSync(path.join(home, ".claude", "harry", "tools", "mutator", ".venv/bin/python"), 0o644);
  const bin = fakeBin();

  const run = runMetrics(repo, home, { binDir: bin });

  assert.equal(run.status, 0, run.stderr);
  assert.ok(toolSection(run.facts, "dryer").startsWith(` (${dryerCommit.slice(0, 7)})`));
  assert.equal(calls(home, "dryer").length, 1);
  assert.match(toolSection(run.facts, "mutator"), /^\n+not installed \(no venv Python at /);
  assert.deepEqual(calls(home, "mutator"), []);
  assert.deepEqual(pmCalls(bin), []);
});

test("a tool whose venv lacks its package is reported not installed, naming sync, and its launcher never runs", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    { "src/a.ts": "// crap a 2 1\nfunction a() {} // mut > >= survived\n" },
  );
  const home = tempDir("harry-metrics-home-");
  const tools = ["dryer", "crapper", "mutator"];
  for (const tool of tools) {
    installStub(home, tool, "");
    rmSync(path.join(home, ".claude", "harry", "tools", tool, distInfo(tool)), {
      recursive: true,
    });
  }
  const bin = fakeBin();

  const run = runMetrics(repo, home, { binDir: bin });

  assert.equal(run.status, 0, run.stderr);
  for (const tool of tools) {
    const section = toolSection(run.facts, tool);
    assert.ok(
      section.includes(
        `not installed (venv at ~/.claude/harry/tools/${tool}/.venv lacks the ${tool} package; \`/harry:sync --tools\` rebuilds it, or remove that .venv and run the launcher once by hand when sync leaves the clone as is)`,
      ),
      section,
    );
    assert.deepEqual(calls(home, tool), [], `${tool}'s launcher ran`);
  }
  assert.deepEqual(pmCalls(bin), []);
});

test("--plan reports mutator not installed when its venv lacks the mutator package", () => {
  const repo = makeRepo(
    { "package.json": PKG, "src/a.ts": "export const a = 1;\n" },
    { "src/a.ts": "export const a = 2; // mut 2 1 killed\n" },
  );
  const home = tempDir("harry-metrics-home-");
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);
  rmSync(path.join(home, ".claude", "harry", "tools", "mutator", distInfo("mutator")), {
    recursive: true,
  });

  const res = runPlan(repo, home, fakeBin());

  assert.equal(res.status, 0, res.stderr);
  assert.match(
    res.stdout,
    /^- mutator not installed \(venv at ~\/\.claude\/harry\/tools\/mutator\/\.venv lacks the mutator package; /m,
    res.stdout,
  );
  assert.match(
    res.stdout.trimEnd().split("\n").at(-1) ?? "",
    /^Estimate: none \(mutator not installed \(venv at .* lacks the mutator package; .*\)\)$/,
    res.stdout,
  );
  assert.deepEqual(mutatorRuns(home), []);
});

test("crapper lists new functions at CRAP >= 10 and touched ones that got worse, never untouched ones", () => {
  const before = [
    "// crap untouched 12 0",
    "function untouched() {}",
    "// crap rose 3 1",
    "function rose() {}",
    "// crap stillBad 4 0",
    "function stillBad() {}",
    "// crap fine 2 1",
    "function fine() {}",
    "",
  ].join("\n");
  const after = before
    .replace(
      "// crap rose 3 1\nfunction rose() {}",
      "// crap rose 5 1\nfunction rose() { if (x) {} }",
    )
    .replace("function stillBad() {}", "function stillBad() { /* edited */ }")
    .replace("function fine() {}", "function fine() { /* edited */ }");
  const repo = makeRepo(
    { "package.json": PKG, "src/a.ts": before },
    {
      "src/a.ts": after,
      "src/n.ts":
        "// crap newHigh 3 0\nfunction newHigh() {}\n// crap newLow 3 1\nfunction newLow() {}\n",
    },
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const crapper = toolSection(run.facts, "crapper");
  const listed = [...crapper.matchAll(/^- (new|touched) `(\w+)`/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(listed.sort(), ["new newHigh", "touched rose", "touched stillBad"], crapper);
  assert.match(crapper, /`rose`.*CC 3 → 5/);
});

/** The mode flag of each crapper run inside the checkout (base-snapshot runs excluded). */
function checkoutModes(home: string, repo: string): string[] {
  return calls(home, "crapper")
    .filter((c) => argAfter(c.args, "--root")?.startsWith(repo))
    .map((c) => c.args[0]);
}

const COMPLEXITY_ONLY_CASES: {
  name: string;
  files: Record<string, string>;
  env?: Record<string, string>;
  reason: RegExp;
}[] = [
  {
    name: "a vitest package without @vitest/coverage-v8",
    files: {
      "package.json": JSON.stringify({
        scripts: { test: "vitest" },
        devDependencies: { vitest: "1" },
      }),
      "src/v.ts": "// crap v 2 0\nfunction v() {}\n",
    },
    reason:
      /complexity only: vitest without @vitest\/coverage-v8 resolvable from this package; install it/,
  },
  {
    name: "a Python package without coverage",
    files: { "pyproject.toml": "[project]\nname = 'p'\n", "src/p.py": "# // crap p 2 0\n" },
    reason: /complexity only: coverage is not installed in .*; install coverage there/,
  },
  {
    name: "a package whose coverage report was not produced",
    files: { "package.json": PKG, "src/r.ts": "// crap r 2 0\nfunction r() {}\n" },
    env: { FAKE_NO_REPORT: "1" },
    reason: /complexity only: coverage command `npm run coverage` produced no lcov\.info/,
  },
];

for (const c of COMPLEXITY_ONLY_CASES) {
  test(`${c.name} is scored complexity only, with the reason, and nothing is installed`, () => {
    const base = Object.fromEntries(Object.entries(c.files).filter(([f]) => !f.startsWith("src/")));
    const change = Object.fromEntries(
      Object.entries(c.files).filter(([f]) => f.startsWith("src/")),
    );
    const repo = makeRepo(base, change);
    writeExecutable(path.join(repo, ".venv/bin/python"), FAKE_VENV_PYTHON);
    writeFileSync(path.join(repo, ".git/info/exclude"), ".venv/\n");
    const home = tempDir("harry-metrics-home-");
    installCrapper(home);
    const bin = fakeBin();

    const run = runMetrics(repo, home, { binDir: bin, env: c.env });

    assert.equal(run.status, 0, run.stderr);
    assert.match(toolSection(run.facts, "crapper"), c.reason, run.facts);
    assert.deepEqual(checkoutModes(home, repo), ["--no-coverage"]);
    const installs = pmCalls(bin).filter((p) => /^(install|add|i)$/.test(p.args[0] ?? ""));
    assert.deepEqual(installs, []);
    const pyLog = path.join(repo, ".venv/bin/py.log");
    const py = existsSync(pyLog) ? readFileSync(pyLog, "utf8") : "";
    assert.doesNotMatch(py, /pip/);
  });
}

test("in a pnpm repo, coverage and mutator run per nearest package.json with pnpm", () => {
  const repo = makeRepo(
    {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/x/package.json": JSON.stringify({ scripts: { test: "node --test" } }),
      "packages/y/package.json": PKG,
    },
    {
      "packages/x/src/x.ts": "// crap x 2 1\nfunction x() { return 1; } // mut 1 0 killed\n",
      "packages/y/src/y.ts": "// crap y 2 1\nfunction y() { return 1; } // mut 1 0 killed\n",
    },
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);
  const bin = fakeBin();

  const run = runMetrics(repo, home, { binDir: bin });

  assert.equal(run.status, 0, run.stderr);
  const px = path.join(repo, "packages/x");
  const py = path.join(repo, "packages/y");
  assert.deepEqual(
    pmCalls(bin).map((c) => [c.bin, c.args.join(" "), c.cwd]),
    [
      [
        "npx",
        "--yes c8 --reporter=lcov --reports-dir target/coverage/typescript " +
          "--extension .ts --extension .tsx --extension .mts --extension .cts " +
          "--extension .js --extension .jsx --extension .mjs --extension .cjs pnpm test",
        px,
      ],
      ["pnpm", "run coverage", py],
    ],
  );
  const mut = mutatorRuns(home).map((c) => [
    argAfter(c.args, "--root"),
    argAfter(c.args, "--test-command"),
  ]);
  assert.deepEqual(mut, [
    [px, "pnpm test"],
    [py, "pnpm test"],
  ]);
});

test("mutator lists surviving mutants in changed files with file:line and the mutation", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    {
      "src/m.ts": [
        "export function f(a: number) {",
        "  return a > 1; // mut > >= survived",
        "}",
        "export const g = (b?: number) => b ?? 0; // mut ?? || killed",
        "",
      ].join("\n"),
    },
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const mutator = toolSection(run.facts, "mutator");
  const survivors = [...mutator.matchAll(/^- (\S+) `(.+)` → `(.+)`/gm)].map((m) => m.slice(1));
  assert.deepEqual(survivors, [["src/m.ts:2", ">", ">="]], mutator);
});

test("changed files under directories the tools skip, such as dist/, are not scored", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    {
      "dist/bundle.cjs": "// crap bundled 30 0\nfunction bundled() {}\n",
      "src/own.ts": "// crap own 30 0\nfunction own() {}\n",
    },
  );
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  const crapper = toolSection(run.facts, "crapper");
  assert.match(crapper, /`own`/);
  assert.doesNotMatch(crapper, /bundled/);
});

test("the before-state is the branch point, so a function base renamed later is not new", () => {
  const before = "// crap old 12 0\nfunction old() {}\n// crap edited 2 1\nfunction edited() {}\n";
  const repo = makeRepo(
    { "package.json": PKG, "src/a.ts": before },
    { "src/a.ts": before.replace("function edited() {}", "function edited() { /* x */ }") },
  );
  git(repo, ["checkout", "-q", "main"]);
  write(repo, "src/a.ts", before.replace(/old/g, "renamedOnMain"));
  commitAll(repo, "rename on main");
  git(repo, ["checkout", "-q", "feat"]);
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);

  const run = runMetrics(repo, home, { binDir: fakeBin() });

  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(toolSection(run.facts, "crapper"), /`old`/);
});

/** A project python: logs each coverage command, the module and its args, however it is started. */
const FAKE_COVERAGE_PYTHON = `#!/bin/sh
case "$2" in *"import pytest_cov"|*"import xdist") exit 1 ;; esac
case "$1" in -m) shift ;; -c) shift 2 ;; esac
case "$1" in coverage) printf '%s\\t%s\\n' "$*" "$PWD" >> "$(dirname "$0")/../coverage-calls.tsv" ;; esac
case "$*" in "coverage lcov "*) mkdir -p target/coverage/python && echo TN: > target/coverage/python/lcov.info ;; esac
exit 0
`;

const PROVIDER = {
  "package.json": JSON.stringify({ name: "@vitest/coverage-v8", main: "index.js" }),
  "index.js": "",
};

const COVERED_CASES: {
  name: string;
  files: Record<string, string>;
  local: Record<string, string>;
  argv: (repo: string) => [string, string, string][];
  pythonCoverage?: (repo: string) => [string, string][];
  /** The coverage command as the facts file prints it, when a case pins it. */
  label?: string;
}[] = [
  {
    name: "a vitest package with @vitest/coverage-v8",
    files: {
      "package.json": JSON.stringify({
        scripts: { test: "vitest" },
        devDependencies: { vitest: "1" },
      }),
      "src/v.ts": "// crap v 2 1\nfunction v() {}\n",
    },
    local: Object.fromEntries(
      Object.entries(PROVIDER).map(([f, t]) => [`node_modules/@vitest/coverage-v8/${f}`, t]),
    ),
    argv: (repo) => [
      [
        "npm",
        "exec vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory=target/coverage/typescript",
        repo,
      ],
    ],
  },
  {
    name: "a workspace package whose @vitest/coverage-v8 is installed at the root",
    files: {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/w/package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      "packages/w/src/w.ts": "// crap w 2 1\nfunction w() {}\n",
    },
    local: Object.fromEntries(
      Object.entries(PROVIDER).map(([f, t]) => [`node_modules/@vitest/coverage-v8/${f}`, t]),
    ),
    argv: (repo) => [
      [
        "pnpm",
        "exec vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory=target/coverage/typescript",
        path.join(repo, "packages/w"),
      ],
    ],
  },
  {
    name: "a Python package with coverage",
    files: { "pyproject.toml": "[project]\nname = 'p'\n", "src/p.py": "# // crap p 2 1\n" },
    local: { ".venv/bin/python": FAKE_COVERAGE_PYTHON },
    argv: () => [],
    pythonCoverage: (repo) => [
      ["coverage run --data-file=target/coverage/python/.coverage -m pytest", repo],
      [
        "coverage lcov --data-file=target/coverage/python/.coverage -o target/coverage/python/lcov.info",
        repo,
      ],
    ],
    label:
      "python -m coverage run --data-file=target/coverage/python/.coverage -m pytest && python -m coverage lcov --data-file=target/coverage/python/.coverage -o target/coverage/python/lcov.info",
  },
];

for (const c of COVERED_CASES) {
  test(`${c.name} is scored with coverage`, () => {
    const base = Object.fromEntries(Object.entries(c.files).filter(([f]) => !f.includes("src/")));
    const change = Object.fromEntries(Object.entries(c.files).filter(([f]) => f.includes("src/")));
    const repo = makeRepo(base, change);
    writeFileSync(path.join(repo, ".git/info/exclude"), "node_modules/\n.venv/\n");
    for (const [rel, text] of Object.entries(c.local)) writeExecutable(path.join(repo, rel), text);
    const home = tempDir("harry-metrics-home-");
    installCrapper(home);
    const bin = fakeBin();

    const run = runMetrics(repo, home, { binDir: bin });

    assert.equal(run.status, 0, run.stderr);
    assert.match(toolSection(run.facts, "crapper"), /— coverage: /, run.facts);
    if (c.label) assert.ok(run.facts.includes(`— coverage: ${c.label}\n`), run.facts);
    assert.deepEqual(checkoutModes(home, repo), ["--use-existing-coverage"]);
    assert.deepEqual(
      pmCalls(bin).map((p) => [p.bin, p.args.join(" "), p.cwd]),
      c.argv(repo),
    );
    const log = path.join(repo, ".venv/coverage-calls.tsv");
    const pythonCalls = existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((l) => l.split("\t"))
      : [];
    assert.deepEqual(pythonCalls, c.pythonCoverage?.(repo) ?? []);
  });
}

test("a tool failure keeps stderr's tail beside a long stdout's", () => {
  const stdout = Array.from({ length: 20 }, (_, i) => `site ${i + 1}`).join("\n");
  const tail = failureTail({ status: 1, stdout, stderr: "Skipping test file src/b.ts\n" });
  assert.match(tail, /Skipping test file src\/b\.ts/);
  assert.match(tail, /site 20$/);
});

test("a tracked symlink is not handed to mutator's scan", () => {
  const repo = makeRepo(
    { "package.json": PKG },
    { "src/a.ts": "export const a = 1; // mut 1 0 killed\n" },
  );
  symlinkSync("a.ts", path.join(repo, "src/link.ts"));
  commitAll(repo, "link");
  const home = mutatorHome();

  const plan = runPlan(repo, home, fakeBin());

  assert.equal(plan.status, 0, plan.stderr);
  const scans = calls(home, "mutator").filter((c) => c.args.includes("--scan"));
  assert.ok(scans.length > 0);
  for (const scan of scans) assert.ok(!scan.args.includes("src/link.ts"), scan.args.join(" "));
  assert.match(
    plan.stdout,
    /^ {2}- src\/a\.ts: 1 on changed lines, 1 executed, 1 worker, 1 round, 2 check runs$/m,
    plan.stdout,
  );
});
