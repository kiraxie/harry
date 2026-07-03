#!/usr/bin/env node
// harry install-laws-codex — wire the resident HARRY.md into Codex CLI's global
// AGENTS.md by inlining its content into a marker block.
//
// Codex has no `@`-import syntax (unlike Claude Code's global CLAUDE.md), so this
// embeds a snapshot of HARRY.md's content rather than a live reference — re-run
// after HARRY.md changes to resync. Inserts into ~/.codex/AGENTS.md (override with
// HARRY_CODEX_GLOBAL). Idempotent; `--remove` strips it.
//
// Usage:
//   node scripts/install-codex.mjs            # install the inlined block
//   node scripts/install-codex.mjs --remove   # uninstall
//   node scripts/install-codex.mjs --selftest # runnable check

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMarkerBlock } from "./lib/markers.mjs";
import { STALE } from "./lib/stale-entries.mjs";

const BEGIN = "# >>> harry >>>";
const END = "# <<< harry <<<";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function globalPath() {
  return process.env.HARRY_CODEX_GLOBAL || join(homedir(), ".codex", "AGENTS.md");
}

export function applyImport(existing, { remove = false, root = pluginRoot } = {}) {
  const body = remove ? "" : readFileSync(join(root, "HARRY.md"), "utf8").replace(/\s+$/, "");
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

function run({ remove = false } = {}) {
  const path = globalPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (!remove) warnStale(existing);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, applyImport(existing, { remove }));
  return path;
}

function selftest() {
  const assert = (c, m) => {
    if (!c) throw new Error(`selftest failed: ${m}`);
  };
  const dir = mkdtempSync(join(tmpdir(), "harry-install-codex-"));
  try {
    const g = join(dir, "AGENTS.md");
    writeFileSync(g, "# My rules\n\nUse TDD.\n");
    const env = process.env.HARRY_CODEX_GLOBAL;
    process.env.HARRY_CODEX_GLOBAL = g;
    try {
      run();
      let out = readFileSync(g, "utf8");
      assert(out.includes("# My rules"), "preserves existing content");
      assert(out.includes("Resident Engineering Laws"), "inlines HARRY.md content");
      assert(out.split(BEGIN).length === 2, "one block after first run");
      run();
      out = readFileSync(g, "utf8");
      assert(out.split(BEGIN).length === 2, "idempotent on second run");
      run({ remove: true });
      out = readFileSync(g, "utf8");
      assert(!out.includes(BEGIN), "remove strips the block");
      assert(out.includes("Use TDD."), "remove keeps existing content");
    } finally {
      if (env === undefined) delete process.env.HARRY_CODEX_GLOBAL;
      else process.env.HARRY_CODEX_GLOBAL = env;
    }
    console.log("install-codex selftest: OK");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) {
  selftest();
} else {
  const path = run({ remove: args.includes("--remove") });
  console.log(
    `${args.includes("--remove") ? "Removed harry laws from" : "Wired HARRY.md into"} ${path}`,
  );
}
