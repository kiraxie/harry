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
import { resolveStateDir, writeCodexRateLimits } from "../state.ts";
import { runCodexTurn } from "../codex/turn.ts";
import type { CodexTurnEvent } from "../codex/turn.ts";
import type {
  AuthSummary,
  Provider,
  ProviderCapabilities,
  RunOpts,
  RunResult,
} from "../provider.ts";

export class CodexProvider implements Provider {
  readonly id = "codex" as const;
  readonly capabilities: ProviderCapabilities = {
    metersQuota: false,
    reportsUsage: true,
  };

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
   * `opts.reasoning` is passed through as codex's `effort` (best-effort — codex
   * resolves or ignores unknown values). `opts.model` is passed through as-is;
   * undefined stays undefined so ~/.codex config picks the model.
   */
  async run(opts: RunOpts): Promise<RunResult> {
    const { appendLog, progress } = opts;

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

    const result = await runCodexTurn({
      cwd: opts.cwd,
      prompt: opts.prompt,
      model: opts.model,
      effort: opts.reasoning,
      readOnly: opts.readOnly,
      env: process.env,
      onItem,
    });

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
