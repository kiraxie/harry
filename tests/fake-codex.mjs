// Portions Copyright 2026 OpenAI, licensed under Apache-2.0.
// Modified from codex-plugin-cc's tests/fake-codex-fixture.mjs (trimmed to the
// app-server turn/auth surface; broker behaviors removed; harry test behaviors
// added). See NOTICE.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}

export function installFakeCodex(binDir, behavior = "logged-in") {
  const statePath = path.join(binDir, "fake-codex-state.json");
  const scriptPath = path.join(binDir, "codex");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");

const STATE_PATH = ${JSON.stringify(statePath)};
const BEHAVIOR = ${JSON.stringify(behavior)};

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { nextThreadId: 1, nextTurnId: 1, appServerStarts: 0, threads: [], capabilities: null };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function buildThread(thread) {
  return {
    id: thread.id,
    preview: thread.preview || "",
    ephemeral: Boolean(thread.ephemeral),
    modelProvider: "openai",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    status: { type: "idle" },
    path: null,
    cwd: thread.cwd,
    cliVersion: "fake-codex",
    source: "appServer",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: thread.name || null,
    turns: []
  };
}

function buildTurn(id, status = "inProgress", error = null) {
  return { id, status, items: [], error };
}

function buildAccountReadResult() {
  switch (BEHAVIOR) {
    case "logged-out":
      return { account: null, requiresOpenaiAuth: true };
    default:
      return {
        account: { type: "chatgpt", email: "test@example.com", planType: "plus" },
        requiresOpenaiAuth: true
      };
  }
}

function buildConfigReadResult() {
  return { config: { model_provider: "openai" }, origins: {} };
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function nextThread(state, cwd, ephemeral) {
  const thread = {
    id: "thr_" + state.nextThreadId++,
    cwd: cwd || process.cwd(),
    name: null,
    preview: "",
    ephemeral: Boolean(ephemeral),
    createdAt: now(),
    updatedAt: now()
  };
  state.threads.unshift(thread);
  saveState(state);
  return thread;
}

function ensureThread(state, threadId) {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) {
    throw new Error("unknown thread " + threadId);
  }
  return thread;
}

function nextTurnId(state) {
  const turnId = "turn_" + state.nextTurnId++;
  saveState(state);
  return turnId;
}

function emitTurnCompleted(threadId, turnId, item) {
  const items = Array.isArray(item) ? item : [item];
  send({ method: "turn/started", params: { threadId, turn: buildTurn(turnId) } });
  for (const entry of items) {
    if (entry && entry.started) {
      send({ method: "item/started", params: { threadId, turnId, item: entry.started } });
    }
    if (entry && entry.completed) {
      send({ method: "item/completed", params: { threadId, turnId, item: entry.completed } });
    }
  }
  send({ method: "turn/completed", params: { threadId, turn: buildTurn(turnId, "completed") } });
}

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli test");
  process.exit(0);
}
if (args[0] === "app-server" && args[1] === "--help") {
  console.log("fake app-server help");
  process.exit(0);
}
if (args[0] !== "app-server") {
  process.exit(1);
}

const bootState = loadState();
bootState.appServerStarts = (bootState.appServerStarts || 0) + 1;
saveState(bootState);

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  const message = JSON.parse(line);
  const state = loadState();

  try {
    switch (message.method) {
      case "initialize":
        if (BEHAVIOR === "no-init") {
          // Never answer initialize: simulate a child blocked on an interactive
          // / auth prompt. The caller's connect timeout must fire.
          break;
        }
        state.capabilities = message.params.capabilities || null;
        saveState(state);
        send({ id: message.id, result: { userAgent: "fake-codex-app-server" } });
        break;

      case "initialized":
        break;

      case "account/read":
        send({ id: message.id, result: buildAccountReadResult() });
        break;

      case "config/read":
        send({ id: message.id, result: buildConfigReadResult() });
        break;

      case "thread/start": {
        const thread = nextThread(state, message.params.cwd, message.params.ephemeral);
        send({
          id: message.id,
          result: {
            thread: buildThread(thread),
            model: message.params.model || "gpt-5.4",
            modelProvider: "openai",
            serviceTier: null,
            cwd: thread.cwd,
            approvalPolicy: "never",
            sandbox: { type: "readOnly", access: { type: "fullAccess" }, networkAccess: false },
            reasoningEffort: null
          }
        });
        send({ method: "thread/started", params: { thread: { id: thread.id } } });
        break;
      }

      case "turn/start": {
        const thread = ensureThread(state, message.params.threadId);
        const prompt = (message.params.input || [])
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\\n");
        const turnId = nextTurnId(state);
        thread.updatedAt = now();
        state.lastTurnStart = { threadId: message.params.threadId, turnId, prompt };
        saveState(state);
        send({ id: message.id, result: { turn: buildTurn(turnId) } });

        if (BEHAVIOR === "task-stuck") {
          // Ack the turn but NEVER emit turn/completed (and no final answer): the
          // caller's anti-hang timeout must end the turn.
          send({ method: "turn/started", params: { threadId: thread.id, turn: buildTurn(turnId) } });
          break;
        }

        if (BEHAVIOR === "task-ok" || BEHAVIOR === "task-with-ratelimits") {
          send({ method: "turn/started", params: { threadId: thread.id, turn: buildTurn(turnId) } });
          send({
            method: "item/completed",
            params: {
              threadId: thread.id,
              turnId,
              item: { type: "agentMessage", id: "msg_" + turnId, text: "Handled the requested task.\\n" + prompt, phase: "final_answer" }
            }
          });
          if (BEHAVIOR === "task-with-ratelimits") {
            send({
              method: "token_count",
              params: {
                threadId: thread.id,
                turnId,
                rate_limits: { primary: { used_percent: 12 } },
                last_token_usage: { input_tokens: 5, output_tokens: 7 }
              }
            });
          }
          send({ method: "turn/completed", params: { threadId: thread.id, turnId, turn: buildTurn(turnId, "completed") } });
          break;
        }

        emitTurnCompleted(thread.id, turnId, [
          {
            completed: { type: "agentMessage", id: "msg_" + turnId, text: "Handled the requested task.\\n" + prompt, phase: "final_answer" }
          }
        ]);
        break;
      }

      default:
        send({ id: message.id, error: { code: -32601, message: "Unsupported method: " + message.method } });
        break;
    }
  } catch (error) {
    send({ id: message.id, error: { code: -32000, message: error.message } });
  }
});
`;
  writeExecutable(scriptPath, source);

  if (process.platform === "win32") {
    const cmdWrapper = `@echo off\r\nnode "%~dp0codex" %*\r\n`;
    fs.writeFileSync(path.join(binDir, "codex.cmd"), cmdWrapper, { encoding: "utf8" });
  }
}

export function buildEnv(binDir) {
  const sep = process.platform === "win32" ? ";" : ":";
  return {
    ...process.env,
    PATH: `${binDir}${sep}${process.env.PATH}`
  };
}
