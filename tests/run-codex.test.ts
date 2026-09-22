/**
 * How the companion spawns `codex`, per platform. Off Windows `codex` is resolved
 * against absolute PATH entries to an absolute path, against real temp dirs, so
 * a `codex` in the cwd is never reachable. On Windows `codex` is resolved
 * against PATH x PATHEXT first: a native `codex.exe` is spawned directly, while
 * npm's `codex.cmd` shim, which Node cannot spawn without a shell, gets one
 * cmd.exe command line. No Windows host runs these tests: resolution runs against
 * a fake filesystem, and the round trip below simulates cmd.exe's parses (the
 * `/c` line, then the shim's `%*`) and the C runtime's argv split, asserting
 * every argument comes back intact.
 */

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path, { win32 } from "node:path";
import test from "node:test";

import { resolveCodex, winSpawnMode } from "../src/lib/path-search.ts";
import {
  capLogLine,
  codexMissing,
  codexSpawn,
  forwardedSignals,
  NO_ERROR_LINE,
  spawnCodex,
  spawnCodexSync,
} from "../src/lib/run-codex.ts";

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

const POSIX_ONLY = { skip: process.platform === "win32" && "POSIX PATH search" };
/** A test whose fake `codex` is a `#!/bin/sh` script, which the win32 resolver never finds. */
const POSIX_SHIM = { skip: process.platform === "win32" && "#!/bin/sh fake codex" };

/**
 * A fresh dir holding a `codex` shell script with `mode` that, when run, drops
 * `ran-<dir name>` into `markers` — so a test can tell which `codex` ran.
 */
function codexDir(prefix: string, markers: string, mode = 0o755): string {
  const dir = tempDir(prefix);
  const marker = path.join(markers, `ran-${path.basename(dir)}`);
  writeFileSync(path.join(dir, "codex"), `#!/bin/sh\n: > "${marker}"\nexit 0\n`);
  chmodSync(path.join(dir, "codex"), mode);
  return dir;
}

test(
  "codexSpawn off Windows spawns the resolved absolute path, argv untouched, without a shell",
  POSIX_ONLY,
  () => {
    const args = ["exec", "-o", "/tmp/a b/ask.md", "-c", 'model_reasoning_effort="high"', "-"];
    const bin = codexDir("harry-rc-bin-", tempDir("harry-rc-markers-"));
    const env = { PATH: `/nonexistent-harry-dir:${bin}` };
    for (const platform of ["darwin", "linux"] as const) {
      assert.equal(resolveCodex(env, platform), path.join(bin, "codex"));
      assert.deepEqual(codexSpawn(args, platform, env), {
        command: path.join(bin, "codex"),
        args,
        shell: false,
      });
    }
  },
);

test(
  "resolveCodex off Windows skips a non-executable codex for a later executable one",
  POSIX_ONLY,
  () => {
    const markers = tempDir("harry-rc-markers-");
    const first = codexDir("harry-rc-noexec-", markers, 0o644);
    const second = codexDir("harry-rc-bin-", markers);
    // A directory named `codex` is not a hit either, even with its x bits set.
    const dirNamedCodex = tempDir("harry-rc-dircodex-");
    mkdirSync(path.join(dirNamedCodex, "codex"), { mode: 0o755 });
    const env = { PATH: [first, dirNamedCodex, second].join(":") };
    assert.equal(resolveCodex(env, process.platform), path.join(second, "codex"));
  },
);

