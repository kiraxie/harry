/**
 * `companion metrics` end to end: the real CLI in temp git repos, with HOME
 * pointed at a temp dir so ~/.claude/harry/tools/<tool>/<tool> holds stub
 * tools that record their argv and write fixture snapshots.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { headingSection } from "./section.ts";

const CLI = path.resolve(import.meta.dirname, "../src/companion.ts");

const cleanup: string[] = [];
test.after(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(d);
  return d;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(root: string, rel: string, text: string): void {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function commitAll(repo: string, message: string): void {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
}

/** A repo whose `main` holds `base` and whose `feat` branch adds `change` on top. */
function makeRepo(base: Record<string, string>, change: Record<string, string>): string {
  const repo = tempDir("harry-metrics-repo-");
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  for (const [rel, text] of Object.entries({ "README.md": "x\n", ...base })) write(repo, rel, text);
  commitAll(repo, "base");
  git(repo, ["checkout", "-q", "-b", "feat"]);
  for (const [rel, text] of Object.entries(change)) write(repo, rel, text);
  commitAll(repo, "change");
  return repo;
}

function status(repo: string): string {
  return git(repo, ["status", "--porcelain", "-uall"]);
}

interface Run {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  facts: string;
}

interface RunOptions {
  extra?: string[];
  binDir?: string;
  env?: Record<string, string>;
  detached?: boolean;
}

function runMetrics(repo: string, home: string, opts: RunOptions = {}): Run {
  const out = path.join(tempDir("harry-metrics-out-"), "facts.md");
  const PATH = opts.binDir ? `${opts.binDir}:${process.env.PATH}` : process.env.PATH;
  // spawnSync honors `detached` (a new process group, so a stub's group signal
  // spares the test runner) though its types leave it out.
  const options = {
    cwd: repo,
    encoding: "utf8" as const,
    env: { ...process.env, HOME: home, PATH, ...opts.env },
    detached: opts.detached ?? false,
  };
  const res = spawnSync(
    process.execPath,
    [CLI, "metrics", "--base", "main", "--out", out, ...(opts.extra ?? [])],
    options,
  );
  return {
    status: res.status,
    signal: res.signal,
    stdout: res.stdout,
    stderr: res.stderr,
    facts: existsSync(out) ? readFileSync(out, "utf8") : "",
  };
}

const STUB_PRELUDE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const cwd = process.cwd();
const argAfter = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const root = argAfter("--root") ?? cwd;
fs.appendFileSync(path.join(__dirname, "calls.jsonl"), JSON.stringify({ args, cwd }) + "\\n");
const out = (rel, text) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const walk = (dir, rel = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === ".git" || e.name === ".metrics") return [];
  const r = rel ? rel + "/" + e.name : e.name;
  return e.isDirectory() ? walk(path.join(dir, e.name), r) : [r];
});
`;

/** Every real tool is `python -m`/`-c`, which puts cwd first on sys.path: a stdlib-named file there shadows the import. */
const PYTHON_STARTUP = `
if (fs.existsSync(path.join(cwd, "json.py"))) {
  process.stderr.write("ImportError: json shadowed by " + path.join(cwd, "json.py") + "\\n");
  process.exit(1);
}
`;

function writeExecutable(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

/**
 * Installs a stub `name` under HOME's tool dir: STUB_PRELUDE, then `body`, in a
 * one-commit repo; `extra` maps tool-relative paths to more stub bodies.
 */
function installStub(
  home: string,
  name: string,
  body: string,
  extra: Record<string, string> = {},
): string {
  const dir = path.join(home, ".claude", "harry", "tools", name);
  writeExecutable(path.join(dir, name), `${STUB_PRELUDE}${PYTHON_STARTUP}\n${body}\n`);
  for (const [rel, text] of Object.entries(extra)) {
    writeExecutable(path.join(dir, rel), `${STUB_PRELUDE}${PYTHON_STARTUP}\n${text}\n`);
  }
  writeFileSync(path.join(dir, ".gitignore"), "calls.jsonl\n");
  git(dir, ["init", "-q"]);
  git(dir, ["-c", "user.email=t@e", "-c", "user.name=t", "add", "-A"]);
  git(dir, ["-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "-m", "stub"]);
  return git(dir, ["rev-parse", "HEAD"]);
}

function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function calls(home: string, name: string): { args: string[]; cwd: string }[] {
  const file = path.join(home, ".claude", "harry", "tools", name, "calls.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

const DRYER_ALL_PAIRS = `
const files = walk(root).filter((f) => f.endsWith(".ts")).sort();
const spans = (f) => '{:file "' + f + '", :start-line 1, :end-line 9}';
const rows = [];
for (let i = 0; i < files.length; i++)
  for (let j = i + 1; j < files.length; j++)
    rows.push('{:score 0.9 :language "typescript" :left ' + spans(files[i]) + ' :right ' + spans(files[j]) + ' :left-nodes 30 :right-nodes 30}');
