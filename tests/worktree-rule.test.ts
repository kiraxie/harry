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

test("parallel worktrees are removed by executing, in step 5's integration", () => {
  // Whoever cut the worktree removes it while it still knows exactly which one it is.
  // Left for finishing, ownership had to be inferred or recorded across sessions,
  // archiving and PRs, and every version of that could delete a worktree that was not
  // the unit's.
  const executing = read("skills/executing/SKILL.md");
  assert.match(executing, /A task's worktree never outlives the task that made it/);
  // Removal only at integration, not on the implementer's first DONE: the per-task
  // review (step 3) and every fix round (step 4) still run in that worktree, and
  // rounds 1-3 resume the implementer whose working directory it is.
  assert.match(
    executing,
    /reaches the unit branch only through step 5's integration, never before/,
  );
  assert.match(executing, /its fixer — resumed or fresh — works in it, which is still there/);
  assert.match(
    executing,
    /Remove the task's worktree and delete its branch — the fast-forward just proved it landed/,
  );
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

test("a parallel task integrates in its own worktree before it is marked complete", () => {
  // Merging back after "complete" left the unit branch red during the fix, reopened
  // tasks that resume skipped (they still carried a complete line), and dragged other
  // tasks' code into the fix scope. Integrating first avoids all of it.
  const executing = read("skills/executing/SKILL.md");
  const step5 =
    executing.split("5. **Integrate, then mark complete.**")[1]?.split("After all tasks:")[0] ?? "";
  assert.match(step5, /Merge the unit branch into the task's branch in its worktree/);
  assert.match(step5, /Red → the task is not complete: hand the failure to step 4 as a finding/);
  assert.match(step5, /integration only ever moves the unit branch to a tree whose suite passed/);
  assert.match(
    step5,
    /a task that ran on the unit branch itself — only when no other task is in flight/,
  );
  assert.match(executing, /finishes before any parallel task is dispatched/);
  assert.match(step5, /merge --ff-only <its branch>/);
  // A sequential task writing in the unit branch's checkout would share it with the
  // fast-forward; while parallel work is in flight every task gets a worktree.
  assert.match(
    executing,
    /While any parallel task is in flight, every task runs in its own worktree — a sequential one too/,
  );
  assert.match(step5, /refused for any other reason \(a dirty unit checkout\) → stop and ask/);
  const ff = step5.indexOf("merge --ff-only");
  const remove = step5.indexOf("Remove the task's worktree");
  assert.ok(ff >= 0 && ff < remove, "the fast-forward must land before the worktree goes");
  const integrate = step5.indexOf("Merge the unit branch into");
  const markComplete = step5.indexOf(": complete (commits");
  assert.ok(
    integrate >= 0 && integrate < markComplete,
    "integration must precede the complete line",
  );
  // The fix loop's limits for an integration failure.
  assert.match(executing, /a fix that needs another unit's files is BLOCKED/);
  assert.match(
    executing,
    /a red suite still open at the cap — or arriving after the loop already reached it — is BLOCKED to the user, never adjudicated/,
  );
  assert.match(executing, /after a step-5 integration, its merge commit → HEAD/);
});

test("integration conflict resolutions are recorded and reviewed by name at step 6", () => {
  // They are made after the task's per-task review, so no per-task review saw them.
  const executing = read("skills/executing/SKILL.md");
  assert.match(executing, /integration: conflicts resolved in <merge7>/);
  assert.match(executing, /every integration conflict resolution recorded in `## Progress`/);
  assert.match(executing, /the merge commits where integration resolved conflicts/);
});
