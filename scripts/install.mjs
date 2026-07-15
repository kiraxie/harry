#!/usr/bin/env node
// harry install-laws — DEPLOY the resident HARRY.md as a snapshot and wire the
// global instructions file to it via an `@` import, so the laws load every
// session without a keyword.
//
// Deploys a copy of the plugin's current HARRY.md to <home>/.claude/harry/HARRY.md
// and inserts a marker-wrapped `@<home>/.claude/harry/HARRY.md` line into
// ~/.claude/CLAUDE.md (override the global file with HARRY_GLOBAL; the snapshot
// path derives from its directory). This is a snapshot, NOT a live reference to
// the plugin checkout: editing the plugin's HARRY.md (even uncommitted) does not
// change installed behavior until you re-run this — "release" = re-run
// `pnpm run install-laws` / `/harry:sync`. This mirrors the Codex build
// (install-codex.mjs), so both builds share one mental model: re-run sync to
// resync laws after updating.
//
// Re-running re-deploys the snapshot and rewrites the marker block idempotently,
// migrating any older direct-repo-path import inside harry's block to the
// deployed path. Idempotent; `--remove` strips the import block (the deployed
// snapshot copy is left in place — a harmless file, and deletion is the user's
// call). Also warns about stale entries in the global file that harry supersedes
// (it does NOT edit the user's hand-written rules — that's the user's call).
//
// Usage:
//   node scripts/install.mjs            # deploy the snapshot + wire the @ import
//   node scripts/install.mjs --explore  # also deploy the user-level Explore override
//   node scripts/install.mjs --remove   # uninstall the import block + harry's Explore override
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

// Where the deployed snapshot of HARRY.md lives: alongside the global
// instructions file (both under <home>/.claude in real use), so tests that point
// HARRY_GLOBAL at a temp dir get a temp snapshot path too — never the real home.
function snapshotPath() {
  return join(dirname(globalPath()), "harry", "HARRY.md");
}

export function applyImport(existing, { remove = false, importPath = snapshotPath() } = {}) {
  const body = `@${importPath}`;
  return applyMarkerBlock(existing, { begin: BEGIN, end: END, body, remove });
}

// Optional user-level Explore override (opt-in, `--explore`). A same-name
// `~/.claude/agents/Explore.md` shadows the built-in Explore so *auto-invoked*
// recon runs on a cheap model instead of inheriting the main-session model. It's a
// whole standalone agent file (not a marker block), so its marker is a line inside
// the file — `--remove` only deletes an Explore.md bearing it, never a user's own.
const EXPLORE_MARKER = "harry:explore-override";
const EXPLORE_SOURCE = join(pluginRoot, "scripts", "assets", "explore-override.md");

function explorePath() {
  return join(dirname(globalPath()), "agents", "Explore.md");
}

function deployExplore() {
  const dest = explorePath();
  mkdirSync(dirname(dest), { recursive: true });
  safeWrite(dest, readFileSync(EXPLORE_SOURCE, "utf8"));
}

function removeExplore() {
  const dest = explorePath();
  if (existsSync(dest) && readFileSync(dest, "utf8").includes(EXPLORE_MARKER)) {
    rmSync(dest);
  }
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

export function run({ remove = false, explore = false } = {}) {
  const path = globalPath();
  const snapshot = snapshotPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (remove) {
    removeExplore();
  } else {
    warnStale(existing);
    // Deploy: copy the plugin's current HARRY.md into the snapshot location, so
    // the wired-in @ import reads a frozen copy — not the live plugin checkout.
    mkdirSync(dirname(snapshot), { recursive: true });
    safeWrite(snapshot, readFileSync(join(pluginRoot, "HARRY.md"), "utf8"));
    if (explore) deployExplore();
  }
  mkdirSync(dirname(path), { recursive: true });
  safeWrite(path, applyImport(existing, { remove, importPath: snapshot }));
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
      const snap = join(dir, "harry", "HARRY.md");
      run();
      let out = readFileSync(g, "utf8");
      assert(out.includes("# My rules"), "preserves existing content");
      assert(out.includes(`@${snap}`), "wires the @ import at the deployed snapshot");
      assert(existsSync(snap), "deploys the HARRY.md snapshot");
      assert(
        readFileSync(snap, "utf8").includes("Resident Engineering Laws"),
        "snapshot holds HARRY.md content",
      );
      assert(out.split(BEGIN).length === 2, "one block after first run");
      run();
      out = readFileSync(g, "utf8");
      assert(out.split(BEGIN).length === 2, "idempotent on second run");
      // --explore deploys the user-level Explore override; --remove deletes it.
      const explore = join(dir, "agents", "Explore.md");
      run({ explore: true });
      assert(existsSync(explore), "--explore deploys the Explore override");
      assert(
        readFileSync(explore, "utf8").includes(EXPLORE_MARKER),
        "Explore override carries the marker",
      );
      run({ remove: true });
      out = readFileSync(g, "utf8");
      assert(!out.includes(BEGIN), "remove strips the block");
      assert(out.includes("Use TDD."), "remove keeps existing content");
      assert(!existsSync(explore), "remove deletes harry's Explore override");
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
    const remove = args.includes("--remove");
    const explore = args.includes("--explore");
    const path = run({ remove, explore });
    const what = remove
      ? "Removed harry import from"
      : explore
        ? "Wired HARRY.md + deployed Explore override into"
        : "Wired HARRY.md into";
    console.log(`${what} ${path}`);
  }
}
