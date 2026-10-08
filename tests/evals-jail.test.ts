// The opt-in seatbelt jail (scripts/lib/evals-jail.mts) on its own: the generated
// profile as fixed text, how the paths it is built from are resolved, the jailed
// PATH, and what a process under the real sandbox-exec can and cannot do. How the
// runner uses the jail end to end stays in run-evals.test.ts.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildSeatbeltProfile,
  requireSandboxSupport,
  trialJail,
  wrapWithSandbox,
} from "../scripts/lib/evals-jail.mts";

function tmpDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// The running node's dir: first on every child's PATH (see buildBaseEnv).
const NODE_DIR = path.dirname(process.execPath);

const DARWIN_ONLY = { skip: process.platform !== "darwin" ? "macOS-only (seatbelt)" : false };

const SANDBOX = { sandboxExec: "/usr/bin/sandbox-exec" };

// The two goldens evals/README.md names as the jail's full allowlist. Each title is
// written once, here: it names its test and is what the README pin checks.
const GOLDEN_PROFILE = "buildSeatbeltProfile: the whole profile is exactly this text (golden)";
const GOLDEN_PATHS =
  "trialJail hands the profile builder each path once, by its canonical spelling (golden)";

// A trial's jail, built through trialJail as the runner builds one. `dir` stands in
// for each of the trial's three writable dirs that is not named.
function jailOf({
  dir,
  home = os.homedir(),
  configDir = dir,
  fixtureDir = dir,
  tmpDir = dir,
  bin = process.execPath,
  gitBin,
  gitExecPath,
  env = { PATH: "/usr/bin:/bin" },
}: {
  dir: string;
  home?: string;
  configDir?: string;
  fixtureDir?: string;
  tmpDir?: string;
  bin?: string;
  gitBin?: string;
  gitExecPath?: string;
  env?: Record<string, string | undefined>;
}) {
  const jail = trialJail(SANDBOX, {
    home,
    configDir,
    fixtureDir,
    tmpDir,
    bin,
    gitBin,
    gitExecPath,
    env,
  });
  assert.ok(jail, "a sandbox context yields a jail");
  return jail;
}

