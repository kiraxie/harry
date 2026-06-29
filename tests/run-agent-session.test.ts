import assert from "node:assert/strict";
import test from "node:test";

import type { Provider, ProviderId, RunOpts } from "../src/lib/provider.ts";
import { resolveActiveProvider, runAgentSession } from "../src/lib/run-agent-session.ts";

const ENV_KEY = "CLAUDE_PLUGIN_OPTION_PROVIDER";

/** Stub provider — no real SDK/codex. */
function stub(
  id: ProviderId,
  opts: { meters?: boolean; authOk?: boolean } = {},
): Provider {
  return {
    id,
    capabilities: { metersQuota: opts.meters ?? false },
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
  allowUrl: false,
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

test("beforeRun runs after the quota gate and before provider.run", async () => {
  await withoutEnv(async () => {
    const order: string[] = [];
    const capture = (id: ProviderId): Provider => ({
      ...stub(id, { meters: true }),
      run: async () => {
        order.push("run");
        return { lastAssistantMessage: "done", success: true };
      },
    });
    await runAgentSession({
      cwd: "/tmp",
      flags: { provider: "copilot" },
      run: baseRun("/tmp"),
      pickProvider: capture,
      enforceQuota: () => {
        order.push("gate");
      },
      beforeRun: () => {
        order.push("beforeRun");
      },
    });
    assert.deepEqual(order, ["gate", "beforeRun", "run"]);
  });
});

test("beforeRun is skipped when the quota gate blocks (throws)", async () => {
  await withoutEnv(async () => {
    let beforeRunRan = false;
    let runRan = false;
    const capture = (id: ProviderId): Provider => ({
      ...stub(id, { meters: true }),
      run: async () => {
        runRan = true;
        return { lastAssistantMessage: "done", success: true };
      },
    });
    await assert.rejects(
      runAgentSession({
        cwd: "/tmp",
        flags: { provider: "copilot" },
        run: baseRun("/tmp"),
        pickProvider: capture,
        enforceQuota: () => {
          throw new Error("blocked");
        },
        beforeRun: () => {
          beforeRunRan = true;
        },
      }),
      /blocked/,
    );
    assert.equal(beforeRunRan, false, "beforeRun must not run when the gate blocks");
    assert.equal(runRan, false, "provider.run must not run when the gate blocks");
  });
});

test("precheckRun runs before beforeRun, so a refusal skips the fix snapshot (C1)", async () => {
  await withoutEnv(async () => {
    let beforeRunRan = false;
    let runRan = false;
    const capture = (id: ProviderId): Provider => ({
      ...stub(id),
      // Mirrors CodexProvider's write-without-shell refusal living in precheckRun.
      precheckRun: () => {
        throw new Error("Codex cannot grant write access without shell");
      },
      run: async () => {
        runRan = true;
        return { lastAssistantMessage: "done", success: true };
      },
    });
    await assert.rejects(
      runAgentSession({
        cwd: "/tmp",
        flags: { provider: "codex" },
        run: { ...baseRun("/tmp"), readOnly: false, allowShell: false },
        pickProvider: capture,
        resolveUsable: async () => true,
        beforeRun: () => {
          beforeRunRan = true;
        },
      }),
      /shell/,
    );
    assert.equal(beforeRunRan, false, "precheckRun must refuse BEFORE beforeRun (the snapshot) runs");
    assert.equal(runRan, false);
  });
});

test("defaultModelFor fills run.model only when it is undefined", async () => {
  await withoutEnv(async () => {
    let seenModel: string | undefined = "unset";
    const capture = (id: ProviderId): Provider => ({
      ...stub(id),
      run: async (opts: RunOpts) => {
        seenModel = opts.model;
        return { lastAssistantMessage: "done", success: true };
      },
    });

    // model unset → default applied
    await runAgentSession({
      cwd: "/tmp",
      flags: { provider: "copilot" },
      run: baseRun("/tmp"),
      pickProvider: capture,
      defaultModelFor: (id) => (id === "copilot" ? "gpt-5.5" : undefined),
    });
    assert.equal(seenModel, "gpt-5.5");

    // model unset, codex default is undefined → stays undefined
    seenModel = "unset";
    await runAgentSession({
      cwd: "/tmp",
      flags: { provider: "codex" },
      run: baseRun("/tmp"),
      pickProvider: capture,
      defaultModelFor: (id) => (id === "copilot" ? "gpt-5.5" : undefined),
    });
    assert.equal(seenModel, undefined);

    // explicit model → default NOT applied
    seenModel = "unset";
    await runAgentSession({
      cwd: "/tmp",
      flags: { provider: "copilot" },
      run: { ...baseRun("/tmp"), model: "claude-opus" },
      pickProvider: capture,
      defaultModelFor: () => "gpt-5.5",
    });
    assert.equal(seenModel, "claude-opus");
  });
});

test("resolveActiveProvider: explicit flag wins without consulting the probe", async () => {
  await withoutEnv(async () => {
    let probed = false;
    const r = await resolveActiveProvider({ provider: "codex" }, "/tmp", {
      probe: async () => {
        probed = true;
        return false;
      },
    });
    assert.deepEqual(r, { id: "codex", explicit: true });
    assert.equal(probed, false, "explicit flag must short-circuit the probe");
  });
});

test("resolveActiveProvider: the user setting is authoritative when no flag", async () => {
  await withoutEnv(async () => {
    process.env[ENV_KEY] = "copilot";
    let probed = false;
    const r = await resolveActiveProvider({}, "/tmp", {
      probe: async () => {
        probed = true;
        return true; // would pick codex if consulted
      },
    });
    assert.deepEqual(r, { id: "copilot", explicit: true });
    assert.equal(probed, false, "the setting must short-circuit the probe");
  });
});

test("resolveActiveProvider: falls to the probe when neither flag nor setting", async () => {
  await withoutEnv(async () => {
    assert.deepEqual(await resolveActiveProvider({}, "/tmp", { probe: async () => true }), {
      id: "codex",
      explicit: false,
    });
    assert.deepEqual(await resolveActiveProvider({}, "/tmp", { probe: async () => false }), {
      id: "copilot",
      explicit: false,
    });
  });
});

test("runAgentSession removes its interrupt listeners after the run", async () => {
  await withoutEnv(async () => {
    const before = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    await runAgentSession({
      cwd: "/tmp",
      flags: { provider: "copilot" },
      run: baseRun("/tmp"),
      pickProvider: (id) => stub(id),
    });
    const after = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    assert.equal(after, before, "interrupt listeners must be cleaned up in the finally");
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
