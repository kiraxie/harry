// Shared marker-block editing for harry's installers (init, install-laws).
// Both wrap a body between `# >>> harry >>>` / `# <<< harry <<<` markers and
// must behave identically — re-running replaces the block in place, --remove
// strips it. Extracted because divergence between the two would be a bug
// (HARRY.md §2: shared knowledge across a boundary gets one source of truth).

// The single newline harry inserts between the user's own content and its block
// when appending (see applyMarkerBlock). It is a fixed, known string, so strip
// can remove exactly harry's own separator on the round trip and leave the
// user's pre-existing trailing bytes untouched.
const SEP = "\n";

// Returns `existing` with harry's marked block removed (everything else kept).
// Removes only harry's own bytes — the block, its trailing newline, and the one
// separator newline harry inserted before it — never the user's content or the
// user's own trailing whitespace. Used to recover the user-owned base before
// re-applying or dedup-checking.
export function stripMarkerBlock(existing, { begin, end }) {
  const text = existing ?? "";
  const bi = text.indexOf(begin);
  const ei = text.indexOf(end);
  if (bi !== -1 && ei !== -1 && ei > bi) {
    let head = text.slice(0, bi);
    // Drop the one separator newline harry inserted before the block. Any
    // further trailing newlines are the user's own — keep them byte-for-byte.
    if (head.endsWith(SEP)) head = head.slice(0, -SEP.length);
    const tail = text.slice(ei + end.length).replace(/^\n/, "");
    return head + tail;
  }
  return text;
}

// Returns `existing` with the marked block applied (or removed). Idempotent:
// any pre-existing block (and harry's separator) is stripped first, so a second
// run produces identical output. Harry owns only the block and the single
// separator newline before it — the user's bytes outside the block, including
// their trailing whitespace/newlines, are preserved exactly.
export function applyMarkerBlock(existing, { begin, end, body, remove = false }) {
  const base = stripMarkerBlock(existing, { begin, end });
  if (remove) return base;
  const block = [begin, body, end].join("\n");
  return base === "" ? `${block}\n` : `${base}${SEP}${block}\n`;
}
