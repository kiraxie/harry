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
  readdirSync,
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

import { runCost } from "../src/lib/metrics/mutator.ts";
import { failureTail } from "../src/lib/metrics/tools.ts";
import { headingSection, outline } from "./section.ts";

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
const argv = process.argv.slice(2);
// A venv python stub takes -P as python does: off its argv, recorded.
const args = argv[0] === "-P" ? argv.slice(1) : argv;
const cwd = process.cwd();
const argAfter = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const root = argAfter("--root") ?? cwd;
fs.appendFileSync(path.join(__dirname, "calls.jsonl"), JSON.stringify({ args, argv, cwd, entries: fs.readdirSync(cwd) }) + "\\n");
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

/** Exit-0 answers that carry no verdict, by the name a `// overlay prints <name>` marker gives. */
const BAD_ANSWERS: Record<string, string> = {
  empty: "",
  "non-json": "Traceback (most recent call last)\n",
  "unknown-baseline": '{"baseline": "maybe", "canary": "fail", "tail": ""}\n',
  "unknown-canary": '{"baseline": "pass", "canary": "", "tail": ""}\n',
  "no-tail": '{"baseline": "pass", "canary": "fail"}\n',
  null: "null\n",
};

/**
 * Stub of mutator's venv python running the overlay check: a handed file marked
 * `// overlay baseline-fail` fails the worker baseline, `// overlay unseen` leaves
 * the canary green, `// overlay crash` exits 1 printing nothing,
 * `// overlay interrupt` sends SIGINT to its process group, and
 * `// overlay prints <name>` exits 0 printing BAD_ANSWERS[name]; any other passes.
 */
const OVERLAY_FROM_MARKERS = `
const BAD_ANSWERS = ${JSON.stringify(BAD_ANSWERS)};
const [, groupRoot, file] = args;
const text = fs.readFileSync(path.resolve(groupRoot, file), "utf8");
if (text.includes("// overlay interrupt")) { process.kill(0, "SIGINT"); setTimeout(() => {}, 5000); return; }
if (text.includes("// overlay crash")) { process.stderr.write("Traceback: overlay boom\\n"); process.exit(1); }
const bad = text.match(/\\/\\/ overlay prints (\\S+)/);
if (bad) { process.stdout.write(BAD_ANSWERS[bad[1]]); process.exit(0); }
const answer = text.includes("// overlay baseline-fail")
  ? { baseline: "fail", canary: "fail", tail: "not ok 1 - reads dist/x.txt\\nENOENT: dist/x.txt" }
  : text.includes("// overlay unseen")
    ? { baseline: "pass", canary: "pass", tail: "" }
    : { baseline: "pass", canary: "fail", tail: "Error: harry-overlay-canary" };
process.stdout.write(JSON.stringify(answer) + "\\n");
`;

