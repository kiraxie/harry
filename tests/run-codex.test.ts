/**
 * How the companion spawns `codex`: resolved against absolute PATH entries to
 * an absolute path, against real temp dirs, so a `codex` in the cwd is never
 * reachable; then the run itself — failure reporting, output narrowing, and
 * signal forwarding — driven through a fake `codex` script.
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
import path from "node:path";
import test from "node:test";

import { resolveOnPath } from "../src/lib/path-search.ts";
import {
  capLogLine,
  codexMissing,
  NO_ERROR_LINE,
  spawnCodex,
  spawnCodexSync,
} from "../src/lib/run-codex.ts";

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

test("resolveOnPath resolves codex to an absolute path on PATH, skipping a missing dir", () => {
  const bin = codexDir("harry-rc-bin-", tempDir("harry-rc-markers-"));
  const env = { PATH: `/nonexistent-harry-dir:${bin}` };
  assert.equal(resolveOnPath("codex", env), path.join(bin, "codex"));
});

test("resolveOnPath skips a non-executable codex for a later executable one", () => {
  const markers = tempDir("harry-rc-markers-");
  const first = codexDir("harry-rc-noexec-", markers, 0o644);
  const second = codexDir("harry-rc-bin-", markers);
  // A directory named `codex` is not a hit either, even with its x bits set.
  const dirNamedCodex = tempDir("harry-rc-dircodex-");
  mkdirSync(path.join(dirNamedCodex, "codex"), { mode: 0o755 });
  const env = { PATH: [first, dirNamedCodex, second].join(":") };
  assert.equal(resolveOnPath("codex", env), path.join(second, "codex"));
});

// An empty PATH entry (`:x`, `x:`, `a::b`) or a relative one (`.`, `bin`) means
// "relative to the cwd" to execvp, and `review` runs codex with cwd = the
// repository under review — so a repo shipping `./codex` would run its own code.
for (const [label, entry] of [
  ["an empty", ""],
  ["a relative `.`", "."],
  ["a relative `./`", "./"],
] as const) {
  test(`spawnCodexSync never runs a cwd \`codex\` reached through ${label} PATH entry`, () => {
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
  });
}

test("spawnCodex never runs a cwd `codex` through an empty PATH entry, and runs the PATH one", async () => {
  const markers = tempDir("harry-rc-markers-");
  const trap = codexDir("harry-rc-trap-", markers);
  const bin = codexDir("harry-rc-bin-", markers);
  const env = { PATH: `:bin:${bin}` };
  const res = await spawnCodex(["exec", "-"], { cwd: trap, input: "", logFd: 2, env });
  assert.equal(res.status, 0, String(res.error));
  assert.deepEqual(readdirSync(markers), [`ran-${path.basename(bin)}`]);
});

test("codexMissing: only ENOENT — a non-zero exit is a real failure, not a missing CLI", () => {
  const enoent = { error: Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }) };
  assert.equal(codexMissing({ ...enoent, status: null }), true);
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

test("a failed run whose output cannot be narrowed still reports codex's cause and log first", () => {
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
  assert.match(stderr.slice(report.length), /^Could not narrow .*out\.md to owner-only.*ENOTDIR/m);
});

test("an empty-output run whose output cannot be narrowed reports the empty failure and log first", () => {
  const { outputPath, logPath } = unnarrowablePaths();
  const { stderr, result } = runExec(outputPath, logPath, {
    fake: { FAKE_CODEX_CLI_OUTPUT: "skip" },
  });
  assert.equal(result.kind, "empty", JSON.stringify(result));
  const report = `${NO_ERROR_LINE}\nLog: ${logPath}\n`;
  assert.ok(stderr.startsWith(report), stderr);
  assert.match(stderr.slice(report.length), /^Could not narrow .*ENOTDIR/m);
});

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
  test(`a companion ${command} killed by ${signal} takes its running codex with it`, async () => {
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

test("a signal whose forward to codex throws still re-raises on the companion", async () => {
  // Stand in a ChildProcess.kill that throws: a throw inside the forward must neither
  // surface as an uncaught exception nor skip the re-raise the companion dies by.
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
