---
name: grill
description: Stress-test a plan, decision, or idea by adversarial interview. Use when the user says "grill me" or wants a plan/decision/idea stress-tested — pinned down question by question until every decision is settled, deferred, or surfaced. Conversational; non-code topics welcome.
---

# Grill

Run a grilling session on whatever the user named — a plan, decision, or idea (non-code
topics welcome).

Read `${CLAUDE_PLUGIN_ROOT}/references/grilling.md` and follow it. The whole technique —
its divergence and convergence phases and the residue-manifest exit gate — lives there;
this file only points at it.

**Codex has no AskUserQuestion:** the reference's convergence phase falls back to its
**numbered text rounds** variant (no structured picker).

This is a conversation, not a tool run: no `.local/` item, no pipeline entry. The session
exits on the reference's residue manifest.

On exit, if buildable work emerged and the user agrees, offer to enter the brainstorming
pipeline carrying the settled decisions — do **not** re-interview there. Standalone
deferred items become backlog items only with the user's explicit nod.
