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
reproduction test (tier permitting) — never fix a bug without a test reproducing it.

## The cycle

### RED — write a failing test

Write **one** minimal test showing what should happen. Then **watch it fail**:

- Run the test. Confirm it **fails** (not errors).
- The failure message is the one you expected.
- It fails because the feature is **missing** — not because of a typo or import error.

Test passes already? You're testing existing behavior — fix the test.
Test errors? Fix the error and re-run until it fails *correctly*.

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

## Regression test verification (the proof)

```
Write → Run (fails) → Apply fix → Run (passes) → Revert fix → Run (MUST fail) → Restore → Run (passes)
```

Only after the revert step fails do you know the test actually guards the bug. "I wrote a
regression test" without this cycle is not evidence.

## Red flags — STOP and start over

- Code written before the test
- Test added after implementation
- Test passes immediately (you never saw it catch anything)
- Can't explain *why* the test failed
- "I already manually tested it" — ad-hoc ≠ systematic
- "Tests after achieve the same goal" — no: tests-after answer "what does this do?", tests-first answer "what *should* this do?"
- "It's about spirit not ritual" / "this is different because…"