// An empty PATH entry (`:x`, `x:`, `a::b`) or a relative one (`.`, `bin`) means
// "relative to the cwd" to execvp, and `review` runs codex with cwd = the
// repository under review — so a repo shipping `./codex` would run its own code.
for (const [label, entry] of [
  ["an empty", ""],
  ["a relative `.`", "."],
  ["a relative `./`", "./"],
] as const) {
  test(
    `spawnCodexSync never runs a cwd \`codex\` reached through ${label} PATH entry`,
    POSIX_ONLY,
    () => {
      const markers = tempDir("harry-rc-markers-");
      const trap = codexDir("harry-rc-trap-", markers);
      const empty = tempDir("harry-rc-empty-");
      for (const PATH of [`${entry}:${empty}`, `${empty}:${entry}`, `${empty}:${entry}:${empty}`]) {
        const res = spawnCodexSync(["--version"], { cwd: trap, env: { PATH }, encoding: "utf8" });
        assert.deepEqual(
          readdirSync(markers),
          [],
          `PATH=${JSON.stringify(PATH)} ran the repo's codex`,
        );
        assert.equal(res.pid, 0, "nothing may be spawned");
        const error = res.error as NodeJS.ErrnoException;
        assert.equal(error?.code, "ENOENT");
        assert.equal(error.path, "codex");
        assert.equal(codexMissing(res), true);
      }
    },
  );
}

test(
  "spawnCodex never runs a cwd `codex` through an empty PATH entry, and runs the PATH one",
  POSIX_ONLY,
  async () => {
    const markers = tempDir("harry-rc-markers-");
    const trap = codexDir("harry-rc-trap-", markers);
    const bin = codexDir("harry-rc-bin-", markers);
    const env = { PATH: `:bin:${bin}` };
    const res = await spawnCodex(["exec", "-"], { cwd: trap, input: "", logFd: 2, env });
    assert.equal(res.status, 0, String(res.error));
    assert.deepEqual(readdirSync(markers), [`ran-${path.basename(bin)}`]);
  },
);

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

test("resolveCodex on Windows skips a PATHEXT hit it cannot spawn and keeps searching", () => {
  const env = { PATH: "C:\\first;C:\\second", PATHEXT: ".JS;.VBS;.PS1;.WSF;.EXE;.CMD" };
  for (const ext of ["js", "vbs", "ps1", "wsf"]) {
    const exists = fakeFs(`C:\\first\\codex.${ext}`, "C:\\second\\codex.exe");
    assert.equal(resolveCodex(env, "win32", exists), "C:\\second\\codex.EXE", ext);
    assert.deepEqual(codexSpawn(ARGS, "win32", env, exists), {
      command: "C:\\second\\codex.EXE",
      args: ARGS,
      shell: false,
    });
  }
  // Only unspawnable hits: no codex at all, never a script handed to the OS.
  const onlyScripts = fakeFs("C:\\first\\codex.js", "C:\\second\\codex.ps1");
  assert.equal(resolveCodex(env, "win32", onlyScripts), null);
  assert.equal(codexSpawn(ARGS, "win32", env, onlyScripts), null);
});

test("resolveCodex on Windows spawns .com/.exe directly and keeps the .cmd/.bat shim path", () => {
  const env = { PATH: "C:\\bin", PATHEXT: ".JS;.COM;.BAT" };
  const com = fakeFs("C:\\bin\\codex.js", "C:\\bin\\codex.com");
  assert.deepEqual(codexSpawn(ARGS, "win32", env, com), {
    command: "C:\\bin\\codex.COM",
    args: ARGS,
    shell: false,
  });
  const bat = fakeFs("C:\\bin\\codex.js", "C:\\bin\\codex.bat");
  const spec = codexSpawn(ARGS, "win32", env, bat);
  assert.ok(spec);
  assert.equal(spec.shell, true);
  assert.equal(cmdParse(splitCommand(spec.command)[0]), "C:\\bin\\codex.BAT");
});

test("codexSpawn on Windows with no codex on PATH plans no spawn", () => {
  const exists = fakeFs("C:\\bin\\codex.ps1", "C:\\elsewhere\\codex.exe");
  const env = { PATH: "C:\\bin;C:\\other", PATHEXT: ".EXE;.CMD" };
  assert.equal(resolveCodex(env, "win32", exists), null);
  assert.equal(codexSpawn(ARGS, "win32", env, exists), null);
  assert.equal(codexSpawn(ARGS, "win32", {}, exists), null);
});

