#!/usr/bin/env node
/**
 * Fake `codex` CLI for the companion tests — stands in for `codex exec`,
 * `codex exec review`, `codex --version` and `codex login status`.
 *
 * Installed by a test as a `codex` shell shim first on PATH. Behaviour is
 * driven entirely by env:
 *   FAKE_CODEX_CLI_RECORD_DIR  where to write `argv.json` and `stdin.txt`
 *                              (exec runs only)
 *   FAKE_CODEX_CLI_EXIT        exit code (default 0)
 *   FAKE_CODEX_CLI_STDERR      text written to stderr before exiting
 *   FAKE_CODEX_CLI_OUTPUT      `write` (default) | `skip` | `empty` — what to do
 *                              with the `-o` path. A non-zero exit never writes
 *                              it, matching the real CLI.
 *   FAKE_CODEX_CLI_REVIEW      the markdown written to `-o` (review or answer)
 *   FAKE_CODEX_CLI_VERSION     what `--version` reports (default 0.152.0)
 *   FAKE_CODEX_CLI_LOGIN       `in` (default) | `out` — `login status` result
 *   FAKE_CODEX_CLI_WARNING     a startup warning line written to stderr first by
 *                              `--version` and `login status`
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REVIEW = process.env.FAKE_CODEX_CLI_REVIEW ?? "## Findings\n\n- [P1] Planted defect\n";

const argv = process.argv.slice(2);

const warning = process.env.FAKE_CODEX_CLI_WARNING;

if (argv[0] === "--version") {
  if (warning) process.stderr.write(`${warning}\n`);
  process.stdout.write(`codex-cli ${process.env.FAKE_CODEX_CLI_VERSION ?? "0.152.0"}\n`);
  process.exit(0);
}

// The real CLI reports login status on stderr, with an empty stdout.
if (argv[0] === "login" && argv[1] === "status") {
  if (warning) process.stderr.write(`${warning}\n`);
  if ((process.env.FAKE_CODEX_CLI_LOGIN ?? "in") === "in") {
    process.stderr.write("Logged in using ChatGPT\n");
    process.exit(0);
  }
  process.stderr.write("Not logged in\n");
  process.exit(1);
}

let stdin = "";
try {
  stdin = readFileSync(0, "utf8");
} catch {
  stdin = "";
}

const recordDir = process.env.FAKE_CODEX_CLI_RECORD_DIR;
if (recordDir) {
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(path.join(recordDir, "argv.json"), JSON.stringify(argv));
  writeFileSync(path.join(recordDir, "stdin.txt"), stdin);
}

// The real CLI echoes the final message on stdout too; the companion must not
// forward it (the output would be printed twice).
process.stdout.write("codex-stdout-noise\n");

const exitCode = Number(process.env.FAKE_CODEX_CLI_EXIT ?? "0");
if (process.env.FAKE_CODEX_CLI_STDERR) process.stderr.write(process.env.FAKE_CODEX_CLI_STDERR);

const oIndex = argv.indexOf("-o");
const outPath = oIndex === -1 ? undefined : argv[oIndex + 1];
const mode = process.env.FAKE_CODEX_CLI_OUTPUT ?? "write";
if (exitCode === 0 && outPath && mode !== "skip") {
  writeFileSync(outPath, mode === "empty" ? "" : REVIEW);
}
process.exit(exitCode);
