import assert from "node:assert/strict";
import test from "node:test";

import type { Provider, ProviderId, RunOpts } from "../src/lib/provider.ts";
import { runAgentSession } from "../src/lib/run-agent-session.ts";

const ENV_KEY = "CLAUDE_PLUGIN_OPTION_PROVIDER";

/** Stub provider — no real SDK/codex. */
function stub(
  id: ProviderId,
  opts: { meters?: boolean; authOk?: boolean } = {},
): Provider {
  return {
    id,
    capabilities: { metersQuota: opts.meters ?? false, reportsUsage: true },
    checkAuth: async () => ({ ok: opts.authOk ?? true, message: "ok" }),
    run: async () => ({
      lastAssistantMessage: "done",
      success: true,
      usage: { kind: id } as never,
    }),
  };
}

const baseRun = (cwd: string): RunOpts => ({
  cwd,
  prompt: "hi",
  readOnly: true,
  allowShell: false,
  systemMessage: "",
  appendLog: () => {},
  progress: () => {},
});

function withoutEnv(fn: () => Promise<void>): Promise<void> {
  const prev = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  return fn().finally(() => {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  });
}

test("explicit flag 'codex' drives the codex provider", async () => {
  await withoutEnv(async () => {
    let pickedId: ProviderId | undefined;
    const { provider, result } = await runAgentSession({
      cwd: "/tmp",
      flags: { provider: "codex" },
      run: baseRun("/tmp"),
      pickProvider: (id) => {
        pickedId = id;
        return stub(id);
      },
      resolveUsable: async () => false, // would pick copilot if consulted
    });
    assert.equal(provider, "codex");
    assert.equal(pickedId, "codex");
    assert.equal(result.lastAssistantMessage, "done");
  });
});

test("auto resolves to codex when resolveUsable is true", async () => {
  await withoutEnv(async () => {
    const { provider } = await runAgentSession({
      cwd: "/tmp",
      flags: {},
      run: baseRun("/tmp"),
      pickProvider: (id) => stub(id),
      resolveUsable: async () => true,
    });
    assert.equal(provider, "codex");
  });
});

test("auto resolves to copilot when resolveUsable is false", async () => {
  await withoutEnv(async () => {
    const { provider } = await runAgentSession({
      cwd: "/tmp",
      flags: {},
      run: baseRun("/tmp"),
      pickProvider: (id) => stub(id),
      resolveUsable: async () => false,
    });
    assert.equal(provider, "copilot");
  });
});

test("quota gate runs only when provider meters quota", async () => {
  await withoutEnv(async () => {
    let ran = false;
    await runAgentSession({
      cwd: "/tmp",
      flags: { provider: "copilot" },
      run: baseRun("/tmp"),
      pickProvider: (id) => stub(id, { meters: true }),
      enforceQuota: () => {
        ran = true;
      },
    });
    assert.equal(ran, true, "expected quota gate to run for metering provider");

    let ran2 = false;
    await runAgentSession({
      cwd: "/tmp",
      flags: { provider: "codex" },
      run: baseRun("/tmp"),
      pickProvider: (id) => stub(id, { meters: false }),
      enforceQuota: () => {
        ran2 = true;
      },
    });
    assert.equal(ran2, false, "expected quota gate to be skipped for non-metering provider");
  });
});

test("auth failure throws with no fallback", async () => {
  await withoutEnv(async () => {
    await assert.rejects(
      runAgentSession({
        cwd: "/tmp",
        flags: { provider: "codex" },
        run: baseRun("/tmp"),
        pickProvider: (id) => stub(id, { authOk: false }),
      }),
      /codex not authenticated/,
    );
  });
});
