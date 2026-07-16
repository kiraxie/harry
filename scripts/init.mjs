#!/usr/bin/env node
// harry init — add harry's required ignore entries to a project's .gitignore.
// No marker block, no tool-name comment: it just checks each entry for an
// exact-match line anywhere in the file and appends whatever is missing, so a
// teammate reading .gitignore sees plain ignore rules, not harry branding.
// Trade-off (accepted): --remove deletes ANY line that exactly matches one of
// harry's entries, even one the user typed in by hand — there is no marker to
// tell the two apart.
//
// Usage:
//   node scripts/init.mjs [targetDir]     # default: cwd
//   node scripts/init.mjs --remove [dir]  # uninstall the entries
//   node scripts/init.mjs --selftest      # runnable check (no project needed)

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { safeWrite } from "./lib/atomic-write.mjs";

// Per project dir: local scratch (items/, archive/, INDEX.md with its
// in-flight work list, HISTORY.md, tmp/ handoff files), worktree sandboxes,
// and the user's per-project specialization rules. All non-versioned.
const ENTRIES = [".local/", "*worktrees/", "CLAUDE.local.md"];

// Returns the .gitignore content with harry's entries appended (or removed).
// Per-entry dedupe: an entry already present anywhere in the file is skipped,
// so it never duplicates a line the user already has.
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

export function run(targetDir, { remove = false } = {}) {
  const path = join(targetDir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  safeWrite(path, applyBlock(existing, { remove }));
  return path;
}

function selftest() {
  const assert = (cond, msg) => {
    if (!cond) {
      throw new Error(`selftest failed: ${msg}`);
    }
  };
  const dir = mkdtempSync(join(tmpdir(), "harry-init-"));
  try {
    // Pre-existing content is preserved; entries appended once.
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    run(dir);
    let out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(out.includes("node_modules/"), "preserves existing entries");
    assert(out.includes(".local/"), "adds .local/");
    assert(out.includes("*worktrees/"), "adds *worktrees/");
    assert(out.includes("CLAUDE.local.md"), "adds CLAUDE.local.md");
    assert(!out.includes("harry"), "no harry branding in the output");

    // Idempotent: second run does not duplicate any entry.
    run(dir);
    out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(
      out.split("\n").filter((l) => l.trim() === ".local/").length === 1,
      "still one .local/ line after second run (idempotent)",
    );

    // Dedupe: an entry already present is not duplicated.
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

    // Works when no .gitignore exists yet.
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
    const remove = args.includes("--remove");
    const target = args.find((a) => !a.startsWith("--")) ?? process.cwd();
    const path = run(target, { remove });
    console.log(`${remove ? "Removed harry's entries from" : "Updated"} ${path}`);
  }
}
