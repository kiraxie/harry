import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    env: buildEnv(binDir),
    disableBroker: true
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
    env: buildEnv(binDir),
    disableBroker: true
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
