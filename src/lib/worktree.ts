/**
 * Git worktree lifecycle for isolating Copilot implementations.
 *
 * Worktree branches are named `copilot/<jobId>`. On success the checkout is
 * removed but the branch is retained as the deliverable. On failure both the
 * checkout and a commit-free branch are removed.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface WorktreeHandle {
  path: string;
  branch: string;
  baseCommit: string;
  repoRoot: string;
}

export interface CreateWorktreeOptions {
  /** Preferred path for the worktree checkout (usually inside stateDir). */
  preferredPath: string;
  /** Callback for non-fatal notices (e.g., dirty main tree). */
  onWarn?: (message: string) => void;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryGit(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

function sameDevice(a: string, b: string): boolean {
  try {
    // Walk `a` upward until we find an existing ancestor
    let probe = a;
    while (!existsSync(probe) && dirname(probe) !== probe) {
      probe = dirname(probe);
    }
    return statSync(probe).dev === statSync(b).dev;
  } catch {
    return false;
  }
}

/**
 * Resolve the git repository root for a working directory.
 * Throws if the cwd is not inside a git repo.
 */
export function resolveRepoRoot(cwd: string): string {
  const res = tryGit(['rev-parse', '--show-toplevel'], cwd);
  if (!res.ok) {
    throw new Error(`Not a git repository: ${cwd}${res.stderr ? `\n${res.stderr}` : ''}`);
  }
  return res.stdout;
}

/**
 * Create a worktree. Returns the handle. Caller must call cleanupWorktree()
 * in a finally block. The branch name is derived from `jobId`.
 */
export function createWorktree(jobId: string, cwd: string, opts: CreateWorktreeOptions): WorktreeHandle {
  const repoRoot = resolveRepoRoot(cwd);
  const baseCommit = runGit(['rev-parse', 'HEAD'], repoRoot);
  const branch = `copilot/${jobId}`;

  // Warn on uncommitted changes — but do not block.
  const dirty = tryGit(['status', '--porcelain'], repoRoot);
  if (dirty.ok && dirty.stdout.length > 0) {
    opts.onWarn?.(
      `Main working tree has uncommitted changes; Copilot worktree starts from HEAD (${baseCommit.slice(0, 8)}) — your changes are not visible to the Copilot session.`,
    );
  }

  // Path selection: prefer preferredPath (typically inside stateDir). If it
  // would cross a filesystem boundary, fall back under the repo's .git dir.
  let worktreePath = opts.preferredPath;
  if (!sameDevice(worktreePath, repoRoot)) {
    worktreePath = join(repoRoot, '.git', 'copilot-worktrees', jobId);
    opts.onWarn?.(`State dir is on a different filesystem; using ${worktreePath} instead.`);
  }

  mkdirSync(dirname(worktreePath), { recursive: true });

  const add = tryGit(['worktree', 'add', '-b', branch, worktreePath, baseCommit], repoRoot);
  if (!add.ok) {
    throw new Error(`git worktree add failed: ${add.stderr || add.stdout}`);
  }

  // Initialize submodules in the worktree if the repo uses them.
  const gitmodulesPath = join(repoRoot, '.gitmodules');
  if (existsSync(gitmodulesPath)) {
    const sub = tryGit(['submodule', 'update', '--init', '--recursive'], worktreePath);
    if (!sub.ok) {
      opts.onWarn?.(`Submodule init failed in worktree (continuing anyway): ${sub.stderr}`);
    }
  }

  return { path: worktreePath, branch, baseCommit, repoRoot };
}

/**
 * Copilot edits files but does NOT commit them. This function stages and
 * commits all changes in the worktree so the branch carries the deliverable
 * and `computeDiffStats` works correctly.
 *
 * Returns `true` if a commit was created, `false` if the worktree was clean.
 */
export function commitWorktreeChanges(handle: WorktreeHandle, message: string): boolean {
  const dirty = tryGit(['status', '--porcelain'], handle.path);
  if (!dirty.ok || !dirty.stdout.trim()) return false;

  tryGit(['add', '-A'], handle.path);
  const commit = tryGit(['commit', '-m', message], handle.path);
  return commit.ok;
}

export interface CleanupOptions {
  /** `true` if the Copilot session finished cleanly. */
  success: boolean;
  onWarn?: (message: string) => void;
}

export function cleanupWorktree(handle: WorktreeHandle, opts: CleanupOptions): void {
  if (opts.success) {
    // Shrink the checkout by removing ignored build artifacts before teardown.
    tryGit(['clean', '-fdX'], handle.path);
    const rem = tryGit(['worktree', 'remove', handle.path], handle.repoRoot);
    if (!rem.ok) {
      // Retry forcefully — the checkout may contain untracked files we want to keep gone.
      tryGit(['worktree', 'remove', '--force', handle.path], handle.repoRoot);
    }
    // Keep the branch — that is the deliverable.
    return;
  }

  // Failure path: remove the checkout, and remove the branch iff no commits were made.
  tryGit(['worktree', 'remove', '--force', handle.path], handle.repoRoot);

  const tip = tryGit(['rev-parse', handle.branch], handle.repoRoot);
  if (tip.ok && tip.stdout === handle.baseCommit) {
    const del = tryGit(['branch', '-D', handle.branch], handle.repoRoot);
    if (!del.ok) opts.onWarn?.(`Could not delete branch ${handle.branch}: ${del.stderr}`);
  } else if (tip.ok) {
    opts.onWarn?.(
      `Branch ${handle.branch} has commits beyond baseline; retaining for inspection.`,
    );
  }
}

export interface DiffStats {
  filesModified: string[];
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Compute the set of files changed on the worktree branch, relative to the
 * base commit the worktree was created from.
 */
export function computeDiffStats(handle: WorktreeHandle): DiffStats {
  const names = tryGit(['diff', '--name-only', `${handle.baseCommit}..HEAD`], handle.path);
  const filesModified = names.ok && names.stdout ? names.stdout.split('\n').filter(Boolean) : [];

  let linesAdded = 0;
  let linesRemoved = 0;
  const numstat = tryGit(['diff', '--numstat', `${handle.baseCommit}..HEAD`], handle.path);
  if (numstat.ok && numstat.stdout) {
    for (const line of numstat.stdout.split('\n')) {
      const [addStr, delStr] = line.split('\t');
      const add = Number.parseInt(addStr ?? '0', 10);
      const del = Number.parseInt(delStr ?? '0', 10);
      if (Number.isFinite(add)) linesAdded += add;
      if (Number.isFinite(del)) linesRemoved += del;
    }
  }

  return { filesModified, linesAdded, linesRemoved };
}

/**
 * Best-effort cleanup of orphaned copilot/* worktrees and commit-free branches
 * older than `maxAgeDays`. Called from the `setup` command.
 */
export function pruneOrphans(cwd: string, maxAgeDays = 7): { worktreesPruned: boolean; branchesRemoved: number } {
  let repoRoot: string;
  try {
    repoRoot = resolveRepoRoot(cwd);
  } catch {
    return { worktreesPruned: false, branchesRemoved: 0 };
  }

  const prune = tryGit(['worktree', 'prune'], repoRoot);
  const worktreesPruned = prune.ok;

  // Enumerate copilot/* branches with their commit date.
  const branches = tryGit(
    ['for-each-ref', '--format=%(refname:short) %(committerdate:unix) %(objectname)', 'refs/heads/copilot/'],
    repoRoot,
  );
  let branchesRemoved = 0;
  if (branches.ok && branches.stdout) {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - maxAgeDays * 86400;
    for (const line of branches.stdout.split('\n')) {
      const [branch, tsStr, tip] = line.split(' ');
      if (!branch || !tsStr || !tip) continue;
      const ts = Number.parseInt(tsStr, 10);
      if (!Number.isFinite(ts) || ts > cutoff) continue;
      // Only remove if the branch tip equals an ancestor we can identify as empty
      // (i.e. no commits beyond an existing commit on main). Safer heuristic:
      // only prune branches that are reachable from HEAD (already merged / no-op).
      const merged = tryGit(['merge-base', '--is-ancestor', tip, 'HEAD'], repoRoot);
      if (merged.ok) {
        const del = tryGit(['branch', '-D', branch], repoRoot);
        if (del.ok) branchesRemoved++;
      }
    }
  }

  return { worktreesPruned, branchesRemoved };
}
