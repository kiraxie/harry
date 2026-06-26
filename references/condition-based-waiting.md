# Condition-Based Waiting

Flaky tests guess at timing with arbitrary delays (`setTimeout`, `sleep`, `time.sleep`). That
creates a race: the test passes on a fast machine and fails under load or in CI.

**Core principle: wait for the actual condition you care about, not a guess about how long it
takes.**

## When to use

- Tests have arbitrary delays
- Tests are flaky — pass sometimes, fail under load
- Tests time out when run in parallel
- Waiting for an async operation to complete

**Don't** replace a delay that is genuinely testing timing behavior (debounce, throttle
intervals) — but always document *why* the timeout is needed.

## Core pattern

```typescript
// BEFORE: guessing at timing
await new Promise(r => setTimeout(r, 50));
const result = getResult();
expect(result).toBeDefined();

// AFTER: waiting for the condition
await waitFor(() => getResult() !== undefined);
const result = getResult();
expect(result).toBeDefined();
```

## Quick patterns

| Scenario | Pattern |
|----------|---------|
| Wait for event | `waitFor(() => events.find(e => e.type === 'DONE'))` |
| Wait for state | `waitFor(() => machine.state === 'ready')` |
| Wait for count | `waitFor(() => items.length >= 5)` |
| Wait for file | `waitFor(() => fs.existsSync(path))` |
| Complex condition | `waitFor(() => obj.ready && obj.value > 10)` |

## Implementation

```typescript
async function waitFor<T>(
  condition: () => T | undefined | null | false,
  description: string,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  while (true) {
    const result = condition();
    if (result) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }
    await new Promise(r => setTimeout(r, 10)); // poll every 10ms
  }
}
```

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Polling too fast (`setTimeout(check, 1)`) — wastes CPU | Poll every ~10ms |
| No timeout — loops forever if the condition never holds | Always include a timeout with a clear error |
| Stale data — state cached before the loop | Call the getter *inside* the loop for fresh data |

## When an arbitrary timeout IS correct

```typescript
await waitForEvent(manager, 'TOOL_STARTED'); // 1. wait for the triggering condition
await new Promise(r => setTimeout(r, 200));   // 2. then wait a known, justified interval
// 200ms = 2 ticks at 100ms intervals — documented and justified
```

Requirements: (1) first wait for the triggering condition, (2) base the delay on known timing,
not a guess, (3) comment explaining *why*.
