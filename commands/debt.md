---
description: Re-judge deferred decisions (DEBT: markers, spec Non-Goals, plan deferrals) into one triaged ledger with a freshness verdict per row.
argument-hint: '[path...]'
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git grep:*)
---

`/debt` is not a grep harvester — plan-first already keeps fresh debt in view. It is a **deferred-decision auditor**: it gathers every deliberate "do it later" from across the repo into one overview, then re-judges whether each deferral's premise still holds. One-shot report. Changes nothing. It does not scan `.local/backlog/` — backlog items were never decided, so there is no premise to re-judge (HARRY.md §5).

Optional `$ARGUMENTS` scopes the scan to the given path(s); default is the whole repo.

## 1. Reconcile the sources into one view

Deferrals hide in three places. Collect all of them — this command is the single overview specs alone can't give (specs are scattered per-feature).

- **Code markers.** `git grep -nE '(DEBT|TODO|FIXME|HACK):' -- $ARGUMENTS` (drop `-- $ARGUMENTS` when no path given). `DEBT:` is the sanctioned marker from HARRY.md §4 and carries a ceiling + upgrade path; TODO/FIXME/HACK are unsanctioned debt — flag them as `unmarked` (a violation per §4).
- **Spec Non-Goals.** Read the `## 4. Scope & Non-Goals` section of every `*-design.md` under `.local/specs/` (`Glob: .local/specs/**/*-design.md`). Each "不做 / 移除 / 丟棄 / 延後 / Non-Goal" bullet is one deferral.
- **Plan deferrals.** Read `*-plan.md` / `*-followup.md` under `.local/plans/` for explicit "do later / 延後 / out of scope / follow-up" lines.

## 2. Freshness verdict — is the landmine now armed?

For each deferral, judge whether its premise still holds. Use the cheap checks below, then light judgment. This is the part grep can't do.

- **Referenced symbol/file changed or gone?** If a marker or Non-Goal names a symbol or path, confirm it still exists (`Glob`/`Grep`) and check recent churn (`git log --oneline -5 -- <file>`). Gone or heavily rewritten → premise likely broken.
- **A later spec contradicts an earlier Non-Goal?** Compare Non-Goals against newer specs by date in the filename. A thing deferred in an old spec but required by a newer one is now in scope.
- **A `DEBT:` ceiling now breached?** Read the named ceiling (e.g. "O(n^2), swap if N > a few thousand") and check whether reality crossed it — call sites multiplied, data grew, the cheap path is now hot.

Each deferral gets exactly one verdict:

- `still-safe` — premise holds, leave it.
- `now-relevant` — premise weakening; revisit soon.
- `now-risky` — premise broken / ceiling breached; armed landmine.

## 3. Output — triaged ledger

Group by verdict (`now-risky` first, then `now-relevant`, then `still-safe`). One row per deferral:

`<verdict> · <source: code|spec|plan> · <file>:<line or section> — <what was deferred>. premise: <the condition it assumed>. now: <what changed, or "holds">.`

For `now-relevant` / `now-risky` rows, add a **promotion suggestion**: the Non-Goal or shortcut whose premise changed → one line naming the task it should become.

End with: `<N> deferrals: <a> risky, <b> relevant, <c> safe. <u> unmarked.` Nothing found: `No tracked debt. Clean ledger.`

Reads and reports only. To persist, the user must ask.
