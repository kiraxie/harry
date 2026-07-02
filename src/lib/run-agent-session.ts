/**
 * runAgentSession — the single lifecycle every agent command (ask/review/fix)
 * calls. It auth-checks, runs the codex precheck gate, runs the session, and
 * returns the result.
 */

import type { CodexSession, RunOpts, RunResult } from "./provider.ts";
import { CodexProvider } from "./providers/codex.ts";

export interface RunAgentSessionArgs {
  cwd: string;
  run: RunOpts;
  /** Build the session. Defaults to a real CodexProvider. Injectable for tests. */
  buildSession?: () => CodexSession;
  /**
   * Pre-run hook, invoked AFTER precheckRun passes and just BEFORE
   * `session.run`. Lets a command perform side effects that must not happen
   * when the run is refused — e.g. `fix`'s pre-fix snapshot commit.
   */
  beforeRun?: (session: CodexSession) => void | Promise<void>;
  /**
   * Command-specific reaction to a SIGINT/SIGTERM that arrives mid-run,
   * invoked synchronously by the centralized interrupt handler BEFORE the
   * session is force-stopped and the process exits 130. Do NOT call
   * `process.exit` here — the handler owns the exit.
   */
  onInterrupt?: () => void;
  log?: (m: string) => void;
}

/** Hard ceiling on interrupt teardown so a wedged forceStop cannot hang exit. */
const INTERRUPT_TEARDOWN_CEILING_MS = 2000;

function defaultSession(): CodexSession {
  return new CodexProvider();
}

export async function runAgentSession(
  args: RunAgentSessionArgs,
): Promise<{ result: RunResult }> {
  // Centralized interrupt handling, installed across the WHOLE session span
  // (auth → precheck → run), not just the run: a command's `onInterrupt` (e.g.
  // fix's terminal `failed` envelope) and the live session's forceStop must
  // fire for an interrupt anywhere in here.
  let activeSession: CodexSession | undefined;
  let interrupting = false;
  const onInterrupt = (): void => {
    if (interrupting) return;
    interrupting = true;
    args.onInterrupt?.();
    const exit = (): never => process.exit(130);
    const guard = setTimeout(exit, INTERRUPT_TEARDOWN_CEILING_MS);
    guard.unref();
    void Promise.resolve(activeSession?.forceStop?.())
      .catch(() => {
        /* best-effort teardown */
      })
      .finally(exit);
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);

  try {
    const session = args.buildSession ? args.buildSession() : defaultSession();
    activeSession = session;

    const auth = await session.checkAuth(args.cwd);
    if (!auth.ok) {
      throw new Error(`codex not authenticated: ${auth.message}`);
    }

    // Capability gate BEFORE beforeRun: a run codex cannot honor (e.g.
    // write-without-shell) must refuse here, so the refusal precedes fix's
    // pre-fix snapshot commit rather than leaving the user's work committed by
    // a run that then throws.
    session.precheckRun?.(args.run);

    await args.beforeRun?.(session);
    const result = await session.run(args.run);
    return { result };
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
}
