---
name: brainstorming
description: "Use when starting any creative work — a new feature, component, behavior change, or anything not yet Trivial — and a design has not yet been agreed. Triggers on Standard/Major tasks per HARRY.md §3, before any plan or code."
---

# Brainstorming Ideas Into Designs

Turn an idea into an agreed design through collaborative dialogue, then write it into an item. This is a procedure governed by the Harry laws (HARRY.md); when they conflict, the laws win.

<HARD-GATE>
No code, no scaffolding, no implementation skill, no implementation action until you have presented a design AND the user has approved it. This governs every task that enters this skill — Standard and Major alike (Trivial never enters, per HARRY.md §3). "Too simple to design" is not an exit from this skill: it is a tier claim, and tier claims are settled by §3, not by feel.
</HARD-GATE>

## Tier-Aware Entry (HARRY.md §3)

Classify the task first, then take the matching path. Do NOT pop a mode-choice prompt.

| Tier | Brainstorming |
|------|---------------|
| Trivial | **Skip** — go straight to the work. |
| Standard | **Compressed path**: understand → design (one approach proposal is enough) → lite residue manifest → approve → write the item's `## Why / What` ONLY when a real design decision was weighed (alternatives existed); otherwise skip it and record the decision inline at the top of the item's `## Plan`. |
| Major | **Full flow** below. |

A red line hit (HARRY.md §2) auto-promotes to Major.

**`/grill` handoff — no re-interview.** If a `/grill` session already ran on this idea, its settled decisions and residue manifest replace the interview (Full Flow steps 1-2 / the compressed path's understand step) — do not re-ask what it settled; proceed from its manifest (per `references/grilling.md`'s Handoff).

## Full Flow (Major)

Complete these in order:

1. **Explore context** — files, docs, recent commits, existing patterns. If the request is really several independent subsystems, flag it and decompose first; each sub-project gets its own item → execute cycle.
2. **Grill the idea** — run the adversarial interview per `references/grilling.md`. Diverge first (destination pinning, adversarial probing, code cross-examination, live scope labeling), then converge (AskUserQuestion frontier rounds). Follow the reference's rules; do not re-derive them here. The interview closes on the residue manifest at step 5.
3. **Propose 2-3 approaches** — with tradeoffs and your recommendation; lead with the recommended one and say why. YAGNI ruthlessly — cut speculative features here.
4. **Present the design** — section by section, scaled to complexity; ask after each whether it holds. Cover architecture, components, data flow, error handling, testing. Break the system into small units each with one clear purpose and a defined interface. Follow the codebase's existing patterns; fix in-scope rough edges in the design, propose no unrelated refactoring.
5. **Get approval** — first present the residue manifest per `references/grilling.md`'s exit gate: resolved decisions, raised-but-deferred (each with a disposition), silent assumptions. What the user approves is **design + manifest**. The manifest's dispositions are *commitments* recorded here but discharged at step 6, because the item file does not exist yet: deferred-in-scope lines land in a `## Follow-ups` section created on the item at step 6; destination-outside lines become new `status: backlog` items (the manifest approval is the user's nod for each). Revise and re-present until the user approves. Only then proceed.
6. **Write the item** (template below) → `.local/items/<slug>.md` (create it, or promote an existing `status: backlog` item in place — same path, no rename). Fill `## Why / What`, set `status: active`. Discharge step 5's manifest commitments: create `## Follow-ups` holding the deferred-in-scope lines, and open the committed `status: backlog` items. Gitignored — do NOT commit it. Add one line to `.local/INDEX.md` (topic · path · one-line summary · `active`).
7. **Item self-review** — fix inline (see below).
8. **User reviews the item** — ask, wait, revise if needed.
9. **Transition** — invoke `writing-plans`. It is the ONLY next skill.

The compressed Standard path runs steps 1 → (one approach) → present → **lite residue manifest** (one message — the exit gate's three parts, compressed; per `references/grilling.md`) → approve → then step 6 (write the item's `## Why / What`) **only when a real design decision was weighed** (alternatives existed); otherwise skip 6-8 and go straight to step 9 (invoke `writing-plans`), noting the decision inline at the top of the item's `## Plan` section. The lite manifest's deferred lines land the same way as the Full Flow's — the Standard path already writes a Plan-bearing item, so create `## Follow-ups` on it when a deferred-in-scope line needs a home; destination-outside lines become `status: backlog` items. On the no-decision sub-path (item not yet written), a deferred-in-scope line forces the item into existence now — create it with a `## Follow-ups` section holding the line, add its `.local/INDEX.md` `## Items` line, and let `writing-plans` fill `## Plan` in place as usual; residue never waits for `writing-plans`.

## Decision Aids (opt-in, cost quota)

- **`/debate`** — for a Major or genuinely-contested architecture decision at the "propose approaches" step, you MAY suggest convening `/debate` (3 frontier models, surfaces disagreement). User opts in; reserve it for hard calls.
- **Visual Companion** — offer ONLY for genuinely visual questions (UI mockup / wireframe / layout / side-by-side visual comparison). Conceptual UI questions ("what does X mean here?", tradeoff lists, scope choices) stay in the terminal. Not offered upfront — offer just-in-time, as its own message, the first time a question is genuinely clearer shown than told. If none ever arises, never offer it. When the user accepts, follow [visual-companion.md](visual-companion.md): launch with `scripts/start-server.sh --project-dir "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" --open` (the common-dir parent, NOT --show-toplevel: mockups belong in the MAIN checkout's `.local/`, never a worktree's — HARRY.md §5), then push HTML screens and read back browser selections. Mockups persist in `.local/brainstorm/` (gitignored).
- **Throwaway prototype** — when a state-model or logic question resists paper
  discussion (the answer needs to be *run*, not argued), offer a minimal throwaway
  prototype: one command to run, no polish, state printed after every action. It
  lives on a throwaway branch — main keeps only the validated decision — and is
  exploration under the HARD-GATE, never grown into the implementation. Genuinely
  visual questions stay with the Visual Companion.

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
What is deliberately not built. A Non-Goal is a scope boundary, not a to-do —
it does not survive archiving (`/debt` only re-checks `status: active` items,
and finishing's flush only carries `## Follow-ups`). If a Non-Goal is
something you genuinely expect to revisit later, also add it as a line under
`## Follow-ups` (or open a `status: backlog` item now) — otherwise it is
silently lost the moment this item is archived.

### 5. Constraints
Version floors / deps / naming / exact values — feeds the plan's Global Constraints.
```

`## Plan` is added later by `writing-plans` — do not write it here. `## Follow-ups`
MAY be created here at step 6 to hold the residue manifest's deferred-in-scope lines;
otherwise it is `executing`'s to add during the build.

## Item Self-Review (fix inline, no re-review)

1. **Placeholders** — any TBD/TODO/vague requirement? Fill it.
2. **Consistency** — do sections contradict? Does the architecture match the features?
3. **Scope** — focused enough for one plan, or does it need decomposition?
4. **Ambiguity** — any requirement readable two ways? Pick one, make it explicit.

## User Review Gate (terminal)

After self-review, ask the user to review the item before proceeding:

> "Item written to `<path>` (gitignored, not committed). Review it and tell me if you want changes before I write the implementation plan."

Wait. On requested changes, revise and re-run self-review. On approval, invoke `writing-plans` — and nothing else.
