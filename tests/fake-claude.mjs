// Fake `claude` CLI shim for the eval-runner tests.
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
//
// `settings` drives the shim's simulations. It is written to a file next to the
// shim, NOT passed through the environment: the runner hands its children an
// allowlisted env, and a test seam must not need a hole in that allowlist.
//   failOnNth — 1-based call numbers whose reply is swapped for failReply
//   failReply — the check-missing reply those calls return
//   script    — a .mjs the shim runs in its cwd, simulating a session's tool use
//   fail      — exit nonzero with the reply on stderr (spawn/crash path)
//   isError   — exit 0 with an is_error:true JSON result ("Not logged in" shape)
//   stderr    — text written to stderr on an otherwise normal run
//   callsInConfigDir — log calls into $CLAUDE_CONFIG_DIR instead of binDir: under
//               the write-allowlist jail the shim may write only its trial's dirs,
//               so jailed tests read the log back with readCalls(line.configDir)
export function installFakeClaude(
  binDir,
  reply = "A neutral reply with no tier or debt marker.",
  settings = {},
) {
  const callsPath = path.join(binDir, "fake-claude-calls.json");
  const settingsPath = path.join(binDir, "fake-claude-settings.json");
  const scriptPath = path.join(binDir, "claude");
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const tty = require("node:tty");

const CALLS_PATH = ${JSON.stringify(callsPath)};
const SETTINGS = JSON.parse(fs.readFileSync(${JSON.stringify(settingsPath)}, "utf8"));
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
// Whether a credential file is present in the config dir AT SESSION TIME — the
// runner must never put one there, so tests assert this stays false. Also record
// the two auth vars the child received (ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN;
// tests only ever hand in obvious fakes), and whether either EVALS_-prefixed source
// var leaked through — presence only, never its value.
const hasCredentials = Boolean(configDir && fs.existsSync(path.join(configDir, ".credentials.json")));

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
  hasCredentials,
  apiKey: process.env.ANTHROPIC_API_KEY ?? null,
  oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null,
  evalsApiKeyForwarded: "EVALS_ANTHROPIC_API_KEY" in process.env,
  evalsOauthForwarded: "EVALS_CLAUDE_CODE_OAUTH_TOKEN" in process.env,
  // Names only, never values: enough to pin the allowlist on the real spawn.
  envKeys: Object.keys(process.env).sort(),
  // Whether fds 0, 1 and 2 are a terminal, recorded from inside the session: a
  // jailed session must hold none (the jail denies opening one, not reading one
  // it was handed).
  tty: [0, 1, 2].map((fd) => tty.isatty(fd)),
};
const callsPath =
  SETTINGS.callsInConfigDir && configDir ? path.join(configDir, "fake-claude-calls.json") : CALLS_PATH;
const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf8")) : [];
calls.push(call);
fs.writeFileSync(callsPath, JSON.stringify(calls, null, 2));

// Multi-trial seam: the calls file IS the per-call counter, so callNumber is
// this invocation's 1-based index (invocations are synchronous/sequential).
// A call listed in SETTINGS.failOnNth returns SETTINGS.failReply instead, letting
// a test script exactly which trial of an N-trial run fails.
const callNumber = calls.length;
const failThisCall = (SETTINGS.failOnNth || []).includes(callNumber);
const reply = failThisCall
  ? (SETTINGS.failReply || "A non-matching reply: no lawful marker here.")
  : REPLY;

// Agentic script mode: SETTINGS.script names a .mjs run IN the current cwd (the
// materialized fixture repo) to simulate a session's tool use — branch/edit/commit
// — so a test can exercise the artifact checks with no real claude.
if (SETTINGS.script) {
  try {
    execFileSync(process.execPath, [SETTINGS.script], { cwd: process.cwd(), stdio: "inherit" });
  } catch (err) {
    // The script's own error already went to stderr (inherited); exit with its
    // status rather than print this shim's stack after it, which would push the
    // script's error out of the runner's stderr tail.
    process.exit(err.status ?? 1);
  }
}

if (SETTINGS.stderr) process.stderr.write(SETTINGS.stderr);
if (SETTINGS.fail) {
  process.stderr.write(REPLY + "\\n");
  process.exit(1);
}
const isError = Boolean(SETTINGS.isError);
process.stdout.write(
  JSON.stringify({
    type: "result",
    subtype: isError ? "error_during_execution" : "success",
    is_error: isError,
    result: reply,
  }) + "\\n",
);
`;
  writeExecutable(scriptPath, source);
  return { scriptPath, callsPath };
}

export function readCalls(binDir) {
  const callsPath = path.join(binDir, "fake-claude-calls.json");
  if (!fs.existsSync(callsPath)) return [];
  return JSON.parse(fs.readFileSync(callsPath, "utf8"));
}
