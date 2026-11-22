import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  type NotReady,
  PINNED_TOOLS,
  toolClone,
  toolLauncher,
  toolReadiness,
  venvPython,
} from "../../../scripts/lib/tools.mjs";
import { git } from "../git.ts";
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

function toolPaths(name: ToolName): { dir: string; launcher: string; python: string } {
  const dir = toolClone(name);
  return { dir, launcher: toolLauncher(dir, name), python: venvPython(dir) };
}

/** A tool that cannot run, with the reason the facts file prints for it. */
export interface Missing {
  missing: string;
}

export function isMissing(tool: Tool | Missing): tool is Missing {
  return "missing" in tool;
}

const NOT_INSTALLED: Record<NotReady["kind"], (at: string, dist: string) => string> = {
  launcher: (at) => `expected at ${at}; \`/harry:sync --tools\` installs it`,
  python: (at) =>
    `no venv Python at ${at}; \`/harry:sync --tools\` builds it, or run the launcher once by hand when sync leaves the clone as is`,
  package: (at, dist) =>
    `venv at ${at} lacks the ${dist} package; \`/harry:sync --tools\` rebuilds it, or remove that .venv and run the launcher once by hand when sync leaves the clone as is`,
};

// A launcher run with no venv Python builds the venv; only sync may do that, since
// only sync can repair a build that fails halfway. A venv without the tool's package
// is such a half-built one: the launcher would run and fail on it. toolReadiness, the
// check sync also applies, decides the reason, so the facts file names the check that failed.
export function findTool(name: ToolName): Tool | Missing {
  const { dir, launcher, python } = toolPaths(name);
  const pin = PINNED_TOOLS.find((t) => t.name === name);
  if (!pin) throw new Error(`no pin for tool ${name}`);
  const notReady = toolReadiness(dir, pin);
  if (notReady) {
    return {
      missing: `not installed (${NOT_INSTALLED[notReady.kind](displayPath(notReady.path), pin.dist)})`,
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
