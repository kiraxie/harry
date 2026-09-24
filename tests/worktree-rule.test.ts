import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  assert.match(section, /each writer gets its own isolated worktree and branch;/);
  assert.match(section, /Parallel writing is separate units, each in its own worktree/);
  assert.doesNotMatch(section, /git worktree add/);
  assert.doesNotMatch(section, /any Standard\/Major task[^.]*worktree/);
});

test("executing cites §5's concurrent writers and branches in place otherwise", () => {
  const executing = read("skills/executing/SKILL.md");
  assert.match(executing, /one writer needs no worktree/);
  assert.match(
    executing,
    /concurrent writers, exactly as HARRY\.md §5 lists them/,
    'a subset that drops "the user editing alongside" branches in place on top of the user\'s uncommitted edits',
  );
  assert.match(executing, /the user included/);
  assert.match(read("HARRY.md"), /the user editing alongside/);
  assert.doesNotMatch(read("references/tier-gates.md"), /\| Execution \|/);
});

test("the layout names only the unit's own checkout, and never the main checkout", () => {
  const finishing = read("skills/finishing/SKILL.md");
  const layout = finishing.split("## Where the unit lives")[1]?.split("## 1.")[0] ?? "";
  assert.match(
    layout,
    /\*\*own worktree\*\* — a linked worktree \(never the main checkout\)/,
    'The main checkout is a worktree to git; "own worktree" must mean a linked one, or an in-place unit is classified as own worktree and cleanup targets the main checkout.',
  );
  assert.match(layout, /\*\*in place\*\* — no linked worktree has `<branch>` checked out/);
  assert.match(
    layout,
    /on Option 2's on-merge resume, at a Discard/,
    "Later sessions (PR resume, Discard) re-derive it, after the checkouts moved on.",
  );
  assert.match(finishing, /remove only the worktree the layout names as the unit's own/);
});

test("Discard never touches a main checkout that is not on the unit's branch", () => {
  const discard = read("skills/finishing/SKILL.md").split("### Discard")[1] ?? "";
  assert.match(
    discard,
    /does `git branch --show-current` still print `<branch>`\?/,
    "A branch in place shares the main checkout; if the user is elsewhere with their own uncommitted work, a reset/clean there would destroy files that are not this unit's.",
  );
  assert.match(discard, /if it is not on `<branch>`, touch the checkout not at all/);
  assert.match(discard, /no `-x`, so ignored files stay/);
});

test("a merge in progress is finished or aborted first, then cleanup restarts from f.1", () => {
  const finishing = read("skills/finishing/SKILL.md");
  const flow =
    finishing.split("**If removal is refused**")[1]?.split("g. **Back on `<base>`**")[0] ?? "";
  const merge =
    "A merge in progress (MERGE_HEAD set) comes first, whatever the status shows: the user finishes or aborts it, then cleanup restarts from f.1, so a commit that finishes it is proven landed before f.4 deletes the branch; no choice below runs mid-merge, since git cannot switch branches then.";
  assert.ok(
    flow.includes(merge),
    "a commit that finishes the merge lands after f.1 proved the branch, so f.1 must run again before f.4's branch -D",
  );
  assert.ok(flow.indexOf(merge) < flow.indexOf("**Rescue branch**"), "the merge comes first");
});

test("f.2's clean check covers a merge in progress and lists ignored files", () => {
  const clean =
    read("skills/finishing/SKILL.md")
      .split("2. **Clean worktree.**")[1]
      ?.split("3. **Remove the worktree**")[0] ?? "";
  assert.ok(clean.includes("`git -C <looked-up-path> status --porcelain -uall` must be empty"));
  assert.ok(
    clean.includes("`git -C <looked-up-path> rev-parse -q --verify MERGE_HEAD` must print nothing"),
  );
  assert.ok(
    clean.includes("`git -C <looked-up-path> ls-files -o -i --exclude-standard`"),
    "removal drops ignored files and no rescue choice covers them",
  );
});