test("resolveCodex on Windows never probes the current directory for an empty PATH entry", () => {
  // A cwd-relative `codex.exe` exists: an empty entry joined as-is would find it.
  const files = fakeFs("codex.exe", "C:\\bin\\codex.exe");
  const probed: string[] = [];
  const exists = (p: string): boolean => {
    probed.push(p);
    return files(p);
  };
  for (const PATH of [";C:\\bin", '  ;"";C:\\bin', ";;", ""]) {
    probed.length = 0;
    const got = resolveCodex({ PATH, PATHEXT: ".EXE" }, "win32", exists);
    assert.equal(got, PATH.includes("bin") ? "C:\\bin\\codex.EXE" : null, JSON.stringify(PATH));
    for (const p of probed) assert.ok(win32.isAbsolute(p), `probed a cwd-relative path: ${p}`);
  }
});

test("resolveCodex on Windows never probes a relative PATH entry", () => {
  // Each relative entry holds a `codex.exe` that a cwd-resolved spawn would run.
  const files = fakeFs(
    ".\\codex.exe",
    "bin\\codex.exe",
    "..\\up\\codex.exe",
    "C:bin\\codex.exe",
    "C:\\bin\\codex.exe",
  );
  const probed: string[] = [];
  const exists = (p: string): boolean => {
    probed.push(p);
    return files(p);
  };
  for (const PATH of [".;C:\\bin", "bin;C:\\bin", "..\\up;C:\\bin", "C:bin;C:\\bin", ".;bin"]) {
    probed.length = 0;
    const got = resolveCodex({ PATH, PATHEXT: ".EXE" }, "win32", exists);
    assert.equal(got, PATH.includes("C:\\bin") ? "C:\\bin\\codex.EXE" : null, JSON.stringify(PATH));
    for (const p of probed) assert.ok(win32.isAbsolute(p), `probed a cwd-relative path: ${p}`);
  }
});

test("spawnCodexSync reports a Windows PATH with no codex as a synthetic ENOENT, never spawning", () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(original);
  Object.defineProperty(process, "platform", { ...original, value: "win32" });
  try {
    assert.equal(process.platform, "win32", "the platform override did not take");
    const res = spawnCodexSync(["--version"], { env: { PATH: "", PATHEXT: ".EXE" } });
    assert.equal(res.pid, 0, "nothing may be spawned");
    assert.equal(res.status, null);
    assert.equal(res.signal, null);
    const error = res.error as NodeJS.ErrnoException;
    assert.equal(error.code, "ENOENT");
    assert.equal(error.syscall, "spawnSync codex");
    assert.equal(error.path, "codex");
    assert.equal(codexMissing(res), true);
  } finally {
    Object.defineProperty(process, "platform", original);
  }
});

