/**
 * setup command — Codex CLI availability and login state, from
 * `codex --version` and `codex login status`.
 */

import { CODEX_CLI_MISSING, codexMissing, spawnCodexSync } from "../lib/run-codex.ts";
import { CLIENT_NAME, PLUGIN_VERSION } from "../lib/version.ts";

export interface SetupOptions {
  json?: boolean;
  cwd?: string;
}

interface CodexCall {
  missing: boolean;
  status: number | null;
  /** Non-empty output lines, stderr (where `login status` reports) then stdout. */
  lines: string[];
}

function callCodex(cwd: string, args: string[]): CodexCall {
  const res = spawnCodexSync(args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (codexMissing(res)) return { missing: true, status: null, lines: [] };
  if (res.error) throw res.error;
  const lines = `${String(res.stderr ?? "")}\n${String(res.stdout ?? "")}`
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return { missing: false, status: res.status, lines };
}

/**
 * The line matching `pattern`, else the last line. Selected by content, not
 * position: codex can print a startup warning before its real output.
 */
function pickLine(call: CodexCall, pattern: RegExp): string {
  return call.lines.find((l) => pattern.test(l)) ?? call.lines.at(-1) ?? "";
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  const versionCall = callCodex(cwd, ["--version"]);
  const available = !versionCall.missing && versionCall.status === 0;
  const version = available
    ? pickLine(versionCall, /^codex-cli\s+\S/).replace(/^codex-cli\s+/, "")
    : null;
  const loginCall = available ? callCodex(cwd, ["login", "status"]) : undefined;
  // The exit code decides login state; the line is only the human-readable detail.
  const loggedIn = loginCall?.status === 0;
  const detail = versionCall.missing
    ? CODEX_CLI_MISSING
    : !available
      ? `codex --version failed (exit ${versionCall.status}): ${pickLine(versionCall, /^codex-cli\s/)}`
      : (loginCall && pickLine(loginCall, /\b(?:Not logged in|Logged in)\b/i)) ||
        `codex login status exited ${loginCall?.status}`;

  if (options.json) {
    console.log(
      JSON.stringify(
        { status: loggedIn ? "ok" : "error", available, version, loggedIn, detail },
        null,
        2,
      ),
    );
    return;
  }

  const lines: string[] = [];
  lines.push(`## Codex Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines.push("");
  lines.push(`**Availability:** ${available ? `available — codex-cli ${version}` : "unavailable"}`);
  lines.push(`**Status:** ${loggedIn ? "Authenticated" : "Not authenticated"}`);
  lines.push(`**Detail:** ${detail}`);
  if (!available) {
    lines.push("");
    lines.push("### Next steps");
    lines.push("- Install the Codex CLI, run `codex login`, then re-run setup.");
  } else if (!loggedIn) {
    lines.push("");
    lines.push("### Next steps");
    lines.push("- Run `codex login` to authenticate, then re-run setup.");
  }
  console.log(lines.join("\n"));
}
