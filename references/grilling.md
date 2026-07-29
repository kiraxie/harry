# Grilling — the adversarial interview technique

An interview that pins down a plan, decision, or idea before it is built. The subject
is a **tree of decisions**; grilling walks that tree, converting vague intent into
settled choices plus a clean record of what was decided, deferred, and assumed. Works
on non-code topics too.

The session runs in two phases — **divergence** (find which decisions exist) then
**convergence** (settle the ones that are cleanly enumerable) — and closes on a residue
manifest. Each rule below applies across both phases unless it names one.

**Standalone `/grill` only.** A `/grill` session is **a conversation, not a tool run**:
it creates no `.local/` item of its own and no pipeline entry, and it exits on the
residue manifest below rather than on a deliverable — the backlog items the manifest's
own dispositions open are the exception. Work that emerges reaches the pipeline through
those dispositions or through the Handoff at the end of this file, never as a side
effect of the interview. The scoping is load-bearing, not throat-clearing: this file has
two callers, and `skills/brainstorming` — told to follow these rules and not re-derive
them — *does* write an item and enter the pipeline, so inside that skill its own steps
govern what gets written.

## Decision-tree dependency order

The plan/idea is a tree of decisions. A parent decision is settled before the children
that hang off it: early answers reshape the later questions, so asking a child before
its parent wastes the question or asks the wrong one.

**Dependency order is law; serialization is a per-harness implementation choice.** What
must resolve before what is fixed by the decisions' dependencies; *how* the questions
are delivered — one at a time, batched, free text, structured picker — is the harness's
call and changes nothing about the order.

## Facts vs decisions

Two kinds of unknowns; treat them oppositely.

- **A fact is looked up, never asked.** Anything findable in the environment —
  filesystem, code, git history, docs — you read; you do not spend a question on it.
  - This includes **code cross-examination**: when the user's statement contradicts what
    the code actually does, surface the contradiction as a question. *"Your code cancels
    whole orders, but you said partial cancellation exists — which is it?"*
- **A decision belongs to the user.** Put each one to them — but always with a
  **recommended answer**, so they react to a proposal, not a blank prompt.

## Destination pinning

Early in the session, pin in one or two lines what this effort is trying to solve — the
**destination**.

- It is a **divergence-phase output, not a precondition.** The user may not know it yet
  at the start; discover it, then state it.
- **Revisable at any time — but every revision is announced explicitly:** *"destination
  changes from X to Y."*
- The destination is the ruler every scope question is measured against.

## Live scope labeling

When an answer moves the boundary, classify it **on the spot** using HARRY.md §1's
related test — shared root cause / shared systemic gap / the main change is incomplete
without it:

- **Inside the destination** → it is the complete version of the same problem. Propose
  folding it in; still confirm before you expand.
- **Outside the destination** → capture it as one line for a backlog item. It does not
  occupy this session.

Scope accounting is the **agent's** job. The user answers freely and must never need to
self-censor for fear of silent expansion.

## Phase-dependent format

Two phases, different delivery.

### Divergence — discovering which decisions exist

- **Free text.** No structured pickers.
- **Adversarial stance, relentless.** Actively hunt soft spots, invent edge-case
  scenarios that probe boundaries, challenge premises.
- **Strong default against option lists.** Pre-enumeration is the opposite of discovery:
  options anchor the answer and kill the "you're asking the wrong question" side channel.

### Convergence — settling cleanly enumerable decisions

- Batch the **frontier** — every question whose prerequisites are already settled and
  which are mutually independent of each other.
- Deliver via **AskUserQuestion**, ≤4 per round, recommended option first.
- **Recompute the frontier after each round.** A question that depends on another still
  open this round belongs to a later round.
- **Codex build has no AskUserQuestion** — convergence falls back to **numbered text
  rounds**: each question numbered with its recommended answer attached; wait for the
  answers, recompute the frontier, run the next round.

**No question-count caps.** Too many questions is a quality problem, not a quantity
problem. The user steering in natural language ("wrap up") is the control surface.

## Residue manifest — the exit gate

Before any approval or close, re-scan the **whole** conversation and present the
manifest:

1. **Resolved decisions** — one line each.
2. **Raised-but-deferred items** — each given a **disposition on the spot**, keyed by
   scope (see Live scope labeling): deferred-in-scope → the item's `## Follow-ups`
   (pipeline) or a backlog item (standalone, with the user's nod); destination-outside
   → a backlog item. The manifest is the floor: nothing raised may drop out of it into
   mere chat history.
3. **Silent assumptions** — laid open.

What the user approves is **design + manifest**. Nothing raised may evaporate.

## Handoff

When a grilling session produced buildable work, **offer** the handoff rather than
waiting to be asked. On the user's agreement the settled decisions and the manifest
**carry into the brainstorming pipeline** — the interview is **not** re-run there.
