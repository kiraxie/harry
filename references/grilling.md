# Grilling — the adversarial interview technique

An interview that pins down a plan, decision, or idea before it is built. The subject
is a **tree of decisions**; grilling walks that tree, converting vague intent into
settled choices plus a clean record of what was decided, deferred, and assumed. Works
on non-code topics too. This file owns the whole interview, start to close; a caller
states which mode it is (see Callers) and otherwise follows this file rather than
re-deriving any of it.

## Callers

`/grill` is a **conversation, not a tool run**: it creates no `.local/` item and no
pipeline entry, closing on the residue manifest below rather than a deliverable — with
one exception, which is where its deferred lines land: on the user's nod, each line the
manifest reads out becomes a `status: backlog` item, whichever scope tag it carries.
`skills/brainstorming` writes an item and enters the pipeline; there, its own steps
govern what gets written from the close.

## Decision-tree dependency order

The plan/idea is a tree of decisions. A parent decision is settled before the children
that hang off it: early answers reshape the later questions, so asking a child before
its parent wastes the question or asks the wrong one.

## Facts vs decisions

Two kinds of unknowns; treat them oppositely.

- **A fact is looked up, never asked.** Anything findable in the environment —
  filesystem, code, git history, docs — you read; you do not spend a question on it.
  Look it up yourself, or delegate the lookup to `scout` where the harness has one.
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

- **Inside the destination** → it is the complete version of the same problem.
  Propose folding it in; on confirmation it joins the session outright and carries
  no tag — it was never deferred. Declined, it is deferred and tagged
  deferred-in-scope.
- **Outside the destination** → it does not occupy this session; capture it as one
  deferred line, tagged destination-outside.

Either tag is applied at the moment a line is deferred, not at the moment it is
raised — the tags name what got set aside, not what got proposed. Scope accounting
is the **agent's** job. The user answers freely and must never need to self-censor
for fear of silent expansion.

## Cadence: one question per round

**Ask one question at a time, and wait for the answer before asking the next.** A
question carries its recommended answer, so the user reacts to a proposal, not a blank
prompt. This holds in both phases and on both builds — a single question needs no
picker and no numbering, so there is nothing for a harness to do differently.

**Batching is opt-in only**, on the user's explicit request, never a default. The
reason: the user runs several agent sessions at once and returns to a thread after
being away — a round of four unanswered questions is unanswerable cold, one question
is not.

**No question-count caps** on the interview as a whole. Too many questions is a quality
problem, not a quantity problem; the user steering in natural language ("wrap up") is
the control surface — the cadence rule bounds each round, not the session.

## Phase-dependent stance

Two phases, same cadence, different stance.

### Divergence — discovering which decisions exist

- **Free text.** No structured pickers, no pre-enumerated options — enumerating options
  anchors the answer and kills the "you're asking the wrong question" side channel.
- **Adversarial stance, relentless.** Actively hunt soft spots, invent edge-case
  scenarios that probe boundaries, challenge premises.

### Convergence — settling cleanly enumerable decisions

- Track the **frontier**: every question whose prerequisites are already settled.
  Dependency order already puts parents before children within it.
- Ask the next frontier question, wait for the answer, **recompute the frontier**, ask
  the next. A question that depends on one still open stays off the frontier until it
  resolves.

## The ledger

Across both phases, the interview keeps four short running lists:

1. **Decided** — settled decisions, one line each.
2. **Open** — raised-but-not-yet-settled questions.
3. **Deferred** — questions raised, then knowingly set aside rather than answered, each
   tagged with its scope tag (see Live scope labeling): deferred-in-scope or
   destination-outside.
4. **Assumptions** — anything taken for granted without being asked.

**Deferring closes a question as surely as answering it does — but only the user
defers.** A question moves from Open to Deferred on the user's say-so alone: an explicit
defer, or a "wrap up" that names or plainly covers what remains. The agent never
moves a question there on its own initiative to make condition 1 pass — that is the
gate being gamed, not met. On the user's say-so, deferring, with its scope tag
attached, satisfies the exit gate's first condition exactly as settling it would.

