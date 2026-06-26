#!/usr/bin/env node
// harry init — add harry's required ignore entries to a project's .gitignore.
// Idempotent and marker-wrapped, so re-running replaces the block instead of
// duplicating it, and `--remove` strips it cleanly.
//
// Usage:
//   node scripts/init.mjs [targetDir]     # default: cwd
//   node scripts/init.mjs --remove [dir]  # uninstall the block
//   node scripts/init.mjs --selftest      # runnable check (no project needed)

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyMarkerBlock } from "./lib/markers.mjs";

const BEGIN = "# >>> harry >>>";
const END = "# <<< harry <<<";
// Per project dir: local scratch (specs/plans/ledger), worktree sandboxes, and
// the user's per-project memo file. All non-versioned.
const ENTRIES = [".local/", ".worktrees/", "CLAUDE.local.md"];

// Returns the .gitignore content with the harry block applied (or removed).
export function applyBlock(existing, { remove = false } = {}) {
  return applyMarkerBlock(existing, { begin: BEGIN, end: END, body: ENTRIES.join("\n"), remove });
}

function run(targetDir, { remove = false } = {}) {
  const path = join(targetDir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, applyBlock(existing, { remove }));
  return path;
}

function selftest() {
  const assert = (cond, msg) => { if (!cond) { throw new Error("selftest failed: " + msg); } };
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

    // Removal strips the block, keeps the rest.
    run(dir, { remove: true });
    out = readFileSync(join(dir, ".gitignore"), "utf8");
    assert(!out.includes(BEGIN), "remove strips the block");
    assert(out.includes("node_modules/"), "remove keeps existing entries");

    // Works when no .gitignore exists yet.
    const dir2 = mkdtempSync(join(tmpdir(), "harry-init-"));
    run(dir2);
    assert(readFileSync(join(dir2, ".gitignore"), "utf8").split(BEGIN).length === 2, "creates fresh .gitignore");
    rmSync(dir2, { recursive: true, force: true });

    console.log("init selftest: OK");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) {
  selftest();
} else {
  const remove = args.includes("--remove");
  const target = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const path = run(target, { remove });
  console.log(`${remove ? "Removed harry block from" : "Updated"} ${path}`);
}
