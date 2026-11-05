---
description: Use when the user asks what to work on next or what is left to pick up, to pick the next item or unit, or to start, kick off or check whether a named item is ready or blocked. Not for re-judging deferred work or the backlog's freshness (that is /harry:debt), nor for the status of a PR, branch or CI run.
argument-hint: '[item slug]'
allowed-tools: Read, Glob, Grep, Bash(git worktree list:*), Bash(git rev-parse:*), ListAgents
---

Pick the next work unit from this repo's item store, or brief the one the user named:
`$ARGUMENTS`

This command writes nothing at any step: no item, no `.local/INDEX.md` line, no branch.
Starting the unit is the pipeline's job once the user chooses.

## Gather

1. **Store.** Resolve the store by the formula in `references/doc-types.md`
   **Naming & location**, running its `git rev-parse` part on its own and deriving the
   store from that output as the rule says. Run `git worktree list` first: a line marked
   `(bare)` means a bare-repo hub, where that rule has you confirm the store with the
   user — ask before reading anything. Read every store file below by its absolute path.
   No `.local/` there → say the repo has no item store yet: the first item's brainstorming
   creates it, once `/harry:sync` has added harry's `.gitignore` block; stop. `.local/`
   there but no `.local/INDEX.md` → say nothing is indexed yet, name any `.local/items/`
   files as unindexed, and stop.
2. **Tracker supplement.** When the project rules in context (`CLAUDE.local.md`, a
   `CLAUDE.md`) hold a line `/harry:next supplement: <path>`, read that file before
   step 3. An absolute path is used as is, `~` is the home directory (expand it before
   reading), and any other path is relative to the file holding the line. It may change
   the candidate source and order, the table's row unit and columns, filter or mark
   candidates, map a tracker key to an item or brief a key that has no item file, and add
   live status, slug-mode situations, briefing fields and reminder lines. Within those
   extension points its rules take precedence; every other rule in this file stands. Four
   invariants it never changes: an in-flight unit is never recommended; nothing is
   written, tracker writes included; one question per message (HARRY.md **Talk**); a
   briefing ends with the tier. A supplement line outside the extension points or
   breaking an invariant is not followed, and an unreadable supplement leaves the
   defaults in place; the output names each once, in its notices.
3. **Index.** Read the whole of `.local/INDEX.md`. Its lines are told apart by shape,
   under any heading or none: an item line has the shape `references/doc-types.md`
   **Global index `.local/INDEX.md`** sets; an in-flight line has the shape
   `references/doc-types.md` **`## In flight`** sets, and is never a candidate. Also read
   `## Roadmap` when it exists.
4. **In-flight evidence.** A unit is in flight when any of these names it: an in-flight
   line; a worktree or checked-out branch in `git worktree list`; a peer
   Claude Code session in `ListAgents` working on it. ListAgents unavailable → skip that
   source and say so in the in-flight line of the output.

## No argument — pick

By default, candidates are every item line with status `backlog`; every item line with
status `active` whose file has no `type:` frontmatter key and holds
`### Acceptance criteria` or a legacy `## Plan` (a milestone itself and a state note are
not candidates); and each member still listed under an open milestone's `## Members` (an
item whose frontmatter has `type: milestone`). Remove every unit in flight; list each
candidate once. Order them as `## Roadmap` names them first, then in index file order.
Read each candidate's item file: when its `## Notes` says it waits on something (a
release, another item, a date, an outside answer), it is 🔒 with that wait in a few words.

Output, these parts in this order and nothing else:

1. Notices: each supplement reminder line, then each supplement line not followed or an
   unreadable supplement — none of these → nothing.
2. One line naming what is in flight now, each unit with its branch, marked as running —
   never offered as a pick. None → `In flight: none`.
3. One table of the candidates. By default one row per candidate: `#`, slug, one-line
   summary from its index line, and
   `▶` (movable), `▶ approved` (an `active` item: its acceptance criteria are approved,
   ready to execute) or `🔒 <wait>`, plus a live-status column when a supplement gives one.
   No candidate → say the backlog is empty instead.
4. One question: which number to start, or a slug to brief. A number the user picks is
   briefed as the slug mode below does before anything starts.

## With a slug — brief

Open with the same notices as the pick output, on every path below, NOT FOUND included.

Find the item: the supplement's key mapping first, when it has one, then
`.local/items/<slug>.md`, else `.local/archive/<slug>.md`. A key the supplement briefs
without an item file is briefed with `Item file: none`. Nothing found → **NOT FOUND**:
list the nearest item-line slugs, ask which one was meant, and stop with no briefing.
Otherwise check every situation below and list each one that matches, not only the
first:

- **ALREADY IN FLIGHT** — an in-flight source names it. Say which source, and send the
  user back to that session or branch; for a peer session ListAgents found, offer to
  message it, and send only on the user's yes. Never start a second one.
- **MILESTONE** — it is `type: milestone` with open `## Members`. List the members; the
  pick is a member, not the milestone.
- **BLOCKED** — its `## Notes` names a wait. Quote the wait; the ask is whether to start
  anyway.
- **DONE** — it is in `.local/archive/`; the ask is whether the slug is the one meant.
- **CLEAR TO START** — none of the above matched.

List the matched situations before the briefing, then their asks folded into one
question. Then the briefing, these fields in this order, each one line or a short list,
`none` when empty:

```text
Status:            <situations matched; the live status when a supplement gives one>
Situation:         <what the item is and why it exists, from its title and Notes or Why / What>
Blocked by:        <the wait, or none>
Prior decisions:   <from the item's Notes and Why / What, and from memory that names it>
Item file:         <absolute path>
Other CC session:  <a peer session on it, none, or not checked without ListAgents>
<each supplement briefing field>
Tier:              <tier by HARRY.md **Tiers**, with the trigger that set it>
```

End on the tier. When the user starts a CLEAR TO START unit, hand it to the brainstorming
skill; an item that already holds approved acceptance criteria goes to the executing
skill instead.
