/**
 * ask command — sends an arbitrary prompt to a frontier model (Copilot or Codex)
 * and prints the assistant's markdown verbatim. Read-only: no worktree, no file
 * writes, no shell. The reasoning backend for the `/copilot:debate` skill's
 * gpt-5.5 voice, and a generic single-prompt query command.
 *
 * The whole agent lifecycle (provider resolution, auth, run) is delegated to
 * {@link runAgentSession}; `ask` only supplies the prompt/options, the
 * copilot-only quota gate, the provider-aware default model, and the stdout
 * contract (the verbatim model answer, which `/debate` depends on).
 */

import { resolveStateDir, generateJobId, appendLog, jobLogPath } from '../lib/state.js';
import { readSnapshot, evaluateGate, isPremiumModel, fmtNum } from '../lib/quota.js';
import { buildSystemMessage, resolveExtraContext } from '../lib/system-message.js';
import { runAgentSession } from '../lib/run-agent-session.ts';
import type { ProviderId } from '../lib/provider.ts';
import type { ReasoningEffort } from './implement.js';

export interface AskOptions {
  prompt: string;
  provider?: ProviderId;
  model?: string;
  reasoning?: ReasoningEffort;
  timeout?: number;
  minQuota?: number;
  context?: string;
  jobId?: string;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
/** Model copilot uses when the caller does not pass --model. Codex passes
 *  undefined so ~/.codex/config.toml decides. */
const COPILOT_DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_EFFORT: ReasoningEffort = 'high';

function progressFactory(): (message: string) => void {
  return (message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    process.stderr.write(`[${time}] ${message}\n`);
  };
}

export async function runAsk(cwd: string, options: AskOptions): Promise<void> {
  const progress = progressFactory();
  const reasoning = options.reasoning ?? DEFAULT_EFFORT;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const minQuota = options.minQuota ?? 1;
  // The model copilot WOULD use (for the copilot-only quota pre-gate). The actual
  // model is filled per-provider by runAgentSession's defaultModelFor.
  const copilotModel = options.model ?? COPILOT_DEFAULT_MODEL;

  const prompt = options.prompt.trim();
  if (!prompt) throw new Error('ask: empty prompt');

  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
  const log = (msg: string): void => appendLog(stateDir, jobId, msg);
  log(`ask start: model=${options.model ?? '(provider default)'} effort=${reasoning} promptChars=${prompt.length}`);

  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => { progress(m); log(m); },
  });

  // DEBT: per-call --timeout is honored only by the Copilot provider (via the
  // AbortSignal below). Codex enforces its own turn timeout in runCodexTurn and
  // does not consume this signal, so --timeout is effectively a no-op for codex.
  // Unify on a single signal-driven timeout once turn.ts accepts a signal.
  const abort = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    progress(`Timeout after ${timeout}ms — aborting session.`);
    log(`timeout ${timeout}ms`);
    abort.abort();
  }, timeout);

  let provider: ProviderId;
  let result;
  try {
    ({ provider, result } = await runAgentSession({
      cwd,
      flags: { provider: options.provider },
      run: {
        cwd,
        prompt,
        model: options.model, // undefined → defaultModelFor fills it per provider
        reasoning,
        readOnly: true,
        allowShell: false,
        allowUrl: false,
        systemMessage: buildSystemMessage('ask', { extraContext }),
        appendLog: log,
        progress,
        signal: abort.signal,
      },
      defaultModelFor: (id) => (id === 'copilot' ? COPILOT_DEFAULT_MODEL : undefined),
      enforceQuota: () => {
        // Copilot-only gate, evaluated against the model copilot WOULD use.
        if (!isPremiumModel(copilotModel)) {
          log(`quota gate skipped: model ${copilotModel} is not premium-metered`);
          return;
        }
        const gate = evaluateGate(readSnapshot(stateDir), { minRemaining: minQuota });
        if (!gate.ok) {
          log(`quota blocked: remaining=${gate.remaining} resetAt=${gate.resetAt}`);
          throw new Error(`Quota exhausted — ask not started. Resets at ${gate.resetAt || 'unknown'}.`);
        }
        if ('warning' in gate && gate.warning) progress(gate.warning);
      },
      log,
    }));
  } catch (err) {
    clearTimeout(timeoutHandle);
    const msg = (err as Error).message;
    process.stderr.write(`Ask failed: ${msg}\n`);
    log(`ask failed: ${msg}`);
    throw err instanceof Error ? err : new Error(msg);
  } finally {
    clearTimeout(timeoutHandle);
  }

  const body =
    result.lastAssistantMessage?.trim() ||
    (result.summary && result.summary.trim()) ||
    '_(The model returned an empty answer.)_';

  const success = result.success && !timedOut;
  if (!success) {
    const reason = timedOut ? `Timed out after ${timeout}ms.` : 'Ask did not complete successfully.';
    // Print the (partial) body before throwing — mirrors prior failure behavior.
    process.stdout.write(`${body}\n`);
    log(`ask failed: ${reason}`);
    throw new Error(reason);
  }

  // Verbatim model answer on stdout — `/debate` depends on this contract.
  process.stdout.write(`${body.trim()}\n`);

  if (result.usage?.kind === 'copilot') {
    const premium = result.usage.premiumRequestCost ?? 0;
    progress(`Ask done — provider=${provider} model=${copilotModel} effort=${reasoning} premium-cost=${fmtNum(premium)}`);
    log(`ask done: provider=${provider} premium=${premium}`);
  } else if (result.usage?.kind === 'codex') {
    const u = result.usage;
    const pct = u.rateLimits?.primaryUsedPercent;
    const rate = pct !== undefined ? ` rate-limit=${pct}%` : '';
    progress(
      `Ask done — provider=${provider} effort=${reasoning} tokens(in/out)=${u.inputTokens ?? '?'}/${u.outputTokens ?? '?'}${rate}`,
    );
    log(`ask done: provider=${provider} inputTokens=${u.inputTokens ?? '?'} outputTokens=${u.outputTokens ?? '?'}`);
  } else {
    progress(`Ask done — provider=${provider} effort=${reasoning}`);
    log(`ask done: provider=${provider}`);
  }
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}
