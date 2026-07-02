import assert from "node:assert/strict";
import test from "node:test";

import type { CodexSession, RunOpts } from "../src/lib/provider.ts";
import { runAgentSession } from "../src/lib/run-agent-session.ts";

/** Stub session — no real codex subprocess. */
function stub(opts: { authOk?: boolean } = {}): CodexSession {
  return {
    checkAuth: async () => ({ ok: opts.authOk ?? true, message: "ok" }),
    run: async () => ({ lastAssistantMessage: "done", success: true }),
  };
}

const baseRun = (cwd: string): RunOpts => ({
  cwd,
  prompt: "hi",
  readOnly: true,
  allowShell: false,
  allowUrl: false,
  systemMessage: "",
  appendLog: () => {},
  progress: () => {},
});

test("runAgentSession drives the injected session and returns its result", async () => {
  const { result } = await runAgentSession({
    cwd: "/tmp",
    run: baseRun("/tmp"),
    buildSession: () => stub(),
  });
  assert.equal(result.lastAssistantMessage, "done");
});

test("beforeRun runs after precheckRun and before session.run", async () => {
  const order: string[] = [];
  const session: CodexSession = {
    ...stub(),
    precheckRun: () => {
      order.push("precheck");
    },
    run: async () => {
      order.push("run");
      return { lastAssistantMessage: "done", success: true };
    },
  };
  await runAgentSession({
    cwd: "/tmp",
    run: baseRun("/tmp"),
    buildSession: () => session,
    beforeRun: () => {
      order.push("beforeRun");
    },
  });
  assert.deepEqual(order, ["precheck", "beforeRun", "run"]);
});

test("precheckRun refusal skips beforeRun and run (C1)", async () => {
  let beforeRunRan = false;
  let runRan = false;
  const session: CodexSession = {
    ...stub(),
    precheckRun: () => {
      throw new Error("Codex cannot grant write access without shell");
    },
    run: async () => {
      runRan = true;
      return { lastAssistantMessage: "done", success: true };
    },
  };
  await assert.rejects(
    runAgentSession({
      cwd: "/tmp",
      run: { ...baseRun("/tmp"), readOnly: false, allowShell: false },
      buildSession: () => session,
      beforeRun: () => {
        beforeRunRan = true;
      },
    }),
    /shell/,
  );
  assert.equal(beforeRunRan, false, "precheckRun must refuse BEFORE beforeRun runs");
  assert.equal(runRan, false);
});

test("runAgentSession removes its interrupt listeners after the run", async () => {
  const before = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
  await runAgentSession({
    cwd: "/tmp",
    run: baseRun("/tmp"),
    buildSession: () => stub(),
  });
  const after = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
  assert.equal(after, before, "interrupt listeners must be cleaned up in the finally");
});

test("auth failure throws with no fallback", async () => {
  await assert.rejects(
    runAgentSession({
      cwd: "/tmp",
      run: baseRun("/tmp"),
      buildSession: () => stub({ authOk: false }),
    }),
    /codex not authenticated/,
  );
});

test("default buildSession spawns the real CodexProvider (smoke: constructible)", async () => {
  // Just confirm the default path resolves without a buildSession override —
  // does NOT run a real codex turn (no cwd/auth available in CI), so it's
  // expected to reject on checkAuth. The point is exercising defaultSession().
  await assert.rejects(
    runAgentSession({ cwd: "/nonexistent", run: baseRun("/nonexistent") }),
  );
});
