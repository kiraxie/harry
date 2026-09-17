/**
 * `companion setup` reports Codex CLI availability and login state by running
 * `codex --version` and `codex login status` — `tests/fake-codex-cli.mjs`
 * stands in for the CLI, first on PATH.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import pkg from "../package.json" with { type: "json" };

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "src/companion.ts");
const FAKE = path.join(REPO_ROOT, "tests/fake-codex-cli.mjs");

const cleanup: string[] = [];
test.after(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(d);
  return d;
}

function runSetup(
  args: string[],
  opts: { fake?: Record<string, string>; bin?: null } = {},
): { status: number | null; stdout: string; stderr: string } {
  let pathVar: string;
  if (opts.bin === null) {
    pathVar = ["/usr/bin", "/bin"].join(path.delimiter);
  } else {
    const bin = tempDir("harry-setup-bin-");
    const shim = path.join(bin, "codex");
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
    fs.chmodSync(shim, 0o755);
    pathVar = `${bin}${path.delimiter}${process.env.PATH ?? ""}`;
  }
  const res = spawnSync(process.execPath, [CLI, "setup", ...args], {
    cwd: tempDir("harry-setup-cwd-"),
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      PATH: pathVar,
      CLAUDE_PLUGIN_DATA: tempDir("harry-setup-data-"),
      ...opts.fake,
    },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return assert.fail(`expected JSON on stdout, got:\n${stdout}`);
  }
}

const HEADING = `## Codex Setup (harry v${pkg.version})`;

test("setup --json reports an available, logged-in CLI", () => {
  const run = runSetup(["--json"], { fake: { FAKE_CODEX_CLI_VERSION: "9.8.7" } });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(parseJson(run.stdout), {
    status: "ok",
    available: true,
    version: "9.8.7",
    loggedIn: true,
    detail: "Logged in using ChatGPT",
  });
});

test("setup --json reports a logged-out CLI as an error with the login-status line", () => {
  const run = runSetup(["--json"], { fake: { FAKE_CODEX_CLI_LOGIN: "out" } });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(parseJson(run.stdout), {
    status: "error",
    available: true,
    version: "0.152.0",
    loggedIn: false,
    detail: "Not logged in",
  });
});

for (const login of ["in", "out"] as const) {
  test(`setup --json picks the version and login lines past a startup warning (logged ${login})`, () => {
    // codex can print a warning before its real output; the first line is not the answer.
    const run = runSetup(["--json"], {
      fake: {
        FAKE_CODEX_CLI_VERSION: "9.8.7",
        FAKE_CODEX_CLI_LOGIN: login,
        FAKE_CODEX_CLI_WARNING: "WARNING: proceeding, even though we could not update PATH",
      },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(parseJson(run.stdout), {
      status: login === "in" ? "ok" : "error",
      available: true,
      version: "9.8.7",
      loggedIn: login === "in",
      detail: login === "in" ? "Logged in using ChatGPT" : "Not logged in",
    });
  });
}

test("setup --json reports a missing CLI as unavailable", () => {
  const run = runSetup(["--json"], { bin: null });
  assert.equal(run.status, 0, run.stderr);
  const out = parseJson(run.stdout) as Record<string, unknown>;
  assert.equal(out.status, "error");
  assert.equal(out.available, false);
  assert.equal(out.version, null);
  assert.equal(out.loggedIn, false);
  assert.match(String(out.detail), /Codex CLI was not found on PATH/);
});

test("setup text output carries the heading and no login step when logged in", () => {
  const run = runSetup([]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.startsWith(`${HEADING}\n`), run.stdout);
  assert.match(run.stdout, /Logged in using ChatGPT/);
  assert.match(run.stdout, /0\.152\.0/);
  assert.ok(!run.stdout.includes("codex login"), run.stdout);
});

test("setup text output tells a logged-out user to run codex login", () => {
  const run = runSetup([], { fake: { FAKE_CODEX_CLI_LOGIN: "out" } });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.startsWith(`${HEADING}\n`), run.stdout);
  assert.match(run.stdout, /Not logged in/);
  assert.match(run.stdout, /`codex login`/);
});

test("setup text output tells a user without the CLI to install it", () => {
  const run = runSetup([], { bin: null });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.startsWith(`${HEADING}\n`), run.stdout);
  assert.match(run.stdout, /unavailable/);
  assert.match(run.stdout, /[Ii]nstall/);
});
