/**
 * End-to-end guards on the companion CLI's user-visible command surface.
 *
 * Two things this file pins:
 *  1. The job-LOG machinery is live — `ask`/`review`/`fix` each allocate a job
 *     id, append to `<stateDir>/jobs/<id>.log`, and print `Job log: <path>` so
 *     the user can inspect a run. Retiring the job-RECORD subsystem must not
 *     take the log with it.
 *  2. The retired job-record surface stays retired — the node CLI has no
 *     `result` command and rejects `--background` (which is a SLASH-level flag
 *     the doors strip before invoking node, not a CLI flag).
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
  const dataDir = makeTempDir("harry-cli-data-");
  const cwd = opts.cwd ?? makeTempDir("harry-cli-cwd-");
  const base = opts.binDir ? buildEnv(opts.binDir) : process.env;
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...base, CLAUDE_PLUGIN_DATA: dataDir },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("ask writes its job log and reports the path (job-LOG machinery is live)", () => {
  const binDir = makeTempDir("harry-cli-bin-");
  installFakeCodex(binDir, "task-with-ratelimits");

  const res = runCli(["ask", "hello there"], { cwd: binDir, binDir });

  assert.equal(res.status, 0, `ask failed:\n${res.stderr}`);
  assert.match(res.stdout, /Handled the requested task\./);

  const match = res.stderr.match(/Job log: (.+)$/m);
  assert.ok(match, `expected a "Job log:" line on stderr, got:\n${res.stderr}`);

  const logPath = match[1].trim();
  assert.ok(fs.existsSync(logPath), `job log not written at ${logPath}`);
  assert.match(fs.readFileSync(logPath, "utf-8"), /ask start:/);
});

test("the node CLI rejects --background (it is a slash-level flag, stripped by the doors)", () => {
  const res = runCli(["review", "--background"]);
  assert.notEqual(res.status, 0, "expected --background to be rejected");
  assert.match(res.stderr, /Unknown flag --background/);
});

test("the node CLI has no `result` command (job-record subsystem retired)", () => {
  const res = runCli(["result"]);
  assert.notEqual(res.status, 0, "expected `result` to be an unknown command");
  assert.match(res.stderr, /Unknown command: result/);
});
