import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { toolsDir } from "../../../scripts/lib/tools.mjs";
import { git } from "../git.ts";
import { isExecutableFile } from "../path-search.ts";
import { throwIfInterrupted } from "./interrupt.ts";

export { toolsDir };

export const TOOL_NAMES = ["dryer", "crapper", "mutator"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface Tool {
  name: ToolName;
  dir: string;
  launcher: string;
  commit: string;
}

export function displayPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

export function findTool(name: ToolName): Tool | null {
  const dir = path.join(toolsDir(), name);
  const launcher = path.join(dir, name);
  if (!isExecutableFile(launcher)) return null;
  const head = git(dir, ["rev-parse", "HEAD"]);
  const commit = head.status === 0 ? head.stdout.trim() : "unknown";
  return { name, dir, launcher, commit };
}

export interface ToolRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runTool(tool: Tool, args: string[], cwd: string): ToolRun {
  const res = spawnSync(tool.launcher, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  throwIfInterrupted(res);
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

export function failureTail(run: ToolRun): string {
  const lines = `${run.stderr}\n${run.stdout}`.trim().split("\n");
  return lines.slice(-12).join("\n");
}
