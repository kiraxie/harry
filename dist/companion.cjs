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

// src/lib/codex/app-server.ts
var import_node_child_process2 = require("node:child_process");
var import_node_process2 = __toESM(require("node:process"), 1);
var import_node_readline = __toESM(require("node:readline"), 1);

// package.json
var package_default = {
  name: "harry",
  version: "0.10.0",
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
    "init-ignore": "node scripts/init.mjs"
  },
  dependencies: {},
  "//typescript": "DEBT: pinned to 7.0.1-rc (tsgo) for native-TS speed; revisit \u2192 stable 7.0 final when released",
  devDependencies: {
    "@biomejs/biome": "^2.5.1",
    "@types/node": "^26.0.1",
    esbuild: "^0.28.1",
    typescript: "7.0.1-rc"
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
    this.exitPromise = new Promise((resolve4) => {
      this.resolveExit = resolve4;
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
    return new Promise((resolve4, reject) => {
      this.pending.set(id, { resolve: resolve4, reject, method });
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
    const bound = new Promise((resolve4) => {
      timer = setTimeout(resolve4, CLOSE_EXIT_WAIT_MS);
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
    planType: next.planType ?? prev.planType,
    resetsAt: next.resetsAt ?? prev.resetsAt
  };
}
function createTurnCaptureState(threadId, onItem) {
  let resolveCompletion;
  const completion = new Promise((resolve4) => {
    resolveCompletion = resolve4;
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
  if (message.method === "token_count" || message.method === "error") {
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
    case "token_count": {
      const next = parseTokenCount(message.params);
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
  const timeout = new Promise((resolve4) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve4();
    }, timeoutMs);
    timer.unref?.();
  });
  let aborted = false;
  let resolveAbort = () => {
  };
  const abortGate = new Promise((resolve4) => {
    resolveAbort = resolve4;
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
var MAX_JOBS = 50;
var PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
var SESSION_ID_ENV = "HARRY_SESSION_ID";
var LEGACY_SESSION_ID_ENV = "COPILOT_COMPANION_SESSION_ID";
var FALLBACK_STATE_ROOT = (0, import_node_path.join)((0, import_node_os.tmpdir)(), "harry");
var LEGACY_FALLBACK_STATE_ROOT = (0, import_node_path.join)((0, import_node_os.tmpdir)(), "copilot-companion");
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
  const fallbackDir = (0, import_node_path.join)(FALLBACK_STATE_ROOT, dirName);
  if (!(0, import_node_fs.existsSync)(fallbackDir)) {
    const legacyDir = (0, import_node_path.join)(LEGACY_FALLBACK_STATE_ROOT, dirName);
    if ((0, import_node_fs.existsSync)(legacyDir)) return legacyDir;
  }
  return fallbackDir;
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
function stateFilePath(stateDir) {
  return (0, import_node_path.join)(stateDir, "state.json");
}
function loadState(stateDir) {
  const filePath = stateFilePath(stateDir);
  if (!(0, import_node_fs.existsSync)(filePath)) {
    return { version: 1, jobs: [] };
  }
  try {
    return JSON.parse((0, import_node_fs.readFileSync)(filePath, "utf-8"));
  } catch {
    return { version: 1, jobs: [] };
  }
}
function saveState(stateDir, state) {
  ensureDir(stateDir);
  if (state.jobs.length > MAX_JOBS) {
    const keep = [];
    for (const job of state.jobs) {
      const inFlight = job.status === "running" || job.status === "queued";
      if (inFlight || keep.length < MAX_JOBS) {
        keep.push(job);
      } else {
        (0, import_node_fs.rmSync)(jobFilePath(stateDir, job.id), { force: true });
        (0, import_node_fs.rmSync)(jobLogPath(stateDir, job.id), { force: true });
      }
    }
    state.jobs = keep;
  }
  atomicWrite(stateFilePath(stateDir), JSON.stringify(state, null, 2));
}
function jobsDir(stateDir) {
  return (0, import_node_path.join)(stateDir, "jobs");
}
function jobFilePath(stateDir, jobId) {
  return (0, import_node_path.join)(jobsDir(stateDir), `${jobId}.json`);
}
function jobLogPath(stateDir, jobId) {
  return (0, import_node_path.join)(jobsDir(stateDir), `${jobId}.log`);
}
function writeJobFile(stateDir, job) {
  atomicWrite(jobFilePath(stateDir, job.id), JSON.stringify(job, null, 2));
}
function readJobFile(stateDir, jobId) {
  const filePath = jobFilePath(stateDir, jobId);
  if (!(0, import_node_fs.existsSync)(filePath)) return null;
  try {
    return JSON.parse((0, import_node_fs.readFileSync)(filePath, "utf-8"));
  } catch {
    return null;
  }
}
function appendLog(stateDir, jobId, message) {
  const logFile = jobLogPath(stateDir, jobId);
  ensureDir(jobsDir(stateDir));
  const time = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false });
  (0, import_node_fs.writeFileSync)(logFile, `[${time}] ${message}
`, { flag: "a", mode: 384 });
}
function readLogTail(stateDir, jobId, maxLines = 10) {
  const logFile = jobLogPath(stateDir, jobId);
  if (!(0, import_node_fs.existsSync)(logFile)) return [];
  try {
    const content = (0, import_node_fs.readFileSync)(logFile, "utf-8");
    const lines = content.trim().split("\n");
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}
function generateJobId() {
  const ts = Date.now();
  const rand = (0, import_node_crypto.randomUUID)().slice(0, 8);
  return `job-${ts}-${rand}`;
}
function getSessionId() {
  return process.env[SESSION_ID_ENV] || process.env[LEGACY_SESSION_ID_ENV] || void 0;
}
function createJob(stateDir, job) {
  const state = loadState(stateDir);
  state.jobs.unshift(job);
  saveState(stateDir, state);
  writeJobFile(stateDir, job);
}
function updateJob(stateDir, jobId, updates) {
  const state = loadState(stateDir);
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx >= 0) {
    state.jobs[idx] = { ...state.jobs[idx], ...updates };
    saveState(stateDir, state);
  }
  const full = readJobFile(stateDir, jobId);
  if (full) {
    writeJobFile(stateDir, { ...full, ...updates });
  }
}
function markJobFailed(stateDir, jobId, errorMessage) {
  const job = readJobFile(stateDir, jobId);
  if (!job || job.status === "completed" || job.status === "failed") return;
  updateJob(stateDir, jobId, {
    status: "failed",
    phase: "failed",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    errorMessage
  });
  appendLog(stateDir, jobId, `Marked failed: ${errorMessage}`);
}
function listJobs(stateDir, sessionId) {
  const state = loadState(stateDir);
  if (sessionId) {
    return state.jobs.filter((j) => j.sessionId === sessionId);
  }
  return state.jobs;
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
function formatCodexRateLimits(rl) {
  const parts = [];
  const used = [];
  if (rl.primaryUsedPercent !== void 0) used.push(`primary ${rl.primaryUsedPercent}%`);
  if (rl.secondaryUsedPercent !== void 0) used.push(`secondary ${rl.secondaryUsedPercent}%`);
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
   * Trust boundary (fail-closed): codex's sandbox is COARSE — a write-enabled
   * turn is `workspace-write` + approvalPolicy:"never", which lets codex run
   * shell commands autonomously. It has no "write files but no shell" mode, so a
   * caller that grants writes while withholding shell (`fix` defaults to
   * allowShell:false) CANNOT be honored. Refuse rather than silently run MORE
   * permissively than asked. Runs via the precheckRun seam BEFORE fix's snapshot.
   */
  precheckRun(opts) {
    if (!opts.readOnly && !opts.allowShell) {
      throw new Error(
        "Codex cannot grant write access without also allowing shell commands (its workspace-write sandbox runs commands autonomously). Re-run with shell explicitly allowed."
      );
    }
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
    this.precheckRun(opts);
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
  const onInterrupt = () => {
    if (interrupting) return;
    interrupting = true;
    args.onInterrupt?.();
    const exit = () => process.exit(130);
    const guard = setTimeout(exit, INTERRUPT_TEARDOWN_CEILING_MS);
    guard.unref();
    void Promise.resolve(activeSession?.forceStop?.()).catch(() => {
    }).finally(exit);
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  try {
    const session = args.buildSession ? args.buildSession() : defaultSession();
    activeSession = session;
    const auth = await session.checkAuth(args.cwd);
    if (!auth.ok) {
      throw new Error(`codex not authenticated: ${auth.message}`);
    }
    session.precheckRun?.(args.run);
    await args.beforeRun?.(session);
    const result = await session.run(args.run);
    return { result };
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
  }
}

// src/lib/system-message.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var FRAMING = {
  fix: [
    "You are applying code-review findings that a human has already vetted and approved, delegated by Claude Code's orchestrator. You run headless.",
    "Edit the real working tree directly. Make the minimal, correct change for each approved finding; do not refactor unrelated code and do NOT run `git commit` (the plugin manages commits and leaves your edits staged for review).",
    "If a finding cannot be safely applied, skip it and report why rather than forcing a change."
  ].join("\n"),
  review: [
    "You are performing a code review delegated by Claude Code's orchestrator. You run headless.",
    "This session is read-only: do not attempt to modify files. Report findings; another stage applies any fixes."
  ].join("\n"),
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
  try {
    const source = ref === "-" ? 0 : (0, import_node_path2.resolve)(cwd, ref);
    const text = (0, import_node_fs2.readFileSync)(source, "utf-8").trim();
    return text || void 0;
  } catch (err) {
    opts.onWarn?.(
      `Could not read --context ${ref === "-" ? "from stdin" : `file ${ref}`}: ${err.message}`
    );
    return void 0;
  }
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

// src/commands/ask.ts
var DEFAULT_MODEL = "gpt-5.6-sol";
var DEFAULT_TIMEOUT_MS = 30 * 60 * 1e3;
var DEFAULT_EFFORT = "high";
async function runAsk(cwd, options) {
  const progress = makeProgress();
  const reasoning = options.reasoning ?? DEFAULT_EFFORT;
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const requestedModel = options.model ?? DEFAULT_MODEL;
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("ask: empty prompt");
  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
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
      },
      log
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
    const reason = turn.timedOut() ? `Timed out after ${timeoutMs}ms.` : "Ask did not complete successfully.";
    process.stdout.write(`${body}
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

// src/commands/background.ts
var import_node_child_process5 = require("node:child_process");

// src/lib/args.ts
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
function flagNumber(flags, key) {
  const v = flags[key];
  if (typeof v !== "string") return void 0;
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? n : void 0;
}

// src/lib/findings.ts
var VALID_SEVERITIES = /* @__PURE__ */ new Set(["blocker", "major", "minor"]);
function extractJsonBlock(text) {
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  const fenced = [];
  for (const m of text.matchAll(fenceRe)) {
    if (m[1]?.trim()) fenced.push(m[1]);
  }
  const candidates = fenced.reverse();
  const lastSpan = (open, close) => {
    const start = text.lastIndexOf(open);
    const end = text.lastIndexOf(close);
    return start !== -1 && end > start ? text.slice(start, end + 1) : void 0;
  };
  const spans = [lastSpan("[", "]"), lastSpan("{", "}")].filter((s) => !!s).sort((a, b) => b.length - a.length);
  candidates.push(...spans);
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
    }
  }
  return null;
}
function normalizeFindings(parsed) {
  const arr = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed.findings) ? parsed.findings : [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i];
    if (!raw || typeof raw !== "object") continue;
    const r = raw;
    const file = typeof r.file === "string" ? r.file : "";
    const title = typeof r.title === "string" ? r.title : "";
    if (!file || !title) continue;
    const sev = typeof r.severity === "string" && VALID_SEVERITIES.has(r.severity) ? r.severity : "major";
    let id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : `finding-${i + 1}`;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    out.push({
      id,
      file,
      line: typeof r.line === "string" ? r.line : typeof r.line === "number" ? String(r.line) : void 0,
      severity: sev,
      title,
      rationale: typeof r.rationale === "string" ? r.rationale : "",
      suggestedFix: typeof r.suggestedFix === "string" ? r.suggestedFix : ""
    });
  }
  return out;
}
var FINDINGS_OUTPUT_INSTRUCTION = `
<structured_findings>
This review feeds an automated fix pipeline. After your markdown review, output
ONE fenced code block tagged \`json\` containing an array of the material
findings (and ONLY material findings \u2014 omit notes, praise, and style nits):

\`\`\`json
[
  {
    "id": "kebab-case-stable-id",
    "file": "relative/path.ts",
    "line": "42-50",
    "severity": "blocker | major | minor",
    "title": "one-sentence statement of the defect",
    "rationale": "why this is a real defect",
    "suggestedFix": "concrete change to make"
  }
]
\`\`\`

Rules:
- If there are no material findings, output an empty array: \`[]\`.
- "line" is optional; omit it for file-wide findings.
- Keep ids stable and descriptive \u2014 they are how a human approves each fix.
</structured_findings>
`;

// src/lib/git.ts
var import_node_child_process4 = require("node:child_process");
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");
var MAX_UNTRACKED_BYTES = 24 * 1024;
var DEFAULT_INLINE_DIFF_MAX_FILES = 2;
var DEFAULT_INLINE_DIFF_MAX_BYTES = 256 * 1024;
var SELF_COLLECT_BUFFER_BYTES = 64 * 1024 * 1024;
function gitDiffTolerant(cwd, args) {
  const result = git(cwd, args, SELF_COLLECT_BUFFER_BYTES);
  if (result.error?.code === "ENOBUFS") {
    return { stdout: "", overflow: true };
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.trim() || `exit ${result.status}`}`
    );
  }
  return { stdout: result.stdout, overflow: false };
}
function truncateUtf8(s, maxBytes) {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= maxBytes) return { text: s, truncated: false };
  let cut = buf.subarray(0, maxBytes).toString("utf8");
  const lastNl = cut.lastIndexOf("\n");
  if (lastNl > 0) cut = cut.slice(0, lastNl);
  return { text: cut, truncated: true };
}
function git(cwd, args, maxBuffer) {
  const result = (0, import_node_child_process4.spawnSync)("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer,
    windowsHide: true
  });
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}
function gitChecked(cwd, args, maxBuffer) {
  const result = git(cwd, args, maxBuffer);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.trim() || `exit ${result.status}`}`
    );
  }
  return result;
}
function isProbablyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const value of sample) {
    if (value === 0) return false;
  }
  return true;
}
function listUniqueFiles(...groups) {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}
function measureGitOutputBytes(cwd, args, maxBytes) {
  const result = git(cwd, args, maxBytes + 1);
  if (result.error && result.error.code === "ENOBUFS") return maxBytes + 1;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return Buffer.byteLength(result.stdout, "utf8");
}
function measureCombinedGitOutputBytes(cwd, argSets, maxBytes) {
  let total = 0;
  for (const args of argSets) {
    const remaining = maxBytes - total;
    if (remaining < 0) return maxBytes + 1;
    total += measureGitOutputBytes(cwd, args, remaining);
    if (total > maxBytes) return total;
  }
  return total;
}
function buildBranchComparison(cwd, baseRef) {
  const mergeBase = gitChecked(cwd, ["merge-base", "HEAD", baseRef]).stdout.trim();
  return { mergeBase, commitRange: `${mergeBase}..HEAD` };
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
  throw new Error(
    "Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree."
  );
}
function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
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
  const requestedScope = options.scope ?? "auto";
  const baseRef = options.base ?? null;
  const supported = /* @__PURE__ */ new Set(["auto", "working-tree", "branch"]);
  if (baseRef) {
    return { mode: "branch", label: `branch diff against ${baseRef}`, baseRef, explicit: true };
  }
  if (requestedScope === "working-tree") {
    return { mode: "working-tree", label: "working tree diff", explicit: true };
  }
  if (!supported.has(requestedScope)) {
    throw new Error(
      `Unsupported review scope "${requestedScope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`
    );
  }
  if (requestedScope === "branch") {
    const detected2 = detectDefaultBranch(cwd);
    return {
      mode: "branch",
      label: `branch diff against ${detected2}`,
      baseRef: detected2,
      explicit: true
    };
  }
  const state = getWorkingTreeState(cwd);
  if (state.isDirty) {
    return { mode: "working-tree", label: "working tree diff", explicit: false };
  }
  const detected = detectDefaultBranch(cwd);
  return {
    mode: "branch",
    label: `branch diff against ${detected}`,
    baseRef: detected,
    explicit: false
  };
}
function formatSection(title, body) {
  return [`## ${title}`, "", body.trim() ? body.trim() : "(none)", ""].join("\n");
}
function formatUntrackedFile(cwd, relativePath) {
  const absolute = (0, import_node_path3.join)(cwd, relativePath);
  if (!(0, import_node_fs3.existsSync)(absolute)) return `### ${relativePath}
(skipped: missing)`;
  let stat;
  try {
    stat = (0, import_node_fs3.statSync)(absolute);
  } catch {
    return `### ${relativePath}
(skipped: unreadable)`;
  }
  if (stat.isDirectory()) return `### ${relativePath}
(skipped: directory)`;
  if (stat.size > MAX_UNTRACKED_BYTES)
    return `### ${relativePath}
(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  let buffer;
  try {
    buffer = (0, import_node_fs3.readFileSync)(absolute);
  } catch {
    return `### ${relativePath}
(skipped: unreadable)`;
  }
  if (!isProbablyText(buffer)) return `### ${relativePath}
(skipped: binary file)`;
  return [`### ${relativePath}`, "```", buffer.toString("utf8").trimEnd(), "```"].join("\n");
}
function collectWorkingTreeContext(cwd, state, includeDiff, truncatedDiffBytes) {
  const status = gitChecked(cwd, ["status", "--short", "--untracked-files=all"]).stdout.trim();
  const changedFiles = listUniqueFiles(state.staged, state.unstaged, state.untracked);
  let parts;
  if (includeDiff) {
    parts = [
      formatSection("Git Status", status),
      formatSection(
        "Staged Diff",
        gitChecked(cwd, ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout
      ),
      formatSection(
        "Unstaged Diff",
        gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout
      ),
      // Inline path: include full untracked file bodies (small diffs only).
      formatSection(
        "Untracked Files",
        state.untracked.map((f) => formatUntrackedFile(cwd, f)).join("\n\n")
      )
    ];
  } else {
    const staged = gitDiffTolerant(cwd, ["diff", "--cached", "--no-ext-diff", "--submodule=short"]);
    const unstaged = gitDiffTolerant(cwd, ["diff", "--no-ext-diff", "--submodule=short"]);
    const overflow = staged.overflow || unstaged.overflow;
    const combined = [staged.stdout, unstaged.stdout].filter(Boolean).join("\n");
    const trimmed = truncateUtf8(combined, truncatedDiffBytes);
    let diffBlock = trimmed.truncated ? `${trimmed.text}

... (diff truncated; read individual files for the rest)` : trimmed.text;
    if (overflow) {
      diffBlock = `(diff exceeded ${SELF_COLLECT_BUFFER_BYTES} bytes; inline omitted \u2014 use the read tool on the changed files listed above)

${diffBlock}`;
    }
    parts = [
      formatSection("Git Status", status),
      formatSection(
        "Staged Diff Stat",
        gitChecked(cwd, ["diff", "--shortstat", "--cached"]).stdout.trim()
      ),
      formatSection("Unstaged Diff Stat", gitChecked(cwd, ["diff", "--shortstat"]).stdout.trim()),
      formatSection("Changed Files", changedFiles.join("\n")),
      formatSection("Truncated Diff", diffBlock),
      formatSection("Untracked Files", state.untracked.join("\n"))
    ];
  }
  return {
    mode: "working-tree",
    summary: `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s).`,
    content: parts.join("\n"),
    changedFiles
  };
}
function collectBranchContext(cwd, baseRef, comparison, includeDiff, truncatedDiffBytes) {
  const currentBranch = getCurrentBranch(cwd);
  const changedFiles = gitChecked(cwd, ["diff", "--name-only", comparison.commitRange]).stdout.trim().split("\n").filter(Boolean);
  const log = gitChecked(cwd, [
    "log",
    "--oneline",
    "--decorate",
    comparison.commitRange
  ]).stdout.trim();
  const stat = gitChecked(cwd, ["diff", "--stat", comparison.commitRange]).stdout.trim();
  let parts;
  if (includeDiff) {
    parts = [
      formatSection("Commit Log", log),
      formatSection("Diff Stat", stat),
      formatSection(
        "Branch Diff",
        gitChecked(cwd, [
          "diff",
          "--binary",
          "--no-ext-diff",
          "--submodule=diff",
          comparison.commitRange
        ]).stdout
      )
    ];
  } else {
    const branchDiff = gitDiffTolerant(cwd, [
      "diff",
      "--no-ext-diff",
      "--submodule=short",
      comparison.commitRange
    ]);
    const trimmed = truncateUtf8(branchDiff.stdout, truncatedDiffBytes);
    let diffBlock = trimmed.truncated ? `${trimmed.text}

... (diff truncated; read individual files for the rest)` : trimmed.text;
    if (branchDiff.overflow) {
      diffBlock = `(diff exceeded ${SELF_COLLECT_BUFFER_BYTES} bytes; inline omitted \u2014 use the read tool on the changed files listed above)

${diffBlock}`;
    }
    parts = [
      formatSection("Commit Log", log),
      formatSection("Diff Stat", stat),
      formatSection("Changed Files", changedFiles.join("\n")),
      formatSection("Truncated Diff", diffBlock)
    ];
  }
  return {
    mode: "branch",
    summary: `Reviewing branch ${currentBranch} against ${baseRef} from merge-base ${comparison.mergeBase}.`,
    content: parts.join("\n"),
    changedFiles
  };
}
function collectReviewContext(cwd, target, options = {}) {
  const repoRoot = getRepoRoot(cwd);
  const branch = getCurrentBranch(repoRoot);
  const maxInlineFiles = options.maxInlineFiles ?? DEFAULT_INLINE_DIFF_MAX_FILES;
  const maxInlineDiffBytes = options.maxInlineDiffBytes ?? DEFAULT_INLINE_DIFF_MAX_BYTES;
  let details;
  let includeDiff;
  let diffBytes;
  if (target.mode === "working-tree") {
    const state = getWorkingTreeState(repoRoot);
    diffBytes = measureCombinedGitOutputBytes(
      repoRoot,
      [
        ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"],
        ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]
      ],
      maxInlineDiffBytes
    );
    const fileCount = listUniqueFiles(state.staged, state.unstaged, state.untracked).length;
    includeDiff = options.includeDiff ?? (fileCount <= maxInlineFiles && diffBytes <= maxInlineDiffBytes);
    details = collectWorkingTreeContext(repoRoot, state, includeDiff, maxInlineDiffBytes);
  } else {
    if (!target.baseRef) throw new Error("Branch target requires baseRef.");
    const comparison = buildBranchComparison(repoRoot, target.baseRef);
    const fileCount = gitChecked(repoRoot, ["diff", "--name-only", comparison.commitRange]).stdout.trim().split("\n").filter(Boolean).length;
    diffBytes = measureGitOutputBytes(
      repoRoot,
      ["diff", "--binary", "--no-ext-diff", "--submodule=diff", comparison.commitRange],
      maxInlineDiffBytes
    );
    includeDiff = options.includeDiff ?? (fileCount <= maxInlineFiles && diffBytes <= maxInlineDiffBytes);
    details = collectBranchContext(
      repoRoot,
      target.baseRef,
      comparison,
      includeDiff,
      maxInlineDiffBytes
    );
  }
  const collectionGuidance = includeDiff ? "Use the repository context below as primary evidence." : options.shellAvailable ? "The repository context below is a lightweight summary. Inspect the target diff yourself with read-only git commands before finalizing findings." : 'The repository context below is a lightweight summary because the diff is too large to inline. Shell execution is disabled. Use the read tool to open individual changed files listed under "Changed Files" and ground findings in their actual contents before finalizing.';
  return {
    cwd: repoRoot,
    repoRoot,
    branch,
    target,
    mode: details.mode,
    summary: details.summary,
    content: details.content,
    changedFiles: details.changedFiles,
    fileCount: details.changedFiles.length,
    diffBytes,
    inputMode: includeDiff ? "inline-diff" : "self-collect",
    collectionGuidance
  };
}

// src/lib/review-prompts.ts
var STANDARD = `<role>
You are a careful, technically rigorous code reviewer.
Your job is to find real defects in the change provided.
</role>

<task>
Review the repository context below.
Target: {{TARGET_LABEL}}
{{USER_FOCUS_BLOCK}}
</task>

<focus_areas>
Prioritize material defects:
- correctness bugs (off-by-one, null deref, wrong branch taken)
- error handling gaps and unhandled failure paths
- concurrency, ordering, and re-entrancy issues
- input validation and trust boundaries
- resource leaks and lifecycle bugs
- regressions to existing behavior
- security: auth, permissions, injection, data exposure
</focus_areas>

<finding_bar>
Report only material findings. Skip style nits, naming preferences, and speculative concerns.
Each finding should answer:
1. What is wrong?
2. Where is it (file + line range)?
3. Why does it fail?
4. What concrete change would fix it?
</finding_bar>

<output_format>
Return markdown. Structure:

# Review Summary
One terse paragraph: ship / needs-attention / blocker, plus the overall risk read.

## Findings
For each finding, a level-3 heading with the file path and line range, then:
- **Issue**: one sentence
- **Why it matters**: one to three sentences
- **Fix**: concrete recommendation

## Notes
Optional. Anything notable that is not a finding (e.g., test coverage gaps, follow-up work).

If there are no material findings, say so directly under "Review Summary" and skip "Findings".
</output_format>

<grounding_rules>
Ground every finding in the repository context or in evidence you can collect with read-only commands.
Do not invent files, line numbers, or behavior you cannot support.
Keep confidence honest \u2014 if a conclusion depends on inference, say so.
</grounding_rules>

<collection_guidance>
{{REVIEW_COLLECTION_GUIDANCE}}
</collection_guidance>

<repository_context>
{{REVIEW_INPUT}}
</repository_context>
`;
var ADVERSARIAL = `<role>
You are performing an adversarial software review.
Your job is to break confidence in the change, not to validate it.
</role>

<task>
Review the repository context below as if you are trying to find the strongest reasons this change should not ship yet.
Target: {{TARGET_LABEL}}
{{USER_FOCUS_BLOCK}}
</task>

<operating_stance>
Default to skepticism.
Assume the change can fail in subtle, high-cost, or user-visible ways until the evidence says otherwise.
Do not give credit for good intent, partial fixes, or likely follow-up work.
If something only works on the happy path, treat that as a real weakness.
</operating_stance>

<attack_surface>
Prioritize the kinds of failures that are expensive, dangerous, or hard to detect:
- auth, permissions, tenant isolation, and trust boundaries
- data loss, corruption, duplication, and irreversible state changes
- rollback safety, retries, partial failure, and idempotency gaps
- race conditions, ordering assumptions, stale state, and re-entrancy
- empty-state, null, timeout, and degraded dependency behavior
- version skew, schema drift, migration hazards, and compatibility regressions
- observability gaps that would hide failure or make recovery harder
- design choices that work today but constrain future changes
</attack_surface>

<review_method>
Actively try to disprove the change.
Look for violated invariants, missing guards, unhandled failure paths, and assumptions that stop being true under stress.
Trace how bad inputs, retries, concurrent actions, or partially completed operations move through the code.
If the user supplied a focus area, weight it heavily, but still report any other material issue you can defend.
Question the design itself: is this the right approach, or is it a local optimum that will hurt later?
</review_method>

<finding_bar>
Report only material findings.
Do not include style feedback, naming feedback, low-value cleanup, or speculative concerns without evidence.
A finding should answer:
1. What can go wrong?
2. Why is this code path vulnerable?
3. What is the likely impact?
4. What concrete change would reduce the risk?
</finding_bar>

<output_format>
Return markdown. Structure:

# Adversarial Review
One paragraph: ship / needs-attention / no-ship, written as a terse risk verdict, not a neutral recap.

## Findings
For each finding, a level-3 heading with the file path and line range, then:
- **Risk**: what fails, in one sentence
- **Why it is plausible**: defensible reasoning grounded in the code
- **Impact**: concrete consequence (data loss, auth bypass, regression, etc.)
- **Mitigation**: what change would reduce the risk

## Design Concerns
Optional. Higher-level concerns about the chosen approach, tradeoffs, or assumptions that may not hold.
</output_format>

<grounding_rules>
Be aggressive, but stay grounded.
Every finding must be defensible from the provided repository context or tool outputs.
Do not invent files, lines, code paths, incidents, attack chains, or runtime behavior you cannot support.
If a conclusion depends on an inference, state that explicitly and keep the confidence honest.
</grounding_rules>

<calibration_rules>
Prefer one strong finding over several weak ones.
Do not dilute serious issues with filler.
If the change looks safe, say so directly and return no findings.
</calibration_rules>

<collection_guidance>
{{REVIEW_COLLECTION_GUIDANCE}}
</collection_guidance>

<repository_context>
{{REVIEW_INPUT}}
</repository_context>
`;
var SIMPLIFY = `<role>
You are a senior engineer reviewing a change for simplification and cleanup ONLY.
You do NOT hunt for correctness bugs \u2014 a separate reviewer covers those.
Your job is to find where the change can be made simpler, smaller, or more reuse-driven without altering behavior.
</role>

<task>
Review the repository context below for cleanup opportunities.
Target: {{TARGET_LABEL}}
{{USER_FOCUS_BLOCK}}
</task>

<focus_areas>
Prioritize quality cleanups that preserve behavior:
- reuse: duplicated logic, copy-paste, or knowledge that should be extracted to one source of truth (apply the drift test \u2014 extract only when divergence would be a bug)
- simplification: dead code, redundant branches, needless indirection, over-engineering, an abstraction with a single caller
- the ladder: hand-rolled code that a stdlib, native platform feature, or an already-installed dependency already provides
- efficiency: obviously wasteful work (repeated recomputation, O(n^2) where a map suffices) \u2014 only when the simpler form is also faster
- altitude: logic sitting at the wrong layer, or a one-liner buried in scaffolding
</focus_areas>

<finding_bar>
Report only material cleanups. Each must be behavior-preserving \u2014 if a change would alter behavior, it belongs to the bug reviewer, not here. Skip pure style/naming nits.
Each finding should answer:
1. What is more complex than it needs to be?
2. Where is it (file + line range)?
3. Why is the simpler form equivalent in behavior?
4. What concrete change makes it simpler?
</finding_bar>

<output_format>
Return markdown. Structure:

# Cleanup Review
One terse paragraph: how much incidental complexity the change carries.

## Cleanups
For each finding, a level-3 heading with the file path and line range, then:
- **Complexity**: one sentence on what is over-built
- **Equivalent because**: why the simpler form preserves behavior
- **Simpler form**: concrete change

If there is nothing material to simplify, say so directly and skip "Cleanups".
</output_format>

<grounding_rules>
Ground every cleanup in the repository context. Do not invent files or behavior.
If a simplification depends on an assumption about behavior, state it \u2014 never propose a change you cannot show is behavior-preserving.
</grounding_rules>

<collection_guidance>
{{REVIEW_COLLECTION_GUIDANCE}}
</collection_guidance>

<repository_context>
{{REVIEW_INPUT}}
</repository_context>
`;
function interpolate(template, vars) {
  return template.replace(
    /\{\{([A-Z_]+)\}\}/g,
    (_, key) => Object.hasOwn(vars, key) ? vars[key] : ""
  );
}
function buildReviewPrompt(kind, vars) {
  const template = kind === "adversarial" ? ADVERSARIAL : kind === "simplify" ? SIMPLIFY : STANDARD;
  const focusBlock = vars.focusText.trim() ? `User focus: ${vars.focusText.trim()}` : "No extra focus provided.";
  return interpolate(template, {
    TARGET_LABEL: vars.context.target.label,
    USER_FOCUS_BLOCK: focusBlock,
    REVIEW_COLLECTION_GUIDANCE: vars.context.collectionGuidance,
    REVIEW_INPUT: vars.context.content
  });
}

// src/commands/review.ts
var DEFAULT_TIMEOUT_MS2 = 30 * 60 * 1e3;
var DEFAULT_MODEL_STANDARD = "gpt-5.6-terra";
var DEFAULT_MODEL_ADVERSARIAL = "gpt-5.6-sol";
var DEFAULT_MODEL_SIMPLIFY = "gpt-5.6-terra";
var DEFAULT_EFFORT_STANDARD = "xhigh";
var DEFAULT_EFFORT_ADVERSARIAL = "xhigh";
var DEFAULT_EFFORT_SIMPLIFY = "xhigh";
function resolveKind(options) {
  if (options.simplify) return "simplify";
  if (options.adversarial) return "adversarial";
  return "standard";
}
function defaultModelFor(kind) {
  if (kind === "adversarial") return DEFAULT_MODEL_ADVERSARIAL;
  if (kind === "simplify") return DEFAULT_MODEL_SIMPLIFY;
  return DEFAULT_MODEL_STANDARD;
}
function defaultEffortFor(kind) {
  if (kind === "adversarial") return DEFAULT_EFFORT_ADVERSARIAL;
  if (kind === "simplify") return DEFAULT_EFFORT_SIMPLIFY;
  return DEFAULT_EFFORT_STANDARD;
}
async function runReview(cwd, options = {}) {
  const progress = makeProgress();
  const kind = resolveKind(options);
  const reasoning = options.reasoning ?? defaultEffortFor(kind);
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS2;
  const requestedModel = options.model ?? defaultModelFor(kind);
  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
  const log = (msg) => appendLog(stateDir, jobId, msg);
  log(
    `review start: kind=${kind} model=${requestedModel} effort=${reasoning} scope=${options.scope ?? "auto"} base=${options.base ?? "(auto)"}`
  );
  const target = resolveReviewTarget(cwd, { scope: options.scope, base: options.base });
  const context = collectReviewContext(cwd, target, { shellAvailable: false });
  if (context.fileCount === 0) {
    process.stdout.write(
      `# Review Summary

No changes to review under ${context.target.label}.
`
    );
    log("review aborted: empty target");
    return;
  }
  progress(
    `Target: ${context.target.label} \u2014 ${context.fileCount} file(s), ~${context.diffBytes}B diff (${context.inputMode}).`
  );
  const fixMode = options.fix === true;
  let prompt = buildReviewPrompt(kind, { context, focusText: options.focusText ?? "" });
  if (fixMode) prompt += `
${FINDINGS_OUTPUT_INSTRUCTION}`;
  log(`prompt built: ${prompt.length} chars${fixMode ? " (structured findings mode)" : ""}`);
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
      cwd: context.repoRoot,
      run: {
        cwd: context.repoRoot,
        prompt,
        model: requestedModel,
        reasoning,
        readOnly: true,
        allowShell: false,
        allowUrl: false,
        systemMessage: buildSystemMessage("review", { extraContext }),
        appendLog: log,
        progress,
        signal: turn.signal
      },
      log
    }));
  } catch (err) {
    turn.clear();
    const msg = err.message;
    process.stderr.write(`Review failed: ${msg}
`);
    log(`review failed: ${msg}`);
    throw err instanceof Error ? err : new Error(msg);
  } finally {
    turn.clear();
  }
  const reviewBody = result.lastAssistantMessage?.trim() || result.summary?.trim() || "_(The model returned an empty review.)_";
  const success = result.success && !turn.timedOut();
  if (!success) {
    const reason = turn.timedOut() ? `Timed out after ${timeoutMs}ms.` : "Review did not complete successfully.";
    process.stderr.write(`Review failed: ${reason}
`);
    process.stdout.write(`# Review Failed

${reason}

${reviewBody}
`);
    log(`review failed: ${reason}`);
    throw new Error(reason);
  }
  if (fixMode) {
    const findings = normalizeFindings(extractJsonBlock(reviewBody));
    const envelope = {
      status: "reviewed",
      kind,
      model: requestedModel,
      target: context.target.label,
      fileCount: context.fileCount,
      findings,
      reviewMarkdown: reviewBody.trim()
    };
    process.stdout.write(`${JSON.stringify(envelope)}
`);
    log(`review (fix mode) done: ${findings.length} structured finding(s)`);
  } else {
    process.stdout.write(`${reviewBody.trim()}
`);
  }
  if (result.usage) {
    const u = result.usage;
    progress(
      `Review done \u2014 kind=${kind} model=${requestedModel} effort=${reasoning} files=${context.fileCount} ${formatCodexUsage(u)}`
    );
    log(
      `review done: kind=${kind} files=${context.fileCount} inputTokens=${u.inputTokens ?? "?"} outputTokens=${u.outputTokens ?? "?"}`
    );
  } else {
    progress(
      `Review done \u2014 kind=${kind} model=${requestedModel} effort=${reasoning} files=${context.fileCount}`
    );
    log(`review done: kind=${kind} files=${context.fileCount}`);
  }
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}

// src/commands/background.ts
function enqueueBackground(command, args, flags, cwd) {
  if (command !== "review") {
    throw new Error(`Background execution is only supported for 'review', got '${command}'.`);
  }
  const stateDir = resolveStateDir(cwd);
  const jobId = generateJobId();
  const summary = extractTask(args, flags).slice(0, 80) || command;
  const job = {
    id: jobId,
    kind: command,
    title: `harry ${command}`,
    summary,
    status: "queued",
    phase: "queued",
    cwd,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    sessionId: getSessionId(),
    request: { command, args, flags, cwd }
  };
  createJob(stateDir, job);
  appendLog(stateDir, jobId, `Queued for background execution: ${command} "${summary}"`);
  const scriptPath = getScriptPath();
  const child = (0, import_node_child_process5.spawn)(process.execPath, [scriptPath, "_worker", "--job-id", jobId, "--cwd", cwd], {
    cwd,
    env: { ...process.env, HARRY_SESSION_ID: getSessionId() ?? "" },
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  updateJob(stateDir, jobId, { pid: child.pid ?? null });
  return jobId;
}
function getScriptPath() {
  if (typeof __filename === "undefined" || !__filename) {
    throw new Error(
      "Unable to resolve script path: __filename is not defined. The companion must be run via the bundled CJS output."
    );
  }
  return __filename;
}
async function runWorker(jobId, cwd) {
  const stateDir = resolveStateDir(cwd);
  const job = readJobFile(stateDir, jobId);
  if (!job) {
    console.error(`Worker: Job not found: ${jobId}`);
    process.exit(1);
  }
  const { args, flags } = job.request;
  updateJob(stateDir, jobId, {
    status: "running",
    phase: "starting",
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  appendLog(stateDir, jobId, "Worker started.");
  process.on("exit", (code) => {
    if (code === 0) return;
    try {
      markJobFailed(stateDir, jobId, `worker exited with code ${code}`);
    } catch {
    }
  });
  const stdoutChunks = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk, ...rest) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    stdoutChunks.push(text);
    return originalStdoutWrite(chunk, ...rest);
  });
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk, ...rest) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    if (text.trim()) appendLog(stateDir, jobId, text.trim());
    return originalStderrWrite(chunk, ...rest);
  });
  const reasoning = flagString(flags, "reasoning");
  const validEfforts = ["low", "medium", "high", "xhigh"];
  const effort = reasoning && validEfforts.includes(reasoning) ? reasoning : void 0;
  try {
    if (job.request.command !== "review") {
      throw new Error(`Background worker only supports 'review', got '${job.request.command}'.`);
    }
    const scope = flagString(flags, "scope");
    const validScopes = ["auto", "working-tree", "branch"];
    const reviewOpts = {
      adversarial: flags.adversarial === true,
      scope: scope && validScopes.includes(scope) ? scope : void 0,
      base: flagString(flags, "base"),
      focusText: extractTask(args, flags),
      simplify: flags.simplify === true,
      model: flagString(flags, "model"),
      reasoning: effort,
      timeout: flagNumber(flags, "timeout"),
      fix: flags.fix === true,
      context: flagString(flags, "context"),
      jobId
    };
    await runReview(cwd, reviewOpts);
    const captured = stdoutChunks.join("").trim();
    updateJob(stateDir, jobId, {
      status: "completed",
      phase: "done",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      result: captured
    });
    appendLog(stateDir, jobId, "Worker completed.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markJobFailed(stateDir, jobId, message);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

// src/commands/fix.ts
var import_node_child_process6 = require("node:child_process");
var import_node_fs4 = require("node:fs");
var import_node_path4 = require("node:path");
var DEFAULT_MODEL2 = "gpt-5.6-sol";
var DEFAULT_EFFORT2 = "high";
var DEFAULT_TIMEOUT_MS3 = 30 * 60 * 1e3;
function tryGit(args, cwd) {
  const res = (0, import_node_child_process6.spawnSync)("git", args, { cwd, encoding: "utf-8" });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim()
  };
}
function gitHead(cwd) {
  try {
    return (0, import_node_child_process6.execFileSync)("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}
function emit(env) {
  const json = JSON.stringify(env);
  process.stdout.write(`${json}
`);
  return json;
}
function loadFindings(path) {
  const raw = (0, import_node_fs4.readFileSync)(path, "utf-8");
  return normalizeFindings(JSON.parse(raw));
}
function buildFixPrompt(findings) {
  const blocks = findings.map((f, i) => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    return [
      `### Finding ${i + 1} \u2014 id: ${f.id} (${f.severity})`,
      `Location: ${loc}`,
      `Issue: ${f.title}`,
      f.rationale ? `Why: ${f.rationale}` : "",
      f.suggestedFix ? `Suggested fix: ${f.suggestedFix}` : ""
    ].filter(Boolean).join("\n");
  }).join("\n\n");
  return [
    "Apply the following code-review fixes to this repository. Each finding has",
    "already been vetted by a human reviewer \u2014 implement the fix for each one.",
    "",
    "Guidelines:",
    "- Make the minimal, correct change for each finding. Do not refactor unrelated code.",
    "- If a finding cannot be safely applied (already fixed, no longer applies, or",
    "  the suggested fix would break something), skip it and explain why.",
    "- Do not commit; just edit the files.",
    "",
    "FINDINGS TO FIX:",
    "",
    blocks,
    "",
    "When done, output ONE fenced ```json block reporting what you did:",
    "```json",
    '{ "applied": ["finding-id", ...], "skipped": [{ "id": "finding-id", "reason": "..." }] }',
    "```"
  ].join("\n");
}
function parseApplyReport(text, findings) {
  const parsed = extractJsonBlock(text);
  const ids = new Set(findings.map((f) => f.id));
  const applied = [];
  const skipped = [];
  if (parsed && typeof parsed === "object") {
    const p = parsed;
    if (Array.isArray(p.applied)) {
      for (const a of p.applied) if (typeof a === "string" && ids.has(a)) applied.push(a);
    }
    if (Array.isArray(p.skipped)) {
      for (const s of p.skipped) {
        if (s && typeof s === "object") {
          const id = s.id;
          const reason = s.reason;
          if (typeof id === "string")
            skipped.push({ id, reason: typeof reason === "string" ? reason : "no reason given" });
        }
      }
    }
  }
  const accounted = /* @__PURE__ */ new Set([...applied, ...skipped.map((s) => s.id)]);
  for (const f of findings) {
    if (!accounted.has(f.id)) skipped.push({ id: f.id, reason: "not reported by the model" });
  }
  return { applied, skipped };
}
function computeStagedDiff(cwd, baseline) {
  tryGit(["add", "-A"], cwd);
  const names = tryGit(["diff", "--cached", "--name-only", baseline], cwd);
  const filesModified = names.ok && names.stdout ? names.stdout.split("\n").filter(Boolean) : [];
  let linesAdded = 0;
  let linesRemoved = 0;
  const numstat = tryGit(["diff", "--cached", "--numstat", baseline], cwd);
  if (numstat.ok && numstat.stdout) {
    for (const line of numstat.stdout.split("\n")) {
      const [addStr, delStr] = line.split("	");
      const add = Number.parseInt(addStr ?? "0", 10);
      const del = Number.parseInt(delStr ?? "0", 10);
      if (Number.isFinite(add)) linesAdded += add;
      if (Number.isFinite(del)) linesRemoved += del;
    }
  }
  return { filesModified, linesAdded, linesRemoved };
}
async function runFix(cwd, options = {}) {
  const progress = makeProgress();
  const stateDir = resolveStateDir(cwd);
  const jobId = options.jobId ?? generateJobId();
  const reasoning = options.reasoning ?? DEFAULT_EFFORT2;
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS3;
  const requestedModel = options.model ?? DEFAULT_MODEL2;
  const log = (msg) => appendLog(stateDir, jobId, msg);
  if (!options.findingsPath) {
    emit({
      status: "failed",
      jobId,
      error: "Missing --findings <path>; provide the approved findings JSON."
    });
    process.exit(1);
  }
  const findingsAbs = (0, import_node_path4.resolve)(cwd, options.findingsPath);
  let findings;
  try {
    findings = loadFindings(findingsAbs);
  } catch (err) {
    emit({
      status: "failed",
      jobId,
      error: `Could not read findings file ${findingsAbs}: ${err.message}`
    });
    process.exit(1);
  }
  if (findings.length === 0) {
    emit({ status: "failed", jobId, error: "No findings to fix (empty list after parsing)." });
    process.exit(1);
  }
  log(`fix start: model=${requestedModel} findings=${findings.length} source=${findingsAbs}`);
  let repoRoot;
  try {
    repoRoot = ensureGitRepository(cwd);
  } catch (err) {
    emit({ status: "failed", jobId, error: `Not a git repository: ${err.message}` });
    process.exit(1);
  }
  let preFixDirty = false;
  let baselineCommit = "";
  let diffBase = "";
  const snapshotInfo = () => baselineCommit ? { baselineCommit, ...preFixDirty ? { preFixDirty } : {} } : {};
  const turn = startTurnTimeout({ timeoutMs, progress, log });
  let envelopeDone = false;
  const onInterrupt = () => {
    if (envelopeDone) return;
    envelopeDone = true;
    turn.clear();
    progress("Received interrupt signal; aborting fix session.");
    emit({ status: "failed", jobId, error: "Interrupted by signal" });
  };
  const extraContext = resolveExtraContext(cwd, {
    context: options.context,
    onWarn: (m) => {
      progress(m);
      log(m);
    }
  });
  progress(`Applying ${findings.length} approved fix(es) (model=${requestedModel})\u2026`);
  let result;
  try {
    ({ result } = await runAgentSession({
      cwd: repoRoot,
      run: {
        cwd: repoRoot,
        prompt: buildFixPrompt(findings),
        model: requestedModel,
        reasoning,
        readOnly: false,
        allowShell: options.allowShell ?? false,
        allowUrl: options.allowUrl ?? false,
        systemMessage: buildSystemMessage("fix", { extraContext }),
        appendLog: log,
        progress,
        signal: turn.signal
      },
      onInterrupt,
      // Post-precheck / pre-run: snapshot pre-existing changes so the fix diff
      // is isolated. Runs ONLY after precheckRun passes. Uses `git stash create`
      // — an ephemeral snapshot object — so NOTHING (working tree, index, branch
      // history, stash ref) is mutated, unlike the prior baseline-commit design.
      beforeRun: () => {
        baselineCommit = gitHead(repoRoot);
        if (!baselineCommit) {
          envelopeDone = true;
          turn.clear();
          emit({
            status: "failed",
            jobId,
            error: "fix requires at least one commit to diff against (repository has no commits yet)."
          });
          process.exit(1);
        }
        const dirty = tryGit(["status", "--porcelain"], repoRoot);
        preFixDirty = dirty.ok && dirty.stdout.trim().length > 0;
        if (preFixDirty) {
          const snap = tryGit(["stash", "create"], repoRoot);
          diffBase = snap.ok && snap.stdout.trim() ? snap.stdout.trim() : baselineCommit;
          progress("Isolating the fix diff from your uncommitted changes (no commit made).");
          log(
            `pre-fix dirty; diff base = ${diffBase === baselineCommit ? "HEAD" : "stash-create snapshot"}`
          );
        } else {
          diffBase = baselineCommit;
        }
      },
      log
    }));
  } catch (err) {
    turn.clear();
    if (!envelopeDone) {
      envelopeDone = true;
      emit({ status: "failed", jobId, error: err.message, ...snapshotInfo() });
    }
    process.exit(1);
  }
  turn.clear();
  const success = result.success && !turn.timedOut();
  if (!success) {
    if (!envelopeDone) {
      envelopeDone = true;
      emit({
        status: "failed",
        jobId,
        error: turn.timedOut() ? `Timed out after ${timeoutMs}ms` : "Fix session did not complete successfully.",
        ...snapshotInfo()
      });
    }
    process.exit(1);
  }
  envelopeDone = true;
  const report = parseApplyReport(result.lastAssistantMessage, findings);
  const diff = computeStagedDiff(repoRoot, diffBase);
  const summary = result.summary?.trim() || `Applied ${report.applied.length}/${findings.length} finding(s); ${report.skipped.length} skipped.`;
  const envelope = {
    status: "fixed",
    jobId,
    summary,
    baselineCommit,
    preFixDirty,
    filesModified: diff.filesModified,
    linesAdded: diff.linesAdded,
    linesRemoved: diff.linesRemoved,
    applied: report.applied,
    skipped: report.skipped,
    model: requestedModel
  };
  const envelopeJson = emit(envelope);
  if (options.writePath) {
    const outPath = (0, import_node_path4.resolve)(cwd, options.writePath);
    (0, import_node_fs4.mkdirSync)((0, import_node_path4.dirname)(outPath), { recursive: true });
    (0, import_node_fs4.writeFileSync)(outPath, `${envelopeJson}
`, "utf-8");
    progress(`Report saved to ${outPath}`);
  }
  progress(
    `Fix done \u2014 applied=${report.applied.length} skipped=${report.skipped.length} files=${diff.filesModified.length} (+${diff.linesAdded}/-${diff.linesRemoved})`
  );
  log(
    `fix done: applied=${report.applied.length} skipped=${report.skipped.length} files=${diff.filesModified.length}`
  );
  progress(`Job log: ${jobLogPath(stateDir, jobId)}`);
}

// src/lib/zombie.ts
var import_node_fs5 = require("node:fs");
var STALE_LOG_MS = 6e4;
var PID_REUSE_STALE_MS = 6 * 60 * 60 * 1e3;
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function logMtimeMs(path) {
  try {
    if (!(0, import_node_fs5.existsSync)(path)) return null;
    return (0, import_node_fs5.statSync)(path).mtimeMs;
  } catch {
    return null;
  }
}
function isZombie(job, logFile, now = Date.now()) {
  if (job.status !== "running" && job.status !== "queued") return false;
  const mtime = logMtimeMs(logFile);
  const silentFor = (threshold) => {
    if (mtime == null) {
      const ref = Date.parse(job.startedAt ?? job.createdAt);
      return Number.isFinite(ref) && now - ref > threshold;
    }
    return now - mtime > threshold;
  };
  if (job.pid != null && isProcessAlive(job.pid)) {
    const requested = Number(job.request?.flags?.timeout);
    const ownWindow = Number.isFinite(requested) && requested > 0 ? requested + STALE_LOG_MS : 0;
    return silentFor(Math.max(PID_REUSE_STALE_MS, ownWindow));
  }
  return silentFor(STALE_LOG_MS);
}
function sweepZombieJobs(stateDir) {
  const reaped = [];
  const now = Date.now();
  for (const job of listJobs(stateDir)) {
    const logFile = jobLogPath(stateDir, job.id);
    if (!isZombie(job, logFile, now)) continue;
    markJobFailed(stateDir, job.id, "worker process died without writing exit status");
    reaped.push(job.id);
  }
  return reaped;
}

// src/commands/result.ts
async function runResult(cwd, options = {}) {
  const stateDir = resolveStateDir(cwd);
  sweepZombieJobs(stateDir);
  let jobId = options.jobId;
  if (!jobId) {
    const sessionId = getSessionId();
    const jobs = listJobs(stateDir, sessionId);
    const finished = jobs.find((j) => j.status === "completed" || j.status === "failed");
    if (!finished) {
      console.error("No completed jobs found.");
      process.exit(1);
    }
    jobId = finished.id;
  }
  const job = readJobFile(stateDir, jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exit(1);
  }
  if (job.status === "queued" || job.status === "running") {
    console.error(`Job ${jobId} is still ${job.status}. Use /harry:status to check progress.`);
    process.exit(1);
  }
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          id: job.id,
          kind: job.kind,
          status: job.status,
          result: job.result,
          errorMessage: job.errorMessage
        },
        null,
        2
      )
    );
    return;
  }
  if (job.status === "failed") {
    console.log(`## Job Failed: ${job.id}

**Error:** ${job.errorMessage ?? "Unknown error"}`);
    return;
  }
  if (job.result) {
    console.log(job.result);
  } else {
    console.log("Job completed but produced no output.");
  }
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
  sweepZombieJobs(stateDir);
  const sessionId = options.all ? void 0 : getSessionId();
  if (options.jobId) {
    const job = readJobFile(stateDir, options.jobId);
    if (!job) {
      console.error(`Job not found: ${options.jobId}`);
      process.exit(1);
    }
    if (options.json) {
      console.log(JSON.stringify(job, null, 2));
      return;
    }
    const logTail = readLogTail(stateDir, job.id, 15);
    console.log(renderJobDetail(job, logTail));
    return;
  }
  const jobs = listJobs(stateDir, sessionId);
  const codexRateLimits = readCodexRateLimits(stateDir);
  if (options.json) {
    console.log(
      JSON.stringify({ ...codexRateLimits ? { codex: codexRateLimits } : {}, jobs }, null, 2)
    );
    return;
  }
  const sections = [];
  if (codexRateLimits) sections.push(renderCodexBlock(codexRateLimits, codexRateLimits.capturedAt));
  const running = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const finished = jobs.filter((j) => j.status === "completed" || j.status === "failed");
  if (running.length > 0) {
    const block = ["## Running", renderJobsTable(running.map(toTableRow))];
    const logLines = [];
    for (const job of running) {
      const logTail = readLogTail(stateDir, job.id, 3);
      const lastLine = logTail[logTail.length - 1] ?? "";
      if (lastLine) logLines.push(`  ${job.id}: ${lastLine}`);
    }
    if (logLines.length > 0) {
      block.push("Last log:");
      block.push(...logLines);
    }
    sections.push(block.join("\n"));
  }
  if (finished.length > 0) {
    sections.push(["## Recent", renderJobsTable(finished.slice(0, 10).map(toTableRow))].join("\n"));
  }
  if (running.length === 0 && finished.length === 0) {
    sections.push("_No background jobs._");
  }
  console.log(sections.join("\n\n"));
}
function toTableRow(job) {
  const icon = job.status === "completed" ? "\u2713 " : job.status === "failed" ? "\u2717 " : job.status === "running" ? "\u25B6 " : job.status === "queued" ? "\u2026 " : "  ";
  return { id: job.id, kind: job.kind, status: icon + job.status, task: job.summary };
}
var TASK_MAX_WIDTH = 72;
function renderJobsTable(rows) {
  const headers = { id: "Job ID", kind: "Command", status: "Status", task: "Task" };
  const widths = {
    id: Math.max(headers.id.length, ...rows.map((r) => r.id.length)),
    kind: Math.max(headers.kind.length, ...rows.map((r) => r.kind.length)),
    status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
    task: Math.min(
      TASK_MAX_WIDTH,
      Math.max(headers.task.length, ...rows.map((r) => r.task.length))
    )
  };
  const border = (l, m, r) => l + "\u2500".repeat(widths.id + 2) + m + "\u2500".repeat(widths.kind + 2) + m + "\u2500".repeat(widths.status + 2) + m + "\u2500".repeat(widths.task + 2) + r;
  const renderRow = (r) => {
    const task = r.task.length > widths.task ? `${r.task.slice(0, widths.task - 1)}\u2026` : r.task.padEnd(widths.task);
    return `\u2502 ${r.id.padEnd(widths.id)} \u2502 ${r.kind.padEnd(widths.kind)} \u2502 ${r.status.padEnd(widths.status)} \u2502 ${task} \u2502`;
  };
  return [
    border("\u250C", "\u252C", "\u2510"),
    renderRow(headers),
    border("\u251C", "\u253C", "\u2524"),
    ...rows.map(renderRow),
    border("\u2514", "\u2534", "\u2518")
  ].join("\n");
}
function renderJobDetail(job, logTail) {
  const sections = [];
  sections.push(`## Job: ${job.id}`);
  sections.push(`**Kind:** ${job.kind}`);
  sections.push(`**Status:** ${job.status}`);
  sections.push(`**Phase:** ${job.phase}`);
  sections.push(`**Summary:** ${job.summary}`);
  sections.push(`**Created:** ${job.createdAt}`);
  if (job.startedAt) sections.push(`**Started:** ${job.startedAt}`);
  if (job.completedAt) sections.push(`**Completed:** ${job.completedAt}`);
  if (job.errorMessage) sections.push(`**Error:** ${job.errorMessage}`);
  if (logTail.length > 0) {
    sections.push("\n### Recent Log");
    sections.push("```");
    sections.push(logTail.join("\n"));
    sections.push("```");
  }
  return sections.join("\n");
}

