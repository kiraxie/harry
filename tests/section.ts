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

export const FENCE_OPEN_RE = /^\s*(`{3,})/;

export type OutlineLine = { text: string; fenced: boolean; level: number; title: string };

export function outline(text: string): OutlineLine[] {
  let fence = "";
  return text.split("\n").map((line) => {
    const run = FENCE_OPEN_RE.exec(line)?.[1];
    if (run && (!fence || run.length >= fence.length)) {
      fence = fence ? "" : run;
      return { text: line, fenced: true, level: 0, title: "" };
    }
    if (fence) return { text: line, fenced: true, level: 0, title: "" };
    const heading = /^(#+) (.*)$/.exec(line);
    const title = heading?.[2]?.trim() ?? "";
    return { text: line, fenced: false, level: title ? (heading?.[1]?.length ?? 0) : 0, title };
  });
}

export function headingSection(text: string, rel: string, heading: string | RegExp): string {
  assert.ok(
    text.includes("\n"),
    `${rel} has no line breaks: pass the raw text, not a flattened copy`,
  );
  const lines = outline(text);
  const atStart =
    typeof heading === "string" ? heading : new RegExp(`^(?:${heading.source})`, heading.flags);
  const matches = (line: string): boolean =>
    typeof atStart === "string" ? line.startsWith(atStart) : atStart.test(line);
  const first = lines.findIndex((line) => line.level > 0 && matches(line.text));
  assert.ok(first !== -1, `${rel} no longer has a heading "${heading}"`);
  const own = lines[first]?.level ?? 0;
  const next = lines.findIndex((line, i) => i > first && line.level > 0 && line.level <= own);
  return lines
    .slice(first, next === -1 ? undefined : next)
    .map((line) => line.text)
    .join("\n");
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
