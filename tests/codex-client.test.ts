import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { CodexAppServerClient } from "../src/lib/codex/app-server.ts";
import { buildEnv, installFakeCodex } from "./fake-codex.mjs";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harry-codex-test-"));
}

test("CodexAppServerClient connects and round-trips a request", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "logged-in");

  const client = await CodexAppServerClient.connect(binDir, {
    env: buildEnv(binDir)
  });

  try {
    const account = await client.request<{ account: { type: string; email: string } | null }>(
      "account/read"
    );
    assert.equal(account.account?.type, "chatgpt");
    assert.equal(account.account?.email, "test@example.com");

    const started = await client.request<{ thread: { id: string } }>("thread/start", {
      cwd: binDir
    });
    assert.match(started.thread.id, /^thr_/);
  } finally {
    await client.close();
  }
});

test("CodexAppServerClient dispatches notifications during a turn", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "logged-in");

  const client = await CodexAppServerClient.connect(binDir, {
    env: buildEnv(binDir)
  });

  try {
    const started = await client.request<{ thread: { id: string } }>("thread/start", {
      cwd: binDir
    });
    const threadId = started.thread.id;

    const completed = new Promise<void>((resolve) => {
      client.setNotificationHandler((m) => {
        if (m.method === "turn/completed") {
          resolve();
        }
      });
    });

    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "hello" }]
    });

    await completed;
  } finally {
    await client.close();
  }
});

test("request() rejects (not synchronously throws) after the client is closed", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "logged-in");

  const client = await CodexAppServerClient.connect(binDir, {
    env: buildEnv(binDir)
  });
  await client.close();

  // Must return a rejected promise, not throw synchronously: a synchronous
  // throw escapes `.catch(...)`/`Promise.race(...)` chains that lack a try.
  const result = client.request("account/read");
  assert.ok(result instanceof Promise, "request() must return a Promise even when closed");
  await assert.rejects(result, /client is closed/);
});

test("close() resolves even when the child ignores SIGTERM", async (t) => {
  if (process.platform === "win32") {
    t.skip("SIGTERM escalation path is POSIX-only; win32 uses terminateProcessTree");
    return;
  }

  const binDir = makeTempDir();
  installFakeCodex(binDir, "ignore-sigterm");

  const client = await CodexAppServerClient.connect(binDir, {
    env: buildEnv(binDir)
  });

  const start = Date.now();
  await client.close();
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `close() should resolve within the escalation bound (took ${elapsed}ms)`);
});
