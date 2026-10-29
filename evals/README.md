# Behavioral evals

A regression harness that measures whether the resident laws (`HARRY.md`)
actually change a model's **first-response behavior**. harry's product is prose
law deployed into a user's global instructions; this checks that the prose still
earns its place. **Run it after any material change to `HARRY.md`** to catch a
reword that quietly stops moving behavior.

## The conditions

Every case runs the same prompt, on the same pinned model, under one of three conditions:

- **baseline** — a fresh, empty `CLAUDE_CONFIG_DIR` (no global `CLAUDE.md`, so no
  laws). This is the model's unguided behavior.
- **candidate** — a `CLAUDE_CONFIG_DIR` whose `CLAUDE.md` inlines this repo's
  `HARRY.md`. This is the model *with* the laws. Note it is the laws *minus their
  on-demand `references/` tables* — `HARRY.md` links out to `references/*` (tier
  gates, red-green, etc.) that a real session loads lazily; the candidate holds
  only the always-resident law text, so a check must target a prescription that
  lives in `HARRY.md` itself, not one that only a reference spells out.

The delta between them is the laws' effect. **candidate is what must pass;
baseline is informative contrast** (it is expected to fail many checks — that
gap is the point).

- **plugin** — candidate plus a frozen copy of this plugin loaded with
  `--plugin-dir`. A rule that moved from `HARRY.md` into a skill or reference is
  measured there the way a real session meets it. Each run copies only what the
  plugin loads (`.claude-plugin`, `HARRY.md`, `skills`, `commands`, `agents`,
  `references`) into its throwaway root and reads the laws from that copy; it leaves
  out `scripts/` and `dist/`, so no trial can run the installer or Codex, and
  `evals/`, `tests/` and `.local/`, so no trial can read the grading patterns. Text
  cases get `--tools "Skill,Read" --disallowedTools "Read(~/**)"`. Read needs no
  permission, so an allowlist never withholds it, and restricted mode, which would
  confine it, also drops the laws (`CLAUDE.md` is not loaded under `--restricted`).
  So Read is denied under the operator's home instead, where the checkout and its
  grading patterns live; the copy and the trial dirs sit in the temp dir, and a
  trial root under the home is refused. Agentic cases add Skill and the same deny to
  their own tools, but their `node` commands can still read the host, as under
  candidate — only the sandbox contains that, and the plugin condition refuses
  `EVALS_SANDBOX=1` because the jail is not wired to read the copy. Every line
  carries `pluginSha256`, the copy's content hash, and `score` flags a group that
  mixes copies the way it flags mixed law texts. A failing graded plugin group fails
  `score` the way a candidate group does.

Text cases under baseline and candidate run with `--tools ""`, so no tool exists at
all; `--allowedTools ""` alone would still leave Read. Every line records its tool
flags as `toolSetup`, and `score` flags a group whose trials ran under different
setups (`MIXED TOOL SETUP`) — older lines, taken with Read available, carry none.

### Why isolation matters

Each trial gets its own throwaway `mkdtemp` dir holding a config dir, a work dir,
a fixture parent and a temp dir, shared with no other trial. The runner never
reads or touches your real `~/.claude`. That is not incidental: if your own
global `CLAUDE.md` leaked into the baseline, the baseline would already be
"lawful" and the measured delta would collapse to nothing. The empty baseline
dir is what keeps the comparison honest.

### Authentication (two paths)

A fresh config dir is also *logged out* — `claude -p` returns
`{"is_error":true,"result":"Not logged in · ..."}`. So the child authenticates
from its environment alone, and every `run` takes **exactly one** of two
credentials:

1. **Console API key** — `EVALS_ANTHROPIC_API_KEY`. Create a key in the Anthropic
   Console; spend is billed to that API account, and the key can be revoked on
   its own at any time. The runner hands it to the child as `ANTHROPIC_API_KEY`.
2. **Subscription token** — `EVALS_CLAUDE_CODE_OAUTH_TOKEN`. Run
   `claude setup-token` to mint a token for your Claude subscription. It needs a
   paid Claude plan and is valid for one year; runs draw on the subscription's
   quota instead of API billing. The runner hands it to the child as
   `CLAUDE_CODE_OAUTH_TOKEN`.

Both set, or neither set, and `run` refuses before any config dir is created or
session starts; an empty or whitespace-only value counts as unset. A value
containing any whitespace — a carriage return from CRLF line endings, or a line
break from a copy that wrapped — is refused up front too, never silently
trimmed. Each message names the variables involved, and
never includes a value.

