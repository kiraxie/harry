/**
 * Neutral provider contract shared by every backend (Copilot, Codex) and the
 * session runner / command wiring. This is the central interface the whole
 * provider feature is written against — keep the names and shapes stable.
 */

export type ProviderId = "copilot" | "codex";

export interface ProviderCapabilities {
  metersQuota: boolean;
  reportsUsage: boolean;
}

export interface CodexRateLimits {
  primaryUsedPercent?: number;
  secondaryUsedPercent?: number;
  planType?: string;
  resetsAt?: string;
}

export type ProviderEvent =
  | { type: "assistant_message"; content: string }
  | {
      type: "usage";
      copilot?: { cost?: number };
      codex?: { inputTokens?: number; outputTokens?: number; rateLimits?: CodexRateLimits };
    }
  | { type: "tool_start"; name: string }
  | { type: "permission_request"; kind: string; detail?: string }
  | { type: "task_complete"; summary?: string; success?: boolean }
  | { type: "idle" }
  | { type: "error"; message: string }
  | {
      type: "shutdown";
      codeChanges?: { linesAdded: number; linesRemoved: number; filesModified: string[] };
    };

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface RunOpts {
  cwd: string;
  prompt: string;
  model?: string;
  reasoning?: ReasoningEffort;
  readOnly: boolean;
  allowShell: boolean;
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
}

const norm = (v: unknown): string | undefined =>
  typeof v === "string" ? v.trim().toLowerCase() : undefined;

const isId = (v?: string): v is ProviderId => v === "copilot" || v === "codex";

/**
 * Fail-safe sync probe for whether Codex is usable as the implicit default.
 *
 * DEBT: stub that always returns false until Task 3 lands. Task 3's
 * `getCodexAvailability` + auth probe replaces this body. Callers may inject
 * `deps.codexUsable` to override (tests always do), so the real default is
 * never exercised in unit tests. Returning false here keeps the default chain
 * falling back to copilot rather than erroring when uncertain.
 */
function defaultCodexUsable(_cwd: string): boolean {
  return false;
}

/**
 * The authoritative part of resolution: an explicit `--provider` flag, then the
 * user setting (env). Returns the named provider when either explicitly selects
 * one, else undefined (caller falls through to the codex-if-usable default).
 *
 * This is the SINGLE source of the flag>setting precedence — both the sync
 * {@link resolveProvider} and the async session runner build on it, so the
 * "explicit choice is authoritative, no fallback" rule lives in exactly one place.
 */
export function resolveExplicit(flags: { provider?: string }): ProviderId | undefined {
  const flag = norm(flags.provider);
  if (isId(flag)) return flag; // explicit flag, authoritative

  const setting = norm(process.env.CLAUDE_PLUGIN_OPTION_PROVIDER);
  if (isId(setting)) return setting; // user setting, authoritative

  return undefined;
}

/**
 * Resolve the active provider. Precedence:
 *   explicit flag > user setting (env) > codex-if-usable > copilot.
 *
 * A flag/setting that explicitly names a provider is authoritative — there is
 * NO fallback here. If that provider later fails auth/run, the error surfaces
 * at that boundary, not in this resolver.
 */
export function resolveProvider(
  cwd: string,
  flags: { provider?: string },
  deps: { codexUsable?: (cwd: string) => boolean } = {},
): ProviderId {
  const explicit = resolveExplicit(flags);
  if (explicit) return explicit;

  const usable = deps.codexUsable ?? defaultCodexUsable; // default chain
  return usable(cwd) ? "codex" : "copilot";
}
