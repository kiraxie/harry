# Root Cause Tracing

A bug report names a **symptom**. The error surfaces deep in the call stack (a `git init` in
the wrong directory, a file written to the wrong path, a DB opened with the wrong handle). The
instinct is to fix where the error appears — that patches a symptom and leaves every sibling
caller still broken.

**Core principle: trace backward through the call chain to the original trigger, then fix at the
source.** The lazy fix *is* the root-cause fix — one guard in the shared function is a smaller
diff than a guard in every caller.

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
- Look for test file names and line numbers in the trace; find the repeated pattern (same test? same parameter?).

For "something appears during tests but I don't know which test," bisect: run tests one by one
until the first one that produces the pollution.

## After you find the source

Fix at the source — then add **defense in depth** (`references/defense-in-depth.md`): validate at
each layer the bad value passed through, so the bug becomes structurally impossible, not merely
absent at one spot.

## The rule

**Never fix just where the error appears.** Trace back to the original trigger. After 3 failed
fixes, stop — it's a wrong design, not a failed hypothesis (HARRY.md §6).
