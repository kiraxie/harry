# Defense in Depth

You fixed a bug caused by an invalid value and added one validation check. That feels enough —
but a single check is bypassed by a different code path, by a later refactor, or by a mock.

**Core principle: validate at every layer the data passes through. Make the bug structurally
impossible, not merely absent today.**

Single validation says "we fixed the bug." Multiple layers say "we made the bug impossible."
Different layers catch different cases.

## The four layers

### Layer 1 — Entry-point validation
Reject obviously invalid input at the API boundary: empty, missing, wrong type, doesn't exist.

```typescript
function createProject(name: string, workingDirectory: string) {
  if (!workingDirectory?.trim()) throw new Error('workingDirectory cannot be empty');
  if (!existsSync(workingDirectory)) throw new Error(`does not exist: ${workingDirectory}`);
  if (!statSync(workingDirectory).isDirectory()) throw new Error(`not a directory: ${workingDirectory}`);
}
```

### Layer 2 — Business-logic validation
Ensure the data makes sense for *this* operation, deeper in the flow.

```typescript
function initializeWorkspace(projectDir: string, sessionId: string) {
  if (!projectDir) throw new Error('projectDir required for workspace initialization');
}
```

### Layer 3 — Environment guards
Refuse dangerous operations in contexts where they must never happen.

```typescript
async function gitInit(directory: string) {
  if (process.env.NODE_ENV === 'test') {
    const dir = normalize(resolve(directory));
    if (!dir.startsWith(normalize(resolve(tmpdir())))) {
      throw new Error(`Refusing git init outside temp dir during tests: ${directory}`);
    }
  }
}
```

### Layer 4 — Debug instrumentation
Capture context before the dangerous operation so that if every other layer fails, the
forensics are already recorded (directory, cwd, stack trace).

## Applying the pattern

1. **Trace the data flow** — where does the bad value originate, where is it used? (See `references/root-cause-tracing.md`.)
2. **Map every checkpoint** — list each point the data passes through.
3. **Add validation at each layer** — entry, business, environment, debug.
4. **Test each layer** — try to bypass layer 1, confirm layer 2 catches it.

## Why all four

Each layer catches what the others miss: different code paths bypass entry validation, mocks
bypass business checks, platform edge cases need environment guards, and debug logging exposes
structural misuse. Don't stop at one validation point.

This is **not** speculative over-building — the coupling already exists; the layers make an
existing invariant enforceable. (Reconcile with the ladder: validation infrastructure is never
the thing you trim.)
