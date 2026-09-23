import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveStateDir } from "../src/lib/state.ts";

test("resolveStateDir keys on the git repo root, not the invoking subdir (C2)", () => {
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "harry-staterepo-")));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const sub = path.join(repo, "pkg", "nested");
    fs.mkdirSync(sub, { recursive: true });

    // A command invoked at the repo root and one invoked from a subdir must
    // resolve to the SAME state dir, else their run files scatter across two.
    assert.equal(resolveStateDir(sub), resolveStateDir(repo));
  } finally {
    if (prev !== undefined) process.env.CLAUDE_PLUGIN_DATA = prev;
    else delete process.env.CLAUDE_PLUGIN_DATA;
  }
});

/** Run `body` with `process.env.PATH` set to `PATH`, restoring it afterwards. */
function withPath<T>(PATH: string, body: () => T): T {
  const prev = process.env.PATH;
  process.env.PATH = PATH;
  try {
    return body();
  } finally {
    process.env.PATH = prev;
  }
}

test("resolveStateDir never runs a cwd's own `git` through an empty or relative PATH entry", () => {
  // execvp resolves an empty or relative PATH entry against the cwd; ask and
  // review resolve their state dir from a cwd that may be an untrusted repo.
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "harry-state-trap-")));
  const markers = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "harry-state-mark-")));
  fs.writeFileSync(
    path.join(cwd, "git"),
    `#!/bin/sh\n: > "${path.join(markers, "ran")}"\necho /pwned\n`,
    { mode: 0o755 },
  );
  const expected = resolveStateDir(cwd);
  for (const PATH of [":/usr/bin:/bin", "/usr/bin:/bin:", "/usr/bin::/bin", ".:/usr/bin:/bin"]) {
    const dir = withPath(PATH, () => resolveStateDir(cwd));
    assert.deepEqual(fs.readdirSync(markers), [], `PATH=${JSON.stringify(PATH)} ran the cwd's git`);
    assert.equal(dir, expected);
  }
});

test("resolveStateDir with no git on PATH still keys on the cwd itself", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "harry-state-nogit-")));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const sub = path.join(repo, "sub");
  fs.mkdirSync(sub);
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "harry-state-empty-")));
  // No git to find the repo root: the fallback keys on resolve(cwd), so the
  // subdir gets its own state dir rather than the repo's.
  const got = withPath(`:.:${empty}`, () => resolveStateDir(sub));
  assert.notEqual(got, resolveStateDir(repo));
  assert.equal(path.basename(got).startsWith("sub-"), true, got);
});

test("resolveStateDir falls back to the harry tmp root when CLAUDE_PLUGIN_DATA is unset", () => {
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "harry-fallback-ws-"));
    const dir = resolveStateDir(cwd);
    assert.equal(dir, path.join(os.tmpdir(), "harry", path.basename(dir)));
  } finally {
    if (prev !== undefined) process.env.CLAUDE_PLUGIN_DATA = prev;
    else delete process.env.CLAUDE_PLUGIN_DATA;
  }
});
