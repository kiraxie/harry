// The opt-in macOS seatbelt jail for agentic eval sessions (EVALS_SANDBOX=1): the
// profile, the paths it is built from, the jailed PATH, and the refusal when the jail
// cannot be built. The runner (scripts/run-evals.mts) builds one per trial.

import { realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { buildBaseEnv, type Env, findOnPath } from "./evals-env.mts";

export interface Jail {
  sandboxExec: string;
  profile: string;
  tmpDir: string;
  path: string;
  script: string | null;
}

export interface JailInputs {
  home: string;
  configDir: string;
  fixtureDir: string;
  tmpDir: string;
  bin: string;
  gitBin?: string | null;
  gitExecPath?: string | null;
  env: Env;
  script?: string;
  allowRead?: string[];
}

interface PathEntry {
  entry: string;
  real: string | null;
}

// One trial's jail, shared by the session and by the post-session child that judges
// it (see sandboxContext for the refusal path). Every path is resolved once, by
// resolveJailPaths; the profile, the jailed PATH, the temp dir and the script that
// child runs all come from that one resolution.
export function trialJail(
  sandbox: { sandboxExec: string } | null,
  {
    home,
    configDir,
    fixtureDir,
    tmpDir,
    bin,
    gitBin,
    gitExecPath,
    env,
    script,
    allowRead = [],
  }: JailInputs,
): Jail | null {
  if (!sandbox) return null;
  const paths = resolveJailPaths({
    home,
    configDir,
    fixtureDir,
    tmpDir,
    script,
    allowRead,
    bin,
    gitBin,
    gitExecPath,
    env,
  });
  refuseUnsafeTrees(paths.trees, paths.home, paths.allowWrite);
  const profile = buildSeatbeltProfile({
    home: paths.home,
    allowWrite: paths.allowWrite,
    allowRead: [...paths.trees, ...(paths.script ? [paths.script] : []), ...paths.allowRead],
    allowExec: paths.trees,
  });
  return {
    sandboxExec: sandbox.sandboxExec,
    profile,
    tmpDir: paths.tmpDir,
    path: jailedPath(paths.pathEntries, paths.execDirs),
    script: paths.script,
  };
}

// ---- opt-in OS sandbox (macOS seatbelt) ------------------------------------

// The one place the jail's paths are canonicalized (realpath). Seatbelt matches the
// kernel-canonical path, so a rule spelled through a symlink silently FAILS to match:
//   - $HOME is resolved HARD: an un-normalized jail root that doesn't match un-jails
//     $HOME with NO error while the run still reports "sandboxed", so a failure
//     throws and the session never launches.
//   - the readable files (the runner script and its modules) are resolved hard too:
//     the post-session child cannot run without them.
//   - the writable dirs are best-effort: one that can't be resolved is dropped
//     (safe-fail: it just stays unwritable), so they match real kernel paths
//     (/var → /private/var).
//   - the runtime trees: for node, claude and git, both the launcher's dir and its
//     resolved target's dir (a launcher symlink and its real payload can live in
//     different trees, and the kernel reads both to exec), plus git's exec path
//     (<prefix>/libexec/git-core) and the <prefix>/bin beside it, which is what
//     /usr/bin/git (Apple's xcrun shim) execs. <prefix>/bin is derived from the
//     canonical exec path: Homebrew's git reports it through the `opt` symlink
//     (/opt/homebrew/opt/git/libexec/git-core -> Cellar/git/<v>/...). A path that
//     can't be resolved is skipped (the jail stays closed; a genuinely-needed
//     missing tree surfaces as a session failure, not a leak).
//   - the PATH entries, so jailedPath keeps an entry by where it resolves.
function resolveJailPaths({
  home,
  configDir,
  fixtureDir,
  tmpDir,
  script,
  allowRead,
  bin,
  gitBin,
  gitExecPath,
  env,
}: JailInputs & { allowRead: string[] }) {
  const canonical = (p: string): string | null => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };
  const trees = new Set<string>();
  const addTree = (p: string | null) => {
    const real = p ? canonical(p) : null;
    if (real) trees.add(real);
  };
  const addLauncher = (p: string | null | undefined) => {
    if (!p) return;
    addTree(dirname(p));
    const target = canonical(p);
    if (target) trees.add(dirname(target));
  };
  // node: the runtime that actually executes the session's `node` and claude's cli.
  addLauncher(process.execPath);
  // claude: runEvals hands in an absolute path; a bare name (a direct caller) is
  // looked up in-process, never by spawning `which`.
  addLauncher(bin ? findOnPath(bin, env) : null);
  addLauncher(gitBin);
  if (gitExecPath && isAbsolute(gitExecPath)) {
    const real = canonical(gitExecPath);
    if (real) {
      trees.add(real);
      trees.add(resolve(real, "..", "..", "bin"));
    }
  }
  const treeList = [...trees];
  const realTmpDir = canonical(tmpDir);
  return {
    home: realpathSync(home),
    allowWrite: [configDir, fixtureDir, tmpDir]
      .map(canonical)
      .filter((p): p is string => p !== null),
    tmpDir: realTmpDir ?? tmpDir,
    script: script ? realpathSync(script) : null,
    allowRead: allowRead.map((p) => realpathSync(p)),
    trees: treeList,
    execDirs: jailExecDirs(treeList),
    pathEntries: buildBaseEnv(env)
      .PATH.split(delimiter)
      .map((entry): PathEntry => ({ entry, real: canonical(entry) })),
  };
}

