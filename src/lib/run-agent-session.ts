/**
 * runAgentSession — the session lifecycle `ask` (the only in-process Codex
 * command) calls. It auth-checks, runs the session, and returns the result.
 */

import type { CodexSession, RunOpts, RunResult } from "./provider.ts";
import { CodexProvider } from "./providers/codex.ts";

export interface RunAgentSessionArgs {
  cwd: string;
  run: RunOpts;
  /** Build the session. Defaults to a real CodexProvider. Injectable for tests. */
  buildSession?: () => CodexSession;
}

/** Hard ceiling on interrupt teardown so a wedged forceStop cannot hang exit. */
const INTERRUPT_TEARDOWN_CEILING_MS = 2000;

function defaultSession(): CodexSession {
  return new CodexProvider();
}

export async function runAgentSession(args: RunAgentSessionArgs): Promise<{ result: RunResult }> {
  // Centralized interrupt handling, installed across the WHOLE session span
  // (auth → run), not just the run: the live session's forceStop must fire for
  // an interrupt anywhere in here.
  let activeSession: CodexSession | undefined;
  let interrupting = false;
  const handleInterrupt = (): void => {
    if (interrupting) return;
    interrupting = true;
    const exit = (): never => process.exit(130);
    const guard = setTimeout(exit, INTERRUPT_TEARDOWN_CEILING_MS);
    guard.unref();
    void Promise.resolve(activeSession?.forceStop?.())
      .catch(() => {
        /* best-effort teardown */
      })
      .finally(exit);
  };
  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleInterrupt);

  try {
    const session = args.buildSession ? args.buildSession() : defaultSession();
    activeSession = session;

    const auth = await session.checkAuth(args.cwd);
    if (!auth.ok) {
      throw new Error(`codex not authenticated: ${auth.message}`);
    }

    const result = await session.run(args.run);
    return { result };
  } finally {
    process.removeListener("SIGINT", handleInterrupt);
    process.removeListener("SIGTERM", handleInterrupt);
  }
}