**Every child gets an allowlisted environment, not a copy of yours.** The runner
builds each spawned process's env key by key: `PATH` (the running node's
directory first, then only the absolute entries of yours), `HOME`, `TMPDIR` (the
runner's own), `LANG` and `LC_*`, `USER`, `LOGNAME`, `SHELL` and `TERM`. Under
`EVALS_SANDBOX=1`, the jailed children's `PATH` also drops every entry the jail
does not let them run programs from. A denied entry answers a lookup by name with
"operation not permitted", and the lookup stops there instead of trying the next
entry. The
`claude` child adds its config dir, a pinned git identity with no global or system
git config, and its **one** credential under the unprefixed name. Nothing else
from your shell reaches it. That includes a bare `ANTHROPIC_API_KEY` or
`CLAUDE_CODE_OAUTH_TOKEN`, the `EVALS_` variables themselves, `NODE_OPTIONS`,
`SSH_AUTH_SOCK`, `GITHUB_TOKEN`, `AWS_*`, and every other `ANTHROPIC_*` or
`CLAUDE_CODE_*` variable. This is what makes "exactly one credential" true:
Claude Code ranks `CLAUDE_CODE_USE_BEDROCK`/`VERTEX`/`FOUNDRY`, then
`ANTHROPIC_AUTH_TOKEN`, then `ANTHROPIC_API_KEY` above `CLAUDE_CODE_OAUTH_TOKEN`,
so any of them reaching the child would silently replace the credential the run
chose. Behind a corporate proxy or TLS-inspecting CA, set `EVALS_FORWARD_PROXY=1`
to also forward `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` (and their lowercase
forms), `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and `SSL_CERT_DIR`. The set is
fixed; there is no way to name other variables. Because your own privacy flags
no longer reach the child, the runner sets three itself, always:
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1` and
`DISABLE_AUTOUPDATER=1`. Nothing is written to disk
either: no credential file lands in a trial's config dir for a session to read.

**Hand the value over without printing it.** Keep it in a file only you can
read, and pass it with `$(cat …)`, so it never appears on a command line,
in shell history, or in the terminal:

```sh
mkdir -p ~/.config/harry
(umask 077 && : > ~/.config/harry/evals.token)   # create it empty, mode 0600
# Paste the token into that file with your editor; do not `echo` it into place.

EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
  node scripts/run-evals.mts run --condition candidate --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl
```

The same pattern works for `EVALS_ANTHROPIC_API_KEY` with a key file of its own.

**The seeded-credential fallback is gone.** The runner used to copy
`.credentials.json` from your real config dir into each condition dir when no
API key was set, and delete it after the run. It was removed for two reasons.
On macOS the live login is in the Keychain and that file is only a snapshot,
which goes stale on its own schedule, so runs failed with an expired token
while `claude` kept working interactively. And copying real credentials into
temp dirs was a liability in itself, however promptly they were scrubbed.

The child also runs with its **cwd set to a fresh empty dir**, not the repo root.
`claude` reads *project* memory by walking up from the working directory, so
running from this checkout would pull in the repo's own `CLAUDE.md` (which
enumerates the laws) into *both* conditions — the same silent-leak failure as an
un-isolated config dir, and it would poison the baseline too. cwd isolation is
the sibling defense to `CLAUDE_CONFIG_DIR` isolation.

## Model pinning (hard rule)

A model **must** be named — `--model <id>` or `EVALS_MODEL`. The runner refuses
to run without one. A behavioral result is only meaningful when it is
attributable to a known model; different models behave differently, so an
unpinned run is worse than no run.

## Trials (repeat runs + majority verdict)

A single first-response is noisy — a model may happen to say "root cause" one run
and skip it the next. `--trials N` (default `1`, a positive integer — anything
else is a clean error) runs each selected case **N** times, recording `trial:
1..N` on each result line. `score` then **groups** all lines by (case id,
condition) and gives the group **one** verdict by *strict majority*: it passes iff
**more than half** its trials passed. So 2/3 and 2/2 pass; a 1/2 **tie fails**
(strict means `> half`, never `>=`). The `score` table shows the tally, e.g.
`PASS (2/3)` / `FAIL (1/3)`, and only the graded candidate **groups** gate the run
(informative groups keep their own section, tallied but never gating). An
**errored** trial (auth failure, a crashed session) counts as a *failing* trial —
it stays in the denominator, and when a group has any, the tally spells it out,
e.g. `FAIL (0/3, 3 error)`, so an all-errored group is legible as such rather than
looking like three genuine non-compliances.

```sh
# Run each case three times; the majority verdict rides out one-off noise.
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
node scripts/run-evals.mts run --condition candidate --model claude-sonnet-4-5 \
  --trials 3 --out evals/results/run.jsonl
```

A legacy result line from before multi-trial support — one with **no** `trial`
field, or the old 0-based `trial: 0` — pools into its group just like any other
(grouping is by (case id, condition); the trial number itself is only a label),
so old and new result files mix coherently.

### Adding trials post-hoc (duplicate accumulation)

`run` **appends**, and `score` pools every line for a group — so running the same
condition into the same `--out` file again simply **adds** its trials to the pool.
This is the intended way to add trials after the fact: if a candidate group came
back `FAIL (1/2)` and you want a third opinion, run one more trial into the same
file and re-score — the group is now judged over all three. (This is the same
append-merge mechanism that lets baseline and candidate share one file.)

## Cost

Every `run` is **real API spend** — one `claude -p` call per (case, condition,
trial). With ~12 cases and two conditions (baseline and candidate) at `--trials 1`
that is ~24 calls per pass; `--trials 3` triples it. Only run it when you mean to. The `validate` and
`score` subcommands are free (they touch no API). Tests use a fake shim and never
spend.

**Text cases** are cheap-ish: the prompt goes in, the first response comes back
with tools disabled, and regex checks judge the prose. **Agentic cases are much
more expensive** — each one runs a *full headless session* (tools enabled) in a
throwaway fixture repo, so it can burn many calls per case. They are gated behind
`--agentic` (see below) and are *release-gate only* — run them when you mean to.

## Agentic mode (fixture repos + artifact checks)

