import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { resolveOnPath } from "../path-search.ts";
import { throwIfInterrupted } from "./interrupt.ts";

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
  return [...groups.values()].sort((a, b) => a.dir.localeCompare(b.dir));
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

export type CoveragePlan = { commands: string[][] } | { skip: string };

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

function nodePlan(groupDir: string, pm: PackageManager): CoveragePlan {
  const pkg = readPackage(groupDir);
  const scripts = pkg.scripts ?? {};
  if (scripts.coverage) return { commands: [[pm, "run", "coverage"]] };
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
      commands: [
        [
          pm,
          "exec",
          "vitest",
          "run",
          "--coverage",
          "--coverage.reporter=lcov",
          "--coverage.reportsDirectory=target/coverage/typescript",
        ],
      ],
    };
  }
  if (!scripts.test) return { skip: "package.json has no test script" };
  return {
    commands: [
      [
        "npx",
        "--yes",
        "c8",
        "--reporter=lcov",
        "--reports-dir",
        "target/coverage/typescript",
        pm,
        "test",
      ],
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

function canImport(python: string, module: string, cwd: string): boolean {
  const res = spawnSync(python, ["-c", `import ${module}`], { cwd });
  throwIfInterrupted(res);
  return res.status === 0;
}

function pythonPlan(groupDir: string): CoveragePlan {
  const py = pythonInterpreter(groupDir);
  if (py === null) return { skip: "no python3 on PATH" };
  if (!canImport(py, "coverage", groupDir)) {
    return { skip: `coverage is not installed in ${py}; install coverage there to score coverage` };
  }
  const runner = canImport(py, "pytest", groupDir) ? ["pytest"] : ["unittest", "discover"];
  return {
    commands: [
      [py, "-m", "coverage", "run", "-m", ...runner],
      [py, "-m", "coverage", "lcov", "-o", "target/coverage/python/lcov.info"],
    ],
  };
}

export function coveragePlan(root: string, group: Group): CoveragePlan {
  const dir = path.join(root, group.dir);
  if (group.kind === "node") return nodePlan(dir, packageManager(root));
  if (group.kind === "python") return pythonPlan(dir);
  return { skip: "metrics runs coverage for JavaScript/TypeScript and Python only" };
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

export function runCoverage(groupDir: string, commands: string[][]): string | null {
  for (const [bin, ...args] of commands) {
    const resolved = path.isAbsolute(bin) ? bin : resolveOnPath(bin, process.env);
    if (resolved === null) return `${bin} is not on PATH`;
    const res = spawnSync(resolved, args, { cwd: groupDir, stdio: "ignore" });
    throwIfInterrupted(res);
    if (res.status !== 0) {
      return `coverage command \`${[bin, ...args].join(" ")}\` exited ${res.status ?? "by signal"}`;
    }
  }
  if (!hasLcovReport(groupDir)) {
    return `coverage command \`${commands.map((c) => c.join(" ")).join(" && ")}\` produced no lcov.info`;
  }
  return null;
}

export function describe(commands: string[][]): string {
  return commands
    .map((c) => c.map((p) => (path.isAbsolute(p) ? path.basename(p) : p)).join(" "))
    .join(" && ");
}
