---
name: brainstorming
description: "Use when starting any creative work — a new feature, component, behavior change, or anything not yet Trivial — and a design has not yet been agreed. Triggers on Standard/Major tasks per HARRY.md §3, before any plan or code."
---

# Brainstorming Ideas Into Designs

Turn an idea into an agreed design through collaborative dialogue, then write a spec. This is a procedure governed by the Harry laws (HARRY.md); when they conflict, the laws win.

<HARD-GATE>
No code, no scaffolding, no implementation skill, no implementation action until you have presented a design AND the user has approved it. This governs every task that enters this skill — Standard and Major alike (Trivial never enters, per HARRY.md §3). "Too simple to design" is not an exit from this skill: it is a tier claim, and tier claims are settled by §3, not by feel.
</HARD-GATE>

## Tier-Aware Entry (HARRY.md §3)

Classify the task first, then take the matching path. Do NOT pop a mode-choice prompt.

| Tier | Brainstorming |
|------|---------------|
| Trivial | **Skip** — go straight to the work. |
| Standard | **Compressed 3-step**: understand → design (one approach proposal is enough) → write a spec ONLY when a real design decision was weighed (alternatives existed); otherwise skip the spec and record the decision inline at the top of the plan. |
| Major | **Full flow** below. |

A red line hit (HARRY.md §2) auto-promotes to Major.

## Full Flow (Major)

Complete these in order:

1. **Explore context** — files, docs, recent commits, existing patterns. If the request is really several independent subsystems, flag it and decompose first; each sub-project gets its own item → execute cycle.
2. **Ask clarifying questions** — ONE at a time, its own message. Prefer multiple-choice. Focus on purpose, constraints, success criteria. Break a fat topic into several single questions.
3. **Propose 2-3 approaches** — with tradeoffs and your recommendation; lead with the recommended one and say why. YAGNI ruthlessly — cut speculative features here.
4. **Present the design** — section by section, scaled to complexity; ask after each whether it holds. Cover architecture, components, data flow, error handling, testing. Break the system into small units each with one clear purpose and a defined interface.
5. **Get approval** — revise and re-present until the user approves. Only then proceed.
6. **Write the item** (template below) → `.local/items/<slug>.md` (create it, or promote an existing `status: backlog` item in place — same path, no rename). Fill `## Why / What`, set `status: active`. Gitignored — do NOT commit it. Add one line to `.local/INDEX.md` (topic · path · one-line summary · `active`).
7. **Spec self-review** — fix inline (see below).
8. **User reviews the spec** — ask, wait, revise if needed.
9. **Transition** — invoke `writing-plans`. It is the ONLY next skill.

The compressed Standard path runs steps 1 → (one approach) → present → approve → then step 6 (write the item's `## Why / What`) **only when a real design decision was weighed** (alternatives existed); otherwise skip 6-8 and go straight to step 9 (invoke `writing-plans`), noting the decision inline at the top of the item's `## Plan` section.

## Decision Aids (opt-in, cost quota)

- **`/debate`** — for a Major or genuinely-contested architecture decision at the "propose approaches" step, you MAY suggest convening `/debate` (3 frontier models, surfaces disagreement). User opts in; reserve it for hard calls.
- **Visual Companion** — offer ONLY for genuinely visual questions (UI mockup / wireframe / layout / side-by-side visual comparison). Conceptual UI questions ("what does X mean here?", tradeoff lists, scope choices) stay in the terminal. Not offered upfront — offer just-in-time, as its own message, the first time a question is genuinely clearer shown than told. If none ever arises, never offer it. When the user accepts, follow [visual-companion.md](visual-companion.md): launch with `scripts/start-server.sh --project-dir "$(git rev-parse --show-toplevel)" --open`, then push HTML screens and read back browser selections. Mockups persist in `.local/brainstorm/` (gitignored).

## Item Template (write literally)

```
---
id: <slug>
status: active
milestone: <slug>   <!-- omit the key entirely if standalone -->
---
# <title>

## Why / What
### 1. Context (SCQA)
Situation / Complication / Question / Answer

### 2. Approaches Considered
2-3 approaches + tradeoffs + why chosen.
Doubles as the decision record: Discussion → Decision → considered-but-rejected.

### 3. Design
Architecture / Components / Data flow / Error handling / Testing

### 4. Scope & Non-Goals (YAGNI)
What is deliberately not built.

### 5. Constraints
Version floors / deps / naming / exact values — feeds the plan's Global Constraints.
```

`## Plan` and `## Follow-ups` are added later, by `writing-plans` and
`executing` respectively — do not write them here.

## Item Self-Review (fix inline, no re-review)

1. **Placeholders** — any TBD/TODO/vague requirement? Fill it.
2. **Consistency** — do sections contradict? Does the architecture match the features?
3. **Scope** — focused enough for one plan, or does it need decomposition?
4. **Ambiguity** — any requirement readable two ways? Pick one, make it explicit.

## User Review Gate (terminal)

After self-review, ask the user to review the item before proceeding:

> "Item written to `<path>` (gitignored, not committed). Review it and tell me if you want changes before I write the implementation plan."

Wait. On requested changes, revise and re-run self-review. On approval, invoke `writing-plans` — and nothing else.

## Principles

- One question at a time. Multiple-choice preferred.
- YAGNI ruthlessly — cut features that don't earn their place.
- Always 2-3 approaches with a recommendation before settling (Standard: one is fine).
- Incremental validation — present, approve, then advance.
- Follow existing patterns; fix in-scope rough edges, propose no unrelated refactoring.