A `"mode": "agentic"` case measures what the laws make the model **do**, not just
say. The runner:

1. **Materializes a fixture** — copies `evals/fixtures/<name>/` (committed plain
   files, no `.git`) into a fresh temp dir, runs `git init` there and makes one
   pinned initial commit (author/committer `Eval Fixture <eval@localhost>`). Every
   git call is hardened with `-c commit.gpgsign=false -c core.hooksPath=` so the
   operator's own gpg-signing or git hooks can't break or side-effect the seed
   commit. This never happens inside the repo/worktree — the copy lands in the
   trial's own dir, under the OS temp dir (override with `EVALS_FIXTURE_ROOT`).
2. **Runs a full session** in that dir: `claude -p <prompt> --model <id>
   --output-format json --permission-mode acceptEdits --allowedTools "<git
   subcommands>,Bash(node:*)"`. See the permission model below.
3. **Judges artifacts** — evaluates the case's checks against the resulting repo
   state and records per-check outcomes on the result line (so `score` reads them
   offline; the temp fixture is gone by then).

### Permission model (what the session may do)

Text cases run with no tools at all (`--tools ""`; under the plugin condition,
Skill and a Read denied under the home). An agentic session must actually *act*, so
it runs with two permissions and nothing more:

- `--permission-mode acceptEdits` — auto-approves **file edits** (create/modify)
  without an interactive prompt, which a headless run can't answer.
- `--allowedTools "<git subcommands>,Bash(node:*)"` — auto-approves the specific
  git subcommands a session needs (`git status/diff/log/add/commit/branch/
  checkout/switch`, each as `Bash(git commit:*)` etc.) plus `Bash(node:*)`.
  Everything else stays deny-by-default.

Why: the artifact checks assert on **git state** (`git_created_branch`,
`git_no_new_commits_on_initial`, `commit_message_matches`) and on **test runs**
(`test_command_passes`, default `node --test`). If a session couldn't branch,
commit, and run `node`, those checks would be *structurally unsatisfiable* — a
lawful session that wants to do exactly that would be walled off mid-task (a real
batch showed sessions editing files, making zero commits, and their response
tails literally asking for approval to run `node`).

