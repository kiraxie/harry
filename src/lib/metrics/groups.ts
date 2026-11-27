import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { resolveOnPath } from "../path-search.ts";
import { throwIfInterrupted } from "./interrupt.ts";
import { byPath } from "./scope.ts";

export type GroupKind = "node" | "python" | "other";

export interface Group {
  /** Repo-relative directory, "" for the repo root. */
  dir: string;
  kind: GroupKind;
  /** Group-relative source files. */
  files: string[];
}

const NODE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const PYTHON_MARKERS = ["pyproject.toml", "setup.cfg", "setup.py", "pytest.ini"];

function kindOf(rel: string): GroupKind {
  const ext = path.posix.extname(rel);
  if (NODE_EXT.has(ext)) return "node";
  if (ext === ".py") return "python";
  return "other";
}

function nearest(root: string, rel: string, markers: string[]): string {
  let dir = path.posix.dirname(rel);
  for (;;) {
    const here = dir === "." ? "" : dir;
    if (markers.some((m) => existsSync(path.join(root, here, m)))) return here;
    if (here === "") return "";
    dir = path.posix.dirname(dir);
  }
}

export function groupFiles(root: string, files: string[]): Group[] {
  const groups = new Map<string, Group>();
  for (const rel of files) {
    const kind = kindOf(rel);
    const dir =
      kind === "node"
        ? nearest(root, rel, ["package.json"])
        : kind === "python"
          ? nearest(root, rel, PYTHON_MARKERS)
          : "";
    const key = `${kind}\0${dir}`;
    const group = groups.get(key) ?? { dir, kind, files: [] };
    group.files.push(dir === "" ? rel : path.posix.relative(dir, rel));
    groups.set(key, group);
  }
  // By each group's path prefix, so groups list in the order the cap reaches their files.
  return [...groups.values()].sort((a, b) => byPath(repoPath(a, ""), repoPath(b, "")));
}

export function repoPath(group: Group, file: string): string {
  return group.dir === "" ? file : `${group.dir}/${file}`;
}

export type PackageManager = "pnpm" | "yarn" | "npm";

