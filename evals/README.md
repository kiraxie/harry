# Behavioral evals

A regression harness that measures whether the resident laws (`HARRY.md`)
actually change a model's **first-response behavior**. harry's product is prose
law deployed into a user's global instructions; this checks that the prose still
earns its place. **Run it after any material change to `HARRY.md`** to catch a
reword that quietly stops moving behavior.

## The two conditions

Every case runs the same prompt, on the same pinned model, under two conditions:

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

### Why isolation matters

Each condition gets its own throwaway `mkdtemp` config dir. The runner never
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
containing a carriage return (a file saved with CRLF line endings) is refused up
front too, never silently trimmed. Each message names the variables involved, and
never includes a value.

**Every child gets an allowlisted environment, not a copy of yours.** The runner
builds each spawned process's env key by key: `PATH` (the running node's
directory first, then only the absolute entries of yours), `HOME`, `TMPDIR` (the
runner's own), `LANG` and `LC_*`, `USER`, `LOGNAME`, `SHELL` and `TERM`. The
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
either: no credential file lands in a condition dir for a session to read.

**Hand the value over without printing it.** Keep it in a file only you can
read, and pass it with `$(cat …)`, so it never appears on a command line,
in shell history, or in the terminal:

```sh
mkdir -p ~/.config/harry
(umask 077 && : > ~/.config/harry/evals.token)   # create it empty, mode 0600
# Paste the token into that file with your editor; do not `echo` it into place.

EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
  node scripts/run-evals.mjs run --condition candidate --model claude-sonnet-4-5 \
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
node scripts/run-evals.mjs run --condition candidate --model claude-sonnet-4-5 \
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
trial). With ~12 cases and two conditions at `--trials 1` that is ~24 calls per
pass; `--trials 3` triples it. Only run it when you mean to. The `validate` and
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
   commit. This never happens inside the repo/worktree — the copy lands under the
   OS temp dir (override with `EVALS_FIXTURE_ROOT`).
2. **Runs a full session** in that dir: `claude -p <prompt> --model <id>
   --output-format json --permission-mode acceptEdits --allowedTools "<git
   subcommands>,Bash(node:*)"`. See the permission model below.
3. **Judges artifacts** — evaluates the case's checks against the resulting repo
   state and records per-check outcomes on the result line (so `score` reads them
   offline; the temp fixture is gone by then).

### Permission model (what the session may do)

A headless `-p` session is **deny-by-default**. Text cases keep it fully denied
(`--allowedTools ""`), but an agentic session must actually *act*, so it runs with
two permissions and nothing more:

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
  a regular file. **Sandboxed**, this whole step runs as one child under the
  session's own jail profile, with the credential-free allowlisted env, and the
  runner treats what it prints as untrusted: it accepts only one `{ ok, detail }`
  per check, strips control characters and caps the text. Whatever the session
  planted, whether a swapped fixture, a config re-planted after the restore, a
  `gpg.program` or a test, runs inside that jail if it runs at all. **Unsandboxed**
  the step runs in the runner itself, and none of this is a security boundary:
  the session already ran as you, with your filesystem. The checks there only
  guard against accidents.
- **Filesystem exposure** is bounded by the opt-in [OS sandbox](#os-sandbox-opt-in-evals_sandbox)
  below: `EVALS_SANDBOX=1` jails the session out of the operator's wider `$HOME`.

What remains unbounded even with both is *network* (the session must reach the API)
and the **env-held credential** (no OS sandbox can hide an env var from the session's
own processes — the mitigation is that the key or token is revocable). That residual is
an accepted trade for a **maintainer-run, local** release gate on **trusted
prompts**. Do not point this at untrusted input.

### OS sandbox (opt-in, `EVALS_SANDBOX`)

`EVALS_SANDBOX=1` wraps each **agentic** session in a macOS
[seatbelt](https://developer.apple.com/) profile via `sandbox-exec`, so a
misbehaving or prompt-injected session cannot read the operator's wider `$HOME`.

**What it does:** the generated profile is `(allow default)` — everything permitted
— then **denies all filesystem reads and writes under `$HOME`**, then re-allows a
minimal set of exceptions:

- **read+write:** the throwaway config dir, the materialized fixture repo, and the
  OS temp root they live under (normally already outside `$HOME`, re-allowed
  defensively).
- **read-only:** the `claude` and `node` runtime install trees, resolved at run time
  via `which` + `realpath` (a runtime under `$HOME` — nvm node, the `~/.local`
  claude install — must stay readable for the child to start). Note this grants the
  whole **containing directory** of each runtime, read-only — sibling files in those
  `bin`/install dirs become readable too; it is a coarse, read-only allow, not a
  single-file grant.

So the session keeps working in the fixture, but reads of ssh keys, other
credentials, and documents elsewhere under `$HOME`, and writes anywhere outside the
fixture/tmp, are denied by the kernel. The post-session step (above) runs as one
child under the same profile, so the runner's own restore, git calls and the
model-written tests stay inside the jail too; the profile additionally lets that
child read `scripts/run-evals.mjs` itself. The session's git identity is pinned
via env (`Eval Fixture <eval@localhost>`, `GIT_CONFIG_GLOBAL=/dev/null`,
`GIT_CONFIG_NOSYSTEM=1`) so it can still commit without the jail having to
re-open `~/.gitconfig`.

**What it does NOT contain:**

- **Network** — deliberately left open; the session must reach the model API. This
  is fs-containment, **not** a no-exfiltration boundary.
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
  this), but nothing stops it, and it can still change the fixture while the
  post-session step judges it. That is a threat to the *verdict's* integrity, not
  an escape. See the `DEBT:` note on `judgeFixture` in `scripts/run-evals.mjs`.
- **`sandbox-exec` itself** is deprecated by Apple (still shipped and honored). It is
  accepted here for a local maintainer tool rather than taking on a container/VM
  dependency.

**Refusal (never silently unsandboxed):** if `EVALS_SANDBOX=1` is set and an agentic
case is queued to run but the platform is not macOS, or `sandbox-exec` is not found,
the run **hard-errors before any session starts**. It never falls back to an
unsandboxed agentic run. **Text mode ignores the flag** — a text case runs
`claude -p` with all tools denied (`--allowedTools ""`), so it has no exec surface to
jail; setting the flag on a text-only run is a no-op, not a refusal.

```sh
# Release gate, sandboxed: agentic cases jailed out of $HOME, token read from a file.
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" EVALS_SANDBOX=1 \
  node scripts/run-evals.mjs run --condition candidate --model claude-sonnet-4-5 \
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

`git_created_branch` and `git_no_new_commits_on_initial` are paired for §5: the
first proves a fresh branch exists, the second proves the work actually moved off
the initial branch. HARRY.md §5 requires a fresh branch even for a Trivial edit and
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
node scripts/run-evals.mjs run --condition candidate --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl

# Release gate: include agentic cases AND repeat each 3× so the majority verdict
# rides out one-off noise (real, heavier spend — this is the gate you run before
# shipping a HARRY.md change):
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
node scripts/run-evals.mjs run --condition candidate --model claude-sonnet-4-5 \
  --agentic --trials 3 --out evals/results/run.jsonl
```

Each materialized fixture (and each condition's config/work dir) is left in place
under the temp root on purpose — this is a manual, low-frequency tool and the
leftover repos have post-hoc inspection value. There is no cleanup code; the OS
temp dir is the janitor. Point `EVALS_FIXTURE_ROOT` somewhere you can prune if the
accumulation ever bothers you.

## Reading the results: a green candidate is not evidence

**A case that passes in BOTH conditions measures the model and its harness, not the
laws.** Its candidate green proves nothing about `HARRY.md`; it is only a guard
against a future law change making good default behavior *worse*. The number that
carries meaning is the **delta**, which is why both conditions belong in one file
and why `score` prints them together.

As of the 2026-07-30 recalibration (`claude-sonnet-4-5`), of 18 cases: **10 pass in
both conditions**, 4 fail in both, and 4 put the candidate ahead. Of those 4, exactly
**one** — `agentic-debt-shortcut`, §4's `DEBT:` marker, 0/3 → 3/3 — reaches
conventional significance (one-sided Fisher p=0.05). The other three sit at p=0.12–0.20,
which is the evidential weight of flipping two heads.

**So the suite currently demonstrates one law effect, not several.** Report it that
way. Every case note carries its raw pair and its Fisher p precisely so the next
reader cannot round p=0.20 up to "it works".

Ten cases passing unaided is a real finding about what the resident layer still buys
on Claude, but it is **not** license to delete the corresponding law: the same text is
inlined into `~/.codex/AGENTS.md` for the Codex build, which has no Claude harness
behind it, and nothing here measures that build. It is also weaker evidence than it
looks — five of them pass by ABSENCE (`regex_must_not` / `repo_grep_absent`), and an
empty or off-topic reply satisfies those patterns just as well as a compliant one.

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
{"id": "...", "mode": "text", "prompt": "...", "law": "§3",
 "checks": [{"type": "regex_must" | "regex_must_not", "pattern": "...", "flags": "i"}],
 "note": "..."}
```

- `regex_must` — the response must match the pattern (e.g. a lawful bug reply
  mentions "root cause").
- `regex_must_not` — the response must not match it (e.g. no "you're absolutely
  right" opener).

Prompts are realistic user requests and never mention harry or the laws — asking
"would you classify this?" would cue the answer. Checks are robust regexes, not
exact phrases.

## Invocation

```sh
# Free: schema-check the cases file.
node scripts/run-evals.mjs validate

# Real spend: run BOTH conditions into the SAME --out file (run appends, so
# score can contrast baseline against candidate in one table). Every `run` needs
# exactly one credential (see Authentication); these read the token from its file.
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
node scripts/run-evals.mjs run --condition baseline  --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
node scripts/run-evals.mjs run --condition candidate --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl

# A subset by id, or set the model via env:
EVALS_CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/harry/evals.token)" \
EVALS_MODEL=claude-sonnet-4-5 node scripts/run-evals.mjs run \
  --condition candidate --cases tier-small-feature,debt-shortcut --out evals/results/run.jsonl

# Free: score the results file (exit non-zero if any candidate check fails).
node scripts/run-evals.mjs score --results evals/results/run.jsonl
```

`run` **appends** — point both conditions at one `--out` file to get a
baseline-vs-candidate contrast; a fresh path starts a new file. `results/` is
gitignored — runs are local artifacts, not committed. Each result line embeds
the case's checks, so `score` is self-contained and never drifts from a
later-edited `cases.jsonl`.
