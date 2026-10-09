---
name: brainstorming
description: "Use when starting any creative work — a new feature, component, behavior change, or anything not yet Trivial — and a design has not yet been agreed. Triggers on Standard/Major tasks per HARRY.md **Tiers**, before any code."
---

# Brainstorming Ideas Into Designs

Turn an idea into an agreed design through collaborative dialogue, then write it into an item. This is a procedure governed by the Harry laws (HARRY.md); when they conflict, the laws win.

**Gate.** Present a design and get the user's approval before any implementation — code, scaffolding, or the executing skill. Every task that enters this skill is Standard or Major (Trivial never enters, per HARRY.md **Tiers**), so the gate holds however simple the task looks; tier is settled by HARRY.md **Tiers**.

## Entry: tier, then depth

Classify the tier first (HARRY.md **Tiers**); a red line hit auto-promotes to
Major. A Trivial task skips this skill and goes straight to the work. Every other task
takes the path its brainstorm depth names:

| Depth | Path |
|-------|------|
| Compressed | **Compressed path** — the exact sequence, and what the item holds, are spelled out in the paragraph after the Full Flow steps below. |
| Full | **Full Flow** below. |

Which depth a task takes, what each one holds (the approach count included), and what
runs at every depth: See **Brainstorm depth** in `references/tier-gates.md`. **Tier and
task set the interview's depth, never its cadence:** both paths ask one question per
round, per `references/grilling.md`, and both close on the reference's exit gate
unabridged — the gate itself is never a "lite" version.

**`/grill` handoff — nothing settled is asked twice without cause.** If a `/grill` session already ran on this idea, its settled decisions and residue manifest replace the interview (Full Flow step 2 / the compressed path's interview-at-compressed-depth step) — do not re-ask what it settled; proceed from its manifest (per `references/grilling.md`'s Handoff). The loop still applies to what the manifest left open: a design pass here that moves the destination fails the reference's third termination condition, and you go back into the interview for the questions that move raises, plus any settled decision a re-walk reopens with its cause (per the reference's Re-walk).

## Full Flow (full depth)

Complete these in order:

1. **Explore context** — files, docs, recent commits, existing patterns. If the request is really several independent subsystems, flag it and decompose first; each sub-project gets its own item → execute cycle.
2. **Grill the idea** — run the adversarial interview per `references/grilling.md`. Diverge first (destination pinning, adversarial probing, code cross-examination, live scope labeling), then converge (frontier questions, one per round). Steps 2-4 are a loop, per the reference: a design pass can send you back into the interview, and the loop only exits once the reference's termination conditions hold. Follow the reference's rules; do not re-derive them here. The interview closes at step 5. **Convergence also produces the acceptance criteria** — the settled decisions restated as outcomes (template below); they are approved with the design, not written afterwards.
3. **Propose approaches** — as many as your depth sets (`references/tier-gates.md`), with tradeoffs and your recommendation; lead with the recommended one and say why. YAGNI ruthlessly — cut speculative features here.
4. **Present the design** — section by section, scaled to complexity; ask after each whether it holds. Cover architecture, components, data flow, error handling, testing. Break the system into small units each with one clear purpose and a defined interface, cut and tested as the reviews will judge them: `references/architecture-review.md` category 4 for module shape. See **Seams and what sits behind them** in `references/red-green.md` for seams and how to test across them. Follow the codebase's existing patterns; fix in-scope rough edges in the design, propose no unrelated refactoring.
5. **Get approval** — close the interview per `references/grilling.md`'s exit gate: the residue manifest presented alongside the numbered acceptance criteria. The AC approved here is the contract execution builds and review verdicts are read against, and executing may not change it (`references/doc-types.md`). The manifest's dispositions are *commitments* recorded here but discharged at step 6, because the item file does not exist yet: deferred-in-scope lines land in a `## Follow-ups` section created on the item at step 6; destination-outside lines become new `status: backlog` items (the manifest's approval is the user's nod for each). Revise and re-present until the user approves. Only then proceed.
6. **Write the item** (template below). Read `references/doc-types.md` **Naming & location** first: resolve the store inside the command that writes the item and the INDEX line, and run its no-`.local/` check. → `.local/items/<slug>.md` (create it, or promote an existing `status: backlog` item in place — same path, no rename). Fill `## Why / What` including its `### Acceptance criteria`, set `status: active`. Discharge step 5's manifest commitments: create `## Follow-ups` holding the deferred-in-scope lines, and open the committed `status: backlog` items. Gitignored — do NOT commit it. Add one line to `.local/INDEX.md` (topic · path · one-line summary · `active`).
7. **Item self-review** — fix inline (see below).
8. **User reviews the item** — ask, wait, revise if needed.
9. **Premise check, then transition** — before handing off, confirm the base is up to date (rebase/refresh from the base branch) and that the premises the design rests on still hold in that base. AC cannot catch a wrong premise: it is built on them. A premise that moved sends you back to step 4 with the user. Then invoke `executing`.

The compressed path runs steps 1 → (2 at compressed depth ⇄ steps 3-4, propose and present) → residue manifest + AC per `references/grilling.md`'s exit gate, unabridged → approve → step 6, which always writes the item: `### Acceptance criteria` always, the `## Why / What` prose sections **only when a real design decision was weighed** (alternatives existed); with no such decision, `## Why / What` holds the AC list alone. Then steps 7-9 as usual. The ⇄ is the reference's loop running on this path too, not a one-shot pass: a design that surfaces a gap or moves the destination sends you back into the interview, and the close comes only once the reference's three termination conditions hold. The manifest's deferred lines land the same way as the Full Flow's — create `## Follow-ups` on the item when a deferred-in-scope line needs a home; destination-outside lines become `status: backlog` items.

## Decision Aids (opt-in, cost quota)

- **`/debate`** — for a Major or genuinely-contested architecture decision at the "propose approaches" step, you MAY suggest convening `/debate` (3 frontier models, surfaces disagreement). User opts in; reserve it for hard calls.
- **Throwaway prototype** — when a state-model or logic question resists paper
  discussion (the answer needs to be *run*, not argued), offer a minimal throwaway
  prototype: one command to run (or a single HTML file opened by double-click, which a
  non-developer can drive and you can share), no polish, state shown after every action. It
  lives on a throwaway branch — main keeps only the validated decision — and is
  exploration under the gate, never grown into the implementation.

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
The approaches proposed at step 3, with tradeoffs and why one was chosen.
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

On the compressed path with no design decision weighed, the `## Why / What` header stays — the AC list
nests under it; sections 1-5 are what is skipped.

`## Progress` is written here as an empty heading only — its lines are `executing`'s to append. `## Follow-ups`
MAY be created here at step 6 to hold the residue manifest's deferred-in-scope lines;
its other sources are listed in `references/doc-types.md`.

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
