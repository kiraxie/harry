#!/usr/bin/env node
/**
 * Fake `codex` CLI for the `companion review` tests — stands in for
 * `codex exec review`. Not an app-server fake (that is tests/fake-codex.mjs);
 * this one only models the one-shot exec surface review now drives.
 *
 * Installed by a test as a `codex` shell shim first on PATH. Behaviour is
 * driven entirely by env:
 *   FAKE_CODEX_CLI_RECORD_DIR  where to write `argv.json` and `stdin.txt`
 *   FAKE_CODEX_CLI_EXIT        exit code (default 0)
 *   FAKE_CODEX_CLI_STDERR      text written to stderr before exiting
 *   FAKE_CODEX_CLI_OUTPUT      `write` (default) | `skip` | `empty` — what to do
 *                              with the `-o` path. A non-zero exit never writes
 *                              it, matching the real CLI.
 *   FAKE_CODEX_CLI_REVIEW      the markdown written to `-o`
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REVIEW = process.env.FAKE_CODEX_CLI_REVIEW ?? "## Findings\n\n- [P1] Planted defect\n";

const argv = process.argv.slice(2);
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
// forward it (the review would be printed twice).
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
