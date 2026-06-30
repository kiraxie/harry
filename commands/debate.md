---
description: Three frontier models (opus, gpt-5.5, gemini-3.1-pro) reason independently, debate their disagreements over two fixed rounds, then Claude synthesizes a neutral verdict. Roughly 2 Copilot premium requests per debate (gpt only).
argument-hint: '"<topic>" [--context <text|@file|@->]'
allowed-tools: Read, Agent, Bash(node:*), Bash(agy:*), AskUserQuestion
---

# Three-Model Debate

You are the **neutral conductor**. You do not argue a side — you orchestrate
three independent voices, surface their disagreements, make them debate, and
synthesize. The structure is **fixed at two rounds**; do not add or skip rounds.

Raw slash-command arguments:
`$ARGUMENTS` (the topic, plus optional `--context`).

Cost note: only gpt-5.5 uses Copilot quota (~2 premium requests/debate). opus runs
on your Claude subscription, gemini on your Google subscription via `agy`. If
Copilot quota is below harry's **< 5% remaining** fallback threshold, say so and
proceed with a two-voice debate (opus + gemini) rather than burning the last quota.

## The three voices (fixed routing — do not substitute)

| Voice | How you call it |
|-------|-----------------|
| `opus` | Dispatch a subagent via the Agent tool, `model: opus`. Prompt it to "ultrathink". |
| `gpt` | Bash: `node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask "<prompt>" --model gpt-5.5 --reasoning high` |
| `gemini` | Bash: `agy -p "<prompt>" --model "Gemini 3.1 Pro (High)" --print-timeout 20m`, run with a Bash timeout ≥ 20m (and prefer `run_in_background`) |

`${CLAUDE_PLUGIN_ROOT}` is set by Claude Code when this command runs. The `ask` and
`agy` calls are single-shot stateless calls, so the **entire** prompt (including all
prior-round context) must be in that one string.

**`agy` is slow and high-variance — plan for it.** Live measurement of
`Gemini 3.1 Pro (High)` via `agy -p`: the same prompt returned in 11–25s on some
runs and took **18+ minutes** on others, with no correlation to prompt length or
formatting (an earlier theory that multi-line prompts hang was disproven — single-line
prompts also ran 18 min). `--print-timeout` did NOT reliably cap the wait (a `3m`
setting still ran 18 min). Practical consequences for the conductor:
- Run the gemini call with `run_in_background: true` and a generous Bash timeout
  (≥ 20 min), so a slow Gemini turn doesn't block the opus/gpt voices — dispatch
  all three, then collect gemini whenever it lands.
- It usually succeeds eventually (exit 0 with a real answer); treat a true >20-min
  hang, not mere slowness, as failure. If gemini fails twice, proceed with a
  **two-voice debate** (opus + gpt) and say so explicitly in the final report
  rather than blocking the whole debate on the slowest leg.
- If predictable latency matters more than peak reasoning depth, `Gemini 3.1 Pro
  (Low)` was consistently fast (~14s) in testing — but the fixed routing calls for
  High, so only drop to Low if the user opts in.
`opus` (Agent tool) and `gpt` (`ask`, via a shell variable / heredoc) accept
multi-line prompts normally.

## Permissions (do not widen)

No voice touches the filesystem. YOU read any needed files (you already have read
permission) and inject them as text. Do not pass `--add-dir`,
`--dangerously-skip-permissions`, or any write/shell flag to `agy`. The `ask`
command is already read-only.

## Input

The user gives a topic. Optional `--context`:
- `--context "<text>"` — literal context for all three voices.
- `--context @<path>` — read that file's content as context.
- `--context @-` — summarize the **prior conversation** in this session into a
  context blob.
- If the topic concerns this repo, you may additionally read the relevant
  working-directory files yourself and fold concise excerpts into the context.

Build ONE shared `CONTEXT` text block from the above before Round 1.

## Round 1 — independent (run all three in parallel)

Send each voice the SAME framing. Dispatch the Agent call and both Bash calls in
a single message so they run concurrently.

Prompt template (identical for all three):
```
TOPIC:
<topic>

CONTEXT:
<CONTEXT, or "(none)">

Think independently and give your own honest, decisive position on this topic.
State your conclusion first, then your reasoning, key assumptions, and the
single strongest counter-argument to your own view. ~300-500 words.
```

Collect the three answers as `R1.opus`, `R1.gpt`, `R1.gemini`.

## Build the disagreement brief

Compare the three R1 answers. Write a short `BRIEF` listing each contested
point and where the three diverge:
```
CONTESTED POINTS:
1. <point> — opus: <stance> | gpt: <stance> | gemini: <stance>
2. ...
(Points all three already agree on: list briefly so they aren't re-litigated.)
```
If R1 answers are very long, condense each to its core claims when quoting them
in Round 2; otherwise pass them in full.

## Round 2 — debate (run all three in parallel)

Send each voice its own R1, the other two R1s, and the BRIEF. Dispatch all three
concurrently again.

Prompt template (per voice — fill `<self>` with that voice's name):
```
You are <self>. This is round 2 of a 3-model debate. Below are all three
round-1 positions and the contested points.

YOUR ROUND-1 POSITION:
<R1.self>

OTHER POSITIONS:
- opus: <R1.opus>
- gpt: <R1.gpt>
- gemini: <R1.gemini>   (omit your own line)

CONTESTED POINTS:
<BRIEF>

Reconsider in light of the others. For each contested point: defend your view
with a sharper argument, OR update it and say why. End with your final position.
~300-500 words.
```

Collect `R2.opus`, `R2.gpt`, `R2.gemini`.

## Synthesis — your final report to the user

Read the three R2 answers and produce exactly these sections:
```
## 共識
<points all three converged on>

## 殘留分歧
- <point>: opus … / gpt … / gemini …

## 三方最終立場
- **opus**: <one paragraph>
- **gpt**: <one paragraph>
- **gemini**: <one paragraph>

## CC 綜合建議
<your neutral synthesis and recommendation, calling out which argument is
strongest on each contested point and why>
```

Do not write transcripts to disk. Only print this report. Quote each voice's
actual output faithfully — do not invent positions a model did not take (HARRY.md §6).