// Trees are readable and executable and come after the $HOME deny (last match
// wins), so a tree at /, at or above $HOME re-opens every read under $HOME, and one
// overlapping a writable dir lets a session run what it writes. Refuse either. All
// three inputs are canonical (resolveJailPaths).
function refuseUnsafeTrees(trees: string[], home: string, writes: string[]) {
  const within = (p: string, dir: string) => dir === "/" || p === dir || p.startsWith(`${dir}/`);
  for (const tree of trees) {
    const write = writes.find((w) => within(w, tree) || within(tree, w));
    const clash = within(home, tree)
      ? `covers $HOME (${home})`
      : write && `overlaps the writable ${write}`;
    if (clash) {
      throw new Error(
        `refusing to build the jail: runtime tree ${tree} ${clash}; it would be readable and executable`,
      );
    }
  }
}

// The system services (mach-lookup global names) a jailed process may reach, by
// exact name. Every other service is denied by `(deny default)`, and that is what
// keeps LaunchServices (`open`) and Apple Events (`osascript`) from starting or
// driving a program OUTSIDE the jail, as the operator: both reach their broker
// through a mach-lookup global name this deny closes. launchd is different:
// `launchctl` reaches it over the task's bootstrap port, not a mach-lookup name,
// so this allowlist does not gate it at all — launchd applies its own checks per
// subcommand instead (see the DEBT note on buildSeatbeltProfile for what those
// checks still let through). Derived
// empirically: the jailed post-session step (git, node --test), `claude --version`
// and an HTTPS fetch all run with none; user lookup is the one thing that fails
// without it (node's os.userInfo() throws), and it answers directory queries only.
// A live `claude` session was not run to derive this list (API spend); if one needs
// another service (evals/README.md says how to read the denied name from the unified
// log), add that one exact name after checking it cannot launch, drive or act for
// the caller as a program (keychain, preferences and login-item services can), never
// a prefix or a bare `(allow mach-lookup)`. A test pins the whole generated
// profile as fixed text, so the addition is also a visible test edit.
const JAIL_MACH_SERVICES = [
  "com.apple.system.opendirectoryd.libinfo", // getpwuid/getgrgid: user and group lookup
];

