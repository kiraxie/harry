/**
 * status command — shows the cached Codex rate-limit snapshot.
 */

import { readCodexRateLimits, renderCodexBlock, resolveStateDir } from "../lib/state.ts";

export interface StatusOptions {
  json?: boolean;
}

export async function runStatus(cwd: string, options: StatusOptions = {}): Promise<void> {
  const stateDir = resolveStateDir(cwd);
  const codexRateLimits = readCodexRateLimits(stateDir);

  // Reachable only by running this CLI directly — `commands/status.md` forwards no
  // arguments, deliberately: that door tells the agent to return stdout verbatim as
  // markdown for a human to read, which JSON would make worse. Not the
  // no-shipped-producer shape that retired the job records, though: `setup` has no
  // door at all and carries the same flag, so direct invocation is a supported
  // surface here, not an orphan. `printUsage` advertises both.
  //
  // Guarded end-to-end by `tests/cli-surface.test.ts`, NOT by args.test.ts's
  // "status accepts --json" — that one pins the parser, one layer below this, and
  // stays green while `companion.ts` stops forwarding the flag entirely.
  if (options.json) {
    console.log(JSON.stringify(codexRateLimits ? { codex: codexRateLimits } : {}, null, 2));
    return;
  }

  if (!codexRateLimits) {
    // Snapshots are written by an actual codex turn, so an empty cache means
    // "nothing has run here yet", not an error.
    console.log("_No Codex rate-limit snapshot yet — run a review, ask, or fix first._");
    return;
  }

  console.log(renderCodexBlock(codexRateLimits, codexRateLimits.capturedAt));
}
