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

**Every test** below binds every tier that writes a test; **Major / red line** adds the
full cycle and its proofs at that tier. A bug fix starts with a failing reproduction test
(tier permitting) — at Standard and above, never fix a bug without a test reproducing it.

## Every test

### What a good test is

**Before writing the test body, name the break**: which production change would make this
test fail — and would that change be a *bug* or a *decision*? A test only a decision can
break guards nothing, yet passes every other gate in this file (it fails when watched,
uses real code, has a clear name). Corollaries:

- **No mirror assertions** — an expected value computed by the code under test, or
  re-derived the way the code derives it (the same formula in the test, a snapshot built by
  the same steps), always passes. Take it from an independent source: a known-good literal,
  a worked example, the spec.
- **No change detectors** — `expect(MAX_RETRIES).toBe(5)` fires on redesign and sleeps
  through bugs; test the behavior the constant controls, not the constant.
- **Behavior, not text** — never grep a script's or skill's source as a substitute for
  running it; run it and assert its effects. (Asserting a text artifact's own contract —
  links resolve, two files agree — is a different kind of test, and fine.)
- **No borrowed pass** — a negative test must fail for the reason it names. A rejection
  that comes from a different guard, or from a path production never reaches, passes
  while the guard it claims to test is gone.
- **No overpromising** — the name and fixture claim no more than the input exercises.
  A test named "expires stale sessions" whose fixture holds only fresh ones proves
  nothing about expiry, however green it is.
- **Exercise the promise, not the flag** — a capability test drives the delivery or
  acknowledgement a flag promises; asserting the declared flag restates the config.
- **Let the owner produce it** — a fixture never supplies the result, ordering or
  callback the code under test is meant to produce.
- **Persistence: read it back through the owner** — assert a write through the module's
  own read path, so the test survives a storage refactor. Query the store directly in two
  cases: when the stored shape is itself a contract others read (another service, a
  migration, a report), since a write and a read that share one bug cancel out through the
  interface while those readers see the bad data; and when the module has no read path.
  Either way, assert against the store the path actually writes, never one the fixture
  filled.

| Quality | Good | Bad |
|---------|------|-----|
| **One behavior** | Tests one thing. "and" in the name? Split it. | `test('validates email and domain and whitespace')` |
| **Clear name** | Describes the behavior | `test('test1')`, `test('retry works')` |
| **Real code** | Exercises the actual code path | Tests a mock's configured behavior, not the code |

**One owner per contract.** Each contract has one primary test, at the strongest
boundary that can see it. Another layer earns its own test only for a risk the owner
cannot reach — a transport or lifecycle failure, say — never to replay the same scenario
one level down. Extend the existing table-driven case or shared fixture before writing a
near-duplicate. A bug's regression test lives once, at the owner boundary where the fix
lands, not at every layer the bug passed through.

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
- A test never needs a production seam no production caller uses — an export, flag,
  wrapper, getter or injection hook that exists only for the test. Needing one means the
  test sits at the wrong boundary: move it to the real one. Test-only cleanup likewise
  lives in test utilities, never as production methods.
- When mock setup outgrows the test logic, stop mocking — switch to an integration test
  with real components.

## Major / red line

### The cycle

#### RED — write a failing test

Name the break first (see **What a good test is**, above). Write **one** minimal test
showing what should happen. Then **watch it fail**:

- Run the test. Confirm it **fails** (not errors).
- The failure message is the one you expected.
- It fails because the feature is **missing** — not because of a typo or import error.

Test passes already? You're testing existing behavior — fix the test.
Test errors? Fix the error and re-run until it fails *correctly*.

#### GREEN — minimal code

Write the **simplest** code that passes the test. Nothing more — no extra options, no
speculative parameters, no "while I'm here" refactors. Then run the test and confirm:

- The test passes.
- Other tests still pass.
- Output is pristine (no errors, no warnings).

Test fails? Fix the code, not the test.

#### REFACTOR — clean up

Only after green: remove duplication, improve names, extract helpers. Keep tests green.
Do not add behavior. Then move to the next failing test for the next behavior.

### Agree the seams

**Agree the seams before writing tests.** Name the public boundaries under test
and confirm them with the user up front — testing effort lands on critical paths
and complex logic, not every edge; an unconfirmed seam gets no test. When no
correct seam exists for a needed test, that absence is itself the finding to
report — it never waives the mandatory reproduction test.

### Regression test verification (the proof)

```
Write → Run (fails) → Apply fix → Run (passes) → Revert fix → Run (MUST fail) → Restore → Run (passes)
```

Only after the revert step fails do you know the test actually guards the bug. "I wrote a
regression test" without this cycle is not evidence.

The revert cycle is the bug-fix form of the general **mutation check**: mentally mutate the
production code (flip a comparison, drop a guard, off-by-one a bound) — each realistic
mutation must make at least one test fail. A mutation no test notices is untested behavior.

### Red flags — STOP and start over

- Code written before the test
- Test added after implementation
- Test passes immediately (you never saw it catch anything)
- Can't explain *why* the test failed
- All tests written first, then all the code (horizontal slicing) — bulk tests pin the
  behavior you imagined before building. Work in vertical slices: one test, its minimal
  code, repeat, each test a tracer bullet aimed by what the last one taught.
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
