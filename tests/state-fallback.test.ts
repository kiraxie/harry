import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveStateDir } from "../src/lib/state.ts";

test("resolveStateDir keys on the git repo root, not the invoking subdir (C2)", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "harry-staterepo-")));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const sub = path.join(repo, "pkg", "nested");
  fs.mkdirSync(sub, { recursive: true });

  // A provider invoked with repoRoot and a command invoked from a subdir must
  // resolve to the SAME state dir, else their quota/rate-limit caches diverge.
  assert.equal(resolveStateDir(sub), resolveStateDir(repo));
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
