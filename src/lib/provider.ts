/**
 * Neutral contract for the Codex-backed agent session, shared by the session
 * runner and command wiring. Keep the names/shapes stable — this is what a
 * fresh implementer/test double must match.
 */

export interface CodexRateLimits {
  primaryUsedPercent?: number;
  secondaryUsedPercent?: number;
  planType?: string;
  resetsAt?: string;
}

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface RunOpts {
  cwd: string;
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
  readOnly: boolean;
  allowShell: boolean;
  allowUrl: boolean;
  systemMessage: string;
  appendLog: (m: string) => void;
  progress: (m: string) => void;
  signal?: AbortSignal;
}

export interface CodexUsage {
  inputTokens?: number;
  outputTokens?: number;
  rateLimits?: CodexRateLimits;
}

export interface RunResult {
  lastAssistantMessage: string;
  success: boolean;
  summary?: string;
  /**
   * Why the run failed, when the turn produced a message. Only ever set
   * alongside `success: false` — `turn.ts` computes success as `!state.error &&
   * …`, so the two cannot both be true.
   *
   * Set on the abort/timeout paths TOO ("Codex turn aborted.", "Codex turn timed
   * out…"), not only on a backend rejection. The commands prefer their own
   * timeout wording when their own clock fired, so they discard it there — that
   * is a display choice, not an absence. Do not read `error` as proof the
   * BACKEND said something.
   *
   * This field exists because without it every command could only report that
   * *something* failed. The backend's actual cause — an upstream 400 like
   * "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT
   * account" — reached the job log and stopped there, so a model rejection and a
   * model that genuinely returned nothing were indistinguishable in the output.
   * That cost real diagnosis time.
   */
  error?: string;
  usage?: CodexUsage;
  codeChanges?: { linesAdded: number; linesRemoved: number; filesModified: string[] };
}

export interface AuthSummary {
  ok: boolean;
  login?: string;
  host?: string;
  message: string;
}

export interface CodexSession {
  checkAuth(cwd: string): Promise<AuthSummary>;
  /**
   * Synchronous capability/permission gate, run by {@link runAgentSession}
   * BEFORE any side-effecting pre-run hook (e.g. fix's pre-fix snapshot commit).
   * Throw to refuse a run codex cannot honor — e.g. write-without-shell.
   */
  precheckRun?(opts: RunOpts): void;
  run(opts: RunOpts): Promise<RunResult>;
  /**
   * Best-effort immediate teardown of the spawned codex subprocess, for use
   * from an interrupt (SIGINT/SIGTERM) handler before the process exits.
   */
  forceStop?(): Promise<void>;
}
