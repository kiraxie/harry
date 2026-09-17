#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/companion.ts
var import_node_process3 = __toESM(require("node:process"), 1);

// src/lib/models.ts
var DEFAULTS = {
  judgment: "gpt-5.6-sol"
};
var ENV_VAR = {
  judgment: "HARRY_MODEL_JUDGMENT"
};
function resolveModel(role, env = process.env) {
  const override = env[ENV_VAR[role]]?.trim();
  return override || DEFAULTS[role];
}
var MODEL_WITHOUT_SOL = "gpt-5.6-luna";
var PINNED_MODELS = Object.values(DEFAULTS);
var ROLE_MAP_ONLY_MODEL = "gpt-5.6-terra";
var KNOWN_MODELS = [
  ...PINNED_MODELS,
  MODEL_WITHOUT_SOL,
  ROLE_MAP_ONLY_MODEL
];

// src/lib/codex/app-server.ts
var import_node_child_process2 = require("node:child_process");
var import_node_process2 = __toESM(require("node:process"), 1);
var import_node_readline = __toESM(require("node:readline"), 1);

// package.json
var package_default = {
  name: "harry",
  version: "0.21.0",
  description: "Personal engineering workflow plugin distilled from Superpowers + ponytail, fused with multi-model review/debate.",
  type: "module",
  license: "MIT",
  author: "kiraxie <kiraxie11287@gmail.com>",
  homepage: "https://github.com/kiraxie/harry",
  repository: "https://github.com/kiraxie/harry",
  engines: {
    node: ">=26.0.0"
  },
  packageManager: "pnpm@10.33.0",
  scripts: {
    build: "node build.mjs",
    test: "node --test",
    typecheck: "tsc -p tsconfig.json --noEmit",
    lint: "biome check .",
    format: "biome format --write .",
    "install-laws": "node scripts/install.mjs",
    "install-laws-codex": "node scripts/install-codex.mjs",
    "init-ignore": "node scripts/init.mjs",
    evals: "node scripts/run-evals.mjs"
  },
  dependencies: {},
  devDependencies: {
    "@biomejs/biome": "^2.5.1",
    "@types/node": "^26.0.1",
    esbuild: "^0.28.1",
    typescript: "^7.0.2"
  }
};

// src/lib/version.ts
var PLUGIN_VERSION = package_default.version;
var CLIENT_NAME = "harry";

// src/lib/codex/process.ts
var import_node_child_process = require("node:child_process");
var import_node_process = __toESM(require("node:process"), 1);
function runCommand(command, args = [], options = {}) {
  const result = (0, import_node_child_process.spawnSync)(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: "pipe",
    shell: import_node_process.default.platform === "win32" ? import_node_process.default.env.SHELL || true : false,
    windowsHide: true
  });
  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}
function binaryAvailable(bin, args = ["--version"], opts = {}) {
  const result = runCommand(bin, args, opts);
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}
function looksLikeMissingProcessMessage(text) {
  return /not found|no running instance|cannot find|does not exist|no such process/i.test(text);
}
function terminateProcessTree(pid) {
  if (!Number.isFinite(pid)) {
    return;
  }
  if (import_node_process.default.platform === "win32") {
    const result = runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    if (!result.error && result.status === 0) {
      return;
    }
    const combinedOutput = `${result.stderr}
${result.stdout}`.trim();
    if (!result.error && looksLikeMissingProcessMessage(combinedOutput)) {
      return;
    }
    if (result.error?.code === "ENOENT") {
      try {
        import_node_process.default.kill(pid);
      } catch (error) {
        if (error?.code === "ESRCH") {
          return;
        }
        throw error;
      }
      return;
    }
    if (result.error) {
      throw result.error;
    }
    return;
  }
  try {
    import_node_process.default.kill(-pid, "SIGTERM");
  } catch {
    try {
      import_node_process.default.kill(pid, "SIGTERM");
    } catch (innerError) {
      if (innerError?.code !== "ESRCH") {
        throw innerError;
      }
    }
  }
}

