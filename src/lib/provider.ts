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
   * Why the run failed, when the backend said. Set only alongside
   * `success: false`, and absent when the failure carries no cause (a timeout is
   * observed by the caller's own clock, not reported by the backend).
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
