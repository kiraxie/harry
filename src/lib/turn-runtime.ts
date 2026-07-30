/**
 * Shared turn-runtime helpers for the agent commands (ask / review / fix).
 *
 * Three of these were previously copy-pasted verbatim across the three command
 * modules (progress writer, the timeout→abort scaffold with its DEBT note, and
 * the codex usage footer); centralizing them removed the triplication that let
 * the three commands silently drift from each other. `withCause` was never
 * duplicated — it starts here, for the same reason: one rule about how a failure
 * is presented, shared by all three.
 */

import { truncateUtf8 } from "./git.ts";
import type { CodexRateLimits } from "./provider.ts";

/** Timestamped stderr progress writer. No-op-free: every line is flushed. */
export function makeProgress(): (message: string) => void {
  return (message: string) => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    process.stderr.write(`[${time}] ${message}\n`);
  };
}

export interface TurnTimeout {
  /** Abort signal threaded into RunOpts.signal. */
  signal: AbortSignal;
  /** Whether the timeout has fired. */
  timedOut: () => boolean;
  /** Cancel the timer (idempotent). Call in finally and on success. */
  clear: () => void;
}

/**
 * Arm a per-call timeout that aborts the run when it elapses.
 *
 * CodexProvider links the signal into runCodexTurn (which tears the codex
 * child down). Codex additionally enforces its own internal turn ceiling, so
 * whichever fires first ends the turn.
 */
export function startTurnTimeout(opts: {
  timeoutMs: number;
  progress: (message: string) => void;
  log: (message: string) => void;
}): TurnTimeout {
  const abort = new AbortController();
  let firedTimeout = false;
  const handle = setTimeout(() => {
    firedTimeout = true;
    opts.progress(`Timeout after ${opts.timeoutMs}ms reached — requesting abort.`);
    opts.log(`timeout ${opts.timeoutMs}ms`);
    abort.abort();
  }, opts.timeoutMs);
  return {
    signal: abort.signal,
    timedOut: () => firedTimeout,
    clear: () => clearTimeout(handle),
  };
}

/**
 * Format the codex token/rate-limit footer fragment shared by ask and review,
 * e.g. `tokens(in/out)=12/34 rate-limit=42%`.
 */
export function formatCodexUsage(u: {
  inputTokens?: number;
  outputTokens?: number;
  rateLimits?: CodexRateLimits;
}): string {
  const pct = u.rateLimits?.primaryUsedPercent;
  const rate = pct !== undefined ? ` rate-limit=${pct}%` : "";
  return `tokens(in/out)=${u.inputTokens ?? "?"}/${u.outputTokens ?? "?"}${rate}`;
}

/**
 * Frame a command's generic failure sentence with the backend's cause, when
 * there is one.
 *
 * Shared rather than inlined three times because it is one rule about how a
 * cause is presented, and three copies would let ask/review/fix drift into
 * reporting the same failure differently — the triplication this module exists
 * to end.
 *
 * The generic sentence is KEPT as the prefix, not replaced. It is what the doors
 * and any shell consumer see first, and an upstream message alone ("The
 * 'gpt-5.6-sol' model is not supported…") does not say which command failed.
 * A cause that is blank or whitespace is treated as absent, so a provider
 * setting `error: ""` cannot produce a dangling colon.
 *
 * BOUNDED, and this is the presentation boundary on purpose. `turn.ts`'s
 * `failure()` folds the codex child's whole stderr buffer into the cause, and
 * that buffer accumulates unbounded (`app-server.ts`'s `stderrBuffer += chunk`).
 * On the DEFAULT hang path — the turn's own 15-minute ceiling always fires before
 * a command's 30-minute one, since the provider passes no `timeoutMs` — that is
 * tens of kilobytes of child output. It must not all land inside ask's
 * `# Ask Failed` block, which the doors return verbatim and `/debate` folds into
 * another model's context.
 *
 * Capping HERE rather than at the provider keeps `RunResult.error` full-fidelity
 * for the job log, which is where the rest belongs. The cut is taken off the TAIL
 * so the upstream message — always first, because `failure()` puts the reason
 * ahead of the stderr — survives intact; an earlier version of this argued a cap
 * would be "most likely to cut it off", which had the direction backwards.
 *
 * Named `withCause` rather than the obvious `failureReason` because `git.ts`
 * already has a private `failureReason(result)` that answers a different question
 * (why a git spawn failed). Two same-named helpers meaning different things is a
 * grep that lies; esbuild renaming one to `failureReason2` in the bundle is what
 * surfaced it.
 */
const MAX_CAUSE_BYTES = 4096;

export function withCause(generic: string, cause?: string): string {
  const trimmed = cause?.trim();
  if (!trimmed) return generic;
  const { text, truncated } = truncateUtf8(trimmed, MAX_CAUSE_BYTES);
  // Say the cut happened and where the rest is. A silently clipped diagnostic is
  // worse than a short one: the reader cannot tell whether the cause ended there.
  const shown = truncated ? `${text}\n… (cause truncated; full text in the job log)` : text;
  // Strip a trailing period off the generic so the joined sentence does not read
  // "…successfully.: cause".
  return `${generic.replace(/\.$/, "")}: ${shown}`;
}