test("spawnCodex reports a Windows PATH with no codex as a synthetic ENOENT, never spawning", async () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(original);
  Object.defineProperty(process, "platform", { ...original, value: "win32" });
  try {
    assert.equal(process.platform, "win32", "the platform override did not take");
    const env = { PATH: "", PATHEXT: ".EXE" };
    const res = await spawnCodex(["exec", "-"], { cwd: ".", input: "", logFd: 2, env });
    assert.equal(res.status, null);
    assert.equal(res.signal, null);
    const error = res.error as NodeJS.ErrnoException;
    assert.equal(error.code, "ENOENT");
    assert.equal(error.syscall, "spawn codex");
    assert.equal(error.path, "codex");
    assert.equal(codexMissing(res), true);
  } finally {
    Object.defineProperty(process, "platform", original);
  }
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

const TRUNCATED = "…[truncated]";

test("capLogLine keeps a line of up to 1000 bytes and cuts a longer one to 1000 with a marker", () => {
  assert.equal(capLogLine("ERROR: short"), "ERROR: short");
  const exact = "x".repeat(1000);
  assert.equal(capLogLine(exact), exact);
  const cut = capLogLine("x".repeat(1001));
  assert.equal(Buffer.byteLength(cut), 1000);
  assert.equal(cut, `${"x".repeat(1000 - Buffer.byteLength(TRUNCATED))}${TRUNCATED}`);
});

test("capLogLine never splits a multibyte code point", () => {
  // Pads 0..3 put a 4-byte code point across every possible cut offset.
  for (let pad = 0; pad < 4; pad++) {
    const line = `${"a".repeat(pad)}${"𝄞".repeat(400)}`;
    const cut = capLogLine(line);
    const bytes = Buffer.byteLength(cut);
    assert.ok(bytes <= 1000 && bytes > 1000 - 4, `pad ${pad}: ${bytes} bytes`);
    assert.ok(cut.endsWith(TRUNCATED));
    assert.ok(line.startsWith(cut.slice(0, -TRUNCATED.length)), `pad ${pad}: prefix changed`);
    assert.ok(!cut.includes("�"));
  }
});

// ─── narrowing the -o file after a run ──────────────────────────────────────

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const FAKE = path.join(REPO_ROOT, "tests/fake-codex-cli.mjs");

const cleanup: string[] = [];
test.after(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(d);
  return d;
}

/**
 * Run `runCodexExec` in a child node process against the fake codex CLI (or a
 * `codex` shell script `shim`), and report what it threw. A child, not this
 * process: runCodexExec writes its failure report to the real stderr.
 */
function runExec(
  outputPath: string,
  logPath: string,
  opts: { fake?: Record<string, string>; shim?: string } = {},
): { stderr: string; result: { ok?: true; name?: string; kind?: string; message?: string } } {
  const dir = tempDir("harry-rc-exec-");
  const bin = path.join(dir, "bin");
  const codex = path.join(bin, "codex");
  mkdirSync(bin);
  writeFileSync(
    codex,
    opts.shim === undefined
      ? `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`
      : `#!/bin/sh\n${opts.shim}\n`,
  );
  chmodSync(codex, 0o755);
  const driver = path.join(dir, "driver.mts");
  writeFileSync(
    driver,
    `import { runCodexExec } from ${JSON.stringify(path.join(REPO_ROOT, "src/lib/run-codex.ts"))};
const [outputPath, logPath] = process.argv.slice(2);
try {
  await runCodexExec({ args: ["exec", "-o", outputPath, "-"], cwd: process.cwd(), input: "p\\n",
    outputPath, logPath, label: "codex exec", outputNoun: "answer" });
  console.log(JSON.stringify({ ok: true }));
} catch (e) {
  console.log(JSON.stringify({ name: e.name, kind: e.kind, message: e.message }));
}
`,
  );
  const res = spawnSync(process.execPath, [driver, outputPath, logPath], {
    cwd: dir,
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, ...opts.fake },
  });
  assert.equal(res.status, 0, res.stderr);
  return { stderr: res.stderr, result: JSON.parse(res.stdout) };
}

/** An output path whose parent is a regular file: chmod on it fails ENOTDIR, never ENOENT. */
function unnarrowablePaths(): { outputPath: string; logPath: string } {
  const dir = tempDir("harry-rc-narrow-");
  writeFileSync(path.join(dir, "blocker"), "");
  return { outputPath: path.join(dir, "blocker", "out.md"), logPath: path.join(dir, "run.log") };
}

test(
  "a failed run whose output cannot be narrowed still reports codex's cause and log first",
  POSIX_SHIM,
  () => {
    const { outputPath, logPath } = unnarrowablePaths();
    const { stderr, result } = runExec(outputPath, logPath, {
      fake: {
        FAKE_CODEX_CLI_EXIT: "3",
        FAKE_CODEX_CLI_OUTPUT: "skip",
        FAKE_CODEX_CLI_STDERR: "ERROR: upstream said no\n",
      },
    });
    assert.equal(result.kind, "exit", JSON.stringify(result));
    assert.equal(result.message, "codex exec failed (exit 3).");
    const report = `ERROR: upstream said no\nLog: ${logPath}\n`;
    assert.ok(stderr.startsWith(report), stderr);
    // The narrow failure is reported too, after the cause — never instead of it.
    assert.match(
      stderr.slice(report.length),
      /^Could not narrow .*out\.md to owner-only.*ENOTDIR/m,
    );
  },
);

