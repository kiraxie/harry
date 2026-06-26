/**
 * Render the stdout JSON envelope into a human-readable Markdown report.
 * Used by the `result` command when `--json` is not set.
 *
 * The envelope shape is produced by src/commands/implement.ts.
 */

import { fmtNum } from './quota.js';

export interface CompletedEnvelope {
  status: 'completed';
  branch: string;
  summary: string;
  filesModified: string[];
  linesAdded: number;
  linesRemoved: number;
  premiumRequestCost: number;
  model: string;
  quotaRemaining?: {
    premium?: number;
    percentage?: number;
    resetAt?: string;
  };
}

export interface BlockedEnvelope {
  status: 'blocked';
  reason: string;
  resetAt?: string;
  remaining?: number;
  message: string;
}

export interface FailedEnvelope {
  status: 'failed';
  jobId?: string;
  error: string;
  branch?: string;
}

export interface QueuedEnvelope {
  status: 'queued';
  jobId: string;
}

export type Envelope =
  | CompletedEnvelope
  | BlockedEnvelope
  | FailedEnvelope
  | QueuedEnvelope;

export function renderEnvelope(raw: string): string {
  let env: Envelope;
  try {
    env = JSON.parse(raw) as Envelope;
  } catch {
    return raw;
  }

  switch (env.status) {
    case 'completed':
      return renderCompleted(env);
    case 'blocked':
      return renderBlocked(env);
    case 'failed':
      return renderFailed(env);
    case 'queued':
      return `## Copilot job queued\n\n**Job ID:** \`${env.jobId}\``;
    default:
      return raw;
  }
}

function renderCompleted(env: CompletedEnvelope): string {
  const lines: string[] = [];
  lines.push('## Copilot Implementation Complete');
  lines.push('');
  lines.push(`**Branch:** \`${env.branch}\``);
  lines.push(`**Model:** ${env.model}`);
  lines.push(`**Premium request cost:** ${fmtNum(env.premiumRequestCost)}`);
  if (env.quotaRemaining) {
    const q = env.quotaRemaining;
    const parts: string[] = [];
    if (typeof q.premium === 'number') parts.push(`${fmtNum(q.premium)} remaining`);
    if (typeof q.percentage === 'number') parts.push(`${q.percentage.toFixed(1)}%`);
    if (q.resetAt) parts.push(`resets ${q.resetAt}`);
    if (parts.length > 0) lines.push(`**Quota:** ${parts.join(' · ')}`);
  }
  lines.push('');
  lines.push('### Summary');
  lines.push(env.summary || '_No summary provided._');
  lines.push('');
  lines.push('### Changes');
  lines.push(`- ${env.filesModified.length} file(s) modified, +${env.linesAdded} / -${env.linesRemoved} lines`);
  if (env.filesModified.length > 0) {
    lines.push('');
    for (const f of env.filesModified) lines.push(`- \`${f}\``);
  }
  lines.push('');
  lines.push('### Review');
  lines.push(`- Diff: \`git diff ${env.branch}\``);
  lines.push(`- Checkout: \`git checkout ${env.branch}\``);
  lines.push('- The main working tree was not modified.');
  return lines.join('\n');
}

function renderBlocked(env: BlockedEnvelope): string {
  const lines: string[] = [];
  lines.push('## Copilot Delegation Blocked');
  lines.push('');
  lines.push(`**Reason:** ${env.reason}`);
  if (typeof env.remaining === 'number') lines.push(`**Remaining:** ${env.remaining}`);
  if (env.resetAt) lines.push(`**Resets at:** ${env.resetAt}`);
  lines.push('');
  lines.push(env.message);
  return lines.join('\n');
}

function renderFailed(env: FailedEnvelope): string {
  const lines: string[] = [];
  lines.push('## Copilot Job Failed');
  lines.push('');
  if (env.jobId) lines.push(`**Job ID:** \`${env.jobId}\``);
  if (env.branch) lines.push(`**Partial work on branch:** \`${env.branch}\``);
  lines.push('');
  lines.push(`**Error:** ${env.error}`);
  return lines.join('\n');
}
