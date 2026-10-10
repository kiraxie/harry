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
  const lines = text.split("\n");
  let fenced = false;
  const level = lines.map((line) => {
    if (line.startsWith("```")) fenced = !fenced;
    return fenced ? 0 : (/^(#+) /.exec(line)?.[1]?.length ?? 0);
  });
  const matches = (line: string): boolean =>
    typeof heading === "string" ? line.startsWith(heading) : heading.test(line);
  const first = lines.findIndex((line, i) => (level[i] ?? 0) > 0 && matches(line));
  assert.ok(first !== -1, `${rel} no longer has a heading "${heading}"`);
  const own = level[first] ?? 0;
  const next = level.findIndex((n, i) => i > first && n > 0 && n <= own);
  return lines.slice(first, next === -1 ? undefined : next).join("\n");
}
