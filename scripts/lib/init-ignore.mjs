// No marker block, no tool-name comment: it just checks each entry for an
// exact-match line anywhere in the file and appends whatever is missing, so a
// teammate reading .gitignore sees plain ignore rules, not harry branding.
// Trade-off (accepted): --remove deletes ANY line that exactly matches one of
// harry's entries, even one the user typed in by hand — there is no marker to
// tell the two apart.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { safeWrite } from "./atomic-write.mjs";
import { METRICS_DIRS } from "./metrics-artifacts.mjs";

// Metrics' dirs one by one, not target/: --remove would take a target/ line a Rust or
// Maven project wrote for its own build output. Metrics writes them under each group's
// dir, so they match at any depth.
const ENTRIES = [
  ".local/",
  "*worktrees/",
  "CLAUDE.local.md",
  ...METRICS_DIRS.map((d) => `**/${d}/`),
];

export class UserError extends Error {}

/** @param {string} text @param {{ remove: boolean }} opts @returns {string} */
function applyBlock(text, { remove }) {
  const endsWithNewline = text.endsWith("\n");
  const lines = text.length === 0 ? [] : text.split("\n");
  const body = endsWithNewline ? lines.slice(0, -1) : lines;

  if (remove) {
    const kept = body.filter((l) => !ENTRIES.includes(l.trim()));
    if (kept.length === 0) return "";
    return `${kept.join("\n")}\n`;
  }

  const present = new Set(body.map((l) => l.trim()));
  const missing = ENTRIES.filter((e) => !present.has(e));
  if (missing.length === 0) return text;

  const trimmed = [...body];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
    trimmed.pop();
  }
  const merged = trimmed.length > 0 ? [...trimmed, "", ...missing] : [...missing];
  return `${merged.join("\n")}\n`;
}

/** @param {string} targetDir @param {{ remove?: boolean }} [opts] @returns {{ path: string; changed: boolean }} */
export function run(targetDir, { remove = false } = {}) {
  // safeWrite makes a missing parent, which here is a typo'd target, not a dir to create.
  if (!statSync(targetDir, { throwIfNoEntry: false })?.isDirectory())
    throw new UserError(`not a directory: ${targetDir}`);
  const path = join(targetDir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  return { path, changed: safeWrite(path, applyBlock(existing, { remove })) };
}