// src/lib/codex/app-server.ts
var DEFAULT_CONNECT_TIMEOUT_MS = 60 * 1e3;
var CLOSE_SIGTERM_DELAY_MS = 50;
var CLOSE_SIGKILL_GRACE_MS = 500;
var CLOSE_EXIT_WAIT_MS = 3e3;
var DEFAULT_CLIENT_INFO = {
  title: "harry",
  name: "harry",
  version: PLUGIN_VERSION
};
var DEFAULT_CAPABILITIES = {
  experimentalApi: false,
  requestAttestation: false,
  optOutNotificationMethods: [
    "item/agentMessage/delta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/textDelta"
  ]
};
function buildJsonRpcError(code, message, data) {
  return data === void 0 ? { code, message } : { code, message, data };
}
function createProtocolError(message, data) {
  const error = new Error(message);
  error.data = data;
  if (data && typeof data === "object" && data.code !== void 0) {
    error.rpcCode = data.code;
  }
  return error;
}
var CodexAppServerClient = class _CodexAppServerClient {
  cwd;
  options;
  pending = /* @__PURE__ */ new Map();
  nextId = 1;
  stderrBuffer = "";
  closed = false;
  exitResolved = false;
  exitError = null;
  notificationHandler = null;
  proc = null;
  readline = null;
  exitPromise;
  resolveExit;
  constructor(cwd, options) {
    this.cwd = cwd;
    this.options = options;
    this.exitPromise = new Promise((resolve3) => {
      this.resolveExit = resolve3;
    });
  }
  static async connect(cwd, opts = {}) {
    const client = new _CodexAppServerClient(cwd, opts);
    await client.initialize(opts.connectTimeoutMs);
    return client;
  }
  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }
  get stderr() {
    return this.stderrBuffer;
  }
  request(method, params) {
    if (this.closed) {
      return Promise.reject(new Error("codex app-server client is closed."));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve3, reject) => {
      this.pending.set(id, { resolve: resolve3, reject, method });
      this.sendMessage({ id, method, params });
    });
  }
  notify(method, params = {}) {
    if (this.closed) {
      return;
    }
    this.sendMessage({ method, params });
  }
  handleLine(line) {
    if (!line.trim()) {
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.handleExit(
        createProtocolError(
          `Failed to parse codex app-server JSONL: ${error.message}`,
          { line }
        )
      );
      return;
    }
    if (message.id !== void 0 && message.method) {
      this.handleServerRequest(message);
      return;
    }
    if (message.id !== void 0) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          createProtocolError(
            message.error.message ?? `codex app-server ${pending.method} failed.`,
            message.error
          )
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method && this.notificationHandler) {
      this.notificationHandler(message);
    }
  }
  handleServerRequest(message) {
    this.sendMessage({
      id: message.id,
      error: buildJsonRpcError(-32601, `Unsupported server request: ${message.method}`)
    });
  }
  handleExit(error) {
    if (this.exitResolved) {
      return;
    }
    this.exitResolved = true;
    this.exitError = error ?? null;
    for (const pending of this.pending.values()) {
      pending.reject(this.exitError ?? new Error("codex app-server connection closed."));
    }
    this.pending.clear();
    this.resolveExit();
  }
  async initialize(connectTimeoutMs) {
    this.proc = (0, import_node_child_process2.spawn)("codex", ["app-server"], {
      cwd: this.cwd,
      env: this.options.env ?? import_node_process2.default.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: import_node_process2.default.platform === "win32" ? import_node_process2.default.env.SHELL || true : false,
      windowsHide: true
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => {
      this.stderrBuffer += chunk;
    });
    this.proc.stdin.on("error", () => {
    });
    this.proc.stdout.on("error", () => {
    });
    this.proc.on("error", (error) => {
      this.handleExit(error);
    });
    this.proc.on("exit", (code, signal) => {
      const stderr = this.stderrBuffer.trim();
      const detail = code === 0 ? null : createProtocolError(
        `codex app-server exited unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}).${stderr ? `
${stderr}` : ""}`
      );
      this.handleExit(detail);
    });
    this.readline = import_node_readline.default.createInterface({ input: this.proc.stdout });
    this.readline.on("line", (line) => {
      this.handleLine(line);
    });
    const initRequest = this.request("initialize", {
      clientInfo: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES
    });
    if (connectTimeoutMs !== void 0 && connectTimeoutMs > 0) {
      let timer = null;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const stderr = this.stderrBuffer.trim();
          reject(
            createProtocolError(
              `codex app-server did not answer initialize within ${connectTimeoutMs}ms.${stderr ? `
${stderr}` : ""}`
            )
          );
        }, connectTimeoutMs);
        timer.unref?.();
      });
      initRequest.catch(() => {
      });
      try {
        await Promise.race([initRequest, timeout]);
      } catch (error) {
        if (timer) {
          clearTimeout(timer);
        }
        await this.close();
        throw error;
      }
      if (timer) {
        clearTimeout(timer);
      }
    } else {
      try {
        await initRequest;
      } catch (error) {
        await this.close();
        throw error;
      }
    }
    this.notify("initialized", {});
  }
  async close() {
    if (this.closed) {
      await this.waitForExit();
      return;
    }
    this.closed = true;
    if (this.readline) {
      this.readline.close();
    }
    if (this.proc && !this.proc.killed) {
      this.proc.stdin.end();
      const proc = this.proc;
      const termTimer = setTimeout(() => {
        if (proc.killed || proc.exitCode !== null) {
          return;
        }
        if (import_node_process2.default.platform === "win32") {
          try {
            if (proc.pid !== void 0) {
              terminateProcessTree(proc.pid);
            }
          } catch {
          }
          return;
        }
        proc.kill("SIGTERM");
        const killTimer = setTimeout(() => {
          if (!proc.killed && proc.exitCode === null) {
            proc.kill("SIGKILL");
          }
        }, CLOSE_SIGKILL_GRACE_MS);
        killTimer.unref?.();
      }, CLOSE_SIGTERM_DELAY_MS);
      termTimer.unref?.();
    }
    await this.waitForExit();
  }
  /**
   * Wait for the child to exit, but never longer than CLOSE_EXIT_WAIT_MS. Even
   * with SIGKILL escalation a grandchild can keep stdio open or 'exit' can be
   * delayed; this bound guarantees close() always resolves so a caller's
   * `await client.close()` in a finally block can't hang the host.
   */
  async waitForExit() {
    let timer = null;
    const bound = new Promise((resolve3) => {
      timer = setTimeout(resolve3, CLOSE_EXIT_WAIT_MS);
      timer.unref?.();
    });
    try {
      await Promise.race([this.exitPromise, bound]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  sendMessage(message) {
    const line = `${JSON.stringify(message)}
`;
    const stdin = this.proc?.stdin;
    if (!stdin) {
      throw new Error("codex app-server stdin is not available.");
    }
    stdin.write(line);
  }
};

// src/lib/codex/auth.ts
var BUILTIN_PROVIDER_LABELS = /* @__PURE__ */ new Map([
  ["openai", "OpenAI"],
  ["ollama", "Ollama"],
  ["lmstudio", "LM Studio"]
]);
function normalizeProviderId(value) {
  const providerId = typeof value === "string" ? value.trim() : "";
  return providerId || null;
}
function resolveProviderConfig(configResponse) {
  const config = configResponse?.config;
  if (!config || typeof config !== "object") {
    return { providerId: null, providerConfig: null };
  }
  const providerId = normalizeProviderId(config.model_provider);
  const providers = config.model_providers && typeof config.model_providers === "object" && !Array.isArray(config.model_providers) ? config.model_providers : null;
  const candidate = providerId && providers ? providers[providerId] : null;
  const providerConfig = candidate && typeof candidate === "object" ? candidate : null;
  return { providerId, providerConfig };
}
function formatProviderLabel(providerId, providerConfig) {
  const configuredName = typeof providerConfig?.name === "string" ? providerConfig.name.trim() : "";
  if (configuredName) {
    return configuredName;
  }
  if (!providerId) {
    return "The active provider";
  }
  return BUILTIN_PROVIDER_LABELS.get(providerId) ?? providerId;
}
function notLoggedIn(detail) {
  return { available: true, loggedIn: false, detail, authMethod: null, verified: null };
}
function buildAppServerAuthStatus(accountResponse, configResponse) {
  const account = accountResponse?.account ?? null;
  const requiresOpenaiAuth = typeof accountResponse?.requiresOpenaiAuth === "boolean" ? accountResponse.requiresOpenaiAuth : null;
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
function getCodexAvailability(cwd, opts = {}) {
  const versionStatus = binaryAvailable("codex", ["--version"], { cwd, env: opts.env });
  if (!versionStatus.available) {
    return versionStatus;
  }
  const appServerStatus = binaryAvailable("codex", ["app-server", "--help"], {
    cwd,
    env: opts.env
  });
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
async function getCodexAuthStatus(cwd, opts = {}) {
  const availability = getCodexAvailability(cwd, { env: opts.env });
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail,
      authMethod: null,
      verified: null
    };
  }
  let client = null;
  try {
    client = await CodexAppServerClient.connect(cwd, {
      env: opts.env,
      // Anti-hang: this probe runs on the default provider-resolution path of
      // every auto ask/review/fix and in SessionStart setup. Without a ceiling,
      // a child that spawns but blocks before answering `initialize` (broken
      // install, interactive/auth prompt) makes connect() await forever — a
      // hang no try/catch can rescue.
      connectTimeoutMs: opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    });
    const accountResponse = await client.request("account/read", {
      refreshToken: false
    });
    const configResponse = await client.request("config/read", {
      includeLayers: false,
      cwd
    });
    return buildAppServerAuthStatus(accountResponse, configResponse);
  } catch (error) {
    return notLoggedIn(error instanceof Error ? error.message : String(error));
  } finally {
    if (client) {
      await client.close().catch(() => {
      });
    }
  }
}

// src/lib/codex/turn.ts
var DEFAULT_TURN_TIMEOUT_MS = 15 * 60 * 1e3;
function buildTurnInput(prompt, instructions) {
  const items = [];
  const trimmed = instructions?.trim();
  if (trimmed) {
    items.push({ type: "text", text: trimmed, text_elements: [] });
  }
  items.push({ type: "text", text: prompt, text_elements: [] });
  return items;
}
function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`;
}
function extractThreadId(message) {
  return message?.params?.threadId ?? null;
}
function extractTurnId(message) {
  if (message?.params?.turnId) {
    return message.params.turnId;
  }
  if (message?.params?.turn?.id) {
    return message.params.turn.id;
  }
  return null;
}
function normalizeReasoningText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
function extractReasoningSections(value) {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    const normalized = normalizeReasoningText(value);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractReasoningSections(entry));
  }
  if (typeof value === "object") {
    const obj = value;
    if (typeof obj.text === "string") {
      return extractReasoningSections(obj.text);
    }
    if ("summary" in obj) {
      return extractReasoningSections(obj.summary);
    }
    if ("content" in obj) {
      return extractReasoningSections(obj.content);
    }
    if ("parts" in obj) {
      return extractReasoningSections(obj.parts);
    }
  }
  return [];
}
function mergeReasoningSections(existing, next) {
  const merged = [];
  for (const section of [...existing, ...next]) {
    const normalized = normalizeReasoningText(section);
    if (!normalized || merged.includes(normalized)) {
      continue;
    }
    merged.push(normalized);
  }
  return merged;
}
function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function parseTokenCount(params) {
  const usage = {};
  const lastUsage = params?.last_token_usage;
  if (lastUsage && typeof lastUsage === "object") {
    usage.inputTokens = toFiniteNumber(lastUsage.input_tokens);
    usage.outputTokens = toFiniteNumber(lastUsage.output_tokens);
  }
  const rateLimits = params?.rate_limits;
  if (rateLimits && typeof rateLimits === "object") {
    const parsed = {};
    const primary = toFiniteNumber(rateLimits.primary?.used_percent);
    if (primary !== void 0) {
      parsed.primaryUsedPercent = primary;
    }
    const secondary = toFiniteNumber(rateLimits.secondary?.used_percent);
    if (secondary !== void 0) {
      parsed.secondaryUsedPercent = secondary;
    }
    if (typeof rateLimits.plan_type === "string") {
      parsed.planType = rateLimits.plan_type;
    }
    if (typeof rateLimits.resets_at === "string") {
      parsed.resetsAt = rateLimits.resets_at;
    }
    if (Object.keys(parsed).length > 0) {
      usage.rateLimits = parsed;
    }
  }
  return usage;
}
function parseThreadTokenUsage(params) {
  const usage = {};
  const last = params?.tokenUsage?.last;
  if (last && typeof last === "object") {
    usage.inputTokens = toFiniteNumber(last.inputTokens);
    usage.outputTokens = toFiniteNumber(last.outputTokens);
  }
  return usage;
}
function parseAccountRateLimits(params) {
  const rateLimits = params?.rateLimits;
  if (!rateLimits || typeof rateLimits !== "object") {
    return {};
  }
  const parsed = {};
  const primary = toFiniteNumber(rateLimits.primary?.usedPercent);
  if (primary !== void 0) {
    parsed.primaryUsedPercent = primary;
  }
  const secondary = toFiniteNumber(rateLimits.secondary?.usedPercent);
  if (secondary !== void 0) {
    parsed.secondaryUsedPercent = secondary;
  }
  const primaryWindow = toFiniteNumber(rateLimits.primary?.windowDurationMins);
  if (primaryWindow !== void 0) {
    parsed.primaryWindowMinutes = primaryWindow;
  }
  const secondaryWindow = toFiniteNumber(rateLimits.secondary?.windowDurationMins);
  if (secondaryWindow !== void 0) {
    parsed.secondaryWindowMinutes = secondaryWindow;
  }
  if (typeof rateLimits.planType === "string") {
    parsed.planType = rateLimits.planType;
  }
  const resetsAt = toFiniteNumber(rateLimits.primary?.resetsAt);
  if (resetsAt !== void 0) {
    const asDate = new Date(resetsAt * 1e3);
    if (!Number.isNaN(asDate.getTime())) {
      parsed.resetsAt = asDate.toISOString();
    }
  }
  return Object.keys(parsed).length > 0 ? { rateLimits: parsed } : {};
}
function foldRateLimits(prev, next) {
  if (!prev) {
    return next;
  }
  if (!next) {
    return prev;
  }
  return {
    primaryUsedPercent: next.primaryUsedPercent ?? prev.primaryUsedPercent,
    secondaryUsedPercent: next.secondaryUsedPercent ?? prev.secondaryUsedPercent,
    primaryWindowMinutes: next.primaryWindowMinutes ?? prev.primaryWindowMinutes,
    secondaryWindowMinutes: next.secondaryWindowMinutes ?? prev.secondaryWindowMinutes,
    planType: next.planType ?? prev.planType,
    resetsAt: next.resetsAt ?? prev.resetsAt
  };
}
function createTurnCaptureState(threadId, onItem) {
  let resolveCompletion;
  const completion = new Promise((resolve3) => {
    resolveCompletion = resolve3;
  });
  return {
    threadId,
    threadIds: /* @__PURE__ */ new Set([threadId]),
    threadTurnIds: /* @__PURE__ */ new Map(),
    turnId: null,
    turnStarted: false,
    bufferedNotifications: [],
    completion,
    resolveCompletion,
    finalTurn: null,
    completed: false,
    finalAnswerSeen: false,
    pendingCollaborations: /* @__PURE__ */ new Set(),
    activeSubagentTurns: /* @__PURE__ */ new Set(),
    completionTimer: null,
    lastAgentMessage: "",
    reasoningSummary: [],
    error: null,
    usage: null,
    onItem
  };
}
function registerThread(state, threadId) {
  if (threadId) {
    state.threadIds.add(threadId);
  }
}
function belongsToTurn(state, message) {
  const messageThreadId = extractThreadId(message);
  if (!messageThreadId || !state.threadIds.has(messageThreadId)) {
    return false;
  }
  const trackedTurnId = state.threadTurnIds.get(messageThreadId) ?? null;
  const messageTurnId = extractTurnId(message);
  return trackedTurnId === null || messageTurnId === null || messageTurnId === trackedTurnId;
}
function shouldApplyNotification(state, message) {
  if (message.method === "thread/started") {
    return true;
  }
  if (message.method === "token_count" || message.method === "thread/tokenUsage/updated" || message.method === "account/rateLimits/updated" || message.method === "error") {
    return true;
  }
  return belongsToTurn(state, message);
}
function clearCompletionTimer(state) {
  if (state.completionTimer) {
    clearTimeout(state.completionTimer);
    state.completionTimer = null;
  }
}
function completeTurn(state, turn = null) {
  if (state.completed) {
    return;
  }
  clearCompletionTimer(state);
  state.completed = true;
  if (turn) {
    state.finalTurn = turn;
    if (!state.turnId && turn.id) {
      state.turnId = turn.id;
    }
  } else if (!state.finalTurn) {
    state.finalTurn = { id: state.turnId ?? "inferred-turn", status: "completed" };
  }
  state.resolveCompletion();
}
function scheduleInferredCompletion(state) {
  if (state.completed || state.finalTurn || !state.finalAnswerSeen) {
    return;
  }
  if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) {
    return;
  }
  clearCompletionTimer(state);
  state.completionTimer = setTimeout(() => {
    state.completionTimer = null;
    if (state.completed || state.finalTurn || !state.finalAnswerSeen) {
      return;
    }
    if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) {
      return;
    }
    completeTurn(state, null);
  }, 250);
  state.completionTimer.unref?.();
}
function toolLabel(item) {
  switch (item.type) {
    case "commandExecution":
      return `Running command: ${shorten(item.command)}`;
    case "fileChange":
      return `Applying ${item.changes?.length ?? 0} file change(s).`;
    case "mcpToolCall":
      return `Calling ${item.server}/${item.tool}.`;
    case "dynamicToolCall":
      return `Running tool: ${item.tool}.`;
    case "webSearch":
      return `Searching: ${shorten(item.query)}`;
    default:
      return null;
  }
}
function recordItem(state, item, lifecycle, threadId = null) {
  if (item.type === "collabAgentToolCall") {
    if (!threadId || threadId === state.threadId) {
      if (lifecycle === "started" || item.status === "inProgress") {
        state.pendingCollaborations.add(item.id);
      } else if (lifecycle === "completed") {
        state.pendingCollaborations.delete(item.id);
        scheduleInferredCompletion(state);
      }
    }
    for (const receiverThreadId of item.receiverThreadIds ?? []) {
      registerThread(state, receiverThreadId);
    }
  }
  if (item.type === "agentMessage") {
    if (item.text && (!threadId || threadId === state.threadId)) {
      state.lastAgentMessage = item.text;
      const final = lifecycle === "completed" && item.phase === "final_answer";
      if (final) {
        state.finalAnswerSeen = true;
        scheduleInferredCompletion(state);
      }
      if (lifecycle === "completed") {
        state.onItem?.({ kind: "assistant", text: item.text, final });
      }
    }
    return;
  }
  if (item.type === "reasoning" && lifecycle === "completed") {
    const nextSections = extractReasoningSections(item.summary);
    state.reasoningSummary = mergeReasoningSections(state.reasoningSummary, nextSections);
    for (const section of nextSections) {
      state.onItem?.({ kind: "reasoning", text: section });
    }
    return;
  }
  if (lifecycle === "started") {
    const label = toolLabel(item);
    if (label) {
      state.onItem?.({ kind: "tool", label });
    }
  }
}
function applyTurnNotification(state, message) {
  switch (message.method) {
    case "thread/started":
      registerThread(state, message.params?.thread?.id);
      break;
    case "turn/started":
      registerThread(state, message.params?.threadId);
      state.threadTurnIds.set(message.params?.threadId, message.params?.turn?.id ?? null);
      if ((message.params?.threadId ?? null) !== state.threadId) {
        state.activeSubagentTurns.add(message.params?.threadId);
      }
      break;
    case "item/started": {
      const item = message.params?.item;
      if (item) {
        recordItem(state, item, "started", message.params?.threadId ?? null);
      }
      break;
    }
    case "item/completed": {
      const item = message.params?.item;
      if (item) {
        recordItem(state, item, "completed", message.params?.threadId ?? null);
      }
      break;
    }
    // Three method names for one concern. `token_count` is the older codex
    // protocol (ONE notification carrying usage AND rate limits); 0.144.4 splits
    // it into the two below and renames every field. Both generations are handled
    // because a shipped plugin cannot know which codex the operator has.
    case "thread/tokenUsage/updated":
    case "account/rateLimits/updated":
    case "token_count": {
      const next = message.method === "thread/tokenUsage/updated" ? parseThreadTokenUsage(message.params) : message.method === "account/rateLimits/updated" ? parseAccountRateLimits(message.params) : parseTokenCount(message.params);
      const prev = state.usage ?? {};
      const folded = {
        inputTokens: next.inputTokens ?? prev.inputTokens,
        outputTokens: next.outputTokens ?? prev.outputTokens,
        rateLimits: foldRateLimits(prev.rateLimits, next.rateLimits)
      };
      const hasContent = folded.inputTokens !== void 0 || folded.outputTokens !== void 0 || folded.rateLimits !== void 0;
      if (hasContent) {
        state.usage = folded;
        state.onItem?.({ kind: "usage", ...folded });
      }
      break;
    }
    case "error":
      state.error = message.params?.error ?? { message: "Unknown codex error." };
      state.onItem?.({
        kind: "error",
        message: state.error?.message ?? "Unknown codex error."
      });
      break;
    case "turn/completed":
      if ((message.params?.threadId ?? null) !== state.threadId) {
        state.activeSubagentTurns.delete(message.params?.threadId);
        scheduleInferredCompletion(state);
        break;
      }
      completeTurn(state, message.params?.turn ?? null);
      break;
    default:
      break;
  }
}
async function runCodexTurn(opts) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const connectTimeoutMs = opts.connectTimeoutMs ?? Math.min(DEFAULT_CONNECT_TIMEOUT_MS, timeoutMs);
  if (opts.signal?.aborted) {
    return {
      success: false,
      finalMessage: "",
      reasoningSummary: [],
      error: "Codex turn aborted.",
      stderr: ""
    };
  }
  let client;
  try {
    client = await CodexAppServerClient.connect(opts.cwd, {
      env: opts.env,
      connectTimeoutMs
    });
  } catch (error) {
    const message = error?.message ?? String(error);
    return {
      success: false,
      finalMessage: "",
      reasoningSummary: [],
      error: message,
      stderr: ""
    };
  }
  let timer = null;
  let timedOut = false;
  const timeout = new Promise((resolve3) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve3();
    }, timeoutMs);
    timer.unref?.();
  });
  let aborted = false;
  let resolveAbort = () => {
  };
  const abortGate = new Promise((resolve3) => {
    resolveAbort = resolve3;
  });
  const onAbort = () => {
    aborted = true;
    resolveAbort();
    void client.close().catch(() => {
    });
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  let state = null;
  try {
    if (aborted) {
      return failure(client, "Codex turn aborted.");
    }
    const started = await Promise.race([
      client.request("thread/start", {
        cwd: opts.cwd,
        model: opts.model ?? null,
        approvalPolicy: "never",
        sandbox: opts.readOnly ? "read-only" : "workspace-write",
        ephemeral: opts.readOnly ?? false
      }),
      timeout.then(() => null),
      abortGate.then(() => null)
    ]);
    if (aborted) {
      return failure(client, "Codex turn aborted.");
    }
    if (timedOut || !started) {
      return failure(client, "Codex turn timed out before the thread started.");
    }
    const threadId = started.thread.id;
    state = createTurnCaptureState(threadId, opts.onItem);
    const capture = state;
    client.setNotificationHandler((message) => {
      if (!capture.turnStarted) {
        capture.bufferedNotifications.push(message);
        return;
      }
      if (shouldApplyNotification(capture, message)) {
        applyTurnNotification(capture, message);
      }
    });
    const turnStartParams = {
      threadId,
      input: buildTurnInput(opts.prompt, opts.instructions)
    };
    if (opts.model) {
      turnStartParams.model = opts.model;
    }
    if (opts.effort) {
      turnStartParams.effort = opts.effort;
    }
    const turnResponse = await Promise.race([
      client.request("turn/start", turnStartParams),
      timeout.then(() => null),
      abortGate.then(() => null)
    ]);
    if (aborted) {
      return failure(client, "Codex turn aborted.");
    }
    if (timedOut || !turnResponse) {
      return failure(client, "Codex turn timed out before the turn started.");
    }
    capture.turnId = turnResponse.turn?.id ?? null;
    if (capture.turnId) {
      capture.threadTurnIds.set(threadId, capture.turnId);
    }
    for (const message of capture.bufferedNotifications) {
      if (shouldApplyNotification(capture, message)) {
        applyTurnNotification(capture, message);
      }
    }
    capture.bufferedNotifications.length = 0;
    capture.turnStarted = true;
    if (turnResponse.turn?.status && turnResponse.turn.status !== "inProgress") {
      completeTurn(capture, turnResponse.turn);
    }
    await Promise.race([capture.completion, timeout, abortGate]);
    if (aborted) {
      return failure(client, "Codex turn aborted.");
    }
    if (timedOut && !capture.completed) {
      return failure(client, "Codex turn timed out while awaiting completion.");
    }
    return buildResult(capture, client.stderr);
  } catch (error) {
    const stderr = client.stderr;
    const message = aborted ? "Codex turn aborted." : error?.message ?? String(error);
    return {
      success: false,
      finalMessage: state?.lastAgentMessage ?? "",
      reasoningSummary: state?.reasoningSummary ?? [],
      error: stderr ? `${message}
${stderr}` : message,
      stderr,
      usage: state?.usage ?? void 0
    };
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    if (timer) {
      clearTimeout(timer);
    }
    if (state) {
      clearCompletionTimer(state);
    }
    await client.close();
  }
}
function buildResult(state, stderr) {
  const success = !state.error && (state.finalTurn?.status === "completed" || state.completed);
  const result = {
    success,
    finalMessage: state.lastAgentMessage,
    reasoningSummary: state.reasoningSummary,
    stderr
  };
  if (state.error?.message) {
    result.error = state.error.message;
  }
  if (state.usage) {
    result.usage = state.usage;
  }
  return result;
}
function failure(client, reason) {
  const stderr = client.stderr;
  return {
    success: false,
    finalMessage: "",
    reasoningSummary: [],
    error: stderr ? `${reason}
${stderr}` : reason,
    stderr
  };
}

// src/lib/state.ts
var import_node_child_process3 = require("node:child_process");
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
var FALLBACK_STATE_ROOT = (0, import_node_path.join)((0, import_node_os.tmpdir)(), "harry");
function repoRootOf(cwd) {
  try {
    const root = (0, import_node_child_process3.execFileSync)("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return root || (0, import_node_path.resolve)(cwd);
  } catch {
    return (0, import_node_path.resolve)(cwd);
  }
}
function resolveStateDir(cwd) {
  const workspaceRoot = repoRootOf(cwd);
  const slug = (0, import_node_path.basename)(workspaceRoot).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = (0, import_node_crypto.createHash)("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
  const dirName = `${slug}-${hash}`;
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  if (pluginDataDir) {
    return (0, import_node_path.join)(pluginDataDir, "state", dirName);
  }
  return (0, import_node_path.join)(FALLBACK_STATE_ROOT, dirName);
}
function ensureDir(dir) {
  (0, import_node_fs.mkdirSync)(dir, { recursive: true, mode: 448 });
}
function atomicWrite(filePath, content) {
  ensureDir((0, import_node_path.dirname)(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${(0, import_node_crypto.randomUUID)().slice(0, 8)}`;
  (0, import_node_fs.writeFileSync)(tmp, content, { encoding: "utf-8", mode: 384 });
  (0, import_node_fs.renameSync)(tmp, filePath);
}
function jobsDir(stateDir) {
  return (0, import_node_path.join)(stateDir, "jobs");
}
function jobLogPath(stateDir, jobId) {
  return (0, import_node_path.join)(jobsDir(stateDir), `${jobId}.log`);
}
function generateJobId() {
  const ts = Date.now();
  const rand = (0, import_node_crypto.randomUUID)().slice(0, 8);
  return `job-${ts}-${rand}`;
}
function appendLog(stateDir, jobId, message) {
  const logFile = jobLogPath(stateDir, jobId);
  ensureDir(jobsDir(stateDir));
  const time = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false });
  (0, import_node_fs.writeFileSync)(logFile, `[${time}] ${message}
`, { flag: "a", mode: 384 });
}
var CODEX_RATE_LIMITS_FILE = "codex-rate-limits.json";
function codexRateLimitsPath(stateDir) {
  return (0, import_node_path.join)(stateDir, CODEX_RATE_LIMITS_FILE);
}
function writeCodexRateLimits(stateDir, rateLimits) {
  try {
    ensureDir(stateDir);
    const snapshot = {
      ...rateLimits,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    atomicWrite(codexRateLimitsPath(stateDir), JSON.stringify(snapshot, null, 2));
  } catch {
  }
}
function readCodexRateLimits(stateDir) {
  const filePath = codexRateLimitsPath(stateDir);
  if (!(0, import_node_fs.existsSync)(filePath)) return null;
  try {
    return JSON.parse((0, import_node_fs.readFileSync)(filePath, "utf-8"));
  } catch {
    return null;
  }
}
function windowLabel(minutes) {
  if (minutes === void 0 || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24);
    return `${days}-day`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours}-hour`;
  }
  return `${minutes}-minute`;
}
function formatCodexRateLimits(rl) {
  const parts = [];
  const used = [];
  if (rl.primaryUsedPercent !== void 0) {
    used.push(`${windowLabel(rl.primaryWindowMinutes) ?? "primary"} ${rl.primaryUsedPercent}%`);
  }
  if (rl.secondaryUsedPercent !== void 0) {
    used.push(
      `${windowLabel(rl.secondaryWindowMinutes) ?? "secondary"} ${rl.secondaryUsedPercent}%`
    );
  }
  if (used.length > 0) parts.push(`${used.join(" / ")} used`);
  if (rl.planType) parts.push(`plan ${rl.planType}`);
  if (rl.resetsAt) parts.push(`resets ${rl.resetsAt}`);
  return parts.join(" \xB7 ");
}
function formatSnapshotAge(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1e3));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
function renderCodexBlock(rl, capturedAt) {
  const header = capturedAt ? `## Codex (snapshot ${formatSnapshotAge(capturedAt)})` : "## Codex";
  return [header, formatCodexRateLimits(rl)].join("\n");
}

