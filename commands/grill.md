---
description: Stress-test a plan, decision, or idea by adversarial interview — grill it until every decision is settled, deferred, or surfaced. Conversational; non-code topics welcome.
argument-hint: '<plan | decision | idea to grill>'
---

Run a grilling session on whatever the user named — a plan, decision, or idea
(non-code topics welcome):
`$ARGUMENTS`

Read `${CLAUDE_PLUGIN_ROOT}/references/grilling.md` and follow it. The whole technique —
its divergence and convergence phases and the residue-manifest exit gate — lives there;
this file only points at it.

This is a conversation, not a tool run: no `.local/` item, no pipeline entry. The session
exits on the reference's residue manifest.

On exit, if buildable work emerged and the user agrees, offer to enter the brainstorming
pipeline carrying the settled decisions — do **not** re-interview there. Standalone
deferred items become backlog items only with the user's explicit nod.
