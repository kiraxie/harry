# Skill Authoring — harry's note

For scaffolding, file structure, frontmatter, and packaging, use **Claude Code's official
skill-creator**. Don't re-derive the mechanics here — let the tool generate the skeleton.

What harry keeps is the part the official tooling doesn't cover: the **Superpowers
behavior-shaping methodology**. A skill is not prose, it is code that shapes agent behavior, so
it gets developed and verified like code.

## (a) TDD for skills — no skill without a failing baseline test

Writing a skill IS test-driven development applied to documentation.

> If you didn't watch an agent fail *without* the skill, you don't know if the skill teaches the
> right thing.

The cycle:

- **RED** — run a pressure scenario with a subagent *without* the skill. Document the exact
  choices and the verbatim rationalizations it produces. This is "watch the test fail."
- **GREEN** — write the minimal skill that addresses those specific failures. No content for
  hypothetical cases.
- **REFACTOR** — re-run; when the agent finds a new rationalization, add an explicit counter.
  Repeat until bulletproof.

Iron law: **no skill without a failing test first** — applies to new skills *and* edits.

## (b) Bulletproofing discipline skills

Discipline skills (rules the agent will be tempted to skip under pressure) need to resist
rationalization. Build in:

- **Rationalization table** — every excuse from baseline testing, paired with its rebuttal
  (`"Should work now" → Run the verification.`).
- **Red flags list** — self-check phrases that signal the agent is *about* to violate the rule
  ("just this once", "this is different because…").
- **Letter vs spirit** — state early: *"Violating the letter of the rule is violating the spirit
  of the rule."* This cuts off the whole "I'm following the spirit" class of loophole.
- **Close loopholes explicitly** — don't just say "delete it"; forbid the named workarounds
  ("don't keep it as reference, don't adapt it, don't look at it").

## (c) Match the form to the failure

The form that bulletproofs one failure type backfires on another. Classify the baseline failure
first:

| Baseline failure | Right form | Wrong form |
|---|---|---|
| Skips/violates a rule under pressure (knows better, does it anyway) | Prohibition + rationalization table + red flags | Soft guidance ("prefer…", "consider…") |
| Complies, but output has the wrong shape (bloated, buried verdict, restated spec) | Positive recipe/contract: state what the output IS — its parts, in order | Prohibition list ("don't restate", "never narrate") |
| Omits a required element it already produces | Structural: a REQUIRED field/slot in the template | Prose reminders near the template |
| Behavior should depend on a condition | Conditional keyed to an observable predicate | Unconditional rule + exemption clauses |

**Prohibitions backfire on output-shape problems.** Under a competing incentive, agents
negotiate with "don't X" and produce *more* of the unwanted content — a recipe leaves nothing to
negotiate. Also: no nuance clauses ("don't X unless it matters" reopens the negotiation), and
exemption clauses don't scope ("doesn't apply to code blocks" still suppresses code blocks —
restructure instead).

## (d) SDO — description = WHEN to use, not WHAT it does

The `description` field decides whether an agent loads the skill. It must describe **only the
triggering conditions** ("Use when…"), never summarize the workflow.

> When a description summarizes the workflow, agents follow the description and skip the body. A
> description saying "code review between tasks" caused agents to do ONE review when the skill's
> flowchart specified TWO. Stripping the workflow summary fixed it.

```yaml
# BAD — summarizes workflow, agents follow it instead of reading the skill
description: Use when executing plans - dispatches subagent per task with review between tasks

# GOOD — triggering conditions only
description: Use when executing implementation plans with independent tasks in the current session
```

Write it in third person, lead with "Use when", pack in searchable keywords (error messages,
symptoms, tool names), and name skills verb-first (`condition-based-waiting`, not
`async-test-helpers`).
