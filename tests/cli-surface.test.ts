/**
 * End-to-end guards on the companion CLI's user-visible command surface: the
 * retired commands and flags stay retired.
 *
 *  - no `result` command and no `--background` (backgrounding is the harness's
 *    `run_in_background`, not a CLI flag);
 *  - no `status` command (the rate-limit snapshot it rendered came from the
 *    in-process Codex runtime, which is gone).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const CLI = path.resolve(import.meta.dirname, "../src/companion.ts");

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Run the CLI in an isolated cwd + state dir. */
function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: makeTempDir("harry-cli-cwd-"),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_DATA: makeTempDir("harry-cli-data-") },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("the node CLI rejects --background (backgrounding is the harness's job, not a CLI flag)", () => {
  const res = runCli(["review", "--background"]);
  assert.notEqual(res.status, 0, "expected --background to be rejected");
  assert.match(res.stderr, /Unknown flag --background/);
});

for (const command of ["result", "status"]) {
  test(`the node CLI has no \`${command}\` command`, () => {
    const res = runCli([command]);
    assert.notEqual(res.status, 0, `expected \`${command}\` to be an unknown command`);
    assert.match(res.stderr, new RegExp(`Unknown command: ${command}`));
  });
}

test("usage lists exactly setup, review and ask", () => {
  const res = runCli(["help"]);
  assert.equal(res.status, 0, res.stderr);
  const commands = [...res.stdout.matchAll(/^ {2}companion (\S+)/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(commands)], ["setup", "review", "ask"]);
  assert.ok(!/\bstatus\b/.test(res.stdout), res.stdout);
  assert.ok(!res.stdout.includes("--model"), res.stdout);
});
