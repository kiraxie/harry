/**
 * CodexProvider — wraps the Codex app-server turn runner ({@link runCodexTurn})
 * and auth probe ({@link getCodexAuthStatus}) behind the neutral
 * {@link Provider} contract, mirroring {@link CopilotProvider}.
 *
 * This file USES the ported (Apache-2.0) codex lib but is not itself a port — it
 * is original harry glue, so no Apache header.
 *
 * It deliberately does NOT inject a default model (leaving `model` undefined lets
 * `~/.codex/config.toml` decide) and does NOT meter quota — codex is a
 * token/rate-limit backend (`metersQuota: false`), so the caller skips the quota
 * pre-gate. The provider only runs one turn and reports usage.
 */

import { getCodexAuthStatus } from "../codex/auth.ts";
import type { CodexTurnEvent } from "../codex/turn.ts";
import { runCodexTurn } from "../codex/turn.ts";
import type {
  AuthSummary,
  Provider,
  ProviderCapabilities,
  ReasoningEffort,
  RunOpts,
  RunResult,
} from "../provider.ts";
import { resolveStateDir, writeCodexRateLimits } from "../state.ts";

/**
 * Translate the neutral {@link ReasoningEffort} (Copilot's vocabulary) into
 * codex's app-server effort enum (`minimal | low | medium | high`). Codex has no
 * `xhigh`, and `review` defaults every codex lane to `xhigh`, so without this
 * map the most common auto-codex path would send an effort codex may reject.
 * `xhigh` clamps to codex's strongest tier, `high`.
 */
export function toCodexEffort(reasoning?: ReasoningEffort): string | undefined {
  if (reasoning === undefined) return undefined;
  return reasoning === "xhigh" ? "high" : reasoning;
}

export class CodexProvider implements Provider {
  readonly id = "codex" as const;
  readonly capabilities: ProviderCapabilities = {
    metersQuota: false,
  };

  /**
   * Abort handle for the in-flight turn, so {@link forceStop} (driven by the
   * session's centralized SIGINT/SIGTERM handler) can tear the codex child down
   * immediately rather than orphaning it on `process.exit`. Null when idle.
   */
  private activeController: AbortController | null = null;
  /** The in-flight turn promise, awaited by {@link forceStop} so teardown completes. */
  private activeRun: Promise<unknown> | null = null;

  /**
   * Best-effort immediate teardown from an interrupt — abort the live turn AND
   * await it so the codex child is actually reaped before this resolves.
   * Returning early (abort only) would let the session's interrupt handler
   * `process.exit` before close() kills the child, orphaning it; CopilotProvider
   * awaits its teardown the same way.
   */
  async forceStop(): Promise<void> {
    this.activeController?.abort();
    await this.activeRun?.catch(() => {});
  }

  /**
   * Trust boundary (fail-closed): codex's sandbox is COARSE — a write-enabled
   * turn is `workspace-write` + approvalPolicy:"never", which lets codex run
   * shell commands autonomously. It has no "write files but no shell" mode, so a
   * caller that grants writes while withholding shell (`fix` defaults to
   * allowShell:false) CANNOT be honored. Refuse rather than silently run MORE
   * permissively than asked. Runs via the precheckRun seam BEFORE fix's snapshot.
   */
  precheckRun(opts: RunOpts): void {
    if (!opts.readOnly && !opts.allowShell) {
      throw new Error(
        "Codex cannot grant write access without also allowing shell commands " +
          "(its workspace-write sandbox runs commands autonomously). Re-run with " +
          "--provider copilot, or explicitly allow shell.",
      );
    }
  }

  /**
   * Probe codex auth without running a turn. Codex has no login/host concept in
   * the neutral summary, so those stay undefined; `message` carries the codex
   * detail string ("ChatGPT login active for …", "… requires OpenAI auth", etc).
   */
  async checkAuth(cwd: string): Promise<AuthSummary> {
    const s = await getCodexAuthStatus(cwd);
    return { ok: s.loggedIn, message: s.detail };
  }

  /**
   * Run a single prompt to completion. Streams turn events to progress/appendLog
   * for visibility (never throwing on a stream event), then maps the
   * {@link CodexTurnResult} onto the neutral {@link RunResult}.
   *
   * `opts.reasoning` is mapped to codex's effort enum via {@link toCodexEffort}
   * (xhigh→high, since codex has no xhigh). `opts.model` is passed through as-is;
   * undefined stays undefined so ~/.codex config picks the model.
   */
  async run(opts: RunOpts): Promise<RunResult> {
    const { appendLog, progress } = opts;

    // Defense in depth: the same fail-closed gate runAgentSession runs via
    // precheckRun, in case run() is ever reached directly.
    this.precheckRun(opts);
    // NOTE: opts.allowUrl is not mapped to codex network access yet; codex's
    // workspace-write sandbox keeps network OFF by default, so we under-grant
    // (deny URL even when allowed) — the safe direction. Enabling it needs the
    // app-server sandbox-network param confirmed against a live codex.

    const onItem = (ev: CodexTurnEvent): void => {
      switch (ev.kind) {
        case "assistant":
          if (ev.text) progress(ev.text);
          break;
        case "tool":
          progress(ev.label);
          break;
        case "reasoning":
          if (ev.text) appendLog(`reasoning: ${ev.text}`);
          break;
        case "usage":
          appendLog(
            `usage: in=${ev.inputTokens ?? "?"} out=${ev.outputTokens ?? "?"}` +
              (ev.rateLimits?.primaryUsedPercent !== undefined
                ? ` primary=${ev.rateLimits.primaryUsedPercent}%`
                : ""),
          );
          break;
        case "error":
          appendLog(`codex error: ${ev.message}`);
          break;
        default:
          break;
      }
    };

    progress(`Sending prompt to Codex${opts.model ? ` (model=${opts.model})` : ""}…`);

    // Link the caller's signal (if any) and forceStop() into one controller the
    // turn runner aborts on, so a SIGINT mid-turn tears the codex child down.
    const controller = new AbortController();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    this.activeController = controller;

    let result: Awaited<ReturnType<typeof runCodexTurn>>;
    const turnPromise = runCodexTurn({
      cwd: opts.cwd,
      prompt: opts.prompt,
      // Carry guardrails + injected --context into the turn (codex has no
      // separate system slot; turn.ts rides them as a leading input block).
      instructions: opts.systemMessage,
      model: opts.model,
      effort: toCodexEffort(opts.reasoning),
      readOnly: opts.readOnly,
      env: process.env,
      onItem,
      signal: controller.signal,
    });
    this.activeRun = turnPromise;
    try {
      result = await turnPromise;
    } finally {
      this.activeController = null;
      this.activeRun = null;
    }

    if (result.error) appendLog(`turn error: ${result.error}`);

    // Persist the rate-limit snapshot (best-effort) so `status` can render it
    // from cache without a live codex RPC. writeCodexRateLimits never throws.
    if (result.usage?.rateLimits) {
      writeCodexRateLimits(resolveStateDir(opts.cwd), result.usage.rateLimits);
    }

    // DEBT: codeChanges is always undefined — the turn runner does not collect
    // file changes in v1 (codex write-flows are out of scope). A future codex
    // implement/fix path would need fileChange collection in turn.ts and a
    // {linesAdded, linesRemoved, filesModified} accumulator surfaced here.
    return {
      lastAssistantMessage: result.finalMessage,
      success: result.success,
      summary: result.finalMessage || undefined,
      usage: {
        kind: "codex",
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        rateLimits: result.usage?.rateLimits,
      },
    };
  }
}
