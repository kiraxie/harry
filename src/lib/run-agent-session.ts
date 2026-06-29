/**
 * runAgentSession — the single lifecycle every agent command (ask/review/fix)
 * calls. It resolves the provider ONCE, auth-checks, runs the copilot-only quota
 * gate, runs the provider, and returns the neutral result. This is also where the
 * async "is codex usable as the implicit default" probe lives (the sync
 * `resolveExplicit` in provider.ts only handles the flag/setting precedence and
 * cannot await an auth check).
 */

import { getCodexAuthStatus } from "./codex/auth.ts";
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
 *
 * `getCodexAuthStatus` itself probes availability first and short-circuits to
 * `loggedIn:false` when codex is not installed, so we do NOT re-run
 * `getCodexAvailability` here (that doubled the `codex --version` /
 * `codex app-server --help` spawns on every auto-resolved run).
 */
export async function probeCodexUsable(cwd: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    return (await getCodexAuthStatus(cwd, { env })).loggedIn;
  } catch {
    return false;
  }
}

/**
 * The ONE provider-resolution authority every provider-facing entry point
 * (ask/review/fix via {@link runAgentSession}, and setup/status) must call, so
 * resolution can never silently diverge: an explicit `--provider` flag or the
 * `CLAUDE_PLUGIN_OPTION_PROVIDER` setting wins (via {@link resolveExplicit});
 * otherwise codex is the default IFF it is installed and logged in, else
 * copilot. Pass `probe` to override the codex-usable check (tests; or a setup
 * `--check` that wants to stay cheap by skipping the spawn).
 */
export async function resolveActiveProvider(
  flags: { provider?: string },
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv; probe?: (cwd: string) => Promise<boolean> } = {},
): Promise<{ id: ProviderId; explicit: boolean }> {
  const explicit = resolveExplicit(flags);
  if (explicit) return { id: explicit, explicit: true };
  const probe = opts.probe ?? ((c: string) => probeCodexUsable(c, opts.env));
  return { id: (await probe(cwd)) ? "codex" : "copilot", explicit: false };
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
   * Post-gate / pre-run hook, invoked AFTER the quota gate passes and just
   * BEFORE `provider.run`. Lets a command perform side effects that must not
   * happen when the run is blocked — e.g. `fix`'s pre-fix snapshot commit, which
   * would otherwise mutate git history even when the quota gate blocks the run.
   */
  beforeRun?: (provider: Provider) => void | Promise<void>;
  /**
   * Provider-aware default model, applied only when `run.model` is undefined.
   * Lets the COMMAND supply the per-provider default (e.g. copilot → 'gpt-5.5',
   * codex → undefined so ~/.codex/config.toml decides) after the id is resolved.
   */
  defaultModelFor?: (id: ProviderId) => string | undefined;
  /**
   * Command-specific reaction to a SIGINT/SIGTERM that arrives mid-run, invoked
   * synchronously by the centralized interrupt handler BEFORE the provider is
   * force-stopped and the process exits 130. Use it to flush a command's stdout
   * contract (e.g. `fix`'s terminal `failed` envelope). Do NOT call
   * `process.exit` here — the handler owns the exit.
   */
  onInterrupt?: () => void;
  log?: (m: string) => void;
}

/** Hard ceiling on interrupt teardown so a wedged forceStop cannot hang exit. */
const INTERRUPT_TEARDOWN_CEILING_MS = 2000;

export async function runAgentSession(
  args: RunAgentSessionArgs,
): Promise<{ provider: ProviderId; result: RunResult }> {
  // Centralized interrupt handling, installed across the WHOLE session span
  // (resolution → auth → quota gate → run), not just the run: a command's
  // `onInterrupt` (e.g. fix's terminal `failed` envelope) and the live
  // provider's forceStop must fire for an interrupt anywhere in here, including
  // the multi-second auth/probe window that spawns subprocesses. `activeProvider`
  // is assigned once the provider exists; forceStop is skipped before then.
  // This is also where the interrupt-time forceStop (dropped in the refactor,
  // which orphaned Copilot subprocesses) is centralized for ALL commands.
  let activeProvider: Provider | undefined;
  const onInterrupt = (): void => {
    args.onInterrupt?.();
    const exit = (): never => process.exit(130);
    const guard = setTimeout(exit, INTERRUPT_TEARDOWN_CEILING_MS);
    guard.unref();
    void Promise.resolve(activeProvider?.forceStop?.())
      .catch(() => {
        /* best-effort teardown */
      })
      .finally(exit);
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);

  try {
    const { id, explicit } = await resolveActiveProvider(args.flags, args.cwd, {
      probe: args.resolveUsable,
    });
    args.log?.(`provider resolved: ${id}${explicit ? " (explicit)" : " (auto)"}`);

    const provider = args.pickProvider ? args.pickProvider(id) : await defaultPick(id);
    activeProvider = provider;

    // DEBT: copilot double-auths — runAgentSession.checkAuth here and again inside
    // CopilotProvider.run()'s session start. Perf only (one extra auth probe), no
    // correctness impact; collapse if it ever shows up on the hot path.
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

    // Post-gate / pre-run hook: side effects (e.g. fix's pre-fix snapshot) that
    // must NOT run when the quota gate above blocked the run.
    await args.beforeRun?.(provider);
    const result = await provider.run(args.run);
    return { provider: id, result };
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
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
