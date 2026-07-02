/**
 * Shared turn-runtime helpers for the agent commands (ask / review / fix).
 *
 * These were previously copy-pasted verbatim across the three command modules
 * (progress writer, the timeout→abort scaffold with its DEBT note, and the
 * codex usage footer). Centralizing them removes the triplication that let the
 * background worker silently drift from the foreground dispatcher.
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
