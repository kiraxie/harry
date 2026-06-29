// Portions Copyright 2026 OpenAI, licensed under Apache-2.0.
// Modified from codex-plugin-cc (broker transport removed; ported to TypeScript).
// See NOTICE.

import { CodexAppServerClient } from "./app-server.ts";
import { binaryAvailable } from "./process.ts";

/** Result of probing whether codex is installed and its app-server runtime works. */
export interface CodexAvailability {
  available: boolean;
  detail: string;
}

/** Authentication status of the local codex installation. */
export interface CodexAuthStatus {
  available: boolean;
  loggedIn: boolean;
  detail: string;
  authMethod: "chatgpt" | "apiKey" | string | null;
  verified: boolean | null;
}

const BUILTIN_PROVIDER_LABELS = new Map<string, string>([
  ["openai", "OpenAI"],
  ["ollama", "Ollama"],
  ["lmstudio", "LM Studio"]
]);

interface AccountReadResponse {
  account?: { type?: string; email?: string } | null;
  requiresOpenaiAuth?: boolean;
}

interface ConfigReadResponse {
  config?: { model_provider?: string; model_providers?: Record<string, unknown> } | null;
}

function normalizeProviderId(value: unknown): string | null {
  const providerId = typeof value === "string" ? value.trim() : "";
  return providerId || null;
}

function resolveProviderConfig(configResponse: ConfigReadResponse | null): {
  providerId: string | null;
  providerConfig: { name?: string } | null;
} {
  const config = configResponse?.config;
  if (!config || typeof config !== "object") {
    return { providerId: null, providerConfig: null };
  }

  const providerId = normalizeProviderId(config.model_provider);
  const providers =
    config.model_providers && typeof config.model_providers === "object" && !Array.isArray(config.model_providers)
      ? (config.model_providers as Record<string, unknown>)
      : null;
  const candidate = providerId && providers ? providers[providerId] : null;
  const providerConfig = candidate && typeof candidate === "object" ? (candidate as { name?: string }) : null;

  return { providerId, providerConfig };
}

function formatProviderLabel(providerId: string | null, providerConfig: { name?: string } | null): string {
  const configuredName = typeof providerConfig?.name === "string" ? providerConfig.name.trim() : "";
  if (configuredName) {
    return configuredName;
  }
  if (!providerId) {
    return "The active provider";
  }
  return BUILTIN_PROVIDER_LABELS.get(providerId) ?? providerId;
}

function notLoggedIn(detail: string): CodexAuthStatus {
  return { available: true, loggedIn: false, detail, authMethod: null, verified: null };
}

function buildAppServerAuthStatus(
  accountResponse: AccountReadResponse | null,
  configResponse: ConfigReadResponse | null
): CodexAuthStatus {
  const account = accountResponse?.account ?? null;
  const requiresOpenaiAuth =
    typeof accountResponse?.requiresOpenaiAuth === "boolean" ? accountResponse.requiresOpenaiAuth : null;
  const { providerId, providerConfig } = resolveProviderConfig(configResponse);
  const providerLabel = formatProviderLabel(providerId, providerConfig);

  if (account?.type === "chatgpt") {
    const email = typeof account.email === "string" && account.email.trim() ? account.email.trim() : null;
    return {
      available: true,
      loggedIn: true,
      detail: email ? `ChatGPT login active for ${email}` : "ChatGPT login active",
      authMethod: "chatgpt",
      verified: true
    };
  }

  if (account?.type === "apiKey") {
    return {
      available: true,
      loggedIn: true,
      detail: "API key configured (unverified)",
      authMethod: "apiKey",
      verified: false
    };
  }

  if (requiresOpenaiAuth === false) {
    return {
      available: true,
      loggedIn: true,
      detail: `${providerLabel} is configured and does not require OpenAI authentication`,
      authMethod: providerId,
      verified: null
    };
  }

  return notLoggedIn(`${providerLabel} requires OpenAI authentication`);
}

/**
 * Probe whether `codex` is installed and its app-server runtime is usable.
 * Runs `codex --version` then `codex app-server --help`. Synchronous.
 */
export function getCodexAvailability(cwd: string): CodexAvailability {
  const versionStatus = binaryAvailable("codex", ["--version"], { cwd });
  if (!versionStatus.available) {
    return versionStatus;
  }

  const appServerStatus = binaryAvailable("codex", ["app-server", "--help"], { cwd });
  if (!appServerStatus.available) {
    return {
      available: false,
      detail: `${versionStatus.detail}; advanced runtime unavailable: ${appServerStatus.detail}`
    };
  }

  return {
    available: true,
    detail: `${versionStatus.detail}; advanced runtime available`
  };
}

/**
 * Resolve the codex authentication status. Short-circuits when codex is
 * unavailable. Never throws: connection or RPC failures resolve to a
 * not-logged-in status carrying the failure detail.
 */
export async function getCodexAuthStatus(
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<CodexAuthStatus> {
  const availability = getCodexAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail,
      authMethod: null,
      verified: null
    };
  }

  let client: CodexAppServerClient | null = null;
  try {
    client = await CodexAppServerClient.connect(cwd, {
      env: opts.env,
      disableBroker: true
    });
    const accountResponse = await client.request<AccountReadResponse>("account/read", {
      refreshToken: false
    });
    const configResponse = await client.request<ConfigReadResponse>("config/read", {
      includeLayers: false,
      cwd
    });
    return buildAppServerAuthStatus(accountResponse, configResponse);
  } catch (error) {
    return notLoggedIn(error instanceof Error ? error.message : String(error));
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}
