---
name: brainstorming
description: "Use when starting any creative work — a new feature, component, behavior change, or anything not yet Trivial — and a design has not yet been agreed. Triggers on Standard/Major tasks per HARRY.md §3, before any code."
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
| Standard | **Compressed path**: interview at compressed depth (below) → design (one approach proposal is enough) → close per `references/grilling.md`'s exit gate, unabridged → approve → write the item, always with `### Acceptance criteria`. The `## Why / What` prose sections come only when a real design decision was weighed (alternatives existed); with none weighed, `## Why / What` holds the AC list alone — no decision record. |
| Major | **Full flow** below. |

A red line hit (HARRY.md §2) auto-promotes to Major. **Tier sets the interview's
depth, never its cadence:** both paths ask one question per round, per
`references/grilling.md`, and both close on the reference's exit gate unabridged — the
gate itself is never a "lite" version. **Compressed depth** (Standard) still runs the
interview, just shorter: divergence is brief, since a 2-5-file task's destination is
usually already legible from the request, so skip extensive adversarial probing unless
something looks wrong; convergence covers only the frontier this task's scope actually
raises. **Full depth** (Major) is the complete divergence/convergence in step 2 below.

**`/grill` handoff — nothing settled is asked twice.** If a `/grill` session already ran on this idea, its settled decisions and residue manifest replace the interview (Full Flow step 2 / the compressed path's interview-at-compressed-depth step) — do not re-ask what it settled; proceed from its manifest (per `references/grilling.md`'s Handoff). The loop still applies to what the manifest left open: a design pass here that moves the destination fails the reference's third termination condition, and you go back into the interview for the questions that move raises — those only.

## Full Flow (Major)

Complete these in order:

1. **Explore context** — files, docs, recent commits, existing patterns. If the request is really several independent subsystems, flag it and decompose first; each sub-project gets its own item → execute cycle.
2. **Grill the idea** — run the adversarial interview per `references/grilling.md`. Diverge first (destination pinning, adversarial probing, code cross-examination, live scope labeling), then converge (frontier questions, one per round). Steps 2-4 are a loop, per the reference: a design pass can send you back into the interview, and the loop only exits once the reference's termination conditions hold. Follow the reference's rules; do not re-derive them here. The interview closes at step 5. **Convergence also produces the acceptance criteria** — the settled decisions restated as outcomes (template below); they are approved with the design, not written afterwards.
3. **Propose 2-3 approaches** — with tradeoffs and your recommendation; lead with the recommended one and say why. YAGNI ruthlessly — cut speculative features here.
4. **Present the design** — section by section, scaled to complexity; ask after each whether it holds. Cover architecture, components, data flow, error handling, testing. Break the system into small units each with one clear purpose and a defined interface. Follow the codebase's existing patterns; fix in-scope rough edges in the design, propose no unrelated refactoring.
5. **Get approval** — close the interview per `references/grilling.md`'s exit gate: the residue manifest presented alongside the numbered acceptance criteria. The AC approved here is the contract execution builds and review verdicts are read against, and executing may not change it (`references/doc-types.md`). The manifest's dispositions are *commitments* recorded here but discharged at step 6, because the item file does not exist yet: deferred-in-scope lines land in a `## Follow-ups` section created on the item at step 6; destination-outside lines become new `status: backlog` items (the manifest's approval is the user's nod for each). Revise and re-present until the user approves. Only then proceed.
6. **Write the item** (template below) → `.local/items/<slug>.md` (create it, or promote an existing `status: backlog` item in place — same path, no rename). Fill `## Why / What` including its `### Acceptance criteria`, set `status: active`. Discharge step 5's manifest commitments: create `## Follow-ups` holding the deferred-in-scope lines, and open the committed `status: backlog` items. Gitignored — do NOT commit it. Add one line to `.local/INDEX.md` (topic · path · one-line summary · `active`).
7. **Item self-review** — fix inline (see below).
8. **User reviews the item** — ask, wait, revise if needed.
9. **Premise check, then transition** — before handing off, confirm the base is up to date (rebase/refresh from the base branch) and that the premises the design rests on still hold in that base. AC cannot catch a wrong premise: it is built on them. A premise that moved sends you back to step 4 with the user. Then invoke `executing`. It is the ONLY next skill — there is no plan stage.

The compressed Standard path runs steps 1 → (2 at compressed depth (above) ⇄ present (one approach, step 4)) → residue manifest + AC per `references/grilling.md`'s exit gate, unabridged → approve → step 6, which always writes the item: `### Acceptance criteria` always, the `## Why / What` prose sections **only when a real design decision was weighed** (alternatives existed); with no such decision, `## Why / What` holds the AC list alone. Then steps 7-9 as usual. The ⇄ is the reference's loop running on this path too, not a one-shot pass: a design that surfaces a gap or moves the destination sends you back into the interview, and the close comes only once the reference's three termination conditions hold. The manifest's deferred lines land the same way as the Full Flow's — create `## Follow-ups` on the item when a deferred-in-scope line needs a home; destination-outside lines become `status: backlog` items.

## Decision Aids (opt-in, cost quota)

- **`/debate`** — for a Major or genuinely-contested architecture decision at the "propose approaches" step, you MAY suggest convening `/debate` (3 frontier models, surfaces disagreement). User opts in; reserve it for hard calls.
- **Throwaway prototype** — when a state-model or logic question resists paper
  discussion (the answer needs to be *run*, not argued), offer a minimal throwaway
  prototype: one command to run, no polish, state printed after every action. It
  lives on a throwaway branch — main keeps only the validated decision — and is
  exploration under the HARD-GATE, never grown into the implementation.

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
and finishing carries only `## Follow-ups` forward into new backlog items, as
`references/doc-types.md` sets out). If a Non-Goal is
something you genuinely expect to revisit later, also add it as a line under
`## Follow-ups` (or open a `status: backlog` item now) — otherwise it is
silently lost the moment this item is archived.

### 5. Constraints
Version floors / deps / naming / exact values — binding on the build and every review.

### Acceptance criteria
AC-1 … AC-n. Each is an **outcome**, never a step ("invalid input returns 400",
not "add validate()"), and carries its own verification: a command, a test, or a
named manual check. Numbered, because review verdicts and progress notes
cite AC IDs.

## Progress   <!-- heading only; executing appends the lines -->
```

On the AC-only Standard path the `## Why / What` header stays — the AC list
nests under it; sections 1-5 are what is skipped.

`## Progress` is written here as an empty heading only — its lines are `executing`'s to append. `## Follow-ups`
MAY be created here at step 6 to hold the residue manifest's deferred-in-scope lines;
otherwise it is `executing`'s to add during the build.

## Item Self-Review (fix inline, no re-review)

1. **Placeholders** — any TBD/TODO/vague requirement? Fill it.
2. **Consistency** — do sections contradict? Does the architecture match the features?
3. **Scope** — focused enough for one item, or does it need decomposition?
4. **Ambiguity** — any requirement readable two ways? Pick one, make it explicit.
5. **AC** — is every one an outcome rather than a step, and does each name its check? Does the set cover the design?

## User Review Gate (terminal)

After self-review, ask the user to review the item before proceeding:

> "Item written to `<path>` (gitignored, not committed) — design, residue manifest and acceptance criteria. Review it, and the AC especially: they are the contract I build and review against, and I won't change them on my own. Tell me if you want changes before execution starts."

Wait. On requested changes, revise and re-run self-review. On approval, run step 9's premise check and invoke `executing` — and nothing else.