// src/lib/providers/codex.ts
var CodexProvider = class {
  /**
   * Abort handle for the in-flight turn, so {@link forceStop} (driven by the
   * session's centralized SIGINT/SIGTERM handler) can tear the codex child down
   * immediately rather than orphaning it on `process.exit`. Null when idle.
   */
  activeController = null;
  /** The in-flight turn promise, awaited by {@link forceStop} so teardown completes. */
  activeRun = null;
  /**
   * Best-effort immediate teardown from an interrupt — abort the live turn AND
   * await it so the codex child is actually reaped before this resolves.
   * Returning early (abort only) would let the session's interrupt handler
   * `process.exit` before close() kills the child, orphaning it.
   */
  async forceStop() {
    this.activeController?.abort();
    await this.activeRun?.catch(() => {
    });
  }
  /**
   * Probe codex auth without running a turn. Codex has no login/host concept in
   * the neutral summary, so those stay undefined; `message` carries the codex
   * detail string ("ChatGPT login active for …", "… requires OpenAI auth", etc).
   */
  async checkAuth(cwd) {
    const s = await getCodexAuthStatus(cwd);
    return { ok: s.loggedIn, message: s.detail };
  }
  /**
   * Run a single prompt to completion. Streams turn events to progress/appendLog
   * for visibility (never throwing on a stream event), then maps the
   * {@link CodexTurnResult} onto the neutral {@link RunResult}.
   *
   * `opts.reasoning` is passed straight through as codex's effort value (the
   * app-server accepts `low | medium | high | xhigh`, verified against the
   * installed codex CLI binary). `opts.model` is passed through as-is;
   * undefined stays undefined so ~/.codex config picks the model.
   */
  async run(opts) {
    const { appendLog: appendLog2, progress } = opts;
    if (!opts.readOnly && !opts.allowShell) {
      throw new Error(
        "Codex cannot grant write access without also allowing shell commands (its workspace-write sandbox runs commands autonomously). Re-run with shell explicitly allowed."
      );
    }
    const onItem = (ev) => {
      switch (ev.kind) {
        case "assistant":
          if (ev.text) progress(ev.text);
          break;
        case "tool":
          progress(ev.label);
          break;
        case "reasoning":
          if (ev.text) appendLog2(`reasoning: ${ev.text}`);
          break;
        case "usage":
          appendLog2(
            `usage: in=${ev.inputTokens ?? "?"} out=${ev.outputTokens ?? "?"}` + (ev.rateLimits?.primaryUsedPercent !== void 0 ? ` primary=${ev.rateLimits.primaryUsedPercent}%` : "")
          );
          break;
        case "error":
          appendLog2(`codex error: ${ev.message}`);
          break;
        default:
          break;
      }
    };
    progress(`Sending prompt to Codex${opts.model ? ` (model=${opts.model})` : ""}\u2026`);
    const controller = new AbortController();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    this.activeController = controller;
    let result;
    const turnPromise = runCodexTurn({
      cwd: opts.cwd,
      prompt: opts.prompt,
      // Carry guardrails + injected --context into the turn (codex has no
      // separate system slot; turn.ts rides them as a leading input block).
      instructions: opts.systemMessage,
      model: opts.model,
      effort: opts.reasoning,
      readOnly: opts.readOnly,
      env: process.env,
      onItem,
      signal: controller.signal
    });
    this.activeRun = turnPromise;
    try {
      result = await turnPromise;
    } finally {
      this.activeController = null;
      this.activeRun = null;
    }
    if (result.error) appendLog2(`turn error: ${result.error}`);
    if (result.usage?.rateLimits) {
      writeCodexRateLimits(resolveStateDir(opts.cwd), result.usage.rateLimits);
    }
    return {
      lastAssistantMessage: result.finalMessage,
      success: result.success,
      summary: result.finalMessage || void 0,
      // Carry the turn's cause onto the neutral result, not just into the log
      // above. `turn.ts`'s failure() already folds the child's stderr in after
      // the message, so the upstream message leads — deliberately uncapped: the
      // cause is the first thing in the string, and a cap sized for stderr would
      // be the thing most likely to cut it off.
      error: result.error,
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        rateLimits: result.usage?.rateLimits
      }
    };
  }
};

