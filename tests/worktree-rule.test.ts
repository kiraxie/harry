import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { headingSection, inOrder, section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const flatten = (text: string): string => text.replace(/\s+/g, " ");
const raw = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf-8");
const read = (rel: string): string => flatten(raw(rel));

test("executing ties worktree isolation to concurrent writers, not tier", () => {
  const executing = read("skills/executing/SKILL.md");
  const branch = section(executing, "skills/executing/SKILL.md", "1. **Branch.**", "2. **Paths.**");
  assert.match(branch, /Isolation follows concurrent writers, not tier/);
  assert.match(
    branch,
    /two or more writers at once — several units in flight, or the user editing alongside/,
    'a subset that drops "the user editing alongside" branches in place on top of the user\'s uncommitted edits',
  );
  assert.match(
    branch,
    /single session working sequentially takes a fresh branch in place, at any tier/,
  );
  assert.match(branch, /each writer gets its own isolated worktree and branch;/);
  assert.match(branch, /one writer needs no worktree/);
  assert.match(branch, /the user included/);
  assert.match(executing, /Parallel writing is separate units, each in its own worktree/);
  assert.doesNotMatch(branch, /git worktree add/);
  assert.doesNotMatch(branch, /any Standard\/Major task[^.]*worktree/);
  assert.doesNotMatch(read("references/tier-gates.md"), /\| Execution \|/);
});

test("the layout names only the unit's own checkout, and never the main checkout", () => {
  const finishing = read("skills/finishing/SKILL.md");
  const layout = flatten(
    headingSection(
      raw("skills/finishing/SKILL.md"),
      "skills/finishing/SKILL.md",
      "## Where the unit lives",
    ),
  );
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
  const discard = flatten(
    headingSection(raw("skills/finishing/SKILL.md"), "skills/finishing/SKILL.md", "### Discard"),
  );
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
  const flow = section(
    finishing,
    "skills/finishing/SKILL.md",
    "**If removal is refused**",
    "g. **Back on `<base>`**",
  );
  const merge =
    "A merge in progress (MERGE_HEAD set) comes first, whatever the status shows: the user finishes or aborts it, then cleanup restarts from f.1, so a commit that finishes it is proven landed before f.4 deletes the branch; no choice below runs mid-merge, since git cannot switch branches then.";
  assert.ok(
    flow.includes(merge),
    "a commit that finishes the merge lands after f.1 proved the branch, so f.1 must run again before f.4's branch -D",
  );
  inOrder(flow, "skills/finishing/SKILL.md", merge, "**Rescue branch**");
});

test("f.2's clean check covers a merge in progress and lists ignored files", () => {
  const clean = section(
    read("skills/finishing/SKILL.md"),
    "skills/finishing/SKILL.md",
    "2. **Clean worktree.**",
    "3. **Remove the worktree**",
  );
  assert.ok(clean.includes("`git -C <looked-up-path> status --porcelain -uall` must be empty"));
  assert.ok(
    clean.includes("`git -C <looked-up-path> rev-parse -q --verify MERGE_HEAD` must print nothing"),
  );
  assert.ok(
    clean.includes("`git -C <looked-up-path> ls-files -o -i --exclude-standard`"),
    "removal drops ignored files and no rescue choice covers them",
  );
});
