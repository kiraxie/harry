import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ");

function line(rel: string, marker: string): string {
  const found = read(rel)
    .split("\n")
    .find((l) => l.includes(marker));
  assert.ok(found, `${rel} no longer has a line containing ${JSON.stringify(marker)}`);
  return flat(found);
}

test("a finding's number holds inside one report only", () => {
  assert.match(
    line("references/review-rubric.md", "straight across all three severities"),
    /number holds (?:inside|within) one report only/i,
    "the rubric no longer limits a finding's number to the report that printed it",
  );
});

test("a finding's identity is where it is plus what is wrong", () => {
  assert.match(
    line("references/review-rubric.md", "straight across all three severities"),
    /identity is where it is plus what is wrong/i,
    "the rubric no longer names where plus what as a finding's lasting identity",
  );
});

test("executing numbers the merged findings list", () => {
  assert.match(
    line("skills/executing/SKILL.md", "Merge the lanes into **one** findings list"),
    /Merge the lanes into \*\*one\*\* findings list[^.]*numbered/,
    "executing no longer numbers the merged findings list",
  );
});

test("a finding keeps its merged-list number through the fix wave", () => {
  assert.match(
    line("skills/executing/SKILL.md", "**One fix wave.**"),
    /keeps? (?:its|that|the) (?:[\w-]+ )?number[^.]*(?:open list|open-findings list)[^.]*verdict/i,
    "a finding no longer keeps its merged-list number through the open list and the re-review verdicts",
  );
});

test("a new finding from the re-review is numbered on from the merged list", () => {
  assert.match(
    line("skills/executing/SKILL.md", "**One fix wave.**"),
    /joins the open list, numbered on from the merged list's last number/,
    "a re-review's new findings no longer continue the merged list's numbers, so they can collide with carried ones",
  );
});
