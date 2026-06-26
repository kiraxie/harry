/**
 * Job state persistence.
 *
 * Stores job metadata in a workspace-scoped directory under $CLAUDE_PLUGIN_DATA.
 * Ported from the sibling gemini-plugin-cc with minimal changes.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JobRecord {
  id: string;
  kind: string;           // 'implement'
  title: string;
  summary: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
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
  command: string;        // 'implement'
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
const PLUGIN_DATA_ENV = 'CLAUDE_PLUGIN_DATA';
const SESSION_ID_ENV = 'COPILOT_COMPANION_SESSION_ID';
const FALLBACK_STATE_ROOT = join(tmpdir(), 'copilot-companion');

// ─── State Directory ─────────────────────────────────────────────────────────

export function resolveStateDir(cwd: string): string {
  const workspaceRoot = resolve(cwd);
  const slug = basename(workspaceRoot).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir ? join(pluginDataDir, 'state') : FALLBACK_STATE_ROOT;
  return join(stateRoot, `${slug}-${hash}`);
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// ─── State File ──────────────────────────────────────────────────────────────

function stateFilePath(stateDir: string): string {
  return join(stateDir, 'state.json');
}

function loadState(stateDir: string): StateFile {
  const filePath = stateFilePath(stateDir);
  if (!existsSync(filePath)) {
    return { version: 1, jobs: [] };
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as StateFile;
  } catch {
    return { version: 1, jobs: [] };
  }
}

function saveState(stateDir: string, state: StateFile): void {
  ensureDir(stateDir);
  if (state.jobs.length > MAX_JOBS) {
    state.jobs = state.jobs.slice(0, MAX_JOBS);
  }
  writeFileSync(stateFilePath(stateDir), JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Job Files ───────────────────────────────────────────────────────────────

function jobsDir(stateDir: string): string {
  return join(stateDir, 'jobs');
}

function jobFilePath(stateDir: string, jobId: string): string {
  return join(jobsDir(stateDir), `${jobId}.json`);
}

export function jobLogPath(stateDir: string, jobId: string): string {
  return join(jobsDir(stateDir), `${jobId}.log`);
}

export function writeJobFile(stateDir: string, job: JobRecord): void {
  const dir = jobsDir(stateDir);
  ensureDir(dir);
  writeFileSync(jobFilePath(stateDir, job.id), JSON.stringify(job, null, 2), 'utf-8');
}

export function readJobFile(stateDir: string, jobId: string): JobRecord | null {
  const filePath = jobFilePath(stateDir, jobId);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as JobRecord;
  } catch {
    return null;
  }
}

// ─── Log File ────────────────────────────────────────────────────────────────

export function appendLog(stateDir: string, jobId: string, message: string): void {
  const logFile = jobLogPath(stateDir, jobId);
  ensureDir(jobsDir(stateDir));
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  writeFileSync(logFile, `[${time}] ${message}\n`, { flag: 'a' });
}

export function readLogTail(stateDir: string, jobId: string, maxLines = 10): string[] {
  const logFile = jobLogPath(stateDir, jobId);
  if (!existsSync(logFile)) return [];
  try {
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.trim().split('\n');
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
  return process.env[SESSION_ID_ENV] || undefined;
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
    state.jobs[idx] = { ...state.jobs[idx]!, ...updates };
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
  if (!job || job.status === 'completed' || job.status === 'failed') return;
  updateJob(stateDir, jobId, {
    status: 'failed',
    phase: 'failed',
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
