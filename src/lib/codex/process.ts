// Portions Copyright 2026 OpenAI, licensed under Apache-2.0.
// Modified from codex-plugin-cc (broker transport removed; ported to TypeScript).
// See NOTICE.

import { spawnSync } from "node:child_process";
import process from "node:process";

interface CommandResult {
  command: string;
  args: string[];
  status: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: (Error & { code?: string }) | null;
}

function runCommand(
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32" ? process.env.SHELL || true : false,
    windowsHide: true
  });

  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: (result.error as (Error & { code?: string }) | undefined) ?? null
  };
}

export function binaryAvailable(
  bin: string,
  args: string[] = ["--version"],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): { available: boolean; detail: string } {
  const result = runCommand(bin, args, opts);
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}

function looksLikeMissingProcessMessage(text: string): boolean {
  return /not found|no running instance|cannot find|does not exist|no such process/i.test(text);
}

export function terminateProcessTree(pid: number): void {
  if (!Number.isFinite(pid)) {
    return;
  }

  if (process.platform === "win32") {
    const result = runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);

    if (!result.error && result.status === 0) {
      return;
    }

    const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
    if (!result.error && looksLikeMissingProcessMessage(combinedOutput)) {
      return;
    }

    if (result.error?.code === "ENOENT") {
      try {
        process.kill(pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ESRCH") {
          return;
        }
        throw error;
      }
      return;
    }

    if (result.error) {
      throw result.error;
    }
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Group kill failed — the child is not a process-group leader (spawned
    // without detached:true), so the group does not exist (ESRCH) or is not
    // ours. Fall back to signalling the single pid directly; previously an ESRCH
    // here silently no-op'd and the child was never reaped.
    try {
      process.kill(pid, "SIGTERM");
    } catch (innerError) {
      if ((innerError as NodeJS.ErrnoException)?.code !== "ESRCH") {
        throw innerError;
      }
    }
  }
}
