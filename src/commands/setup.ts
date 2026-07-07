/**
 * setup command — Codex availability + auth status.
 */

// Deliberate second entry point into the vendored codex layer: setup needs the
// availability + authMethod detail that the neutral `AuthSummary` (provider.ts)
// intentionally omits, and widening that single-impl interface just for setup
// would be unearned abstraction (HARRY.md §1). Kept a clean top-level import (no
// reach into internals) — upstream-sync of codex/auth.ts must re-check this file.
import { getCodexAuthStatus, getCodexAvailability } from "../lib/codex/auth.ts";
import { CLIENT_NAME, PLUGIN_VERSION } from "../lib/version.ts";

export interface SetupOptions {
  json?: boolean;
  cwd?: string;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  const availability = getCodexAvailability(cwd);
  const auth = await getCodexAuthStatus(cwd);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          status: auth.loggedIn ? "ok" : "error",
          available: availability.available,
          availabilityDetail: availability.detail,
          loggedIn: auth.loggedIn,
          authMethod: auth.authMethod,
          detail: auth.detail,
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines: string[] = [];
  lines.push(`## Codex Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines.push("");
  lines.push(
    `**Availability:** ${availability.available ? "available" : "unavailable"} — ${availability.detail}`,
  );
  lines.push(
    `**Status:** ${auth.loggedIn ? "Authenticated" : "Not authenticated"}${auth.authMethod ? ` (${auth.authMethod})` : ""}`,
  );
  lines.push(`**Detail:** ${auth.detail}`);
  if (!auth.loggedIn) {
    lines.push("");
    lines.push("### Next steps");
    lines.push("- Run `codex login` to authenticate, then re-run setup.");
  }
  console.log(lines.join("\n"));
}