The git leg is granted per **subcommand**, not a blanket `Bash(git:*)` (following
`commands/review.md`'s own convention), so `git push`, `git config`, and the
`git -c alias.x='!sh'` shell-escape are all still denied at no cost to the checks.
`--allowedTools` is a single comma-separated value here (`claude --help`: "Comma
or space-separated list of tool names to allow").

**The allowlist narrows the attack surface; it does not by itself contain a
misbehaving session.** `Bash(node:*)` is arbitrary code execution — including
network — so a session that wants to reach out or exfiltrate still can. Two
containment layers address this:

- **Credential exposure** is bounded (see
  [Authentication](#authentication-two-paths)): the session gets exactly one
  revocable credential, `EVALS_ANTHROPIC_API_KEY` or
  `EVALS_CLAUDE_CODE_OAUTH_TOKEN`, through an allowlisted env that carries
  nothing else from your shell — and **no credential is written to disk at
  all**.
- **The post-session step** is everything the runner does on paths the session
  controlled: it checks the fixture is still the directory it created, puts
  back the `.git/config` it wrote at materialization, collects the repo state,
  and evaluates every check, model-written tests (`test_command_passes`)
  included. It refuses the trial, rather than judging it, if the fixture path
  now leads somewhere else (a session can rename its fixture away and leave a
  symlink to another repo), `.git` is no longer a plain directory, the session
  added `.git/commondir` or `.git/config.worktree`, or `.git/config` is no longer
  a regular file. It is bounded by a timeout (5 minutes), so a hung
  model-written test cannot hang the run. **Sandboxed**, this whole step runs as
  one child under the session's own jail profile, with the credential-free
  allowlisted env, and the runner treats what it prints as untrusted: it accepts
  only one `{ ok, detail }` per check, strips control characters and caps the
  text. Whatever the session planted, whether a swapped fixture, a config
  re-planted after the restore, a `gpg.program` or a test, runs inside that jail
  if it runs at all. The jail is deny-by-default (below), so code running there
  can write only the trial's own dirs and cannot ask a system service to start a
  program outside the jail, with one exception: launchd will `kickstart` a job
  you already have loaded (see the OS sandbox section's "does NOT contain" list
  below). **Unsandboxed** the step runs in the runner itself,
  and none of this is a security boundary: the session already ran as you, with
  your filesystem. The checks there only guard against accidents.
- **What the runner runs after a session** is fixed before the first one:
  `git`, `claude` and `sandbox-exec` are resolved to absolute paths up front (on
  the allowlisted `PATH`, in-process, with no `which`) and spawned by those paths
  from then on. A binary a session drops into a `PATH` directory later is never
  picked up. Every child's stdout and stderr are piped; what reaches you (error
  messages, result lines) has control characters stripped first.
- **Filesystem and system-service exposure** is bounded by the opt-in
  [OS sandbox](#os-sandbox-opt-in-evals_sandbox) below: `EVALS_SANDBOX=1` runs the
  session under a deny-by-default profile that confines its writes to its own
  trial's dirs, denies it reads under your `$HOME`, and lets it reach almost no
  system service that could start a program outside the jail (see "What it does
  NOT contain" below for the launchd exception).

What remains unbounded even with both is *network* (the session must reach the API)
and the **env-held credential** (no OS sandbox can hide an env var from the session's
own processes — the mitigation is that the key or token is revocable). That residual is
an accepted trade for a **maintainer-run, local** release gate on **trusted
prompts**. Do not point this at untrusted input.

### OS sandbox (opt-in, `EVALS_SANDBOX`)

`EVALS_SANDBOX=1` wraps each **agentic** session in a macOS
[seatbelt](https://developer.apple.com/) profile via `sandbox-exec`. The profile
is deny-by-default: a misbehaving or prompt-injected session can write only its
own trial's dirs, read nothing under your `$HOME` and nothing you type into the
terminal, and reach no *mach-lookup* system service that could start a program
outside the jail, such as LaunchServices (`open`) or Apple Events (`osascript`).
launchd is an exception: `launchctl` reaches it over the task's bootstrap
port rather than a mach-lookup name, so this profile does not gate it at all
(see "What it does NOT contain" below).

**What it blocks.** The profile's first rule is `(deny default)`; it then allows
back only what `node`, `claude` and `git` need. A jailed process cannot:

- read anything under your `$HOME` except its own trial's dirs, the `node`,
  `claude` and `git` install trees and the runner's own files, and cannot read
  the terminal you type in (`/dev/tty`, `/dev/ttysN`);
- write anywhere but its own trial's config dir, fixture repo and temp dir (and
  `/dev/null`): not another trial's dirs, not the shared temp root, not a
  user-writable directory such as `/opt/homebrew/bin`;
- run a program from a trial dir;
- ask a system service to start or drive a program outside the jail, such as
  LaunchServices (`open`) or Apple Events (`osascript`) — launchd is the
  exception, below;
- reach a local daemon over a unix socket (a Docker socket, for example).

**The full allowlist is a test, not this page.** `tests/evals-jail.test.ts` pins
the whole generated profile as fixed text ("buildSeatbeltProfile: the whole
profile is exactly this text (golden)") and the paths `trialJail` fills it with
("trialJail hands the profile builder each path once, by its canonical spelling
(golden)"). Adding or widening a rule means editing that test too, so the change
is visible in review.

The allowlist was derived with the fake `claude` shim: the jail tests pass with
nothing more, and the real `claude --version` and an HTTPS request from `node`
also run under it. A live run with the real `claude` still has to confirm it
needs nothing else. If it does, the trial fails closed, never open: its `error`
carries the failing child's own stderr, which does not name what was denied.
The kernel logs sandbox denials to the unified log, readable without `sudo`.
Watch it while the run happens, or read it back afterwards:

```sh
log stream --style compact --predicate 'sender == "Sandbox"'
log show --last 10m --style compact --predicate 'sender == "Sandbox"'
```

To read back exactly the run's window, give `log show` `--start '<YYYY-MM-DD HH:MM:SS>'`,
the time the run began, in place of `--last`. Each line
reads `Sandbox: <process>(<pid>) deny(1) <operation> <target>`, for example
`Sandbox: pbpaste(123) deny(1) mach-lookup com.apple.pasteboard.1`. The target
is the service name or path that was refused. Other apps' sandboxes log here
too, so narrow by time, to the run's window, not by process name: every process
the run starts is jailed, including each tool the session or its tests run, and
the log names each one by the binary running when it was denied: `node`, `git`,
`claude` by its version (such as `2.1.281`), `touch` when `env touch` ran it, and
`bash` for `/bin/sh` (which runs bash on a default install). A filter on `node`,
`git` and `claude` drops the one line that explains a failing tool. The jailed
processes also log denials they run fine without; never add these:
`mach-lookup` of `com.apple.logd`, `com.apple.diagnosticd`,
`com.apple.system.notification_center`,
`com.apple.system.opendirectoryd.membership` and `com.apple.bsd.dirhelper`,
`file-read-data ~/.CFUserTextEncoding`, `file-write-data /dev/dtracehelper`,
`system-info vfs.disk-space`, and `file-read-data` or `file-read-metadata` of
`/dev/tty` or a `/dev/ttysN`. That last one is the terminal deny, on purpose
(see "What it blocks" above), and a jailed `bash` can log it just by starting. The log
is not complete: the kernel folds repeats
into `N duplicate reports` lines and does not report every denial (a jailed
`claude` started from a directory under `$HOME`, which it may not read, failed
and logged only the `/dev/dtracehelper` line). If nothing there explains the failure, the log will
not name it; do not guess a rule from the error text. Add only a denial the
failing process hit, by its exact name, after checking by hand that it cannot
start, drive or act for you as a program outside the jail (a keychain,
preferences or login-item service can). Never add a prefix or a broad rule.

So the session keeps working in its fixture. The kernel denies anything the
profile does not allow: reads of ssh keys, other credentials and documents under
`$HOME`, writes anywhere but its own trial's dirs, and mach-lookup requests to a
service that would start a program as you, outside the jail — with the launchd
exception below ("What it does NOT contain"). The post-session step (above) runs
as one child under the same profile, so the runner's own restore, git calls and the
model-written tests stay inside the jail too. The session's git identity is pinned
via env (`Eval Fixture <eval@localhost>`, `GIT_CONFIG_GLOBAL=/dev/null`,
`GIT_CONFIG_NOSYSTEM=1`) so it can still commit without the jail having to
re-open `~/.gitconfig`.

**What it does NOT contain:**

- **Network** — outbound IP is deliberately left open; the session must reach
  the model API, directly or through your opt-in proxy. This is **not** a
  no-exfiltration boundary. It includes `localhost`, so a local TCP service that
  runs commands for any client would act for the session.
- **Exec of system tools** — the session can run anything in `/bin`, `/usr/bin`
  and the runtime trees, `open` and `launchctl` included. Running `open` or
  `osascript` is safe only because the mach-lookup services they'd need to act
  outside the jail are denied; a test pins that `open` and `launchctl submit`
  both exit nonzero and launch nothing. `launchctl` is not fully covered by that
  same guarantee — see the next bullet.
- **launchd job control** — `launchctl` reaches launchd over the task's
  bootstrap port, not a mach-lookup name, so the jail does not gate it at all.
  launchd applies its own checks per subcommand: `submit`, `bootstrap`, `load`,
  `kill`, `bootout` and `setenv` are refused. Two are not: `launchctl kickstart
  gui/<uid>/<label>` starts an already-loaded job of yours outside the jail, and
  `launchctl disable gui/<uid>/<label>` writes a disabled entry to launchd's
  override store that persists across reboot. This is fine for a maintainer-run
  gate on trusted, repo-authored cases; it is not a boundary for untrusted
  input. Run untrusted cases on an ephemeral machine (a CI runner or a VM)
  instead.
- **Reads outside `$HOME`** — the session can read anything outside your home
  that your user can read, a terminal excepted: system dirs, `/opt`, and the
  temp root, including other trials' dirs. It cannot write them.
- **Whole runtime directories** — each `node`, `claude` and `git` install tree
  is allowed as its whole containing directory, not a single file: an nvm
  `node` install makes that whole node-version directory readable and
  exec-able, and a `claude` installed as `~/.local/bin/claude` does the same for
  the whole of `~/.local/bin`, other binaries there included.
- **The session's own credential** — the child's env is allowlisted, so nothing
  else from your shell reaches it. But it must hold its one credential to reach
  the API, and no OS sandbox can hide an env var from the session's own
  processes. Combined with open network, a hostile session could exfiltrate that
  credential. The honest ceiling: run this only on **trusted prompts**, with a
  **revocable credential** (`EVALS_ANTHROPIC_API_KEY` or
  `EVALS_CLAUDE_CODE_OAUTH_TOKEN`).
- **What a background process does to the verdict** — a session can detach a
  process that outlives `claude` (`Bash(node:*)` allows it, `setsid` included).
  The profile is inherited by every descendant, so it stays jailed (a test pins
  this): it can write only its own trial's dirs, which no later trial and no
  unjailed step reads. But nothing stops it, and it can still change its own
  fixture while the post-session step judges it, so the verdict can describe a
  repo the session did not leave. See the `DEBT:` note on `judgeFixture` in
  `scripts/run-evals.mts`.
- **`sandbox-exec` itself** is deprecated by Apple (still shipped and honored). It is
  accepted here for a local maintainer tool rather than taking on a container/VM
  dependency.

The broad allowances (outbound IP, exec of whole system and runtime dirs, reads
outside `$HOME`, and the launchd residual) are recorded, with their upgrade
path, in the `DEBT:` note on `buildSeatbeltProfile` in
`scripts/lib/evals-jail.mts`.

**Refusal (never silently unsandboxed):** if `EVALS_SANDBOX=1` is set and an agentic
case is queued to run but the platform is not macOS, or `sandbox-exec` is not found,
the run **hard-errors before any session starts**. It never falls back to an
unsandboxed agentic run. **Text mode ignores the flag**: a text case runs
`claude -p` with no tools (`--tools ""`), unjailed. Its config and
work dirs belong to its own trial, which no jailed session can write. Setting the
flag on a text-only run is a no-op, not a refusal — except under the plugin
condition, which refuses the flag for every run: its text cases have Read, and the
jail neither covers them nor may read the plugin copy.

Every result line also records `claudeVersion`, read once per run with
`claude --version` (no session, no credential, a throwaway config dir): the CLI
enforces the tool limits a trial ran under.

```sh
# Release gate, sandboxed: each agentic trial jailed, token read from a file.
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" EVALS_SANDBOX=1 \
  node scripts/run-evals.mts run --condition candidate --model claude-sonnet-4-5 \
  --agentic --trials 3 --out evals/results/run.jsonl
```

### Fixture anatomy

- `tiny-node` — a `package.json` (no deps), `math.mjs` with a **seeded off-by-one
  bug** in `rangeSum` (sums `1..n-1`), and `math.test.mjs` that covers `add` only,
  so `node --test` is green on the seed. Bug-fix cases exercise fixing `rangeSum`
  and adding a repro test.
- `tiny-lib` — `slugify.mjs` (correct, no bug) + its passing test. For
  feature-addition cases.

Add a fixture by dropping a new dir under `evals/fixtures/`; a case references it
by name via the `fixture` field.

### Check types

All are evaluated mechanically against the post-session fixture repo:

| type | fields | passes when |
| --- | --- | --- |
| `git_created_branch` | – | a branch other than the initial one exists |
| `git_no_new_commits_on_initial` | – | no commits landed on the initial branch since the seed (work moved off it) |
| `file_contains` | `path`, `pattern` | file exists and matches (missing file → fail) |
| `file_not_contains` | `path`, `pattern` | file absent, or present and does not match |
| `repo_grep` | `pattern`, `pathPattern`? | some tracked/new file matches (`.git` skipped) |
| `repo_grep_absent` | `pattern`, `pathPattern`? | no tracked/new file matches |
| `commit_message_matches` | `pattern` | some **new** commit message (seed excluded) matches |
| `test_command_passes` | `command`? | running `command` (default `node --test`) in the fixture exits 0 |

`pattern` takes an optional `flags` string like the text checks. `pathPattern`
(repo_grep/repo_grep_absent only) is a regex matched against each relative file
path *before* the content grep — use it to scope a grep to, say, test files
(`(^|/)(test|.*\.test)\.`) so a match in an unrelated file (a prompt-echo in
`NOTES.md`) can't satisfy it. A case object adds `"fixture": "<name>"`; everything
else (`id`, `mode`, `law`, `checks`, `note`) is shared with text cases.

`git_created_branch` and `git_no_new_commits_on_initial` are paired for HARRY.md **Ask first**: the
first proves a fresh branch exists, the second proves the work actually moved off
the initial branch. HARRY.md **Ask first** requires a fresh branch even for a Trivial edit and
forbids touching `main`/`master` without consent, so both apply.

### Informative (contrast-only) cases

A case may set `"informative": true`. Its checks are still evaluated and printed
(under a separate "informative" grouping in the `score` table), but its failures
**never** set the exit code — it is contrast signal, not a gate. Use it for a
behavior the candidate is not *required* to exhibit from HARRY.md alone.

`agentic-feature-conventional-commit` is the shipped example: it leans on the
operator's global English/conventional-commit convention (tagged `law: "L&C"`),
not a HARRY.md section, so it is marked `informative` and cannot fail the run.

### Cost gate

Agentic cases are **skipped** on a normal `run` (a one-line notice names them).
Pass `--agentic` to include them — that is the deliberate release gate. Naming an
agentic case explicitly with `--cases` but *without* `--agentic` is a hard refusal
rather than a silent skip, so you never spend on one by accident.

```sh
# Text cases only (agentic ones are skipped with a notice):
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
node scripts/run-evals.mts run --condition candidate --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl

# Release gate: include agentic cases AND repeat each 3× so the majority verdict
# rides out one-off noise (real, heavier spend — this is the gate you run before
# shipping a HARRY.md change):
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
node scripts/run-evals.mts run --condition candidate --model claude-sonnet-4-5 \
  --agentic --trials 3 --out evals/results/run.jsonl
```

Each trial's dir (its config, work, fixture and temp dirs; each result line
records it as `trialDir`) is left in place under the temp root on purpose — this
is a manual, low-frequency tool and the leftover repos have post-hoc inspection
value. There is no cleanup code; the OS temp dir is the janitor. Point
`EVALS_FIXTURE_ROOT` somewhere you can prune if the accumulation ever bothers you.

## Reading the results: a green candidate is not evidence

**A case that passes in BOTH conditions measures the model and its harness, not the
laws.** Its candidate green proves nothing about `HARRY.md`; it is only a guard
against a future law change making good default behavior *worse*. The number that
carries meaning is the **delta**, which is why both conditions belong in one file
and why `score` prints them together.

As of the 2026-07-30 recalibration (`claude-sonnet-4-5`), of 18 cases: **10 pass in
both conditions**, 4 fail in both, and 4 put the candidate ahead. Of those 4, exactly
**one** — `agentic-debt-shortcut`, the `DEBT:` marker (now HARRY.md **Code**), 0/3 → 3/3 — reaches
conventional significance (one-sided Fisher p=0.05). The other three sit at p=0.12–0.20,
which is the evidential weight of flipping two heads.

**So the suite currently demonstrates one law effect, not several.** Report it that
way. Every case note carries its raw pair and its Fisher p precisely so the next
reader cannot round p=0.20 up to "it works".

Ten cases passing unaided is a real finding about what the resident layer still buys
on Claude, but it is **not** license to delete the corresponding law: it is weaker
evidence than it looks — five of them pass by ABSENCE (`regex_must_not` /
`repo_grep_absent`), and an empty or off-topic reply satisfies those patterns just as
well as a compliant one.

The four both-fail cases are true negatives about the laws' reach, deliberately left
gating rather than demoted to `informative`: reclassifying a law that stopped working
turns "harry does not deliver here" into "this does not count".

**Gate status as of 0.17.0: the suite exits non-zero.** That is the honest state, not
an oversight.

### Calibrations go stale, and silently

Every case note carries a `CALIBRATION <date> (<model>, <trials>[, sandbox])` line
with **both** conditions' numbers. Record all of it: on 2026-07-30 an
`agentic-isolate-branch` failure was read as a regression against a five-day-old
"3/3", and two law edits were made on that reading before a control run of the
byte-identical previous release scored the same 0/3 — the probe, not the laws, had
moved. The missing model/date metadata is why nobody caught it sooner.

**So: before treating any failure as a regression, run BOTH controls.**

1. **Negative control** — re-run the previous release's `HARRY.md` as the candidate.
   Only a *passing* control makes the failure a regression in this release.
2. **Positive control** — confirm the probe can still go green at all. A failing
   negative control alone is equally consistent with "the environment moved", "the
   probe is broken", and "release N−1 already regressed"; on its own it can only rule
   out "this release's edit caused it", so a suite judged by it would call every
   failure environmental forever, including a slow real regression.

For artifact checks the positive control is **free** — `materializeFixture` +
`collectRepoState` + `evaluateArtifactChecks` are exported, so a script can perform
the lawful actions by hand and assert the checks fire, with no API call. That is how
`agentic-isolate-branch` was settled on 2026-07-30: negative control 0/3 on the
byte-identical previous release, positive control green on all three checks — so the
probe works and the model genuinely no longer branches.

## Cases

`cases.jsonl` — one JSON object per line:

```json
{"id": "...", "mode": "text", "prompt": "...", "law": "Tiers",
 "checks": [{"type": "regex_must" | "regex_must_not", "pattern": "...", "flags": "i"},
            {"type": "declared_tier", "tier": "trivial" | "standard" | "major"}],
 "note": "..."}
```

- `regex_must` — the response must match the pattern (e.g. a lawful bug reply
  mentions "root cause").
- `regex_must_not` — the response must not match it (e.g. no "you're absolutely
  right" opener).
- `declared_tier` — takes `"tier": "trivial" | "standard" | "major"` in place of a
  pattern; the response must declare that tier ("**Tier: Major**", "tier is Major")
  and no other. A tier word outside a declaration ("a major change") does not count.
  A result line embeds it expanded into its `regex_must` / `regex_must_not` pair, so
  `score` judges archived results by the matcher they were run with.

Prompts are realistic user requests and never mention harry or the laws — asking
"would you classify this?" would cue the answer. Checks are robust regexes, not
exact phrases.

### Candidates

Behaviors no case covers yet. Each line was once a wording pin in `tests/`, deleted
on 2026-10-29 because a reword turned it red and a wrong behavior did not; a case
here is written only when the user names the behavior as load-bearing.

**Finishing's merge tail**
- a unit lands as a squash: one commit on the base summarising the unit, never a merge commit; locally with `git merge --squash` and `git reset --merge` as the undo, on a PR with `gh pr merge --squash --subject --body`
- the landing check is `git merge-tree --write-tree`, read past its first line; `branch -D` only after the landing check and the clean-worktree check pass
- isolation follows concurrent writers, not tier; the user editing alongside counts as a writer
- the layout names only the unit's own linked worktree, never the main checkout; Discard touches no main checkout that is not on the unit's branch and keeps ignored files
- a merge in progress is finished or aborted first, then cleanup restarts from its first check; the clean check lists ignored files
- Option 1 pushes the base with a plain push, never forced; a rejected push stops, never retried; step h only watches CI; nothing asks before the push

**The fix check**
- fix-check names three levels (finding site, data flow, system) and what each checks; a returning cause needs a class-wide check; an unlisted side-effect flag fails at level 2
- the referee is handed every listed input, the reference itself in full, and never the session transcript
- a verdict is per fix: holds at all three named levels, or fails at a named level with a reason and a fix that holds; a stop-for-the-user line has its own shape and its four cases are named
- executing dispatches one referee over every non-small Critical/Important fix before building, builds each as its line says, sends back a report missing a line, records verdicts under `## Fix check` and one Progress line; a failed dispatch falls back to the session as not independent
- finishing's fix now runs the referee's check before its AC is drafted and records the findings file, verdicts and Progress line

**The re-review form and finding identity**
- a finding's number holds inside one report only; its identity is where it is plus what is wrong
- executing numbers the merged list; the re-review gives one verdict per handed number, ADDRESSED only when the cause is gone, judged at fix-check's three levels; attempted is not addressed
- new issues number on from the handed list's last number; two lanes' new issues merge into one numbering
- the re-review's Assessment carries Quality and Verdict, no per-AC spec; the both-verdicts rule names the re-review as its one exception
- the Codex lane's re-review gets the open list through `--rereview`, never `--context`; the facts file carries no AC, which go through `--spec` with their probe lines; every hand-off names the unit's tier

**Grilling**
- the exit gate (residue manifest: decided, deferred, assumptions; the settled decisions as numbered AC; what approval covers) is defined once, in grilling.md
- the loop exits on three conditions: no open questions after a re-walk that adds nothing, every assumption dispositioned, the destination did not move
- listing an assumption is not closing it; only the user defers a question; the ledger is written to a file only on request
- one question per round in both phases; batching is opt-in; the re-walk runs after every answer and every design draft, from the destination down, reopening a decision out loud and withdrawing its AC; the handoff lets a re-walk reopen a settled decision
- tier sets the interview's depth (divergence brief, convergence on the frontier, exit gate unabridged), never its cadence

**The architecture review's inputs and rulings**
- merge, PR and keep all pass through the review; only Discard skips it; a pre-decided path still runs it; a bug fix that alters a shape is reviewed like a feature
- an empty shape list writes the skip line to `## Progress`; with no item every line goes to the reply, a fix now fixes in place and a backlog still lands in an item
- one analyst, one lane, handed the round, the shape list, the design and AC, the diff by absolute path (its directory created first), the reference in full, the last 20 commits, repo read access, and on a later round every ruling and left-as-is Minor
- the reviewer steps up one level and labels what is seen only from there, reads the history for accumulation, names the unseen side of a boundary, phrases missing context as a question, says no findings plainly, and never fixes
- every finding carries where, why, severity (defined in shape terms), structural fix and recommended ruling; a Minor from round 2 on carries none and is left as is without a ruling
- rulings are fix now (a new AC that names the one it supersedes; approved text never edited; back to executing), backlog (a new or merged item), leave as is (recorded in the architecture form, handed to later rounds)
- every round records the head it reviews; a later round lists and packages only the changes since that head; rounds 2 and 3 start on their own, none after, and round 3 with a Critical or Important open stops with a status report
- the leave-as-is record's fields are listed once, in doc-types The item model, and the architecture review cites its architecture form; the review door points at the step's Reviewer list instead of copying it

**Who writes**
- the session writes everything and dispatches only analyst, referee and scout, naming no model; lanes dispatched at once, one fix wave, exactly one scoped re-review, no second wave
- a failed Codex lane is recorded verbatim and the review goes on with one lane; the findings list is a file Progress names; a resume reads Progress, git log and the named files; a missing findings file re-runs the review
- /audit dispatches only analyst and runs its deterministic step as the session's script; the hunter prompt returns an unfinished thread as a lead; debate's opus voice is analyst
- the resident laws keep each rule under its heading, and every rule that left the core has one home in the skill or reference that uses it

**Plain language and the writing laws**
- the Talk law binds plain writing to every text written for people and keeps briefs and review reports precision-first, coining no new term; a PR body is the user's
- the plain-language reference carries the grounding rule, both principles and two levels; the `/wait-what` door is one-shot, not a mode
- code carries no comment by default; the one kept kind is a one-line trade-off; a DEBT: note names its ceiling and upgrade path; tool directives are not comments
- every review and architecture finding carries a structural fix, a short-term one only when that is not simple, a workaround never; a comment that restates the code, justifies a workaround or resists a change is flagged
- a fix inside a unit is tiered like a task: small only when Trivial and no test weakens; the fix wave cites that rule once; the scope brake applies to the re-review; three failed fixes of one hypothesis stop

**Backlog writers and the review door**
- doc-types owns the Notes entry's shape, the superseded-AC rule and the ruled-backlog marker forms; a kept Non-Goal is ruled in the residue manifest; /sync's migration is the one writer outside the Similar rule
- the review door documents each flag's file, that it needs `--base`, what it excludes, that an empty range fails the handed modes, and what `--context` must not carry
- `/sync`'s shared Phase 2 stops on init's non-zero exit before Phase 3
- `/release` passes `--start` to the state script, takes the latest tag from it, and greps with its token boundary, never `grep -w`
- the referee's card points at the fix-check reference; /distill writes under the resolved store, never a bare `.local/`; doc-types says to set up or confirm `.local/` when a project has none
- the /grill and /wait-what doors restate nothing of the technique they point at; brainstorming and tier-gates restate nothing of grilling.md's exit gate or re-walk; doc-types' template and brainstorming re-list no Follow-ups source

**Tiers, acceptance criteria and the audit**
- HARRY.md sets the Major trigger by risk (a red line, a failure hard to see or undo, an edit to always-loaded instructions), never by file count; red-green's table holds the TDD tiers
- an AC states an outcome and carries its verification; the rubric gives one verdict line per AC; executing's analyst lane is handed every file the rubric declares as its standard
- executing's Build step sends Standard and Major to red-green.md before writing a test; red-green's scope sentence binds Every test to every tier that writes one and adds the full cycle at Major
- Standard and Major build to the rubric's Engineering judgment, read before the first commit, and the fix wave applies it too
- finishing cites HARRY.md **Ask first** for its destructive step; doc-types says a work unit is one item, status backlog → active → done
- tier-gates defines brainstorm depth once and no tier row prescribes interview cadence; brainstorming and tier-gates restate none of the depth rule
- finishing checks a PR's reviews, inline comments and CodeRabbit status, never merges over an unmet conditional approval, and keeps planning language out of the title and body
- the audit sends a test that exists but guards nothing from its coverage-holes dimension to **Low-value tests**; a low-value-tests finding carries its deletion evidence at any severity, its retention check into the debt ledger, and a remediation naming the keeper and the mutation

## Invocation

```sh
# Free: schema-check the cases file.
node scripts/run-evals.mts validate

# Real spend: run BOTH conditions into the SAME --out file (run appends, so
# score can contrast baseline against candidate in one table). Every `run` needs
# exactly one credential (see Authentication); these read the token from its file.
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
node scripts/run-evals.mts run --condition baseline  --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
node scripts/run-evals.mts run --condition candidate --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl

# A subset by id, or set the model via env:
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
EVALS_MODEL=claude-sonnet-4-5 node scripts/run-evals.mts run \
  --condition candidate --cases tier-small-feature,debt-shortcut --out evals/results/run.jsonl

# Free: score the results file (exit non-zero if any candidate check fails,
# or if a malformed row is refused; each refused row is reported by its line).
node scripts/run-evals.mts score --results evals/results/run.jsonl
```

`run` **appends** — point both conditions at one `--out` file to get a
baseline-vs-candidate contrast; a fresh path starts a new file. `results/` is
gitignored — runs are local artifacts, not committed. Each result line embeds
the case's checks, so `score` is self-contained and never drifts from a
later-edited `cases.jsonl`.