out(".metrics/dry.edn", "{:candidates [" + rows.join("\\n") + "]}\\n");
`;

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
    assert.match(run.facts, new RegExp(`## ${tool}\\n+not installed`), run.facts);
  }
  assert.equal(status(repo), before);
});

/**
 * Stub crapper: scores each `// crap <name> <cc> <coverage 0..1>` marker in the
 * files it is handed, relative to --root, and writes crap.edn the way the real
 * tool does (nil coverage and CRAP under --no-coverage).
 */
const CRAPPER_FROM_MARKERS = `
const scored = !args.includes("--no-coverage");
const given = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--root");
const files = given.length > 0 ? given : walk(root).filter((f) => /.(ts|py)$/.test(f));
const rows = [];
for (const f of files) {
  const text = fs.readFileSync(path.resolve(root, f), "utf8");
  const ns = path.basename(f).replace(/\\.[^.]+$/, "");
  for (const m of text.matchAll(/\\/\\/ crap (\\S+) (\\d+) ([\\d.]+)/g)) {
    const cc = Number(m[2]);
    const c = Number(m[3]);
    const cov = scored ? String(c * 100) : "nil";
    const crap = scored ? String(cc * cc * (1 - c) ** 3 + cc) : "nil";
    rows.push('{:name "' + m[1] + '", :namespace "' + ns + '", :complexity ' + cc + ', :coverage ' + cov + ', :crap ' + crap + '}');
  }
}
fs.mkdirSync(path.join(root, ".metrics"), { recursive: true });
fs.writeFileSync(path.join(root, ".metrics", "crap.edn"), "{:entries [" + rows.join("\\n") + "]}\\n");
`;

/** Stub of crapper's venv python: a function spans from the line after its marker to the line before the next one. */
const SPANS_FROM_MARKERS = `
const [, , spansRoot, ...files] = args;
const spans = [];
for (const f of files) {
  const lines = fs.readFileSync(path.resolve(spansRoot, f), "utf8").split("\\n");
  const marks = [];
  lines.forEach((l, i) => {
    const m = l.match(/\\/\\/ crap (\\S+)/);
    if (m) marks.push([i, m[1]]);
  });
  const ns = path.basename(f).replace(/\\.[^.]+$/, "");
  marks.forEach(([i, name], k) => {
    const end = k + 1 < marks.length ? marks[k + 1][0] : lines.length;
    spans.push({ file: f, namespace: ns, name, start: i + 2, end });
  });
}
process.stdout.write(JSON.stringify(spans));
`;

function installCrapper(home: string): string {
  return installStub(home, "crapper", CRAPPER_FROM_MARKERS, {
    ".venv/bin/python": SPANS_FROM_MARKERS,
  });
}

/**
 * Fake npm/pnpm/yarn/npx on PATH: each logs its argv and cwd, and a coverage
 * run writes an lcov.info where that command would (unless FAKE_NO_REPORT=1).
 */
