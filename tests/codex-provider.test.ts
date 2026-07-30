import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CodexProvider } from "../src/lib/providers/codex.ts";
import { buildEnv, installFakeCodex } from "./fake-codex.mjs";

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

test("CodexProvider.run passes reasoning through to codex's effort param unclamped", async () => {
  // The app-server accepts `xhigh` directly (verified against the installed
  // codex CLI binary) — this must reach codex as-is, not get downgraded.
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-ok");

  await withFakeOnPath(binDir, () =>
    new CodexProvider().run({
      cwd: binDir,
      prompt: "x",
      reasoning: "xhigh",
      readOnly: true,
      allowShell: false,
      allowUrl: false,
      systemMessage: "",
      appendLog() {},
      progress() {},
    }),
  );

  const state = JSON.parse(fs.readFileSync(path.join(binDir, "fake-codex-state.json"), "utf8")) as {
    lastTurnStart?: { effort?: string };
  };
  assert.equal(state.lastTurnStart?.effort, "xhigh");
});

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
  assert.equal(res.usage?.rateLimits?.primaryUsedPercent, 12);
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
      /shell/i,
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

// The single producer of `RunResult.error`. Everything downstream — ask's stdout
// marker, review's `# Review Failed` block, fix's envelope — can only report a
// cause the provider carried across this boundary, so this is the one place a
// break silently blinds all three at once.
//
// Before this field existed, `turn.ts` captured the cause and codex.ts logged it
// (`turn error: …`) without ever attaching it, so a backend rejection and a model
// that genuinely returned nothing were indistinguishable in every command's
// output. The concrete cost: an upstream 400 ("The 'gpt-5.6-sol' model is not
// supported when using Codex with a ChatGPT account") surfaced only as "The model
// returned an empty review."
test("CodexProvider.run carries the turn's failure cause onto RunResult", async () => {
  const binDir = makeTempDir();
  // This fixture ends a turn with an `error` notification after a partial answer,
  // so the turn fails WITH a cause — the shape that has one to lose.
  installFakeCodex(binDir, "task-truncated-then-error");

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

  assert.equal(res.success, false, "the fixture must fail, or there is no cause to carry");
  assert.equal(
    res.error,
    "stream disconnected before completion",
    "RunResult.error must carry the cause turn.ts captured — declared by " +
      "tests/fake-codex.mjs's task-truncated-then-error behavior",
  );
  // Not a consolation prize: the partial body still has to survive, because ask
  // and review print it beneath their failure marker.
  assert.match(res.lastAssistantMessage, /The three main causes are:/);
});

// The other pole. `error` is only meaningful as a discriminator, so proving it is
// set on failure is half the guard: if it were also set on success, callers would
// frame good answers as failures and the test above would still pass.
test("CodexProvider.run leaves RunResult.error unset on a successful turn", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-ok");

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
  assert.equal(res.error, undefined, "a successful run must carry no cause");
});
