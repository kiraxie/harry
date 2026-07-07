/**
 * Job state persistence.
 *
 * Stores job metadata in a workspace-scoped directory under $CLAUDE_PLUGIN_DATA.
 * Ported from the sibling gemini-plugin-cc with minimal changes.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import type { CodexRateLimits } from "./provider.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JobRecord {
  id: string;
  kind: string; // 'review' | 'ask' | 'fix'
  title: string;
  summary: string;
  status: "queued" | "running" | "completed" | "failed";
  phase: string;
  cwd: string;
  pid?: number | null;
  logFile?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  sessionId?: string;
  request: JobRequest;
  result?: string;
  errorMessage?: string;
}

export interface JobRequest {
  command: string; // 'review' | 'ask' | 'fix'
  args: string[];
  flags: Record<string, string | boolean>;
  cwd: string;
}

interface StateFile {
  version: number;
  jobs: JobRecord[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_JOBS = 50;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const SESSION_ID_ENV = "HARRY_SESSION_ID";
// DEBT: back-compat read for background jobs spawned by a pre-rename build that
// set the old env var. Drop after one release.
const LEGACY_SESSION_ID_ENV = "COPILOT_COMPANION_SESSION_ID";
const FALLBACK_STATE_ROOT = join(tmpdir(), "harry");
// DEBT: back-compat fallback for background jobs queued by a pre-rename build,
// which wrote their state under the old tmp root. Drop after one release.
const LEGACY_FALLBACK_STATE_ROOT = join(tmpdir(), "copilot-companion");

// ─── State Directory ─────────────────────────────────────────────────────────

/**
 * Resolve the git repo root containing `cwd`, falling back to `resolve(cwd)`
 * when it is not a git repo (or git is unavailable). Keying state on the repo
 * root — not the raw cwd — keeps a command invoked from a subdirectory and a
 * provider invoked with the repo root pointed at the SAME state dir, so their
 * quota / codex rate-limit caches don't silently diverge.
 */
function repoRootOf(cwd: string): string {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root || resolve(cwd);
  } catch {
    return resolve(cwd);
  }
}

export function resolveStateDir(cwd: string): string {
  const workspaceRoot = repoRootOf(cwd);
  const slug =
    basename(workspaceRoot)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
  const dirName = `${slug}-${hash}`;
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  if (pluginDataDir) {
    return join(pluginDataDir, "state", dirName);
  }
  // Fallback (no CLAUDE_PLUGIN_DATA): a job queued by a pre-rename build lives
  // under the legacy tmp root. If the current root has no state for this
  // workspace yet but the legacy one does, keep using the legacy dir so those
  // queued jobs remain retrievable after the rename.
  const fallbackDir = join(FALLBACK_STATE_ROOT, dirName);
  if (!existsSync(fallbackDir)) {
    const legacyDir = join(LEGACY_FALLBACK_STATE_ROOT, dirName);
    if (existsSync(legacyDir)) return legacyDir;
  }
  return fallbackDir;
}

// State dirs/files are 0700/0600: the fallback root is under a world-readable
// /tmp (see FALLBACK_STATE_ROOT), and job records + logs hold prompts, review
// findings, diffs, and the model's reasoning text — not readable by other users
// on a shared host.
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Write `content` to `filePath` atomically: write a uniquely-named temp file in
 * the same directory, then rename it into place (rename is atomic on a single
 * filesystem). A crash mid-write leaves the previous file intact instead of a
 * truncated one — the torn read a plain writeFileSync exposes would make
 * loadState's catch fall back to an empty store and permanently drop all jobs.
 */
