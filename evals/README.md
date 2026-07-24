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

These are **text cases** only: the prompt goes in, the first response comes back
with tools disabled, and regex checks judge the prose. An agentic mode (fixture
repos + artifact checks) arrives separately.

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