// src/lib/run-agent-session.ts
var INTERRUPT_TEARDOWN_CEILING_MS = 2e3;
function defaultSession() {
  return new CodexProvider();
}
async function runAgentSession(args) {
  let activeSession;
  let interrupting = false;
  const handleInterrupt = () => {
    if (interrupting) return;
    interrupting = true;
    const exit = () => process.exit(130);
    const guard = setTimeout(exit, INTERRUPT_TEARDOWN_CEILING_MS);
    guard.unref();
    void Promise.resolve(activeSession?.forceStop?.()).catch(() => {
    }).finally(exit);
  };
  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleInterrupt);
  try {
    const session = args.buildSession ? args.buildSession() : defaultSession();
    activeSession = session;
    const auth = await session.checkAuth(args.cwd);
    if (!auth.ok) {
      throw new Error(`codex not authenticated: ${auth.message}`);
    }
    const result = await session.run(args.run);
    return { result };
  } finally {
    process.removeListener("SIGINT", handleInterrupt);
    process.removeListener("SIGTERM", handleInterrupt);
  }
}

// src/lib/system-message.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var FRAMING = {
  ask: [
    "You are one independent voice being consulted on a question or topic.",
    "Reason carefully and state your own honest conclusion. Use only the context",
    "provided in the prompt \u2014 do not explore the filesystem or run tools.",
    "Be concrete and decisive; surface key assumptions and the strongest",
    "counter-argument to your own position."
  ].join(" ")
};
function resolveExtraContext(cwd, opts) {
  const raw = opts.context;
  if (!raw?.trim()) return void 0;
  if (!raw.startsWith("@")) return raw.trim();
  const ref = raw.slice(1);
  const source = ref === "-" ? "from stdin" : `file ${ref}`;
  let text;
  try {
    text = (0, import_node_fs2.readFileSync)(ref === "-" ? 0 : (0, import_node_path2.resolve)(cwd, ref), "utf-8").trim();
  } catch (err) {
    const message = `Could not read --context ${source}: ${err.message}`;
    if (opts.strict) throw new Error(message);
    opts.onWarn?.(message);
    return void 0;
  }
  if (!text && opts.strict) throw new Error(`--context ${source} is empty.`);
  return text || void 0;
}
function buildSystemMessage(kind, input = {}) {
  const sections = [];
  sections.push(FRAMING[kind]);
  if (input.extraContext?.trim()) {
    sections.push(
      `## Additional context from the orchestrator
The following is context from the Claude Code session that delegated this task. Treat it as authoritative intent:

${input.extraContext.trim()}`
    );
  }
  return sections.join("\n\n");
}

