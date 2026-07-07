/**
 * Reaper for background workers that died without persisting failure
 * (SIGKILL, OOM, host reboot). Called from `status` / `result` so any
 * user-visible job inspection also reconciles stale state.
 */

import { existsSync, statSync } from "node:fs";
import { type JobRecord, jobLogPath, listJobs, markJobFailed } from "./state.ts";

// 60 s grace period defends against transient races: a worker briefly
// suspended (debugger break, OS scheduler hiccup) or pid wrap on
// long-uptime hosts where the recorded pid was reused.
const STALE_LOG_MS = 60_000;

// When the recorded pid is *alive*, we normally treat the job as live. But a pid
// can be reused by an unrelated long-lived process, wedging a job in `running`
// forever. A log silent far longer than the job could legitimately run against a
// "live" pid is a reused pid, not our worker — reap it anyway. The floor is 6h;
// a job launched with a larger `--timeout` widens its own window (see below),
// since there is no heartbeat to keep the log fresh during a long silent turn.
const PID_REUSE_STALE_MS = 6 * 60 * 60 * 1000; // 6h

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

  const mtime = logMtimeMs(logFile);
  // How long the job has shown no sign of life (log mtime, or its start time when
  // no log exists yet), compared against `threshold`.
  const silentFor = (threshold: number): boolean => {
    if (mtime == null) {
      const ref = Date.parse(job.startedAt ?? job.createdAt);
      return Number.isFinite(ref) && now - ref > threshold;
    }
    return now - mtime > threshold;
  };

  // A live pid normally clears the job — unless the log has been silent far
  // longer than the job could legitimately run, which means the pid was reused
  // (a job in `queued` may also simply have no pid yet; both fall through to
  // staleness). `--timeout` is uncapped, so a job that asked for more than the
  // 6h floor gets a window of its own timeout plus the usual grace.
  if (job.pid != null && isProcessAlive(job.pid)) {
    const requested = Number(job.request?.flags?.timeout);
    const ownWindow = Number.isFinite(requested) && requested > 0 ? requested + STALE_LOG_MS : 0;
    return silentFor(Math.max(PID_REUSE_STALE_MS, ownWindow));
  }
  return silentFor(STALE_LOG_MS);
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
