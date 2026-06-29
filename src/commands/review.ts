/**
 * review command — sends a review prompt to GitHub Copilot and prints the
 * assistant's markdown verbatim.
 *
 * Read-only: no worktree, permission handler in readOnly mode (writes denied
 * regardless of path). Default model and reasoning effort differ between the
 * standard and --adversarial modes.
 */

import { CopilotClient } from '@github/copilot-sdk';

import { resolveStateDir, generateJobId, appendLog, jobLogPath } from '../lib/state.js';
import { readSnapshot, evaluateGate, summarize, isPremiumModel, fetchQuota, fmtNum } from '../lib/quota.js';
import { checkAuth } from '../lib/copilot-auth.js';
import { makePermissionHandler } from '../lib/permission.js';
import { attachStream } from '../lib/event-stream.js';
import { resolveReviewTarget, collectReviewContext, type ReviewScope } from '../lib/git.js';
import { buildReviewPrompt, type ReviewKind } from '../lib/review-prompts.js';
import { extractJsonBlock, normalizeFindings, FINDINGS_OUTPUT_INSTRUCTION } from '../lib/findings.js';
import { buildSystemMessage, resolveExtraContext } from '../lib/system-message.js';
import { CLIENT_NAME, PLUGIN_VERSION } from '../lib/version.js';
import type { ReasoningEffort } from './implement.js';

