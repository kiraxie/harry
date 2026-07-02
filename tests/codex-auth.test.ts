import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getCodexAuthStatus } from "../src/lib/codex/auth.ts";
import { buildEnv, installFakeCodex } from "./fake-codex.mjs";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harry-codex-auth-test-"));
}

test("getCodexAuthStatus reports a ChatGPT login as logged in", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "logged-in");

  const status = await getCodexAuthStatus(binDir, { env: buildEnv(binDir) });

  assert.equal(status.available, true);
  assert.equal(status.loggedIn, true);
  assert.equal(status.authMethod, "chatgpt");
  assert.equal(status.verified, true);
});

test("getCodexAuthStatus reports a logged-out account as not logged in", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "logged-out");

  const status = await getCodexAuthStatus(binDir, { env: buildEnv(binDir) });

  assert.equal(status.available, true);
  assert.equal(status.loggedIn, false);
});

test("getCodexAuthStatus threads the connect timeout and fails closed when initialize never answers", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "no-init");

  const status = await getCodexAuthStatus(binDir, {
    env: buildEnv(binDir),
    connectTimeoutMs: 300,
  });

  // The probe must not hang on a child that never answers initialize.
  assert.equal(status.available, true);
  assert.equal(status.loggedIn, false);
  assert.match(status.detail, /did not answer initialize/);
});
