// Shared marker-block editing for harry's installers (init, install-laws).
// Both wrap a body between `# >>> harry >>>` / `# <<< harry <<<` markers and
// must behave identically — re-running replaces the block in place, --remove
// strips it. Extracted because divergence between the two would be a bug
// (HARRY.md §2: shared knowledge across a boundary gets one source of truth).

// Returns `existing` with harry's marked block removed (everything else kept).
// Used to recover the user-owned base before re-applying or dedup-checking.
export function stripMarkerBlock(existing, { begin, end }) {
  const text = existing ?? "";
  const bi = text.indexOf(begin);
  const ei = text.indexOf(end);
  if (bi !== -1 && ei !== -1 && ei > bi) {
    const tail = text.slice(ei + end.length).replace(/^\n/, "");
    return text.slice(0, bi) + tail;
  }
  return text;
}

// Returns `existing` with the marked block applied (or removed). Idempotent:
// any pre-existing block between the markers is stripped first, so a second
// run produces identical output.
export function applyMarkerBlock(existing, { begin, end, body, remove = false }) {
  let base = stripMarkerBlock(existing, { begin, end });
  base = base.replace(/\s+$/, ""); // drop trailing whitespace/newlines
  if (remove) return base === "" ? "" : `${base}\n`;
  const block = [begin, body, end].join("\n");
  return base === "" ? `${block}\n` : `${base}\n\n${block}\n`;
}
