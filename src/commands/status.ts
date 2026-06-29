/**
 * status command — shows quota + background job status.
 *
 * Adapted from the sibling gemini plugin. The key addition is a "## Copilot
 * Quota" block at the top of the default listing.
 */

import {
  resolveStateDir, listJobs, readJobFile, readLogTail, getSessionId,
  readCodexRateLimits, renderCodexBlock,
  type JobRecord,
} from '../lib/state.js';
import { readSnapshot, summarize, renderQuotaBar } from '../lib/quota.js';
import { sweepZombieJobs } from '../lib/zombie.js';

export interface StatusOptions {
  jobId?: string;
  all?: boolean;
  json?: boolean;
}

export async function runStatus(cwd: string, options: StatusOptions = {}): Promise<void> {
  const stateDir = resolveStateDir(cwd);
  sweepZombieJobs(stateDir);
  const sessionId = options.all ? undefined : getSessionId();

  if (options.jobId) {
    const job = readJobFile(stateDir, options.jobId);
    if (!job) {
      console.error(`Job not found: ${options.jobId}`);
      process.exit(1);
    }
    if (options.json) {
      console.log(JSON.stringify(job, null, 2));
      return;
    }
    const logTail = readLogTail(stateDir, job.id, 15);
    console.log(renderJobDetail(job, logTail));
    return;
  }

  const jobs = listJobs(stateDir, sessionId);
  const snapshot = readSnapshot(stateDir);
  const quota = summarize(snapshot);
  const codexRateLimits = readCodexRateLimits(stateDir);

  if (options.json) {
    console.log(JSON.stringify(
      { quota, ...(codexRateLimits ? { codex: codexRateLimits } : {}), jobs },
      null, 2,
    ));
    return;
  }

  const sections: string[] = [];

  sections.push(renderQuotaBlock(snapshot !== null, quota));
  if (codexRateLimits) sections.push(renderCodexBlock(codexRateLimits));

  const running = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const finished = jobs.filter((j) => j.status === 'completed' || j.status === 'failed');

  if (running.length > 0) {
    const block = ['## Running', renderJobsTable(running.map(toTableRow))];
    const logLines: string[] = [];
    for (const job of running) {
      const logTail = readLogTail(stateDir, job.id, 3);
      const lastLine = logTail[logTail.length - 1] ?? '';
      if (lastLine) logLines.push(`  ${job.id}: ${lastLine}`);
    }
    if (logLines.length > 0) {
      block.push('Last log:');
      block.push(...logLines);
    }
    sections.push(block.join('\n'));
  }

  if (finished.length > 0) {
    sections.push(['## Recent', renderJobsTable(finished.slice(0, 10).map(toTableRow))].join('\n'));
  }

  if (running.length === 0 && finished.length === 0) {
    sections.push('_No background jobs._');
  }

  console.log(sections.join('\n\n'));
}

function renderQuotaBlock(haveSnapshot: boolean, q: ReturnType<typeof summarize>): string {
  return ['## Quota', ...renderQuotaBar(q, haveSnapshot)].join('\n');
}

interface JobRow {
  id: string;
  kind: string;
  status: string;
  task: string;
}

function toTableRow(job: JobRecord): JobRow {
  const icon =
    job.status === 'completed' ? '✓ ' :
    job.status === 'failed'    ? '✗ ' :
    job.status === 'running'   ? '▶ ' :
    job.status === 'queued'    ? '… ' : '  ';
  return { id: job.id, kind: job.kind, status: icon + job.status, task: job.summary };
}

const TASK_MAX_WIDTH = 72;

function renderJobsTable(rows: JobRow[]): string {
  const headers: JobRow = { id: 'Job ID', kind: 'Command', status: 'Status', task: 'Task' };
  const widths = {
    id: Math.max(headers.id.length, ...rows.map((r) => r.id.length)),
    kind: Math.max(headers.kind.length, ...rows.map((r) => r.kind.length)),
    status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
    task: Math.min(TASK_MAX_WIDTH, Math.max(headers.task.length, ...rows.map((r) => r.task.length))),
  };
  const border = (l: string, m: string, r: string): string =>
    l + '─'.repeat(widths.id + 2) + m +
    '─'.repeat(widths.kind + 2) + m +
    '─'.repeat(widths.status + 2) + m +
    '─'.repeat(widths.task + 2) + r;
  const renderRow = (r: JobRow): string => {
    const task = r.task.length > widths.task ? r.task.slice(0, widths.task - 1) + '…' : r.task.padEnd(widths.task);
    return `│ ${r.id.padEnd(widths.id)} │ ${r.kind.padEnd(widths.kind)} │ ${r.status.padEnd(widths.status)} │ ${task} │`;
  };
  return [
    border('┌', '┬', '┐'),
    renderRow(headers),
    border('├', '┼', '┤'),
    ...rows.map(renderRow),
    border('└', '┴', '┘'),
  ].join('\n');
}

function renderJobDetail(job: JobRecord, logTail: string[]): string {
  const sections: string[] = [];
  sections.push(`## Job: ${job.id}`);
  sections.push(`**Kind:** ${job.kind}`);
  sections.push(`**Status:** ${job.status}`);
  sections.push(`**Phase:** ${job.phase}`);
  sections.push(`**Summary:** ${job.summary}`);
  sections.push(`**Created:** ${job.createdAt}`);
  if (job.startedAt) sections.push(`**Started:** ${job.startedAt}`);
  if (job.completedAt) sections.push(`**Completed:** ${job.completedAt}`);
  if (job.errorMessage) sections.push(`**Error:** ${job.errorMessage}`);

  if (logTail.length > 0) {
    sections.push('\n### Recent Log');
    sections.push('```');
    sections.push(logTail.join('\n'));
    sections.push('```');
  }

  return sections.join('\n');
}
