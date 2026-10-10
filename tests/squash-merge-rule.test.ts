import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { headingSection, inOrder } from "./section.ts";

// Integration squashes: one commit per unit lands on the base. The law states the
// habit and the finishing skill carries the mechanics; if either drifts back to a
// plain merge, the base regrows every branch commit, and if the cleanup loses its
// landing check or clean-worktree guard, a force-delete can destroy work.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
/** Flattened, with `*` and `_` emphasis dropped: the pin is on meaning, not formatting. */
const plain = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .replace(/\*+/g, "")
    .replace(/(?<!\w)_+|_+(?!\w)/g, "");

test("finishing makes integration a squash merge", () => {
  const step3 = plain(
    headingSection(read("skills/finishing/SKILL.md"), "skills/finishing/SKILL.md", "## 3."),
  );
  // Through the definition, not just the term: `squash` is one of the project terms
  // that survives only while the sentence saying what it means survives with it, and
  // the term alone can stay while that sentence is deleted whole.
  assert.match(
    step3,
    /lands as a squash: one commit on the base whose message summarises the unit, never the branch's commit-by-commit history/,
    "finishing no longer says a unit lands as a squash — one commit on the base, summarising the unit",
  );
  assert.match(step3, /never a merge commit/, "finishing no longer rules out merge commits");
});

test("finishing squash-merges locally and on PRs with a summarising message", () => {
  const skill = read("skills/finishing/SKILL.md");
  assert.ok(skill.includes("git merge --squash <branch>"), "Option 1 no longer squash-merges");
  assert.ok(skill.includes("git reset --merge"), "a squash conflict lost its working undo");
  assert.ok(
    /gh pr merge --squash --subject .+ --body/.test(skill),
    "Option 2 no longer squash-merges with an explicit subject and body",
  );
  assert.ok(
    !/merge --no-ff/.test(skill),
    "finishing tells the agent to make a --no-ff merge commit",
  );
});

test("finishing proves the branch landed and the worktree is clean before forcing cleanup", () => {
  const skill = read("skills/finishing/SKILL.md");
  assert.ok(
    skill.includes("git merge-tree --write-tree <base> <from>"),
    "the landing check is gone",
  );
  assert.ok(
    !/merge-tree[^`]*\| *head/.test(skill),
    "the landing check compares only the first line, which passes modify/delete and binary conflicts",
  );
  assert.ok(
    skill.includes("allowed only when f.1 passed AND f.2 found the worktree clean"),
    "the discard flag lost its clean-worktree guard",
  );
  assert.ok(
    !/git branch -d\b(?!` refuses)/.test(skill),
    "cleanup went back to `git branch -d`, which refuses a squashed branch",
  );
  inOrder(skill, "skills/finishing/SKILL.md", "**Remove the worktree**", "**Delete the branch**");
});
