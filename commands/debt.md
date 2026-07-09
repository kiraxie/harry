---
description: Re-judge deferred decisions and open backlog items (DEBT: markers, item deferrals, backlog entries) into one triaged ledger with a freshness verdict per row.
argument-hint: '[path...]'
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git grep:*)
---

`/debt` is not a grep harvester — plan-first already keeps fresh debt in view. It is a **deferred-decision auditor**: it gathers every deliberate "do it later" — plus every still-open backlog item — from across the repo into one overview, then re-judges whether each one is still fresh. One-shot report. Changes nothing.

Optional `$ARGUMENTS` scopes the scan to the given path(s); default is the whole repo.

## 1. Reconcile the sources into one view

Deferrals — and open backlog — hide in two places. Collect both — this command is the single overview items alone can't give (items are scattered per-feature).

- **Code markers.** `git grep -nE '(DEBT|TODO|FIXME|HACK):' -- $ARGUMENTS` (drop `-- $ARGUMENTS` when no path given). `DEBT:` is the sanctioned marker from HARRY.md §4 and carries a ceiling + upgrade path; TODO/FIXME/HACK are unsanctioned debt — flag them as `unmarked` (a violation per §4).
- **Item deferrals.** Read the `## Why / What` → `### 4. Scope & Non-Goals` subsection and the `## Plan` section of every `status: active` item under `.local/items/` (`Glob: .local/items/**/*.md`, keep only files whose frontmatter has `status: active`). Each "不做 / 移除 / 丟棄 / 延後 / Non-Goal" bullet in Scope & Non-Goals, and each "do later / 延後 / out of scope / follow-up" line in Plan, is one deferral.
- **Backlog items.** Read every item under `.local/items/` whose frontmatter has `status: backlog` (`Glob: .local/items/**/*.md`, filter by frontmatter). Each item is one entry — unlike item deferrals, nothing here was ever decided (HARRY.md §5).

## 2. Freshness verdict — is the landmine now armed, or is the question still open?

For code markers and item deferrals, judge whether the original premise still holds. For backlog items, there is no premise — judge instead whether the item is still open. Use the cheap checks below, then light judgment. This is the part grep can't do.

### Premise check (code markers / item deferrals)

- **Referenced symbol/file changed or gone?** If a marker or Non-Goal names a symbol or path, confirm it still exists (`Glob`/`Grep`) and check recent churn (`git log --oneline -5 -- <file>`). Gone or heavily rewritten → premise likely broken.
- **A later item contradicts an earlier Non-Goal?** Items carry no date in the filename (`references/doc-types.md`) — compare by last-touched date instead: `git log -1 --format=%ad --date=short -- <file>` per candidate, or check `.local/HISTORY.md` for a more recently completed item covering the same ground. A thing deferred in an older item but required by a newer one is now in scope.
- **A `DEBT:` ceiling now breached?** Read the named ceiling (e.g. "O(n^2), swap if N > a few thousand") and check whether reality crossed it — call sites multiplied, data grew, the cheap path is now hot.

Each gets exactly one verdict:

- `still-safe` — premise holds, leave it.
- `now-relevant` — premise weakening; revisit soon.
- `now-risky` — premise broken / ceiling breached; armed landmine.

### Openness check (backlog items)

- **Already settled elsewhere?** Check other items for a decision that covers the same ground — no date in the filename, so compare by last-touched date (`git log -1 --format=%ad --date=short -- <file>`) or check `.local/HISTORY.md`/`.local/archive/` for a more recently completed item. Settled → the item should have graduated and been deleted; flag it.
- **Context still exists?** If the item names a file/feature/symbol, confirm it's still there. Gone → the item is moot.
- **Stakes changed?** Anything land recently (a new spec, an incident, a changed constraint) that raises or removes the urgency of deciding this now?

Each gets exactly one verdict:

- `still-open` — nothing changed, still an undecided item worth keeping.
- `now-urgent` — stakes rose; worth deciding soon.
- `stale` — already settled elsewhere, or the context is gone; should be deleted from the backlog file.

## 3. Output — triaged ledger

Group by urgency: `now-risky` and `now-urgent` first, then `now-relevant`, then `still-safe` and `still-open`, then `stale` last (these are ready to delete, not landmines). One row per deferral or backlog item:

`<verdict> · <source: code|item|backlog> · <file>:<line or section> — <what was deferred / still open>. premise: <the condition it assumed, or "n/a (backlog)">. now: <what changed, or "holds"/"still open">.`

For `now-relevant` / `now-risky` / `now-urgent` rows, add a **promotion suggestion**: the Non-Goal, shortcut, or backlog item whose situation changed → one line naming the task/decision it should become. For `stale` rows, add a **prune suggestion**: name the file/item to delete.

End with: `<N> items: <a> risky/urgent, <b> relevant, <c> safe/open, <d> stale. <u> unmarked.` Nothing found: `No tracked debt. Clean ledger.`

Reads and reports only. To persist, on request: write each `now-risky` / `now-relevant` / `now-urgent` row as a new `status: backlog` item under `.local/items/` (title + a `## Notes` line quoting the row and its source location), then clear the originating marker/section at its source (delete the `DEBT:`-style comment content, or remove the Non-Goal/deferral bullet from the item) so `status: backlog` stays the single outstanding-work source. `stale` rows persist as a deletion of the named backlog item/file instead.