// src/lib/git.ts
var import_node_child_process4 = require("node:child_process");
var import_node_path3 = require("node:path");
function failureReason(result) {
  if (result.stderr.trim()) return result.stderr.trim();
  return result.status === null ? "killed by a signal or failed to spawn" : `exit ${result.status}`;
}
function truncateUtf8(s, maxBytes) {
  const cap = Math.max(0, Math.trunc(maxBytes));
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= cap) return { text: s, truncated: false };
  let end = cap;
  while (end > 0 && (buf[end] & 192) === 128) end--;
  let cut = buf.subarray(0, end).toString("utf8");
  const lastNl = cut.lastIndexOf("\n");
  if (lastNl > 0) cut = cut.slice(0, lastNl);
  return { text: cut, truncated: true };
}
function git(cwd, args) {
  const result = (0, import_node_child_process4.spawnSync)("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}
function gitChecked(cwd, args) {
  const result = git(cwd, args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${failureReason(result)}`);
  }
  return result;
}
function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.error?.code === "ENOENT")
    throw new Error("git is not installed. Install Git and retry.");
  if (result.status !== 0) throw new Error("This command must run inside a Git repository.");
  return result.stdout.trim();
}
function getRepoRoot(cwd) {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}
function getMainCheckoutRoot(cwd) {
  const commonDir = gitChecked(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir"
  ]).stdout.trim();
  return (0, import_node_path3.dirname)(commonDir);
}
function getBranchOrShortSha(cwd) {
  const branch = gitChecked(cwd, ["branch", "--show-current"]).stdout.trim();
  return branch || gitChecked(cwd, ["rev-parse", "--short", "HEAD"]).stdout.trim();
}
function countBranchChanges(cwd, baseRef) {
  return gitChecked(cwd, ["diff", "--name-only", `${baseRef}...HEAD`]).stdout.split("\n").filter(Boolean).length;
}
function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const head = symbolic.stdout.trim();
    if (head.startsWith("refs/remotes/")) return head.replace("refs/remotes/", "");
  }
  for (const candidate of ["main", "master", "trunk"]) {
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]).status === 0)
      return candidate;
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]).status === 0)
      return `origin/${candidate}`;
  }
  throw new Error("Unable to detect the repository default branch. Pass --base <ref>.");
}
function getWorkingTreeState(cwd) {
  const split = (s) => s.trim().split("\n").filter(Boolean);
  const staged = split(gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout);
  const unstaged = split(gitChecked(cwd, ["diff", "--name-only"]).stdout);
  const untracked = split(gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout);
  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0
  };
}
function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);
  if (options.base) {
    return { mode: "branch", label: `branch diff against ${options.base}`, baseRef: options.base };
  }
  if (getWorkingTreeState(cwd).isDirty) {
    return { mode: "working-tree", label: "working tree diff" };
  }
  const detected = detectDefaultBranch(cwd);
  return { mode: "branch", label: `branch diff against ${detected}`, baseRef: detected };
}

// src/lib/turn-runtime.ts
function makeProgress() {
  return (message) => {
    const time = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false });
    process.stderr.write(`[${time}] ${message}
`);
  };
}
function startTurnTimeout(opts) {
  const abort = new AbortController();
  let firedTimeout = false;
  const handle = setTimeout(() => {
    firedTimeout = true;
    opts.progress(`Timeout after ${opts.timeoutMs}ms reached \u2014 requesting abort.`);
    opts.log(`timeout ${opts.timeoutMs}ms`);
    abort.abort();
  }, opts.timeoutMs);
  return {
    signal: abort.signal,
    timedOut: () => firedTimeout,
    clear: () => clearTimeout(handle)
  };
}
function formatCodexUsage(u) {
  const pct = u.rateLimits?.primaryUsedPercent;
  const rate = pct !== void 0 ? ` rate-limit=${pct}%` : "";
  return `tokens(in/out)=${u.inputTokens ?? "?"}/${u.outputTokens ?? "?"}${rate}`;
}
var MAX_CAUSE_BYTES = 4096;
function withCause(generic, cause) {
  const trimmed = cause?.trim();
  if (!trimmed) return generic;
  const { text, truncated } = truncateUtf8(trimmed, MAX_CAUSE_BYTES);
  const shown = truncated ? `${text}
\u2026 (cause truncated; full text in the job log)` : text;
  return `${generic.replace(/\.$/, "")}: ${shown}`;
}

// src/commands/ask.ts
var DEFAULT_TIMEOUT_MS = 30 * 60 * 1e3;
var DEFAULT_EFFORT = "high";
async function runAsk(cwd, options) {
  const progress = makeProgress();
  const reasoning = options.reasoning ?? DEFAULT_EFFORT;
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const requestedModel = options.model ?? resolveModel("judgment");
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("ask: empty prompt");
  const stateDir = resolveStateDir(cwd);
  const jobId = generateJobId();
  const log = (msg) => appendLog(stateDir, jobId, msg);
  log(`ask start: model=${requestedModel} effort=${reasoning} promptChars=${prompt.length}`);
  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => {
      progress(m);
      log(m);
    }
  });
  const turn = startTurnTimeout({ timeoutMs, progress, log });
  let result;
  try {
    ({ result } = await runAgentSession({
      cwd,
      run: {
        cwd,
        prompt,
        model: requestedModel,
        reasoning,
        readOnly: true,
        allowShell: false,
        allowUrl: false,
        systemMessage: buildSystemMessage("ask", { extraContext }),
        appendLog: log,
        progress,
        signal: turn.signal
      }
    }));
  } catch (err) {
    turn.clear();
    const msg = err.message;
    process.stderr.write(`Ask failed: ${msg}
`);
    log(`ask failed: ${msg}`);
    throw err instanceof Error ? err : new Error(msg);
  } finally {
    turn.clear();
  }
  const body = result.lastAssistantMessage?.trim() || result.summary?.trim() || "_(The model returned an empty answer.)_";
  const success = result.success && !turn.timedOut();
  if (!success) {
    const reason = turn.timedOut() ? `Timed out after ${timeoutMs}ms.` : withCause("Ask did not complete successfully.", result.error);
    process.stderr.write(`Ask failed: ${reason}
`);
    process.stdout.write(`# Ask Failed

${reason}

${body}
`);
    log(`ask failed: ${reason}`);
    throw new Error(reason);
  }
  process.stdout.write(`${body.trim()}
`);
  if (result.usage) {
    progress(`Ask done \u2014 effort=${reasoning} ${formatCodexUsage(result.usage)}`);
    log(
      `ask done: inputTokens=${result.usage.inputTokens ?? "?"} outputTokens=${result.usage.outputTokens ?? "?"}`
    );
  } else {
    progress(`Ask done \u2014 effort=${reasoning}`);
    log("ask done");
  }
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}

// src/commands/review.ts
var import_node_child_process5 = require("node:child_process");
var import_node_fs4 = require("node:fs");
var import_node_path5 = require("node:path");

// src/lib/review-prompts.ts
var import_node_fs3 = require("node:fs");
var import_node_path4 = require("node:path");
function pluginRoot() {
  return (0, import_node_path4.dirname)((0, import_node_path4.dirname)((0, import_node_fs3.realpathSync)(process.argv[1])));
}
function loadReviewRubric(root = pluginRoot()) {
  const rubricPath = (0, import_node_path4.join)(root, "references", "review-rubric.md");
  let text;
  try {
    text = (0, import_node_fs3.readFileSync)(rubricPath, "utf8");
  } catch (err) {
    throw new Error(
      `Review rubric not found at ${rubricPath} (${err.message}). Reinstall the harry plugin.`
    );
  }
  if (!text.trim()) throw new Error(`Review rubric at ${rubricPath} is empty.`);
  return text.trim();
}
var OUTSIDE_THE_DIFF = "Code outside those changes is context, not a review target: read it to understand the change, but problems that live only outside the changes must not be reported.";
function targetSection(target) {
  if (target.mode === "branch") {
    if (!target.baseRef) throw new Error("Branch target requires baseRef.");
    return [
      "# Review target",
      "",
      `Review the changes this branch makes against \`${target.baseRef}\`. Run \`git diff ${target.baseRef}...HEAD\` to see them \u2014 that diff is the review target.`,
      "",
      OUTSIDE_THE_DIFF
    ].join("\n");
  }
  return [
    "# Review target",
    "",
    "Review the uncommitted changes in this working tree \u2014 staged, unstaged and untracked. See them with:",
    "",
    "- `git status --short --untracked-files=all` \u2014 every changed and untracked path",
    "- `git diff HEAD` \u2014 staged and unstaged changes to tracked files",
    "- read each untracked file in full \u2014 it has no diff",
    "",
    OUTSIDE_THE_DIFF
  ].join("\n");
}
function buildReviewPrompt(input) {
  const sections = [targetSection(input.target), `# Review standard

${input.rubric.trim()}`];
  const context = input.context?.trim();
  if (context) {
    sections.push(`## Background (settled facts from the working session)

${context}`);
  }
  const focus = input.focusText?.trim();
  if (focus) sections.push(`## Focus

${focus}`);
  return `${sections.join("\n\n")}
`;
}

// src/commands/review.ts
var REVIEW_WRITTEN = "Review written to";
var FAILURE_TAIL_LINES = 40;
function resolveOutputDir(repoRoot) {
  const branch = getBranchOrShortSha(repoRoot);
  const local = (0, import_node_path5.join)(getMainCheckoutRoot(repoRoot), ".local");
  const dir = (0, import_node_fs4.existsSync)(local) && (0, import_node_fs4.statSync)(local).isDirectory() ? (0, import_node_path5.join)(local, "tmp", branch) : (0, import_node_path5.join)(resolveStateDir(repoRoot), "reviews", branch);
  ensureDir(dir);
  return dir;
}
function timestamp(now) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
function reserveReviewFiles(dir, now = /* @__PURE__ */ new Date()) {
  const base = `codex-review-${timestamp(now)}`;
  for (let n = 1; ; n++) {
    const stem = (0, import_node_path5.join)(dir, n === 1 ? base : `${base}-${n}`);
    const reviewPath = `${stem}.md`;
    const logPath = `${stem}.log`;
    if ((0, import_node_fs4.existsSync)(reviewPath)) continue;
    try {
      (0, import_node_fs4.closeSync)((0, import_node_fs4.openSync)(logPath, "wx"));
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
    return { reviewPath, logPath };
  }
}
function reportLogTail(logPath) {
  const lines = (0, import_node_fs4.readFileSync)(logPath, "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const tail = lines.slice(-FAILURE_TAIL_LINES);
  if (tail.length > 0) process.stderr.write(`${tail.join("\n")}
`);
  process.stderr.write(`Log: ${logPath}
`);
}
async function runReview(cwd, options = {}) {
  const target = resolveReviewTarget(cwd, { base: options.base });
  const repoRoot = getRepoRoot(cwd);
  if (target.mode === "branch" && countBranchChanges(repoRoot, target.baseRef ?? "") === 0) {
    process.stdout.write(`# Review Summary

No changes to review under ${target.label}.
`);
    return;
  }
  const prompt = buildReviewPrompt({
    target,
    rubric: loadReviewRubric(),
    // Strict: a reviewer silently missing its facts would review a different question.
    context: resolveExtraContext(cwd, { context: options.context, strict: true }),
    focusText: options.focusText
  });
  const { reviewPath: outputPath, logPath } = reserveReviewFiles(resolveOutputDir(repoRoot));
  const args = [
    "exec",
    "review",
    "--ephemeral",
    "-c",
    'sandbox_mode="read-only"',
    "-o",
    outputPath
  ];
  if (options.reasoning) args.push("-c", `model_reasoning_effort="${options.reasoning}"`);
  args.push("-");
  process.stderr.write(`Reviewing ${target.label} with codex exec review\u2026
`);
  const logFd = (0, import_node_fs4.openSync)(logPath, "w");
  let res;
  try {
    res = (0, import_node_child_process5.spawnSync)("codex", args, {
      cwd: repoRoot,
      input: prompt,
      stdio: ["pipe", "ignore", logFd]
    });
  } finally {
    (0, import_node_fs4.closeSync)(logFd);
  }
  if (res.error?.code === "ENOENT") {
    (0, import_node_fs4.rmSync)(logPath, { force: true });
    throw new Error(
      "The Codex CLI was not found on PATH. Install it and run `codex login`, then retry."
    );
  }
  if (res.error) throw res.error;
  if (res.status !== 0) {
    reportLogTail(logPath);
    throw new Error(
      `codex exec review failed (${res.status === null ? `signal ${res.signal}` : `exit ${res.status}`}).`
    );
  }
  const review = (0, import_node_fs4.existsSync)(outputPath) ? (0, import_node_fs4.readFileSync)(outputPath, "utf8") : "";
  if (!review.trim()) {
    reportLogTail(logPath);
    throw new Error(`codex exec review exited 0 but wrote no review to ${outputPath}.`);
  }
  process.stdout.write(review);
  process.stderr.write(`${REVIEW_WRITTEN} ${outputPath}
Log: ${logPath}
`);
}

// src/commands/setup.ts
async function runSetup(options = {}) {
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
          detail: auth.detail
        },
        null,
        2
      )
    );
    return;
  }
  const lines = [];
  lines.push(`## Codex Setup (${CLIENT_NAME} v${PLUGIN_VERSION})`);
  lines.push("");
  lines.push(
    `**Availability:** ${availability.available ? "available" : "unavailable"} \u2014 ${availability.detail}`
  );
  lines.push(
    `**Status:** ${auth.loggedIn ? "Authenticated" : "Not authenticated"}${auth.authMethod ? ` (${auth.authMethod})` : ""}`
  );
  lines.push(`**Detail:** ${auth.detail}`);
  if (!auth.loggedIn) {
    lines.push("");
    lines.push("### Next steps");
    lines.push("- Run `codex login` to authenticate, then re-run setup.");
  }
  console.log(lines.join("\n"));
}

