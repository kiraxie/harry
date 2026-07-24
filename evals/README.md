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

## Cost

Every `run` is **real API spend** — one `claude -p` call per (case, condition,
trial). With ~12 cases and two conditions that is ~24 calls per pass. Only run it
when you mean to. The `validate` and `score` subcommands are free (they touch no
API). Tests use a fake shim and never spend.

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
   --output-format json --permission-mode acceptEdits`. Tools are **enabled**
   (agentic mode does *not* pass the text-mode `--allowedTools ""` kill-switch);
   `acceptEdits` is the non-interactive permission mode (verified in
   `claude --help`).
3. **Judges artifacts** — evaluates the case's checks against the resulting repo
   state and records per-check outcomes on the result line (so `score` reads them
   offline; the temp fixture is gone by then).

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
node scripts/run-evals.mjs run --condition candidate --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl

# Include agentic cases (real, heavier spend — release gate):
node scripts/run-evals.mjs run --condition candidate --model claude-sonnet-4-5 \
  --agentic --out evals/results/run.jsonl
```

Each materialized fixture (and each condition's config/work dir) is left in place
under the temp root on purpose — this is a manual, low-frequency tool and the
leftover repos have post-hoc inspection value. There is no cleanup code; the OS
temp dir is the janitor. Point `EVALS_FIXTURE_ROOT` somewhere you can prune if the
accumulation ever bothers you.

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

# Real API spend: run BOTH conditions into the SAME --out file (run appends, so
# score can contrast baseline against candidate in one table).
node scripts/run-evals.mjs run --condition baseline  --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl
node scripts/run-evals.mjs run --condition candidate --model claude-sonnet-4-5 \
  --out evals/results/run.jsonl

# A subset by id, or set the model via env:
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
