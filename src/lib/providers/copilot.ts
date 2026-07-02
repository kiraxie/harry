/**
 * CopilotProvider — wraps harry's existing GitHub Copilot SDK session lifecycle
 * behind the neutral {@link Provider} contract.
 *
 * This is a refactor: the lifecycle (client construction, start, auth, session
 * creation, event-stream attach, send, completion, usage metrics, teardown) is
 * lifted verbatim in behavior from the prior inline `ask` lifecycle. It
 * deliberately does NOT decide model/effort defaults or perform quota gating —
 * the caller (runAgentSession) owns those.
 * The provider only runs the session and reports usage.
 */

import { CopilotClient } from "@github/copilot-sdk";

import { checkAuth as checkCopilotAuth } from "../copilot-auth.js";
import { attachStream } from "../event-stream.js";
import { makePermissionHandler } from "../permission.js";
import type {
  AuthSummary,
  Provider,
  ProviderCapabilities,
  RunOpts,
  RunResult,
} from "../provider.ts";
import { fetchQuota } from "../quota.js";
import { resolveStateDir } from "../state.js";
import { CLIENT_NAME, PLUGIN_VERSION } from "../version.js";

/** How long to wait for the post-disconnect `session.shutdown` event. */
const SHUTDOWN_WAIT_MS = 5000;

export class CopilotProvider implements Provider {
  readonly id = "copilot" as const;
  readonly capabilities: ProviderCapabilities = {
    metersQuota: true,
  };

  /**
   * The live client for the in-flight run, so {@link forceStop} (called from the
   * centralized SIGINT/SIGTERM handler in runAgentSession) can force-stop the
   * Copilot CLI subprocess instead of letting an interrupt orphan it. Set at the
   * start of {@link run} and cleared on teardown.
   */
  private activeClient: CopilotClient | null = null;

  /**
   * Best-effort immediate teardown of the in-flight Copilot CLI client, for an
   * interrupt handler. Never throws.
   */
  async forceStop(): Promise<void> {
    await this.activeClient?.forceStop().catch(() => {
      /* ignore */
    });
  }

  /**
   * Probe Copilot auth without running a session. Constructs a client, starts
   * it, queries the SDK's richer auth summary, and adapts it down to the
   * neutral {@link AuthSummary} (dropping `authType`). Always stops the client.
   */
  async checkAuth(cwd: string): Promise<AuthSummary> {
    const client = new CopilotClient({ workingDirectory: cwd, env: process.env });
    try {
      await client.start();
    } catch (err) {
      return { ok: false, message: `Failed to start Copilot CLI: ${(err as Error).message}` };
    }
    try {
      const auth = await checkCopilotAuth(client);
      return { ok: auth.ok, login: auth.login, host: auth.host, message: auth.message };
    } finally {
      await client.stop().catch(() => {
        /* ignore */
      });
    }
  }

  /**
   * Run a single prompt to completion and return the neutral result. Mirrors
   * the prior inline ask lifecycle: permission handler derived from
   * readOnly/allowShell, session created with the caller's model/effort
   * (passed through as-is — undefined stays undefined), completion awaited via
   * the event stream, usage metrics collected, code changes captured from the
   * shutdown event, then full teardown.
   */
  async run(opts: RunOpts): Promise<RunResult> {
    const { cwd, prompt, appendLog, progress } = opts;
    const stateDir = resolveStateDir(cwd);

    const client = new CopilotClient({ workingDirectory: cwd, env: process.env });
    this.activeClient = client;

    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      await client.forceStop().catch(() => {
        /* ignore */
      });
      this.activeClient = null;
    };

    try {
      await client.start();
    } catch (err) {
      await stop();
      throw new Error(`Failed to start Copilot CLI: ${(err as Error).message}`);
    }

