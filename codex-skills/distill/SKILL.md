---
name: distill
description: Evaluate an external repo as a distillation candidate for harry. Use when the user says "distill", names a repo to evaluate/compare against harry, or asks which of a repo's principles are worth absorbing — clone it, survey it against harry's laws and deviation record, rule pull/adapt/skip on each candidate, and record the outcome in upstream tracking.
---

# Distill

Run a distill session on the repo the user named.

Read `${CLAUDE_PLUGIN_ROOT}/references/distilling.md` and follow it. The whole
procedure — onboard-vs-resync routing, the deviation-record-first rule, the ruling
framework, and the by-outcome bookkeeping — lives there; this file only points at it.

**Codex has no AskUserQuestion:** the reference's backlog-item confirmation (step 8)
happens in plain text — list the accepted candidates and ask which to keep.

The session is read-only for harry's laws and skills: its outputs are the ruling
report, upstream-tracking bookkeeping, and user-confirmed backlog items. Adopted
candidates become pipeline work later, never inline edits now.
