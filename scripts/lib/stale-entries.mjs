// Entries in a global instructions file that harry's laws supersede, and the
// warning that renders them; install.mjs warns with them.
export const STALE = [
  {
    pattern: /copilot:implement/i,
    why: "harry removed /copilot:implement; the session implements",
  },
  {
    pattern: /copilot:status/i,
    why: "retired in harry: no quota source since the in-process Codex runtime was removed",
  },
  { pattern: /gemini:investigate/i, why: "research dispatch deferred in harry; remove for now" },
];

// Warn about superseded entries found in `text` (the user's global instructions).
// Reports only — harry never edits the user's hand-written rules.
/** @param {string} text */
export function warnStale(text) {
  const hits = STALE.filter((s) => s.pattern.test(text));
  if (hits.length) {
    console.warn(
      "\n  Stale entries in your global instructions (harry supersedes — edit manually):",
    );
    for (const h of hits) console.warn(`    - ${h.pattern.source} → ${h.why}`);
  }
}