function atomicWrite(filePath: string, content: string): void {
  ensureDir(dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  writeFileSync(tmp, content, { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, filePath);
}

// ─── State File ──────────────────────────────────────────────────────────────

function stateFilePath(stateDir: string): string {
  return join(stateDir, "state.json");
}

function loadState(stateDir: string): StateFile {
  const filePath = stateFilePath(stateDir);
  if (!existsSync(filePath)) {
    return { version: 1, jobs: [] };
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as StateFile;
  } catch {
    return { version: 1, jobs: [] };
  }
}

function saveState(stateDir: string, state: StateFile): void {
  ensureDir(stateDir);
  if (state.jobs.length > MAX_JOBS) {
    // MAX_JOBS caps state.json, but never at the cost of an in-flight job: a
    // running/queued entry keeps its slot (and its files) regardless of position
    // — pruning it would delete the state/log out from under a live worker (and
    // the zombie sweep already bounds how long an entry can stay in-flight).
    // Dropped terminal jobs' per-job files/logs are never referenced again —
    // delete them so the jobs/ dir doesn't grow without bound.
    const keep: JobRecord[] = [];
    for (const job of state.jobs) {
      const inFlight = job.status === "running" || job.status === "queued";
      if (inFlight || keep.length < MAX_JOBS) {
        keep.push(job);
      } else {
        rmSync(jobFilePath(stateDir, job.id), { force: true });
        rmSync(jobLogPath(stateDir, job.id), { force: true });
      }
    }
    state.jobs = keep;
  }
  atomicWrite(stateFilePath(stateDir), JSON.stringify(state, null, 2));
}

// ─── Job Files ───────────────────────────────────────────────────────────────

function jobsDir(stateDir: string): string {
  return join(stateDir, "jobs");
}

function jobFilePath(stateDir: string, jobId: string): string {
  return join(jobsDir(stateDir), `${jobId}.json`);
}

export function jobLogPath(stateDir: string, jobId: string): string {
  return join(jobsDir(stateDir), `${jobId}.log`);
}

export function writeJobFile(stateDir: string, job: JobRecord): void {
  atomicWrite(jobFilePath(stateDir, job.id), JSON.stringify(job, null, 2));
}

export function readJobFile(stateDir: string, jobId: string): JobRecord | null {
  const filePath = jobFilePath(stateDir, jobId);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as JobRecord;
  } catch {
    return null;
  }
}

// ─── Log File ────────────────────────────────────────────────────────────────

export function appendLog(stateDir: string, jobId: string, message: string): void {
  const logFile = jobLogPath(stateDir, jobId);
  ensureDir(jobsDir(stateDir));
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  // Append (not atomic-replace): a log grows line by line. mode 0o600 applies on
  // first creation so the reasoning text it accumulates isn't world-readable.
  writeFileSync(logFile, `[${time}] ${message}\n`, { flag: "a", mode: 0o600 });
}

export function readLogTail(stateDir: string, jobId: string, maxLines = 10): string[] {
  const logFile = jobLogPath(stateDir, jobId);
  if (!existsSync(logFile)) return [];
  try {
    const content = readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n");
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

// ─── Job CRUD ────────────────────────────────────────────────────────────────

export function generateJobId(): string {
  const ts = Date.now();
  const rand = randomUUID().slice(0, 8);
  return `job-${ts}-${rand}`;
}

export function getSessionId(): string | undefined {
  return process.env[SESSION_ID_ENV] || process.env[LEGACY_SESSION_ID_ENV] || undefined;
}

export function createJob(stateDir: string, job: JobRecord): void {
  const state = loadState(stateDir);
  state.jobs.unshift(job);
  saveState(stateDir, state);
  writeJobFile(stateDir, job);
}

export function updateJob(stateDir: string, jobId: string, updates: Partial<JobRecord>): void {
  const state = loadState(stateDir);
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx >= 0) {
    state.jobs[idx] = { ...state.jobs[idx], ...updates };
    saveState(stateDir, state);
  }
  const full = readJobFile(stateDir, jobId);
  if (full) {
    writeJobFile(stateDir, { ...full, ...updates });
  }
}

/**
 * Mark a job as failed with the given message, also writing a log line.
 * Idempotent-ish: leaves already-terminal jobs alone so concurrent
 * failure paths (worker catch, exit handler, zombie sweeper) cannot
 * clobber an earlier, more specific error message.
 */
export function markJobFailed(stateDir: string, jobId: string, errorMessage: string): void {
  const job = readJobFile(stateDir, jobId);
  if (!job || job.status === "completed" || job.status === "failed") return;
  updateJob(stateDir, jobId, {
    status: "failed",
    phase: "failed",
    completedAt: new Date().toISOString(),
    errorMessage,
  });
  appendLog(stateDir, jobId, `Marked failed: ${errorMessage}`);
}

export function listJobs(stateDir: string, sessionId?: string): JobRecord[] {
  const state = loadState(stateDir);
  if (sessionId) {
    return state.jobs.filter((j) => j.sessionId === sessionId);
  }
  return state.jobs;
}

// ─── Codex rate-limit snapshot ───────────────────────────────────────────────
//
// Codex is a rate-limit backend (no metered quota), so instead of a live quota
// poll we persist the last rate-limit snapshot reported by a codex turn and let
// `status` render it from cache. Mirrors the job-file read/write style above.

const CODEX_RATE_LIMITS_FILE = "codex-rate-limits.json";

/** Last codex rate-limit snapshot plus the ISO time it was captured. */
export interface CodexRateLimitSnapshot extends CodexRateLimits {
  capturedAt?: string;
}

function codexRateLimitsPath(stateDir: string): string {
  return join(stateDir, CODEX_RATE_LIMITS_FILE);
}

/**
 * Best-effort persist of a codex rate-limit snapshot. Never throws — a failed
 * write (read-only FS, missing dir we can't create) must not break a turn.
 */
export function writeCodexRateLimits(stateDir: string, rateLimits: CodexRateLimits): void {
  try {
    ensureDir(stateDir);
    const snapshot: CodexRateLimitSnapshot = {
      ...rateLimits,
      capturedAt: new Date().toISOString(),
    };
    atomicWrite(codexRateLimitsPath(stateDir), JSON.stringify(snapshot, null, 2));
  } catch {
    // best-effort: snapshot is a convenience, never a correctness dependency.
  }
}

/** Read the last codex rate-limit snapshot, or null if none/unreadable. */
export function readCodexRateLimits(stateDir: string): CodexRateLimitSnapshot | null {
  const filePath = codexRateLimitsPath(stateDir);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as CodexRateLimitSnapshot;
  } catch {
    return null;
  }
}

/**
 * Pure one-line formatter for a codex rate-limit snapshot. Absent fields are
 * omitted, e.g. `primary 42% / secondary 10% used · plan pro · resets <iso>`.
 */
export function formatCodexRateLimits(rl: CodexRateLimits): string {
  const parts: string[] = [];
  const used: string[] = [];
  if (rl.primaryUsedPercent !== undefined) used.push(`primary ${rl.primaryUsedPercent}%`);
  if (rl.secondaryUsedPercent !== undefined) used.push(`secondary ${rl.secondaryUsedPercent}%`);
  if (used.length > 0) parts.push(`${used.join(" / ")} used`);
  if (rl.planType) parts.push(`plan ${rl.planType}`);
  if (rl.resetsAt) parts.push(`resets ${rl.resetsAt}`);
  return parts.join(" · ");
}

/** Human-friendly "<n> ago" for a snapshot ISO timestamp; falls back to raw. */
export function formatSnapshotAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Pure renderer for the `## Codex` status block. `capturedAt` (from the
 * persisted snapshot) labels the header with the cache age — codex rate-limits
 * refresh only on an actual turn, so a stale reading must say so.
 */
export function renderCodexBlock(rl: CodexRateLimits, capturedAt?: string): string {
  const header = capturedAt ? `## Codex (snapshot ${formatSnapshotAge(capturedAt)})` : "## Codex";
  return [header, formatCodexRateLimits(rl)].join("\n");
}
