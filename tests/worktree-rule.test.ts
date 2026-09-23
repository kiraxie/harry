import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Worktree isolation follows concurrent writers, not tier (HARRY.md §5). A worktree
// buys nothing for one session working sequentially — a branch in place is the same
// work with one fewer checkout to install and clean up — while parallel writers
// sharing one checkout do collide (tests reading half-edited files, two builds
// racing on dist/, one index). If any copy drifts back to "Standard/Major → worktree",
// a single session is isolated for nothing again.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ");

test("HARRY.md §5 ties worktree isolation to concurrent writers, not tier", () => {
  const section = read("HARRY.md").split("## §5")[1]?.split("## §6")[0] ?? "";
  assert.match(section, /isolation follows concurrent writers, not tier/);
  assert.match(
    section,
    /single session working sequentially takes a fresh branch in place, at any tier/,
  );
  assert.match(section, /cut from the unit's branch rather than the default branch/);
  assert.doesNotMatch(section, /any Standard\/Major task[^.]*worktree/);
});

test("executing and tier-gates state the same trigger", () => {
  const executing = read("skills/executing/SKILL.md");
  assert.match(executing, /one writer needs no worktree/);
  assert.doesNotMatch(executing, /Standard\/Major default to an isolated worktree/);
  // executing cites §5's list of concurrent writers instead of re-listing a subset:
  // a subset that drops "the user editing alongside" branches in place on top of the
  // user's uncommitted edits and sweeps them into the unit's commits.
  assert.match(executing, /concurrent writers, exactly as HARRY\.md §5 lists them/);
  assert.match(executing, /the user included/);
  assert.match(read("HARRY.md"), /the user editing alongside/);
  const gates = read("references/tier-gates.md");
  assert.match(gates, /\| Execution \| session \(inline\), on a fresh branch in place/);
  assert.doesNotMatch(gates, /session \(inline\), in an isolated worktree/);
});

test("parallel worktrees are removed by executing, once the task is marked complete", () => {
  // Whoever cut the worktree removes it while it still knows exactly which one it is.
  // Left for finishing, ownership had to be inferred or recorded across sessions,
  // archiving and PRs, and every version of that could delete a worktree that was not
  // the unit's.
  const executing = read("skills/executing/SKILL.md");
  assert.match(executing, /Then remove that task's worktree and delete its branch right away/);
  assert.match(executing, /A parallel worktree never outlives the task that made it/);
  // Removal after step 5, not on the implementer's first DONE: the per-task review
  // (step 3) and every fix round (step 4) still run in that worktree, and rounds 1-3
  // resume the implementer whose working directory it is.
  assert.match(executing, /Merge each back into the unit branch once step 5 marks it complete/);
  assert.match(executing, /works in that task's worktree, which is still there/);
  const finishing = read("skills/finishing/SKILL.md");
  assert.match(finishing, /\*\*in place\*\* runs only f\.1, f\.4 and f\.5/);
  assert.doesNotMatch(finishing, /Parallel worktrees\*\* \(the layout's\)/);
  assert.doesNotMatch(read("references/doc-types.md"), /\| Lands \| Worktree \|/);
});

test("the layout names only the unit's own checkout, and never the main checkout", () => {
  const finishing = read("skills/finishing/SKILL.md");
  const layout = finishing.split("## Where the unit lives")[1]?.split("## 1.")[0] ?? "";
  // The main checkout is a worktree to git; "own worktree" must mean a linked one, or an
  // in-place unit is classified as own worktree and cleanup targets the main checkout.
  assert.match(layout, /\*\*own worktree\*\* — a linked worktree \(never the main checkout\)/);
  assert.match(layout, /\*\*in place\*\* — no linked worktree has `<branch>` checked out/);
  // Later sessions (PR resume, Discard) re-derive it, after the checkouts moved on.
  assert.match(layout, /on Option 2's on-merge resume, at a Discard/);
  assert.match(finishing, /remove only the worktree the layout names as the unit's own/);
});

test("Discard never touches a main checkout that is not on the unit's branch", () => {
  // A branch in place shares the main checkout; if the user is elsewhere with their own
  // uncommitted work, a reset/clean there would destroy files that are not this unit's.
  const discard = read("skills/finishing/SKILL.md").split("### Discard")[1] ?? "";
  assert.match(discard, /does `git branch --show-current` still print `<branch>`\?/);
  assert.match(discard, /if it is not on `<branch>`, touch the checkout not at all/);
  assert.match(discard, /no `-x`, so ignored files stay/);
});

test("Discard has the user name any leftover parallel worktrees, and lists them before confirming", () => {
  const discard = read("skills/finishing/SKILL.md").split("### Discard")[1] ?? "";
  assert.match(discard, /have the user name which are this unit's/);
  assert.match(discard, /Never decide that yourself/);
  const listed = discard.indexOf("git log <branch>..<its branch>");
  const confirm = discard.indexOf("typed `discard`");
  assert.ok(listed >= 0, "Discard no longer lists a named worktree's unmerged commits");
  assert.ok(listed < confirm, "the named worktrees' losses must be listed before the confirmation");
});
