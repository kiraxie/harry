// Atomic, backup-preserving writes for harry's installers (init, install-laws,
// install-laws-codex). These scripts rewrite the user's hand-authored,
// un-versioned files — ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, a project's
// .gitignore. A bare writeFileSync onto those is non-atomic: a crash or full
// disk mid-write leaves the irreplaceable file truncated with no recovery.
//
// All three installers must write safely — divergence would be a bug
// (HARRY.md §2: shared knowledge across a boundary gets one source of truth),
// so the safe-write policy lives here once.

import { copyFileSync, existsSync, renameSync, writeFileSync } from "node:fs";

// Write `content` to `targetPath` atomically, keeping a one-time backup.
//
//  1. On the FIRST modification of an existing target, copy it to `<target>.bak`
//     — but only if no `.bak` already exists, so re-runs never clobber the
//     original snapshot with a harry-modified one.
//  2. Write to a sibling `<target>.tmp` (same directory → same filesystem, so the
//     rename is atomic), then rename it over the target. A reader ever sees only
//     the complete old file or the complete new one, never a half-written file.
export function safeWrite(targetPath, content) {
  const backupPath = `${targetPath}.bak`;
  if (existsSync(targetPath) && !existsSync(backupPath)) {
    copyFileSync(targetPath, backupPath);
  }
  const tmpPath = `${targetPath}.tmp`;
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, targetPath);
}
