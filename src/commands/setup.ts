/**
 * setup command — Codex availability + auth status.
 */

import { getCodexAuthStatus, getCodexAvailability } from "../lib/codex/auth.js";
import { CLIENT_NAME, PLUGIN_VERSION } from "../lib/version.js";

export interface SetupOptions {
  check?: boolean;
  json?: boolean;
  cwd?: string;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const isCheck = options.check === true;

  if (isCheck) {
    // SessionStart hook — silent success. Return BEFORE the availability/auth
    // probe so we do not spawn `codex app-server` (a full connect + account/read
    // + config/read RPC) on every session start just to discard the result.
    return;
  }

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
