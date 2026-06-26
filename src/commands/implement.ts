/**
 * implement command — delegates the task to GitHub Copilot.
 *
 * Emits a single JSON envelope on stdout so callers (the copilot-rescue
 * subagent, or the background worker storing the result) can parse it
 * deterministically. Progress and tool-call chatter go to stderr.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CopilotClient } from '@github/copilot-sdk';

// ReasoningEffort is declared in the SDK's types.d.ts but not re-exported
// from the package root. Duplicate the literal union here to avoid a deep
// internal import path.
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

import { resolveStateDir, generateJobId, appendLog, jobLogPath } from '../lib/state.js';
import { readSnapshot, evaluateGate, summarize, fetchQuota } from '../lib/quota.js';
import { checkAuth } from '../lib/copilot-auth.js';
import { makePermissionHandler } from '../lib/permission.js';
import { attachStream } from '../lib/event-stream.js';
import { buildSystemMessage, resolveExtraContext } from '../lib/system-message.js';
import {
  createWorktree, cleanupWorktree, commitWorktreeChanges, computeDiffStats,
  resolveRepoRoot, type WorktreeHandle,
} from '../lib/worktree.js';
import { CLIENT_NAME, PLUGIN_VERSION } from '../lib/version.js';

export interface ImplementOptions {
  model?: string;
  reasoning?: ReasoningEffort;
  timeout?: number;
  worktree?: boolean;
  allowShell?: boolean;
  allowUrl?: boolean;
  minQuota?: number;
  writePath?: string;
  /**
   * Extra context appended to Copilot's system message. Literal text, or `@file`
   * / `@-` (stdin) to read from a source — see `resolveExtraContext`.
   */
  context?: string;
  /** Pre-allocated job id (used by the background worker to share state). */
  jobId?: string;
}

const DEFAULT_MODEL = 'claude-opus-4.8';
const DEFAULT_EFFORT: ReasoningEffort = 'medium';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function progressFactory(): (message: string) => void {
  return (message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    process.stderr.write(`[${time}] ${message}\n`);
  };
}

function buildPrompt(task: string): string {
  return [
    'Implement the following task inside this repository.',
    'When you are done, produce a concise summary covering:',
    '  - what you changed (at a glance)',
    '  - any assumptions you made',
    '  - any TODOs or follow-up work you chose not to do',
    '',
    'TASK:',
    task,
  ].join('\n');
}

interface CompletedEnvelope {
  status: 'completed';
  jobId: string;
  branch?: string;
  summary: string;
  filesModified: string[];
  linesAdded: number;
  linesRemoved: number;
  /**
   * Premium-request cost for the session. As of Copilot's multiplier-based
   * billing this may be fractional (e.g. an Opus call can cost more than 1).
   */
  premiumRequestCost: number;
  model: string;
  quotaRemaining?: ReturnType<typeof summarize>;
}

interface FailedEnvelope {
  status: 'failed';
  jobId: string;
  error: string;
  branch?: string;
}

interface BlockedEnvelope {
  status: 'blocked';
  reason: string;
  resetAt?: string;
  remaining?: number;
  message: string;
}

type Envelope = CompletedEnvelope | FailedEnvelope | BlockedEnvelope;

function emit(env: Envelope): string {
  const json = JSON.stringify(env);
  process.stdout.write(json + '\n');
  return json;
}

