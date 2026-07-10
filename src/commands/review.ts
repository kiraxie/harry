/**
 * review command — sends a review prompt to Codex and prints the assistant's
 * markdown verbatim (or a structured `reviewed` JSON envelope in --fix mode).
 *
 * Read-only: no worktree, no file writes regardless of path. Default model and
 * reasoning effort differ between the standard / --adversarial / --simplify
 * modes — each lane runs its own model so adversarial/simplify get a genuinely
 * different perspective from standard, not just a different prompt. The whole
 * agent lifecycle (auth, run) is delegated to {@link runAgentSession}; review
 * only supplies the prompt/options and the three output contracts (markdown,
 * `reviewed` envelope, failure text).
 */

import {
  extractJsonBlock,
  FINDINGS_OUTPUT_INSTRUCTION,
  normalizeFindings,
} from "../lib/findings.ts";
import { collectReviewContext, type ReviewScope, resolveReviewTarget } from "../lib/git.ts";
import type { ReasoningEffort, RunResult } from "../lib/provider.ts";
import { buildReviewPrompt, type ReviewKind } from "../lib/review-prompts.ts";
import { runAgentSession } from "../lib/run-agent-session.ts";
import { appendLog, generateJobId, jobLogPath, resolveStateDir } from "../lib/state.ts";
import { buildSystemMessage, resolveExtraContext } from "../lib/system-message.ts";
import { formatCodexUsage, makeProgress, startTurnTimeout } from "../lib/turn-runtime.ts";

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
// gpt-5.3-codex is deprecated by OpenAI for ChatGPT-signed-in Codex sessions;
// gpt-5.6-terra is its balanced-tier successor (GPT-5.5-competitive, lower cost).
const DEFAULT_MODEL_STANDARD = "gpt-5.6-terra";
// Adversarial wants the deepest scrutiny available, so it gets the flagship tier.
const DEFAULT_MODEL_ADVERSARIAL = "gpt-5.6-sol";
// Cleanup lane: codex's code specialization is well-suited to behavior-preserving
// simplification, and keeping it off the adversarial model leaves the design
// lane distinct.
const DEFAULT_MODEL_SIMPLIFY = "gpt-5.6-terra";
const DEFAULT_EFFORT_STANDARD: ReasoningEffort = "xhigh";
const DEFAULT_EFFORT_ADVERSARIAL: ReasoningEffort = "xhigh";
const DEFAULT_EFFORT_SIMPLIFY: ReasoningEffort = "xhigh";

/** Resolve the review kind from the (mutually exclusive) angle flags. */
function resolveKind(options: ReviewOptions): ReviewKind {
  if (options.simplify) return "simplify";
  if (options.adversarial) return "adversarial";
  return "standard";
}

function defaultModelFor(kind: ReviewKind): string {
  if (kind === "adversarial") return DEFAULT_MODEL_ADVERSARIAL;
  if (kind === "simplify") return DEFAULT_MODEL_SIMPLIFY;
  return DEFAULT_MODEL_STANDARD;
}

function defaultEffortFor(kind: ReviewKind): ReasoningEffort {
  if (kind === "adversarial") return DEFAULT_EFFORT_ADVERSARIAL;
  if (kind === "simplify") return DEFAULT_EFFORT_SIMPLIFY;
  return DEFAULT_EFFORT_STANDARD;
}

