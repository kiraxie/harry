/**
 * Reaper for background workers that died without persisting failure
 * (SIGKILL, OOM, host reboot). Called from `status` / `result` so any
 * user-visible job inspection also reconciles stale state.
 */

import { existsSync, statSync } from "node:fs";
import { type JobRecord, jobLogPath, listJobs, markJobFailed } from "./state.js";

// 60 s grace period defends against transient races: a worker briefly
// suspended (debugger break, OS scheduler hiccup) or pid wrap on
// long-uptime hosts where the recorded pid was reused.
const STALE_LOG_MS = 60_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function logMtimeMs(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export function isZombie(job: JobRecord, logFile: string, now: number = Date.now()): boolean {
  if (job.status !== "running" && job.status !== "queued") return false;
  // A job in `queued` may have no pid yet (worker hasn't spawned). Without
  // a pid we cannot probe liveness, so we fall back to log staleness alone.
  if (job.pid != null && isProcessAlive(job.pid)) return false;

  const mtime = logMtimeMs(logFile);
  if (mtime == null) {
    const refIso = job.startedAt ?? job.createdAt;
    const ref = Date.parse(refIso);
    if (!Number.isFinite(ref)) return false;
    return now - ref > STALE_LOG_MS;
  }
  return now - mtime > STALE_LOG_MS;
}

export function sweepZombieJobs(stateDir: string): string[] {
  const reaped: string[] = [];
  const now = Date.now();
  for (const job of listJobs(stateDir)) {
    const logFile = jobLogPath(stateDir, job.id);
    if (!isZombie(job, logFile, now)) continue;
    markJobFailed(stateDir, job.id, "worker process died without writing exit status");
    reaped.push(job.id);
  }
  return reaped;
}
