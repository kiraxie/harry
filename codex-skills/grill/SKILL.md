---
name: grill
description: Stress-test a plan, decision, or idea by adversarial interview. Use when the user says "grill me" or wants a plan/decision/idea stress-tested — pinned down question by question until every decision is settled, deferred, or surfaced. Conversational; non-code topics welcome.
---

# Grill

**Plugin root.** Codex does not set `${CLAUDE_PLUGIN_ROOT}`, so resolve it before
anything else: take the absolute path this `SKILL.md` was loaded from and cut the
trailing `codex-skills/grill/SKILL.md` and the slash before it — what is left is the plugin root, the directory
that holds `codex-skills/`, `dist/` and `references/`. Use that absolute path wherever
`${CLAUDE_PLUGIN_ROOT}` appears below and in the files this skill points you to.

Run a grilling session on whatever the user named — a plan, decision, or idea (non-code
topics welcome).

Read `${CLAUDE_PLUGIN_ROOT}/references/grilling.md` and follow it. The whole technique —
its divergence and convergence phases, the interview/design loop, and the close — lives
there; this file only points at it.