// src/commands/status.ts
async function runStatus(cwd, options = {}) {
  const stateDir = resolveStateDir(cwd);
  const codexRateLimits = readCodexRateLimits(stateDir);
  if (options.json) {
    console.log(JSON.stringify(codexRateLimits ? { codex: codexRateLimits } : {}, null, 2));
    return;
  }
  if (!codexRateLimits) {
    console.log("_No Codex rate-limit snapshot yet \u2014 run an ask first._");
    return;
  }
  console.log(renderCodexBlock(codexRateLimits, codexRateLimits.capturedAt));
}

// src/lib/args.ts
var BOOLEAN_FLAGS = /* @__PURE__ */ new Set(["help", "json"]);
var KNOWN_FLAGS = {
  setup: /* @__PURE__ */ new Set(["json"]),
  review: /* @__PURE__ */ new Set(["base", "reasoning", "context"]),
  ask: /* @__PURE__ */ new Set(["task", "model", "reasoning", "timeout", "context"]),
  status: /* @__PURE__ */ new Set(["json"])
};
function assertKnownFlags(command, flags) {
  const allowed = KNOWN_FLAGS[command];
  if (!allowed) return;
  for (const key of Object.keys(flags)) {
    if (key === "help") continue;
    if (!allowed.has(key)) {
      throw new Error(`Unknown flag --${key} for '${command}'. Run 'companion help' for usage.`);
    }
  }
}
function parseArgs(argv) {
  const command = argv[0] ?? "help";
  const args = [];
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key2 = arg.slice(2, eq);
        const value = arg.slice(eq + 1);
        if (BOOLEAN_FLAGS.has(key2)) {
          const lc = value.toLowerCase();
          if (lc === "" || lc === "true" || lc === "1" || lc === "yes") {
            flags[key2] = true;
          } else if (lc === "false" || lc === "0" || lc === "no") {
            flags[key2] = false;
          } else {
            throw new Error(
              `Flag --${key2} is boolean and cannot take value "${value}". Use --${key2} or --no-${key2}.`
            );
          }
          continue;
        }
        flags[key2] = value;
        continue;
      }
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== void 0 && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      args.push(arg);
    }
  }
  return { command, args, flags };
}
function flagEnum(flags, key, allowed) {
  const v = flags[key];
  if (v === void 0) return void 0;
  if (typeof v !== "string") {
    throw new Error(`Flag --${key} requires a value (one of: ${allowed.join(", ")}).`);
  }
  if (!allowed.includes(v)) {
    throw new Error(`Invalid --${key} value "${v}". Expected one of: ${allowed.join(", ")}.`);
  }
  return v;
}
function extractTask(args, flags) {
  const positional = args.join(" ").trim();
  if (positional) return positional;
  const flag = flags.task;
  return typeof flag === "string" ? flag.trim() : "";
}
function flagString(flags, key) {
  const v = flags[key];
  return typeof v === "string" ? v : void 0;
}
function flagRequiredString(flags, key) {
  const v = flags[key];
  if (v === void 0) return void 0;
  if (typeof v !== "string") throw new Error(`Flag --${key} requires a value.`);
  return v;
}
function flagNumber(flags, key) {
  const v = flags[key];
  if (typeof v !== "string") return void 0;
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? n : void 0;
}

