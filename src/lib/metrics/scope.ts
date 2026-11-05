import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { gitChecked } from "../git.ts";
import { resolveOnPath } from "../path-search.ts";
import { throwIfInterrupted } from "./interrupt.ts";

const SOURCE_EXTENSIONS = new Set([
  ".clj",
  ".cljc",
  ".cljs",
  ".bb",
  ".java",
  ".go",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".py",
]);
const TEST_DIRS = new Set(["test", "tests", "spec", "specs", "__tests__"]);
const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".venv",
  "venv",
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  ".metrics",
  "testdata",
  "__pycache__",
  ".clj-kondo",
]);
const TEST_SUFFIX =
  /(_test\.(go|clj|cljc|cljs|bb|py)|\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs))$/;

/** What the tools' own tree walk would pick: they skip these when walking, not when handed a path. */
export function isSourceFile(rel: string): boolean {
  const name = path.posix.basename(rel);
  if (name.endsWith(".d.ts")) return false;
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(name))) return false;
  if (TEST_SUFFIX.test(name) || name === "conftest.py") return false;
  if (name.startsWith("test_") && name.endsWith(".py")) return false;
  return !rel.split("/").some((part) => TEST_DIRS.has(part) || SKIP_DIRS.has(part));
}

function lines(text: string): string[] {
  return text.split("\n").filter(Boolean);
}

export function changedSourceFiles(root: string, base: string): string[] {
  const diff = gitChecked(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=AM",
    `${base}...HEAD`,
  ]);
  return lines(diff.stdout).filter(isSourceFile).sort();
}

export function trackedSourceFiles(root: string): string[] {
  return lines(gitChecked(root, ["ls-files"]).stdout)
    .filter(isSourceFile)
    .sort();
}

export function withSnapshot<T>(root: string, ref: string, fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harry-metrics-snap-"));
  try {
    const tar = path.join(dir, "..", `${path.basename(dir)}.tar`);
    try {
      gitChecked(root, ["archive", "--format=tar", "-o", tar, ref]);
      const tarBin = resolveOnPath("tar", process.env);
      if (tarBin === null) throw new Error("tar is not on PATH");
      const res = spawnSync(tarBin, ["-xf", tar, "-C", dir], { encoding: "utf8" });
      throwIfInterrupted(res);
      if (res.status !== 0) throw new Error(`tar -xf failed: ${res.stderr.trim()}`);
    } finally {
      rmSync(tar, { force: true });
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
