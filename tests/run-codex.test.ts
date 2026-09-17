/**
 * How the companion spawns `codex`, per platform. On Windows `codex` is resolved
 * against PATH x PATHEXT first: a native `codex.exe` is spawned directly, while
 * npm's `codex.cmd` shim, which Node cannot spawn without a shell, gets one
 * cmd.exe command line. No Windows host runs these tests: resolution runs against
 * a fake filesystem, and the round trip below simulates cmd.exe's parses (the
 * `/c` line, then the shim's `%*`) and the C runtime's argv split, asserting
 * every argument comes back intact.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { codexMissing, codexSpawn, resolveCodex } from "../src/lib/run-codex.ts";

/** cmd.exe metacharacters that must never reach cmd unescaped (space separates args). */
const CMD_META = new Set([...'()[]%!^"`<>&|;,*?']);

/** One cmd.exe parse: `^x` yields `x`; any other metacharacter is a failure. */
function cmdParse(line: string): string {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "^") {
      assert.ok(i + 1 < line.length, `dangling caret in ${line}`);
      out += line[++i];
    } else {
      assert.ok(!CMD_META.has(c), `unescaped cmd metacharacter ${c} in: ${line}`);
      out += c;
    }
  }
  return out;
}

/** The C runtime's argv split (CommandLineToArgvW rules). */
function crtSplit(line: string): string[] {
  const args: string[] = [];
  let cur = "";
  let inArg = false;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      let n = 0;
      while (line[i] === "\\") {
        n++;
        i++;
      }
      if (line[i] === '"') {
        cur += "\\".repeat(Math.floor(n / 2));
        if (n % 2 === 1) cur += '"';
        else quoted = !quoted;
      } else {
        cur += "\\".repeat(n);
        i--;
      }
      inArg = true;
    } else if (c === '"') {
      quoted = !quoted;
      inArg = true;
    } else if (c === " " && !quoted) {
      if (inArg) args.push(cur);
      cur = "";
      inArg = false;
    } else {
      cur += c;
      inArg = true;
    }
  }
  if (inArg) args.push(cur);
  return args;
}

/** A fake Windows filesystem: case-insensitive lookup over `files`. */
function fakeFs(...files: string[]): (path: string) => boolean {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return (path) => set.has(path.toLowerCase());
}

/** Split a cmd.exe line at its first caret-unescaped space: the command, then the rest. */
function splitCommand(line: string): [string, string] {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "^") i++;
    else if (line[i] === " ") return [line.slice(0, i), line.slice(i + 1)];
  }
  return [line, ""];
}

const ARGS = [
  "exec",
  "-o",
  "C:\\Users\\Jane Doe\\a.md",
  "-c",
  'model_reasoning_effort="high"',
  "-",
];

test("codexSpawn passes argv straight through, without a shell, off Windows", () => {
  const args = ["exec", "-o", "/tmp/a b/ask.md", "-c", 'model_reasoning_effort="high"', "-"];
  const env = { PATH: "C:\\bin" };
  const exists = fakeFs("C:\\bin\\codex.cmd");
  for (const platform of ["darwin", "linux"] as const) {
    assert.equal(resolveCodex(env, platform, exists), "codex");
    assert.deepEqual(codexSpawn(args, platform, env, exists), {
      command: "codex",
      args,
      shell: false,
    });
  }
});

