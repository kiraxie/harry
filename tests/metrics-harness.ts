/**
 * `companion metrics` end to end: the real CLI in temp git repos, with HOME
 * pointed at a temp dir so ~/.claude/harry/tools/<tool>/<tool> holds stub
 * tools that record their argv and write fixture snapshots.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { headingSection } from "./section.ts";

// From the started test file, not this module: under --preserve-symlinks-main node keeps
// mutator's worker path for the entry file only, so import.meta.dirname here is the checkout's.
const CLI = path.resolve(path.dirname(process.argv[1]), "../src/companion.ts");

const cleanup: string[] = [];

test.after(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

export function tempDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(d);
  return d;
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function write(root: string, rel: string, text: string): void {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function commitAll(repo: string, message: string): void {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
}

/** A repo whose `main` holds `base` and whose `feat` branch adds `change` on top. */
export function makeRepo(base: Record<string, string>, change: Record<string, string>): string {
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

export function status(repo: string): string {
  return git(repo, ["status", "--porcelain", "-uall"]);
}

export interface Run {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  facts: string;
}

export interface RunOptions {
  extra?: string[];
  binDir?: string;
  env?: Record<string, string>;
  detached?: boolean;
}

export function runMetrics(repo: string, home: string, opts: RunOptions = {}): Run {
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
export const BAD_ANSWERS: Record<string, string> = {
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

export function writeExecutable(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

/** Where pip leaves an installed `name` package's metadata in a tool's venv. */
export function distInfo(name: string): string {
  return `.venv/lib/python3.13/site-packages/${name}-0.1.0.dist-info`;
}

/**
 * Installs a stub `name` under HOME's tool dir: STUB_PRELUDE, then `body`, in a
 * one-commit repo with a built venv holding its package and pip's; `extra` maps tool-relative paths to more stub bodies.
 */
export function installStub(
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

export function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export interface StubCall {
  args: string[];
  /** The argv as spawned, before a python stub takes a leading -P off. */
  argv: string[];
  cwd: string;
  /** The cwd's entries when the stub started. */
  entries: string[];
}

export function calls(home: string, name: string, rel = ""): StubCall[] {
  const file = path.join(home, ".claude", "harry", "tools", name, rel, "calls.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

export const DRYER_ALL_PAIRS = `
const files = walk(root).filter((f) => f.endsWith(".ts")).sort();
const spans = (f) => '{:file "' + f + '", :start-line 1, :end-line 9}';
const rows = [];
for (let i = 0; i < files.length; i++)
  for (let j = i + 1; j < files.length; j++)
    rows.push('{:score 0.9 :language "typescript" :left ' + spans(files[i]) + ' :right ' + spans(files[j]) + ' :left-nodes 30 :right-nodes 30}');
out(".metrics/dry.edn", "{:candidates [" + rows.join("\\n") + "]}\\n");
`;

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

export function installCrapper(home: string): string {
  return installStub(home, "crapper", CRAPPER_FROM_MARKERS, {
    ".venv/bin/python": SPANS_FROM_MARKERS,
  });
}

/**
 * Fake npm/pnpm/yarn/npx on PATH: each logs its argv and cwd, and a coverage
 * run writes an lcov.info where that command would (unless FAKE_NO_REPORT=1).
 */
export function fakeBin(): string {
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

export function pmCalls(binDir: string): { bin: string; args: string[]; cwd: string }[] {
  const file = path.join(binDir, "pm.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

export function toolSection(facts: string, tool: string): string {
  return headingSection(facts, "facts file", new RegExp(`## ${tool}\\b`)).replace(/^## \S+/, "");
}

export const PKG = JSON.stringify({
  name: "p",
  scripts: { test: "node --test", coverage: "c8 node --test" },
});

export const FAKE_VENV_PYTHON = `#!/bin/sh
echo "$@" >> "$(dirname "$0")/py.log"
case "$2" in *"import coverage") exit 1 ;; esac
exit 0
`;

/**
 * Stub mutator: each `// mut <original> <mutant> <killed|survived|uncovered>` marker
 * in a handed file is one site on the marker's line, keyed the real way (byte span
 * of the token). Like the real tool, `--lines` keeps only sites on those line
 * numbers in every handed file, `--scan` lists the sites in the real format and
 * writes nothing, and an uncovered site gets no outcome under existing coverage.
 * A run handed a file marked `// mutator interrupt` sends SIGINT to its process group.
 */
export const MUTATOR_FROM_MARKERS = `
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
  if (text.includes("// mutator interrupt")) { process.kill(0, "SIGINT"); setTimeout(() => {}, 5000); return; }
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
export function mutatorRuns(home: string): { args: string[]; cwd: string }[] {
  return calls(home, "mutator").filter((c) => !c.args.includes("--scan"));
}

export function runAudit(repo: string, home: string, binDir: string, extra: string[] = []) {
  const out = path.join(tempDir("harry-metrics-audit-"), "substrate");
  const res = spawnSync(process.execPath, [CLI, "metrics", "--audit", "--out", out, ...extra], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}` },
  });
  return { status: res.status, stderr: res.stderr, out };
}

/**
 * `a.ts` changes line 5 and `b.ts` line 2. `b.ts`'s unchanged line 5 carries a
 * surviving mutant: `--lines 2,5` reaches it, as with the real tool, so only
 * harry's own changed-line filter keeps it out of the facts.
 */
export function collisionRepo(): string {
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

export function mutatorHome(): string {
  const home = tempDir("harry-metrics-home-");
  installCrapper(home);
  installStub(home, "mutator", MUTATOR_FROM_MARKERS);
  return home;
}

/** The overlay checks the stub venv python ran: script, group root, file, test command. */
export function overlayChecks(home: string): string[][] {
  const file = path.join(home, ".claude", "harry", "tools", "mutator", ".venv/bin/calls.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).args);
}

/** The files a mutator run (not a scan) was handed. */
export function mutatedFiles(home: string): string[][] {
  const flags = new Set(["--root", "--test-command", "--max-workers", "--lines"]);
  return mutatorRuns(home).map((c) =>
    c.args.filter((a, i) => !a.startsWith("--") && !flags.has(c.args[i - 1])),
  );
}

/**
 * Every plan runs on a 3-core machine whose `availableParallelism` says 5, so the
 * plan's numbers hold on any host and only the count mutator sizes workers by fits.
 */
const THREE_CORES = `data:text/javascript,import os from "node:os"; os.cpus = () => Array.from({ length: 3 }, () => ({})); os.availableParallelism = () => 5;`;

export function runPlan(
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

/** The last line `--plan` prints. */
export function lastLine(stdout: string): string {
  return stdout.trimEnd().split("\n").at(-1) ?? "";
}

/** Five new sites: two on line 1, two on line 2, one on line 3. */
export function fiveSiteRepo(): string {
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
