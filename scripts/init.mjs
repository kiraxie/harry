#!/usr/bin/env node
// harry init — add harry's required ignore entries to a project's .gitignore.
// Idempotent and marker-wrapped, so re-running replaces the block instead of
// duplicating it, and `--remove` strips it cleanly.
//
// Usage:
//   node scripts/init.mjs [targetDir]     # default: cwd
//   node scripts/init.mjs --remove [dir]  # uninstall the block
//   node scripts/init.mjs --selftest      # runnable check (no project needed)

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { safeWrite } from "./lib/atomic-write.mjs";
import { applyMarkerBlock, stripMarkerBlock } from "./lib/markers.mjs";

const BEGIN = "# >>> harry >>>";
const END = "# <<< harry <<<";
// Per project dir: local scratch (items/, archive/, INDEX.md with its
// in-flight work list, HISTORY.md, tmp/ handoff files), worktree sandboxes,
// and the user's per-project specialization rules. All non-versioned.
const ENTRIES = [".local/", "*worktrees/", "CLAUDE.local.md"];

// Returns the .gitignore content with the harry block applied (or removed).
// Per-entry dedupe: an entry already ignored elsewhere in the file (outside
// harry's block) is skipped, so the block never duplicates a line the user
// already has. If every entry is already covered, no block is written.
export function applyBlock(existing, { remove = false } = {}) {
  if (remove) {
    return applyMarkerBlock(existing, { begin: BEGIN, end: END, body: "", remove: true });
  }
  const base = stripMarkerBlock(existing ?? "", { begin: BEGIN, end: END });
  const present = new Set(
    base
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const entries = ENTRIES.filter((e) => !present.has(e));
  if (entries.length === 0) {
    // Nothing left to add — strip any stale harry block, write no new one.
    return applyMarkerBlock(existing, { begin: BEGIN, end: END, body: "", remove: true });
  }
  return applyMarkerBlock(existing, { begin: BEGIN, end: END, body: entries.join("\n") });
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
    // Pre-existing content is preserved; block appended once.
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    run(dir);
    let out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(out.includes("node_modules/"), "preserves existing entries");
    assert(out.split(BEGIN).length === 2, "exactly one begin marker after first run");
    assert(out.includes("CLAUDE.local.md"), "writes entries");

    // Idempotent: second run does not duplicate the block.
    run(dir);
    out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(out.split(BEGIN).length === 2, "still one block after second run (idempotent)");

    // Dedupe: an entry already present outside the block is not duplicated.
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n.local/\n");
    run(dir);
    out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(
      out.split("\n").filter((l) => l.trim() === ".local/").length === 1,
      "no duplicate .local/ entry",
    );
    assert(out.includes("*worktrees/"), "still adds the non-duplicate entries");

    // Removal strips the block, keeps the rest (dir still has a block from above).
    run(dir, { remove: true });
    out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(!out.includes(BEGIN), "remove strips the block");
    assert(out.includes("node_modules/"), "remove keeps existing entries");
    assert(out.includes(".local/"), "remove keeps the user's own .local/ entry");

    // Works when no .gitignore exists yet.
    const dir2 = mkdtempSync(join(tmpdir(), "harry-init-"));
    run(dir2);
    assert(
      readFileSync(join(dir2, ".gitignore"), "utf8").split(BEGIN).length === 2,
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
    console.log(`${remove ? "Removed harry block from" : "Updated"} ${path}`);
  }
}
