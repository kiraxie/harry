# Tier Gates — full detail for HARRY.md §3

Classify every non-trivial task into exactly one tier, then run that tier's gates.
**Take the highest tier whose trigger is hit. When in doubt, go higher.**

## The three tiers

### Trivial

| Gate | Setting |
|------|---------|
| Trigger | HARRY.md §3's Trivial row |
| Brainstorm | skip |
| Item | none |
| TDD | none — trivial one-liners need no test |
| Review | none |

### Standard

| Gate | Setting |
|------|---------|
| Trigger | HARRY.md §3's Standard row |
| Brainstorm | compressed or full, as **Brainstorm depth** below sets; closes on `references/grilling.md`'s exit gate unabridged |
| Item | one `.local/items/<slug>.md`, `status: active` — `## Why / What` holds only `### Acceptance criteria` (short, each AC an outcome with its check) unless a real design decision was weighed (alternatives existed), in which case the decision record precedes them. Plus an append-only `## Progress`. |
| TDD | one runnable check left behind (smallest thing that fails if the logic breaks); watch-it-fail encouraged, not mandatory |
| Review | one `analyst` lane — required (`skills/executing/SKILL.md` step 3) |

### Major

| Gate | Setting |
|------|---------|
| Trigger | HARRY.md §3's Major row — **any red line (see below)** among them |
| Brainstorm | full, as **Brainstorm depth** below sets (a promotion may take compressed) — explore intent, requirements, design before any code |
| Item | one `.local/items/<slug>.md`, `status: active` — `## Why / What` is a full decision record (Discussion → Decision → considered-but-rejected) ending in `### Acceptance criteria`, plus an append-only `## Progress`. If the work spans several items, add a `type: milestone` item linking them. |
| TDD | full red-green-refactor, **watch-it-fail mandatory** (`references/red-green.md`) |
| Review | the `analyst` lane **plus** the Codex CLI review lane where the build has one (`skills/executing/SKILL.md` step 3) |

**Gate scaling on a red-line or always-loaded promotion.** When a red line or the always-loaded trigger — not another §3 trigger — is what forces Major, the promotion exists to guarantee the **verification** gates: a failing-reproduction / red-green test with watch-it-fail, the Major review gate (the `analyst` lane plus the Codex lane, where the build has one), and full evidence discipline (§6), because the risk of the domain or of an instruction every session loads is exactly what those gates guard. The **design** gates scale with the change's actual design complexity — a change promoted this way takes the depth **Brainstorm depth** below sets, not full depth by default, and when no design decision was weighed, a one-line `## Why / What` plus its acceptance criteria, not the full decision record. Acceptance criteria never scale away: they carry the verification. Scaling never reaches verification: a trivial-looking change in a red-line domain or to always-loaded instructions still ships red-green + review.

**Red-green for an instruction edit.** A test cannot grep the new wording (`references/red-green.md`, "Behavior, not text"). The red-green test for an edit that changes what a model is asked is a probe: a prompt the old text answers one way and the new text another, run against both and watched failing on the old. At Standard the same probe is the one runnable check, watch-it-fail encouraged. A session that cannot run the probe itself hands it to the user: the prompt, and the answer the old and the new text should each give. Only when no probe can run at all, the user included, do the review lanes carry the verification — the one exception to red-green's never-waived test. `## Progress` records the probe either way: `probe: <prompt>, old → <answer>, new → <answer>`, or `no probe ran: <why>`.

**Fixes inside a unit.** Whatever the unit's tier, a fix is small or not by HARRY.md §3, which also splits a wording-only instruction edit from one that changes what a model is asked; `skills/executing` step 4 runs it. Small, for example: rewording a sentence without changing what it asks of a model, an added test pin, a mechanical rename or move the typecheck covers. Not small, for example: a sentence that changes what a model does (a real decision, rule 2), a loosened or deleted assertion, a one-line change in a red-line domain (it tiers Major), a refactor that restructures logic or adds a decision.

## Brainstorm depth

The tier sets where the interview starts; the task's design complexity sets how deep it goes.

- **Compressed depth** — the destination is legible from the request, and there are no real alternatives to weigh and no new module boundary. The interview still runs, just shorter: the opening divergence is brief, so skip extensive adversarial probing of the request unless something looks wrong, and convergence covers only the frontier this task's scope actually raises. One approach proposal is enough.
- **Full depth** — every other task: the complete divergence and convergence in `references/grilling.md`, and 2-3 approaches.

A Standard task takes compressed depth when it qualifies, otherwise full. A Major task takes full depth, except a red-line or always-loaded promotion, which takes depth by the same test as a Standard task (Gate scaling, above). `references/grilling.md`'s re-walk after every answer and design draft, and its design-draft probe, run at every depth, and the interview always closes on its exit gate, unabridged: depth sets how far each step is pushed, never whether it runs.

## Promotion rules

Tiers are set by what a failure can break and whether it can be seen and undone, never by file count. Apply these in order:

1. **Red lines → auto-Major, unconditionally, regardless of file count.** These are §2's promotion-triggering red-line domains, restated here for the tier decision — **§2 is authoritative: if this list and §2 diverge, §2 wins.** If the task touches any of:
   - **security / auth** — authentication, authorization, secrets, permissions
   - **money** — billing, payments, balances, pricing
   - **delete / destructive** — data deletion, `DROP`, irreversible or destructive mutation
   - **migration** — schema or data migration
   - **external contract** — a public API, wire format, or anything another system depends on
   - **cross-boundary contract** — shared knowledge that two sides must agree on (the DRY drift test: silent divergence = a bug)
   - **input validation** — untrusted input at a trust boundary
   - **data-loss error handling** — error paths whose absence risks losing data
   - **accessibility** — keyboard, screen-reader, and semantic-markup paths

   …then it is **Major**, even if it is a one-line change. (§2 carries one further never-simplify entry — *anything the user explicitly requested* — that is never-simplify-**only** and does **not** promote: a requested change's tier is whatever these nine triggers plus §3's other triggers make it.)

2. **Branching logic upgrades Trivial → Standard.** The moment the change introduces a branch, loop, parser, or any real decision, it is no longer Trivial. "No branching" is the line between Trivial and Standard.

3. **Take the highest tier whose HARRY.md §3 trigger is hit**, scanning for red lines and branching too — whichever lands highest wins. Ties and uncertainty resolve upward.

## Incident lane

**User-declared only.** When the user calls it an incident ("incident", "ship it now"), invert the order — fix and verify first, then back-fill the rest. Verification is not skipped: the covering / reproduction test still runs and nothing merges red; only the *sequencing* moves. Review and the process artifacts (the `.local/` item, INDEX/HISTORY lines, `DEBT:` markers) are back-filled immediately after shipping, the same day. A model may never self-declare an incident — deciding on your own that something is urgent enough to bypass the flow is a §7 rationalization.