function writeExecutable(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

/** Where pip leaves an installed `name` package's metadata in a tool's venv. */
function distInfo(name: string): string {
  return `.venv/lib/python3.13/site-packages/${name}-0.1.0.dist-info`;
}

/**
 * Installs a stub `name` under HOME's tool dir: STUB_PRELUDE, then `body`, in a
 * one-commit repo with a built venv holding its package and pip's; `extra` maps tool-relative paths to more stub bodies.
 */
function installStub(
  home: string,
  name: string,
  body: string,
  extra: Record<string, string> = {},
): string {
  const dir = path.join(home, ".claude", "harry", "tools", name);
  writeExecutable(path.join(dir, name), `${STUB_PRELUDE}${PYTHON_STARTUP}\n${body}\n`);
  writeExecutable(
    path.join(dir, ".venv/bin/python"),
    name === "mutator" ? `${STUB_PRELUDE}\n${OVERLAY_FROM_MARKERS}\n` : "#!/bin/sh\n",
  );
  mkdirSync(path.join(dir, distInfo(name)), { recursive: true });
  mkdirSync(path.join(dir, ".venv/lib/python3.13/site-packages/pip-25.0.dist-info"));
  for (const [rel, text] of Object.entries(extra)) {
    writeExecutable(path.join(dir, rel), `${STUB_PRELUDE}${PYTHON_STARTUP}\n${text}\n`);
  }
  writeFileSync(path.join(dir, ".gitignore"), "calls.jsonl\n.venv/\n");
  git(dir, ["init", "-q"]);
  git(dir, ["-c", "user.email=t@e", "-c", "user.name=t", "add", "-A"]);
  git(dir, ["-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "-m", "stub"]);
  return git(dir, ["rev-parse", "HEAD"]);
}

function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

interface StubCall {
  args: string[];
  /** The argv as spawned, before a python stub takes a leading -P off. */
  argv: string[];
  cwd: string;
  /** The cwd's entries when the stub started. */
  entries: string[];
}

function calls(home: string, name: string, rel = ""): StubCall[] {
  const file = path.join(home, ".claude", "harry", "tools", name, rel, "calls.jsonl");
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
case "$2" in *"import coverage") exit 1 ;; esac
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
 * Stub mutator: each `// mut <original> <mutant> <killed|survived|uncovered>` marker
 * in a handed file is one site on the marker's line, keyed the real way (byte span
 * of the token). Like the real tool, `--lines` keeps only sites on those line
 * numbers in every handed file, `--scan` lists the sites in the real format and
 * writes nothing, and an uncovered site gets no outcome under existing coverage.
 */
const MUTATOR_FROM_MARKERS = `
const skip = new Set(["--root", "--test-command", "--max-workers", "--lines"]);
const files = args.filter((a, i) => !a.startsWith("--") && !skip.has(args[i - 1]));
const only = argAfter("--lines") ? new Set(argAfter("--lines").split(",").map(Number)) : null;
const covered = args.includes("--use-existing-coverage");
let survived = false;
for (const f of files) {
  const text = fs.readFileSync(path.resolve(root, f), "utf8");
  const ns = path.basename(f).replace(/\\.[^.]+$/, "");
  const sites = [...text.matchAll(/\\/\\/ mut (\\S+) (\\S+) (killed|survived|uncovered)/g)]
    .map((m) => ({ m, line: text.slice(0, m.index).split("\\n").length }))
    .filter((s) => only === null || only.has(s.line));
  if (args.includes("--scan")) {
    process.stdout.write("Scan: " + sites.length + " mutation sites in " + f + "\\n");
    for (const { m, line } of sites) process.stdout.write("  " + f + ":" + line + " " + m[1] + " -> " + m[2] + "  [defn/fn]\\n");
    continue;
  }
  const outcomes = [];
  for (const { m } of sites) {
    if (m[3] === "uncovered" && covered) continue;
    const status = m[3] === "uncovered" ? "killed" : m[3];
    const start = Buffer.byteLength(text.slice(0, m.index));
    const id = JSON.stringify([f, ns, "defn/fn", start, start + m[1].length, m[1], m[2]]);
    outcomes.push(JSON.stringify(id) + " :" + status);
    if (status === "survived") survived = true;
  }
  out(path.join(".metrics/mutate", ns + ".edn"),
    '{:version 1 :source "' + f + '" :namespace "' + ns + '" :outcomes {' + outcomes.join(" ") + '} :forms []}\\n');
}
process.exit(survived ? 3 : 0);
`;

/** The stub mutator's runs that executed mutants, its scans left out. */
function mutatorRuns(home: string): { args: string[]; cwd: string }[] {
  return calls(home, "mutator").filter((c) => !c.args.includes("--scan"));
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

/** A project python: logs each coverage command, the module and its args, however it is started. */
const FAKE_COVERAGE_PYTHON = `#!/bin/sh
case "$1" in -m) shift ;; -c) shift 2 ;; esac
case "$1" in coverage) printf '%s\\t%s\\n' "$*" "$PWD" >> "$(dirname "$0")/../coverage-calls.tsv" ;; esac
case "$*" in "coverage lcov -o "*) mkdir -p target/coverage/python && echo TN: > target/coverage/python/lcov.info ;; esac
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
      ["coverage run -m pytest", repo],
      ["coverage lcov -o target/coverage/python/lcov.info", repo],
    ],
    label:
      "python -m coverage run -m pytest && python -m coverage lcov -o target/coverage/python/lcov.info",
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

// --- Unit mode: changed lines, plan, commands, scope ---

/**
 * `a.ts` changes line 5 and `b.ts` line 2. `b.ts`'s unchanged line 5 carries a
 * surviving mutant: `--lines 2,5` reaches it, as with the real tool, so only
 * harry's own changed-line filter keeps it out of the facts.
 */
function collisionRepo(): string {
  const lines = (marks: Record<number, string>) =>
    Array.from({ length: 6 }, (_, i) => `export const v${i + 1} = 1;${marks[i + 1] ?? ""}`).join(
      "\n",
    );
  return makeRepo(
    {
      "package.json": PKG,
      "src/a.ts": lines({}),
      "src/b.ts": lines({ 5: " // mut > >= survived" }),
    },
    {
      "src/a.ts": lines({ 5: " // mut 1 0 killed" }),
      "src/b.ts": lines({ 2: " // mut 1 0 killed", 5: " // mut > >= survived" }),
    },
  );
}

function mutatorHome(): string {
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);
  return home;
}

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

/** The overlay checks the stub venv python ran: script, group root, file, test command. */
function overlayChecks(home: string): string[][] {
  const file = path.join(home, ".claude", "harry", "tools", "mutator", ".venv/bin/calls.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).args);
}

/** The files a mutator run (not a scan) was handed. */
function mutatedFiles(home: string): string[][] {
  const flags = new Set(["--root", "--test-command", "--max-workers", "--lines"]);
  return mutatorRuns(home).map((c) =>
    c.args.filter((a, i) => !a.startsWith("--") && !flags.has(c.args[i - 1])),
  );
}

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

/**
 * Every plan runs on a 3-core machine whose `availableParallelism` says 5, so the
 * plan's numbers hold on any host and only the count mutator sizes workers by fits.
 */
const THREE_CORES = `data:text/javascript,import os from "node:os"; os.cpus = () => Array.from({ length: 3 }, () => ({})); os.availableParallelism = () => 5;`;

function runPlan(
  repo: string,
  home: string,
  binDir: string,
  extra: string[] = [],
  env: Record<string, string> = {},
) {
  const args = ["--import", THREE_CORES, CLI, "metrics", "--base", "main", "--plan", ...extra];
  return spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}`, ...env },
  });
}

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

