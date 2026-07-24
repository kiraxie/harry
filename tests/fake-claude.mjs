// Fake `claude` CLI shim for the eval-runner tests, mirroring tests/fake-codex.mjs.
// It is NOT the real claude binary and never makes an API call: the runner
// resolves it via EVALS_CLAUDE_BIN, so tests exercise run/score without spend.
//
// The shim mimics `claude -p <prompt> --model <id> --output-format json`: it
// prints a JSON object with a `result` string, and records every invocation it
// saw (prompt, model, and the CLAUDE_CONFIG_DIR handed to it, plus whether that
// dir carried a laws-bearing CLAUDE.md) into fake-claude-calls.json in binDir,
// so a test can assert the runner's env isolation.

import fs from "node:fs";
import path from "node:path";

function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}

// `reply` is a canned response string the shim echoes back as the assistant
// `result`. Default is a neutral string; pass one that satisfies (or violates)
// a case's checks to drive scoring in a test.
export function installFakeClaude(binDir, reply = "A neutral reply with no tier or debt marker.") {
  const callsPath = path.join(binDir, "fake-claude-calls.json");
  const scriptPath = path.join(binDir, "claude");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CALLS_PATH = ${JSON.stringify(callsPath)};
const REPLY = ${JSON.stringify(reply)};

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const configDir = process.env.CLAUDE_CONFIG_DIR || null;
const claudeMd = configDir ? path.join(configDir, "CLAUDE.md") : null;
const hasClaudeMd = Boolean(claudeMd && fs.existsSync(claudeMd));
const lawsPresent =
  hasClaudeMd && fs.readFileSync(claudeMd, "utf8").includes("Resident Engineering Laws");

const call = {
  prompt: flag("-p"),
  model: flag("--model"),
  allowedTools: argv.includes("--allowedTools") ? flag("--allowedTools") : undefined,
  permissionMode: argv.includes("--permission-mode") ? flag("--permission-mode") : undefined,
  configDir,
  cwd: process.cwd(),
  cwdHasClaudeMd: fs.existsSync(path.join(process.cwd(), "CLAUDE.md")),
  hasClaudeMd,
  lawsPresent,
};
const calls = fs.existsSync(CALLS_PATH) ? JSON.parse(fs.readFileSync(CALLS_PATH, "utf8")) : [];
calls.push(call);
fs.writeFileSync(CALLS_PATH, JSON.stringify(calls, null, 2));

// Agentic script mode: when FAKE_CLAUDE_SCRIPT names a .mjs, run it IN the
// current cwd (the materialized fixture repo) to simulate a session's tool use
// — branch/edit/commit — so a test can exercise the artifact checks with no
// real claude. Text-mode tests leave it unset and this is skipped.
const scriptPath = process.env.FAKE_CLAUDE_SCRIPT;
if (scriptPath) {
  execFileSync(process.execPath, [scriptPath], { cwd: process.cwd(), stdio: "inherit" });
}

process.stdout.write(
  JSON.stringify({ type: "result", subtype: "success", is_error: false, result: REPLY }) + "\\n",
);
`;
  writeExecutable(scriptPath, source);
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "claude.cmd"), `@echo off\r\nnode "%~dp0claude" %*\r\n`, {
      encoding: "utf8",
    });
  }
  return { scriptPath, callsPath };
}

export function readCalls(binDir) {
  const callsPath = path.join(binDir, "fake-claude-calls.json");
  if (!fs.existsSync(callsPath)) return [];
  return JSON.parse(fs.readFileSync(callsPath, "utf8"));
}
