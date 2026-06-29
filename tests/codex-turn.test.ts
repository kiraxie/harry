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

test("runCodexTurn completes even when turn/start omits a turn id (cr-1)", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-no-turnid");

  const startedAt = Date.now();
  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true,
    timeoutMs: 5_000
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.success, true);
  assert.ok(result.finalMessage.length > 0, "expected a non-empty final message");
  assert.ok(elapsed < 4_000, `expected no hang, took ${elapsed}ms`);
});

test("runCodexTurn ignores a malformed item notification without crashing (cr-2)", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-missing-item");

  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true,
    timeoutMs: 5_000
  });

  assert.equal(result.success, true);
  assert.ok(result.finalMessage.length > 0, "expected the turn to still complete");
});

test("runCodexTurn applies a token_count without a threadId (cr-10)", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-account-token");

  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true,
    timeoutMs: 5_000
  });

  assert.equal(result.success, true);
  assert.equal(result.usage?.rateLimits?.primaryUsedPercent, 42);
  assert.equal(result.usage?.inputTokens, 11);
  assert.equal(result.usage?.outputTokens, 13);
});

test("runCodexTurn surfaces an error notification without a threadId (cr-10)", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-account-error");

  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true,
    timeoutMs: 5_000
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /rate limit/i);
});

test("runCodexTurn deep-merges partial token_count rate limits (adv-5)", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-partial-ratelimits");

  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true,
    timeoutMs: 5_000
  });

  assert.equal(result.success, true);
  // Later partial snapshot updates primary but must preserve the earlier fields.
  assert.equal(result.usage?.rateLimits?.primaryUsedPercent, 50);
  assert.equal(result.usage?.rateLimits?.secondaryUsedPercent, 30);
  assert.equal(result.usage?.rateLimits?.planType, "plus");
  assert.equal(result.usage?.rateLimits?.resetsAt, "2026-07-01T00:00:00Z");
});

test("runCodexTurn prepends instructions (the system message) to the turn input (cr-14)", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-ok");

  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    instructions: "HARRY-GUARDRAIL-SENTINEL",
    env: buildEnv(binDir),
    readOnly: true,
    timeoutMs: 5_000
  });

  assert.equal(result.success, true);
  const state = JSON.parse(
    fs.readFileSync(path.join(binDir, "fake-codex-state.json"), "utf8")
  ) as { lastTurnStart?: { prompt?: string } };
  // The guardrails + --context that ride in `instructions` must reach codex, not
  // be dropped — assert both the instructions and the prompt are in the turn input.
  assert.match(state.lastTurnStart?.prompt ?? "", /HARRY-GUARDRAIL-SENTINEL/);
  assert.match(state.lastTurnStart?.prompt ?? "", /do the thing/);
});

test("runCodexTurn aborts promptly on an already-aborted signal (cr-15)", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "task-stuck");

  const startedAt = Date.now();
  const result = await runCodexTurn({
    cwd: binDir,
    prompt: "do the thing",
    env: buildEnv(binDir),
    readOnly: true,
    timeoutMs: 2_000,
    signal: AbortSignal.abort()
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /abort/i);
  assert.ok(elapsed < 2_000, `expected the abort to pre-empt the timeout, took ${elapsed}ms`);
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