export async function runImplement(task: string, cwd: string, options: ImplementOptions = {}): Promise<void> {
  const progress = progressFactory();

  if (!task.trim()) {
    emit({ status: 'failed', jobId: options.jobId ?? 'unassigned', error: 'Empty task; provide an implementation objective.' });
    process.exit(1);
  }

  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
  const model = options.model ?? DEFAULT_MODEL;
  const reasoning = options.reasoning ?? DEFAULT_EFFORT;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const useWorktree = options.worktree !== false;
  const minQuota = options.minQuota ?? 1;

  const log = (msg: string) => appendLog(stateDir, jobId, msg);
  log(`implement start: model=${model} worktree=${useWorktree} allowShell=${options.allowShell ?? false} allowUrl=${options.allowUrl ?? false}`);

  // 1. Quota gate ------------------------------------------------------------
  const snapshot = readSnapshot(stateDir);
  const gate = evaluateGate(snapshot, { minRemaining: minQuota });
  if (!gate.ok) {
    log(`quota blocked: remaining=${gate.remaining} resetAt=${gate.resetAt}`);
    progress(`Quota exhausted — not opening a Copilot session. Resets at ${gate.resetAt || 'unknown'}.`);
    const blocked: BlockedEnvelope = {
      status: 'blocked',
      reason: gate.reason,
      resetAt: gate.resetAt,
      remaining: gate.remaining,
      message: `Copilot quota exhausted; handle this task directly. Resets at ${gate.resetAt || 'unknown'}.`,
    };
    emit(blocked);
    return;
  }
  if (gate.ok && 'warning' in gate && gate.warning) {
    progress(gate.warning);
  }

  // 2. Worktree --------------------------------------------------------------
  let handle: WorktreeHandle | undefined;
  let sessionCwd = cwd;
  if (useWorktree) {
    try {
      const repoRoot = resolveRepoRoot(cwd);
      const preferredPath = join(stateDir, 'worktrees', jobId);
      handle = createWorktree(jobId, repoRoot, {
        preferredPath,
        onWarn: (m) => {
          progress(m);
          log(`worktree warn: ${m}`);
        },
      });
      sessionCwd = handle.path;
      log(`worktree created: ${handle.branch} at ${handle.path} (base=${handle.baseCommit})`);
      progress(`Worktree: ${handle.branch} at ${handle.path}`);
    } catch (err) {
      const msg = (err as Error).message;
      log(`worktree creation failed: ${msg}`);
      emit({ status: 'failed', jobId, error: `Worktree creation failed: ${msg}` });
      process.exit(1);
    }
  }

  // 3. Copilot client --------------------------------------------------------
  const client = new CopilotClient({
    workingDirectory: sessionCwd,
    env: process.env,
  });

  let sessionAborted = false;
  let cleanupDone = false;

  const finalizeFailure = async (error: string): Promise<void> => {
    if (cleanupDone) return;
    cleanupDone = true;
    if (handle) {
      try {
        cleanupWorktree(handle, { success: false, onWarn: (m) => log(`cleanup warn: ${m}`) });
      } catch (err) {
        log(`cleanup error: ${(err as Error).message}`);
      }
    }
    try {
      await client.forceStop();
    } catch {
      /* ignore */
    }
    emit({ status: 'failed', jobId, error, branch: handle?.branch });
  };

  const onSignal = async (): Promise<void> => {
    if (sessionAborted) return;
    sessionAborted = true;
    progress('Received interrupt signal; aborting Copilot session.');
    log('interrupt signal received');
    await finalizeFailure('Interrupted by signal');
    process.exit(130);
  };
  process.on('SIGINT', () => void onSignal());
  process.on('SIGTERM', () => void onSignal());

  try {
    await client.start();
  } catch (err) {
    await finalizeFailure(`Failed to start Copilot CLI: ${(err as Error).message}`);
    process.exit(1);
  }

  // 4. Auth ------------------------------------------------------------------
  const auth = await checkAuth(client);
  if (!auth.ok) {
    log(`auth failed: ${auth.message}`);
    await finalizeFailure(`Not authenticated: ${auth.message}`);
    await client.stop().catch(() => { /* ignore */ });
    process.exit(1);
  }
  log(`auth ok: ${auth.authType}${auth.login ? ` as ${auth.login}` : ''}`);

  // 5. Session ---------------------------------------------------------------
  const permissionHandler = makePermissionHandler({
    allowShell: options.allowShell ?? false,
    allowUrl: options.allowUrl ?? false,
    worktreePath: sessionCwd,
    appendLog: log,
  });

  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => { progress(m); log(m); },
  });

  const session = await client.createSession({
    clientName: `${CLIENT_NAME}/${PLUGIN_VERSION}`,
    model,
    reasoningEffort: reasoning,
    workingDirectory: sessionCwd,
    infiniteSessions: { enabled: false },
    onPermissionRequest: permissionHandler,
    systemMessage: {
      mode: 'append',
      content: buildSystemMessage('implement', { branch: handle?.branch, extraContext }),
    },
  });

  const stream = attachStream({
    session,
    stateDir,
    appendLog: log,
    progress,
  });

  // 6. Send + wait for task_complete with timeout -----------------------------
  progress(`Sending task to Copilot (model=${model})…`);
  await session.send({ prompt: buildPrompt(task) });

  let completionResult: Awaited<typeof stream.completion> | null = null;
  let timedOut = false;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    progress(`Timeout after ${timeout}ms — aborting session.`);
    log(`timeout ${timeout}ms`);
    session.abort().catch((e) => log(`abort error: ${(e as Error).message}`));
  }, timeout);

  try {
    completionResult = await stream.completion;
  } catch (err) {
    clearTimeout(timeoutHandle);
    const msg = (err as Error).message;
    log(`completion error: ${msg}`);
    stream.dispose();
    await session.disconnect().catch(() => { /* ignore */ });
    await client.stop().catch(() => { /* ignore */ });
    await finalizeFailure(msg);
    process.exit(1);
  }
  clearTimeout(timeoutHandle);

  // 7. Disconnect, wait for shutdown -----------------------------------------
  progress('Task complete; collecting usage metrics, disconnecting session.');

  // Premium cost: query session usage metrics while the session is still alive
  // (the shutdown event's summed model cost is a fallback). Fractional under
  // Copilot's multiplier-based billing.
  let premiumRequestCost: number | undefined;
  try {
    const metrics = await session.rpc.usage.getMetrics();
    premiumRequestCost = metrics.totalPremiumRequestCost;
  } catch (e) {
    log(`usage.getMetrics failed: ${(e as Error).message}`);
  }

  await session.disconnect().catch((e) => log(`disconnect warn: ${(e as Error).message}`));

  const shutdownResult = await Promise.race([
    stream.shutdown,
    new Promise<null>((res) => setTimeout(() => res(null), 5000)),
  ]);

  stream.dispose();

  // Refresh the cached quota snapshot post-run so the envelope reflects the
  // usage we just consumed (the SDK no longer pushes quota via events).
  await fetchQuota(client, stateDir).catch(() => null);

  await client.stop().catch(() => { /* ignore */ });

  // 8. Commit worktree changes (Copilot edits files but does not commit). -----
  if (handle) {
    const taskSummary = (completionResult?.summary ?? task).slice(0, 72);
    const committed = commitWorktreeChanges(handle, `copilot: ${taskSummary}`);
    if (committed) {
      log('auto-committed worktree changes');
    } else {
      log('no uncommitted changes in worktree (Copilot may not have edited any files)');
    }
  }

  // 9. Compute diff from git (trustworthy source). ---------------------------
  let filesModified: string[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  if (handle) {
    try {
      const stats = computeDiffStats(handle);
      filesModified = stats.filesModified;
      linesAdded = stats.linesAdded;
      linesRemoved = stats.linesRemoved;
    } catch (err) {
      log(`diff stats failed: ${(err as Error).message}`);
    }
  }

  // Cross-check against shutdown event's self-reported changes.
  if (shutdownResult) {
    const selfFiles = new Set(shutdownResult.codeChanges.filesModified);
    const gitFiles = new Set(filesModified);
    const missing = [...selfFiles].filter((f) => !gitFiles.has(f));
    if (missing.length > 0) {
      log(`codeChanges drift: self-reported but not in git diff: ${missing.join(', ')}`);
    }
  }

  // 9. Cleanup worktree (keep branch). ---------------------------------------
  const success = completionResult?.success !== false && !timedOut;
  if (handle) {
    cleanupWorktree(handle, { success, onWarn: (m) => log(`cleanup warn: ${m}`) });
  }

  // 10. Compose envelope -----------------------------------------------------
  if (!success) {
    const error = timedOut ? `Timed out after ${timeout}ms` : 'Task did not complete successfully.';
    emit({ status: 'failed', jobId, error, branch: handle?.branch });
    process.exit(0);
  }

  const summary =
    (completionResult?.summary && completionResult.summary.trim()) ||
    stream.getLastAssistantMessage()?.trim() ||
    'Copilot completed without providing a summary.';

  const quotaRemaining = summarize(readSnapshot(stateDir));

  const envelope: CompletedEnvelope = {
    status: 'completed',
    jobId,
    branch: handle?.branch,
    summary,
    filesModified,
    linesAdded,
    linesRemoved,
    premiumRequestCost: premiumRequestCost ?? shutdownResult?.premiumRequestCost ?? 0,
    model: shutdownResult?.currentModel ?? model,
    quotaRemaining,
  };

  const envelopeJson = emit(envelope);

  if (options.writePath) {
    const outPath = resolve(cwd, options.writePath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, envelopeJson + '\n', 'utf-8');
    progress(`Report saved to ${outPath}`);
  }

  log(`implement done: branch=${envelope.branch ?? 'none'} files=${envelope.filesModified.length} premiumCost=${envelope.premiumRequestCost}`);
  // Log path hint (useful when running standalone).
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}
