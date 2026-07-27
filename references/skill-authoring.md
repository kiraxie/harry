# Skill Authoring — harry's note

For scaffolding, file structure, frontmatter, packaging, and description-optimization tooling,
use **Claude Code's official skill-creator**. Don't re-derive the mechanics here — let the tool
generate the skeleton.

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
  Repeat until bulletproof. A counter must generalize beyond the pressure scenario that
  produced it — if only the triggering example improves, the fix is overfit; switch metaphor
  or framework instead of stacking rules.

Iron law: **no skill without a failing test first** — applies to new skills *and* edits.

## (b) Bulletproofing discipline skills

Discipline skills (rules the agent will be tempted to skip under pressure) need to resist
rationalization. Build in:

- **Rationalization table** — every excuse from baseline testing, paired with its rebuttal
  (`"Should work now" → Run the verification.`). A row carries the full argument, not just
  the excuse's label — label-compressed rows measurably weaken behavior under pressure
  (upstream eval, n=10, two harnesses).
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

Within WHEN-only, **widen deliberately**: agents undertrigger far more than they overtrigger,
so enumerate the triggering contexts — including ones that don't name the skill — and add
near-miss exclusions ("not for X — use Y") so the widened net doesn't catch neighbors. Then
**test the description like you test the skill**: realistic, noisy should-trigger and
should-not-trigger queries. A negative sharing no surface with the skill ("write fibonacci"
against a PDF skill) tests nothing — negatives must be near-misses. A simple one-step task
won't load a skill however good the description, so don't spend eval budget there.

## (e) Editorial vocabulary — how the prose is written

Sections (a)–(d) verify a skill like code; this axis governs how its text is *written*. Both
serve one end — **predictability**, the agent taking the same process every run. Sharpen the
words *after* the baseline test is green, not instead of it.

- **Invocation is a cost choice, not a default.** A model-invoked skill spends **context load** —
  its description sits in the window every turn so the agent (or another skill) can reach it on
  its own. A user-invoked skill (`disable-model-invocation: true`) spends **cognitive load**
  instead: zero context, but *you* are the index that must remember it exists. Pick
  model-invocation only when the agent or another skill must reach it autonomously; if it only
  ever fires by hand, pay no context load. (Complements (d): that governs *what* a model-facing
  description says; this governs *whether* to have one.)
- **Leading words.** A compact concept already in the model's pretraining (*tight*, *relentless*,
  *fog of war*, *tracer bullets*) anchors a whole region of behaviour in a few tokens by
  recruiting priors the model already holds. Hunt restatements that collapse into one:
  "fast, deterministic, low-overhead" → a *tight* loop. You win twice — fewer tokens *and* a
  sharper hook. Assume every skill carries restatements a leading word would retire.
- **The no-op test.** Sentence by sentence: does this line change behaviour versus the default? A
  weak leading word (*be thorough*, when the agent is already thorough-ish) is a no-op — you pay
  load to say nothing. Fix it with a stronger word (*relentless*), not more prose; when a sentence
  fails the test, delete the whole sentence rather than trim words from it.
- **Negation names the elephant.** *Don't think of an elephant* makes it more available, not less —
  steering by prohibition backfires. Prompt the **positive**: state the target behaviour so the
  banned one is never spoken. Keep a prohibition only as a hard guardrail you can't phrase
  positively, and even then pair it with what to do instead. (This is the general form of (c)'s
  "prohibitions backfire on output-shape problems.")
- **Explain the why — capability skills.** A capability skill earns generalization by saying
  why each instruction matters: the model extends reasons to cases the text never named, so an
  unexplained all-caps MUST is a smell there. Discipline skills are the deliberate exception —
  (b)/(c) hold because their failure is knowing better and doing it anyway, where
  pressure-tested prohibition forms outperform explanation.
- **Point-of-use placement.** A principle restated in a recap section (Key Principles /
  Remember / The Bottom Line) is sediment in section form — delete the section, moving any
  sole-carrier line to the step where it acts. Guard sections (Common Mistakes / Red Flags)
  that restate the procedure fold into the single rationalization table; a guard earns
  separate existence only by carrying content the steps don't.
- **Failure modes to name when a skill misbehaves.** *Premature completion* — a step ends before
  it's done, attention slipping to being-done; sharpen the completion criterion first (cheap,
  local), and split to hide later steps only if it stays fuzzy. *Sediment* — stale layers that
  accrete because adding feels safe and removing feels risky, the default fate of any skill
  without a pruning discipline. *Sprawl* — simply too long even when every line is live; cure with
  **progressive disclosure**, pushing branch-specific reference behind context pointers so each
  path carries only what it needs. *Reinvented helpers* — successive runs each rewrite the same
  helper script from scratch; that repetition IS the signal to bundle it once under the skill's
  `scripts/` and point the body at it, so no future invocation reinvents it.
