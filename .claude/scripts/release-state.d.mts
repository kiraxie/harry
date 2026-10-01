export function parseVersion(v: string): { major: number; minor: number; patch: number };
export function compareVersions(a: string, b: string): -1 | 0 | 1;

export type ReleaseState =
  | "invalid-version"
  | "invalid-target"
  | "not-bumped"
  | "bumped-not-tagged"
  | "waiting-for-merge"
  | "already-tagged"
  | "version-mismatch-untracked";

export function detectState(facts: {
  latestTag: string | null;
  targetVersion: string;
  tagExists: boolean;
  bumpCommitExists: boolean;
  startHasBumpCommit?: boolean;
  fieldHoldsTarget: boolean;
}): ReleaseState;

export function latestTag(repoRoot: string): string | null;
export function gitTagExists(repoRoot: string, version: string): boolean;
export function bumpSubject(version: string): string;
export function gitBumpCommitExists(repoRoot: string, version: string, ref?: string): boolean;
export function fieldHoldsTarget(repoRoot: string, fields: string[], version: string): boolean;
export function run(
  targetVersion: string,
  fields?: string[],
  repoRoot?: string,
  start?: string,
): ReleaseState;
