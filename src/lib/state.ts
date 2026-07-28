/**
 * Workspace-scoped state directory.
 *
 * Holds the per-run job log (`jobs/<id>.log`, the path each command prints so a
 * user can inspect a run) and the cached codex rate-limit snapshot, under
 * $CLAUDE_PLUGIN_DATA. Ported from the sibling gemini-plugin-cc with minimal
 * changes.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import type { CodexRateLimits } from "./provider.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT = join(tmpdir(), "harry");

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
  return join(FALLBACK_STATE_ROOT, dirName);
}

// State dirs/files are 0700/0600: the fallback root is under a world-readable
// /tmp (see FALLBACK_STATE_ROOT), and job logs hold prompts, review findings,
// diffs, and the model's reasoning text — not readable by other users on a
// shared host.
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Write `content` to `filePath` atomically: write a uniquely-named temp file in
 * the same directory, then rename it into place (rename is atomic on a single
 * filesystem). A crash mid-write leaves the previous file intact instead of a
 * truncated one — the torn read a plain writeFileSync exposes would make
 * readCodexRateLimits' catch discard a snapshot that is still perfectly good.
 */
function atomicWrite(filePath: string, content: string): void {
  ensureDir(dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  writeFileSync(tmp, content, { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, filePath);
}

// ─── Job Log ─────────────────────────────────────────────────────────────────
//
// A "job" is just one command run: `ask`/`review`/`fix` each allocate an id,
// append their progress to `jobs/<id>.log`, and print that path so the user can
// read it. There is no job *record* — the log file is the whole artifact, and
// the user is its only reader.

function jobsDir(stateDir: string): string {
  return join(stateDir, "jobs");
}

export function jobLogPath(stateDir: string, jobId: string): string {
  return join(jobsDir(stateDir), `${jobId}.log`);
}

export function generateJobId(): string {
  const ts = Date.now();
  const rand = randomUUID().slice(0, 8);
  return `job-${ts}-${rand}`;
}

export function appendLog(stateDir: string, jobId: string, message: string): void {
  const logFile = jobLogPath(stateDir, jobId);
  ensureDir(jobsDir(stateDir));
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  // Append (not atomic-replace): a log grows line by line. mode 0o600 applies on
  // first creation so the reasoning text it accumulates isn't world-readable.
  writeFileSync(logFile, `[${time}] ${message}\n`, { flag: "a", mode: 0o600 });
}

// ─── Codex rate-limit snapshot ───────────────────────────────────────────────
//
// Codex is a rate-limit backend (no metered quota), so instead of a live quota
// poll we persist the last rate-limit snapshot reported by a codex turn and let
// `status` render it from cache.

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