export function packageManager(root: string): PackageManager {
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

/** One coverage command, with the text a reader would type for it. */
export interface CoverageStep {
  argv: string[];
  label: string;
}

/** How a group's coverage report is made: steps with the label the facts print, or why not. */
export type CoveragePlan = { steps: CoverageStep[]; label: string } | { skip: string };

type OwnPlan = { steps: CoverageStep[] } | { skip: string };

/** A step labelled from `meaning`, the command as typed, which a wrapped `argv` departs from. */
function step(argv: string[], meaning: string[] = argv): CoverageStep {
  return { argv, label: meaning.map((p) => (path.isAbsolute(p) ? path.basename(p) : p)).join(" ") };
}

function readPackage(dir: string): {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function resolvesFrom(dir: string, request: string): boolean {
  try {
    createRequire(path.join(dir, "package.json")).resolve(request);
    return true;
  } catch {
    return false;
  }
}

function nodePlan(groupDir: string, pm: PackageManager): OwnPlan {
  const pkg = readPackage(groupDir);
  const scripts = pkg.scripts ?? {};
  if (scripts.coverage) return { steps: [step([pm, "run", "coverage"])] };
  const usesVitest =
    Boolean(pkg.dependencies?.vitest ?? pkg.devDependencies?.vitest) ||
    /\bvitest\b/.test(scripts.test ?? "");
  if (usesVitest) {
    if (!resolvesFrom(groupDir, "@vitest/coverage-v8/package.json")) {
      return {
        skip: "vitest without @vitest/coverage-v8 resolvable from this package; install it to score coverage",
      };
    }
    return {
      steps: [
        step([
          pm,
          "exec",
          "vitest",
          "run",
          "--coverage",
          "--coverage.reporter=lcov",
          "--coverage.reportsDirectory=target/coverage/typescript",
        ]),
      ],
    };
  }
  if (!scripts.test) return { skip: "package.json has no test script" };
  return {
    steps: [
      step([
        "npx",
        "--yes",
        "c8",
        "--reporter=lcov",
        "--reports-dir",
        "target/coverage/typescript",
        // c8's default extension list has no .mts or .cts, and the flag replaces it.
        ...[...NODE_EXT].flatMap((ext) => ["--extension", ext]),
        pm,
        "test",
      ]),
    ],
  };
}

export function pythonInterpreter(groupDir: string): string | null {
  for (const venv of [".venv", "venv"]) {
    const py = path.join(groupDir, venv, "bin", "python");
    if (existsSync(py)) return py;
  }
  return resolveOnPath("python3", process.env);
}

/**
 * Not `-P`: it is 3.11+, and a project's interpreter has no version floor; nor does it
 * stop PYTHONPATH (an empty component, `.`, the dir) or a `.pth` line from adding the
 * group dir back. The cwd stays, unlike a tool's: the interpreter is resolved from the
 * group dir (a venv, or a version-manager shim that picks by cwd).
 */
const OFF_GROUP_DIR =
  "import os, sys; here = os.path.realpath(os.getcwd()); sys.path = [p for p in sys.path if os.path.realpath(p or '.') != here]";

/**
 * OFF_GROUP_DIR holds only while the module is imported: its target (the project's tests)
 * needs the sys.path `python -m` gives, and coverage puts the cwd back only when sys.path[0]
 * is not a dir. `runpy` is imported before the restore, so a group-root `runpy.py` loses too.
 */
const RUN_MODULE = `import sys; kept = sys.path; ${OFF_GROUP_DIR}; import importlib, runpy; module = sys.argv[1]; importlib.import_module(module); sys.path = kept; sys.argv = sys.argv[1:]; runpy.run_module(module, run_name='__main__', alter_sys=True)`;

function pythonModule(python: string, module: string, args: string[]): CoverageStep {
  return step([python, "-c", RUN_MODULE, module, ...args], [python, "-m", module, ...args]);
}

function canImport(python: string, module: string, cwd: string): boolean {
  const res = spawnSync(python, ["-c", `${OFF_GROUP_DIR}; import ${module}`], { cwd });
  throwIfInterrupted(res);
  return res.status === 0;
}

const PYTHON_REPORT_DIR = "target/coverage/python";

/**
 * Plugins a project's addopts can turn on that leave coverage run with wrong data: pytest-cov
 * replaces its tracer, xdist runs the tests outside it. `-p` loads each first, since its flag
 * is unrecognized where the plugin is installed but not loaded (autoload off, `-p no:cov`).
 */
const PYTEST_PLUGINS_OFF: [string, string[]][] = [
  ["pytest_cov", ["--no-cov"]],
  ["xdist", ["-n", "0"]],
];

function pytestRunner(py: string, groupDir: string): string[] {
  return [
    "pytest",
    ...PYTEST_PLUGINS_OFF.filter(([plugin]) => canImport(py, plugin, groupDir)).flatMap(
      ([plugin, off]) => ["-p", plugin, ...off],
    ),
  ];
}

function pythonPlan(groupDir: string): OwnPlan {
  const py = pythonInterpreter(groupDir);
  if (py === null) return { skip: "no python3 on PATH" };
  if (!canImport(py, "coverage", groupDir)) {
    return { skip: `coverage is not installed in ${py}; install coverage there to score coverage` };
  }
  const runner = canImport(py, "pytest", groupDir)
    ? pytestRunner(py, groupDir)
    : ["unittest", "discover"];
  // A flag, not COVERAGE_FILE: the tests under the run inherit an env var, and with it
  // every other coverage instance they start would write to the same file.
  const data = `--data-file=${PYTHON_REPORT_DIR}/.coverage`;
  return {
    steps: [
      pythonModule(py, "coverage", ["run", data, "-m", ...runner]),
      pythonModule(py, "coverage", ["lcov", data, "-o", `${PYTHON_REPORT_DIR}/lcov.info`]),
    ],
  };
}

/**
 * The group's coverage plan. `override` is the user's `--coverage-command`: it
 * replaces the group's own plan, even one that would skip, and runs through the shell.
 */
export function coveragePlan(root: string, group: Group, override: string | null): CoveragePlan {
  const dir = path.join(root, group.dir);
  const own: OwnPlan =
    override !== null
      ? { steps: [{ argv: ["sh", "-c", override], label: override }] }
      : group.kind === "node"
        ? nodePlan(dir, packageManager(root))
        : group.kind === "python"
          ? pythonPlan(dir)
          : { skip: "metrics runs coverage for JavaScript/TypeScript and Python only" };
  return "skip" in own
    ? own
    : { steps: own.steps, label: own.steps.map((s) => s.label).join(" && ") };
}

function findLcov(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).some(
    (f) => path.basename(f) === "lcov.info",
  );
}

export function hasLcovReport(groupDir: string): boolean {
  return (
    findLcov(path.join(groupDir, "target", "coverage")) || findLcov(path.join(groupDir, "coverage"))
  );
}

/**
 * Runs the plan's commands in the group directory; null when they leave an
 * lcov.info, else why there is no report, naming the step that failed.
 */
export function runCoverage(
  groupDir: string,
  plan: { steps: CoverageStep[]; label: string },
): string | null {
  for (const { argv, label } of plan.steps) {
    const [bin, ...args] = argv;
    const resolved = path.isAbsolute(bin) ? bin : resolveOnPath(bin, process.env);
    if (resolved === null) return `${bin} is not on PATH`;
    const res = spawnSync(resolved, args, { cwd: groupDir, stdio: "ignore" });
    throwIfInterrupted(res);
    if (res.status !== 0)
      return `coverage command \`${label}\` exited ${res.status ?? "by signal"}`;
  }
  if (!hasLcovReport(groupDir)) return `coverage command \`${plan.label}\` produced no lcov.info`;
  return null;
}