function readFileSafe(p: string): string {
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

// The whole profile, pinned as fixed text for fixed inputs: any rule added,
// removed, widened or reordered is an edit here that review sees, not only a
// change to the names or paths some narrower check extracts. SBPL is
// last-match-wins, so the order is policy too: `(deny default)` first, the broad
// read allow, then the $HOME deny, the narrow allows, and the terminal deny LAST so
// no read allow (of /dev, say) can re-open it. Literal on purpose: never build the
// expectation from the code's own constants.
test(GOLDEN_PROFILE, () => {
  const profile = buildSeatbeltProfile({
    home: "/Users/op",
    // Deduped, in order of first appearance.
    allowWrite: [
      "/private/var/folders/t/trial/config",
      "/private/var/folders/t/trial/fixture/repo",
      "/private/var/folders/t/trial/tmp",
      "/private/var/folders/t/trial/tmp",
    ],
    // An empty path is dropped, never emitted as a (subpath "").
    allowRead: [
      "/Users/op/.local/share/claude/versions",
      "/opt/homebrew/Cellar/node/26.9.0/bin",
      "",
      "/Users/op/Projects/harry/scripts/run-evals.mts",
    ],
    // /usr/bin, the xcrun git shim's tree, is already allowed and is not repeated.
    allowExec: [
      "/Users/op/.local/share/claude/versions",
      "/opt/homebrew/Cellar/node/26.9.0/bin",
      "/usr/bin",
    ],
  });
  assert.equal(
    profile,
    `(version 1)
;; harry evals seatbelt profile (opt-in EVALS_SANDBOX=1, agentic sessions).
;; Deny everything, then allow back only what node, claude and git need:
;; no mach-lookup service can start a program outside this jail (launchd's
;; bootstrap port is a separate, narrower exception; see the DEBT note).
(deny default)
(allow process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read*)
(deny file-read* (subpath "/Users/op"))
(allow file-read* file-write* (literal "/dev/null"))
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
)
(allow network-outbound (remote ip "*:*"))
(allow network-outbound (literal "/private/var/run/mDNSResponder"))
(allow process-exec
  (subpath "/bin")
  (subpath "/usr/bin")
  (subpath "/Users/op/.local/share/claude/versions")
  (subpath "/opt/homebrew/Cellar/node/26.9.0/bin")
)
;; read+write: this trial's config dir, fixture repo and temp dir only.
(allow file-read* file-write*
  (subpath "/private/var/folders/t/trial/config")
  (subpath "/private/var/folders/t/trial/fixture/repo")
  (subpath "/private/var/folders/t/trial/tmp")
)
;; read-only: the runtime install trees and the runner's own files.
(allow file-read*
  (subpath "/Users/op/.local/share/claude/versions")
  (subpath "/opt/homebrew/Cellar/node/26.9.0/bin")
  (subpath "/Users/op/Projects/harry/scripts/run-evals.mts")
)
;; no terminal reads (what the operator types); last, so no allow above re-opens it.
(deny file-read* (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))
`,
  );
});

test("buildSeatbeltProfile: with no trial dirs or runtime trees, those sections are left out (golden)", () => {
  assert.equal(
    buildSeatbeltProfile({ home: "/Users/op" }),
    `(version 1)
;; harry evals seatbelt profile (opt-in EVALS_SANDBOX=1, agentic sessions).
;; Deny everything, then allow back only what node, claude and git need:
;; no mach-lookup service can start a program outside this jail (launchd's
;; bootstrap port is a separate, narrower exception; see the DEBT note).
(deny default)
(allow process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read*)
(deny file-read* (subpath "/Users/op"))
(allow file-read* file-write* (literal "/dev/null"))
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
)
(allow network-outbound (remote ip "*:*"))
(allow network-outbound (literal "/private/var/run/mDNSResponder"))
(allow process-exec
  (subpath "/bin")
  (subpath "/usr/bin")
)
;; no terminal reads (what the operator types); last, so no allow above re-opens it.
(deny file-read* (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))
`,
  );
});

test("buildSeatbeltProfile: escapes quotes/backslashes so a path can't break the literal", () => {
  const profile = buildSeatbeltProfile({ home: '/Users/o"p\\x', allowWrite: [], allowRead: [] });
  assert.match(profile, /\(subpath "\/Users\/o\\"p\\\\x"\)/, "quote and backslash are escaped");
});

test(
  "buildSeatbeltProfile jails $HOME under REAL sandbox-exec: canary denied, exception overrides",
  DARWIN_ONLY,
  () => {
    // Self-contained: point the profile's `home` at a throwaway dir standing in for
    // $HOME (realpath'd — seatbelt matches the kernel-canonical path and macOS
    // symlinks /var → /private/var; the real homedir() is already canonical). A
    // canary sits directly under it; an exception subdir sits INSIDE it. Prove
    // sandbox-exec denies the canary yet allows the exception (last-match-wins allow
    // overriding the broad $HOME deny) — the exact policy the real run applies.
    const jail = realpathSync(tmpDir("harry-sb-jail-"));
    try {
      const exception = path.join(jail, "fixture");
      mkdirSync(exception);
      const canary = path.join(jail, "secret.txt");
      writeFileSync(canary, "SECRET\n");
      const okFile = path.join(exception, "ok.txt");
      writeFileSync(okFile, "OK\n");
      const profile = buildSeatbeltProfile({ home: jail, allowWrite: [exception], allowRead: [] });

      const catUnder = (file: string): boolean => {
        try {
          execFileSync("sandbox-exec", ["-p", profile, "cat", file], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          });
          return true;
        } catch {
          return false;
        }
      };
      assert.equal(catUnder(canary), false, "a canary directly under the jailed $HOME is denied");
      assert.equal(catUnder(okFile), true, "the exception subdir allow overrides the $HOME deny");
      // Writes: denied everywhere but the allowed dirs, OUTSIDE $HOME too (a
      // user-writable PATH dir such as /opt/homebrew/bin is outside $HOME).
      const outside = realpathSync(tmpDir("harry-sb-outside-"));
      try {
        const touchUnder = (file: string): boolean => {
          try {
            execFileSync("sandbox-exec", ["-p", profile, "touch", file], { stdio: "ignore" });
            return true;
          } catch {
            return false;
          }
        };
        assert.equal(
          touchUnder(path.join(outside, "planted")),
          false,
          "write outside $HOME denied",
        );
        assert.equal(
          touchUnder(path.join(exception, "made")),
          true,
          "write to an allowed dir works",
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    } finally {
      rmSync(jail, { recursive: true, force: true });
    }
  },
);

test("wrapWithSandbox: wraps `bin args...` as `sandbox-exec -p <profile> bin args...`", () => {
  const wrapped = wrapWithSandbox("/usr/bin/sandbox-exec", "PROFILE", "claude", [
    "-p",
    "hi",
    "--model",
    "m",
  ]);
  assert.equal(wrapped.bin, "/usr/bin/sandbox-exec", "sandbox-exec becomes the executed binary");
  assert.deepEqual(
    wrapped.args,
    ["-p", "PROFILE", "claude", "-p", "hi", "--model", "m"],
    "the profile is passed via -p, then the original bin and its args unchanged",
  );
});

test("trialJail: a symlinked $HOME is canonicalized (I-1: jails the real path)", () => {
  // I-1 regression lock: seatbelt matches the kernel-canonical path. If the jail
  // root is left un-normalized, a symlinked $HOME's deny rule silently fails to
  // match — $HOME is un-jailed with no error while the run reports "sandboxed".
  // trialJail must realpath the root so the deny lands on the REAL path (and thus
  // holds through the symlink).
  const real = realpathSync(tmpDir("harry-sb-realhome-"));
  const linkParent = tmpDir("harry-sb-link-");
  const link = path.join(linkParent, "homelink");
  try {
    symlinkSync(real, link);
    const { profile } = jailOf({ home: link, dir: realpathSync(linkParent) });
    assert.ok(
      profile.includes(`(deny file-read* (subpath "${real}"))`),
      "the deny root is the canonical (realpath) home, not the symlink",
    );
    assert.ok(
      !profile.includes(`(subpath "${link}")`),
      "the un-normalized symlink path never appears (it would silently fail to match)",
    );

    if (process.platform === "darwin") {
      // The deny holds THROUGH the symlink: a canary opened via the symlinked home
      // path canonicalizes to the jailed real path and is denied by the kernel.
      writeFileSync(path.join(real, "secret.txt"), "SECRET\n");
      let denied = false;
      try {
        execFileSync("sandbox-exec", ["-p", profile, "cat", path.join(link, "secret.txt")], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        denied = true;
      }
      assert.ok(denied, "reading the canary through the symlinked home path is denied");
    }
  } finally {
    rmSync(link, { force: true });
    rmSync(linkParent, { recursive: true, force: true });
    rmSync(real, { recursive: true, force: true });
  }
});

test("trialJail refuses a runtime tree that would re-open $HOME or cover a writable dir", () => {
  // Trees are readable and executable, and come after the $HOME deny (last match
  // wins): a tree at /, at $HOME or above it re-opens every read under $HOME, and
  // one overlapping a trial dir would let a session run what it writes. A tree is
  // the dir of a binary the jail runs, or git's exec path.
  const root = realpathSync(tmpDir("harry-sb-trees-"));
  try {
    const home = path.join(root, "users", "me");
    const trial = path.join(root, "trial");
    const other = path.join(root, "other");
    const tool = path.join(root, "tool");
    for (const d of [home, path.join(trial, "fixture"), other, tool]) {
      mkdirSync(d, { recursive: true });
    }
    const claudeIn = (dir: string) => {
      const bin = path.join(dir, "claude");
      writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
      return bin;
    };
    const build =
      (o: { bin?: string; gitExecPath?: string; configDir?: string; fixtureDir?: string }) => () =>
        jailOf({ home, dir: other, ...o }).profile;
    const refuses = (label: string, run: () => string, tree: string) =>
      assert.throws(run, (err: Error) => err.message.includes(`runtime tree ${tree}`), label);
    refuses("git reporting / as its exec path", build({ gitExecPath: "/" }), "/");
    refuses("$HOME itself", build({ bin: claudeIn(home) }), home);
    refuses(
      "an ancestor of $HOME",
      build({ bin: claudeIn(path.join(root, "users")) }),
      path.join(root, "users"),
    );
    refuses(
      "a tree containing a writable dir",
      build({ bin: claudeIn(trial), fixtureDir: path.join(trial, "fixture") }),
      trial,
    );
    refuses(
      "a tree inside a writable dir",
      build({ bin: claudeIn(path.join(trial, "fixture")), configDir: trial }),
      path.join(trial, "fixture"),
    );
    // The ordinary shape still builds: disjoint trees and trial dirs.
    assert.match(
      build({ bin: claudeIn(tool), fixtureDir: path.join(trial, "fixture") })(),
      /\(subpath "[^"]*\/tool"\)/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trialJail's PATH keeps an entry by where it resolves, not how it is spelled, in PATH order", () => {
  const root = realpathSync(tmpDir("harry-jailedpath-"));
  try {
    const allowed = path.join(root, "allowed");
    const outside = path.join(root, "outside");
    const sibling = `${allowed}2`; // shares the prefix, not the dir
    const trial = path.join(root, "trial");
    for (const d of [allowed, outside, sibling, trial]) mkdirSync(d);
    const bin = path.join(allowed, "claude");
    writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    const toAllowed = path.join(root, "to-allowed");
    const toOutside = path.join(root, "to-outside");
    symlinkSync(allowed, toAllowed);
    symlinkSync(outside, toOutside);
    const PATH = [toOutside, path.join(root, "missing"), toAllowed, sibling, outside, allowed].join(
      path.delimiter,
    );
    assert.deepEqual(jailOf({ dir: trial, bin, env: { PATH } }).path.split(path.delimiter), [
      NODE_DIR,
      toAllowed,
      allowed,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trialJail: git's exec path is canonicalized, so a symlinked prefix still lets git's helpers run", () => {
  // Homebrew's git reports its exec path through the `opt` symlink
  // (/opt/homebrew/opt/git/libexec/git-core -> Cellar/git/<v>/...). Seatbelt matches
  // the kernel-canonical path, so an exec-path rule spelled through that symlink never
  // matches: git's helpers, and its own bin reached through a PATH launcher that is
  // not git itself, stay unexecutable. Same shape here: a launcher that is not the
  // real git reports an exec path through a symlinked prefix.
  const root = realpathSync(tmpDir("harry-sb-gitprefix-"));
  try {
    const keg = path.join(root, "Cellar", "git", "9.9.9");
    const libexec = path.join(keg, "libexec", "git-core");
    const kegBin = path.join(keg, "bin");
    const launcherDir = path.join(root, "bin");
    const trial = path.join(root, "trial");
    for (const d of [libexec, kegBin, launcherDir, path.join(root, "opt"), trial]) {
      mkdirSync(d, { recursive: true });
    }
    const optGit = path.join(root, "opt", "git");
    symlinkSync(keg, optGit);
    const probe = '#!/bin/sh\necho "$0 ran"\n';
    writeFileSync(path.join(libexec, "git-probe"), probe, { mode: 0o755 });
    writeFileSync(path.join(kegBin, "git"), probe, { mode: 0o755 });
    const launcher = path.join(launcherDir, "git");
    writeFileSync(launcher, probe, { mode: 0o755 });
    const { profile } = jailOf({
      dir: trial,
      gitBin: launcher,
      gitExecPath: path.join(optGit, "libexec", "git-core"),
    });
    const exec = profile.slice(profile.indexOf("(allow process-exec"));
    const execRules = exec.slice(0, exec.indexOf("\n)"));
    for (const dir of [libexec, kegBin]) {
      assert.ok(execRules.includes(`(subpath "${dir}")`), `exec allows the canonical ${dir}`);
    }
    assert.ok(
      !profile.includes(`(subpath "${optGit}`),
      "no rule is spelled through the symlinked prefix (it would silently fail to match)",
    );

    if (process.platform === "darwin") {
      // Reached through the symlinked prefix, both run under the real jail.
      for (const target of [
        path.join(optGit, "libexec", "git-core", "git-probe"),
        path.join(optGit, "bin", "git"),
      ]) {
        const r = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, target], {
          encoding: "utf8",
        });
        assert.equal(r.status, 0, `jailed exec of ${target}: ${r.stderr}`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "trialJail under REAL sandbox-exec: a jailed process cannot read the terminal it runs in",
  DARWIN_ONLY,
  () => {
    // A real pty: script(1) runs the command with a fresh pty slave as its
    // controlling terminal and copies its own stdin into it, standing in for the
    // operator typing during a run. script's stdin must be one tcgetattr fails on
    // with ENOTTY (a file); node's own stdio pipes are sockets, which script rejects.
    const dir = realpathSync(tmpDir("harry-sb-tty-"));
    try {
      const { profile } = jailOf({ dir });
      const typed = path.join(dir, "typed.txt");
      writeFileSync(typed, "typed-secret\n");
      const result = path.join(dir, "result.json");
      // Opens the controlling tty by both names, records each outcome, then reads
      // what was typed from the first one that opened.
      const reader = [
        'const fs = require("node:fs");',
        "const dir = process.argv[1];",
        "const r = { open: {}, read: null };",
        "const fds = [];",
        'for (const p of ["/dev/tty", fs.readFileSync(dir + "/ttyname", "utf8").trim()]) {',
        '  try { fds.push(fs.openSync(p, "r")); r.open[p] = "ok"; } catch (e) { r.open[p] = e.code; }',
        "}",
        'const save = () => fs.writeFileSync(dir + "/result.json", JSON.stringify(r));',
        "save();",
        "if (fds.length) {",
        '  let text = ""; const b = Buffer.alloc(256);',
        '  for (let i = 0; i < 5 && !text.includes("typed-secret"); i++)',
        "    text += b.subarray(0, fs.readSync(fds[0], b)).toString();",
        "  r.read = text; save();",
        "}",
      ].join("\n");
      const inner =
        '/usr/bin/tty > "$1/ttyname"; ' +
        'if [ -n "$5" ]; then exec /usr/bin/sandbox-exec -p "$2" "$3" -e "$4" "$1"; fi; ' +
        'exec "$3" -e "$4" "$1"';
      const inPty = (jailed: boolean) => {
        rmSync(result, { force: true });
        const stdin = openSync(typed, "r");
        try {
          const shArgs = [dir, profile, process.execPath, reader, jailed ? "1" : ""];
          spawnSync(
            "/usr/bin/script",
            ["-q", "/dev/null", "/bin/sh", "-c", inner, "sh", ...shArgs],
            {
              stdio: [stdin, "ignore", "ignore"],
              timeout: 10_000,
              killSignal: "SIGKILL",
            },
          );
        } finally {
          closeSync(stdin);
        }
        return JSON.parse(readFileSafe(result) || "{}") as {
          open?: Record<string, string>;
          read?: string | null;
        };
      };
      const ttyOf = () => readFileSync(path.join(dir, "ttyname"), "utf8").trim();

      // Not vacuous: unjailed, the same process opens the terminal by both names and
      // reads what was typed into it.
      const free = inPty(false);
      assert.match(ttyOf(), /^\/dev\/ttys[0-9]+$/, "script gave the child a real pty slave");
      assert.deepEqual(free.open, { "/dev/tty": "ok", [ttyOf()]: "ok" }, "unjailed: both open");
      assert.match(String(free.read), /typed-secret/, "unjailed: the typed text is readable");

      const jailed = inPty(true);
      assert.deepEqual(
        jailed.open,
        { "/dev/tty": "EPERM", [ttyOf()]: "EPERM" },
        "jailed: the terminal cannot be opened for reading by either name",
      );
      assert.equal(jailed.read, null, "jailed: nothing typed was read");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("requireSandboxSupport: refuses non-macOS and a missing sandbox-exec; passes on both present", () => {
  assert.throws(
    () => requireSandboxSupport("linux", "/usr/bin/sandbox-exec"),
    /macOS-only/,
    "non-darwin is a hard refusal (never silently unsandboxed)",
  );
  assert.throws(
    () => requireSandboxSupport("freebsd", "/x"),
    /refusing to run an agentic session unsandboxed/,
    "any non-darwin platform is refused",
  );
  assert.throws(
    () => requireSandboxSupport("darwin", null),
    /sandbox-exec was not found/,
    "darwin without sandbox-exec is a hard refusal",
  );
  assert.equal(
    requireSandboxSupport("darwin", "/usr/bin/sandbox-exec"),
    "/usr/bin/sandbox-exec",
    "darwin + sandbox-exec present → the resolved path is returned",
  );
});

test(
  "trialJail's PATH under REAL sandbox-exec: an exec-denied PATH entry stops a name lookup; dropped, it cannot",
  DARWIN_ONLY,
  () => {
    // The premise the jailed PATH rests on: libuv's PATH walk gives up at EPERM
    // instead of trying the next entry, so one denied entry ahead of an allowed
    // `git` hides it.
    const stray = realpathSync(tmpDir("harry-evals-stray-"));
    const trial = realpathSync(tmpDir("harry-evals-trial-"));
    try {
      writeFileSync(path.join(stray, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const raw = [NODE_DIR, stray, "/usr/bin", "/bin"].join(path.delimiter);
      const { profile, path: jailed } = jailOf({
        dir: trial,
        gitBin: "/usr/bin/git",
        env: { PATH: raw },
      });
      const lookup = (PATH: string) =>
        spawnSync(
          "/usr/bin/sandbox-exec",
          [
            "-p",
            profile,
            process.execPath,
            "-e",
            'const r = require("node:child_process").spawnSync("git", ["--version"]); process.stdout.write(r.error ? r.error.code : "ran");',
          ],
          { env: { PATH, GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "utf8" },
        ).stdout;
      assert.equal(lookup(raw), "EPERM", "the denied entry ends the walk");
      assert.ok(!jailed.split(path.delimiter).includes(stray), jailed);
      assert.equal(lookup(jailed), "ran", "with it dropped, the lookup reaches /usr/bin/git");
    } finally {
      rmSync(stray, { recursive: true, force: true });
      rmSync(trial, { recursive: true, force: true });
    }
  },
);

// The paths of one rule block in a generated profile, in order: the `(subpath ...)`
// lines between the line that opens the block and its closing paren.
function blockPaths(profile: string, opener: string): string[] {
  const lines = profile.split("\n");
  const start = lines.indexOf(opener);
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^ {2}\(subpath "(.*)"\)$/);
    if (!m) break;
    out.push(m[1] as string);
  }
  return out;
}

test(GOLDEN_PATHS, () => {
  // Seatbelt matches the kernel-canonical path, so a rule spelled through a symlink
  // never matches. Every path below is handed in through a symlink; the profile
  // must carry only the real one, each once. node's own dirs depend on how node is
  // installed and are left out of the comparison.
  const root = realpathSync(tmpDir("harry-jail-paths-"));
  const real = path.join(root, "real");
  const link = path.join(root, "link");
  try {
    for (const d of [
      "home",
      "trial/config",
      "trial/fixture",
      "trial/tmp",
      "claude",
      "git/bin",
      "git/libexec/git-core",
      "runner/lib",
    ]) {
      mkdirSync(path.join(real, d), { recursive: true });
    }
    mkdirSync(link);
    for (const d of ["home", "trial", "claude", "git", "runner"]) {
      symlinkSync(path.join(real, d), path.join(link, d));
    }
    writeFileSync(path.join(real, "claude", "claude"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(path.join(real, "git", "bin", "git"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(path.join(real, "runner", "run-evals.mts"), "");

    const jail = trialJail(
      { sandboxExec: "/usr/bin/sandbox-exec" },
      {
        home: path.join(link, "home"),
        configDir: path.join(link, "trial", "config"),
        fixtureDir: path.join(link, "trial", "fixture"),
        tmpDir: path.join(link, "trial", "tmp"),
        bin: path.join(link, "claude", "claude"),
        gitBin: path.join(link, "git", "bin", "git"),
        gitExecPath: path.join(link, "git", "libexec", "git-core"),
        script: path.join(link, "runner", "run-evals.mts"),
        allowRead: [path.join(link, "runner", "lib")],
        env: { PATH: "/usr/bin:/bin" },
      },
    );
    assert.ok(jail, "a sandbox context yields a jail");
    const nodeDirs = new Set([
      realpathSync(NODE_DIR),
      path.dirname(realpathSync(process.execPath)),
    ]);
    const notNode = (paths: string[]) => paths.filter((p) => !nodeDirs.has(p));
    const r = (...parts: string[]) => path.join(real, ...parts);
    const trees = [r("claude"), r("git", "bin"), r("git", "libexec", "git-core")];

    assert.ok(
      jail.profile.includes(`(deny file-read* (subpath "${r("home")}"))`),
      "$HOME is denied by its real path",
    );
    assert.deepEqual(blockPaths(jail.profile, "(allow file-read* file-write*"), [
      r("trial", "config"),
      r("trial", "fixture"),
      r("trial", "tmp"),
    ]);
    assert.deepEqual(notNode(blockPaths(jail.profile, "(allow file-read*")), [
      ...trees,
      r("runner", "run-evals.mts"),
      r("runner", "lib"),
    ]);
    assert.deepEqual(notNode(blockPaths(jail.profile, "(allow process-exec")), [
      "/bin",
      "/usr/bin",
      ...trees,
    ]);
    assert.equal(
      jail.script,
      r("runner", "run-evals.mts"),
      "the post-session child runs the real script",
    );
    assert.equal(jail.tmpDir, r("trial", "tmp"), "the trial's temp dir is handed back real");
    assert.ok(!jail.profile.includes(link), "no rule is spelled through a symlink");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evals/README.md names the jail's full allowlist by the goldens' own titles", () => {
  const readme = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "evals", "README.md"),
    "utf8",
  ).replace(/\s+/g, " ");
  const quoted = Array.from(readme.matchAll(/\("([^"]* \(golden\))"\)/g), (m) => m[1]);
  assert.deepEqual(
    quoted.sort(),
    [GOLDEN_PROFILE, GOLDEN_PATHS].sort(),
    "the README quotes exactly the goldens this file defines",
  );
});