test(
  "an empty-output run whose output cannot be narrowed reports the empty failure and log first",
  POSIX_SHIM,
  () => {
    const { outputPath, logPath } = unnarrowablePaths();
    const { stderr, result } = runExec(outputPath, logPath, {
      fake: { FAKE_CODEX_CLI_OUTPUT: "skip" },
    });
    assert.equal(result.kind, "empty", JSON.stringify(result));
    const report = `${NO_ERROR_LINE}\nLog: ${logPath}\n`;
    assert.ok(stderr.startsWith(report), stderr);
    assert.match(stderr.slice(report.length), /^Could not narrow .*ENOTDIR/m);
  },
);

test("a successful run whose output cannot be narrowed still fails loudly", {
  skip: process.platform !== "darwin" && "needs chflags to make chmod fail for the owner",
}, () => {
  const dir = tempDir("harry-rc-uchg-");
  const outputPath = path.join(dir, "out.md");
  const logPath = path.join(dir, "run.log");
  // Writes the answer, then makes it immutable: the owner's chmod fails EPERM.
  const shim = [
    'while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done',
    "cat >/dev/null",
    'echo "the answer" > "$out"',
    'chflags uchg "$out"',
  ].join("\n");
  try {
    const { result } = runExec(outputPath, logPath, { shim });
    assert.equal(result.ok, undefined, "a run whose output stays world-readable must not succeed");
    assert.match(result.message ?? "", /EPERM/);
  } finally {
    spawnSync("chflags", ["nouchg", outputPath]);
  }
  assert.equal(readFileSync(outputPath, "utf8"), "the answer\n");
});

// ─── a killed companion takes codex with it ─────────────────────────────────

const CLI = path.join(REPO_ROOT, "src/companion.ts");

/** Poll `cond` every 20ms until it holds, failing with `what` after `ms`. */
async function waitFor(cond: () => boolean, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** A repo on `main` with one commit and a dirty working tree, so review has a target. */
function dirtyRepo(): string {
  const repo = tempDir("harry-rc-kill-repo-");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git(
    "-c",
    "user.email=t@example.com",
    "-c",
    "user.name=t",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "base",
  );
  writeFileSync(path.join(repo, "a.txt"), "dirty\n");
  return repo;
}

for (const [command, signal] of [
  ["ask", "SIGTERM"],
  ["ask", "SIGINT"],
  ["ask", "SIGHUP"],
  ["review", "SIGTERM"],
] as const) {
  test(`a companion ${command} killed by ${signal} takes its running codex with it`, {
    skip: process.platform === "win32" && "POSIX signals",
  }, async () => {
    const dir = tempDir("harry-rc-kill-");
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const pidFile = path.join(dir, "codex.pid");
    // `exec`: the long-running process keeps the shim's pid, so the pid file names it.
    writeFileSync(path.join(bin, "codex"), `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`);
    chmodSync(path.join(bin, "codex"), 0o755);
    const cwd = command === "review" ? dirtyRepo() : dir;
    const companion = spawn(
      process.execPath,
      [CLI, command, ...(command === "ask" ? ["hi"] : [])],
      {
        cwd,
        stdio: "ignore",
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          CLAUDE_PLUGIN_DATA: path.join(dir, "data"),
        },
      },
    );
    const exited = new Promise<NodeJS.Signals | null>((resolve) =>
      companion.on("exit", (_code, sig) => resolve(sig)),
    );
    let codexPid: number | undefined;
    try {
      await waitFor(() => {
        try {
          codexPid = Number(readFileSync(pidFile, "utf8").trim()) || undefined;
        } catch {
          codexPid = undefined;
        }
        return codexPid !== undefined;
      }, "codex to start");
      assert.ok(codexPid !== undefined && alive(codexPid), "codex is running");
      companion.kill(signal);
      // The companion still dies by the signal, as it did before forwarding it.
      assert.equal(await exited, signal);
      const pid = codexPid;
      await waitFor(
        () => !alive(pid),
        `codex (pid ${pid}) to exit after the companion's ${signal}`,
      );
    } finally {
      companion.kill("SIGKILL");
      if (codexPid !== undefined && alive(codexPid)) process.kill(codexPid, "SIGKILL");
    }
  });
}

