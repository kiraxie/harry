// A snapshot, NOT a live reference to the plugin checkout: editing the plugin's
// HARRY.md (even uncommitted) changes nothing installed until this re-runs.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeWrite } from "./atomic-write.mjs";
import { applyMarkerBlock } from "./markers.mjs";
import { warnStale } from "./stale-entries.mjs";

const BEGIN = "# >>> harry >>>";
const END = "# <<< harry <<<";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function globalPath() {
  return process.env.HARRY_GLOBAL || join(homedir(), ".claude", "CLAUDE.md");
}

// Where the deployed snapshot of HARRY.md lives: alongside the global
// instructions file (both under <home>/.claude in real use), so tests that point
// HARRY_GLOBAL at a temp dir get a temp snapshot path too — never the real home.
function snapshotPath() {
  return join(dirname(globalPath()), "harry", "HARRY.md");
}

/** @param {string} existing @param {{ remove: boolean; importPath: string }} opts @returns {string} */
function applyImport(existing, { remove, importPath }) {
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

/** @typedef {"deployed" | "unchanged" | "skipped" | "removed" | "absent"} ExploreOutcome */

/** @returns {ExploreOutcome} */
function deployExplore() {
  const dest = explorePath();
  // Symmetric with removeExplore: never silently clobber a user's own Explore.md.
  // Overwrite only our own marked file (idempotent redeploy); if an UNMARKED file
  // exists, it's the user's — leave it and warn instead.
  if (existsSync(dest) && !readFileSync(dest, "utf8").includes(EXPLORE_MARKER)) {
    console.warn(
      `\n  ${dest} already exists and isn't harry's — leaving it untouched.` +
        `\n  Delete it yourself first if you want harry's Explore override.`,
    );
    return "skipped";
  }
  return safeWrite(dest, readFileSync(EXPLORE_SOURCE, "utf8")) ? "deployed" : "unchanged";
}

/** @returns {ExploreOutcome} */
function removeExplore() {
  const dest = explorePath();
  if (existsSync(dest) && readFileSync(dest, "utf8").includes(EXPLORE_MARKER)) {
    rmSync(dest);
    return "removed";
  }
  return "absent";
}

/**
 * @param {{ remove?: boolean; explore?: boolean }} [opts]
 * @returns {{
 *   path: string;
 *   imported: boolean;
 *   snapshot: { path: string; changed: boolean };
 *   explore: { path: string; outcome: ExploreOutcome } | null;
 * }}
 */
export function run({ remove = false, explore = false } = {}) {
  const path = globalPath();
  const snapshot = snapshotPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  let snapshotChanged = false;
  /** @type {ExploreOutcome | null} */
  let exploreOutcome = null;
  if (remove) {
    exploreOutcome = removeExplore();
  } else {
    warnStale(existing);
    // Deploy: copy the plugin's current HARRY.md into the snapshot location, so
    // the wired-in @ import reads a frozen copy — not the live plugin checkout.
    snapshotChanged = safeWrite(snapshot, readFileSync(join(pluginRoot, "HARRY.md"), "utf8"));
    if (explore) exploreOutcome = deployExplore();
  }
  const imported = safeWrite(path, applyImport(existing, { remove, importPath: snapshot }));
  return {
    path,
    imported,
    snapshot: { path: snapshot, changed: snapshotChanged },
    explore: exploreOutcome === null ? null : { path: explorePath(), outcome: exploreOutcome },
  };
}
