---
name: finishing
description: "Use when implementation is complete and you need to integrate or wind down the work — deciding between merge, PR, keeping the branch, or discarding. Triggers at the end of any executing flow, before the branch/worktree is left behind."
---

# Finishing a Development Branch

Wind down completed work cleanly: verify it's green, review any changed shape, ask how to integrate, then carry the chosen path all the way through. This is a procedure governed by the Harry laws (HARRY.md); when they conflict, the laws win.

## Where the unit lives

A unit's **layout** says which checkout holds its work. Work it out whenever a step needs it — before step 1, on Option 2's on-merge resume, at a Discard — since those often run in a later session, after the checkouts have moved on. `git worktree list` prints the main checkout first; every entry after it is a **linked** worktree.

- **own worktree** — a linked worktree (never the main checkout) has `<branch>` checked out; note its path, since after step a you are on `<base>` and must never derive it from cwd;
- **in place** — no linked worktree has `<branch>` checked out, whatever the main checkout is on now (one writer, no worktree — HARRY.md §5).

Task worktrees are not part of it: executing's step 5 removes each once its task lands. Whether the main checkout is on `<branch>` right now is not part of it either; only Discard needs that, and checks it itself.

## 1. Verify tests first — never finish on red

Run the project's suite before anything else. Read the output (exit code, failure count) — an unread "pass" is not evidence (HARRY.md §6).

If anything fails: STOP. Report the failures and do not proceed to step 2 or the menu. There is no merge, no PR, no archive on red.

