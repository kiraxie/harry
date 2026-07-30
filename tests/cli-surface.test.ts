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

/**
 * Run the CLI in an isolated cwd + state dir.
 *
 * `dataDir` is fresh per call unless passed, so two calls share state only when
 * a test deliberately threads it — which is what lets one test write a snapshot
 * and the next read it.
 */
function runCli(
  args: string[],
  opts: { cwd?: string; binDir?: string; dataDir?: string } = {},
): { status: number | null; stdout: string; stderr: string } {
  const dataDir = opts.dataDir ?? makeTempDir("harry-cli-data-");
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

// `status --json` is reachable ONLY by running this CLI directly: the doors
// forward no arguments (`commands/status.md` has no `$ARGUMENTS`), deliberately,
// because they tell the agent to return stdout verbatim as markdown for a human.
// A backlog item asked whether that makes the flag the same no-shipped-producer
// shape that retired the job records — the answer is no, and the ruling is that
// direct CLI invocation is a supported surface (`setup` has no door at all and
// carries the same flag; `printUsage` advertises both).
//
// This test exists because that ruling was not enforced by anything.
// `tests/args.test.ts` pins that the PARSER accepts `--json`, one layer below the
// thing that matters: replacing `json: flags.json === true` with `json: false` in
// companion.ts leaves the whole suite green, and the flag silently stops working
// while its own test still passes. Proven by that mutation, not assumed.
//
// Asserts the DIFFERENCE between the two modes, not just "the output is JSON".
// A guard that only checked for JSON could not tell forwarding from JSON being
// the sole mode, and the empty-state case alone cannot tell a working snapshot
// from a hardcoded `{}` — hence a populated read as well, on a threaded dataDir.
test("status --json is forwarded and switches the output format", () => {
  // ONE dataDir and ONE cwd across every call below, so these are four reads of
  // the same state. Both matter: `resolveStateDir` keys the directory on a hash
  // of the cwd's repo root, so varying the cwd silently points `status` at a
  // different (empty) snapshot than the one `ask` wrote — which is exactly how
  // the first version of this test "failed" on a correct implementation.
  const dataDir = makeTempDir("harry-cli-data-");
  const binDir = makeTempDir("harry-cli-bin-");
  installFakeCodex(binDir, "task-with-ratelimits");
  const where = { cwd: binDir, binDir, dataDir };

  const emptyJson = runCli(["status", "--json"], where);
  assert.equal(emptyJson.status, 0, `status --json failed:\n${emptyJson.stderr}`);
  assert.deepEqual(
    JSON.parse(emptyJson.stdout),
    {},
    "with no snapshot yet, --json must emit an empty object, not the markdown notice",
  );

  const emptyMarkdown = runCli(["status"], where);
  assert.equal(emptyMarkdown.status, 0, `status failed:\n${emptyMarkdown.stderr}`);
  assert.match(
    emptyMarkdown.stdout,
    /No Codex rate-limit snapshot yet/,
    "without --json the same state must render as prose — otherwise the flag switches nothing",
  );

  // Populate the snapshot through a real run, then read it back as JSON, so this
  // cannot pass on a `--json` branch that always prints `{}`.
  const ask = runCli(["ask", "hello there"], where);
  assert.equal(ask.status, 0, `ask failed:\n${ask.stderr}`);

  const populated = runCli(["status", "--json"], where);
  assert.equal(populated.status, 0, `status --json failed:\n${populated.stderr}`);
  const parsed = JSON.parse(populated.stdout) as { codex?: { primaryUsedPercent?: number } };
  assert.equal(
    parsed.codex?.primaryUsedPercent,
    12,
    "--json must carry the captured snapshot, not an empty object",
  );
});