The ledger lives in the conversation. It is written to a file only when the user asks
for it: onto the item, on the pipeline path (`.local/items/<slug>.md`); to a path the
user names, standalone. Never by default, and never as a side effect of closing — what a
caller does afterwards with the lines the user approved in the manifest is that caller's
own step (see Callers), not this ledger writing itself out.

## The loop and its close

The session is a loop: **interview → design → re-interview.** One **pass** is one
trip around that loop — one interview, one design attempt, one re-interview on what
the design surfaced. A design pass surfaces gaps the interview missed — an
underspecified interface, a case the design forces a choice on — and each gap sends
the session back into the interview before the design continues. This is not a
fallback path; it is how the loop is expected to run. A non-code session, or one
settled before any design pass runs, still owes all three conditions below —
condition 3 is trivially satisfied when no pass has run to move the destination in
the first place.

**All three termination conditions must hold before the loop exits:**

1. **No open questions** — the open list is empty; a question leaves it by being
   answered, or by being moved to Deferred.
2. **Every silent assumption has a disposition** — every entry on the assumptions list
   carries one of the three dispositions below, not merely a written-down statement.
3. **The destination did not move during the most recent pass, nor after it** — a pass
   that moved it sends the session back into the interview on the new destination
   before the loop may exit; an answer that moved it after the most recent design pass
   ran leaves that design measured against the old destination, so one more pass runs
   on the new one before the loop may exit. A session that has run no pass satisfies
   this trivially.

### Assumption gate

**Listing an assumption is not closing it.** Each one is closed only by exactly one of:

- **confirmed fact** — verified against the environment or the user, and moved to Decided.
- **returned as an open question** — put back to the user explicitly, re-entering the loop.
- **pinned by an AC** — captured as one of the numbered acceptance criteria below, so
  its resolution is checked rather than assumed.

**The third disposition needs an AC to pin to, so the criteria are drafted during
convergence**, as decisions settle — never after the close. They exist before the
manifest is presented, which is what makes the third disposition dischargeable at the
gate rather than a promise to write something later. Where the session produces no
buildable work — no acceptance criteria — it does not apply: every assumption there
resolves to a confirmed fact or is returned as an open question, and either way leaves
the assumptions list. The manifest's assumptions section is then empty by construction, not
because assumptions went unexamined.

### Residue manifest — the exit gate

Once all three termination conditions hold, present the residue manifest:

1. **Decided** — the resolved decisions, one line each.
2. **Raised-but-deferred items** — the Deferred list, read out, each line stating its
   scope tag (deferred-in-scope or destination-outside). Where a line lands is the
   caller's to decide and to state — see Callers; this file only guarantees the line is
   named here. Nothing raised may drop out of this list into mere chat history.
3. **Silent assumptions** — each with its disposition stated, not just its text.

The manifest is the ledger's decided, deferred, and assumptions lists read out; the open
list contributes nothing because it is empty by construction — if anything remained on
it, the loop would not have exited.

Where the grilling produced buildable work, the manifest also comes with the settled
decisions restated as **numbered acceptance criteria** — each an outcome, never a step,
with its own verification — presented beside the manifest, not folded into it.

**What the user approves is design + residue manifest + acceptance criteria.** Nothing
raised may evaporate.

## Handoff

When a grilling session produced buildable work, **offer** the handoff rather than
waiting to be asked. On the user's agreement the settled decisions and the residue
manifest **carry into the brainstorming pipeline**, where **nothing the manifest settled
is asked again**. The settled decisions carry over restated as the numbered acceptance
criteria; the pipeline builds the item around them rather than deriving them again. The
loop still runs there on what the manifest did *not* settle: a design pass that moves the
destination fails termination condition 3, and the session goes back into the interview
for the questions that move raises — those only, never the settled ones again.
