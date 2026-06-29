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