**Leftover tasks.** Then look for any task executing left behind under this unit — each task id with a branch under `refs/heads/task/<branch>/` or a base ref under `refs/harry/<branch>/` (`git for-each-ref`; executing's step 2 naming rule). Executing's step 5 removes each task once it lands, so one left here is a task a run stopped short of finishing. Only executing's 5.4 writes a complete line, and a return to executing has to come before anything merges, archives the item or removes the unit's worktree, which is why this runs here. Classify each by executing's step 5 **Resuming** table, read against the item's `## Progress`, `<branch>` standing for `<unit branch>`; finishing keeps no case list of its own, and never picks an executing step for a task itself. Its run-5.5 row → left for f.2, which removes it; any other row → back to executing, whose **Resuming** acts on it — asking the user where its table says to — then finishing again from step 1; the unit is not finished.

## 2. Architecture review — before anything merges or is pushed

A **shape** is the outward form other code depends on: an API, a DB schema, a public interface, or a module or service boundary. This step reviews the change's shapes the way a lead reads a PR — whether each one fits — a level the per-diff review during executing (`references/review-rubric.md`) does not judge at. Every path out of the menu below — merge, PR (before `gh pr create`), keep — passes through it; only Discard skips it, since nothing integrates. It runs before the menu because a **fix now** ruling sends the work back to executing.

**Paths.** This step may run inside a worktree, and even then every `.local/…` path in it means the **main checkout's** store (HARRY.md §5), written `<store>/.local/…` below: resolve `<store>` as the executing skill's Paths rule does (`skills/executing/SKILL.md`, "Before either mode" step 2), inside the same command that writes, and hand the reviewer the already-resolved absolute path.

**Shape gate.** First list the shapes this change added or altered. Every round records the head it reviews — `architecture review at <sha7>` (`git rev-parse --short HEAD`) — in `## Progress`. On a later round — a **fix now** ruling is already recorded — list only the shapes changed since the head the most recent round recorded: `<sha>..HEAD`, which covers every commit since, whoever made it (the executing fix, its reviews' fix rounds, a final-review fix wave). Empty list → write one line, `no shape changed, architecture review skipped`, to the item's `## Progress`, and go to step 3. Non-empty → the review runs, whatever the work is called — a bug fix that alters a shape is reviewed like a feature.

**Reviewer.** Package the diff to a file under `<store>/.local/tmp/<branch>/` (the CC reviewer's input only — the Codex build below writes none): the branch diff (`git diff <base>...HEAD`), or on a later round only the shape gate's `<sha>..HEAD`, never the whole branch again — in one command that resolves `<store>`, creates that directory with `mkdir -p` (nothing earlier writes there for a Trivial unit), and writes the file; then dispatch **ONE** CC reviewer subagent (explicit `model: opus` — the §5 dispatch cap; never inherit the session model), read-only, one lane — no Codex lane. Hand it: the shape list; the item's `## Why / What` and its `### Acceptance criteria`, as known facts (including any neighbouring services the design names); the diff file, by its absolute path; `references/architecture-review.md`; the last 20 commits touching the changed paths (`git log -n 20 --stat -- <changed paths>` from the branch tip, so history from before the branch counts); and read access to the whole repo. On a later round, also hand it every ruling recorded so far — each **leave as is** with the user's reason, and each **backlog** — so a ruled finding is not raised again unless the fix changed its shape. **Codex build:** there is no subagent to dispatch, so the review runs in a separate read-only `codex exec` process instead, and is independent. Instead of the diff file, in one command that resolves `<store>` and creates that directory with `mkdir -p`, write a context file there holding everything above except the diff and `references/architecture-review.md` — the shape list, the item's `## Why / What` and its AC, the `git log -n 20 --stat -- <changed paths>` output, and on a later round the rulings recorded so far. Then run that build's review skill (`codex-skills/review`, which owns resolving the plugin root) with `--architecture --base <base> --context @<file>` — on a later round `--base <sha>`, the head the most recent round recorded. It embeds `references/architecture-review.md` and has the reviewer read the diff itself; read the findings from the file named on its `Review written to` line. If that run fails, the session applies `references/architecture-review.md` itself and records one line in `## Progress` that this review was not independent.

**Rulings.** Findings never go to an automatic fixer. Put them to the user as **one** list — one line per finding, in plain words (`references/plain-language.md`): where, why, the structural fix (and a short-term one only when it is not simple; HARRY.md §6), the recommended ruling — and ask for a ruling on each; a list already shown counts as one question (HARRY.md §6). Each finding is ruled one of three ways:
- **fix now** → draft a new AC, appended to the item's `### Acceptance criteria` and naming the AC it supersedes, if any (a finding may add a requirement no AC covered) — approved AC text is never edited → the user approves it → back to the **executing** skill at the item's tier → finishing again from step 1, where this step re-checks only the shapes the fix changed.
- **backlog** → a new `<store>/.local/items/<slug>.md` with `status: backlog` and a `## Notes` section quoting the finding, plus one `<store>/.local/INDEX.md` line (as in Option 1's step c below); the merge proceeds.
- **leave as is** → the ruling and the user's reason go to `## Progress`; handed to the reviewer on any later round, so the finding is not raised again.

No findings → record `architecture review: no findings` in `## Progress`, say so to the user in one line, and go to step 3. There is no round cap: every round waits on the user's rulings, so the user decides when it stops. Every ruling, every skip line and every clean run is recorded in `## Progress`.

**No item (Trivial).** There is no `## Progress`: the round's head line, the skip line, the not-independent line, the no-findings line and every ruling are written in the reply instead. The reviewer gets the task as the user stated it in place of `## Why / What` and its AC. A **fix now** ruling means fix it in place, re-run step 1, and re-check the shapes that changed — no AC is drafted. **backlog** still opens a new item.

## 3. Ask: merge or PR? — ALWAYS ask

Never auto-decide (HARRY.md §5). Present exactly these options and wait:

```
Implementation complete and tests green. How should I integrate this?

1. Merge back to <base> locally
2. Push and open a Pull Request
3. Keep the branch as-is (I'll handle it later)
```

(Detached HEAD / externally-managed workspace: drop option 1 — merge isn't yours to make.)

Discard is **not offered** — it exists only as a response to the user's explicit request (see Discard below). Proactively offering to delete work nudges toward destruction; the user can always ask.

**Pre-decided integration path.** If the user already chose the path (e.g. "commit & merge", "just open the PR"), skip the menu — do NOT re-ask. But a pre-decided path is NOT a shortcut past finishing: still run step 1's verify gate and step 2's architecture review first, then the FULL tail of the chosen option (for merge, every step a–h below). A bare merge (`git merge --squash` + commit) that stops there skips the wind-down and is a §6 violation.

## 4. Execute the choice

### Option 1 — Merge (do all of this, in order; don't stop at the merge)

**Confirm `<base>` first.** The base is whatever the work forked from (the item, the conversation, or the branch's upstream/fork point) — if it isn't already known, ask before merging; merging into the wrong base is expensive to undo, and "the base is obviously main" is exactly how it happens.

The merge is the start of finishing, not the end. Completion evidence is CI green when the work was pushed, or the merged-result suite (step a) when the merge is local-only (HARRY.md §6).

**Squash-merge (HARRY.md §5).** From `<base>` in the main checkout: `git merge --squash <branch>`, then ONE `git commit` — a conventional subject naming the unit and a short body saying why and what, not a list of the branch's commits. Never a `--no-ff` or fast-forward merge: the base gets one commit per unit. Note the squash SHA; it is the unit's only reference on the base once the branch is deleted (step b records it). A conflict stops here: undo it on `<base>` with `git reset --merge` (not `git merge --abort` — a squash leaves no MERGE_HEAD, so that fails), resolve it on the branch, re-run step 1, then squash again.

a. **Verify the merged result — before anything else in the tail.** Run the full local suite on `<base>` now. Green → continue. Red → STOP: leave the branch AND worktree in place and investigate — a local merge has pushed nothing and is fully recoverable, and "the failure is probably flaky" is not a reason to destroy the debugging workspace.
b. **Memory** — append ONE line for this unit to `.local/HISTORY.md` (create if absent, newest first): `- YYYY-MM-DD · <topic> · <squash SHA> · PR #<n> (or "local merge, no PR") · <one-line outcome>` (rotate HISTORY yearly per `references/doc-types.md` — if this is the first entry of a new year, move the prior year's entries to `.local/history/<year>.md` first). Then remove the unit's line from `.local/INDEX.md` `## In flight` so the work list tracks only active work. Do NOT paste review/audit detail or commit lists — that lives in git/PR; `HISTORY.md` is a thin pointer (HARRY.md §5).
c. **Flush Follow-ups** — read the item's `## Follow-ups` section (before moving the file). For each line, create a new `.local/items/<new-slug>.md` with `status: backlog`, a title derived from the line, and a `## Notes` section quoting it; add one `.local/INDEX.md` line per new item. Then clear the source item's `## Follow-ups` section. Non-Goals do NOT get this treatment — only `## Follow-ups` is flushed (`references/doc-types.md`); if a Scope & Non-Goals bullet still needs to survive archiving, that's the author's job to have copied into `## Follow-ups` before now, not finishing's job to catch.
d. **Archive the item** — set the item's frontmatter `status: done` and move `.local/items/<slug>.md` → `.local/archive/<slug>.md` (content otherwise unchanged). Archive is **read-only** from here on — never edit it again; extending the idea later means opening a new `.local/items/` item that links back to this archive path (`references/doc-types.md`).
e. **Milestone membership** — if the item's frontmatter has `milestone: <slug>`, open that milestone item (`.local/items/<slug>.md`) and move this item's link from its `## Members` to its `## Delivered` section. If `## Members` is now empty (this was the last one), archive the milestone itself right here, same as step d: `status: done`, move it to `.local/archive/<slug>.md`.
f. **Cleanup** — by the unit's layout (Where the unit lives): **in place** runs only f.1, f.2, f.5 and f.6; **own worktree** runs f.1–f.6, using the worktree path the layout recorded. The landing check first, then leftover tasks, then the worktree, then the feature branch, in this order:
   1. **Landing check.** A squashed branch is never an ancestor of `<base>`, so `git branch -d` refuses it and native worktree tooling reports its commits as unmerged. Prove `<base>` already contains the branch's whole change: run executing's 5.5 deletion proof (`skills/executing/SKILL.md`) with `<into>` = `<base>` and `<from>` = `<branch>`. It holds for a squash, a merge commit, a rebase merge, and a base that already carried part of the change. Not equal → STOP: leave branch and worktree, show the user `git diff <base> <branch> --stat`; something on the branch did not land. For a PR, `<from>` is `origin/<branch>` after `git fetch`, and confirm the local branch has no commits the remote lacks; if the remote branch is already gone (deleted on merge), `<from>` is the local `<branch>`: compare its tip with the PR head (`gh pr view <n> --json headRefOid`).
   2. **Leftover tasks.** Re-run step 1's leftover-task check — executing's **Resuming** table, from git and the item's `## Progress` (read at `.local/archive/<slug>.md`, where step d moved it) — immediately before anything is removed: Option 2's on-merge resume reaches here without step 1, often in a later session after follow-up commits, and nothing records step 1's outcome. Only a task in its run-5.5 row is removed; any other row → STOP and ask the user — after the merge there is no going back to executing. Each removed task keeps a later unit reusing `<branch>` clear of executing's step 2: remove it by running executing's 5.5 under step 5's rules, `<branch>` standing for `<unit branch>`; where 5.5 stops and asks, so does this step.
   3. **Clean worktree.** The worktree must pass executing's 5.5 clean check (`skills/executing/SKILL.md`), `<looked-up-path>` standing for `<path>`; if not, run the refused-removal flow below before anything is forced. A unit's worktree is also the user's checkout, so also list its ignored files — `git -C <looked-up-path> ls-files -o -i --exclude-standard` — and show them to the user before removal: the clean check does not list them, removal drops them, and no rescue choice below covers them (usually dependency/build output, but the user says whether anything there matters).
   4. **Remove the worktree** — prefer the harness's NATIVE worktree tooling; its discard flag is allowed only when f.1 passed AND f.3 found the worktree clean (the flag also destroys uncommitted files); only as fallback, from the main repo root: `git worktree remove <looked-up-path>` and `git worktree prune`.
   5. **Delete the branch** — `git branch -D <branch>` (git refuses to delete a branch still checked out in a worktree, which is why this comes last).
   6. **Temp files.** Delete this unit's `.local/tmp/<branch>/` (briefs/reports/diffs are transient; orphaned per-branch dirs otherwise accumulate in the main checkout forever) — never touch sibling branches' dirs. A branch name with `/` (`chore/x`) leaves its parent (`.local/tmp/chore/`) behind: remove it too when it is now empty (`rmdir`, which refuses a non-empty one). This runs whether or not the unit had a worktree.

   Provenance rule: remove only the worktree the layout names as the unit's own (and task worktrees executing's naming rule names: in f.2 once executing's **Resuming** table put them in its run-5.5 row, in Discard once the user confirmed them) — never any other worktree, whoever created it. **If removal is refused** — native tooling declining without a discard flag, or `git worktree remove` reporting "contains modified or untracked files" — those files exist nowhere else. Never force the removal on your own initiative (no `--force`, no discard flag). A merge in progress (MERGE_HEAD set) comes first, whatever the status shows: the user finishes or aborts it, then cleanup restarts from f.1, so a commit that finishes it is proven landed before f.5 deletes the branch; no choice below runs mid-merge, since git cannot switch branches then. Otherwise show the user `git -C <looked-up-path> status --porcelain -uall` and ask which:
   - **Rescue branch** (e.g. `<branch>-rescue`). Fetch first and cut it from `origin/<base>` when a remote exists (a local `<base>` may be stale here — step g's pull runs later), otherwise from local `<base>`; commit the files to it and keep that branch for the user to integrate through the normal merge-or-PR flow — it is not deleted by this cleanup, and step h reports it.
   - **Move into the main checkout.** Check for filename collisions first — a collision stops here; ask the user rather than overwrite. These files can also make step g's `checkout`/`pull` refuse ("would be overwritten") since they now sit uncommitted in the checkout — if that happens, report it and stop; never stash or delete them to force the pull through.
   - **Delete them** (unrecoverable).

   Carry out the choice, then remove the worktree.
g. **Back on `<base>`** — end on `<base>`, up to date (`git checkout <base>`, `git pull` when a remote exists).
h. **Completion evidence.** CI triggers on push, not on a local merge — so the evidence depends on where the merge landed:
   - **Pushed (or a PR merged):** watch the CI run to completion and report green or red. If red, handle it — do NOT claim done at the merge moment.
   - **Local-only merge:** CI will NOT run. Step a's merged-result suite IS the completion evidence (already run and read). Offer to push (outward-facing — needs the user's consent; don't push unasked).

   If step f's cleanup kept a `<branch>-rescue` branch, name it in this report (branch name, what it holds) — the same way Option 3 reports what it keeps.

### Option 2 — PR (HARRY.md §5 PR discipline)

- Draft the title + body, show it for approval BEFORE `gh pr create` (unless the user said "just open it"). Body must not leak internal planning language (no Sprint/Phase, `.local/` paths, "per AC-3").
- Push the branch and open the PR. From a detached HEAD, publish with `git push origin HEAD:refs/heads/<new-branch>`.
- Before merging a PR — even when not asked — check its reviews, inline comments, and CodeRabbit status. Any unresolved actionable item → report and do NOT merge (unless the user says "force merge").
- Merge it as a squash (HARRY.md §5): `gh pr merge --squash --subject "<PR title>" --body "<why and what>"` — pass both, or GitHub's default squash message may list every branch commit. Never a merge commit or rebase merge.
- Keep the branch, and its worktree if it has one, alive — the user needs it to iterate on feedback.
- **Follow-up commits re-run step 1's leftover-task check and step 2 before they are pushed.** A commit answering PR feedback can leave a task behind or alter a shape: run step 2's shape gate as a later round — shapes changed since the head the most recent round recorded — and review any it finds before the push.
- **A PR-integrated unit is NOT finished at `gh pr create`.** Annotate the unit's `<store>/.local/INDEX.md` `## In flight` line (resolve `<store>` as step 2's Paths rule does) with the PR number while it's open (e.g. `… · PR #12 open`) so the list stays truthful.
- **On merge** — whether in this session or a later one, and whether you merged it or a human clicked merge on GitHub — finishing resumes: run Option 1's full tail a–h, EXCEPT the merge itself (already done; step 2's architecture review already ran before `gh pr create` and before each follow-up push). First `git checkout <base> && git pull`, so step a and the landing check see the merge. If someone merged it on GitHub with a merge commit or rebase, accept it as it is — never rewrite published history to force a squash — and record the merge commit's SHA (or the rebased tip) in step b; the landing check covers every method. Step a there is a local re-verify of the merged base; evidence step h uses the CI run the push/PR already triggered. If you notice a merged PR whose item is still `status: active`, that's the trigger to run the tail now.

### Option 3 — Keep

Report the branch name, and the worktree path if there is one. Touch nothing.

### Discard — explicit request only (destructive)

Never offered from the menu; run this only when the user asks to discard the work. Work out the unit's layout (Where the unit lives). For **in place**, also check whether the main checkout is on the branch right now — a Discard can come in a later session, after it moved on: does `git branch --show-current` still print `<branch>`? Show what will be lost: the branch and its commit list; the uncommitted/untracked files via `status --porcelain -uall` — in the unit's worktree, or in the main checkout only when it is on `<branch>` (a main checkout is not born clean, so say that files there may predate the unit). A Discard mid-execution can also leave task worktrees whose tasks have not landed yet (executing's step 5 removes each once its task lands). Executing's naming rule (its subagent mode, step 2) finds them: list, pre-marked as this unit's, every `git worktree list` entry on a `task/<branch>/…` branch and every leftover `task/<branch>/…` branch with no worktree (`git for-each-ref refs/heads/task/<branch>/`); for each one show its branch, the commits `<branch>` does not contain (`git log <branch>..<its branch>`) and, for a worktree, its `status --porcelain -uall`. The naming rule decides which are this unit's, and the user confirms the list; a worktree outside it is not this unit's. Then require a typed `discard` to confirm — given after the user has seen that whole list, this typed confirmation is what authorizes forcing the removals and discarding those files here, unlike step f's refused-removal flow above, which never forces on its own initiative; step f.1's landing proof does not apply. On confirmation: `cd` to main root. With a worktree, clean it up (provenance rule). With a branch in place: if the main checkout is on `<branch>`, discard the listed files (`git reset --hard`, then `git clean -fd` — no `-x`, so ignored files stay) and `git checkout <base>`, since git refuses to delete the checked-out branch; if it is not on `<branch>`, touch the checkout not at all — whatever is uncommitted there is not this unit's. For each task the user confirmed, remove its worktree, then delete its `task/<branch>/<task id>` branch and its `refs/harry/<branch>/<task id>/base` ref together, in one `git update-ref --stdin` transaction (executing's 5.5 transaction, `<branch>` standing for `<unit branch>`), so neither outlives the other; only when the user confirmed every listed entry, also delete any other ref under `refs/harry/<branch>/` (each one `git for-each-ref --format='%(refname)' refs/harry/<branch>/` prints, with `git update-ref -d`). When the user leaves any listed entry unconfirmed, keep `<branch>` too, with those tasks' branches and base refs, and say so: git's record of them names `<branch>`, and a later unit that reused the name would find their refs in its way. Delete `.local/tmp/<branch>/`, then, unless `<branch>` is kept above, `git branch -D <branch>`.

Then settle the item — never leave it `status: active`. Ask the user which:
- **Back to backlog** — set `status: backlog` and append a one-line `## Notes` entry (`implementation discarded <date>, <reason>`).
- **Delete outright** — remove `.local/items/<slug>.md` (destructive; needs the user's call per HARRY.md's confirmation rule).

Either way, remove the unit's `.local/INDEX.md` `## In flight` line, and update its `## Items` line to match the disposition (delete the entry with a deleted item; flip its status to backlog with a kept one).

## Quick reference

| Option | Tests gate | Architecture review | Merge | Push/PR | Branch | Worktree |
|--------|:--:|:--:|:--:|:--:|--------|----------|
| 1. Merge | green required ×2 (branch, then merged result) | before the merge, when a shape changed | squash | — | force-deleted after merged result is green AND the landing check passes; a `<branch>-rescue` may survive a refused removal | if any: removed first, only when clean (native tooling, provenance) |
| 2. PR | green required | before `gh pr create` and each follow-up push, when a shape changed | — | yes (draft approved first) | kept | if any: **kept** (needed for iteration)¹ |
| 3. Keep | green required | when a shape changed | — | — | kept | if any: kept |
| Discard (explicit request only) | n/a | n/a | — | — | force-deleted (typed `discard`) | if any: removed |

¹ Not finished at `gh pr create` — on merge (this session or later), run Option 1's tail a–h minus the merge itself.