/** The last line `--plan` prints. */
function lastLine(stdout: string): string {
  return stdout.trimEnd().split("\n").at(-1) ?? "";
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
  writeFileSync(path.join(repo, ".git/info/exclude"), ".venv/\ncoverage.py\nrunpy.py\n");
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
 * A `coverage` package that stands in for the real one: `lcov -o <file>` writes an empty
 * report; `run` imports `imports` first, as the tests it runs would.
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
      ...(imports === null ? [] : [`if args[:1] == ['run']:`, `    import ${imports}`]),
      "if args[:1] == ['lcov']:",
      "    out = args[args.index('-o') + 1]",
      "    os.makedirs(os.path.dirname(out), exist_ok=True)",
      "    open(out, 'w').write('TN:\\nend_of_record\\n')",
      "",
    ].join("\n"),
  );
  return dir;
}

test("the coverage run's target still imports a module from the group dir when PYTHONPATH names another dir", {
  skip: HOST_PYTHON === "" ? "no python3 on PATH" : false,
}, () => {
  const marker = path.join(tempDir("harry-metrics-marker-"), "imported");
  const repo = shadowedPythonRepo(marker);
  write(repo, "helpers.py", "");
  writeFileSync(
    path.join(repo, ".git/info/exclude"),
    ".venv/\ncoverage.py\nrunpy.py\nhelpers.py\ntarget/\n",
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
  writeFileSync(path.join(repo, ".git/info/exclude"), ".venv/\ncoverage.py\nrunpy.py\ntarget/\n");
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);

  const run = runMetrics(repo, home, { binDir: fakeBin(), env: { PYTHONPATH: coverageStandIn() } });

  assert.equal(run.status, 0, run.stderr);
  assert.match(toolSection(run.facts, "crapper"), /— coverage: python -m coverage run/, run.facts);
  assert.equal(existsSync(marker), false, "a coverage.py or runpy.py in the group dir ran");
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

/** Five new sites: two on line 1, two on line 2, one on line 3. */
function fiveSiteRepo(): string {
  return makeRepo(
    { "package.json": PKG },
    {
      "src/a.ts": [
        "export const a = 1 + 2; // mut 1 0 killed // mut + - killed",
        "export const b = 3 + 4; // mut 3 0 killed // mut + - survived",
        "export const c = 5; // mut 5 0 survived",
        "",
      ].join("\n"),
    },
  );
}

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
    /complexity only: coverage command `python -m coverage run -m pytest` exited 2/,
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
    /complexity only: coverage command `python -m coverage lcov -o target\/coverage\/python\/lcov\.info` exited 3/,
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
    `#!/bin/sh\ncase "$1" in -m) shift ;; -c) shift 2 ;; esac\ncase "$*" in "coverage lcov -o "*) mkdir -p target/coverage/python && echo TN: > target/coverage/python/lcov.info ;; esac\nexit 0\n`,
  );

  const run = runMetrics(repo, home, { binDir: bin });

  assert.equal(run.status, 0, run.stderr);
  assert.ok(
    run.facts.includes(
      "— coverage: python3 -m coverage run -m pytest && python3 -m coverage lcov -o target/coverage/python/lcov.info\n",
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
