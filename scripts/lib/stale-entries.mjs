// Entries in a global instructions file that harry's laws supersede, and the
// warning that renders them. Both are shared between install.mjs (Claude) and
// install-codex.mjs (Codex) — duplicating either the list or the message would
// let the two installers silently drift (HARRY.md §2).
export const STALE = [
  {
    pattern: /copilot:implement/i,
    why: "harry removed /copilot:implement; implementer = CC subagents",
  },
  { pattern: /copilot:status/i, why: "renamed to `status` in harry" },
  { pattern: /gemini:investigate/i, why: "research dispatch deferred in harry; remove for now" },
];

// Warn about superseded entries found in `text` (the user's global instructions).
// Reports only — harry never edits the user's hand-written rules.
export function warnStale(text) {
  const hits = STALE.filter((s) => s.pattern.test(text));
  if (hits.length) {
    console.warn(
      "\n  Stale entries in your global instructions (harry supersedes — edit manually):",
    );
    for (const h of hits) console.warn(`    - ${h.pattern.source} → ${h.why}`);
  }
}
