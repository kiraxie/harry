// These scripts rewrite the user's hand-authored, un-versioned files —
// ~/.claude/CLAUDE.md, a project's .gitignore. A bare writeFileSync onto those is
// non-atomic: a crash or full disk mid-write leaves the irreplaceable file
// truncated with no recovery. Shared by both installers so the policy cannot diverge.

import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

// A sibling of the target, never a tmpdir: rename is atomic only within one
// filesystem. Unique per call because two installers can run at once (a second
// /harry:sync, or a sync racing `pnpm run install-laws`) against the same target:
// with a shared temp name they interleave write and rename, and one process
// renames the other's half-written file over the user's global instructions — the
// very truncation this module prevents. A per-call name is also why safeWrite
// must clean up after a failed write: there is no next run to reclaim a fixed
// path, so the debris would accumulate beside the user's global instructions.
/** @param {string} targetPath @returns {string} */
export function tempPathFor(targetPath) {
  return `${targetPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
}

/** @param {string} targetPath @param {string} content @returns {boolean} */
export function safeWrite(targetPath, content) {
  const exists = existsSync(targetPath);
  if ((exists ? readFileSync(targetPath, "utf8") : "") === content) return false;
  mkdirSync(dirname(targetPath), { recursive: true });
  const backupPath = `${targetPath}.bak`;
  // Only when no `.bak` exists, so a re-run never clobbers the original with a harry-modified one.
  if (exists && !existsSync(backupPath)) {
    copyFileSync(targetPath, backupPath);
  }
  const tmpPath = tempPathFor(targetPath);
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, targetPath);
    return true;
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best-effort cleanup: a failure here must never mask the real error.
    }
    throw err;
  }
}
