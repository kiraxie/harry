// Both installers wrap a body between `# >>> harry >>>` / `# <<< harry <<<` markers
// and must behave identically — re-running replaces the block in place, --remove
// strips it. Extracted because divergence between the two would be a bug.

// The single newline harry inserts between the user's own content and its block
// when appending (see applyMarkerBlock). It is a fixed, known string, so strip
// can remove exactly harry's own separator on the round trip and leave the
// user's pre-existing trailing bytes untouched.
const SEP = "\n";

/** @param {string} existing @param {{ begin: string; end: string }} markers @returns {string} */
export function stripMarkerBlock(existing, { begin, end }) {
  const text = existing ?? "";
  const bi = text.indexOf(begin);
  const ei = text.indexOf(end);
  if (bi !== -1 && ei !== -1 && ei > bi) {
    let head = text.slice(0, bi);
    if (head.endsWith(SEP)) head = head.slice(0, -SEP.length);
    const tail = text.slice(ei + end.length).replace(/^\n/, "");
    return head + tail;
  }
  return text;
}

/**
 * @param {string} existing
 * @param {{ begin: string; end: string; body: string; remove?: boolean }} block
 * @returns {string}
 */
export function applyMarkerBlock(existing, { begin, end, body, remove = false }) {
  const base = stripMarkerBlock(existing, { begin, end });
  if (remove) return base;
  const block = [begin, body, end].join("\n");
  return base === "" ? `${block}\n` : `${base}${SEP}${block}\n`;
}