test("the companion never forwards SIGHUP on Windows, where ChildProcess.kill cannot send it", () => {
  assert.deepEqual(forwardedSignals("win32"), ["SIGTERM", "SIGINT"]);
  for (const platform of ["darwin", "linux"] as const) {
    assert.deepEqual(forwardedSignals(platform), ["SIGTERM", "SIGINT", "SIGHUP"]);
  }
});

test("a signal whose forward to codex throws still re-raises on the companion", {
  skip: process.platform === "win32" && "POSIX signals",
}, async () => {
  // Windows' ChildProcess.kill throws (ENOSYS) for a signal it cannot deliver. Stand
  // that in on every platform: a throw inside the forward must neither surface as an
  // uncaught exception nor skip the re-raise the companion dies by.
  const dir = tempDir("harry-rc-killthrow-");
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  const pidFile = path.join(dir, "codex.pid");
  writeFileSync(path.join(bin, "codex"), `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`);
  chmodSync(path.join(bin, "codex"), 0o755);
  const runCodex = path.join(REPO_ROOT, "src/lib/run-codex.ts");
  const script = `
    import { ChildProcess } from "node:child_process";
    import { readFileSync } from "node:fs";
    import { spawnCodex } from ${JSON.stringify(runCodex)};
    ChildProcess.prototype.kill = function () {
      throw Object.assign(new Error("kill ENOSYS"), { code: "ENOSYS" });
    };
    spawnCodex(["exec", "-"], { cwd: ${JSON.stringify(dir)}, input: "", logFd: 2, env: { PATH: ${JSON.stringify(`${bin}${path.delimiter}${process.env.PATH ?? ""}`)} } });
    const poll = setInterval(() => {
      let pid = "";
      try {
        pid = readFileSync(${JSON.stringify(pidFile)}, "utf8").trim();
      } catch {}
      if (!pid) return;
      clearInterval(poll);
      process.kill(process.pid, "SIGTERM");
    }, 20);
  `;
  const companion = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  companion.stderr.on("data", (d) => {
    stderr += d;
  });
  const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
    // `exit`, not `close`: the orphaned codex still holds the inherited stderr pipe.
    companion.on("exit", (code, sig) => resolve([code, sig])),
  );
  try {
    const [code, signal] = await exited;
    assert.deepEqual({ code, signal }, { code: null, signal: "SIGTERM" }, stderr);
  } finally {
    companion.kill("SIGKILL");
    try {
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    } catch {
      // codex never started: nothing to clean up.
    }
  }
});

test("winSpawnMode is the one mapping from a Windows extension to how it is spawned", () => {
  // Both the resolver's PATHEXT filter (bare `.EXE`) and codexSpawn (a resolved
  // path) read it, so a mode added or dropped here moves both at once.
  for (const [file, mode] of [
    [".EXE", "direct"],
    [".com", "direct"],
    [".CMD", "cmd"],
    [".bat", "cmd"],
    [".ps1", null],
    [".JS", null],
    ["C:\\bin\\codex.exe", "direct"],
    ["C:\\bin\\codex.CMD", "cmd"],
    ["C:\\bin\\codex.vbs", null],
  ] as const)
    assert.equal(winSpawnMode(file), mode, file);
  assert.equal(
    codexSpawn(["exec"], "win32", { PATH: "C:\\bin", PATHEXT: ".CMD" }, () => true)?.shell,
    true,
  );
  assert.equal(
    codexSpawn(["exec"], "win32", { PATH: "C:\\bin", PATHEXT: ".EXE" }, () => true)?.shell,
    false,
  );
});
