// The environments the eval runner's children start from, and the in-process PATH
// lookup that resolves every binary it spawns. Shared by the runner and the jail
// (scripts/lib/evals-jail.mts), so neither imports the other.

import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

export type Env = Record<string, string | undefined>;

// ---- child environments: an allowlist, never copy-then-strip ----------------

// The operator vars a child may inherit. Everything else stays behind: NODE_OPTIONS
// (code injection into every node child), SSH_AUTH_SOCK, GITHUB_TOKEN / AWS_* and the
// like, and every ANTHROPIC_* / CLAUDE_CODE_* var. Those last ones matter for auth, not
// just secrecy: Claude Code ranks CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY above
// ANTHROPIC_AUTH_TOKEN above ANTHROPIC_API_KEY above CLAUDE_CODE_OAUTH_TOKEN, so any of
// them reaching the child would silently replace the one credential the run chose.
const BASE_ENV_KEYS = ["HOME", "LANG", "USER", "LOGNAME", "SHELL", "TERM"];

// Proxy and CA vars, forwarded only when the operator sets EVALS_FORWARD_PROXY=1 (a
// corporate proxy or TLS-inspecting CA). A fixed set on purpose: an operator-supplied
// list could name ANTHROPIC_AUTH_TOKEN and reopen the hole the allowlist closes.
const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

// The env every process the runner spawns starts from, built key by key from `env`.
// PATH puts the running node's dir first, so a shim-managed node (mise/asdf/nvm)
// still resolves, then keeps only the operator's ABSOLUTE entries: an empty or
// relative entry resolves against the child's cwd, which is often a fixture repo
// the session wrote, where a planted `./git` or `./node` would then run as the
// runner. TMPDIR is the trial's own temp dir when one is given (the jail lets a
// trial write only its own dirs, so a child must not look for scratch space
// anywhere else), otherwise the runner's tmpdir(). The EVALS_FORWARD_PROXY opt-in
// is carried along with the vars it forwards, so filtering an already-filtered env
// (a jailed child building its own children's env) keeps them.
export function buildBaseEnv(env: Env, tmpDir: string = tmpdir()): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = [dirname(process.execPath), ...(env.PATH ?? "").split(delimiter)];
  out.PATH = [...new Set(entries.filter((p) => isAbsolute(p)))].join(delimiter);
  for (const key of BASE_ENV_KEYS) {
    if (env[key] !== undefined) out[key] = env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("LC_") && value !== undefined) out[key] = value;
  }
  out.TMPDIR = tmpDir;
  if (env.EVALS_FORWARD_PROXY === "1") {
    out.EVALS_FORWARD_PROXY = "1";
    for (const key of PROXY_ENV_KEYS) {
      if (env[key] !== undefined) out[key] = env[key];
    }
  }
  return out;
}

// The base env plus a pinned git identity and no global or system git config, for
// every git the runner runs and for the claude child (whose session commits). The
// identity keeps fixture commits attributable and off the operator's real one; with
// GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1 git reads no config from
// outside the repo (the operator's hooks, fsmonitor, aliases, signing), and the jail
// never has to re-open ~/.gitconfig. The repo's own config is another matter: see
// restoreFixtureGitConfig and judgeFixture.
export function buildGitEnv(env: Env, tmpDir: string = tmpdir()): Record<string, string> {
  return {
    ...buildBaseEnv(env, tmpDir),
    GIT_AUTHOR_NAME: "Eval Fixture",
    GIT_AUTHOR_EMAIL: "eval@localhost",
    GIT_COMMITTER_NAME: "Eval Fixture",
    GIT_COMMITTER_EMAIL: "eval@localhost",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

// Look a command up on the allowlisted PATH in-process — no `which` child — and
// return its absolute path, or null. A name containing a slash is made absolute
// as given. runEvals resolves every binary it spawns this way BEFORE the first
// session, and never looks one up again: a PATH dir can be writable by the
// operator's user (Homebrew's bin is), and a session must not be able to put a
// `git` or `claude` there for the runner to pick up later.
export function findOnPath(name: string, env: Env = process.env): string | null {
  const executable = (candidate: string) => {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  };
  if (name.includes("/")) {
    const candidate = resolve(name);
    return executable(candidate) ? candidate : null;
  }
  for (const dir of buildBaseEnv(env).PATH.split(delimiter)) {
    const candidate = join(dir, name);
    if (executable(candidate)) return candidate;
  }
  return null;
}

export function requireOnPath(name: string, env: Env, what: string = name): string {
  const found = findOnPath(name, env);
  if (!found) throw new Error(`cannot find ${what} on PATH; refusing to start the run`);
  return found;
}
