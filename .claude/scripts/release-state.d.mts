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

export function run(targetVersion: string, repoRoot?: string): ReleaseState;