// src/companion.ts
function printUsage() {
  console.log(
    [
      "Usage:",
      "  companion setup [--json]",
      "  companion review [focus...] [--adversarial] [--base <ref>]",
      "                           [--scope auto|working-tree|branch] [--fix]",
      "                           [--model <id>] [--reasoning <low|medium|high|xhigh>]",
      "                           [--context <text|@file|@->]",
      "                           [--timeout <ms>] [--background]",
      '  companion ask "<prompt>" [--model <id>] [--reasoning <low|medium|high|xhigh>] [--context <text|@file|@->]',
      "  companion fix --findings <path> [--model <id>]",
      "                        [--reasoning <low|medium|high|xhigh>]",
      "                        [--context <text|@file|@->]",
      "                        [--timeout <ms>] [--write <path>]",
      "  companion status [job-id] [--all] [--json]",
      "  companion result [job-id] [--json]",
      "",
      "Commands:",
      "  setup       Check Codex auth and availability",
      "  review      Run a code review (markdown, or JSON findings with --fix)",
      "  ask         Ask a single prompt (read-only) and print the answer",
      "  fix         Apply Claude-Code-approved review findings to the working tree",
      "  status      Show Codex rate-limit snapshot plus background job status",
      "  result      Retrieve a background job's output"
    ].join("\n")
  );
}
var BOOLEAN_FLAGS = /* @__PURE__ */ new Set([
  "adversarial",
  "all",
  "allow-shell",
  "allow-url",
  "background",
  "check",
  "fix",
  "full",
  "harry-fix",
  "help",
  "simplify",
  "json"
]);
var KNOWN_FLAGS = {
  setup: /* @__PURE__ */ new Set(["json"]),
  review: /* @__PURE__ */ new Set([
    "adversarial",
    "simplify",
    "full",
    "harry-fix",
    "scope",
    "base",
    "model",
    "reasoning",
    "timeout",
    "fix",
    "context",
    "background"
  ]),
  ask: /* @__PURE__ */ new Set(["task", "model", "reasoning", "timeout", "context"]),
  fix: /* @__PURE__ */ new Set([
    "findings",
    "model",
    "reasoning",
    "timeout",
    "allow-shell",
    "allow-url",
    "write",
    "context"
  ]),
  status: /* @__PURE__ */ new Set(["all", "json"]),
  result: /* @__PURE__ */ new Set(["json"]),
  _worker: /* @__PURE__ */ new Set(["job-id", "cwd"])
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
      if (flags.full !== void 0) {
        throw new Error(
          "--full is handled by the /review command orchestrator, not the CLI. Run the simplify/adversarial reviews separately, or use /review --full."
        );
      }
      if (flags["harry-fix"] !== void 0) {
        throw new Error(
          "--harry-fix is a /review fix-backend selector, not a CLI flag. To apply findings, run: fix --findings <path> --reasoning xhigh."
        );
      }
      const validScopes = ["auto", "working-tree", "branch"];
      const validEfforts = ["low", "medium", "high", "xhigh"];
      const scope = flagEnum(flags, "scope", validScopes);
      const reasoning = flagEnum(flags, "reasoning", validEfforts);
      if (flags.background === true) {
        const jobId = enqueueBackground("review", args, flags, import_node_process3.default.cwd());
        console.log(JSON.stringify({ status: "queued", jobId }));
        break;
      }
      await runReview(import_node_process3.default.cwd(), {
        adversarial: flags.adversarial === true,
        simplify: flags.simplify === true,
        scope,
        base: flagString(flags, "base"),
        focusText: args.join(" "),
        model: flagString(flags, "model"),
        reasoning,
        timeout: flagNumber(flags, "timeout"),
        fix: flags.fix === true,
        context: flagString(flags, "context")
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
    case "fix": {
      const reasoning = flagEnum(flags, "reasoning", ["low", "medium", "high", "xhigh"]);
      await runFix(import_node_process3.default.cwd(), {
        findingsPath: flagString(flags, "findings"),
        model: flagString(flags, "model"),
        reasoning,
        timeout: flagNumber(flags, "timeout"),
        allowShell: flags["allow-shell"] === true,
        allowUrl: flags["allow-url"] === true,
        writePath: flagString(flags, "write"),
        context: flagString(flags, "context")
      });
      break;
    }
    case "status":
      await runStatus(import_node_process3.default.cwd(), {
        jobId: args[0],
        all: flags.all === true,
        json: flags.json === true
      });
      break;
    case "result":
      await runResult(import_node_process3.default.cwd(), {
        jobId: args[0],
        json: flags.json === true
      });
      break;
    // Internal: background worker entry point.
    case "_worker": {
      const jobId = flagString(flags, "job-id");
      const workerCwd = flagString(flags, "cwd") ?? import_node_process3.default.cwd();
      if (!jobId) {
        console.error("Worker requires --job-id");
        import_node_process3.default.exit(1);
      }
      await runWorker(jobId, workerCwd);
      break;
    }
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
