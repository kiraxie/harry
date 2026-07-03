// Entries in a global instructions file that harry's laws supersede. Shared
// between install.mjs (Claude) and install-codex.mjs (Codex) — duplicating this
// list would let the two installers silently drift (HARRY.md §2).
export const STALE = [
  {
    pattern: /copilot:implement/i,
    why: "harry removed /copilot:implement; implementer = CC subagents",
  },
  { pattern: /copilot:status/i, why: "renamed to `status` in harry" },
  { pattern: /gemini:investigate/i, why: "research dispatch deferred in harry; remove for now" },
];
