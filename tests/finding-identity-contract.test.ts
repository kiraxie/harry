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

function rereviewForm(): string {
  const text = read("references/review-rubric.md");
  const start = text.indexOf("**Re-review**");
  assert.ok(start >= 0, "the rubric has no re-review form");
  const end = text.indexOf("Both verdicts", start);
  assert.ok(end > start, "the re-review form no longer sits before the both-verdicts rule");
  return flat(text.slice(start, end));
}

test("the rubric's re-review form gives one verdict per handed number", () => {
  assert.match(
    rereviewForm(),
    /one line per handed finding, under its handed number: ADDRESSED \/ NOT ADDRESSED · evidence read/,
    "the re-review form no longer gives a verdict per handed number",
  );
});

test("the rubric's re-review form numbers new issues on from the handed list", () => {
  assert.match(
    rereviewForm(),
    /### New issues[^[]*\[numbered on from the last number handed — the merged list's last, Minors included — same fields as above\]/,
    "the re-review form no longer numbers new issues on from the handed list",
  );
});

test("the re-review's Assessment carries Quality and Verdict, no per-AC spec", () => {
  const assessment = rereviewForm().split("### Assessment")[1] ?? "";
  assert.match(
    assessment,
    /Quality: Approved \/ Changes requested/,
    "the re-review lost its Quality verdict",
  );
  assert.match(assessment, /Verdict: Ready to merge/, "the re-review lost its Verdict");
  assert.doesNotMatch(
    assessment,
    /Spec/,
    "the re-review re-judges every AC, turning it into a full review",
  );
});

test("the both-verdicts rule names the re-review as its one exception", () => {
  assert.match(
    flat(read("references/review-rubric.md")),
    /Both verdicts.*?The re-review is the one exception: its spec was judged by the review it follows/,
    "the both-verdicts rule no longer exempts the re-review, so a Quality-only re-review reads as invalid",
  );
});

test("executing hands the re-review the numbered open list and cites the rubric's form", () => {
  const wave = line("skills/executing/SKILL.md", "**One fix wave.**");
  assert.match(
    wave,
    /handed the open-findings list under its merged-list numbers and the merged list's last number; it reports in the rubric's re-review form \(`references\/review-rubric\.md`\)/,
    "executing no longer hands the numbered open list or cites the rubric's re-review form",
  );
  assert.doesNotMatch(
    wave,
    /numbered on from/,
    "executing restates the numbering rule the rubric's re-review form owns",
  );
});

test("two re-review lanes' new issues are merged into one numbering", () => {
  assert.match(
    line("skills/executing/SKILL.md", "**One fix wave.**"),
    /When two lanes re-reviewed, merge their new issues as in step 3/,
    "two re-review lanes each number new issues from the same point, and nothing merges them",
  );
});

test("the Codex lane's re-review is handed the step-3 head and the numbered open list", () => {
  assert.match(
    line("skills/executing/SKILL.md", "**One fix wave.**"),
    /The Codex lane's re-review runs with `--base <the head step 3 reviewed>`, its context file carrying the numbered open list and the merged list's last number as facts/,
    "the Codex re-review lane gets no open list, so it falls back to the fresh form",
  );
});
