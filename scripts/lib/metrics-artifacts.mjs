// The dirs metrics itself writes in a group dir, apart from the coverage output a
// project's own tool names (.coverage, coverage): init ignores exactly these, and
// src/lib/metrics/guard.ts clears them after a run.

/** @type {readonly string[]} */
export const METRICS_DIRS = [
  ".metrics",
  "target/coverage",
  "target/mutation-workers",
  "target/mutator-backup",
];