// Generate a seatbelt (sandbox_init) profile as a string. Pure and unit-testable:
// no IO, deterministic given its inputs. The policy is deny-by-default: the first
// rule is `(deny default)`, and the rules below allow back only what node, claude
// and git need. The rules are the code; a golden test pins the whole generated
// text (tests/evals-jail.test.ts), and evals/README.md says what they block.
//
// The terminal deny closes opening one by path only: a terminal fd already open
// reads freely, and a shell's terminal is one read-write file on fds 0, 1 and 2
// alike. So fds 0, 1 and 2 of every jailed child must not be the terminal: each
// spawn pipes or ignores all three (never "inherit"), and libuv passes no other fd.
// A pty test pins this from inside each spawned process: the claude session and the
// test command, jailed and not; the jailed post-session step; and the runner's own
// git calls wherever PATH can shadow git (the jailed git calls hold the
// post-session step's fds). The legacy BSD pty pairs (`/dev/ttyp0`, `/dev/ptyp0`,
// ...) are left readable: no shell runs on them.
//
// DEBT: four allowances stay broad. (1) Reads outside $HOME: the session can read
// anything there the operator's user can but a terminal, other trials' dirs
// included; (2) exec of everything in /bin, /usr/bin and the runtime trees' whole
// dirs (`open`, `launchctl` and `osascript` included) — safe for `open` and
// `osascript` because the mach-lookup services they'd need to act outside the
// jail are denied, but NOT for `launchctl`, see (4); (3) outbound IP to any host
// and port, localhost included, so a local TCP service that runs commands on
// request would act for the session; (4) `launchctl` reaches launchd over the
// task's bootstrap port, which this profile cannot deny, and launchd applies its
// own checks per subcommand: `submit`, `bootstrap`, `load`, `kill`, `bootout` and
// `setenv` are refused, but `kickstart gui/<uid>/<label>` starts an already-loaded
// job of the operator's outside the jail, and `disable gui/<uid>/<label>` writes a
// disabled entry to launchd's override store that persists across reboot.
// Ceiling: fine for a maintainer-run gate on trusted, repo-authored cases — not
// for untrusted input. Upgrade path for (4): run untrusted cases on an ephemeral
// machine (a CI runner or a VM) instead of the operator's own session, since that
// also moves the jailed process out of the operator's launchd domain, which is
// what actually closes it. Upgrade path for (1)-(3): a read allowlist (the
// runtime trees, system libraries, the trial dirs) in place of (1), exec of
// exactly the resolved binaries in place of (2), and a forwarder that gives the
// session one loopback port to the API in place of (3) (the same one the
// credential DEBT on buildChildEnv names).
//
// SBPL is last-match-wins: the broad rules come first, then the narrow ones
// override them for their paths.
export function buildSeatbeltProfile({
  home,
  allowWrite = [],
  allowRead = [],
  allowExec = [],
}: {
  home: string;
  allowWrite?: string[];
  allowRead?: string[];
  allowExec?: string[];
}): string {
  // Escape backslashes and quotes so a path with either can't break out of the
  // SBPL string literal (macOS paths rarely contain them, but never trust input).
  const esc = (p: string) => p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const subpaths = (paths: string[]) =>
    [...new Set(paths.filter((p) => typeof p === "string" && p))].map(
      (p) => `  (subpath "${esc(p)}")`,
    );
  const lines = [
    "(version 1)",
    ";; harry evals seatbelt profile (opt-in EVALS_SANDBOX=1, agentic sessions).",
    ";; Deny everything, then allow back only what node, claude and git need:",
    ";; no mach-lookup service can start a program outside this jail (launchd's",
    ";; bootstrap port is a separate, narrower exception; see the DEBT note).",
    "(deny default)",
    "(allow process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow file-read*)",
    `(deny file-read* (subpath "${esc(home)}"))`,
    '(allow file-read* file-write* (literal "/dev/null"))',
    "(allow mach-lookup",
    ...JAIL_MACH_SERVICES.map((name) => `  (global-name "${esc(name)}")`),
    ")",
    '(allow network-outbound (remote ip "*:*"))',
    '(allow network-outbound (literal "/private/var/run/mDNSResponder"))',
    "(allow process-exec",
    ...subpaths(jailExecDirs(allowExec)),
    ")",
  ];
  const writes = subpaths(allowWrite);
  if (writes.length) {
    lines.push(
      ";; read+write: this trial's config dir, fixture repo and temp dir only.",
      "(allow file-read* file-write*",
      ...writes,
      ")",
    );
  }
  const reads = subpaths(allowRead);
  if (reads.length) {
    lines.push(
      ";; read-only: the runtime install trees and the runner's own files.",
      "(allow file-read*",
      ...reads,
      ")",
    );
  }
  lines.push(
    ";; no terminal reads (what the operator types); last, so no allow above re-opens it.",
    '(deny file-read* (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))',
  );
  return `${lines.join("\n")}\n`;
}

// Every dir a jailed process may exec from: the system shells and tools, then the
// runtime trees. The one list both the profile's process-exec rule and the jailed
// PATH (jailedPath) are built from, so the two cannot drift apart.
function jailExecDirs(trees: string[] = []): string[] {
  return ["/bin", "/usr/bin", ...trees];
}

