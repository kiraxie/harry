---
name: debt
description: Re-judge deferred decisions (DEBT markers, spec Non-Goals, plan deferrals) into one triaged ledger with a freshness verdict per row. Use when the user asks to audit tech debt, deferred decisions, or find stale shortcuts.
---

# Debt

This is not a grep harvester — plan-first already keeps fresh debt in view. It is a
**deferred-decision auditor**: it gathers every deliberate "do it later" from across
the repo into one overview, then re-judges whether each deferral's premise still
holds. One-shot report. Changes nothing.

The user may scope the scan to specific path(s); default is the whole repo.

## 1. Reconcile the sources into one view

Deferrals hide in three places. Collect all of them.

- **Code markers.** `git grep -nE '(DEBT|TODO|FIXME|HACK):' -- <path...>` (drop the
  path filter when none given). `DEBT:` is the sanctioned marker from HARRY.md §4
  and carries a ceiling + upgrade path; TODO/FIXME/HACK are unsanctioned debt — flag
  them as `unmarked` (a violation per §4).
- **Spec Non-Goals.** Read the `## 4. Scope & Non-Goals` section of every
  `*-design.md` under `.local/specs/`. Each "不做 / 移除 / 丟棄 / 延後 / Non-Goal"
  bullet is one deferral.
- **Plan deferrals.** Read `*-plan.md` / `*-followup.md` under `.local/plans/` for
  explicit "do later / 延後 / out of scope / follow-up" lines.

## 2. Freshness verdict — is the landmine now armed?

For each deferral, judge whether its premise still holds.

- **Referenced symbol/file changed or gone?** Confirm it still exists and check
  recent churn (`git log --oneline -5 -- <file>`). Gone or heavily rewritten →
  premise likely broken.
- **A later spec contradicts an earlier Non-Goal?** Compare by date in the filename.
- **A `DEBT:` ceiling now breached?** Check whether reality crossed the named
  ceiling.

Each deferral gets exactly one verdict:

- `still-safe` — premise holds, leave it.
- `now-relevant` — premise weakening; revisit soon.
- `now-risky` — premise broken / ceiling breached; armed landmine.

## 3. Output — triaged ledger

Group by verdict (`now-risky` first, then `now-relevant`, then `still-safe`). One
row per deferral:

`<verdict> · <source: code|spec|plan> · <file>:<line or section> — <what was
deferred>. premise: <the condition it assumed>. now: <what changed, or "holds">.`

For `now-relevant` / `now-risky` rows, add a **promotion suggestion**: the Non-Goal
or shortcut whose premise changed → one line naming the task it should become.

End with: `<N> deferrals: <a> risky, <b> relevant, <c> safe. <u> unmarked.` Nothing
found: `No tracked debt. Clean ledger.`

Reads and reports only. To persist, the user must ask.
