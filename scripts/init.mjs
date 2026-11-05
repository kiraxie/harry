#!/usr/bin/env node
// No marker block, no tool-name comment: it just checks each entry for an
// exact-match line anywhere in the file and appends whatever is missing, so a
// teammate reading .gitignore sees plain ignore rules, not harry branding.
// Trade-off (accepted): --remove deletes ANY line that exactly matches one of
// harry's entries, even one the user typed in by hand — there is no marker to
// tell the two apart.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { safeWrite } from "./lib/atomic-write.mjs";

const ENTRIES = [".local/", "*worktrees/", "CLAUDE.local.md"];

class UserError extends Error {}

/** @param {string} existing @param {{ remove?: boolean }} [opts] @returns {string} */
export function applyBlock(existing, { remove = false } = {}) {
  const text = existing ?? "";
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

// Only run the CLI when invoked directly (node scripts/init.mjs), not when
// imported by a test — importing must have no side effects on the target dir.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  try {
    const remove = args.includes("--remove");
    const target = args.find((a) => !a.startsWith("--")) ?? process.cwd();
    const { path, changed } = run(target, { remove });
    const what = changed
      ? remove
        ? "Removed harry's entries from"
        : "Updated"
      : remove
        ? "No harry entries to remove in"
        : "Already up to date:";
    console.log(`${what} ${path}`);
  } catch (err) {
    if (!(err instanceof UserError)) throw err;
    console.error(`harry: ${err.message}`);
    process.exitCode = 1;
  }
}