function fakeBin(): string {
  const dir = tempDir("harry-metrics-bin-");
  const body = `
fs.appendFileSync(path.join(__dirname, "pm.jsonl"), JSON.stringify({ bin: path.basename(__filename), args, cwd }) + "\\n");
const lcov = (d) => { if (process.env.FAKE_NO_REPORT !== "1") out(path.join(d, "lcov.info"), "TN:\\nend_of_record\\n"); };
const reports = argAfter("--reports-dir");
if (reports) lcov(reports);
const vitest = args.find((a) => a.startsWith("--coverage.reportsDirectory="));
if (vitest) lcov(vitest.split("=")[1]);
if (args[0] === "run" && args[1] === "coverage") lcov("coverage");
process.exit(Number(process.env.FAKE_EXIT ?? 0));
`;
  for (const bin of ["npm", "pnpm", "yarn", "npx"]) {
    writeExecutable(
      path.join(dir, bin),
      `${STUB_PRELUDE.replace(/^.*calls\.jsonl.*$/m, "")}\n${body}`,
    );
  }
  return dir;
}

function pmCalls(binDir: string): { bin: string; args: string[]; cwd: string }[] {
  const file = path.join(binDir, "pm.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

function toolSection(facts: string, tool: string): string {
  return headingSection(facts, "facts file", new RegExp(`## ${tool}\\b`)).replace(/^## \S+/, "");
}

const PKG = JSON.stringify({
  name: "p",
  scripts: { test: "node --test", coverage: "c8 node --test" },
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

const FAKE_VENV_PYTHON = `#!/bin/sh
echo "$@" >> "$(dirname "$0")/py.log"
case "$2" in "import coverage") exit 1 ;; esac
exit 0
`;

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

/**
 * Stub mutator: each `// mut <original> <mutant> <killed|survived>` line in a
 * handed file becomes one outcome, keyed the real way (byte span of the token).
 */
const MUTATOR_FROM_MARKERS = `
const skip = new Set(["--root", "--test-command", "--max-workers"]);
const files = args.filter((a, i) => !a.startsWith("--") && !skip.has(args[i - 1]));
let survived = false;
for (const f of files) {
  const buf = fs.readFileSync(path.resolve(root, f));
  const text = buf.toString("utf8");
  const ns = path.basename(f).replace(/\\.[^.]+$/, "");
  const outcomes = [];
  for (const m of text.matchAll(/\\/\\/ mut (\\S+) (\\S+) (killed|survived)/g)) {
    const start = Buffer.byteLength(text.slice(0, m.index));
    const id = JSON.stringify([f, ns, "defn/fn", start, start + m[1].length, m[1], m[2]]);
    outcomes.push(JSON.stringify(id) + " :" + m[3]);
    if (m[3] === "survived") survived = true;
  }
  out(path.join(".metrics/mutate", ns + ".edn"),
    '{:version 1 :source "' + f + '" :namespace "' + ns + '" :outcomes {' + outcomes.join(" ") + '} :forms []}\\n');
}
process.exit(survived ? 3 : 0);
`;

test("in a pnpm repo, coverage and mutator run per nearest package.json with pnpm", () => {
  const repo = makeRepo(
    {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/x/package.json": JSON.stringify({ scripts: { test: "node --test" } }),
      "packages/y/package.json": PKG,
    },
    {
      "packages/x/src/x.ts": "// crap x 2 1\nfunction x() {}\n",
      "packages/y/src/y.ts": "// crap y 2 1\nfunction y() {}\n",
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
      ["npx", "--yes c8 --reporter=lcov --reports-dir target/coverage/typescript pnpm test", px],
      ["pnpm", "run coverage", py],
    ],
  );
  const mut = calls(home, "mutator").map((c) => [
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

function runAudit(repo: string, home: string, binDir: string, extra: string[] = []) {
  const out = path.join(tempDir("harry-metrics-audit-"), "substrate");
  const res = spawnSync(process.execPath, [CLI, "metrics", "--audit", "--out", out, ...extra], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}` },
  });
  return { status: res.status, stderr: res.stderr, out };
}

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

const FAKE_COVERAGE_PYTHON = `#!/bin/sh
case "$*" in *"-m coverage "*) printf '%s\\t%s\\n' "$*" "$PWD" >> "$(dirname "$0")/../coverage-calls.tsv" ;; esac
case "$*" in *"coverage lcov -o "*) mkdir -p target/coverage/python && echo TN: > target/coverage/python/lcov.info ;; esac
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
      ["-m coverage run -m pytest", repo],
      ["-m coverage lcov -o target/coverage/python/lcov.info", repo],
    ],
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
