# Root Cause Tracing

A bug report names a **symptom**. The error surfaces deep in the call stack (a `git init` in
the wrong directory, a file written to the wrong path, a DB opened with the wrong handle). The
instinct is to fix where the error appears — that patches a symptom and leaves every sibling
caller still broken.

**Core principle: trace backward through the call chain to the original trigger, then fix at the
source.** The lazy fix *is* the root-cause fix — one guard in the shared function is a smaller
diff than a guard in every caller.

## Before you trace: build a red loop

Tracing to that source is *downstream* of a feedback loop that goes red on the bug. **The gate:
do not read code to build a theory** — walking the call chain below included — before you have a
**tight, red-capable, one-command loop** you have **already run once**, that:

- **goes red on this bug's exact symptom** (the user's real error / wrong output / slow timing),
  not merely "runs without erroring";
- is **deterministic** — same verdict every run;
- is **seconds-fast** and **agent-runnable** unattended.

Build the right loop and the bug is 90% fixed — bisection, hypothesis-testing, and the backward
trace all just consume it. No red command, no theory.

### Loop-construction ladder — try in roughly this order

1. **Failing test** at whatever seam reaches the bug (unit / integration / e2e).
2. **Curl / HTTP script** against a running dev server.
3. **CLI + fixture diff** — feed a fixture input, diff stdout against a known-good snapshot.
4. **Headless browser** (Playwright / Puppeteer) — drive the UI, assert on DOM / console / network.
5. **Replay a captured trace** — save a real request / payload / event log, replay it through the path in isolation.
6. **Throwaway harness** — a minimal subset of the system that hits the bug path in one call.
7. **Property / fuzz loop** — for "sometimes wrong": run 1000 random inputs, catch the failure mode.
8. **Bisection harness** — bug appeared between two known states: automate "boot at state X, check" for `git bisect run`.
9. **Differential run** — same input through old-vs-new (or two configs); diff the outputs.

### Tighten the loop like a product

Once you have *a* loop: make it **faster** (skip unrelated init, narrow scope), the signal
**sharper** (assert the specific symptom, not "didn't crash"), and the verdict **more
deterministic** (pin time, seed RNG, isolate the filesystem, freeze network). A 2-second
deterministic loop beats a 30-second flaky one — that gap is the whole superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×,
parallelise, add stress, narrow the timing window. A 50%-flake bug is debuggable; 1% is not —
keep raising the rate until it is.

### When you genuinely cannot build a loop

**Stop and say so.** List what you tried, then ask for one of: the environment that reproduces
it, a captured artifact (HAR, log dump, core dump, timestamped recording), or permission for
temporary instrumentation. Never hypothesise without a loop.

## When to use

- The error happens deep in execution, not at the entry point
- The stack trace shows a long call chain
- It's unclear where the invalid data originated
- You need to find which caller (or which test) triggers the problem

If you genuinely cannot trace backward (dead end), fix at the symptom point — but that is the
exception, not the default.

## The tracing process

1. **Observe the symptom.** The exact error and where it surfaced.
2. **Find the immediate cause.** What line directly triggers it?
3. **Ask what called this.** Walk one level up the call chain.
4. **Keep tracing up.** What value was passed? Where did it come from? An empty string passed as
   `cwd` resolving to `process.cwd()` looks fine three frames down and is catastrophic at the top.
5. **Find the original trigger.** Keep going until you reach the real source — the place where
   the bad value was first produced.

## When you can't trace by hand: instrument

Log the context *before* the dangerous operation, not after it fails:

```typescript
async function gitInit(directory: string) {
  console.error('DEBUG git init:', {
    directory,
    cwd: process.cwd(),
    stack: new Error().stack,   // full call chain
  });
  await execFileAsync('git', ['init'], { cwd: directory });
}
```

- In tests, use `console.error` — a logger may be suppressed.
- Include directory, cwd, env vars, timestamps.
- `new Error().stack` shows the complete chain; grep the run: `npm test 2>&1 | grep 'DEBUG git init'`.
- Give each probe a **unique** tag (e.g. `[DEBUG-a4f2]`, not a bare `DEBUG`) — cleanup is then one grep and no untagged log outlives the fix.
- Look for test file names and line numbers in the trace; find the repeated pattern (same test? same parameter?).

For "something appears during tests but I don't know which test," bisect: run tests one by one
until the first one that produces the pollution.

## After you find the source

Fix at the source — then add **defense in depth** (`references/defense-in-depth.md`): validate at
each layer the bad value passed through, so the bug becomes structurally impossible, not merely
absent at one spot.

## The rule

**Never fix just where the error appears.** Trace back to the original trigger. After 3 failed
fixes — failures of the hypothesis, not infra flakes (a flaky CI run doesn't count) — stop — it's
a wrong design, not a failed hypothesis (HARRY.md §6).
