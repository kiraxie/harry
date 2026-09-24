import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ");
const has = (text: string, literal: string, why?: string): void =>
  assert.ok(text.includes(literal), why ? `missing: ${literal} — ${why}` : `missing: ${literal}`);

test("HARRY.md §5 ties worktree isolation to concurrent writers, not tier", () => {
  const section = read("HARRY.md").split("## §5")[1]?.split("## §6")[0] ?? "";
  assert.match(section, /isolation follows concurrent writers, not tier/);
  assert.match(
    section,
    /single session working sequentially takes a fresh branch in place, at any tier/,
  );
  assert.match(section, /cut from the unit's branch rather than the default branch/);
  assert.match(
    section,
    /each writer gets its own isolated worktree and branch, cut from the unit's branch rather than the default branch and identifiable as the unit's before any writer enters it/,
    "The law states only the invariant; how a task worktree is cut and recorded lives in executing, so the two cannot drift apart on the mechanism.",
  );
  assert.doesNotMatch(section, /git worktree add/);
  assert.doesNotMatch(section, /harness native tooling/);
  assert.doesNotMatch(section, /any Standard\/Major task[^.]*worktree/);
});

test("executing and tier-gates state the same trigger", () => {
  const executing = read("skills/executing/SKILL.md");
  assert.match(executing, /one writer needs no worktree/);
  assert.doesNotMatch(executing, /Standard\/Major default to an isolated worktree/);
  assert.match(
    executing,
    /concurrent writers, exactly as HARRY\.md §5 lists them/,
    "executing cites §5's list of concurrent writers instead of re-listing a subset: a subset that drops \"the user editing alongside\" branches in place on top of the user's uncommitted edits and sweeps them into the unit's commits.",
  );
  assert.match(executing, /the user included/);
  assert.match(read("HARRY.md"), /the user editing alongside/);
  const gates = read("references/tier-gates.md");
  assert.match(gates, /\| Execution \| session \(inline\), on a fresh branch in place/);
  assert.doesNotMatch(gates, /session \(inline\), in an isolated worktree/);
});

test("parallel worktrees are removed by executing, in step 5's integration", () => {
  const executing = read("skills/executing/SKILL.md");
  assert.match(
    executing,
    /A task's worktree never outlives the task that made it/,
    "Whoever cut the worktree removes it while it still knows exactly which one it is. Left for finishing, ownership had to be inferred or recorded across sessions, archiving and PRs, and every version of that could delete a worktree that was not the unit's.",
  );
  assert.match(
    executing,
    /reaches the unit branch only through step 5's integration, never before/,
    "Removal only at integration, not on the implementer's first DONE: the per-task review (step 3) and every fix round (step 4) still run in that worktree, and rounds 1-3 resume the implementer whose working directory it is.",
  );
  assert.match(executing, /its fixer — resumed or fresh — works in it, which is still there/);
  has(
    executing,
    "Remove the task's worktree and delete its branch** — only when its task branch is gone or passes the deletion proof; otherwise stop and ask",
    "AC-31(c): 5.5 deletes the task branch only when it holds no work the unit branch lacks. \"The fast-forward just proved it landed\" held only in an uninterrupted run, not on resume. The proof is a tree-equality check, stated in 5.5 and cited by finishing's f.1: it counts content, so an empty task's `--no-ff` merge passes and a conflict resolution kept only in a merge commit does not.",
  );
  assert.doesNotMatch(
    executing,
    /rev-list --count --no-merges <unit branch>\.\./,
    "One deletion proof repo-wide, stated once, in executing's 5.5 (AC-35 b).",
  );
  has(executing, "A task with no commits of its own beyond its base ref");
  assert.doesNotMatch(executing, /the fast-forward just proved it landed/);
  const finishing = read("skills/finishing/SKILL.md");
  assert.match(finishing, /\*\*in place\*\* runs only f\.1, f\.2, f\.5 and f\.6/);
  assert.doesNotMatch(finishing, /Parallel worktrees\*\* \(the layout's\)/);
  assert.doesNotMatch(read("references/doc-types.md"), /\| Lands \| Worktree \|/);
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

test("Discard finds the unit's task worktrees by executing's naming rule, and the user confirms", () => {
  const discard = read("skills/finishing/SKILL.md").split("### Discard")[1] ?? "";
  assert.doesNotMatch(
    discard,
    /have the user name which are this unit's/,
    "Asking the user to pick the unit's worktrees out of every linked one made them guess; executing's naming rule identifies them, and the user confirms the list.",
  );
  assert.doesNotMatch(discard, /Never decide that yourself/);
  assert.match(discard, /every `git worktree list` entry on a `task\/<branch>\/…` branch/);
  assert.match(discard, /every leftover `task\/<branch>\/…` branch with no worktree/);
  assert.match(discard, /pre-marked as this unit's/);
  assert.match(discard, /The naming rule decides which are this unit's, and the user confirms/);
  assert.match(
    discard,
    /delete its `task\/<branch>\/<task id>` branch and its `refs\/harry\/<branch>\/<task id>\/base` ref together, in one `git update-ref --stdin` transaction/,
    "Only confirmed tasks lose their branch and base ref; the whole prefix goes only when the user confirmed every listed entry.",
  );
  has(
    discard,
    "executing's 5.5 transaction, `<branch>` standing for `<unit branch>`",
    "Deleting the branch alone would leave a base ref that reads as a unit-branch task. The transaction is stated once, at executing's 5.5, and cited here.",
  );
  assert.doesNotMatch(discard, /delete refs\/heads\/task/);
  assert.match(
    discard,
    /only when the user confirmed every listed entry, also delete any other ref under `refs\/harry\/<branch>\/`/,
  );
  assert.doesNotMatch(discard, /delete every listed `task\/<branch>\/…` branch/);
  assert.match(
    discard,
    /When the user leaves any listed entry unconfirmed, keep `<branch>` too/,
    "A partial confirmation keeps the unit branch, so the unconfirmed tasks' branches and refs never outlive the branch whose name they carry.",
  );
  const listed = discard.indexOf("git log <branch>..<its branch>");
  const confirm = discard.indexOf("typed `discard`");
  assert.ok(listed >= 0, "Discard no longer lists a task worktree's unmerged commits");
  assert.ok(listed < confirm, "the task worktrees' losses must be listed before the confirmation");
});

test("finishing's cleanup removes any task a run left behind, branch and base ref together", () => {
  const finishing = read("skills/finishing/SKILL.md");
  const step1 = finishing.split("## 1. Verify tests first")[1]?.split("## 2.")[0] ?? "";
  has(
    step1,
    "a branch under `refs/heads/task/<branch>/` or a base ref under `refs/harry/<branch>/`",
    "executing's step 5 removes each task once it lands, so a leftover one is a task a run stopped short of removing; its branch left alone would sit in step 2's way for a later unit that reuses the unit branch's name. Only executing's 5.4 writes a complete line, and a return to executing must come before anything merges, archives the item or removes the unit's worktree, so the classification is stated in step 1, ahead of the menu and of f.4.",
  );
  has(step1, "Only executing's 5.4 writes a complete line");
  has(
    step1,
    "Classify each by executing's step 5 **Resuming** table, read against the item's `## Progress`, `<branch>` standing for `<unit branch>`; finishing keeps no case list of its own",
    "AC-28: the leftover-task classification is stated once, in executing's Resuming table. Finishing runs it and acts only on its run-5.5 row; a second case list here had already drifted from executing's (it guarded deletion with a containment check executing lacked).",
  );
  has(step1, "Its run-5.5 row → left for f.2, which removes it");
  has(step1, "any other row → back to executing, whose **Resuming** acts on it");
  assert.doesNotMatch(finishing, /merge-base --is-ancestor/);
  assert.doesNotMatch(finishing, /This classification is stated here once/);
  assert.doesNotMatch(finishing, /from git and its log/);
  assert.doesNotMatch(finishing, /back to executing's 5\.4/);
  assert.doesNotMatch(finishing, /landed by construction/);
  const proof = finishing.indexOf("Only executing's 5.4 writes a complete line");
  const removeWorktree = finishing.indexOf("4. **Remove the worktree**");
  assert.ok(proof >= 0 && proof < removeWorktree, "the task-landing proof runs before f.4");
  const leftoverStep =
    finishing.split("2. **Leftover tasks.**")[1]?.split("3. **Clean worktree.**")[0] ?? "";
  has(
    leftoverStep,
    "`.local/archive/<slug>.md`",
    "f.2 re-runs step 1's classification from git and the archived Progress right before removing anything: Option 2's on-merge resume reaches it without step 1.",
  );
  has(leftoverStep, "Option 2's on-merge resume reaches here without step 1");
  has(
    leftoverStep,
    "Only a task in its run-5.5 row is removed; any other row → STOP and ask the user",
  );
  assert.doesNotMatch(leftoverStep, /first case/);
  assert.doesNotMatch(leftoverStep, /delete refs\/heads\/task/);
  const rerun = leftoverStep.indexOf("Re-run step 1's");
  const sweep = leftoverStep.indexOf("running executing's 5.5");
  assert.ok(rerun >= 0 && rerun < sweep, "the re-run comes before any removal");
  const unitBranch = finishing.indexOf("git branch -D <branch>` (git refuses");
  assert.ok(
    finishing.indexOf("2. **Leftover tasks.**") < unitBranch,
    "leftover tasks go before the unit branch",
  );
  const temp = finishing.split("6. **Temp files.**")[1]?.split("Provenance rule")[0] ?? "";
  assert.doesNotMatch(finishing, /a crash can leave one behind/);
  assert.doesNotMatch(temp, /refs\/harry/);
  has(finishing, "in f.2 once executing's **Resuming** table put them in its run-5.5 row");
  has(
    finishing,
    "**Follow-up commits re-run step 1's leftover-task check and step 2 before they are pushed.**",
    "PR follow-ups can leave the classification stale too.",
  );
});

test("the report log is evidence: resume routes on git and `## Progress` only (AC-26)", () => {
  const executing = read("skills/executing/SKILL.md");
  const step5 =
    executing.split("5. **Integrate, then mark complete.**")[1]?.split("After all tasks:")[0] ?? "";
  has(
    executing,
    "The log is evidence, not state",
    "Routing on the log made it a state machine whose every entry had to be exact; each fix to its ordering, closing, `file:` and `head:` rules opened the next window. Nothing routes on it now, so those rules are gone.",
  );
  has(executing, "no rule routes on it");
  assert.doesNotMatch(executing, /immediately ahead of the Agent or SendMessage call/);
  assert.doesNotMatch(executing, /cannot split one message's tool calls/);
  assert.doesNotMatch(executing, /in the same (assistant )?message/);
  assert.doesNotMatch(executing, /final act/);
  assert.doesNotMatch(executing, /`file:/);
  assert.doesNotMatch(executing, /`head:/);
  assert.doesNotMatch(executing, /the log's last entry is closed/);
  assert.doesNotMatch(executing, /routes by the log row/);
  assert.doesNotMatch(executing, /the round count continues from the log/);
  assert.doesNotMatch(executing, /only a session that resumes reads the log/);
  assert.doesNotMatch(
    executing,
    /the session waits/,
    'AC-31(a): whether an agent is still running cannot be read from git or `## Progress`; with no automatic re-dispatch, no rule needs to know. The removed rule\'s own words: "the session waits for its completion notification".',
  );
  has(
    executing,
    "`## dispatched <round>`, which the session appends before every dispatch or resume of the task",
    "Agents and the session still append to it.",
  );
  has(executing, "`## result <round>`, which the implementer appends after its last commit");
  has(
    executing,
    "`<store>/.local/tmp/<branch>/<task id>-review-<k>.md`",
    "One review file per attempt stays: a reused name let a stale report pass as the live one. Its number comes from the files, not from counting log entries.",
  );
  has(executing, "where `<k>` is one more than the number of review files the task already has");
  has(executing, "a report the session sends back is re-dispatched as a new attempt");
  assert.doesNotMatch(executing, /<task id>-review-<round>\.md/);
  assert.doesNotMatch(executing, /entries in the log, this one included/);
  const perTask = executing.split("3. **Per-task review.**")[1]?.split("4. **Fix loop")[0] ?? "";
  has(perTask, "plus the absolute path of its review file, where it writes its report");
  assert.doesNotMatch(
    executing,
    /still running: wait for it/,
    "Waiting, repairing and closing on an agent's behalf each opened a new window.",
  );
  assert.doesNotMatch(executing, /in-flight rule/);
  assert.doesNotMatch(executing, /the session closes it for the agent/);
  assert.doesNotMatch(executing, /## review <round>: failed/);
  assert.doesNotMatch(executing, /First git:/);
  has(
    step5,
    "Whenever a session resumes the unit — a new session, or the same one after compaction — and before it dispatches anything",
    "Resuming covers compaction as well as a new session.",
  );
  has(
    step5,
    "Classify every task before acting on any, from git and `## Progress` only — the report log is evidence to show the user, never a row's condition",
  );
  has(
    step5,
    "| A complete line, and its task branch gone or passing the deletion proof (5.5) | run 5.5 |",
    "AC-28: the complete-line row runs 5.5 only under 5.5's own containment check.",
  );
  assert.doesNotMatch(
    step5,
    /re-dispatch it, reusing/,
    "AC-31(a): no automatic re-dispatch. A task with no commits and a clean tree may have an agent still working on it, or may have returned BLOCKED; neither is visible in git or `## Progress`, so the user rules.",
  );
  assert.doesNotMatch(
    executing,
    /no rule here waits/,
    "Resuming never waits on a task: a state it cannot prove goes to the user",
  );
  assert.doesNotMatch(executing, /one automatic resume/);
  has(step5, "its last `## Progress` lines, the log's last entries");
  has(
    executing,
    "diff range = the head the previous review saw → the task's tip now, both named by ref",
    "A scoped re-review after a resume has no recorded start: the base ref, unless the user names a head.",
  );
  has(
    executing,
    "when the session no longer holds that head (a new session, or after compaction), the range starts at the base ref unless the user names a head",
  );
});

test("a task the user sends back from Resuming has one round name per destination (AC-32 m-a)", () => {
  const executing = read("skills/executing/SKILL.md");
  has(
    executing,
    "`<round>` is `initial` (again for a task the user sends back from **Resuming** to step 2, to implement it again)",
    "Back to step 2, to implement again → `initial`; back to step 4 with findings → one past the last `fix round` line, `1/4` when there is none. Two rules for one case gave a restarted task two labels and moved round 4's escalation.",
  );
  has(
    executing,
    "When the user, asked by **Resuming**, sends a task back here, dispatch a fresh fixer into its existing worktree (the unit checkout for a task with no task branch) with brief + report file + findings; its round is one past the task's last `fix round` line in `## Progress`, `fix round 1/4` when it has none (a round cut short before its line was written runs again under its own number)",
  );
  has(
    read("references/doc-types.md"),
    "`fix round <R>/<cap>` (session mode resumes mid-loop from it; in subagent mode, a task the user sends back to step 4 takes the round one past it, `fix round 1/4` when it has none)",
  );
});

test("the Codex build's log is the session's own (AC-29)", () => {
  const executing = read("skills/executing/SKILL.md");
  const carveOut =
    executing.split("**Model by role.**")[1]?.split("Per task. Each task has")[0] ?? "";
  has(
    carveOut,
    "With no subagents on that build, the session implements each task itself and appends every log entry, the `## result` ones included, and it is step 4's fixer too: every loop fix still goes through that step's re-review, and round 4's escalation is a switch to the role map's most-capable row",
  );
  has(
    executing,
    "**The session is never the fixer inside the loop** (on the Codex build it is: see Model by role)",
    "AC-31(d): step 4's rule names the carve-out instead of contradicting it.",
  );
});

test("resume on the Codex build works as it does on Claude Code (AC-29, AC-32)", () => {
  const executing = read("skills/executing/SKILL.md");
  const carveOut =
    executing.split("**Model by role.**")[1]?.split("Per task. Each task has")[0] ?? "";
  has(carveOut, "resume works as it does on Claude Code, since no rule routes on the log");
});

test("a parallel task integrates in its own worktree before it is marked complete", () => {
  const executing = read("skills/executing/SKILL.md");
  const step5 =
    executing.split("5. **Integrate, then mark complete.**")[1]?.split("After all tasks:")[0] ?? "";
  assert.match(
    step5,
    /merge the unit branch into the task's branch in its worktree \(`git -C <path> merge --no-ff <unit branch>`\)/,
    'Merging back after "complete" left the unit branch red during the fix, reopened tasks that resume skipped (they still carried a complete line), and dragged other tasks\' code into the fix scope. Integrating first avoids all of it.',
  );
  assert.match(step5, /Red → the task is not complete: hand the failure to step 4 as a finding/);
  assert.match(step5, /integration only ever moves the unit branch to a tree whose suite passed/);
  assert.match(
    step5,
    /A task that ran on the unit branch itself — only when no other task is in flight/,
  );
  assert.match(executing, /finishes before any parallel task is dispatched/);
  assert.match(step5, /merge --ff-only <its branch>/);
  assert.match(
    executing,
    /While any parallel task is in flight, every task — a sequential one too — runs in its own worktree/,
    "A sequential task writing in the unit branch's checkout would share it with the fast-forward; while parallel work is in flight every task gets a worktree.",
  );
  assert.match(step5, /refused for any other reason \(a dirty unit checkout\) → stop and ask/);
  const ff = step5.indexOf("merge --ff-only");
  const remove = step5.indexOf("Remove the task's worktree");
  assert.ok(ff >= 0 && ff < remove, "the fast-forward must land before the worktree goes");
  const integrate = step5.indexOf("merge the unit branch into");
  const markComplete = step5.indexOf(": complete (commits");
  assert.ok(
    integrate >= 0 && integrate < markComplete,
    "integration must precede the complete line",
  );
  assert.match(
    step5,
    /a fix that needs another unit's files is BLOCKED/,
    "The fix loop's limits for an integration failure. Step 5 owns them; step 4 and the intro only point here (one copy, no drift).",
  );
  assert.match(
    step5,
    /a red suite still open at the cap — or arriving after the loop already reached it — are BLOCKED to the user, never adjudicated/,
  );
  assert.match(
    step5,
    /its merge commit → the task's tip now, so other tasks' merged code stays out/,
  );
  const outside = executing.replace(step5, "");
  assert.doesNotMatch(outside, /a fix that needs another unit's files is BLOCKED/);
  assert.doesNotMatch(outside, /its merge commit → the task's tip now/);
  assert.match(
    executing,
    /Integration findings \(step 5\) always take the loop, under that step's limits/,
  );
});

test("step 5 has the fixer resolve integration conflicts, re-reviewed from the merge", () => {
  const executing = read("skills/executing/SKILL.md");
  const step5 =
    executing.split("5. **Integrate, then mark complete.**")[1]?.split("After all tasks:")[0] ?? "";
  assert.match(step5, /Conflicts → leave the merge in progress and hand them to step 4's fixer/);
  assert.match(step5, /the session is not the fixer here either/);
  assert.match(step5, /`--remerge-diff`/);
  assert.match(step5, /never `git merge --abort`, a reset or a rebase/);
  assert.match(step5, /integration conflicts or a red suite still open at the cap/);
  assert.match(
    step5,
    /Once the re-review passes, append `AC-<n>\[, AC-<m>\]: integration: conflicts resolved/,
    "Recorded only once the re-review passed, so a resume never skips that review.",
  );
});

test("step 5 writes the complete line before removal, and asks rather than guesses on resume", () => {
  const executing = read("skills/executing/SKILL.md");
  const step5 =
    executing.split("5. **Integrate, then mark complete.**")[1]?.split("After all tasks:")[0] ?? "";
  const markComplete = step5.indexOf(": complete (commits");
  const remove = step5.indexOf("Remove the task's worktree");
  assert.ok(markComplete >= 0 && markComplete < remove, "complete line must precede removal");
  assert.match(
    step5,
    /is not resumed by inference/,
    "Inferring where a crashed task stopped kept leaving windows that landed unreviewed code or orphaned worktrees; the user decides instead.",
  );
  assert.match(step5, /Stop and ask the user, showing its branch/);
  assert.match(
    step5,
    /before it dispatches anything, it reads the unit's task worktrees from git/,
    "A resumed session must look for surviving worktrees, and step 4's own resume lines must defer to this rule rather than contradict it.",
  );
  assert.match(
    step5,
    /a worktree, branch or ref outside those prefixes is not this unit's: leave it untouched/,
  );
  assert.match(
    executing,
    /never a harness isolation worktree/,
    "A harness isolation worktree is named only when the agent returns, and not by the naming rule, so git would not identify it as the unit's.",
  );
  assert.doesNotMatch(executing, /as soon as the harness reports an isolation worktree/);
  assert.match(executing, /Step 5's \*\*Resuming\*\* paragraph decides first/);
  assert.doesNotMatch(
    executing,
    /paragraph handles/,
    "Subagent mode resumes from git and `## Progress` through Resuming; step 4 defers to it.",
  );
  assert.match(executing, /only after step 5's \*\*Resuming\*\* check of surviving task worktrees/);
  assert.match(step5, /rev-parse -q --verify MERGE_HEAD/);
  assert.match(
    step5,
    /`git log --first-parent <base7>\.\.<head7>` lists the task's own commits/,
    "Branch point → the head the unit branch landed at, read first-parent.",
  );
  has(
    step5,
    "`<head7>` the head the unit branch landed at: the task branch's tip (`git rev-parse --short task/<unit branch>/<task id>`) when 5.3 fast-forwarded",
  );
  assert.match(step5, /the unit branch's head when the task started/);
});

test("git is the ledger for task worktrees: naming, base ref, --no-ff, idempotent removal", () => {
  const executing = read("skills/executing/SKILL.md");
  const step5 =
    executing.split("5. **Integrate, then mark complete.**")[1]?.split("After all tasks:")[0] ?? "";
  assert.match(
    executing,
    /\*\*task id\*\* — its AC ids joined with `-`/,
    "`## Progress` lines about worktrees could be lost or wrong after a crash; git state cannot disagree with itself, so the name and a ref carry the record.",
  );
  assert.match(
    executing,
    /`<store>\/\.local\/tmp\/<branch>\/<task id>-brief\.md`/,
    "Brief, report and diff are named by task id, so after compaction or in a new session git's task id locates them; a session-local ordinal did not.",
  );
  assert.match(executing, /`<store>\/\.local\/tmp\/<branch>\/<task id>-report\.md`/);
  assert.match(executing, /`<store>\/\.local\/tmp\/<branch>\/<task id>-diff\.patch`/);
  assert.doesNotMatch(executing, /task-N-/);
  assert.match(executing, /branch `task\/<unit branch>\/<task id>`/);
  assert.match(executing, /\*\*base ref\*\*, `refs\/harry\/<unit branch>\/<task id>\/base`/);
  assert.match(
    executing,
    /git update-ref --stdin/,
    "Branch and base ref are created in one transaction, before the worktree: a task with its own worktree has both or neither, so a base ref without a task branch is a unit-branch task by construction (a lone base ref was misread after a failed `worktree add` while another task landed).",
  );
  assert.match(executing, /create refs\/harry\/<unit branch>\/<task id>\/base %s/);
  assert.match(executing, /create refs\/heads\/task\/<unit branch>\/<task id> %s/);
  assert.match(executing, /git worktree add <path> task\/<unit branch>\/<task id>/);
  assert.doesNotMatch(executing, /worktree add -b/);
  assert.doesNotMatch(executing, /`worktree add` failing after the base ref was written/);
  assert.match(
    executing,
    /git update-ref refs\/harry\/<unit branch>\/<task id>\/base <unit branch>/,
  );
  assert.match(executing, /git for-each-ref refs\/heads\/task\/<unit branch>\//);
  assert.doesNotMatch(
    executing,
    /base "\$base" "" && git worktree add/,
    "Create-only base ref: an existing one is never moved, and its refusal is the resume signal (an overwritten base made Resuming record a false completion).",
  );
  assert.match(
    executing,
    /git update-ref refs\/harry\/<unit branch>\/<task id>\/base <unit branch> ""`/,
  );
  assert.doesNotMatch(executing, /base "\$base" &&/);
  assert.doesNotMatch(executing, /base <unit branch>`/);
  assert.match(
    executing,
    /The transaction refused because either ref already exists → git already holds the task, and \*\*Resuming\*\* has already classified it: stop and ask the user/,
    "`create` refusing is the signal that git already holds the task. Any resumed session, a compacted one included, has already run Resuming on it, so a refusal is unexpected: ask.",
  );
  assert.doesNotMatch(
    executing,
    /never dispatched: dispatch it/,
    "The report file is an append-only log, but only evidence (AC-26): its ordering and closing rules are pinned absent in the AC-26 test above. A log with no entry says nothing about whether a task was dispatched.",
  );
  assert.doesNotMatch(executing, /no report file → its implementer is still running/);
  assert.match(executing, /appends its full report to the report file after its last commit/);
  assert.match(executing, /appends a fix report to the same report file/);
  assert.doesNotMatch(executing, /is in flight: do not dispatch it, wait for its report/);
  assert.doesNotMatch(executing, /the task was dispatched before: go to step 5's \*\*Resuming\*\*/);
  assert.match(executing, /refused the same way → the same rule/);
  has(
    executing,
    "A re-dispatch reuses the task's base ref and worktree and cuts nothing: the transaction runs only at a task's first start",
    "A re-dispatch (Resuming's nothing-done row, NEEDS_CONTEXT) reuses what the first start wrote; only the first start runs the create-only writes.",
  );
  has(
    executing,
    'writes its base ref alone, create-only, at its first start: `git update-ref refs/harry/<unit branch>/<task id>/base <unit branch> ""` — refused the same way → the same rule; a re-dispatch reuses it',
  );
  assert.doesNotMatch(
    executing,
    /is in flight, and/,
    "Compaction resumes through Resuming too; there is no separate in-flight record.",
  );
  assert.doesNotMatch(executing, /`worktree add -b` refused because the branch already exists/);
  assert.doesNotMatch(
    executing,
    /finishing does not look for any/,
    "finishing does look for task worktrees now, but only at Discard.",
  );
  assert.match(
    executing,
    /finishing finds task worktrees and refs only by step 2's naming rule — at a Discard, and at cleanup for any a run left behind/,
  );
  assert.doesNotMatch(
    executing,
    /\(restart\/compaction\)/,
    "Any resumed session runs Resuming, a compacted one included (AC-23): with no wait and no repair rows left, Resuming is safe after compaction.",
  );
  assert.doesNotMatch(executing, /Compaction is not a restart/);
  assert.doesNotMatch(step5, /never after compaction/);
  assert.doesNotMatch(executing, /dispatched on/, "The superseded Progress records are gone.");
  assert.doesNotMatch(executing, /integrating \(commits/);
  assert.doesNotMatch(step5, /`<base7>` is `git merge-base/);
  assert.match(
    step5,
    /`<base7>` is the task's base ref \(`git rev-parse --short refs\/harry\/<unit branch>\/<task id>\/base`\)/,
  );
  assert.match(step5, /merge --no-ff <unit branch>/);
  assert.match(
    step5,
    /so 5\.5 is safe to re-run/,
    "5.5 re-runs safely: each removal only when its target still exists.",
  );
  assert.match(
    step5,
    /if `git worktree list` lists `<path>`/,
    "A registered worktree whose directory is gone still blocks `git branch -D`; `git worktree remove` clears only that registration, where a prune would drop every stale registration in the repo, the unit's or not.",
  );
  assert.match(
    step5,
    /`git worktree remove <path>`, which removes only that registration, even when the directory is already gone/,
  );
  assert.doesNotMatch(executing, /git worktree prune/);
  assert.match(
    step5,
    /has nothing to land/,
    "A task with nothing to land writes its complete line with no fast-forward. Its own commits exclude the `--no-ff` integration merge, which would otherwise make an empty task land other tasks' work as its own.",
  );
  has(step5, "has nothing to land: skip the fast-forward and go to 5.4");
  has(
    step5,
    "git rev-list --count --no-merges --first-parent refs/harry/<unit branch>/<task id>/base..<its branch>",
  );
  assert.doesNotMatch(step5, /rev-list --count refs\/harry/);
  assert.doesNotMatch(
    step5,
    /absent → delete the ref/,
    "A leftover base ref is never deleted before its complete line: it is the branch point the complete line's range starts from, so it is reused.",
  );
  assert.doesNotMatch(step5, /keeps its branch until its complete line is written/);
  assert.match(step5, /A base ref without a task branch is a unit-branch task/);
  assert.match(
    step5,
    /delete refs\/heads\/task\/<unit branch>\/<task id>/,
    "5.5 deletes branch and base ref in one transaction, after the worktree is gone.",
  );
  assert.match(step5, /delete refs\/harry\/<unit branch>\/<task id>\/base/);
  assert.match(step5, /only after the worktree is gone/);
  assert.doesNotMatch(
    step5,
    /nothing done: remove its worktree/,
    "Resuming is a table over git state; its rows are pinned in the AC-33 tests. A unit-branch task without a complete line goes to the user (AC-31, AC-33).",
  );
  assert.doesNotMatch(step5, /reuse the base ref and continue the task first/);
  assert.match(step5, /is not resumed by inference/);
  assert.match(step5, /Stop and ask the user, showing its branch/);
  assert.match(step5, /A task git holds nothing for resumes by `## Progress` alone/);
});

test("the changelog scopes finishing's own-checkout rule to merge, PR and keep", () => {
  const changelog = read("CHANGELOG.md");
  assert.match(
    changelog,
    /On merge, PR or keep, `finishing` only ever handles the unit's own checkout/,
  );
  assert.doesNotMatch(changelog, /So `finishing` only ever handles/);
});

test("doc-types lists the Progress lines rules read back, and names the three stores (AC-27)", () => {
  const types = read("references/doc-types.md");
  const progress =
    types.split("`## Progress` is append-only")[1]?.split("**Legacy items.**")[0] ?? "";
  assert.match(progress, /`fix round <R>\/<cap>`/);
  assert.match(progress, /`integration: conflicts resolved in <merge7>`/);
  assert.match(progress, /`complete \(commits …\)`/);
  assert.match(progress, /adjudication rulings/);
  has(
    progress,
    "A unit in subagent mode (the executing skill) keeps three stores: git holds code positions — task branches, their worktrees and `refs/harry/…` base refs; `## Progress` holds durable outcomes; and each task's report log under `.local/tmp/<branch>/` is an evidence record, read by people and shown when a resume asks, deleted with the unit's tmp dir at finishing",
    "The report log arrived after the two-store framing and changed it: a reader deciding what is safe to delete, or where resume reads from, needs all three.",
  );
  assert.doesNotMatch(progress, /Git, not `## Progress`, holds task-worktree state/);
});

test("finishing says task worktrees go at executing step 5, once the task lands", () => {
  const finishing = read("skills/finishing/SKILL.md");
  assert.match(finishing, /executing's step 5 removes each once its task lands/);
  assert.doesNotMatch(finishing, /as soon as its task merges back/);
  assert.doesNotMatch(finishing, /only once it merges\)/);
});

test("integration conflict resolutions are recorded and reviewed by name at step 6", () => {
  const executing = read("skills/executing/SKILL.md");
  assert.match(
    executing,
    /integration: conflicts resolved in <merge7>/,
    "The task's loop re-reviews each against its own task; step 6 sees it against the branch.",
  );
  assert.match(executing, /every integration conflict resolution recorded in `## Progress`/);
  assert.match(executing, /the merge commits where integration resolved conflicts/);
});

test("the final review's fixes hold (AC-24)", () => {
  const executing = read("skills/executing/SKILL.md");
  const step5 =
    executing.split("5. **Integrate, then mark complete.**")[1]?.split("After all tasks:")[0] ?? "";
  has(
    executing,
    "worktree `<git common dir>/harry-worktrees/<unit branch>/<task id>`",
    "Task worktrees live under the git directory, outside every working tree, so directory-scanning tools (test runners, tsc, watchers) never see them.",
  );
  assert.doesNotMatch(executing, /\.local\/worktrees/);
  has(
    step5,
    "`git -C <unit checkout> symbolic-ref --short HEAD` must print `<unit branch>`; otherwise stop and ask",
    "5.3 moves only the unit branch: a checkout on another branch stops it.",
  );
  const guard = step5.indexOf("symbolic-ref --short HEAD");
  const ff = step5.indexOf("merge --ff-only");
  assert.ok(guard >= 0 && guard < ff, "the branch check precedes the fast-forward");
  has(
    executing,
    "both named by ref (`git rev-parse --short task/<unit branch>/<task id>`, or `<unit branch>` for a task with no task branch), never read from the session's working directory",
    "AC-25: a re-review range is named by ref, never read from the session's working directory (the unit checkout, whose HEAD is not a worktree task's tip). AC-26: its start is no longer recorded in the log (pinned in the AC-26 test).",
  );
  assert.doesNotMatch(executing, /git rev-parse --short HEAD`, the head it reviews/);
  has(step5, "when the integration merged nothing, step 4's range");
  assert.doesNotMatch(executing, /entry → HEAD|merge commit → HEAD|`head:` → HEAD/);
  has(
    step5,
    "the base ref (`git rev-parse --short refs/harry/<unit branch>/<task id>/base`) when 5.3 had nothing to land",
    "An empty task's <head7> command matches its gloss.",
  );
  has(
    executing,
    "into its existing worktree (the unit checkout for a task with no task branch)",
    "The fresh fixer's place covers a unit-branch task.",
  );
  const bullet =
    readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf-8")
      .split("again by name at the final review.")[1]
      ?.split("\n- ")[0] ?? "";
  assert.ok(
    bullet.length > 0,
    "the changelog's worktree bullet moved" +
      " — " +
      "The changelog's worktree bullet stays wrapped (read raw: `read` collapses whitespace, so it cannot see a line that was spliced in unwrapped).",
  );
  const long = bullet.split("\n").filter((line) => line.length > 78);
  assert.deepEqual(long, [], "a line of the worktree bullet runs past 78 columns");
  assert.doesNotMatch(executing, /otherwise fresh dispatch with brief/);
  const session = executing.split("## Session mode")[1]?.split("## Subagent mode")[0] ?? "";
  has(
    session,
    "a unit whose last `## Progress` line is a fix round resumes mid-loop",
    "Mid-loop resume by the last `## Progress` line is session mode's; subagent mode resumes through Resuming, from git and `## Progress`.",
  );
  const subagent = executing.split("## Subagent mode")[1] ?? "";
  assert.doesNotMatch(subagent, /resumes mid-loop/);
  has(
    read("references/doc-types.md"),
    "`fix round <R>/<cap>` (session mode resumes mid-loop from it; in subagent mode, a task the user sends back to step 4 takes the round one past it, `fix round 1/4` when it has none)",
  );
  assert.doesNotMatch(executing, /done line/, "One name for the record that marks an AC done.");
  has(executing, "An AC with a complete line is DONE");
  has(
    step5,
    "Executing never deletes a base ref before its task's complete line",
    "Discard deletes base refs with no complete line; executing never does.",
  );
  assert.doesNotMatch(executing, /A base ref is never deleted before/);
  has(
    read("references/review-rubric.md"),
    "the one write a review makes is its own report file, at the path it was handed",
    "The reviewer's one write is its own report file.",
  );
  has(
    executing,
    "that build's review skill names its own report file on its `Review written to` line",
    "The Codex build's review skill names its own file after the run.",
  );
  const changelog = read("CHANGELOG.md");
  has(
    changelog,
    "a resume never re-dispatches a task on its own",
    "The changelog matches AC-31: resume re-dispatches nothing on its own.",
  );
  assert.doesNotMatch(changelog, /waits on a task/);
  assert.doesNotMatch(changelog, /dispatch it again/);
  assert.doesNotMatch(changelog, /goes to the user; no rule waits/);
});

const resumingTable = (): string[] => {
  const lines = readFileSync(path.join(repoRoot, "skills/executing/SKILL.md"), "utf-8").split("\n");
  const header = lines.findIndex((l) => l.trim() === "| State | Action |");
  assert.ok(header >= 0, "Resuming's table header is present");
  const rows: string[] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.trim().startsWith("|")) break;
    rows.push(line.trim());
  }
  return rows;
};

const finishingLeftoverStep = (): string =>
  read("skills/finishing/SKILL.md")
    .split("2. **Leftover tasks.**")[1]
    ?.split("3. **Clean worktree.**")[0] ?? "";

test("Resuming continues on its own only in the run-5.5 row (AC-33)", () => {
  const executing = read("skills/executing/SKILL.md");
  const rows = resumingTable();
  assert.equal(
    rows.length,
    2,
    "Two scoped reviews in a row forged the fast-forwarded row (C-1, C-2), each ending in a false, append-only `review clean` complete line. It is gone: every task without a complete line goes to the user.",
  );
  const auto = rows.filter((r) => !r.endsWith("| stop and ask the user |"));
  assert.deepEqual(auto, [
    "| A complete line, and its task branch gone or passing the deletion proof (5.5) | run 5.5 |",
  ]);
  has(
    executing,
    "| Anything else — no complete line, even on a task 5.3 already fast-forwarded, or a complete line on a task branch that fails the deletion proof | stop and ask the user |",
  );
  has(
    executing,
    "Only the run-5.5 row continues on its own: **Resuming** never re-dispatches a task",
  );
  assert.doesNotMatch(executing, /fast-forwarded row|fast-forwarded: continue/);
});

test("5.3 has no fast-forward witness (AC-33)", () => {
  const executing = read("skills/executing/SKILL.md");
  const finishing = read("skills/finishing/SKILL.md");
  assert.doesNotMatch(executing, /fast-forward witness|is-ancestor|only this fast-forward/);
  assert.doesNotMatch(finishing, /is-ancestor|fast-forward witness/);
  has(
    executing,
    "has nothing to land: skip the fast-forward and go to 5.4",
    "5.3 still needs its own-commit count to decide whether there is anything to land.",
  );
});

test("the brief forbids syncing the unit branch into the task branch (AC-33)", () => {
  const executing = read("skills/executing/SKILL.md");
  const brief = executing.split("1. **Brief.**")[1]?.split("2. **Dispatch implementer**")[0] ?? "";
  has(
    brief,
    "never merge, rebase, reset or pull the unit branch into the task branch — integration is 5.1's job",
  );
});

test("Resuming has no dirty-tree row: 5.5's own check covers it, MERGE_HEAD included (AC-33)", () => {
  const executing = read("skills/executing/SKILL.md");
  for (const row of resumingTable())
    assert.doesNotMatch(
      row,
      /MERGE_HEAD|uncommitted files/,
      "The only automatic row runs 5.5 (finishing's f.2 runs it too), which already refuses a dirty worktree. A merge in progress can leave `status --porcelain -uall` empty (a clean `--no-commit` merge, or a conflict resolved back to ours), so 5.5's clean check covers MERGE_HEAD too; the check itself is pinned in the AC-34 (c) test.",
    );
  const remove =
    executing
      .split("5. **Remove the task's worktree and delete its branch**")[1]
      ?.split("**Resuming.**")[0] ?? "";
  has(remove, "`git -C <path> rev-parse -q --verify MERGE_HEAD` printing nothing");
});

test("a check that cannot run counts as not passing, stated once (AC-33 I-B)", () => {
  const executing = read("skills/executing/SKILL.md");
  const rule =
    "In this step, **Resuming** included, a check that cannot run counts as not passing: stop and ask the user.";
  assert.doesNotMatch(
    executing,
    /cannot run — /,
    "No example that contradicts 5.5, which removes a registration whose directory is gone without running `status` on it (AC-33 I-D).",
  );
  assert.equal(executing.split(rule).length - 1, 1);
  const step5 =
    executing.split("5. **Integrate, then mark complete.**")[1]?.split("1. **Merge in.**")[0] ?? "";
  has(step5, rule);
});

test("executing names its tree-equality check the deletion proof (AC-33 m-1)", () => {
  const executing = read("skills/executing/SKILL.md");
  has(executing, "The **deletion proof**: `test");
  assert.doesNotMatch(executing, /landing check/);
});

test("the Codex build's round-4 adjudication matches its cap (AC-33 m-2)", () => {
  const executing = read("skills/executing/SKILL.md");
  const carveOut =
    executing.split("**Model by role.**")[1]?.split("Per task. Each task has")[0] ?? "";
  has(
    carveOut,
    "work already on that row has no other fixer: its round 4 is the adjudication, not a fix round",
    "Its round lines keep the `/4` name, so the cap is not called three (m-6).",
  );
  assert.doesNotMatch(executing, /cap is three fix rounds/);
});

test("finishing removes a leftover task by running executing's 5.5 (AC-33 I-C)", () => {
  const deleteStep = finishingLeftoverStep();
  assert.doesNotMatch(
    deleteStep,
    /clean check/,
    "AC-28: finishing acts on the run-5.5 row by running executing's step, never a restated copy — the copy had drifted (no MERGE_HEAD, no gone-directory guard). The citation itself is pinned in the AC-34 (e) test.",
  );
  assert.doesNotMatch(deleteStep, /git worktree remove/);
  assert.doesNotMatch(deleteStep, /update-ref/);
});

test("the ask names every resume step and shows the unit branch's reflog (AC-33 m-5)", () => {
  const executing = read("skills/executing/SKILL.md");
  const ask =
    executing
      .split("Only the run-5.5 row continues on its own")[1]
      ?.split("A base ref without")[0] ?? "";
  has(ask, "the unit branch's reflog (`git reflog show --format='%h %gs' <unit branch>`)");
  has(ask, "the user names the step it resumes at — step 2, step 4, 5.1 or 5.4");
  assert.doesNotMatch(executing, /once they confirm 5\.3 fast-forwarded it/);
});

test("the changelog matches AC-33: one automatic row, no witness", () => {
  const changelog = read("CHANGELOG.md");
  assert.doesNotMatch(changelog, /fast-forward landed → mark it complete/);
  assert.doesNotMatch(changelog, /gone or landed/);
  assert.doesNotMatch(changelog, /its tip is an ancestor of the unit branch/);
  has(changelog, "complete, with its branch gone or safe to delete → remove it");
  has(changelog, "never merges, rebases, resets or pulls the unit branch into its own");
  has(changelog, "`executing`'s deletion proof, which compares trees, not commits");
  has(changelog, "Whether a task branch is safe to delete is one check across both skills");
  has(changelog, "unless its worktree has uncommitted files or a merge in progress");
  has(changelog, "a check that cannot run counts as not passing");
});

test("f.2's removal stops wherever 5.5 stops (AC-34 a)", () => {
  const finishing = read("skills/finishing/SKILL.md");
  has(finishing, "where 5.5 stops and asks, so does this step");
});

test("the worktree clean check is stated once, in 5.5 (AC-34 c)", () => {
  const executing = read("skills/executing/SKILL.md");
  const finishing = read("skills/finishing/SKILL.md");
  const check =
    "it must pass the **clean check** first — `git -C <path> status --porcelain -uall` empty and `git -C <path> rev-parse -q --verify MERGE_HEAD` printing nothing (if not, stop and ask)";
  has(executing, check);
  has(
    executing,
    "ignored files are not listed: a task worktree holds only agent-made files whose work is committed",
    "5.5 says why it lists no ignored files; finishing lists them for the unit's own worktree only, and says why.",
  );
  const clean =
    finishing.split("3. **Clean worktree.**")[1]?.split("4. **Remove the worktree**")[0] ?? "";
  has(clean, "The worktree must pass executing's 5.5 clean check (`skills/executing/SKILL.md`)");
  has(clean, "A unit's worktree is also the user's checkout, so also list its ignored files");
  assert.doesNotMatch(finishing, /status --porcelain -uall` must be empty/);
  assert.doesNotMatch(finishing, /verify MERGE_HEAD/);
});

test("finishing re-checks leftover tasks before it removes the unit's worktree (AC-34 d)", () => {
  const finishing = read("skills/finishing/SKILL.md");
  const leftover = finishing.indexOf("2. **Leftover tasks.**");
  const remove = finishing.indexOf("4. **Remove the worktree**");
  assert.ok(leftover >= 0 && leftover < remove, "the leftover-task re-check comes before f.4");
  has(
    finishingLeftoverStep(),
    "Re-run step 1's leftover-task check — executing's **Resuming** table",
  );
  has(finishing, "**in place** runs only f.1, f.2, f.5 and f.6; **own worktree** runs f.1–f.6");
  has(finishing, "Its run-5.5 row → left for f.2, which removes it");
});

test("finishing runs 5.5 under step 5's rules (AC-34 e)", () => {
  has(
    finishingLeftoverStep(),
    "remove it by running executing's 5.5 under step 5's rules, `<branch>` standing for `<unit branch>`; where 5.5 stops and asks, so does this step",
  );
});

test("a merge in progress is finished or aborted first, then cleanup restarts from f.1 (AC-34 m-12)", () => {
  const finishing = read("skills/finishing/SKILL.md");
  const flow =
    finishing.split("**If removal is refused**")[1]?.split("g. **Back on `<base>`**")[0] ?? "";
  const merge =
    "A merge in progress (MERGE_HEAD set) comes first, whatever the status shows: the user finishes or aborts it, then cleanup restarts from f.1, so a commit that finishes it is proven landed before f.5 deletes the branch; no choice below runs mid-merge, since git cannot switch branches then.";
  has(
    flow,
    merge,
    "A commit that finishes the merge lands on the branch after f.1 proved it, so f.1 runs again before f.5's `branch -D`; and git cannot cut a rescue branch mid-merge, so no rescue choice runs while MERGE_HEAD is set.",
  );
  const rescue = flow.indexOf("**Rescue branch**");
  assert.ok(
    flow.indexOf(merge) >= 0 && flow.indexOf(merge) < rescue,
    "the merge comes before the choices",
  );
  assert.doesNotMatch(finishing, /then f\.3 runs again/);
});

test("the changelog names the renumbered cleanup steps (AC-34 d)", () => {
  const changelog = read("CHANGELOG.md");
  has(changelog, 'step f.4 names `f.1`/`f.3` instead of an ambiguous "step 2"');
});

test("cleanup's order sentences put the landing check before leftover tasks (AC-34 m-13)", () => {
  has(
    read("skills/finishing/SKILL.md"),
    "The landing check first, then leftover tasks, then the worktree, then the feature branch, in this order:",
  );
  const changelog = read("CHANGELOG.md");
  has(changelog, "Cleanup runs the table again after its landing check and before it removes");
  assert.doesNotMatch(changelog, /Cleanup runs the table again first/);
});

test("f.3 lists ignored files; executing states the clean check once (AC-34 m-14)", () => {
  const finishing = read("skills/finishing/SKILL.md");
  const clean =
    finishing.split("3. **Clean worktree.**")[1]?.split("4. **Remove the worktree**")[0] ?? "";
  has(clean, "`git -C <looked-up-path> ls-files -o -i --exclude-standard`");
  const executing = read("skills/executing/SKILL.md");
  assert.equal(executing.split("**clean check**").length - 1, 1);
  assert.equal(executing.split("rev-parse -q --verify MERGE_HEAD` printing nothing").length - 1, 1);
});

test("the report log's entries are specified once, in the log paragraph (AC-35 a)", () => {
  const executing = read("skills/executing/SKILL.md");
  const log = executing.split("**The report file is a log**")[1]?.split("## Session mode")[0] ?? "";
  for (const entry of [
    "`## dispatched <round>`",
    "`## result <round>`",
    "`## review <round>: dispatched`",
    "`<round>` is `initial`",
    "`fix round <R>/4`",
    "`needs context`",
  ])
    has(log, entry);
  const carveOut =
    executing.split("**Model by role.**")[1]?.split("**Reviewers on that build:**")[0] ?? "";
  const rest = executing.replace(log, "").replace(carveOut, "");
  assert.doesNotMatch(
    rest,
    /`## (dispatched|result|review)/,
    "Outside the log paragraph, only the Codex carve-out names an entry (who appends it on that build); every per-step restatement is gone.",
  );
  assert.doesNotMatch(executing, /\(the log, Before either mode, step 4\)/);
});

test("the deletion proof is defined in executing 5.5 and cited by finishing (AC-35 b)", () => {
  const executing = read("skills/executing/SKILL.md");
  const finishing = read("skills/finishing/SKILL.md");
  const remove =
    executing
      .split("5. **Remove the task's worktree and delete its branch**")[1]
      ?.split("**Resuming.**")[0] ?? "";
  has(
    remove,
    '`test "$(git merge-tree --write-tree <into> <from>)" = "$(git rev-parse \'<into>^{tree}\')"`',
    "Generic operands, then each caller's own binding: \"X standing for Y\" read both ways, and a review mapped finishing's `<branch>` to a task branch.",
  );
  has(remove, "merging `<from>` into `<into>` would change nothing");
  has(remove, "Compare the command's whole output, never just its first line");
  has(
    remove,
    "5.5 runs it with `<into>` = `<unit branch>` and `<from>` = `task/<unit branch>/<task id>`",
  );
  assert.doesNotMatch(executing, /finishing's f\.1/);
  assert.equal(executing.split("merge-tree --write-tree").length - 1, 1);
  const f1 = finishing.split("1. **Landing check.**")[1]?.split("2. **Leftover tasks.**")[0] ?? "";
  has(
    f1,
    "executing's 5.5 deletion proof (`skills/executing/SKILL.md`) with `<into>` = `<base>` and `<from>` = `<branch>`",
  );
  has(f1, "For a PR, `<from>` is `origin/<branch>` after `git fetch`");
  assert.doesNotMatch(finishing, /merge-tree/);
  assert.doesNotMatch(remove + f1, /standing for/);
});
