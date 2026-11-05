---
description: Look back on the current session for what in the agent's environment slowed or misled it, and propose ranked fixes; the ones you keep become backlog items.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash(git ls-files:*), Bash(git rev-parse:*)
---

A retrospective on the current session. The target is the agent's **environment** — what
it could find, check, read and afford — not the code the session wrote, and not this
session's leftovers or judgement lessons: finishing's leftover check and lessons offer
own those (`skills/finishing/SKILL.md` **Execute the choice**). The output is proposals;
nothing changes until the user keeps one. `references/…` paths below are under
`${CLAUDE_PLUGIN_ROOT}`.

## 1. Source

The source is this session's conversation as it sits in context. Session-log files on
disk are out of bounds. When earlier turns were compacted, the summary is all there is of
them: name that gap in the reply rather than reconstructing those turns.

## 2. Candidates

A candidate cites what happened in this session: a turn or a tool call, located by a
`file:line` where it has one. A `file:line` alone, with nothing in the session behind it,
is not evidence. The one exception is under **Automated checks**.

- **Navigation.** A file or fact took several searches or reads to find, or a hidden
  link between files (a registration, a generated file, a convention) was found late.
  Propose the pointer, or the link made visible, that would have led there in one step.
- **Automated checks.** A mistake a check could have caught. First read what the repo
  already runs — its manifest's scripts (`package.json`, `Makefile`, `pyproject.toml`,
  …), its CI workflows, its pre-commit config — so a check that exists but is unwired or
  broken is the finding, not a new one. A mechanical violation, as the "Lesson or check"
  bullet of `references/review-rubric.md` **Engineering judgment** sorts it, gets the check
  the repo's existing tooling makes cheapest. The
  exception to the evidence rule: a repo with no guardrail at all — no pre-commit hook
  and no CI job that runs its lint, typecheck or test command — is a candidate on every
  run, its evidence the files you looked in.
- **Steering size.** A steering rule the session broke or overlooked because it sat
  buried among others, or a steering line the session spent effort on that belongs in a
  check, an on-demand reference, or the reviewer's standard rather than in context every
  turn.
- **No-ops.** A steering line the session quoted or acted on that asked nothing the agent
  would not have done by default.
- **Tool economy.** A tool call whose cost — output size, run time, repetition — a
  narrower call or a better tool would have cut.
- **Information access.** The session needed information it could not reach (logs, a
  service's state, a dashboard) and paid for it in guesses or in round trips to the user.
  Propose the read-only access that would have closed the gap.

The steering files for **Steering size** and **No-ops** are the ones the user edits: the
repo's `CLAUDE.md`, `AGENTS.md` and `CLAUDE.local.md`, and the user's global `CLAUDE.md`
with its `# >>> harry >>>` … `# <<< harry <<<` block cut out. That block and the
`HARRY.md` it imports are harry's, shipped by `/harry:sync`, and take no candidate.

A repo-specific rule the user stated or corrected this session that the "Lesson or check"
bullet of `references/review-rubric.md` **Engineering judgment** sorts as a judgement
lesson is finishing's lessons offer's, not this list's.

## 3. Severity

- **high** — it produced a wrong result, or the user had to correct the agent.
- **medium** — it cost several turns or tool calls, or a single expensive one (long run time or large output). A repo with no guardrail is medium.
- **low** — friction that cost little.

## 4. Present

One numbered list, high first, each line: severity, category, evidence, and the proposed
change in one sentence — what file or tool changes, and how. Quote tool output only with
secrets masked (HARRY.md **Secrets**). Below the list, name each source you could not
read: compacted turns, a steering file that would not open; then each judgement lesson
step 2 left to finishing's lessons offer, as left there — it takes no keep-or-drop ruling
and nothing is filed for it. No candidate: say once that the review ran and found none,
and name the unread sources and any such lesson the same way.

Before naming targets, resolve the store by the formula in `references/doc-types.md`
**Naming & location** and read its `.local/items/`; no `.local/` there means every
target is a new item. A candidate already held, by the "Already recorded" bullet of
`references/doc-types.md` **Lifecycle rules**, is listed as "already recorded in
`<slug>`" and takes no ruling. A candidate whose change lands outside the repo's working
tree, by the "Work outside the working tree has no repo store" bullet of
`references/doc-types.md` **Naming & location**, has the target "yours to apply". For
each other line, name its target by the "Similar backlog items" bullet of
`references/doc-types.md` **Lifecycle rules** — "merge into `<slug>`" or "new item
`<slug>`" — then ask the user to keep or drop each.

## 5. File what is kept

A kept "yours to apply" candidate is filed nowhere: reply with the exact change — the
file, and the lines to add, change or remove. When a kept candidate has a store target,
write into the store step 4 resolved; no `.local/` there → the check in
`references/doc-types.md` **Naming & location** runs and nothing is filed until the user
settles it. A kept candidate is filed as a `status: backlog` item at the target the user
confirmed, a new one with one `.local/INDEX.md` line, by the "Similar backlog items"
bullet of `references/doc-types.md` **Lifecycle rules**, its `## Notes` entry as
`references/doc-types.md` **The item model** sets. A dropped one leaves no record. Reply
with the paths written, or that nothing was kept.