// The PATH for a jailed child: the base PATH (running node's dir first, absolute
// entries only) cut down to the entries whose canonical path lies inside a dir the
// jail may exec from, in their original order and spelling. A name lookup walks
// PATH, and libuv's walk (like execvp's) stops at the first entry that fails with
// anything but ENOENT: an entry the jail denies can answer EPERM, and the lookup then
// fails although an allowed copy sits further along. The binaries runEvals resolved
// (findOnPath) stay the first match: their dirs are runtime trees, and every entry
// dropped before them held no match. Another name in a kept dir can still be a
// symlink out of the exec dirs and EPERM (fails closed). A missing entry (no
// canonical path) has nothing to find and is dropped.
function jailedPath(pathEntries: PathEntry[], execDirs: string[]): string {
  const inside = (p: string) => execDirs.some((d) => p === d || p.startsWith(`${d}/`));
  return pathEntries
    .filter((e): e is { entry: string; real: string } => e.real !== null && inside(e.real))
    .map(({ entry }) => entry)
    .join(delimiter);
}

// Build the sandbox-exec argv that wraps the original `bin args...` under `profile`.
// Pure, so a test can assert the exact wrapped shape without executing sandbox-exec.
// `sandbox-exec -p <profile> <bin> <args...>` runs bin inside the seatbelt policy.
export function wrapWithSandbox(
  sandboxExec: string,
  profile: string,
  bin: string,
  args: string[],
): { bin: string; args: string[] } {
  return { bin: sandboxExec, args: ["-p", profile, bin, ...args] };
}

// Pure gate: given the platform and the resolved sandbox-exec path, return the path
// or THROW. The whole point is "never silently unsandboxed": if EVALS_SANDBOX=1 is
// set but we can't sandbox (not macOS, or sandbox-exec absent), we refuse hard
// BEFORE any session starts rather than run an agentic session in the open.
//
// DEBT: the jail relies on `sandbox-exec`, which Apple has deprecated but still ships
// and honors. It is opt-in and macOS-only (a hard refusal elsewhere, never a silent
// unsandboxed run). Ceiling: works only while macOS keeps shipping and honoring
// sandbox-exec, which is accepted for a local maintainer tool rather than taking on a
// container/VM dependency now. Upgrade path: if Apple removes it or stops honoring
// profiles, move the agentic session and the post-session step into a disposable VM
// or container, which would also bring Linux into scope.
export function requireSandboxSupport(platform: string, sandboxExecPath: string | null): string {
  if (platform !== "darwin") {
    throw new Error(
      `EVALS_SANDBOX=1 is macOS-only (seatbelt/sandbox-exec); refusing to run an ` +
        `agentic session unsandboxed on "${platform}". Unset EVALS_SANDBOX to run without the jail.`,
    );
  }
  if (!sandboxExecPath) {
    throw new Error(
      "EVALS_SANDBOX=1 is set but sandbox-exec was not found; refusing to run an agentic " +
        "session unsandboxed. (Expected /usr/bin/sandbox-exec; override with EVALS_SANDBOX_EXEC.)",
    );
  }
  return sandboxExecPath;
}

// Locate sandbox-exec. EVALS_SANDBOX_EXEC overrides (present-but-empty means "not
// found", a deterministic test/refusal seam); otherwise look it up on PATH
// in-process (findOnPath), once, before the first session.
function resolveSandboxExec(env: Env): string | null {
  if (env.EVALS_SANDBOX_EXEC !== undefined) {
    return env.EVALS_SANDBOX_EXEC ? resolve(env.EVALS_SANDBOX_EXEC) : null;
  }
  return findOnPath("sandbox-exec", env);
}

// Decide whether agentic sessions run inside the seatbelt jail, throwing on refusal.
// Null (no wrapping) when the flag is off or no agentic session will run. When the
// flag is on AND one will, support is mandatory: requireSandboxSupport refuses hard
// rather than silently run unsandboxed.
export function sandboxContext(env: Env, agenticWillRun: boolean): { sandboxExec: string } | null {
  if (env.EVALS_SANDBOX !== "1") return null;
  if (!agenticWillRun) return null;
  return { sandboxExec: requireSandboxSupport(process.platform, resolveSandboxExec(env)) };
}
