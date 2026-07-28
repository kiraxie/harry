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
