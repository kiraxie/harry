import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CodexProvider, toCodexEffort } from "../src/lib/providers/codex.ts";
import { buildEnv, installFakeCodex } from "./fake-codex.mjs";

test("toCodexEffort clamps xhigh to high and passes the rest through (cr-11)", () => {
  // codex's app-server effort enum has no `xhigh`, but review defaults every
  // codex lane to xhigh — so it MUST map to codex's strongest tier, not leak.
  assert.equal(toCodexEffort("xhigh"), "high");
  assert.equal(toCodexEffort("high"), "high");
  assert.equal(toCodexEffort("medium"), "medium");
  assert.equal(toCodexEffort("low"), "low");
  assert.equal(toCodexEffort(undefined), undefined);
});

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harry-codex-provider-test-"));
}

/**
 * The provider passes `env: process.env` to the codex lib (and checkAuth probes
 * availability off the process PATH), so the fake `codex` must be on PATH for the
 * duration of the call. Swap it in, run, and always restore so cases don't leak.
 */
async function withFakeOnPath<T>(binDir: string, fn: () => Promise<T>): Promise<T> {
  const savedPath = process.env.PATH;
  process.env.PATH = buildEnv(binDir).PATH;
  try {
    return await fn();
  } finally {
    process.env.PATH = savedPath;
  }
}

test("CodexProvider.run maps a turn to a successful RunResult with codex usage", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-with-ratelimits");

  const res = await withFakeOnPath(binDir, () => {
    const p = new CodexProvider();
    return p.run({
      cwd: binDir,
      prompt: "hi",
      readOnly: true,
      allowShell: false,
      allowUrl: false,
      systemMessage: "",
      appendLog() {},
      progress() {},
    });
  });

  assert.equal(res.success, true);
  assert.equal(res.usage?.kind, "codex");
  assert.equal(
    res.usage?.kind === "codex" ? res.usage.rateLimits?.primaryUsedPercent : undefined,
    12,
  );
  assert.ok(res.lastAssistantMessage.length > 0, "expected a non-empty assistant message");
});

test("CodexProvider.run refuses write mode without shell access (cr-16 trust boundary)", async () => {
  // codex's sandbox is coarse: workspace-write + approvalPolicy:never runs shell
  // commands autonomously, so it CANNOT honor "write files but no shell". Rather
  // than silently run MORE permissively than the caller allowed (fail-open), the
  // provider must refuse (fail-closed). Guard fires before any codex spawn.
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-ok");

  await withFakeOnPath(binDir, async () => {
    const p = new CodexProvider();
    await assert.rejects(
      () =>
        p.run({
          cwd: binDir,
          prompt: "x",
          readOnly: false,
          allowShell: false,
          allowUrl: false,
          systemMessage: "",
          appendLog() {},
          progress() {},
        }),
      /shell|copilot/i,
    );
  });
});

test("CodexProvider.run allows write mode when shell is explicitly permitted (cr-16)", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-ok");

  const res = await withFakeOnPath(binDir, () =>
    new CodexProvider().run({
      cwd: binDir,
      prompt: "x",
      readOnly: false,
      allowShell: true,
      allowUrl: false,
      systemMessage: "",
      appendLog() {},
      progress() {},
    }),
  );

  assert.equal(res.success, true);
});

test("CodexProvider.run aborts when opts.signal is already aborted (cr-15)", async () => {
  // task-ok would normally succeed; a pre-aborted signal must short-circuit the
  // turn (this also exercises the signal→forceStop linkage the interrupt uses).
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-ok");

  const res = await withFakeOnPath(binDir, () =>
    new CodexProvider().run({
      cwd: binDir,
      prompt: "x",
      readOnly: true,
      allowShell: false,
      allowUrl: false,
      systemMessage: "",
      appendLog() {},
      progress() {},
      signal: AbortSignal.abort(),
    }),
  );

  assert.equal(res.success, false);
});

test("CodexProvider.forceStop is a no-op when no run is in flight (cr-15)", async () => {
  await new CodexProvider().forceStop();
});

test("CodexProvider.forceStop awaits the in-flight run before resolving (cr-17)", {
  timeout: 8000,
}, async () => {
  // forceStop must not resolve until the codex child is torn down — otherwise the
  // session's interrupt handler exits the process and orphans the subprocess.
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-stuck");

  await withFakeOnPath(binDir, async () => {
    const p = new CodexProvider();
    let runSettled = false;
    const runP = p
      .run({
        cwd: binDir,
        prompt: "x",
        readOnly: true,
        allowShell: false,
        allowUrl: false,
        systemMessage: "",
        appendLog() {},
        progress() {},
      })
      .then((r) => {
        runSettled = true;
        return r;
      });

    await new Promise((r) => setTimeout(r, 200)); // let the turn start
    await p.forceStop();
    assert.ok(runSettled, "forceStop resolved before the run settled — child not reaped");
    await runP;
  });
});

test("CodexProvider.checkAuth reports a ChatGPT login as ok", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "logged-in");

  const auth = await withFakeOnPath(binDir, () => new CodexProvider().checkAuth(binDir));

  assert.equal(auth.ok, true);
  assert.ok(auth.message.length > 0, "expected a non-empty auth detail message");
});
