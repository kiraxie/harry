---
name: debt
description: Re-judge deferred decisions and open backlog items (DEBT markers, spec Non-Goals, plan deferrals, backlog entries) into one triaged ledger with a freshness verdict per row. Use when the user asks to audit tech debt, deferred decisions, backlog items, or find stale shortcuts.
---

# Debt

This is not a grep harvester — plan-first already keeps fresh debt in view. It is a
**deferred-decision auditor**: it gathers every deliberate "do it later" — plus every
still-open backlog item — from across the repo into one overview, then re-judges
whether each one is still fresh. One-shot report. Changes nothing.

The user may scope the scan to specific path(s); default is the whole repo.

## 1. Reconcile the sources into one view

Deferrals — and open backlog — hide in four places. Collect all of them.

- **Code markers.** `git grep -nE '(DEBT|TODO|FIXME|HACK):' -- <path...>` (drop the
  path filter when none given). `DEBT:` is the sanctioned marker from HARRY.md §4
  and carries a ceiling + upgrade path; TODO/FIXME/HACK are unsanctioned debt — flag
  them as `unmarked` (a violation per §4).
- **Spec Non-Goals.** Read the `## 4. Scope & Non-Goals` section of every
  `*-design.md` under `.local/specs/`. Each "不做 / 移除 / 丟棄 / 延後 / Non-Goal"
  bullet is one deferral.
- **Plan deferrals.** Read `*-plan.md` / `*-followup.md` under `.local/plans/` for
  explicit "do later / 延後 / out of scope / follow-up" lines.
- **Backlog items.** Read every `*-backlog.md` under `.local/backlog/`. Each item is
  one entry — unlike the other three sources, nothing here was ever decided
  (HARRY.md §5).

## 2. Freshness verdict — is the landmine now armed, or is the question still open?

For code markers, spec Non-Goals, and plan deferrals, judge whether the original
premise still holds. For backlog items there is no premise — judge instead whether
the item is still open.

### Premise check (code markers / spec Non-Goals / plan deferrals)

- **Referenced symbol/file changed or gone?** Confirm it still exists and check
  recent churn (`git log --oneline -5 -- <file>`). Gone or heavily rewritten →
  premise likely broken.
- **A later spec contradicts an earlier Non-Goal?** Compare by date in the filename.
- **A `DEBT:` ceiling now breached?** Check whether reality crossed the named
  ceiling.

Each gets exactly one verdict:

- `still-safe` — premise holds, leave it.
- `now-relevant` — premise weakening; revisit soon.
- `now-risky` — premise broken / ceiling breached; armed landmine.

### Openness check (backlog items)

- **Already settled elsewhere?** Check newer specs/plans (by filename date) for a
  decision that covers the same ground. Settled → the item should have graduated
  and been deleted; flag it.
- **Context still exists?** If the item names a file/feature/symbol, confirm it's
  still there. Gone → the item is moot.
- **Stakes changed?** Anything land recently (a new spec, an incident, a changed
  constraint) that raises or removes the urgency of deciding this now?

Each gets exactly one verdict:

- `still-open` — nothing changed, still an undecided item worth keeping.
- `now-urgent` — stakes rose; worth deciding soon.
- `stale` — already settled elsewhere, or the context is gone; should be deleted
  from the backlog file.

## 3. Output — triaged ledger

Group by urgency: `now-risky` and `now-urgent` first, then `now-relevant`, then
`still-safe` and `still-open`, then `stale` last (these are ready to delete, not
landmines). One row per deferral or backlog item:

`<verdict> · <source: code|spec|plan|backlog> · <file>:<line or section> — <what
was deferred / still open>. premise: <the condition it assumed, or "n/a
(backlog)">. now: <what changed, or "holds"/"still open">.`

For `now-relevant` / `now-risky` / `now-urgent` rows, add a **promotion
suggestion**: the Non-Goal, shortcut, or backlog item whose situation changed → one
line naming the task/decision it should become. For `stale` rows, add a **prune
suggestion**: name the file/item to delete.

End with: `<N> items: <a> risky/urgent, <b> relevant, <c> safe/open, <d> stale. <u>
unmarked.` Nothing found: `No tracked debt. Clean ledger.`

Reads and reports only. To persist, the user must ask.
