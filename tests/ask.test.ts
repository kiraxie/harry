/**
 * `ask`'s failure contract.
 *
 * Both of `ask`'s doors instruct their consumers to "Return the command stdout
 * verbatim, exactly as-is", and `/debate` folds that stdout into a three-voice
 * synthesis. So a failed turn MUST be self-describing on stdout: without a
 * marker, a truncated answer is indistinguishable from a complete one and gets
 * presented (or synthesized) as the model's real answer.
 *
 * This mirrors `review`'s failure shape — `# Review Failed` on stdout plus a
 * `Review failed:` line on stderr — because the two commands share a stdout
 * contract and drifting apart is what produced this gap in the first place.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildEnv, installFakeCodex } from "./fake-codex.mjs";

const CLI = path.resolve(import.meta.dirname, "../src/companion.ts");

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Run the CLI in an isolated cwd + state dir. */
function runCli(
  args: string[],
  opts: { cwd?: string; binDir?: string } = {},
): { status: number | null; stdout: string; stderr: string } {
  const dataDir = makeTempDir("harry-ask-data-");
  const cwd = opts.cwd ?? makeTempDir("harry-ask-cwd-");
  const base = opts.binDir ? buildEnv(opts.binDir) : process.env;
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...base, CLAUDE_PLUGIN_DATA: dataDir },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("ask marks a truncated answer as failed instead of passing it off as the reply", () => {
  const binDir = makeTempDir("harry-ask-bin-");
  installFakeCodex(binDir, "task-truncated-then-error");

  const res = runCli(["ask", "why is it slow"], { cwd: binDir, binDir });

  // The headline defect: the body arrives and reads like a finished answer.
  assert.match(
    res.stdout,
    /The three main causes are:/,
    `expected the partial body to be preserved, got:\n${res.stdout}`,
  );
  // ...so stdout must say, in the stdout itself, that it is NOT a real answer.
  assert.match(
    res.stdout,
    /^# Ask Failed$/m,
    `expected an "# Ask Failed" marker on stdout, got:\n${res.stdout}`,
  );
  // The marker has to precede the body — a consumer quoting stdout verbatim
  // must hit the warning before the text it qualifies.
  assert.ok(
    res.stdout.indexOf("# Ask Failed") < res.stdout.indexOf("The three main causes are:"),
    `expected the failure marker above the body, got:\n${res.stdout}`,
  );
  assert.match(res.stderr, /^Ask failed: /m, `expected an "Ask failed:" line on stderr`);
  assert.notEqual(res.status, 0, "expected a non-zero exit status");
});

test("ask marks a timed-out turn as failed and names the timeout", () => {
  const binDir = makeTempDir("harry-ask-bin-");
  installFakeCodex(binDir, "task-stuck");

  const res = runCli(["ask", "hello there", "--timeout", "500"], { cwd: binDir, binDir });

  assert.match(
    res.stdout,
    /^# Ask Failed$/m,
    `expected an "# Ask Failed" marker on stdout, got:\n${res.stdout}`,
  );
  assert.match(
    res.stdout,
    /Timed out after 500ms\./,
    `expected the timeout reason on stdout, got:\n${res.stdout}`,
  );
  assert.match(res.stderr, /^Ask failed: Timed out after 500ms\./m);
  assert.notEqual(res.status, 0, "expected a non-zero exit status");
});