// src/companion.ts
function printUsage() {
  console.log(
    [
      "Usage:",
      "  companion setup [--json]",
      "  companion review [--base <ref>] [--reasoning <low|medium|high|xhigh>]",
      "                   [--context <text|@file|@->] [focus...]",
      '  companion ask "<prompt>" [--model <id>] [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]',
      "  companion status [--json]",
      "",
      "Commands:",
      "  setup       Check Codex auth and availability",
      "  review      Review the branch or working tree via `codex exec review`",
      "  ask         Ask a single prompt (read-only) and print the answer",
      "  status      Show the cached Codex rate-limit snapshot"
    ].join("\n")
  );
}
async function main() {
  const { command, args, flags } = parseArgs(import_node_process3.default.argv.slice(2));
  if (flags.help === true) {
    printUsage();
    return;
  }
  assertKnownFlags(command, flags);
  switch (command) {
    case "setup": {
      await runSetup({
        json: flags.json === true
      });
      break;
    }
    case "review": {
      await runReview(import_node_process3.default.cwd(), {
        base: flagRequiredString(flags, "base"),
        reasoning: flagEnum(flags, "reasoning", ["low", "medium", "high", "xhigh"]),
        context: flagRequiredString(flags, "context"),
        focusText: args.join(" ")
      });
      break;
    }
    case "ask": {
      const reasoning = flagEnum(flags, "reasoning", ["low", "medium", "high", "xhigh"]);
      const prompt = extractTask(args, flags);
      await runAsk(import_node_process3.default.cwd(), {
        prompt,
        model: flagString(flags, "model"),
        reasoning,
        timeout: flagNumber(flags, "timeout"),
        context: flagString(flags, "context")
      });
      break;
    }
    case "status":
      await runStatus(import_node_process3.default.cwd(), {
        json: flags.json === true
      });
      break;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      import_node_process3.default.exit(1);
  }
}
main().catch((err) => {
  console.error(`
Fatal error: ${err.message}`);
  if (import_node_process3.default.env.DEBUG) console.error(err.stack);
  import_node_process3.default.exit(1);
});
