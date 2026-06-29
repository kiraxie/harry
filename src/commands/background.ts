/**
 * Background execution for the review command.
 *
 * Spawns a detached worker that re-invokes the companion with `_worker
 * --job-id <id>`. The worker runs runReview with a preallocated jobId and
 * captures stdout (the JSON envelope) into the job state file.
 */

import { spawn } from 'node:child_process';
import {
  resolveStateDir, generateJobId, createJob, updateJob, markJobFailed,
  appendLog, getSessionId, readJobFile,
  type JobRecord,
} from '../lib/state.js';
import { runReview, type ReviewOptions } from './review.js';
import type { ReviewScope } from '../lib/git.js';
import type { ProviderId } from '../lib/provider.ts';
import { extractTask, flagString, flagNumber } from '../lib/args.js';

declare const __filename: string | undefined;

/**
 * Enqueue a review run in the background. Returns the job id. The caller
 * (CLI dispatcher) is expected to emit the queued envelope to stdout.
 */
export function enqueueBackground(
  command: string,
  args: string[],
  flags: Record<string, string | boolean>,
  cwd: string,
): string {
  if (command !== 'review') {
    throw new Error(`Background execution is only supported for 'review', got '${command}'.`);
  }

  const stateDir = resolveStateDir(cwd);
  const jobId = generateJobId();

  const summary = extractTask(args, flags).slice(0, 80) || command;
  const job: JobRecord = {
    id: jobId,
    kind: command,
    title: `harry ${command}`,
    summary,
    status: 'queued',
    phase: 'queued',
    cwd,
    createdAt: new Date().toISOString(),
    sessionId: getSessionId(),
    request: { command, args, flags, cwd },
  };

  createJob(stateDir, job);
  appendLog(stateDir, jobId, `Queued for background execution: ${command} "${summary}"`);

  const scriptPath = getScriptPath();
  const child = spawn(process.execPath, [scriptPath, '_worker', '--job-id', jobId, '--cwd', cwd], {
    cwd,
    env: { ...process.env, HARRY_SESSION_ID: getSessionId() ?? '' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  updateJob(stateDir, jobId, { pid: child.pid ?? null });

  return jobId;
}

function getScriptPath(): string {
  // The companion is always shipped as a CJS bundle (see build.mjs), so
  // __filename points to dist/companion.cjs at runtime.
  if (typeof __filename === 'undefined' || !__filename) {
    throw new Error('Unable to resolve script path: __filename is not defined. The companion must be run via the bundled CJS output.');
  }
  return __filename;
}

function flagProvider(flags: Record<string, string | boolean>): ProviderId | undefined {
  const v = flags['provider'];
  return v === 'copilot' || v === 'codex' ? v : undefined;
}

/**
 * Worker entrypoint. Runs `runReview` with the jobId from the parent and
 * captures its stdout into the job record.
 */
export async function runWorker(jobId: string, cwd: string): Promise<void> {
  const stateDir = resolveStateDir(cwd);
  const job = readJobFile(stateDir, jobId);

  if (!job) {
    console.error(`Worker: Job not found: ${jobId}`);
    process.exit(1);
  }

  const { args, flags } = job.request;

  updateJob(stateDir, jobId, {
    status: 'running',
    phase: 'starting',
    startedAt: new Date().toISOString(),
  });
  appendLog(stateDir, jobId, 'Worker started.');

  // If anything inside this worker calls process.exit with a non-zero
  // code before the try/catch below can persist failure, this hook is
  // the backstop so /harry:status doesn't leave the job stuck at
  // `running`. markJobFailed itself is idempotent on terminal states.
  process.on('exit', (code) => {
    if (code === 0) return;
    try {
      markJobFailed(stateDir, jobId, `worker exited with code ${code}`);
    } catch {
      // Best-effort; nothing more we can do from an exit handler.
    }
  });

  // Route stdout through a buffer so we can persist it to the job record.
  const stdoutChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString();
    stdoutChunks.push(text);
    return originalStdoutWrite(chunk as never, ...(rest as []));
  }) as typeof process.stdout.write;

  // Route stderr progress into the job log so /harry:status can show it.
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString();
    if (text.trim()) appendLog(stateDir, jobId, text.trim());
    return originalStderrWrite(chunk as never, ...(rest as []));
  }) as typeof process.stderr.write;

  const reasoning = flagString(flags, 'reasoning');
  const validEfforts = ['low', 'medium', 'high', 'xhigh'] as const;
  type Effort = typeof validEfforts[number];
  const effort: Effort | undefined =
    reasoning && (validEfforts as readonly string[]).includes(reasoning)
      ? (reasoning as Effort)
      : undefined;

  try {
    if (job.request.command !== 'review') {
      throw new Error(`Background worker only supports 'review', got '${job.request.command}'.`);
    }
    const scope = flagString(flags, 'scope');
    const validScopes: ReviewScope[] = ['auto', 'working-tree', 'branch'];
    const reviewOpts: ReviewOptions = {
      adversarial: flags['adversarial'] === true,
      scope: scope && (validScopes as string[]).includes(scope) ? (scope as ReviewScope) : undefined,
      base: flagString(flags, 'base'),
      focusText: extractTask(args, flags),
      // provider + simplify MUST be threaded here — the foreground dispatcher
      // (companion.ts) passes them, so dropping them makes a backgrounded
      // `review --simplify` / `--provider codex` silently run the wrong
      // lane/backend.
      provider: flagProvider(flags),
      simplify: flags['simplify'] === true,
      model: flagString(flags, 'model'),
      reasoning: effort,
      timeout: flagNumber(flags, 'timeout'),
      minQuota: flagNumber(flags, 'min-quota'),
      fix: flags['fix'] === true,
      context: flagString(flags, 'context'),
      jobId,
    };
    await runReview(cwd, reviewOpts);
    const captured = stdoutChunks.join('').trim();
    updateJob(stateDir, jobId, {
      status: 'completed',
      phase: 'done',
      completedAt: new Date().toISOString(),
      result: captured,
    });
    appendLog(stateDir, jobId, 'Worker completed.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markJobFailed(stateDir, jobId, message);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}
