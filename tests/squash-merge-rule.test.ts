import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Integration squashes: one commit per unit lands on the base. The law states the
// habit and the finishing skill carries the mechanics; if either drifts back to a
// plain merge, the base regrows every branch commit, and if the cleanup loses its
// landing check or clean-worktree guard, a force-delete can destroy work.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");

test("HARRY.md §5 makes integration a squash merge", () => {
  const section = read("HARRY.md").split("## §5")[1]?.split("## §6")[0] ?? "";
  assert.match(section, /lands as a \*\*squash\*\*/, "§5 no longer says a unit lands as a squash");
  assert.match(section, /never a merge commit/, "§5 no longer rules out merge commits");
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
    skill.includes("git merge-tree --write-tree <base> <branch>"),
    "the landing check is gone",
  );
  assert.ok(
    !/merge-tree[^`]*\| *head/.test(skill),
    "the landing check compares only the first line, which passes modify/delete and binary conflicts",
  );
  assert.ok(
    skill.includes("allowed only when step 1 passed AND step 2 found the worktree clean"),
    "the discard flag lost its clean-worktree guard",
  );
  assert.ok(
    !/git branch -d\b(?!` refuses)/.test(skill),
    "cleanup went back to `git branch -d`, which refuses a squashed branch",
  );
  const removeAt = skill.indexOf("**Remove the worktree**");
  const deleteAt = skill.indexOf("**Delete the branch**");
  assert.ok(
    removeAt > 0 && deleteAt > removeAt,
    "the branch must be deleted after its worktree is removed",
  );
});
