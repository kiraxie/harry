/**
 * ask command — sends an arbitrary prompt to GitHub Copilot and prints the
 * assistant's markdown verbatim. Read-only: no worktree, no file writes, no
 * shell. The reasoning backend for the `/copilot:debate` skill's gpt-5.5 voice,
 * and a generic single-prompt query command.
 */

import { CopilotClient } from '@github/copilot-sdk';

import { resolveStateDir, generateJobId, appendLog, jobLogPath } from '../lib/state.js';
import { readSnapshot, evaluateGate, summarize, isPremiumModel, fetchQuota, fmtNum } from '../lib/quota.js';
import { checkAuth } from '../lib/copilot-auth.js';
import { makePermissionHandler } from '../lib/permission.js';
import { attachStream } from '../lib/event-stream.js';
import { buildSystemMessage, resolveExtraContext } from '../lib/system-message.js';
import { CLIENT_NAME, PLUGIN_VERSION } from '../lib/version.js';
import type { ReasoningEffort } from './implement.js';

export interface AskOptions {
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
  timeout?: number;
  minQuota?: number;
  context?: string;
  jobId?: string;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_EFFORT: ReasoningEffort = 'high';

function progressFactory(): (message: string) => void {
  return (message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    process.stderr.write(`[${time}] ${message}\n`);
  };
}

export async function runAsk(cwd: string, options: AskOptions): Promise<void> {
  const progress = progressFactory();
  const model = options.model ?? DEFAULT_MODEL;
  const reasoning = options.reasoning ?? DEFAULT_EFFORT;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const minQuota = options.minQuota ?? 1;

  const prompt = options.prompt.trim();
  if (!prompt) throw new Error('ask: empty prompt');

  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
  const log = (msg: string): void => appendLog(stateDir, jobId, msg);
  log(`ask start: model=${model} effort=${reasoning} promptChars=${prompt.length}`);

  // Quota gate — only when the chosen model meters premium requests.
  const snapshot = readSnapshot(stateDir);
  if (isPremiumModel(model)) {
    const gate = evaluateGate(snapshot, { minRemaining: minQuota });
    if (!gate.ok) {
      log(`quota blocked: remaining=${gate.remaining} resetAt=${gate.resetAt}`);
      throw new Error(`Quota exhausted — ask not started. Resets at ${gate.resetAt || 'unknown'}.`);
    }
    if (gate.ok && 'warning' in gate && gate.warning) progress(gate.warning);
  } else {
    log(`quota gate skipped: model ${model} is not premium-metered`);
  }

  const client = new CopilotClient({ workingDirectory: cwd, env: process.env });
  let cleanupDone = false;
  let aborted = false;

  const finalize = async (errorMessage?: string): Promise<void> => {
    if (cleanupDone) return;
    cleanupDone = true;
    try { await client.forceStop(); } catch { /* ignore */ }
    if (errorMessage) process.stderr.write(`Ask failed: ${errorMessage}\n`);
  };

  const onSignal = async (): Promise<void> => {
    if (aborted) return;
    aborted = true;
    progress('Received interrupt; aborting ask.');
    log('interrupt');
    await finalize('Interrupted by signal');
    process.exit(130);
  };
  process.on('SIGINT', () => void onSignal());
  process.on('SIGTERM', () => void onSignal());

  try {
    await client.start();
  } catch (err) {
    const msg = `Failed to start Copilot CLI: ${(err as Error).message}`;
    await finalize(msg);
    throw new Error(msg);
  }

  const auth = await checkAuth(client);
  if (!auth.ok) {
    log(`auth failed: ${auth.message}`);
    const msg = `Not authenticated: ${auth.message}`;
    await finalize(msg);
    await client.stop().catch(() => { /* ignore */ });
    throw new Error(msg);
  }
  log(`auth ok: ${auth.authType}${auth.login ? ` as ${auth.login}` : ''}`);

  const permissionHandler = makePermissionHandler({
    allowShell: false,
    allowUrl: false,
    worktreePath: cwd,
    appendLog: log,
    readOnly: true,
    isolated: true,
  });

  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => { progress(m); log(m); },
  });

  let session;
  try {
    session = await client.createSession({
      clientName: `${CLIENT_NAME}/${PLUGIN_VERSION}`,
      model,
      reasoningEffort: reasoning,
      workingDirectory: cwd,
      infiniteSessions: { enabled: false },
      onPermissionRequest: permissionHandler,
      systemMessage: { mode: 'append', content: buildSystemMessage('ask', { extraContext }) },
    });
  } catch (err) {
    const msg = `Failed to create Copilot session: ${(err as Error).message}`;
    log(msg);
    await client.stop().catch((e) => log(`client.stop warn: ${(e as Error).message}`));
    await finalize(msg);
    throw new Error(msg);
  }

  const stream = attachStream({ session, stateDir, appendLog: log, progress });

  let completionResult: Awaited<typeof stream.completion> | null = null;
  let premiumRequestCost: number | undefined;
  let timedOut = false;
  let sessionTorn = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    progress(`Timeout after ${timeout}ms — aborting session.`);
    log(`timeout ${timeout}ms`);
    session.abort().catch((e) => log(`abort error: ${(e as Error).message}`));
  }, timeout);

  const tearDownSession = async (): Promise<void> => {
    if (sessionTorn) return;
    sessionTorn = true;
    clearTimeout(timeoutHandle);
    await session.disconnect().catch((e) => log(`disconnect warn: ${(e as Error).message}`));
    stream.dispose();
    await fetchQuota(client, stateDir).catch(() => null);
    await client.stop().catch((e) => log(`client.stop warn: ${(e as Error).message}`));
  };

  try {
    progress(`Sending prompt to Copilot (model=${model}, effort=${reasoning})…`);
    await session.send({ prompt });
    completionResult = await stream.completion;
    progress('Answer complete; collecting usage metrics.');
    try {
      const metrics = await session.rpc.usage.getMetrics();
      premiumRequestCost = metrics.totalPremiumRequestCost;
    } catch (e) {
      log(`usage.getMetrics failed: ${(e as Error).message}`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    log(`session error: ${msg}`);
    await tearDownSession();
    await finalize(msg);
    throw new Error(msg);
  } finally {
    await tearDownSession();
  }

  const body =
    stream.getLastAssistantMessage()?.trim() ||
    (completionResult?.summary && completionResult.summary.trim()) ||
    '_(Copilot returned an empty answer.)_';

  const success = completionResult?.success !== false && !timedOut;
  if (!success) {
    const reason = timedOut ? `Timed out after ${timeout}ms.` : 'Ask did not complete successfully.';
    process.stdout.write(`${body}\n`);
    log(`ask failed: ${reason}`);
    throw new Error(reason);
  }

  // Verbatim model answer on stdout.
  process.stdout.write(`${body.trim()}\n`);

  const quotaRemaining = summarize(readSnapshot(stateDir));
  const premium = premiumRequestCost ?? 0;
  progress(`Ask done — model=${model} effort=${reasoning} premium-cost=${fmtNum(premium)}`);
  log(`ask done: premium=${premium}`);
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}
