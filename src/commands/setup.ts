/**
 * setup command — auth + model availability + quota + worktree housekeeping.
 */

import type { ModelInfo } from "@github/copilot-sdk";
import { CopilotClient } from "@github/copilot-sdk";
import { getCodexAuthStatus, getCodexAvailability } from "../lib/codex/auth.js";
import { checkAuth } from "../lib/copilot-auth.js";
import { fetchQuota, readSnapshot, summarize } from "../lib/quota.js";
import { resolveActiveProvider } from "../lib/run-agent-session.ts";
import { resolveStateDir } from "../lib/state.js";
import { CLIENT_NAME, PLUGIN_VERSION } from "../lib/version.js";

const DEFAULT_MODEL = "claude-opus-4.8";

export interface SetupOptions {
  check?: boolean;
  json?: boolean;
  cwd?: string;
  provider?: "copilot" | "codex";
}

interface SetupReport {
  status: "ok" | "error";
  authType?: string;
  login?: string;
  host?: string;
  defaultModel: string;
  defaultModelAvailable: boolean;
  models: string[];
  claudeModels: string[];
  quota?: ReturnType<typeof summarize>;
  message?: string;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const stateDir = resolveStateDir(cwd);
  const isCheck = options.check === true;

  // Provider routing goes through the SAME single authority the run commands use
  // (resolveActiveProvider), so `setup`/`status` can never show a different
  // provider than `ask`/`review`/`fix` actually run — an explicit `--provider`
  // flag or the CLAUDE_PLUGIN_OPTION_PROVIDER setting wins, else codex iff
  // installed AND logged in. For the SessionStart `setup --check` we suppress the
  // codex-usable probe (probe → false) so a copilot-default session start does
  // NOT spawn `codex` subprocesses just to decide routing.
  const { id } = await resolveActiveProvider(
    { provider: options.provider },
    cwd,
    isCheck ? { probe: async () => false } : {},
  );
  if (id === "codex") {
    await runCodexSetup(cwd, options, isCheck);
    return;
  }

  const client = new CopilotClient({ workingDirectory: cwd });

  try {
    await client.start();
  } catch (err) {
    const msg = `Failed to start Copilot CLI: ${(err as Error).message}`;
    if (isCheck) {
      console.error(
        `[copilot] ${msg} — run \`gh auth login\` and ensure @github/copilot is installed.`,
      );
      return;
    }
    emit(options, {
      status: "error",
      defaultModel: DEFAULT_MODEL,
      defaultModelAvailable: false,
      models: [],
      claudeModels: [],
      message: msg,
    });
    return;
  }

  const auth = await checkAuth(client);
  if (!auth.ok) {
    await client.stop().catch(() => {
      /* ignore */
    });
    if (isCheck) {
      console.error(`[copilot] ${auth.message}`);
      return;
    }
    emit(options, {
      status: "error",
      authType: auth.authType,
      defaultModel: DEFAULT_MODEL,
      defaultModelAvailable: false,
      models: [],
      claudeModels: [],
      message: auth.message,
    });
    return;
  }

  let models: ModelInfo[] = [];
  try {
    models = await client.listModels();
  } catch (err) {
    // Non-fatal — we still report auth success.
    if (!isCheck) console.error(`[copilot] listModels failed: ${(err as Error).message}`);
  }

  const modelIds = models.map((m) => m.id);
  const claudeModels = modelIds.filter((id) => id.toLowerCase().includes("claude"));
  const defaultAvailable = modelIds.includes(DEFAULT_MODEL);

  // Actively refresh the quota snapshot while the client is live — the SDK no
  // longer pushes quota via events, so this is how `setup` shows real numbers.
  await fetchQuota(client, stateDir).catch(() => null);

  await client.stop().catch(() => {
    /* ignore */
  });

  if (isCheck) {
    // SessionStart hook — silent success.
    return;
  }

  const report: SetupReport = {
    status: "ok",
    authType: auth.authType,
    login: auth.login,
    host: auth.host,
    defaultModel: DEFAULT_MODEL,
    defaultModelAvailable: defaultAvailable,
    models: modelIds,
    claudeModels,
    quota: summarize(readSnapshot(stateDir)),
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push(`## Copilot Plugin Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines.push("");
  lines.push(
    `**Status:** Authenticated (${auth.authType}${auth.login ? ` as ${auth.login}` : ""})`,
  );
  if (auth.host) lines.push(`**Host:** ${auth.host}`);
  lines.push(
    `**Default model:** \`${DEFAULT_MODEL}\` ${defaultAvailable ? "(available)" : "(NOT listed — pass --model to override)"}`,
  );
  // Quota is intentionally NOT shown here — it lives in `status` (the runtime
  // view) to avoid printing it twice in the merged /harry:status. setup still
  // refreshes the snapshot above (fetchQuota) so status shows fresh numbers.

  console.log(lines.join("\n"));
}

/**
 * Codex setup branch — availability + auth status only (no live rate-limit RPC
 * in v1). Reuses the Task 3 probes; never throws (getCodexAuthStatus is fail-safe).
 */
async function runCodexSetup(cwd: string, options: SetupOptions, isCheck: boolean): Promise<void> {
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
          provider: "codex",
          codex: {
            available: availability.available,
            availabilityDetail: availability.detail,
            loggedIn: auth.loggedIn,
            authMethod: auth.authMethod,
            detail: auth.detail,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines: string[] = [];
  lines.push(`## Codex Plugin Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines.push("");
  lines.push(`**Provider:** Codex`);
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

function emit(options: SetupOptions, report: SetupReport): void {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines: string[] = [];
  lines.push(`## Copilot Plugin Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines.push("");
  lines.push(`**Status:** ${report.status === "ok" ? "Authenticated" : "Not authenticated"}`);
  if (report.message) lines.push(`**Message:** ${report.message}`);
  console.log(lines.join("\n"));
}
