---
name: writing-plans
description: Use when a spec or clear requirements exist for a Standard- or Major-tier task and you are about to define the execution steps, before touching code. Skip for Trivial tasks (no plan).
---

# Writing Plans

Turn a spec into an execution plan a fresh engineer with zero codebase context could run without guessing. Depth follows the task's tier (HARRY.md §3) — do not over-build a plan for a Standard task, do not under-spec a Major one.

## Tier-aware depth

| Tier | Plan |
|------|------|
| Trivial | **No plan.** One file, mechanical, one-glance revert. Just do it. |
| Standard | **Lightweight bullet plan.** Per file: what it does + how to test it. NO full code. |
| Major | **Full bite-sized plan.** Complete code in every step + an Interfaces block per task. |

If a red line (HARRY.md §2) is hit, the task is already Major — plan accordingly.

## Step 1 — File Structure first

Before any task, map every file the change creates or modifies and give each **one** responsibility. Decomposition is locked in here, not later.

- One clear responsibility per file. Files that change together live together; split by responsibility, not by layer.
- In an existing codebase, follow its established patterns — don't unilaterally restructure.
- This map drives the task list: each task produces self-contained changes that stand on their own.

Write it as a list:

```
- Create  `src/auth/token.ts`     — issue + verify signed session tokens
- Modify  `src/server/routes.ts`  — wire /login and /logout to token.ts
- Test    `tests/auth/token.test.ts` — token round-trip + expiry
```

## Step 2 — Task Right-Sizing

A task is the **smallest unit that carries its own test cycle and is worth a fresh reviewer's gate**. Draw boundaries by that rule:

- Fold setup, configuration, scaffolding, and docs into the task whose deliverable needs them — they are not their own tasks.
- Split only where a reviewer could meaningfully reject one task while approving its neighbor.
- Every task ends with an independently testable deliverable.

## Step 3 — Global Constraints block

Copy the spec's §5 Constraints **verbatim** into a block at the top of the plan, one line each (version floors, dependency limits, naming/copy rules, platform requirements). Every task implicitly includes this block — state that once, here, instead of repeating it per task.

## Step 4 — Write the tasks

### Standard — bullet plan

Per task, just the three things a reviewer needs:

```markdown
### Task N: <component>
- Files: Create `path` / Modify `path:lines` / Test `path`
- Does: <one sentence — the single responsibility>
- Test: <exact command + expected result, e.g. `pnpm test token -- expect round-trip PASS>`
```

No code blocks for Standard. The implementer is trusted to write the lines; the plan fixes scope and the verification.

### Major — full bite-sized plan

Each task carries an **Interfaces** block (so an implementer who sees only their own task learns neighboring names/types) and steps that are each one 2–5 min action with **actual content**:

````markdown
### Task N: <component>

**Files:**
- Create: `exact/path/file.ts`
- Modify: `exact/path/existing.ts:120-145`
- Test:   `tests/exact/path.test.ts`

**Interfaces:**
- Consumes: `verifyToken(raw: string): Session | null`  (from Task 2)
- Produces: `issueToken(userId: string, ttlSec: number): string`

- [ ] **Step 1 — Write the failing test**
```ts
test("token round-trips userId", () => {
  const t = issueToken("u1", 3600);
  expect(verifyToken(t)?.userId).toBe("u1");
});
```
- [ ] **Step 2 — Run it, watch it fail**
Run: `pnpm test token -- -t "round-trips"`  · Expected: FAIL `issueToken is not defined`
- [ ] **Step 3 — Minimal implementation**
```ts
export function issueToken(userId: string, ttlSec: number): string {
  return sign({ userId, exp: now() + ttlSec });
}
```
- [ ] **Step 4 — Run it, watch it pass**
Run: `pnpm test token -- -t "round-trips"`  · Expected: PASS
- [ ] **Step 5 — Commit**
```bash
git add src/auth/token.ts tests/auth/token.test.ts
git commit -m "feat(auth): issue signed session tokens"
```
````

## No placeholders (these are plan failures)

Never write any of these — each is a defect, not a draft:

- `TBD`, `TODO`, `implement later`, `fill in details`
- "add error handling" / "add validation" / "handle edge cases" without the actual handling
- "write tests for the above" without the test code
- "similar to Task N" — repeat the content; tasks get read out of order
- a step that says *what* without showing *how* (code step ⇒ code block)
- a reference to a type, function, or method defined in no task

## Step 5 — Self-Review (run it yourself, no subagent)

After the plan is complete, read the spec with fresh eyes and check:

1. **Spec coverage** — point each spec section/requirement to a task. List gaps; add a task for any uncovered requirement.
2. **Placeholder scan** — grep your own plan for the patterns above. Fix every hit.
3. **Type-name consistency** — a function is `clearLayers()` in Task 3 and `clearFullLayers()` in Task 7 ⇒ bug. Names and signatures across tasks must match the Interfaces blocks.

Fix inline; no re-review.

## Save & hand off

Save to `.local/plans/YYYY-MM-DD-<feature>-plan.md` (gitignored, not committed). Naming per HARRY.md §5.

Then hand off to the **executing** skill — it auto-selects session vs subagent mode by tier. Do **not** present a mode-choice menu; state which plan was saved and pass control.
