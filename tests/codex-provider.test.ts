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
      progress() {}
    });
  });

  assert.equal(res.success, true);
  assert.equal(res.usage?.kind, "codex");
  assert.equal(res.usage?.kind === "codex" ? res.usage.rateLimits?.primaryUsedPercent : undefined, 12);
  assert.ok(res.lastAssistantMessage.length > 0, "expected a non-empty assistant message");
});

test("CodexProvider.checkAuth reports a ChatGPT login as ok", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "logged-in");

  const auth = await withFakeOnPath(binDir, () => new CodexProvider().checkAuth(binDir));

  assert.equal(auth.ok, true);
  assert.ok(auth.message.length > 0, "expected a non-empty auth detail message");
});
