import assert from "node:assert/strict";

export function section(
  text: string,
  rel: string,
  startMarker: string,
  endMarker?: string,
): string {
  const start = text.indexOf(startMarker);
  assert.ok(start !== -1, `${rel} no longer contains "${startMarker}"`);
  if (endMarker === undefined) return text.slice(start);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(end !== -1, `${rel} no longer contains "${endMarker}" after "${startMarker}"`);
  return text.slice(start, end);
}

export function headingSection(text: string, rel: string, heading: string | RegExp): string {
  assert.ok(
    text.includes("\n"),
    `${rel} has no line breaks: pass the raw text, not a flattened copy`,
  );
  const lines = text.split("\n");
  let fenced = false;
  const level = lines.map((line) => {
    if (line.startsWith("```")) fenced = !fenced;
    return fenced ? 0 : (/^(#+) /.exec(line)?.[1]?.length ?? 0);
  });
  const atStart =
    typeof heading === "string" ? heading : new RegExp(`^(?:${heading.source})`, heading.flags);
  const matches = (line: string): boolean =>
    typeof atStart === "string" ? line.startsWith(atStart) : atStart.test(line);
  const first = lines.findIndex((line, i) => (level[i] ?? 0) > 0 && matches(line));
  assert.ok(first !== -1, `${rel} no longer has a heading "${heading}"`);
  const own = level[first] ?? 0;
  const next = level.findIndex((n, i) => i > first && n > 0 && n <= own);
  return lines.slice(first, next === -1 ? undefined : next).join("\n");
}

const short = (marker: string): string =>
  marker.length > 60 ? `${marker.slice(0, 57)}...` : marker;

export function inOrder(text: string, rel: string, ...markers: string[]): void {
  const at = markers.map((marker) => {
    const i = text.indexOf(marker);
    assert.ok(i !== -1, `${rel} no longer contains "${short(marker)}"`);
    return i;
  });
  for (let k = 1; k < markers.length; k++)
    assert.ok(
      (at[k - 1] ?? 0) < (at[k] ?? 0),
      `${rel} has "${short(markers[k] ?? "")}" before "${short(markers[k - 1] ?? "")}"`,
    );
}
