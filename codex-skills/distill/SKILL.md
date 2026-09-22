---
name: distill
description: Evaluate an external repo as a distillation candidate for harry. Use when the user says "distill", names a repo to evaluate/compare against harry, or asks which of a repo's principles are worth absorbing — clone it, survey it against harry's laws and deviation record, rule pull/adapt/skip on each candidate, and record the outcome in upstream tracking.
---

# Distill

**Plugin root.** Codex does not set `${CLAUDE_PLUGIN_ROOT}`, so resolve it before
anything else: take the absolute path this `SKILL.md` was loaded from and cut the
trailing `codex-skills/distill/SKILL.md` and the slash before it — what is left is the plugin root, the directory
that holds `codex-skills/`, `dist/` and `references/`. Use that absolute path wherever
`${CLAUDE_PLUGIN_ROOT}` appears below and in the files this skill points you to.

Run a distill session on the repo the user named.

Read `${CLAUDE_PLUGIN_ROOT}/references/distilling.md` and follow it. The whole
procedure — onboard-vs-resync routing, the deviation-record-first rule, the ruling
framework, and the by-outcome bookkeeping — lives there; this file only points at it.

**Codex has no AskUserQuestion:** the reference's backlog-item confirmation (step 8)
happens in plain text — list the accepted candidates and ask which to keep.