export interface ReviewOptions {
  adversarial?: boolean;
  /** Cleanup/simplification review (codex lane) — behavior-preserving cleanups, not defects. */
  simplify?: boolean;
  scope?: ReviewScope;
  base?: string;
  focusText?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  timeout?: number;
  minQuota?: number;
  /**
   * Extra context appended to Copilot's system message. Literal text, or `@file`
   * / `@-` (stdin) to read from a source — see `resolveExtraContext`.
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
  const model = options.model ?? defaultModelFor(kind);
  const reasoning = options.reasoning ?? defaultEffortFor(kind);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const minQuota = options.minQuota ?? 1;

  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
  const log = (msg: string): void => appendLog(stateDir, jobId, msg);
  log(`review start: kind=${kind} model=${model} effort=${reasoning} scope=${options.scope ?? 'auto'} base=${options.base ?? '(auto)'}`);

  // 1. Resolve target + collect context (read-only git ops). -----------------
  const target = resolveReviewTarget(cwd, { scope: options.scope, base: options.base });
  const context = collectReviewContext(cwd, target, { shellAvailable: false });

  if (context.fileCount === 0) {
    process.stdout.write(`# Review Summary\n\nNo changes to review under ${context.target.label}.\n`);
    log('review aborted: empty target');
    return;
  }

  progress(`Target: ${context.target.label} — ${context.fileCount} file(s), ~${context.diffBytes}B diff (${context.inputMode}).`);

  // 2. Quota gate — only block when the chosen model actually consumes the
  //    premium request pool. Standard-tier models (Sonnet/Haiku/GPT-*) don't
  //    increment `premium_interactions`, so blocking them when premium is
  //    exhausted would be a false negative.
  const snapshot = readSnapshot(stateDir);
  if (isPremiumModel(model)) {
    const gate = evaluateGate(snapshot, { minRemaining: minQuota });
    if (!gate.ok) {
      log(`quota blocked: remaining=${gate.remaining} resetAt=${gate.resetAt}`);
      throw new Error(`Quota exhausted — review not started. Resets at ${gate.resetAt || 'unknown'}.`);
    }
    if (gate.ok && 'warning' in gate && gate.warning) progress(gate.warning);
  } else {
    log(`quota gate skipped: model ${model} is not premium-metered`);
  }

  // 3. Build prompt ----------------------------------------------------------
  const fixMode = options.fix === true;
  let prompt = buildReviewPrompt(kind, { context, focusText: options.focusText ?? '' });
  if (fixMode) prompt += `\n${FINDINGS_OUTPUT_INSTRUCTION}`;
  log(`prompt built: ${prompt.length} chars${fixMode ? ' (structured findings mode)' : ''}`);

  // 4. Copilot client (read-only) --------------------------------------------
  const client = new CopilotClient({ workingDirectory: context.repoRoot, env: process.env });
  let cleanupDone = false;
  let aborted = false;

  const finalize = async (errorMessage?: string): Promise<void> => {
    if (cleanupDone) return;
    cleanupDone = true;
    try { await client.forceStop(); } catch { /* ignore */ }
    if (errorMessage) {
      process.stderr.write(`Review failed: ${errorMessage}\n`);
    }
  };

  const onSignal = async (): Promise<void> => {
    if (aborted) return;
    aborted = true;
    progress('Received interrupt; aborting review.');
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

  // 5. Session: read-only permission handler ---------------------------------
  const permissionHandler = makePermissionHandler({
    allowShell: false,
    allowUrl: false,
    worktreePath: context.repoRoot,
    appendLog: log,
    readOnly: true,
  });

  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => { progress(m); log(m); },
  });

  // Wrap createSession so a model/parameter error (after client.start
  // succeeds) still releases the Copilot client.
  let session;
  try {
    session = await client.createSession({
      clientName: `${CLIENT_NAME}/${PLUGIN_VERSION}`,
      model,
      reasoningEffort: reasoning,
      workingDirectory: context.repoRoot,
      infiniteSessions: { enabled: false },
      onPermissionRequest: permissionHandler,
      systemMessage: {
        mode: 'append',
        content: buildSystemMessage('review', { extraContext }),
      },
    });
  } catch (err) {
    const msg = `Failed to create Copilot session: ${(err as Error).message}`;
    log(msg);
    await client.stop().catch((e) => log(`client.stop warn: ${(e as Error).message}`));
    await finalize(msg);
    throw new Error(msg);
  }

  const stream = attachStream({ session, stateDir, appendLog: log, progress });

  // 6. Send + wait — every failure path between here and shutdown collection
  //    must release the session, stream listeners, and the Copilot client.
  let completionResult: Awaited<typeof stream.completion> | null = null;
  let shutdownResult: Awaited<typeof stream.shutdown> | null = null;
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
    // Refresh quota while the client is still live (SDK no longer pushes it).
    await fetchQuota(client, stateDir).catch(() => null);
    await client.stop().catch((e) => log(`client.stop warn: ${(e as Error).message}`));
  };

  try {
    progress(`Sending ${kind} review prompt to Copilot (model=${model}, effort=${reasoning})…`);
    await session.send({ prompt });
    completionResult = await stream.completion;
    progress('Review complete; collecting usage metrics.');
    // Premium cost via session usage metrics while the session is alive.
    try {
      const metrics = await session.rpc.usage.getMetrics();
      premiumRequestCost = metrics.totalPremiumRequestCost;
    } catch (e) {
      log(`usage.getMetrics failed: ${(e as Error).message}`);
    }
    // Disconnect before waiting for shutdown so the SDK flushes its final event.
    await session.disconnect().catch((e) => log(`disconnect warn: ${(e as Error).message}`));
    shutdownResult = await Promise.race([
      stream.shutdown,
      new Promise<null>((res) => setTimeout(() => res(null), 5000)),
    ]);
  } catch (err) {
    const msg = (err as Error).message;
    log(`session error: ${msg}`);
    await tearDownSession();
    await finalize(msg);
    throw new Error(msg);
  } finally {
    await tearDownSession();
  }

  // 7. Compose markdown output ----------------------------------------------
  // For review we want the verbatim assistant markdown, not the structured
  // `session.task_complete.summary` (which may be a condensed recap and is
  // not even emitted by every model run). Prefer the last assistant message;
  // fall back to the structured summary only when no message was captured.
  const reviewBody =
    stream.getLastAssistantMessage()?.trim() ||
    (completionResult?.summary && completionResult.summary.trim()) ||
    '_(Copilot returned an empty review.)_';

  const success = completionResult?.success !== false && !timedOut;
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
  const premium = premiumRequestCost ?? shutdownResult?.premiumRequestCost ?? 0;
  const usedModel = shutdownResult?.currentModel ?? model;

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
    // Stdout is Copilot's markdown verbatim — slash-command consumers and
    // anything piping the output should see exactly what the model produced.
    process.stdout.write(`${reviewBody.trim()}\n`);
  }

  // Run metadata goes to stderr (same channel as progress) so foreground users
  // still see it, background workers log it, and stdout stays clean. Render
  // every observed pool — Copilot only meters `premium_interactions` today,
  // but Standard-tier models do not consume it, so a per-pool footer is more
  // honest than a single conflated "remaining" number.
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
    `Review done — kind=${kind} model=${usedModel} effort=${reasoning} files=${context.fileCount} premium-cost=${fmtNum(premium)} | ${poolNote}`,
  );
  log(`review done: kind=${kind} files=${context.fileCount} premium=${premium} pools=${poolNote}`);
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}
