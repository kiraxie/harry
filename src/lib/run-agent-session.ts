/**
 * runAgentSession — the single lifecycle every agent command (ask/review/fix)
 * calls. It resolves the provider ONCE, auth-checks, runs the copilot-only quota
 * gate, runs the provider, and returns the neutral result. This is also where the
 * async "is codex usable as the implicit default" probe lives (the sync
 * `resolveProvider` in provider.ts cannot await an auth check).
 */

import { getCodexAuthStatus, getCodexAvailability } from "./codex/auth.ts";
import {
  resolveExplicit,
  type Provider,
  type ProviderId,
  type RunOpts,
  type RunResult,
} from "./provider.ts";

/**
 * Async "is codex actually usable as the implicit default": installed AND logged
 * in. Never throws — any failure resolves to false so the default chain falls
 * back to copilot rather than erroring when uncertain. Uses the ambient
 * environment by default.
 */
export async function probeCodexUsable(cwd: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    if (!getCodexAvailability(cwd).available) return false;
    return (await getCodexAuthStatus(cwd, { env })).loggedIn;
  } catch {
    return false;
  }
}

export interface RunAgentSessionArgs {
  cwd: string;
  flags: { provider?: string };
  run: RunOpts;
  // Injectable seams for tests:
  /** Build the concrete provider for an id. Defaults to the real Copilot/Codex providers. */
  pickProvider?: (id: ProviderId) => Provider;
  /** The async codex-usable probe for the implicit default. Defaults to {@link probeCodexUsable}. */
  resolveUsable?: (cwd: string) => Promise<boolean>;
  /** Copilot-only quota pre-gate; invoked only when the provider meters quota. */
  enforceQuota?: (provider: Provider) => void | Promise<void>;
  /**
   * Provider-aware default model, applied only when `run.model` is undefined.
   * Lets the COMMAND supply the per-provider default (e.g. copilot → 'gpt-5.5',
   * codex → undefined so ~/.codex/config.toml decides) after the id is resolved.
   */
  defaultModelFor?: (id: ProviderId) => string | undefined;
  log?: (m: string) => void;
}

export async function runAgentSession(
  args: RunAgentSessionArgs,
): Promise<{ provider: ProviderId; result: RunResult }> {
  const explicit = resolveExplicit(args.flags);
  const id: ProviderId =
    explicit ?? ((await (args.resolveUsable ?? probeCodexUsable)(args.cwd)) ? "codex" : "copilot");
  args.log?.(`provider resolved: ${id}${explicit ? " (explicit)" : " (auto)"}`);

  const provider = args.pickProvider ? args.pickProvider(id) : await defaultPick(id);

  const auth = await provider.checkAuth(args.cwd);
  if (!auth.ok) {
    // Explicit choice that fails auth surfaces the error (NO fallback). An
    // auto-resolved codex would already have probed loggedIn, so reaching here
    // is a real failure either way.
    throw new Error(`${id} not authenticated: ${auth.message}`);
  }

  if (provider.capabilities.metersQuota && args.enforceQuota) {
    await args.enforceQuota(provider);
  }

  // Apply the provider-aware default model only when the caller left it unset,
  // so an explicit --model always wins and codex can keep model undefined.
  if (args.run.model === undefined && args.defaultModelFor) {
    args.run = { ...args.run, model: args.defaultModelFor(id) };
  }

  const result = await provider.run(args.run);
  return { provider: id, result };
}

/**
 * Default provider factory. Loads the concrete provider module lazily so a run
 * only pulls in the backend it actually uses (e.g. a codex run never loads the
 * Copilot SDK) and unit tests injecting `pickProvider` never load either.
 */
async function defaultPick(id: ProviderId): Promise<Provider> {
  if (id === "codex") {
    const { CodexProvider } = await import("./providers/codex.ts");
    return new CodexProvider();
  }
  const { CopilotProvider } = await import("./providers/copilot.ts");
  return new CopilotProvider();
}
