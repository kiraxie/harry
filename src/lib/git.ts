/**
 * Read-only git helpers for `companion review`: resolve what to review (branch
 * vs working tree) and where the checkout lives. Originally ported from the
 * codex plugin's lib/git.mjs.
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

interface CommandResult {
  /** `null` when git never ran (spawn failure) or was killed by a signal —
   * deliberately NOT coerced to 0, which would read as a clean success. */
  status: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
}

// Why a git call failed, in human-readable form: git's own stderr when it said
// anything, else the exit code — or, when there is no status at all, the fact
// that git never returned one (killed by a signal, or the spawn itself failed).
// `exit null` would read as a real exit code and is never what happened.
function failureReason(result: CommandResult): string {
  if (result.stderr.trim()) return result.stderr.trim();
  return result.status === null ? "killed by a signal or failed to spawn" : `exit ${result.status}`;
}

export function truncateUtf8(s: string, maxBytes: number): { text: string; truncated: boolean } {
  // A negative or fractional cap is a caller bug, and propagating one would
  // silently skip the boundary walk below: `subarray(0, -5)` counts from the
  // END, and `buf[2.5]` is `undefined`, which fails the continuation-byte test.
  // Either would reintroduce exactly the defect the walk exists to prevent, so
  // normalize instead: the function is exported and called directly, including
  // by tests that hand it NaN and Infinity.
  const cap = Math.max(0, Math.trunc(maxBytes));
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= cap) return { text: s, truncated: false };
  // Back off any character the cut lands inside, BEFORE decoding. `cap` is a
  // byte offset with no regard for character boundaries, and decoding an
  // orphaned tail yields U+FFFD — three bytes standing in for the one to three
  // they replaced. When the orphan is one or two bytes that overruns the cap;
  // when it is three (a 4-byte character cut after its third byte) it is
  // three-for-three, so only the glyph is injected. Both are wrong: the input
  // never contained that character. UTF-8 continuation bytes are `10xxxxxx`;
  // walking back off them lands on a character boundary.
  let end = cap;
  while (end > 0 && (buf[end] & 0b1100_0000) === 0b1000_0000) end--;
  // Then trim back to the nearest line break to avoid cutting mid-line.
  let cut = buf.subarray(0, end).toString("utf8");
  const lastNl = cut.lastIndexOf("\n");
  if (lastNl > 0) cut = cut.slice(0, lastNl);
  return { text: cut, truncated: true };
}

function git(cwd: string, args: string[]): CommandResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: (result.error as NodeJS.ErrnoException) ?? null,
  };
}

function gitChecked(cwd: string, args: string[]): CommandResult {
  const result = git(cwd, args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${failureReason(result)}`);
  }
  return result;
}

export function ensureGitRepository(cwd: string): string {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.error?.code === "ENOENT")
    throw new Error("git is not installed. Install Git and retry.");
  if (result.status !== 0) throw new Error("This command must run inside a Git repository.");
  return result.stdout.trim();
}

export function getRepoRoot(cwd: string): string {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

/** The main checkout's root — the same from any linked worktree of the repo. */
export function getMainCheckoutRoot(cwd: string): string {
  const commonDir = gitChecked(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]).stdout.trim();
  return dirname(commonDir);
}

/** The current branch name (may contain `/`), or the short HEAD sha when detached. */
export function getBranchOrShortSha(cwd: string): string {
  const branch = gitChecked(cwd, ["branch", "--show-current"]).stdout.trim();
  return branch || gitChecked(cwd, ["rev-parse", "--short", "HEAD"]).stdout.trim();
}

/** Number of files changed in `<baseRef>...HEAD`. */
export function countBranchChanges(cwd: string, baseRef: string): number {
  return gitChecked(cwd, ["diff", "--name-only", `${baseRef}...HEAD`])
    .stdout.split("\n")
    .filter(Boolean).length;
}

function detectDefaultBranch(cwd: string): string {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const head = symbolic.stdout.trim();
    if (head.startsWith("refs/remotes/")) return head.replace("refs/remotes/", "");
  }
  for (const candidate of ["main", "master", "trunk"]) {
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]).status === 0)
      return candidate;
    if (
      git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]).status === 0
    )
      return `origin/${candidate}`;
  }
  throw new Error("Unable to detect the repository default branch. Pass --base <ref>.");
}

interface WorkingTreeState {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  isDirty: boolean;
}

function getWorkingTreeState(cwd: string): WorkingTreeState {
  const split = (s: string): string[] => s.trim().split("\n").filter(Boolean);
  const staged = split(gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout);
  const unstaged = split(gitChecked(cwd, ["diff", "--name-only"]).stdout);
  const untracked = split(gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout);
  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
  };
}

export interface ReviewTarget {
  mode: "working-tree" | "branch";
  label: string;
  baseRef?: string;
}

/**
 * `--base <ref>` → that branch diff. Otherwise a dirty working tree (untracked
 * files included) → the working tree, and a clean one → the branch against the
 * detected default branch.
 */
export function resolveReviewTarget(cwd: string, options: { base?: string } = {}): ReviewTarget {
  ensureGitRepository(cwd);
  if (options.base) {
    return { mode: "branch", label: `branch diff against ${options.base}`, baseRef: options.base };
  }
  if (getWorkingTreeState(cwd).isDirty) {
    return { mode: "working-tree", label: "working tree diff" };
  }
  const detected = detectDefaultBranch(cwd);
  return { mode: "branch", label: `branch diff against ${detected}`, baseRef: detected };
}