export async function runReview(cwd: string, options: ReviewOptions = {}): Promise<void> {
  const progress = makeProgress();
  const kind: ReviewKind = resolveKind(options);
  const reasoning = options.reasoning ?? defaultEffortFor(kind);
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  // The model actually sent: explicit --model wins, else the per-lane default.
  const requestedModel = options.model ?? defaultModelFor(kind);

  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
  const log = (msg: string): void => appendLog(stateDir, jobId, msg);
  log(
    `review start: kind=${kind} model=${requestedModel} effort=${reasoning} scope=${options.scope ?? "auto"} base=${options.base ?? "(auto)"}`,
  );

  // 1. Resolve target + collect context (read-only git ops). -----------------
  const target = resolveReviewTarget(cwd, { scope: options.scope, base: options.base });
  const context = collectReviewContext(cwd, target, { shellAvailable: false });

  if (context.fileCount === 0) {
    process.stdout.write(
      `# Review Summary\n\nNo changes to review under ${context.target.label}.\n`,
    );
    log("review aborted: empty target");
    return;
  }

  progress(
    `Target: ${context.target.label} — ${context.fileCount} file(s), ~${context.diffBytes}B diff (${context.inputMode}).`,
  );

  // 2. Build prompt ----------------------------------------------------------
  const fixMode = options.fix === true;
  let prompt = buildReviewPrompt(kind, { context, focusText: options.focusText ?? "" });
  if (fixMode) prompt += `\n${FINDINGS_OUTPUT_INSTRUCTION}`;
  log(`prompt built: ${prompt.length} chars${fixMode ? " (structured findings mode)" : ""}`);

  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => {
      progress(m);
      log(m);
    },
  });

  // 3. Timeout → abort signal. -----------------------------------------------
  const turn = startTurnTimeout({ timeoutMs, progress, log });

  // 4. Run the agent session. -------------------------------------------------
  let result: RunResult;
  try {
    ({ result } = await runAgentSession({
      cwd: context.repoRoot,
      run: {
        cwd: context.repoRoot,
        prompt,
        model: requestedModel,
        reasoning,
        readOnly: true,
        allowShell: false,
        allowUrl: false,
        systemMessage: buildSystemMessage("review", { extraContext }),
        appendLog: log,
        progress,
        signal: turn.signal,
      },
      log,
    }));
  } catch (err) {
    turn.clear();
    const msg = (err as Error).message;
    process.stderr.write(`Review failed: ${msg}\n`);
    log(`review failed: ${msg}`);
    throw err instanceof Error ? err : new Error(msg);
  } finally {
    turn.clear();
  }

  // 5. Compose output --------------------------------------------------------
  // Prefer the verbatim assistant markdown over the structured task_complete
  // summary (which may be a condensed recap and is not emitted by every run).
  const reviewBody =
    result.lastAssistantMessage?.trim() ||
    result.summary?.trim() ||
    "_(The model returned an empty review.)_";

  const success = result.success && !turn.timedOut();
  if (!success) {
    const reason = turn.timedOut()
      ? `Timed out after ${timeoutMs}ms.`
      : "Review did not complete successfully.";
    process.stderr.write(`Review failed: ${reason}\n`);
    process.stdout.write(`# Review Failed\n\n${reason}\n\n${reviewBody}\n`);
    log(`review failed: ${reason}`);
    // Signal failure to callers (background worker / shell exit code).
    // Markdown has already been written to stdout for foreground users.
    throw new Error(reason);
  }

  if (fixMode) {
    // Structured mode: emit a single JSON envelope on stdout so Claude Code can
    // parse the findings, judge each against its conversation context, and pass
    // the approved subset to `fix`. The markdown stays available for humans.
    const findings = normalizeFindings(extractJsonBlock(reviewBody));
    const envelope = {
      status: "reviewed" as const,
      kind,
      model: requestedModel,
      target: context.target.label,
      fileCount: context.fileCount,
      findings,
      reviewMarkdown: reviewBody.trim(),
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
  if (result.usage) {
    const u = result.usage;
    progress(
      `Review done — kind=${kind} model=${requestedModel} effort=${reasoning} files=${context.fileCount} ${formatCodexUsage(u)}`,
    );
    log(
      `review done: kind=${kind} files=${context.fileCount} inputTokens=${u.inputTokens ?? "?"} outputTokens=${u.outputTokens ?? "?"}`,
    );
  } else {
    progress(
      `Review done — kind=${kind} model=${requestedModel} effort=${reasoning} files=${context.fileCount}`,
    );
    log(`review done: kind=${kind} files=${context.fileCount}`);
  }
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}
