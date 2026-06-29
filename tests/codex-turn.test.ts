import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCodexTurn } from "../src/lib/codex/turn.ts";
import { buildEnv, installFakeCodex } from "./fake-codex.mjs";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harry-codex-turn-test-"));
}

test("runCodexTurn completes a turn and returns the final message", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-ok");

  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true
  });

  assert.equal(result.success, true);
  assert.ok(result.finalMessage.length > 0, "expected a non-empty final message");
});

test("runCodexTurn parses token_count rate limits into usage", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-with-ratelimits");

  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true
  });

  assert.equal(result.success, true);
  assert.equal(result.usage?.rateLimits?.primaryUsedPercent, 12);
  assert.equal(result.usage?.inputTokens, 5);
  assert.equal(result.usage?.outputTokens, 7);
});

test("runCodexTurn times out a turn that never completes", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-stuck");

  const startedAt = Date.now();
  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true,
    timeoutMs: 600
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.success, false);
  assert.ok(
    elapsed < 10_000,
    `expected the stuck turn to be bounded by the timeout, took ${elapsed}ms`
  );
});

test("runCodexTurn times out when codex never answers initialize", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "no-init");

  const startedAt = Date.now();
  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true,
    timeoutMs: 600
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /initialize/i);
  assert.ok(
    elapsed < 10_000,
    `expected connect to be bounded by the timeout, took ${elapsed}ms`
  );
});
