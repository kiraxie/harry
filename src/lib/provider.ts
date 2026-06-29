/**
 * Neutral provider contract shared by every backend (Copilot, Codex) and the
 * session runner / command wiring. This is the central interface the whole
 * provider feature is written against — keep the names and shapes stable.
 */

export type ProviderId = "copilot" | "codex";

export interface ProviderCapabilities {
  metersQuota: boolean;
}

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

export type ProviderUsage =
  | { kind: "copilot"; premiumRequestCost?: number }
  | { kind: "codex"; inputTokens?: number; outputTokens?: number; rateLimits?: CodexRateLimits };

export interface RunResult {
  lastAssistantMessage: string;
  success: boolean;
  summary?: string;
  usage?: ProviderUsage;
  codeChanges?: { linesAdded: number; linesRemoved: number; filesModified: string[] };
}

/**
 * Neutral auth summary. Intentionally narrower than the Copilot-specific
 * `AuthSummary` in copilot-auth.ts (which carries an `authType`): the
 * CopilotProvider boundary (Task 5) adapts the richer type down to this shape.
 */
export interface AuthSummary {
  ok: boolean;
  login?: string;
  host?: string;
  message: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  checkAuth(cwd: string): Promise<AuthSummary>;
  run(opts: RunOpts): Promise<RunResult>;
  /**
   * Best-effort immediate teardown of any subprocess this provider spawned,
   * for use from an interrupt (SIGINT/SIGTERM) handler before the process
   * exits. Optional: a provider whose subprocess lifecycle is fully owned by
   * its turn runner (e.g. Codex, whose {@link runCodexTurn} bounds its own
   * teardown) may omit it. CopilotProvider implements it to force-stop the
   * Copilot CLI client so an interrupt does not orphan that subprocess.
   */
  forceStop?(): Promise<void>;
}

const norm = (v: unknown): string | undefined =>
  typeof v === "string" ? v.trim().toLowerCase() : undefined;

const isId = (v?: string): v is ProviderId => v === "copilot" || v === "codex";

/**
 * The authoritative part of resolution: an explicit `--provider` flag, then the
 * user setting (env). Returns the named provider when either explicitly selects
 * one, else undefined (caller falls through to the codex-if-usable default,
 * which the async session runner probes since it requires an auth check).
 *
 * This is the SINGLE source of the flag>setting precedence, so the "explicit
 * choice is authoritative, no fallback" rule lives in exactly one place.
 */
export function resolveExplicit(flags: { provider?: string }): ProviderId | undefined {
  const flag = norm(flags.provider);
  if (isId(flag)) return flag; // explicit flag, authoritative

  const setting = norm(process.env.CLAUDE_PLUGIN_OPTION_PROVIDER);
  if (isId(setting)) return setting; // user setting, authoritative

  return undefined;
}
