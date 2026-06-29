/**
 * review command — sends a review prompt to a frontier model (Copilot or Codex)
 * and prints the assistant's markdown verbatim (or a structured `reviewed` JSON
 * envelope in --fix mode).
 *
 * Read-only: no worktree, no file writes regardless of path. Default model and
 * reasoning effort differ between the standard / --adversarial / --simplify
 * modes. The whole agent lifecycle (provider resolution, auth, run) is delegated
 * to {@link runAgentSession}; review only supplies the prompt/options, the
 * copilot-only quota gate, the provider-aware default model, and the three
 * output contracts (markdown, `reviewed` envelope, failure text).
 */

import { resolveStateDir, generateJobId, appendLog, jobLogPath } from '../lib/state.js';
import { readSnapshot, evaluateGate, summarize, isPremiumModel, fmtNum } from '../lib/quota.js';
import { resolveReviewTarget, collectReviewContext, type ReviewScope } from '../lib/git.js';
import { buildReviewPrompt, type ReviewKind } from '../lib/review-prompts.js';
import { extractJsonBlock, normalizeFindings, FINDINGS_OUTPUT_INSTRUCTION } from '../lib/findings.js';
import { buildSystemMessage, resolveExtraContext } from '../lib/system-message.js';
import { runAgentSession } from '../lib/run-agent-session.ts';
import type { ProviderId } from '../lib/provider.ts';
import type { ReasoningEffort } from '../lib/provider.ts';

