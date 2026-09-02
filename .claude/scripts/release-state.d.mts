export function parseVersion(v: string): { major: number; minor: number; patch: number };
export function compareVersions(a: string, b: string): -1 | 0 | 1;

export type ReleaseState =
  | "invalid-version"
  | "invalid-target"
  | "not-bumped"
  | "bumped-not-tagged"
  | "already-tagged"
  | "version-mismatch-untracked";

export function detectState(facts: {
  currentVersion: string;
  targetVersion: string;
  tagExists: boolean;
  bumpCommitExists: boolean;
}): ReleaseState;

export function gitTagExists(repoRoot: string, version: string): boolean;
export function gitBumpCommitExists(repoRoot: string, version: string): boolean;

// Throws on an unexpected environment/git failure (not a git repo, git missing,
// package.json unreadable) — a malformed `targetVersion` is NOT such a failure,
// it classifies cleanly to "invalid-version" instead.
export function run(targetVersion: string, repoRoot?: string): ReleaseState;
