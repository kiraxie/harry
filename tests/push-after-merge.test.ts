import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { section } from "./section.ts";

// A local merge pushes its base: the user's checkpoint is the merge-vs-PR choice. The push
// must never be forced, and a rejection must stop rather than be worked around.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skill = readFileSync(path.join(repoRoot, "skills", "finishing", "SKILL.md"), "utf-8")
  .replace(/\s+/g, " ")
  .replace(/\*+/g, "");
const stepA = (): string =>
  section(skill, "skills/finishing/SKILL.md", "a. Verify the merged result", "b. Memory");
const stepH = (): string =>
  section(skill, "skills/finishing/SKILL.md", "h. Completion evidence", "### Option 2");

test("finishing's menu says option 1 merges and pushes", () => {
  assert.match(skill, /1\. Merge back to <base> locally and push/);
});

test("Option 1 pushes the base in step a, with a plain push, never forced", () => {
  assert.match(stepA(), /`git push`/);
  assert.match(stepA(), /never `--force`/);
});

test("a rejected push stops in step a, never retried or forced", () => {
  assert.match(stepA(), /rejected[^.]*stop/i);
  assert.match(stepA(), /never retry/i);
});

test("step h only watches CI: the push happens before steps b-f clean up", () => {
  assert.doesNotMatch(stepH(), /`git push`/);
});

test("no finishing text still asks before the push", () => {
  assert.doesNotMatch(skill, /offer to push|don't push unasked/i);
});