export interface ReviewOptions {
  adversarial?: boolean;
  /** Cleanup/simplification review (codex lane) — behavior-preserving cleanups, not defects. */
  simplify?: boolean;
  scope?: ReviewScope;
  base?: string;
  focusText?: string;
  provider?: ProviderId;
  model?: string;
  reasoning?: ReasoningEffort;
  timeout?: number;
  minQuota?: number;
  /**
   * Extra context appended to the model's system message. Literal text, or
   * `@file` / `@-` (stdin) to read from a source — see `resolveExtraContext`.
   */
  context?: string;
  jobId?: string;
  /**
   * Structured-findings mode. Instead of markdown, emit a `reviewed` JSON
   * envelope (findings + metadata) on stdout so Claude Code can judge each
   * finding and hand the approved subset to the `fix` command.
   */
  fix?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MODEL_STANDARD = 'gpt-5.3-codex';
const DEFAULT_MODEL_ADVERSARIAL = 'gpt-5.5';
// Cleanup lane: codex's code specialization is well-suited to behavior-preserving
// simplification, and keeping it off gpt-5.5 leaves the design lane distinct.
const DEFAULT_MODEL_SIMPLIFY = 'gpt-5.3-codex';
const DEFAULT_EFFORT_STANDARD: ReasoningEffort = 'xhigh';
const DEFAULT_EFFORT_ADVERSARIAL: ReasoningEffort = 'xhigh';
const DEFAULT_EFFORT_SIMPLIFY: ReasoningEffort = 'xhigh';

/** Resolve the review kind from the (mutually exclusive) angle flags. */
function resolveKind(options: ReviewOptions): ReviewKind {
  if (options.simplify) return 'simplify';
  if (options.adversarial) return 'adversarial';
  return 'standard';
}

function defaultModelFor(kind: ReviewKind): string {
  if (kind === 'adversarial') return DEFAULT_MODEL_ADVERSARIAL;
  if (kind === 'simplify') return DEFAULT_MODEL_SIMPLIFY;
  return DEFAULT_MODEL_STANDARD;
}

function defaultEffortFor(kind: ReviewKind): ReasoningEffort {
  if (kind === 'adversarial') return DEFAULT_EFFORT_ADVERSARIAL;
  if (kind === 'simplify') return DEFAULT_EFFORT_SIMPLIFY;
  return DEFAULT_EFFORT_STANDARD;
}

function progressFactory(): (message: string) => void {
  return (message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    process.stderr.write(`[${time}] ${message}\n`);
  };
}

export async function runReview(cwd: string, options: ReviewOptions = {}): Promise<void> {
  const progress = progressFactory();
  const kind: ReviewKind = resolveKind(options);
  const reasoning = options.reasoning ?? defaultEffortFor(kind);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const minQuota = options.minQuota ?? 1;
  // The model copilot WOULD use (for the copilot-only quota pre-gate and the
  // markdown/envelope metadata). The actual model is filled per-provider by
  // runAgentSession's defaultModelFor.
  const copilotModel = options.model ?? defaultModelFor(kind);

  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
  const log = (msg: string): void => appendLog(stateDir, jobId, msg);
  log(`review start: kind=${kind} model=${copilotModel} effort=${reasoning} scope=${options.scope ?? 'auto'} base=${options.base ?? '(auto)'}`);

  // 1. Resolve target + collect context (read-only git ops). -----------------
  const target = resolveReviewTarget(cwd, { scope: options.scope, base: options.base });
  const context = collectReviewContext(cwd, target, { shellAvailable: false });

  if (context.fileCount === 0) {
    process.stdout.write(`# Review Summary\n\nNo changes to review under ${context.target.label}.\n`);
    log('review aborted: empty target');
    return;
  }

  progress(`Target: ${context.target.label} — ${context.fileCount} file(s), ~${context.diffBytes}B diff (${context.inputMode}).`);

  // 2. Build prompt ----------------------------------------------------------
  const fixMode = options.fix === true;
  let prompt = buildReviewPrompt(kind, { context, focusText: options.focusText ?? '' });
  if (fixMode) prompt += `\n${FINDINGS_OUTPUT_INSTRUCTION}`;
  log(`prompt built: ${prompt.length} chars${fixMode ? ' (structured findings mode)' : ''}`);

  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => { progress(m); log(m); },
  });

  // 3. Timeout → abort signal. -----------------------------------------------
  // DEBT: per-call --timeout is honored only by the Copilot provider (via the
  // AbortSignal below). Codex enforces its own turn timeout in runCodexTurn and
  // does not consume this signal, so --timeout is effectively a no-op for codex.
  const abort = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    progress(`Timeout after ${timeout}ms — aborting session.`);
    log(`timeout ${timeout}ms`);
    abort.abort();
  }, timeout);

  // 4. Run the agent session through the resolved provider. ------------------
  let provider: ProviderId;
  let result;
  try {
    ({ provider, result } = await runAgentSession({
      cwd: context.repoRoot,
      flags: { provider: options.provider },
      run: {
        cwd: context.repoRoot,
        prompt,
        model: options.model, // undefined → defaultModelFor fills it per provider
        reasoning,
        readOnly: true,
        allowShell: false,
        allowUrl: false,
        systemMessage: buildSystemMessage('review', { extraContext }),
        appendLog: log,
        progress,
        signal: abort.signal,
      },
      defaultModelFor: (id) => (id === 'copilot' ? defaultModelFor(kind) : undefined),
      enforceQuota: () => {
        // Copilot-only gate, evaluated against the model copilot WOULD use.
        // Standard-tier models (Sonnet/Haiku/GPT-*) don't increment
        // `premium_interactions`, so blocking them when premium is exhausted
        // would be a false negative.
        if (!isPremiumModel(copilotModel)) {
          log(`quota gate skipped: model ${copilotModel} is not premium-metered`);
          return;
        }
        const gate = evaluateGate(readSnapshot(stateDir), { minRemaining: minQuota });
        if (!gate.ok) {
          log(`quota blocked: remaining=${gate.remaining} resetAt=${gate.resetAt}`);
          throw new Error(`Quota exhausted — review not started. Resets at ${gate.resetAt || 'unknown'}.`);
        }
        if ('warning' in gate && gate.warning) progress(gate.warning);
      },
      log,
    }));
  } catch (err) {
    clearTimeout(timeoutHandle);
    const msg = (err as Error).message;
    process.stderr.write(`Review failed: ${msg}\n`);
    log(`review failed: ${msg}`);
    throw err instanceof Error ? err : new Error(msg);
  } finally {
    clearTimeout(timeoutHandle);
  }

  // 5. Compose output --------------------------------------------------------
  // Prefer the verbatim assistant markdown over the structured task_complete
  // summary (which may be a condensed recap and is not emitted by every run).
  const reviewBody =
    result.lastAssistantMessage?.trim() ||
    (result.summary && result.summary.trim()) ||
    '_(The model returned an empty review.)_';

  const success = result.success && !timedOut;
  if (!success) {
    const reason = timedOut ? `Timed out after ${timeout}ms.` : 'Review did not complete successfully.';
    process.stderr.write(`Review failed: ${reason}\n`);
    process.stdout.write(`# Review Failed\n\n${reason}\n\n${reviewBody}\n`);
    log(`review failed: ${reason}`);
    // Signal failure to callers (background worker / shell exit code).
    // Markdown has already been written to stdout for foreground users.
    throw new Error(reason);
  }

  const quotaRemaining = summarize(readSnapshot(stateDir));
  const premium = result.usage?.kind === 'copilot' ? result.usage.premiumRequestCost ?? 0 : 0;
  // The model that actually ran: copilot reports the model it was asked for;
  // codex decides via ~/.codex/config.toml, so surface the requested model or a
  // neutral 'codex' label rather than a copilot default it never used.
  const usedModel = provider === 'copilot' ? copilotModel : options.model ?? 'codex';

  if (fixMode) {
    // Structured mode: emit a single JSON envelope on stdout so Claude Code can
    // parse the findings, judge each against its conversation context, and pass
    // the approved subset to `fix`. The markdown stays available for humans.
    const findings = normalizeFindings(extractJsonBlock(reviewBody));
    const envelope = {
      status: 'reviewed' as const,
      kind,
      model: usedModel,
      target: context.target.label,
      fileCount: context.fileCount,
      findings,
      reviewMarkdown: reviewBody.trim(),
      premiumRequestCost: premium,
      quotaRemaining,
    };
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    log(`review (fix mode) done: ${findings.length} structured finding(s)`);
  } else {
    // Stdout is the model's markdown verbatim — slash-command consumers and
    // anything piping the output should see exactly what the model produced.
    process.stdout.write(`${reviewBody.trim()}\n`);
  }

  // Run metadata goes to stderr (same channel as progress) so foreground users
  // still see it, background workers log it, and stdout stays clean.
  if (result.usage?.kind === 'codex') {
    const u = result.usage;
    const pct = u.rateLimits?.primaryUsedPercent;
    const rate = pct !== undefined ? ` rate-limit=${pct}%` : '';
    progress(
      `Review done — kind=${kind} provider=${provider} effort=${reasoning} files=${context.fileCount} tokens(in/out)=${u.inputTokens ?? '?'}/${u.outputTokens ?? '?'}${rate}`,
    );
    log(`review done: kind=${kind} provider=${provider} files=${context.fileCount} inputTokens=${u.inputTokens ?? '?'} outputTokens=${u.outputTokens ?? '?'}`);
  } else {
    // Render every observed pool — Copilot only meters `premium_interactions`
    // today, but Standard-tier models do not consume it, so a per-pool footer is
    // more honest than a single conflated "remaining" number.
    const poolNote = quotaRemaining.pools.length > 0
      ? quotaRemaining.pools
          .map((p) =>
            p.unlimited
              ? `${p.label}=unlimited`
              : `${p.label}=${fmtNum(p.remaining ?? 0)}/${fmtNum(p.total ?? 0)}`,
          )
          .join(', ')
      : 'no quota snapshot yet';
    progress(
      `Review done — kind=${kind} provider=${provider} model=${usedModel} effort=${reasoning} files=${context.fileCount} premium-cost=${fmtNum(premium)} | ${poolNote}`,
    );
    log(`review done: kind=${kind} provider=${provider} files=${context.fileCount} premium=${premium} pools=${poolNote}`);
  }
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}
