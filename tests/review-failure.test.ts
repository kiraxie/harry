/**
 * `review`'s failure output must name the backend's cause.
 *
 * The only end-to-end coverage of review's failure path. `ask` has its own
 * (tests/ask.test.ts) and `fix` has its own (tests/fix.test.ts's envelope test);
 * review had none, so removing `failureReason` from review.ts alone left the
 * whole suite green while the command it matters most for went back to reporting
 * "Review did not complete successfully." and nothing else.
 *
 * It matters most for review because that is where the defect was found: a
 * `--adversarial` run against a ChatGPT-account Codex login is rejected upstream
 * with a 400 ("The 'gpt-5.6-sol' model is not supported…"), and the CLI flattened
 * it to "The model returned an empty review." — indistinguishable from a model
 * that genuinely said nothing. See `.local/items/codex-model-pinning.md`.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildEnv, installFakeCodex } from "./fake-codex.mjs";

const CLI = path.resolve(import.meta.dirname, "../src/companion.ts");

/** Declared by tests/fake-codex.mjs's `task-truncated-then-error` behavior. */
const TRUNCATED_CAUSE = "stream disconnected before completion";

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
}

test("review names the backend cause in both its failure signals", () => {
  const repo = tempDir("harry-review-repo-");
  const binDir = tempDir("harry-review-bin-");
  const dataDir = tempDir("harry-review-data-");
  try {
    // review refuses an empty target, so the repo needs a real change to review.
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "test"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    writeFileSync(path.join(repo, "a.txt"), "v1\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "base"]);
    writeFileSync(path.join(repo, "a.txt"), "v2\n");

    // Fails WITH a cause — task-stuck would time out, and a timeout has none.
    installFakeCodex(binDir, "task-truncated-then-error");
    const res = spawnSync(process.execPath, [CLI, "review", "--scope", "working-tree"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...buildEnv(binDir), CLAUDE_PLUGIN_DATA: dataDir },
    });

    assert.match(
      res.stderr,
      new RegExp(`^Review failed: Review did not complete successfully: ${TRUNCATED_CAUSE}$`, "m"),
      `expected the cause on the "Review failed:" line, got:\n${res.stderr}`,
    );
    // stdout carries the `# Review Failed` block the doors tell consumers to
    // return verbatim; a cause that reached only stderr never gets to the user.
    assert.ok(
      res.stdout.startsWith("# Review Failed\n"),
      `expected stdout to open with the failure marker, got:\n${res.stdout}`,
    );
    assert.ok(
      res.stdout.includes(TRUNCATED_CAUSE),
      `expected the cause inside the failure block, got:\n${res.stdout}`,
    );
    assert.notEqual(res.status, 0, "a failed review must exit non-zero");
  } finally {
    for (const d of [repo, binDir, dataDir]) rmSync(d, { recursive: true, force: true });
  }
});
