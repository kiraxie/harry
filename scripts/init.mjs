#!/usr/bin/env node
// No marker block, no tool-name comment: it just checks each entry for an
// exact-match line anywhere in the file and appends whatever is missing, so a
// teammate reading .gitignore sees plain ignore rules, not harry branding.
// Trade-off (accepted): --remove deletes ANY line that exactly matches one of
// harry's entries, even one the user typed in by hand — there is no marker to
// tell the two apart.

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function selftest() {
  /** @param {unknown} cond @param {string} msg */
  const assert = (cond, msg) => {
    if (!cond) {
      throw new Error(`selftest failed: ${msg}`);
    }
  };
  const dir = mkdtempSync(join(tmpdir(), "harry-init-"));
  try {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    run(dir);
    let out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(out.includes("node_modules/"), "preserves existing entries");
    assert(out.includes(".local/"), "adds .local/");
    assert(out.includes("*worktrees/"), "adds *worktrees/");
    assert(out.includes("CLAUDE.local.md"), "adds CLAUDE.local.md");
    assert(!out.includes("harry"), "no harry branding in the output");

    run(dir);
    out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(
      out.split("\n").filter((l) => l.trim() === ".local/").length === 1,
      "still one .local/ line after second run (idempotent)",
    );

    writeFileSync(join(dir, ".gitignore"), "node_modules/\n.local/\n");
    run(dir);
    out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(
      out.split("\n").filter((l) => l.trim() === ".local/").length === 1,
      "no duplicate .local/ entry",
    );
    assert(out.includes("*worktrees/"), "still adds the non-duplicate entries");

    // Removal strips every line matching harry's entries, including one the
    // user typed by hand (accepted trade-off of dropping the marker block).
    run(dir, { remove: true });
    out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(!out.includes(".local/"), "remove strips a .local/ line even if user-authored");
    assert(!out.includes("*worktrees/"), "remove strips harry's entries");
    assert(!out.includes("CLAUDE.local.md"), "remove strips harry's entries");
    assert(out.includes("node_modules/"), "remove keeps unrelated existing entries");

    const dir2 = mkdtempSync(join(tmpdir(), "harry-init-"));
    run(dir2);
    assert(
      readFileSync(join(dir2, ".gitignore"), "utf8").includes(".local/"),
      "creates fresh .gitignore",
    );
    rmSync(dir2, { recursive: true, force: true });

    console.log("init selftest: OK");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Only run the CLI when invoked directly (node scripts/init.mjs), not when
// imported by a test — importing must have no side effects on the target dir.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    selftest();
  } else {
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
}