    const auth = await checkCopilotAuth(client);
    if (!auth.ok) {
      appendLog(`auth failed: ${auth.message}`);
      await client.stop().catch(() => {
        /* ignore */
      });
      await stop();
      throw new Error(`Not authenticated: ${auth.message}`);
    }
    appendLog(`auth ok${auth.login ? ` as ${auth.login}` : ""}`);

    // readOnly forces shell off and isolates the session from the filesystem;
    // a writable run honors the caller's allowShell flag.
    const permissionHandler = makePermissionHandler({
      allowShell: opts.readOnly ? false : opts.allowShell,
      allowUrl: opts.allowUrl,
      worktreePath: cwd,
      appendLog,
      readOnly: opts.readOnly,
      isolated: opts.readOnly,
    });

    let session: Awaited<ReturnType<typeof client.createSession>>;
    try {
      session = await client.createSession({
        clientName: `${CLIENT_NAME}/${PLUGIN_VERSION}`,
        model: opts.model,
        reasoningEffort: opts.reasoning,
        workingDirectory: cwd,
        infiniteSessions: { enabled: false },
        onPermissionRequest: permissionHandler,
        systemMessage: { mode: "append", content: opts.systemMessage },
      });
    } catch (err) {
      const msg = `Failed to create Copilot session: ${(err as Error).message}`;
      appendLog(msg);
      await client.stop().catch(() => {
        /* ignore */
      });
      await stop();
      throw new Error(msg);
    }

    const stream = attachStream({ session, stateDir, appendLog, progress });

    // Abort propagation: if the caller's signal fires, abort the live session.
    const onAbort = (): void => {
      session.abort().catch((e) => appendLog(`abort error: ${(e as Error).message}`));
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    let completionResult: Awaited<typeof stream.completion> | null = null;
    let premiumRequestCost: number | undefined;
    try {
      progress(`Sending prompt to Copilot${opts.model ? ` (model=${opts.model})` : ""}…`);
      await session.send({ prompt });
      completionResult = await stream.completion;

      try {
        const metrics = await session.rpc.usage.getMetrics();
        premiumRequestCost = metrics.totalPremiumRequestCost;
      } catch (e) {
        appendLog(`usage.getMetrics failed: ${(e as Error).message}`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      appendLog(`session error: ${msg}`);
      opts.signal?.removeEventListener("abort", onAbort);
      stream.dispose();
      await session.disconnect().catch(() => {
        /* ignore */
      });
      await client.stop().catch(() => {
        /* ignore */
      });
      await stop();
      throw new Error(msg);
    }

    opts.signal?.removeEventListener("abort", onAbort);

    await session.disconnect().catch((e) => appendLog(`disconnect warn: ${(e as Error).message}`));

    // The shutdown event (which carries authoritative codeChanges) may only
    // arrive after disconnect; bound the wait so teardown cannot hang.
    // unref + clear the bound: when stream.shutdown wins the race, an un-cleared
    // 5s timer would otherwise keep the event loop alive and delay process exit.
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    const shutdownResult = await Promise.race([
      stream.shutdown,
      new Promise<null>((res) => {
        shutdownTimer = setTimeout(() => res(null), SHUTDOWN_WAIT_MS);
        shutdownTimer.unref?.();
      }),
    ]);
    if (shutdownTimer) clearTimeout(shutdownTimer);

    stream.dispose();
    await fetchQuota(client, stateDir).catch(() => null);
    await client.stop().catch((e) => appendLog(`client.stop warn: ${(e as Error).message}`));
    await stop();

    const lastAssistantMessage =
      stream.getLastAssistantMessage()?.trim() || completionResult?.summary?.trim() || "";

    return {
      lastAssistantMessage,
      success: completionResult?.success !== false,
      summary: completionResult?.summary,
      usage: {
        kind: "copilot",
        premiumRequestCost: premiumRequestCost ?? shutdownResult?.premiumRequestCost,
      },
      codeChanges: shutdownResult?.codeChanges,
    };
  }
}
