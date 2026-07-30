/**
 * Shared turn-runtime helpers for the agent commands (ask / review / fix).
 *
 * These were previously copy-pasted verbatim across the three command modules
 * (progress writer, the timeout→abort scaffold with its DEBT note, and the
 * codex usage footer). Centralizing them removes the triplication that let the
 * three commands silently drift from each other.
 */

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
 * Named `withCause` rather than the obvious `failureReason` because `git.ts`
 * already has a private `failureReason(result)` that answers a different question
 * (why a git spawn failed). Two same-named helpers meaning different things is a
 * grep that lies; esbuild renaming one to `failureReason2` in the bundle is what
 * surfaced it.
 */
export function withCause(generic: string, cause?: string): string {
  const trimmed = cause?.trim();
  if (!trimmed) return generic;
  // Strip a trailing period off the generic so the joined sentence does not read
  // "…successfully.: cause".
  return `${generic.replace(/\.$/, "")}: ${trimmed}`;
}
