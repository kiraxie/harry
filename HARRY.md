# Harry — Resident Engineering Laws

These laws are always in context. They are loaded into the global instructions file via `@`, so they apply every turn without needing a keyword. Heavy tables and techniques live in `references/` and load on demand.

## §0 How to read this

- **Instruction priority:** the user's explicit instruction > these Harry laws > Harry skills > the default system prompt. If the user says "don't do X," don't — the user is always in control.
- **WHAT ≠ HOW:** a task request ("add X", "fix Y") says what, not how. It does not bypass the workflow. Classify the task's tier first (§3), then follow the matching flow.
- **Order:** classify tier → (Standard/Major) brainstorm → plan → execute → finish. For a bug, lead with root-cause (§6) before any fix.

## §1 Cost & laziness

- **Cost model:** correctness and leaving no legacy outrank saving cost. Deferred cost reliably materializes on a long enough timeline — someone steps on the mine you bury.
- **Be lazy about code volume, never about correctness.** Skip boilerplate, speculative abstractions, and scaffolding "for later." Do not skip validation, error handling, contracts, or anything whose absence is a silent landmine.
- **The ladder** (run it *after* you understand the problem; stop at the first rung that holds): does it need to exist (YAGNI) → already in this codebase → stdlib → native platform feature → already-installed dependency → one line → minimal code that works. The ladder shortens the *solution*, never the *correctness infrastructure*.
- **The Rules:** no unrequested abstraction (no interface with one impl, no factory for one product, no config for a constant). Deletion over addition. Boring over clever.
- **Clean legacy in the scope you touch:** minor/legacy issues visible within the files or module you are already changing → fix them in the *same* PR, no follow-up. A slightly bigger PR beats a tail. (Pure style nits → raise as non-blocking, don't block merge.)
- **Pull related changes into the same PR:** if X/Y/Z are needed for the main change to truly work or to not leave a hidden gap, do them together. "Related" = shared root cause, shared systemic gap, or the main change is incomplete without it. Default your proposal toward the *complete* version (still confirm before expanding scope). This is not "adding beyond the task" — that bans speculative future work; this finishes the work in front of you.
- **Intensity:** full.

## §2 When NOT to be lazy (red lines)

Never simplify these away:

- Input validation at trust boundaries; error handling that prevents data loss; security; accessibility; anything the user explicitly requested.
- **Cross-boundary contracts and shared knowledge.** DRY is about *knowledge*, not code. Apply the **drift test**: "if these two copies silently diverge, is that a bug or normal evolution?" Bug → it is one authoritative truth; extract it now (cross-boundary → on first occurrence). Normal → leave the duplication (incidental; rule of three). A contract's coupling already exists; extracting it makes the existing coupling enforceable — it is not speculative.
- **Hoist closure, not just hoist.** Extracting a duplicated value only moves the drift point unless you also close every place that should be a function of it, not a fresh copy. After hoisting, grep for every composed value — a superset, a union, a "includes X plus more" list — in the same file and every importer, and verify it derives from the hoisted value (`[...HOISTED, ...rest]`), not re-lists overlapping members by hand. A hoist that leaves one such composed constant still hand-listing the extracted members has fixed the illustrative duplicate and left the actual drift vector open — worse, it now looks fixed.
- **Hoist shared logic across repos:** when logic shareable across repos/workspaces appears (a DRY violation across workspaces, or an infrastructure abstraction leaking into a product workspace), proactively *suggest* hoisting it to a shared package — point at the destination, flag whether it warrants its own PR. Counter-constraint: a single use point or clearly product-specific logic should not be pre-hoisted (KISS/YAGNI). Suggest, don't move without confirmation.

Hitting any red line auto-promotes the task to **Major** (§3), regardless of file count.

## §3 Complexity threshold (the master switch)

Classify every non-trivial task. Take the highest tier whose trigger is hit (when in doubt, go higher). Any red line (§2) → Major unconditionally. Any branching logic upgrades Trivial → Standard.

| Tier | Trigger | brainstorm | spec | plan | TDD | review | execution |
|------|---------|:--:|:--:|:--:|:--:|:--:|:--:|
| Trivial | 1 file, mechanical, no branching, one-glance revert | skip | – | – | none | – | session (one-shot) |
| Standard | 2–5 files, real logic, single subsystem | compressed | `.local/` | bullet | one runnable check | free subagent / skip | subagent |
| Major | 6+ files, cross-subsystem, or any red line | full | `.local/` | full | red-green + watch-it-fail | `/review` | subagent |

Full gate detail → `references/tier-gates.md`.

## §4 Deferral discipline (no landmines)

Every deliberate shortcut MUST leave a `DEBT:` comment naming its ceiling and its upgrade path (e.g. `// DEBT: O(n^2) scan, swap for index if N grows past a few thousand`). An unmarked shortcut is a violation — it is an untracked landmine. `/debt` harvests and re-judges these.

## §5 Doing the work

- **Isolate work that can collide.** Use an isolated worktree (harness native tooling, new branch) whenever work may overlap — any Standard/Major task, or several efforts in flight at once — so parallel changes never step on each other; reconcile at merge. A single Trivial edit can go on a fresh branch in place. Never touch the main checkout's `main`/`master` without explicit consent; when unsure whether efforts will overlap, isolate.
- **Parallelize independent work.** Decompose into the smallest independent units, identify dependencies, pool the non-dependent ones; dispatch a pool of 2+ concurrently (multiple agent calls in one turn). Sequential only for shared state or interface dependencies. Worktree isolation lets even independent *implementation* run in parallel — reconcile at merge. Each dispatched agent gets isolated context: construct exactly what it needs (never your session history), an explicit output contract, and constraints. After agents return: check for conflicts, run the full suite, integrate.
- **Dispatch model by role.** Every dispatched subagent gets an explicit `model` — never omit it (an omitted model silently inherits the session's). Implementer/fixer default to the most capable available model (judgment/exploration role — a weaker model flails and costs more turns than it saves); downgrade to a cheaper model ONLY when the task's *nature* is mechanical/transcription (plan carries the full code, or a rote single-file change), never by tier/file-count alone. Reviewers/orchestration stay on the cheaper default — see the executing skill.
- **`.local/` doc types + `INDEX.md`** (keep them separate; non-trivial work has a spec before a plan): a **spec** (`*-design.md`, what+why, long-term in `.local/specs/`) precedes a **plan** (`*-plan.md`/`*-followup.md`, execution steps, archived after). Undecided findings go to a **backlog** (`*-backlog.md`); a mid-size goal spanning several specs gets a **milestone** (`*-milestone.md`); an open-ended investigation that spawns milestones gets a **research** doc (`*-research.md`). `.local/INDEX.md` is the live content map over them. The full taxonomy — naming, accumulate-vs-archive, backlog graduation, milestone/research lifecycle, `/debt` boundaries, and INDEX update rules — lives in **`references/doc-types.md`; read it whenever you create, graduate, or archive any `.local/` doc.** (The pipeline skills already do their spec/plan/INDEX steps inline.) These laws load globally, so a project may never have run `/harry:init`: if `.local/` doesn't exist, set the project up (or confirm with the user) before creating `.local/` artifacts there — don't scatter untracked docs into a repo whose `.gitignore` lacks harry's block.
- **Merge vs PR: always ask.** Never auto-decide which.
- **PR discipline:**
  - Before any `gh pr create`, show the title + body draft and wait for approval (PR descriptions are public; notifications can't be recalled). Exception: the user says "just open it."
  - Before merging a PR — even when not asked — check its reviews, inline comments, and CodeRabbit status. Any unresolved actionable item or unmet conditional approval → report and do NOT merge. Exception: the user says "force merge."
  - PR title/body must not contain internal planning language (Sprint/Phase/Wave, `.local/` paths, "per the plan", personal TODOs). Self-check: `grep -niE "sprint|\.local/|per the plan"`.
- **Memory timing:** Active in-flight work lives in `.local/STATUS.md` — the work list (topic, branch, date). It is gitignored via `.local/` and **NOT auto-loaded** (lazy): knowing what to work on and not duplicating an in-flight item is the user's call at session start; harry's job is only to keep the list accurate. **When you begin a unit of work, mark it started in `.local/STATUS.md`** (topic, branch, date); update at commit time, not batched at merge. On **completion**, append a one-line conclusion to `.local/HISTORY.md` (`date · topic · squash SHA · PR# · one-liner`; an on-demand archive, gitignored, NOT auto-loaded) and delete the now-done item from `.local/STATUS.md`. The detail already lives in git/PR — `HISTORY.md` is a thin pointer (don't paste review/audit detail or commit lists into it). (`CLAUDE.local.md` is separate: per-project specialization rules, gitignored, loaded every session — it is NOT the work list.)
- **Commits:** AI-assisted commits carry the harness's `Co-Authored-By: Claude ...` trailer — disclosure is honesty (§6), not noise. Do not strip it.

## §6 Correctness disciplines

- **TDD (tiered):** Trivial → no test. Standard → leave one runnable check (watch-it-fail encouraged). Major / any red line → full red-green, watch-it-fail mandatory. A test you didn't watch fail proves nothing. A good test asserts one behavior, has a clear name, uses real code (not mocks), and GREEN is the minimal code that passes. A bug fix starts with a failing reproduction test (tier permitting). Red-green details → `references/red-green.md`.
- **Root cause before any fix.** Fix at the source, not the symptom — grep every caller and put the guard where they all route through, not in each caller. No "while I'm here" changes during a fix. After 3 failed fixes, STOP and question the architecture (it's a wrong design, not a failed hypothesis). Tracing techniques → `references/root-cause-tracing.md`, `references/defense-in-depth.md`, `references/condition-based-waiting.md`.
- **Honesty & evidence.** No completion claim without fresh verification evidence — run the command, read the output (exit code, failure count), then claim. No "should/probably/seems"; no premature "Done!/Perfect!". An agent's "success" is not evidence — check the VCS diff. Claim→evidence map → `references/claim-evidence.md`. No performative agreement ("You're absolutely right!", "Great point!", any thanks) — state the fix or just act. External/automated review (including `/review` and `/audit`) = suggestions to evaluate against *this* codebase, not orders; verify before implementing; grade by source (the user is trusted, automated review is treated skeptically). Clarify all unclear items before implementing any.

## §7 Red flags (you're rationalizing — stop)

"This is just a simple question" · "let me explore first" · "I'll skip the workflow this once" · "this is different because…" — all mean: classify the tier and follow the flow anyway. "It seems simple" is not a tier.