test("codexSpawn on Windows spawns a resolved codex.exe directly, with raw args", () => {
  const env = { PATH: "C:\\tools\\codex", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  assert.deepEqual(codexSpawn(ARGS, "win32", env, fakeFs("C:\\tools\\codex\\codex.exe")), {
    command: "C:\\tools\\codex\\codex.EXE",
    args: ARGS,
    shell: false,
  });
});

test("codexSpawn on Windows runs a resolved codex.cmd shim through one cmd.exe line", () => {
  const shim = "C:\\Program Files\\nodejs\\codex.CMD";
  const spec = codexSpawn(ARGS, "win32", { Path: "C:\\Program Files\\nodejs" }, fakeFs(shim));
  assert.ok(spec);
  assert.equal(spec.shell, true);
  assert.deepEqual(spec.args, [], "Node must not append unquoted args to the shell line");
  const [command, rest] = splitCommand(spec.command);
  // The command is parsed once (cmd's /c line); the args twice (that, then the shim's %*).
  assert.equal(cmdParse(command), shim);
  assert.deepEqual(crtSplit(cmdParse(cmdParse(rest))), ARGS);
});

test("resolveCodex follows PATHEXT order within a PATH entry", () => {
  const exists = fakeFs("C:\\bin\\codex.cmd", "C:\\bin\\codex.exe");
  const resolve = (env: NodeJS.ProcessEnv) => resolveCodex(env, "win32", exists);
  assert.equal(resolve({ PATH: "C:\\bin", PATHEXT: ".EXE;.CMD" }), "C:\\bin\\codex.EXE");
  assert.equal(resolve({ PATH: "C:\\bin", PATHEXT: ".cmd;.exe" }), "C:\\bin\\codex.cmd");
  // No PATHEXT: the Windows default, .COM;.EXE;.BAT;.CMD.
  assert.equal(resolve({ PATH: "C:\\bin" }), "C:\\bin\\codex.EXE");
});

test("resolveCodex takes the first PATH entry with a hit, skipping empty and unquoting quoted ones", () => {
  const exists = fakeFs("C:\\npm\\codex.cmd", "C:\\Program Files\\Codex\\codex.exe");
  const resolve = (PATH: string) => resolveCodex({ PATH, PATHEXT: ".EXE;.CMD" }, "win32", exists);
  assert.equal(
    resolve(';"C:\\Program Files\\Codex";;C:\\npm'),
    "C:\\Program Files\\Codex\\codex.EXE",
  );
  assert.equal(resolve('C:\\npm;"C:\\Program Files\\Codex"'), "C:\\npm\\codex.CMD");
});

test("codexSpawn on Windows with no codex on PATH plans no spawn", () => {
  const exists = fakeFs("C:\\bin\\codex.ps1", "C:\\elsewhere\\codex.exe");
  const env = { PATH: "C:\\bin;C:\\other", PATHEXT: ".EXE;.CMD" };
  assert.equal(resolveCodex(env, "win32", exists), null);
  assert.equal(codexSpawn(ARGS, "win32", env, exists), null);
  assert.equal(codexSpawn(ARGS, "win32", {}, exists), null);
});

test("codexSpawn on Windows builds a shim command line that round-trips every argument", () => {
  const args = [
    "exec",
    "review",
    "--ephemeral",
    "-c",
    'sandbox_mode="read-only"',
    "-o",
    "C:\\Users\\Jane Doe\\AppData\\harry\\asks\\ask-20260917-101010.md",
    "-c",
    'model_reasoning_effort="high"',
    "C:\\trailing backslash\\",
    'a "quoted" \\"mess\\" & | < > ^ % !PATH! %PATH% (x), y; z* ?',
    "",
    "-",
  ];
  const spec = codexSpawn(args, "win32", { PATH: "C:\\npm" }, fakeFs("C:\\npm\\codex.cmd"));
  assert.ok(spec);
  assert.equal(spec.shell, true);
  assert.deepEqual(spec.args, []);
  const [command, rest] = splitCommand(spec.command);
  // Parse 1: cmd.exe's /c line. Parse 2 (args only): the shim's %* re-expansion. Then the CRT split.
  assert.equal(cmdParse(command), "C:\\npm\\codex.CMD");
  assert.deepEqual(crtSplit(cmdParse(cmdParse(rest))), args);
});

test("codexMissing: only ENOENT — a 9009 from a resolved shim is a real failure, not a missing CLI", () => {
  const enoent = { error: Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }) };
  assert.equal(codexMissing({ ...enoent, status: null }), true);
  assert.equal(codexMissing({ status: 9009 }), false);
  assert.equal(codexMissing({ status: 1 }), false);
});
