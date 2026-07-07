#!/usr/bin/env node
// harry install-laws — wire the resident HARRY.md into the global instructions
// file via an `@` import, so the laws load every session without a keyword.
//
// Inserts a marker-wrapped `@<pluginRoot>/HARRY.md` line into ~/.claude/CLAUDE.md
// (override with HARRY_GLOBAL). Idempotent; `--remove` strips it. Also warns
// about stale entries in the global file that harry supersedes (it does NOT
// edit the user's hand-written rules — that's the user's call).
//
// Usage:
//   node scripts/install.mjs            # install the @ import
//   node scripts/install.mjs --remove   # uninstall
//   node scripts/install.mjs --selftest # runnable check

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { safeWrite } from "./lib/atomic-write.mjs";
import { applyMarkerBlock } from "./lib/markers.mjs";
import { STALE } from "./lib/stale-entries.mjs";

const BEGIN = "# >>> harry >>>";
const END = "# <<< harry <<<";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function globalPath() {
  return process.env.HARRY_GLOBAL || join(homedir(), ".claude", "CLAUDE.md");
}

export function applyImport(existing, { remove = false, root = pluginRoot } = {}) {
  const body = `@${root}/HARRY.md`;
  return applyMarkerBlock(existing, { begin: BEGIN, end: END, body, remove });
}

function warnStale(text) {
  const hits = STALE.filter((s) => s.pattern.test(text));
  if (hits.length) {
    console.warn(
      "\n  Stale entries in your global instructions (harry supersedes — edit manually):",
    );
    for (const h of hits) console.warn(`    - ${h.pattern.source} → ${h.why}`);
  }
}

export function run({ remove = false } = {}) {
  const path = globalPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (!remove) warnStale(existing);
  mkdirSync(dirname(path), { recursive: true });
  safeWrite(path, applyImport(existing, { remove }));
  return path;
}

function selftest() {
  const assert = (c, m) => {
    if (!c) throw new Error(`selftest failed: ${m}`);
  };
  const dir = mkdtempSync(join(tmpdir(), "harry-install-"));
  try {
    const g = join(dir, "CLAUDE.md");
    writeFileSync(g, "# My rules\n\nUse TDD.\n");
    const env = process.env.HARRY_GLOBAL;
    process.env.HARRY_GLOBAL = g;
    try {
      run();
      let out = readFileSync(g, "utf8");
      assert(out.includes("# My rules"), "preserves existing content");
      assert(out.includes("/HARRY.md"), "writes the @ import");
      assert(out.split(BEGIN).length === 2, "one block after first run");
      run();
      out = readFileSync(g, "utf8");
      assert(out.split(BEGIN).length === 2, "idempotent on second run");
      run({ remove: true });
      out = readFileSync(g, "utf8");
      assert(!out.includes(BEGIN), "remove strips the block");
      assert(out.includes("Use TDD."), "remove keeps existing content");
    } finally {
      if (env === undefined) delete process.env.HARRY_GLOBAL;
      else process.env.HARRY_GLOBAL = env;
    }
    console.log("install selftest: OK");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Only run the CLI when invoked directly (node scripts/install.mjs), not when
// imported by a test — importing must have no side effects on the user's files.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    selftest();
  } else {
    const path = run({ remove: args.includes("--remove") });
    console.log(
      `${args.includes("--remove") ? "Removed harry import from" : "Wired HARRY.md into"} ${path}`,
    );
  }
}
