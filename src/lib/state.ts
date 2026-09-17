/**
 * Workspace-scoped state directory, under $CLAUDE_PLUGIN_DATA.
 *
 * Holds the per-run output files and codex transcript logs that `ask` writes,
 * and that `review` writes when the main checkout has no `.local/`.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

// ─── Constants ───────────────────────────────────────────────────────────────

const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT = join(tmpdir(), "harry");

// ─── State Directory ─────────────────────────────────────────────────────────

/**
 * Resolve the git repo root containing `cwd`, falling back to `resolve(cwd)`
 * when it is not a git repo (or git is unavailable). Keying state on the repo
 * root — not the raw cwd — keeps a command invoked from a subdirectory and one
 * invoked at the repo root pointed at the SAME state dir.
 */
function repoRootOf(cwd: string): string {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root || resolve(cwd);
  } catch {
    return resolve(cwd);
  }
}

export function resolveStateDir(cwd: string): string {
  const workspaceRoot = repoRootOf(cwd);
  const slug =
    basename(workspaceRoot)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
  const dirName = `${slug}-${hash}`;
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  if (pluginDataDir) {
    return join(pluginDataDir, "state", dirName);
  }
  return join(FALLBACK_STATE_ROOT, dirName);
}

// State dirs are 0700: the fallback root is under a world-readable /tmp (see
// FALLBACK_STATE_ROOT), and run logs hold prompts and codex's session
// transcript — not readable by other users on a shared host.
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}
