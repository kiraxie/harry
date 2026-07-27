# Red-Green-Refactor — full detail for HARRY.md §6 (TDD)

**Core principle: if you didn't watch the test fail, you don't know it tests the right thing.**
A test you didn't watch fail proves nothing — written after the code, it passes immediately and
verifies nothing.

## When this is mandatory (tiered)

| Tier | TDD requirement |
|------|-----------------|
| Trivial | none — one-liners need no test |
| Standard | leave **one runnable check** (the smallest thing that fails if the logic breaks); watch-it-fail encouraged |
| Major / any red line | **full red-green, watch-it-fail mandatory** |

Full red-green below applies at Major / red-line tier. A bug fix starts with a failing
reproduction test (tier permitting) — at Standard and above, never fix a bug without a test
reproducing it.

## The cycle

### RED — write a failing test

Write **one** minimal test showing what should happen. Then **watch it fail**:

- Run the test. Confirm it **fails** (not errors).
- The failure message is the one you expected.
- It fails because the feature is **missing** — not because of a typo or import error.

Test passes already? You're testing existing behavior — fix the test.
Test errors? Fix the error and re-run until it fails *correctly*.

**Before writing the test body, name the break**: which production change would make this
test fail — and would that change be a *bug* or a *decision*? A test only a decision can
break guards nothing, yet passes every gate above (it fails when watched, uses real code,
has a clear name). Corollaries:

- **No mirror assertions** — an expected value computed by the code under test always
  passes; hard-code the expectation.
- **No change detectors** — `expect(MAX_RETRIES).toBe(5)` fires on redesign and sleeps
  through bugs; test the behavior the constant controls, not the constant.
- **Behavior, not text** — never grep a script's or skill's source to "test" it; run it
  and assert its effects.

### GREEN — minimal code

Write the **simplest** code that passes the test. Nothing more — no extra options, no
speculative parameters, no "while I'm here" refactors. Then run the test and confirm:

- The test passes.
- Other tests still pass.
- Output is pristine (no errors, no warnings).

Test fails? Fix the code, not the test.

### REFACTOR — clean up

Only after green: remove duplication, improve names, extract helpers. Keep tests green.
Do not add behavior. Then move to the next failing test for the next behavior.

## What a good test is

| Quality | Good | Bad |
|---------|------|-----|
| **One behavior** | Tests one thing. "and" in the name? Split it. | `test('validates email and domain and whitespace')` |
| **Clear name** | Describes the behavior | `test('test1')`, `test('retry works')` |
| **Real code** | Exercises the actual code path | Tests a mock's configured behavior, not the code |

Use real code, not mocks (mocks only when unavoidable — must-mock-everything means the code is
too coupled; use dependency injection instead). GREEN is the minimal code that passes — an
over-engineered "general" solution is a YAGNI violation, not thoroughness.

**Exercise the real thing** — the ways a test *claims* to use real code while not doing so:

- Never assert on the mock itself — that verifies the mock's configuration, not the code.
  About to? Unmock it, or delete the assertion.
- Mock at the level *below* the side effects the test depends on — learn the real method's
  side effects first, or the mock hides the very behavior under test.
- A mock mirrors the complete real data structure, not just the fields this test reads —
  a partial mirror passes tests the real shape would fail.
- Test-only cleanup lives in test utilities, never as production methods.
- When mock setup outgrows the test logic, stop mocking — switch to an integration test
  with real components.

- **Agree the seams before writing tests.** Name the public boundaries under test
  and confirm them with the user up front — testing effort lands on critical paths
  and complex logic, not every edge; an unconfirmed seam gets no test. When no
  correct seam exists for a needed test, that absence is itself the finding to
  report — it never waives the mandatory reproduction test.

## Regression test verification (the proof)

```
Write → Run (fails) → Apply fix → Run (passes) → Revert fix → Run (MUST fail) → Restore → Run (passes)
```

Only after the revert step fails do you know the test actually guards the bug. "I wrote a
regression test" without this cycle is not evidence.

The revert cycle is the bug-fix form of the general **mutation check**: mentally mutate the
production code (flip a comparison, drop a guard, off-by-one a bound) — each realistic
mutation must make at least one test fail. A mutation no test notices is untested behavior.

## Red flags — STOP and start over

- Code written before the test
- Test added after implementation
- Test passes immediately (you never saw it catch anything)
- Can't explain *why* the test failed
- "I already manually tested it" — a manual run checks one input, once, with your own bias
  about where it works, and nothing re-runs it tomorrow. The suite is what keeps the claim
  true after the next change; ad-hoc poking is not a weaker test, it is the absence of one.
- "Tests after achieve the same goal" — they don't. A test written after the code is shaped
  by the implementation: it asserts what the code *does*, not what it *should* do, inherits
  the code's blind spots, and passes immediately — the exact failure watch-it-fail exists to
  catch. Writing it first is what makes it evidence.
- "It's about spirit not ritual" / "this is different because…" — violating the letter IS
  violating the spirit: every skipped cycle is invisible until the untested path breaks
  later. The ritual is the only observable form the spirit has.

(These three rows carry their full arguments deliberately: compressing a rebuttal to its
label measurably weakens test-first behavior under pressure — upstream eval, n=10, on two
harnesses.)
