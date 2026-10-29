# Debt ledger procedure

The `/debt` procedure. `commands/debt.md` keeps only its shell — frontmatter, title,
and the invocation surface that scopes the scan — and points here for everything
below.

---

`/debt` is not a grep harvester — fresh debt is already in view where it was deferred. It is a **deferred-decision auditor**: it gathers every deliberate "do it later" — plus every still-open backlog item — from across the repo into one overview, then re-judges whether each one is still fresh. One-shot report. Changes nothing.

## 1. Reconcile the sources into one view

Deferrals — and open backlog — hide in four places. Collect all of them — this command is the single overview items alone can't give (items are scattered per-feature).

- **Code markers.** `git grep -nE '(DEBT|TODO|FIXME|HACK):' -- $ARGUMENTS` (drop `-- $ARGUMENTS` when no path given). `DEBT:` is the sanctioned marker from HARRY.md **Code** and carries a ceiling + upgrade path; TODO/FIXME/HACK are unsanctioned debt — flag them as `unmarked` (a violation per HARRY.md **Code**).
- **Item deferrals.** Read the `## Why / What` (its Scope & Non-Goals content) and the `## Progress` section of every `status: active` item under `.local/items/` (`Glob: .local/items/**/*.md`, keep only files whose frontmatter has `status: active`). Each "不做 / 移除 / 丟棄 / 延後 / Non-Goal" bullet in Scope & Non-Goals, and each "do later / 延後 / out of scope / follow-up" line in `## Progress`, is one deferral; a line in either form of the **leave as is** record (`references/doc-types.md` **The item model**) is not — `/debt` reads it from the archive once the item is done. A legacy item that still has a `## Plan` is read there too.
- **Backlog items.** Read every item under `.local/items/` whose frontmatter has `status: backlog` (`Glob: .local/items/**/*.md`, filter by frontmatter). Each item is one entry — unlike item deferrals, nothing here was ever decided (`references/doc-types.md`).
- **Archive records.** Read the `## Progress` section of every item under `.local/archive/` (`Glob: .local/archive/**/*.md`). Each **leave as is** record, in either of its forms (`references/doc-types.md` **The item model**), is one **sweep candidate**: a finding or leftover a finished unit recorded instead of filing. It gets no verdict; it is listed as it stands, except one whose `<where>` names a file that no longer exists, which is dropped and counted as `gone` — any other `<where>` is listed as it stands. A line a sweep item's `## Notes` already quotes — same `where` and gist, in any sweep item, open or archived (`Glob: .local/items/sweep-*.md`, `.local/archive/sweep-*.md`) — is not a candidate again; this covers a sweep unit's own leave-as-is line on a row it held. The archive is read-only (`references/doc-types.md`): nothing here is edited or removed.

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

After the ledger, a `### Sweep candidates` list, one row per archive record, in archive order:

`sweep · archive · <archive file>:<where> — <gist>. reason: <the line's reason>.`

End with: `<N> items: <a> risky/urgent, <b> relevant, <c> safe/open, <d> stale. <u> unmarked. <s> sweep candidates, <g> gone.` Nothing in the ledger: `No tracked debt. Clean ledger.`, and the sweep list still follows when it has rows.

Reads and reports only. To persist, on request: write each `now-risky` / `now-relevant` / `now-urgent` row as a `status: backlog` item under `.local/items/` (title + its `## Notes` entry as `references/doc-types.md` **The item model** sets, quoting the row and its source location), new or merged into a similar one by the "Similar backlog items" bullet of `references/doc-types.md` **Lifecycle rules**, its target named in the row's promotion suggestion, then clear the originating marker/section at its source (delete the `DEBT:`-style comment content, or remove the Non-Goal/deferral bullet from the item) so `status: backlog` stays the single outstanding-work source. `stale` rows persist as a deletion of the named backlog item/file instead. Sweep candidates persist, on request, as **one** `status: backlog` sweep item holding every row — `.local/items/sweep-<YYYY-MM-DD>.md`, titled `Sweep: leave-as-is records up to <date>`, one `## Notes` block per row as `references/doc-types.md` **The item model** sets (`From <archive slug>'s Progress (<date>):` and the row quoted), with one `.local/INDEX.md` line — merged into an open sweep item when one exists, by the "Similar backlog items" bullet of `references/doc-types.md` **Lifecycle rules**; the archive lines stay where they are (read-only); the rows the item quotes are what the next run skips.
