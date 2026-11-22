import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { toolsDir, venvDir, venvInstalled, venvPython } from "../../../scripts/lib/tools.mjs";
import { git } from "../git.ts";
import { isExecutableFile } from "../path-search.ts";
import { throwIfInterrupted } from "./interrupt.ts";

export const TOOL_NAMES = ["dryer", "crapper", "mutator"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface Tool {
  name: ToolName;
  dir: string;
  launcher: string;
  python: string;
  commit: string;
}

export function displayPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

function toolPaths(name: ToolName): {
  dir: string;
  launcher: string;
  venv: string;
  python: string;
} {
  const dir = path.join(toolsDir(), name);
  return { dir, launcher: path.join(dir, name), venv: venvDir(dir), python: venvPython(dir) };
}

/** A tool that cannot run, with the reason the facts file prints for it. */
export interface Missing {
  missing: string;
}

export function isMissing(tool: Tool | Missing): tool is Missing {
  return "missing" in tool;
}

// A launcher run with no venv Python builds the venv; only sync may do that, since
// only sync can repair a build that fails halfway. A venv without the tool's package
// is such a half-built one: the launcher would run and fail on it. The reason is
// decided here, once, so the facts file names the check that actually failed.
export function findTool(name: ToolName): Tool | Missing {
  const { dir, launcher, venv, python } = toolPaths(name);
  if (!isExecutableFile(launcher)) {
    return {
      missing: `not installed (expected at ${displayPath(launcher)}; \`/harry:sync --tools\` installs it)`,
    };
  }
  if (!isExecutableFile(python)) {
    return {
      missing: `not installed (no venv Python at ${displayPath(python)}; \`/harry:sync --tools\` builds it, or run the launcher once by hand when sync leaves the clone as is)`,
    };
  }
  if (!venvInstalled(dir, name)) {
    return {
      missing: `not installed (venv at ${displayPath(venv)} lacks the ${name} package; \`/harry:sync --tools\` rebuilds it, or remove that .venv and run the launcher once by hand when sync leaves the clone as is)`,
    };
  }
  const head = git(dir, ["rev-parse", "HEAD"]);
  const commit = head.status === 0 ? head.stdout.trim() : "unknown";
  return { name, dir, launcher, python, commit };
}

export interface ToolRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Starts a tool from a fresh empty dir: `-m` and `-c` put the cwd first on sys.path, so
 * an empty one holds nothing to import, and every tool is handed the group's path as an
 * argument, so none reads its cwd.
 */
function spawnTool(bin: string, args: string[]): ToolRun {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "harry-tool-"));
  try {
    const res = spawnSync(bin, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    throwIfInterrupted(res);
    if (res.error) throw res.error;
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

export function runTool(tool: Tool, args: string[]): ToolRun {
  return spawnTool(tool.launcher, args);
}

/**
 * Runs the tool's venv python. `-P` keeps a script's own dir off sys.path too; the
 * launcher cannot take it, and PYTHONSAFEPATH would reach the project's tests mutator runs.
 */
export function runToolPython(tool: Tool, args: string[]): ToolRun {
  return spawnTool(tool.python, ["-P", ...args]);
}

/**
 * The last lines of a failed tool's stderr, then of its stdout, each tailed on its
 * own so a long stdout never pushes stderr's reason out.
 */
export function failureTail(run: ToolRun): string {
  const tail = (text: string) => text.trim().split("\n").slice(-12).join("\n");
  return [run.stderr, run.stdout]
    .map(tail)
    .filter((t) => t !== "")
    .join("\n");
}
