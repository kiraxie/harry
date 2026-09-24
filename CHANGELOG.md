# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Finishing reviews the change's shape before anything merges or is
  pushed.** A new step 2 in `skills/finishing/SKILL.md`, between verifying
  tests and the merge-or-PR question, runs on every path out of the menu —
  merge, PR, keep — and a pre-decided path does not skip it. It first lists
  the shapes the change added or altered: an API, a DB schema, a public
  interface, or a module or service boundary. None → one declared line, `no
  shape changed, architecture review skipped`. Otherwise one independent,
  read-only `opus` subagent reviews them, handed the shape list, the item's
  design and acceptance criteria, the branch diff, the last 20 commits
  touching the changed paths, and the whole repo to read. On the Codex build
  it runs out of session through `review --architecture` (below), falling back
  to an in-session review recorded as not independent only when that run
  fails. The findings go to the user as one list, never to an automatic
  fixer, and each is ruled: **fix now** (a new AC naming the one it
  supersedes, if any, approved, then back to executing — the re-run re-checks
  only the shapes the fix changed), **backlog** (a new item quoting the
  finding), or **leave as is** (the user's reason recorded, never raised
  again). There is no round cap. What the reviewer judges lives in the new
  `references/architecture-review.md`: five
  categories (API and interfaces, DB schema, boundaries, abstraction timing,
  system level), a pass one level up and a pass over recent history for drift,
  the unseen side of a boundary named rather than guessed, and line-level
  quality and tests left to the review rubric.

- **`review --architecture`** embeds `references/architecture-review.md` in
  place of `references/review-rubric.md` and scopes findings to the shapes the
  change adds or alters, on the same read-only `codex exec review` run. The
  Codex build's finishing step 2 uses it, handing the shape list, the item's
  design and acceptance criteria, recent history and prior rulings through
  `--context @<file>`, so that build's architecture review is independent too.

### Changed

- **How a message to the user is paced is now a law, not a habit.**
  `HARRY.md` §6 states it for prose addressed to the user: the conclusion
  first, one layer at a time and the next only when it is asked for, at most
  one new concept per message, and one question per message. The audience is
  a capable adult who has not read this codebase — competence assumed,
  context never.
- **One carve-out to the one-question rule.** Several rulings count as one
  question when each is an item on a list the user was already shown. A
  decision that was never shown that way costs a question of its own, even
  when it arrives in the same message.
- **The law splits by reader.** What another model reads — subagent briefs,
  review reports, commit messages — stays precision-first, and may coin no new
  concept name beyond the ones already defined in the laws, `references/` or
  `skills/`. A PR body is not one of those: the user approves the draft before
  the PR is opened and people read it afterwards, so it is written for them.
- **The technique lives in the new `references/plain-language.md`.** It holds
  the grounding rule — a concept is established before anything leans on it,
  and the unit is the concept, not the word for it — plus the two cognitive
  principles behind it, a worked before/after, a check to run before sending,
  and two levels of plainness.
- **New `/wait-what` — re-explain the last message once, in plainer words.**
  Shipped on both builds (`commands/wait-what.md` on Claude Code,
  `codex-skills/wait-what/SKILL.md` on Codex), both thin pointers to
  `references/plain-language.md`'s deeper level. It is one-shot and not a
  mode: it changes nothing about how later messages are written. A previous
  message that asked a question is re-asked plainer rather than answered, so
  the door never picks the side the user was being asked to pick.
- **Five terms the shipped prose never defined are gone from it.** `breaker`
  and `law-wiring` are gone outright; `premise check`, `flush` and `hoist`
  survive only where each is glossed or defined on the spot. A term a model
  has only this text to resolve is a silently misread instruction, not a style
  nit, so `tests/plain-language-contract.test.ts` now holds the line: the cut
  terms are scanned for across every shipped file, the survivors are allowed
  only in the files that define them, and the nine project terms that stayed
  (`tier`, `red line`, `squash`, `acceptance criteria`, `frontier`, `residue
  manifest`, `ledger`, `dispatch cap`, `scope tag`) each keep their defining
  sentence.
- **Grilling asks one question per round, and owns its own close.**
  `references/grilling.md` reverts the interview's cadence to one question at a
  time, waiting for the answer before the next — batching is now something the
  user asks for, never a default. The Codex-build fallback ("no
  AskUserQuestion, use numbered text rounds") is gone from `grilling.md` and
  `codex-skills/grill/SKILL.md`: a single question is asked the same way on
  both builds. The interview is stated as an explicit **loop** —
  interview → design → re-interview — with three termination conditions: no
  open questions (closed by answering or by the user's deferral); every
  silent assumption closed (confirmed fact, returned as an open question, or
  pinned by an AC — listing one is not closing it); and the destination did
  not move during the most recent pass. The interview keeps a running ledger
  (decided / open / deferred / assumptions), in-conversation and written to
  a file only on request. The close (the residue manifest read from that
  ledger, restated as acceptance criteria, and what the user's approval
  covers) now lives entirely in `references/grilling.md`.
  `skills/brainstorming/SKILL.md` cites the close instead of restating it,
  and states that tier controls the interview's depth, never its cadence.
- **An active `.local/` item is driven by acceptance criteria instead of a
  `## Plan`.** `## Why / What` ends with `### Acceptance criteria`: numbered
  `AC-1, AC-2, …`, each an outcome ("invalid input returns 400", never "add
  validate()") carrying its own verification — a command, a test, or a named
  manual check. `## Dispatch` is optional and exists only when 2+ units run in
  parallel (unit · AC covered · write set · cross-unit reads · lands first or
  last). `## Progress` is append-only, cites AC IDs and commit ranges, and is
  what a resumed session reads; approved AC text is never edited to record
  progress. An in-flight item that still carries a legacy `## Plan` is read
  as-is.
- **Review's spec verdict is per AC** — pass/fail/partial with evidence per
  criterion, so subagent reports, review verdicts and progress notes all cite
  the same IDs. A finding that conflicts with an AC goes to the human beside
  the AC text rather than being settled by an edit. An AC appended later may name one it
  supersedes; the superseded AC keeps its text and is judged by its successor
  (`superseded by AC-<m>` in the rubric's Assessment line, and in executing's
  pre-flight).
- **`brainstorming`** produces the AC at convergence and presents them in the
  User Review Gate together with the design and the residue manifest — one
  approval covers all three. It then runs a premise check at exit (base up to
  date, premises still hold; AC is built on premises and cannot catch a wrong
  one) and hands off to `executing` directly.
- **`executing`** works the AC list: briefs carry AC verbatim, reports and
  review verdicts cite AC IDs, and task completion, fix rounds and the
  breaker's rulings are appended to `## Progress`. It never edits an AC — one
  that is wrong, impossible or ambiguous stops and asks the user. Parallel
  dispatch reads `## Dispatch` when the item has one.

- **`/review` collapsed onto `codex exec review`.** The runtime command now
  spawns `codex exec review` directly as a separate, ephemeral, read-only
  process (`sandbox_mode="read-only"`), with a prompt built from the target
  diff, the full `references/review-rubric.md`, a `--context` background
  section, and a focus-text section — instead of running through harry's own
  Codex session driver. It never picks a model itself; `~/.codex/config.toml`
  decides, and `--reasoning` overrides effort for that one call. Surface is now
  `review [--base <ref>] [--reasoning <low|medium|high|xhigh>] [--context
  <text|@file|@->] [focus text...]`. Each run writes its findings to its own
  `codex-review-<YYYYMMDD-HHMMSS>.md` (under the main checkout's
  `.local/tmp/<branch>/` when present, else the plugin state dir), so a
  re-review never overwrites an earlier round; the CLI prints them to stdout
  and names the file on a `Review written to <path>` stderr line. codex's
  session transcript goes to a matching `.log`, not the terminal. Failure is
  explicit — non-zero exit, the error lines from the end of codex's log plus
  its path, no fallback.
- `commands/review.md` no longer sets `disable-model-invocation`, so both the
  `SlashCommand`/`Skill` tools and `skills/executing`'s final review step can
  invoke it directly. Read-only is enforced by codex's `sandbox_mode="read-only"`
  on the spawned run; the command's `allowed-tools` only pre-approves the review
  invocation, read-only `git status`/`git diff`, and `Read` — it does not block
  other tools.
- `skills/executing/SKILL.md` step 6's Codex lane now writes a facts-only
  context file (the unit's binding constraints and rulings so far, with their
  reasoning — never verdicts or "don't flag X") and invokes `/harry:review
  --base <base-branch> --context @<file>` instead of hand-rolling its own
  `codex exec review` call. A lane failure is now blocking: it's recorded
  verbatim and taken to the user, not silently skipped in favor of the CC lane
  alone.
- **`/harry:ask` collapsed onto `codex exec` too.** It now spawns
  `codex exec --ephemeral -s read-only --skip-git-repo-check -o <file> [-c
  model_reasoning_effort="<v>"] -` with the prompt on stdin, the same shape as
  `review`, instead of running through harry's own in-process Codex session.
  Read-only now means the model may read files and run read-only commands
  under Codex's read-only sandbox (previously `ask` had no filesystem, shell,
  or URL access at all — the vendored session gave it none). It never picks a
  model itself; `~/.codex/config.toml` decides, and `--reasoning` overrides
  effort for that one call. Surface is now `ask "<prompt>" [--reasoning
  <low|medium|high|xhigh>] [--context <text|@file|@->]`. On success the answer
  prints verbatim to stdout and stderr ends with `Log: <path>`; on failure
  stdout's first line is `# Ask Failed` followed by a reason line, the exit
  is non-zero, and — when codex ran — stderr carries the error lines from the
  end of codex's log plus `Log: <path>`.
  `--context` follows the same facts-never-verdicts rule as `review`'s.
  Every ask prompt opens with a fixed preamble framing the model as one
  independent voice: answer from the prompt and any Background, do not explore
  the working directory or run commands unless the prompt asks about files in
  it, be concrete and decisive, and state key assumptions and the strongest
  counter-argument.
- Standalone `ask`'s default reasoning effort is now the Codex config's
  (`~/.codex/config.toml`); it was hard-coded to `high`. `/debate`'s gpt voice
  passes `--reasoning high` explicitly, so it is unchanged.
- A failed `ask` run reports its reason on stderr once, as `Ask failed:
  <reason>`, and no longer also prints `Fatal error: <reason>`. `Fatal error:`
  now means only an argument error caught before `ask` runs.
- `setup --json` fields changed: `availabilityDetail` and `authMethod` are
  removed, and `version` (the `codex-cli` version, or `null` when unavailable)
  is added. `setup` now reads `codex --version` and `codex login status`.
- The Codex role map (`references/codex-role-mapping.md`, inlined into
  `~/.codex/AGENTS.md` by `/sync`) binds the security row and judgment-heavy
  work to `gpt-5.6-luna` instead of `gpt-5.6-sol`, which a ChatGPT login
  rejects with a 400. Re-run `/sync` on the Codex build to pick it up.

- **Finishing's cleanup and PR path, tightened.** The three rescue choices for
  a worktree that refuses removal are separate sub-bullets; a rescue branch is
  cut from `origin/<base>` after a fetch (a local base can be stale there) and
  is named in the completion report and the quick-reference table; moving
  files into the main checkout checks for name collisions first; ignored files
  are listed to the user before removal, since `-uall` does not show them;
  step f.3 names `f.1`/`f.2` instead of an ambiguous "step 2"; and Option 2's
  In-flight annotation uses the main checkout's `.local/` from inside the
  worktree. A commit answering PR feedback re-runs step 2's shape gate before
  it is pushed, so a shape changed during PR iteration is reviewed too.
- **Executing and the review rubric name their modes.** The round-4 cap names
  subagent mode; step 6 hands the rubric itself, as step 3 does; steps 3 and 6
  point at the Codex-build reviewer carve-out; the tmp dir's `mkdir -p` runs in
  the steps that write there, not at every tier. The rubric's handoff list
  covers session mode as well as subagent mode, and it states that on the Codex
  build the rubric `review` embeds is what binds the single review lane.
  `references/tier-gates.md`'s red-line gate names the Codex lane only where
  the build has one.
- **A unit that builds against another unit's unwritten interface is not
  parallel with it.** `## Dispatch` gains no interfaces column; such a unit is
  dispatched after the one it depends on lands.
- **`/wait-what` keeps a question's recommended answer.** Re-asking a question
  plainer restates the recommendation it carried (grilling has every question
  carry one) rather than dropping it; it still never answers for the reader.
- **Grilling's loop, defined.** A pass is one interview → design → re-interview
  trip; termination condition 3 also fails when an answer moved the destination
  after the most recent design pass; and the two scope tags are applied when a
  line is deferred, so a folded-in expansion is not read back as a follow-up.
- `references/plain-language.md` cites HARRY.md §6's carve-out instead of
  restating it, splits its preamble, and its worked example now demonstrates one
  layer per message. `references/sync-migration.md`'s step heading no longer
  promises two questions when one is asked. `references/distilling.md` checks
  `historical_sources` before adding a re-ported upstream, and
  `references/upstream-sync.md` matches `upstream.json` on re-comparing a
  retired upstream (on demand only).
- **The eval runner authenticates with exactly one explicit credential**:
  `EVALS_ANTHROPIC_API_KEY` (a console API key, handed to the child as
  `ANTHROPIC_API_KEY`) or `EVALS_CLAUDE_CODE_OAUTH_TOKEN` (a subscription
  token from `claude setup-token`, handed over as `CLAUDE_CODE_OAUTH_TOKEN`).
  Both set, or neither, refuses before any config dir exists, with a message
  naming both variables and `claude setup-token` and carrying no value; an
  empty or whitespace-only value counts as unset, and a value containing a
  carriage return is refused. `evals/README.md` shows how to pass either
  from a mode-0600 file so it is never echoed.
- **Every process the eval runner spawns gets an allowlisted environment**,
  built key by key instead of copied from the shell and stripped: `PATH`
  (the running node's directory first, absolute entries only), `HOME`,
  `TMPDIR` (the runner's own), `LANG`/`LC_*`, `USER`, `LOGNAME`, `SHELL` and
  `TERM`, plus proxy and CA variables only with `EVALS_FORWARD_PROXY=1`. git
  and the `claude` child add a pinned identity with no global or system git
  config; only the `claude` child adds its config dir and its one
  credential. A bare `ANTHROPIC_API_KEY`, the `EVALS_` variables,
  `NODE_OPTIONS`, `SSH_AUTH_SOCK` and every other `ANTHROPIC_*` or
  `CLAUDE_CODE_*` variable no longer reach any child. Several of those
  outrank `CLAUDE_CODE_OAUTH_TOKEN` in Claude Code, so one left in the shell
  could silently replace the credential the run chose. Since the operator's
  own privacy flags no longer reach it either, the `claude` child always gets
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1` and
  `DISABLE_AUTOUPDATER=1`.
- **CI reads the pnpm version from `packageManager`** instead of a second copy
  in the workflow.
- **CI runs on macOS as well as Linux**, so the eval runner's seatbelt-jail
  tests (macOS-only) run in CI too.

- **Worktree isolation follows concurrent writers, not tier** (`HARRY.md`
  §5). Two or more writers at once — parallel subagents, several efforts in
  flight, the user editing alongside — each get a worktree, cut from the unit's
  branch rather than the default branch; a single session working sequentially
  takes a fresh branch in place at any tier. `executing` and
  `references/tier-gates.md` say the same. A parallel task keeps its worktree
  through its review and fix rounds, then integrates there before it is
  marked complete: the unit branch is merged into it and the suite runs in
  the worktree; a red suite goes back into the task's fix loop (inside its
  write set, and to the user rather than adjudicated at the cap), and only a
  green tree fast-forwards the unit branch, after which `executing` removes
  the worktree and branch. Conflict resolutions made at integration are
  recorded and reviewed by name at the final review. While any parallel task
  is in flight, every task gets its own worktree, so nothing writes in the
  unit branch's checkout when it fast-forwards. So `finishing` only
  ever handles the unit's own checkout: a linked worktree or, for a branch in
  place, none.
  Discard checks the main checkout is still on the unit's branch before
  touching it, and has the user name any parallel worktree left
  mid-execution rather than guessing.

### Fixed

- **A sandboxed agentic session could act outside the eval runner's jail
  through the runner's own post-session work.** After the session, the
  runner ran the fixture's tests (written by the session) and its own `git`
  calls unjailed, with its full environment. A session could plant a
  command in `.git/config` (`core.fsmonitor`, or `log.showSignature` with a
  `gpg.program`) for that `git` to run, or swap its fixture for a symlink to
  another repo, whose config the runner would then rewrite. Everything the
  runner does on session-controlled paths after a sandboxed session (check
  the fixture is still the directory it created, restore the `.git/config`
  it wrote at materialization, collect the repo state, evaluate every check)
  now runs as one child under the session's own jail profile, with the
  credential-free allowlisted environment. The runner accepts only one
  `{ ok, detail }` per check from that child, sanitized and capped. The trial
  is refused, not judged, if the fixture path leads elsewhere, `.git` is no
  longer a plain directory, the session added `.git/commondir` or
  `.git/config.worktree`, or `.git/config` is no longer a regular file.
  Unsandboxed the same step runs in the runner itself; there the session
  already ran as the operator, so the checks guard against accidents, not
  attacks. The step is bounded by a timeout (5 minutes), so a hung
  model-written test no longer hangs the run.
- **A sandboxed session could write outside the eval runner's jail and have
  the runner run it later.** The seatbelt profile allowed every write outside
  `$HOME`, including user-writable `PATH` directories such as Homebrew's
  `bin`, and the runner later spawned `git`, `which` and `claude` by name,
  unjailed. The config dir, work dir and fixtures' parent were also shared
  across a run and writable from the jail. Now:
  - writes are allowed only to the trial's own config dir, fixture repo
    and temp dir (plus `/dev/null`), and reads under `$HOME` stay denied
    (the profile is now deny-by-default; see the next entry);
  - `git`, `claude` and `sandbox-exec` are resolved to absolute paths before
    the first session and spawned by those paths from then on (`which` is no
    longer run);
  - every trial gets its own config, work, fixture and temp dirs, recorded on
    each result line as `trialDir`.
- **A sandboxed session could have a system service start a program outside
  the eval runner's jail.** The seatbelt profile started from
  `(allow default)` and denied only file writes and reads under `$HOME`, so
  IPC to system services stayed open. A jailed session could write an app
  into its own temp dir and `open` it: LaunchServices then started it as
  the operator, outside the jail (reproduced on macOS 27). The profile now
  starts from `(deny default)` and allows back only fork, signals within
  the jail and sysctl reads; exec from `/bin`, `/usr/bin` and the resolved
  `node`, `claude` and `git` install trees; reads outside `$HOME` (a
  terminal excepted, see the next entry) plus the trial dirs, runtime
  trees and the runner script under it; writes to the trial's own dirs and `/dev/null`; one
  system service by name (user lookup); and outbound IP plus the DNS
  resolver's socket. A test compares the whole generated profile to fixed
  text, so any rule change, an added service included, is a test edit.
  LaunchServices and Apple Events need mach-lookup names the profile denies;
  launchd does not: `launchctl` reaches it over the task's bootstrap port
  instead, so the profile does not gate it. launchd refuses submission but starts
  an already-loaded job on `kickstart` and persists a `disable`, both outside
  the jail — recorded, with its ceiling and upgrade path, in the `DEBT:` note
  on `buildSeatbeltProfile`. Outbound IP includes localhost, so a local TCP
  service that runs commands on request still acts for the session. A darwin
  test pins that a jailed `open` and `launchctl submit` both exit nonzero and
  launch nothing. The allowlist was derived with the fake `claude` shim,
  the real `claude --version` and a `node` HTTPS request; a live sandboxed
  session has not been run against it yet. When one needs more, the
  evals README says how to read the denied name from the unified log,
  narrowed to the run's time window rather than to a few process names.
- **A sandboxed session could read what the operator typed into the
  terminal.** The eval runner's jail allowed file reads of `/dev/tty` and
  the pty devices, and its children share the runner's terminal, so a
  jailed session or post-session step could read keystrokes typed during a
  run and send them out over the network. The profile's last rule now
  denies reading `/dev/tty` and `/dev/ttysN`; a darwin test runs a reader
  in a real pty and pins that both opens are refused. The deny acts only
  when a terminal is opened, so no spawned child is handed it either: fds
  0, 1 and 2 are piped or `/dev/null` at every spawn. A second darwin test
  runs the runner in a real pty, jailed and not, and pins from inside each
  spawned process that the session, the post-session step and the
  model-written test command hold the terminal on none of them, nor do the
  runner's own git calls wherever `PATH` can shadow git (not when git sits
  next to `node`).
- **The eval runner's jail blocked Homebrew git's own helpers.** The jail
  lets a process run git's install tree, found from `git --exec-path`.
  Homebrew's git reports that path through its `opt` symlink
  (`/opt/homebrew/opt/git/...`). Seatbelt matches the real path behind the
  symlink (`Cellar/git/<version>/...`), so those rules never matched and git's
  non-builtin helpers could not run under the jail. The exec path is now
  resolved to its real path first. This lets the jail run exactly the git
  install it was meant to allow, nothing more. A test pins this with a
  symlinked git prefix, both in the generated profile and under the real
  `sandbox-exec`.
- **A child's output could write terminal escape sequences to the operator's
  terminal.** Every child the eval runner spawns now has its stdout and
  stderr piped, and what reaches the operator (error messages, result lines)
  has control characters stripped.

- **A reviewed repository could run its own `./codex` or `./git`.** On
  macOS/Linux the companion spawned both by bare name, and an empty or
  relative `PATH` entry (`:/usr/bin`, `/usr/bin:`, `a::b`, `.`) makes the OS
  search the current directory — the repository under review. Both are now
  resolved to an absolute path from absolute `PATH` entries only; an unset
  `PATH` counts as not found.
- **A failed `review` or `ask` run no longer prints codex's session
  transcript.** codex's log can hold the output of commands codex ran and the
  contents of files it read (a `.env`, say), and stderr is usually read back
  by a calling model — so a failure now prints only the error lines from the
  end of codex's log (those starting `ERROR:`, `Error:` or `error:` at the
  start of the line), or `No error line at the end of codex's log.` when there
  is none. The full transcript stays on disk at the reported `Log: <path>` for
  a human to read. `ask`'s `# Ask Failed` reason line is codex's last `ERROR:`
  line when codex exits non-zero and the log's end has one; otherwise (including
  an exit-0 run that wrote no answer) it is the companion's own failure message.
- Every error line a failure prints — on stderr, or as `ask`'s reason line —
  is capped at 1000 bytes, ending in `…[truncated]` when cut, so one runaway
  line can't flood the caller either. Control characters (other than tab) are
  stripped from it, so no terminal escape sequence reaches the caller, and a
  lone carriage return ends a line, so a line redrawn in place can't carry a
  transcript line onto an error line.
- The run log is created owner-only (0600), and the `-o` output file (the
  review or the answer) is narrowed to owner-only once codex has run, whether
  the run succeeded or failed — both can otherwise be created world- or
  group-readable by the process umask.
- A spawn error (codex missing or not executable) now removes the reserved
  log when it is empty, instead of leaving an empty file with nothing to name
  it; a spawn error that did write to the log is kept and reported as before.
- An `EPIPE` from codex exiting before it read its prompt (the CLI rejecting
  its own arguments) is now reported as an ordinary exit failure with codex's
  error line, instead of surfacing the bare `EPIPE`.

- **The Codex build's skill commands ran `/dist/companion.cjs`.** Codex does
  not set `${CLAUDE_PLUGIN_ROOT}` in a skill's shell, so every command in
  `codex-skills/` resolved against `/`. Each skill now derives the plugin root
  from its own path first; `ask` and `review` were run end to end in a live
  Codex session.
- `review --base ""` / `--context ""` (for example an unset variable) is
  rejected instead of silently reviewing a different target or dropping the
  context; `ask --context ""` is rejected the same way.
- Killing the companion (SIGTERM, SIGINT or SIGHUP — a tool timeout, say) now
  stops the `codex` run it started instead of leaving it running.
- A failed run whose output file cannot be narrowed to owner-only reports
  codex's own failure and `Log:` line first, then the narrowing error, instead
  of replacing the cause.
- `ask`'s run files older than 7 days are pruned on each run, so the state
  directory no longer grows without bound.

### Removed

- **Windows support.** The companion supports macOS and Linux only: its
  Windows `codex` resolution and `.cmd` shim spawning, and the Windows CI job,
  are gone. On Windows it now exits with a clear "not supported" error instead
  of running.
- **The `writing-plans` pipeline stage is gone.** The pipeline is now
  `brainstorm → execute → finish` (grilling happens inside brainstorming), and
  `skills/writing-plans/` is deleted. By the time a plan was written the
  decisions were already settled, so it mostly transcribed `## Why / What`; its
  two parts that earned their place — the parallel split and the after-the-fact
  record — survive as `## Dispatch` and `## Progress`.
- `--adversarial`, `--simplify`, `--full`, `--fix`, `--harry-fix`, `--scope`,
  `--wait`, `--background`, `--model`, and `--timeout` on `review` — the CLI
  now rejects each by name.
- The `fix` command and both apply backends (`--fix` Claude-applies, `--harry-fix`
  isolated Codex fix session), the structured-findings envelope, the simplify
  dual-lane, and `--full` mode. `references/review-orchestration.md` (the
  shared definitions those modes pointed at) is deleted.
- The `standard` and `adversarial` Codex model roles and their
  `HARRY_MODEL_STANDARD` / `HARRY_MODEL_ADVERSARIAL` overrides (added in 0.18.0).
  Nothing reads them any more — `review` passes no model — so setting either now
  does nothing.
- **`--model` and `--timeout` on `ask`**, and the `HARRY_MODEL_JUDGMENT`
  override that used to set `ask`/`/debate`'s gpt voice's default model. `ask`
  passes no model any more — `~/.codex/config.toml` decides — and the
  `codex exec` process it spawns has no timeout of harry's own to configure.
- **`/harry:status`.** It only ever showed a Codex rate-limit snapshot that
  the deleted vendored session recorded after each `ask` turn; there is no
  source left for that snapshot. `commands/status.md` and
  `codex-skills/status/` are deleted.
- **The vendored in-process Codex runtime** (`src/lib/codex/` — app-server,
  process, protocol, turn, auth — and its test fixture
  `tests/fake-codex.mjs`), ported and modified from `codex-plugin-cc`. Both
  `ask` and `review` now spawn the `codex` CLI directly instead of driving it
  as an in-process session; the `NOTICE` file's Apache-2.0 section for that
  runtime is removed along with it (the remaining Apache-2.0 attribution,
  for `references/skill-authoring.md`, stays). `codex-plugin-cc` is retired
  from `upstream.json`'s pinned `sources` to `historical_sources` (attribution
  only, not synced) — harry now pins three upstreams instead of four.
- **The eval runner's seeded-credential fallback.** With no API key set, it
  copied `.credentials.json` from the operator's config dir into each
  condition dir, checked the copy up front, and scrubbed it after the run.
  On macOS that file is a snapshot of a Keychain login that goes stale on its
  own schedule, so runs failed with an expired token; and copying real
  credentials into temp dirs was a liability however promptly they were
  scrubbed. No credential file is written anywhere now.

## [0.21.0] - 2026-09-02

### Added

- **`/release` command** (repo-local, `.claude/commands/release.md` — not shipped in the
  plugin) automates cutting a harry release: bump the four version fields, draft and
  approve a CHANGELOG entry, rebuild `dist/`, verify, commit, then (after the merge lands
  on `main`, since this repo's tags land on the merge commit) re-verify, tag, and push.
  State detection (`.claude/scripts/release-state.mjs`) is resumable across that merge
  boundary rather than assuming a fixed invocation order — this release was cut with it.

### Fixed

- `tests/prose-refs.test.ts`'s drift guard now scans `.claude/commands` and recognizes
  `.claude/scripts/…` path mentions, and its file-extension whitelist now includes `.mts`
  (closing a second gap — `.d.mts` references were never checked at all). A follow-up
  review round fixed a lookbehind that would have matched a home-relative `~/.claude/...`
  mention and failed the guard on an innocent future docs edit.

## [0.20.0] - 2026-09-02

### Added

- **§5 "Running systems: state the blast radius before touching them."** Before any
  command that stops, disables, deletes, or reconfigures a running service: state the
  exact command, what breaks if it is wrong, the exact rollback command, and, when the
  change swaps one service for another, whether the replacement is registered and
  verified healthy — then wait for the go-ahead. Read-only diagnostics need none of this.
  Distilled from a review of 21 sessions across 11 repos.
- **§5 "Secrets stay out of the transcript."** Reading dotfiles, `.env`, shell rc files,
  or anything that may hold credentials: never read the file whole — route it through a
  command that prints variable names only or masks the values (`sed 's/=.*/=***/'`); the
  user asking for a specific value is the exception (§0). Motivating incident: a grep of
  a shell env file put a GitHub PAT and an OpenAI key into the transcript; both had to be
  rotated.
- **§6 "Root cause before any fix"** now requires a proposed fix to list its side-effect
  flags — every setting it flips beyond the one it targets. Motivating incident: a
  password reset that also set `shouldChangePassword=true` created the next bug.

## [0.19.0] - 2026-09-01

### Added

- **HARRY.md §6 forbids fabricated remediations.** "Talk like an engineer" now bars
  inventing a remediation, job, follow-up, or capability that was not discussed or does not
  exist — in a PR comment, Slack message, or Jira update as much as in code. Closes a gap
  where neither "Honesty & evidence" (completion claims only) nor "Talk like an engineer"
  (tone) covered a fabricated suggestion in drafted external comms: a PR-comment draft
  invented a nonexistent "periodic non-gating job" as a remediation, which had to be
  manually removed before publishing.

## [0.18.0] - 2026-08-08

### Added

- **`HARRY_MODEL_STANDARD` / `HARRY_MODEL_ADVERSARIAL` / `HARRY_MODEL_JUDGMENT`** — set the
  model each Codex path uses, once, instead of passing `--model` on every invocation.
  This matters if your login cannot reach a default: a ChatGPT login **without an OpenAI
  subscription** is refused `gpt-5.6-sol` with a hard 400 (probed 2026-08-08; `gpt-5.6-terra`
  and `gpt-5.6-luna` answer), which left `ask`, `fix` and `review --adversarial` with no
  working path at all. The shipped defaults are unchanged — downgrading them on one
  account's evidence would degrade every account that is not that one — and `--model` still
  wins per invocation. Deliberately read only from harry's own variables, not from
  `~/.codex/config.toml`'s `model`: yielding to that would put a judgment task back on
  whatever you last set for an unrelated session.

### Fixed

- **`/harry:status` reports something.** It could not, ever: harry listened for a
  `token_count` notification that codex 0.144.4 no longer sends. That version splits it in
  two — `thread/tokenUsage/updated` and `account/rateLimits/updated` — and renamed every
  field on the way (snake_case to camelCase, usage nested under `tokenUsage.last`,
  `resets_at` moved onto `primary` *and* changed from an ISO string to epoch seconds). So no
  rate-limit snapshot was ever written and `status` could only print "run a review, ask, or
  fix first", which did not help. Both protocol generations are now handled, since a shipped
  plugin cannot know which codex you run.
- Job logs and the run footer report real token counts instead of `tokens(in/out)=?/?`,
  from the same fix.
- A Codex-side failure names the model and the reason it was refused, rather than being
  flattened into "the model returned an empty answer" (shipped in 0.17.0, and the first
  thing that made the above diagnosable).

### Changed

- `/harry:status` labels a quota window by its **duration** — `30-day 5% used` — instead of
  codex's wire slot name (`primary 5% used`), which named a field rather than telling you
  anything. The slot name still appears for a snapshot taken through the legacy protocol,
  where codex reports no duration and the name is the only distinguishing thing left.
- **`CLAUDE.local.md` is no longer part of the repo.** It had been listed in `.gitignore`
  from the start but was also committed, and git does not apply an ignore to an
  already-tracked path — so the entry was a no-op and one repo's personal rules shipped to
  everyone who cloned. It is now untracked; your own copy is untouched.
- The docs no longer state that a subscribed or company account can reach `gpt-5.6-sol`.
  Only an unsubscribed account has been probed, so its status elsewhere is unverified in
  both directions.

### Internal

- The behavioral evals were recalibrated after their recorded numbers were shown not to
  reproduce — a control run of the byte-identical previous release scored the same as the
  new one, so the probe had drifted, not the laws. Result lines now record the law text's
  hash, and `score` flags a group whose trials span two of them.
- Six eval cases judged only by what was ABSENT, so an empty or error reply scored as
  compliant; each now carries a positivity floor, and two guards keep it that way (every
  case must have a positive check; a degenerate corpus must fail every text case).
- New drift guard: a model id named in shipped prose must be one the code actually pins.

## [0.17.0] - 2026-07-30

### Changed

- **The resident laws are ~38% shorter (18.6 KB → 11.4 KB), and this changes what lands in
  your global `CLAUDE.md` on the next `/harry:sync`.** No law was repealed; what left the
  always-loaded layer was mechanism that already had an authoritative home — the dispatch
  cap and role wiring (the executing skill's Model-by-role paragraph and
  `references/codex-role-mapping.md`), the `.local/` item format and In-flight/HISTORY
  bookkeeping (`references/doc-types.md`), and accumulated exemption prose. Anthropic's
  own guidance for this model generation prompted it: Claude Code's system prompt was cut
  by over 80% with no measured loss, the Claude 5 prompting docs warn that instructions
  written for prior models are "often too prescriptive… and can degrade output quality",
  and the Claude Code docs target under 200 lines per `CLAUDE.md` because a bloated file
  loses adherence. One behavior change is deliberate: §6's reply-hygiene rules are one line
  instead of a checklist — and they stay resident rather than moving to a skill because the
  same text also serves the Codex build, which has no Claude harness enforcing them.
  §3's tier-declaration sentence, by contrast, is kept **verbatim**: the behavioral evals
  measured two independent rewrites of it at 0/3 where the original scores 3/3, so its exact
  scoping — not its gist — is what makes a one-shot reply state its tier at all.
- Doors no longer restate rules their references own (`grill`, `distill`, `review`,
  `audit` on both builds). One of those duplicates had already drifted: the Codex `review`
  door was missing the `# Review Failed` branch its own full-mode path checks for, so a
  single-review failure went unreported there.
- `references/review-orchestration.md` now carries one definition of the single-review +
  fix flow instead of two that had diverged, and its per-build labels are applied only
  where following the wrong build's wording would change what you do.
- `upstream.json`'s `debate` row now names what harry actually ships
  (`opus`/`gpt-5.6-sol`/`gemini-3.1-pro`) rather than a stale model set.

### Fixed

- **A Codex-side failure now says why.** `ask`, `review`, and `fix` reported only that
  something "did not complete successfully", so an upstream rejection — e.g. `The
  'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account` — was
  indistinguishable from a model that genuinely returned nothing; the cause reached the job
  log and stopped there. The neutral result type now carries it and all three commands
  frame it, bounded at 4 KB (tail-cut, and it says when it cut) so a hung turn's child
  stderr cannot flood the reply the doors return verbatim.
- `review`'s inline byte cap now measures untracked file **bodies**, which the inline path
  emitted while the cap ignored them (~48 KB unmeasured at defaults). Working trees that
  inlined before may now self-collect — the honest behavior, and the reason this is called
  out rather than filed as internal.
- `truncateUtf8` no longer returns more bytes than its cap, nor injects a replacement
  character the input never had, when a cut lands mid-character.
- A turn cancelled before it starts no longer spawns a `codex` child, no longer waits out
  the 60-second connect timeout, and reports the abort instead of an initialize timeout.

### Added

- Drift guards for the prose that ships as product: a door may name its reference but must
  not carry its prose (closing a hole that was invisible on all eight door pairs); the
  reference graph is followed transitively, so `/audit`'s companion files are guarded
  rather than only the hub that cites them; `§N` is enforced to mean `HARRY.md` by the
  corpus rather than assumed by the checker; and a `See **Heading** in <ref>` pointer must
  resolve to a heading that exists.
- End-to-end coverage where a passing test previously proved less than it looked like:
  `status --json` (its old test drove the flag allow-list, one layer below the behavior),
  `review`'s failure path (it had none), and `fix`'s cause reporting. 239 → 276 tests.

## [0.16.0] - 2026-07-28

### Removed

- **`/harry:result` removed from both builds.** No release ever shipped a way to produce
  the job it was meant to retrieve — `--background` was never wired to the node CLI on any
  version, so the command could only ever report "No completed jobs found." `/harry:status`
  no longer reports job state either; it now covers only the Codex rate-limit snapshot it
  already showed. The node CLI's `--background` and `_worker` are removed with them.
  `/harry:review`'s own `--background` flag, which hands the run to the harness's native
  backgrounding, is unchanged and unaffected.

### Changed

- `/harry:ask` now signals failure instead of returning a possibly-truncated answer with no
  way to tell it apart from a complete one: a timed-out or incomplete run prints `# Ask
  Failed` as the first line of its answer, an `Ask failed:` line on stderr, and exits
  non-zero. Both doors also stop telling callers to check a `status` field that never
  existed, and instead point at these real signals.
- `/harry:debate`'s gpt voice gains the same failure handling its gemini voice already had,
  and now runs in the background so a long, high-effort turn is no longer killed by a
  ten-minute foreground timeout.
- `/harry:sync`, `/harry:debt`, and `/harry:review` behave the same as before from the
  outside; the Codex build's `/debt` gained six judgment steps that the Claude Code door
  already had, closing a gap between the two builds.

### Fixed

- A failed `git` invocation (e.g. a missing binary) no longer reports success; a failed
  staged-diff collection during `/harry:fix` no longer reports zero changes instead of
  flagging the stats as unavailable; and a temporary file used while writing state can no
  longer collide with another write in progress.

## [0.15.0] - 2026-07-27

### Added

- Red-line drift guard (`tests/redline-drift.test.ts`): nine wording-tolerant
  probes lock the promotion-trigger domains across HARRY.md §2 and
  `references/tier-gates.md`, with per-region count locks.
- Distilled references (from the mattpocock/skills survey): the loop-first
  debugging gate in `references/root-cause-tracing.md` (no theory before a
  tight, red-capable, one-command loop), editorial skill vocabulary in
  `references/skill-authoring.md` (context/cognitive load, leading words,
  no-op test, negation warning), a throwaway-prototype decision aid in the
  brainstorming skill, and seam pre-agreement in `references/red-green.md`.
- `residue-manifest` informative eval case, live-calibrated (12 sessions,
  both conditions fully compliant — recorded as permanently informative).

### Fixed

- Evals fixture repos pin a local git identity, so agentic sessions can
  commit on machines with no global git config (first-CI-run failure on
  ubuntu runners); the regression guard is now deterministic on every
  platform and the test git helper gains gpgsign/hooks hardening.

## [0.14.0] - 2026-07-26

### Added

- Behavioral-evals harness (`scripts/run-evals.mjs` + `evals/`): baseline-vs-candidate
  law-adherence probes with a pinned model, `--trials` strict-majority scoring, an
  informative-vs-graded case split, agentic fixture cases with artifact checks,
  credential seeding/scrub, and an opt-in `EVALS_SANDBOX=1` macOS seatbelt jail.
- Durable role agents (`agents/`): `scout`, `mech`, `writer`, `security` bind
  model+effort once in frontmatter so predictable work self-routes (HARRY.md §5);
  `references/codex-role-mapping.md` ships the advisory Codex twin, inlined into
  `~/.codex/AGENTS.md` by the Codex law install.
- Grilling interview subsystem: `references/grilling.md` (decision-tree dependency
  order, facts-vs-decisions, destination pinning, live scope labeling,
  divergence/convergence phases, residue-manifest exit gate), the `/grill` command
  and its Codex skill twin, and brainstorming's residue-manifest approval gates
  (full for Major, lite for Standard).
- Drift guards: `tests/role-mapping-drift.test.ts` locks the role set across
  HARRY.md, `agents/`, and the Codex role map, plus CC↔Codex command/skill
  reference-path parity.

### Changed

- HARRY.md laws: harness-priority layer (§0), pre-send check and tightened evidence
  discipline (§6), lawful-exit declaration regime (§7), role routing by nature (§5),
  out-loud tier declaration (§3), the unified 9-trigger red-line list with
  design-gate scaling (§2), a user-declared-only incident lane, and the `.local/`
  main-checkout resolution rule; `references/tier-gates.md` aligned.
- Pipeline skills: executing gains a frontier-review fallback, per-task worktree
  mechanics, and a genuine-ambiguity stop rule; finishing gains the PR wind-down and
  discard-disposition tails; writing-plans settles item ownership with the new
  brainstorming residue flow.

## [0.13.4] - 2026-07-22

### Fixed

- `/review --full` dropped the CC `/code-review max` lane it could never
  actually reach: `/code-review` sets `disable-model-invocation`, which blocks
  both the `SlashCommand` and `Skill` tools from invoking it programmatically,
  in any project, on either build. `--full` now runs the three lanes that can
  actually execute (adversarial + simplify dual-lane), matching what the
  Codex build already did for the same underlying reason. `CLAUDE.md`'s
  Codex-compat notes are corrected to match.

## [0.13.3] - 2026-07-16

### Changed

- `scripts/init.mjs` (the `.gitignore` initializer) no longer wraps its entries
  in a `# >>> harry >>>` … `# <<< harry <<<` marker block. `.gitignore` is a
  team-shared, git-tracked file, and the harry branding there confused
  teammates who don't use the plugin. It now just checks each of the three
  entries (`.local/`, `*worktrees/`, `CLAUDE.local.md`) for an exact-match line
  anywhere in the file and appends whatever is missing — plain ignore rules,
  no tool-name comment. Trade-off: `--remove` now strips any line that exactly
  matches one of those three entries, even one the user typed in by hand,
  since there is no marker left to distinguish origin. The global-file
  installers (`install.mjs` for `~/.claude/CLAUDE.md`, `install-codex.mjs` for
  `~/.codex/AGENTS.md`) are unaffected — those files are per-machine, not
  shared with a team, so the marker block stays there.

## [0.13.2] - 2026-07-16

### Changed

- `HARRY.md` §5: recon/lookup routing to `scout` now explicitly covers read-only
  git inspection (`log`/`diff`/`status`/`show`/`blame`) and grep/find-type searches
  when dispatched to a subagent.

### Removed

- `HARRY.md` §5: the `Commits:` rule mandating a `Co-Authored-By: Claude ...`
  trailer on AI-assisted commits. The harness already appends this trailer by
  default, so the explicit rule was redundant.

## [0.13.1] - 2026-07-15

### Removed

- The experimental `codex-agents/*.toml` role agents, **verified non-functional
  against Codex CLI 0.144.4**. Codex has no per-subagent model/effort mechanism: its
  CLI exposes no subagent dispatch, its plugin `agents/` are frontmatter-less
  persona/interface cards (no `model`/`effort`), and model/effort is session-level
  (config profiles). They were authored from web docs that don't match the shipping
  Codex, so they never routed anything — removed rather than left as dead weight.

### Changed

- The durable model+effort role routing is documented as **Claude Code only**.
  On the Codex build, HARRY.md §5 (inlined into `~/.codex/AGENTS.md`) routes by task
  *nature* at the session model — there is no cheap-tier role to bind. `tests/agents.test.ts`
  is now Claude-Code-only.

## [0.13.0] - 2026-07-15

### Added

- **Durable model+effort routing via role agents.** Four subagents — `scout`
  (recon, haiku), `mech` (mechanical edits, sonnet), `writer` (prose/docs,
  sonnet · medium effort), and `security` (security-sensitive, opus · high
  effort) — each bind their model and reasoning effort once in frontmatter, so
  predictable work self-routes to the right tier instead of being named at every
  dispatch. They ship for both builds: Claude Code reads `agents/*.md` (dispatched
  as `harry:scout` … `harry:security`), and the Codex build carries the same roles
  as `codex-agents/*.toml` (effort-only, since Codex has a single frontier tier).
  A new test guards the frontmatter invariants (alias models only, read-only recon,
  leaf writing roles) and keeps the two builds' role sets from drifting apart.
- **Opt-in Explore override (`/harry:sync --explore`).** Installs a user-level
  `~/.claude/agents/Explore.md` that pins the built-in Explore agent to a fast,
  cheap model, so auto-invoked searches don't inherit an expensive main-session
  model. It carries a marker line, so `--remove` only ever deletes harry's own
  copy — never a hand-written Explore.

### Changed

- **HARRY.md §5 routing rule** flips from "specify a `model` at every subagent
  dispatch" to "route predictable work to a role (which owns its model+effort);
  specify `model`/`effort` inline only for ad-hoc judgment work." The executing
  skill routes the same way.

## [0.12.0] - 2026-07-12

### Added

- **New law: "Optimize on evidence, never on imagination" (HARRY.md §1)** —
  the performance-axis counterpart to YAGNI that the law set was missing. No
  cache/index/memoization/micro-optimization/clever rewrite without a
  profile or benchmark naming *this* path on a *real* workload; "should be
  faster" is a §6 banned claim. The simple version is the default, carrying a
  §4 `DEBT:` ceiling when one is worth naming. Three explicit carve-outs keep
  it from forbidding legitimate perf work: design-time scale decisions (data
  model, asymptotic class, round-trip/query shape against a *known* workload),
  an explicit perf budget or SLO (a §2 requested behavior), and declining
  gratuitous pessimization (take the equally-clear-but-faster idiom).
  `references/review-rubric.md` #3 extended to flag premature optimization
  alongside premature generality.

## [0.11.0] - 2026-07-10

### Changed

- **Codex model defaults bumped to the GPT-5.6 family**, replacing
  `gpt-5.3-codex` (now deprecated by OpenAI for ChatGPT-signed-in Codex
  sessions) and `gpt-5.5` (superseded). `/review`'s standard and `--simplify`
  lanes now default to `gpt-5.6-terra` (balanced tier); `--adversarial`,
  `ask`, and `fix` now default to `gpt-5.6-sol` (flagship tier, matching
  HARRY.md §5's "capable-by-default" judgment-task principle). Updated every
  doc that names the defaults (README, `commands/*.md`,
  `codex-skills/*/SKILL.md`, `references/review-orchestration.md`).

### Fixed

- Removed `CodexProvider`'s stale `xhigh`→`high` reasoning-effort clamp
  (`src/lib/providers/codex.ts`). It existed because codex's app-server
  previously had no `xhigh` tier; verified against the installed codex CLI
  binary that `xhigh` is now a supported effort value, so every codex lane
  defaulting to `xhigh` (`/review`'s three lanes) was being silently
  downgraded to `high`. `opts.reasoning` now passes through unmodified.

## [0.10.0] - 2026-07-10

### Changed

- **Renamed `/harry:init` to `/harry:sync`** (breaking: update any muscle
  memory / scripts invoking the old name). The command is re-run far more
  often than it's run once — every time HARRY.md or the plugin updates,
  across every repo the laws are wired into — so "init" undersold its actual
  job; "sync" matches the resync semantics already documented for its Phase 1
  (laws snapshot re-deploy). Renamed `commands/init.md` -> `commands/sync.md`
  and `codex-skills/init/` -> `codex-skills/sync/`; updated all prose
  cross-references. `scripts/init.mjs` (the Phase 2 gitignore-block script,
  and its `init-ignore` pnpm alias) is unchanged — that one genuinely is a
  per-project one-time setup action, distinct from the laws resync.

## [0.9.1] - 2026-07-10

### Fixed

- Reworded Codex cost notes in `commands/debate.md`, `commands/review.md`,
  and `README.md` from Copilot-era "premium-request quota" language to
  token-quota consumption, now that the Copilot backend is gone.

### Changed

- `/review --simplify`'s Lane B (over-engineering hunt) gained a second
  dimension: readability (nested ternaries, deep nesting, unclear naming)
  plus an over-simplification brake, and a new `readab:` finding tag.
  Renamed the lane to "over-engineering & readability lane" consistently
  across `references/review-orchestration.md`, `commands/review.md`, and
  `codex-skills/review/SKILL.md`.

## [0.9.0] - 2026-07-09

### Changed

- **Converged the `.local/` doc model**: harry's five parallel doc types
  (spec/plan/backlog/milestone/research, each its own directory) collapse into
  one status-driven item store. Each work unit is a single `.local/items/<slug>.md`
  file moving through `status: backlog → active → done` in place — `active`
  holds both the former spec (`## Why / What`) and plan (`## Plan`) content.
  Milestones are `type: milestone` items linking to members/deliverables
  instead of a separate folder; completed items move to `.local/archive/`
  (read-only). `references/doc-types.md` is the rewritten canonical taxonomy;
  `HARRY.md`, `references/tier-gates.md`, the four pipeline skills,
  `commands/debt.md` + its codex mirror, and `commands/init.md` + its codex
  mirror (which now also migrates a repo's pre-existing docs into the new
  layout) all updated to match.
- Re-pinned the Major-tier implementer's default model to a literal `opus` in
  `skills/executing/SKILL.md` — a prior revision had softened this into "pick
  the current top tier at dispatch time," which in practice stopped reliably
  resolving to `opus`.

### Fixed

- `/harry:debt`'s freshness checks referenced comparing items "by date in the
  filename" — a structure the item model no longer has (no date prefix;
  `status` is the temporal signal). Switched to git last-touched date /
  `.local/HISTORY.md`.
- A milestone item never closed itself out once every member was delivered;
  it would sit `active` forever. Finishing now archives a milestone the same
  way as any other item once its `## Members` list empties out.
- A stale `.local/STATUS.md` reference in `CLAUDE.local.md` (superseded by
  `.local/INDEX.md`).

## [0.8.0] - 2026-07-07

### Added

- A prose reference-path linter test (`tests/prose-refs.test.ts`): every repo-relative
  path and `${CLAUDE_PLUGIN_ROOT}` reference across HARRY.md, skills, commands, and
  references must resolve — renames/deletes can no longer leave dangling instructions.
- **CI** (`.github/workflows/ci.yml`): typecheck, lint, test, and a **dist-drift
  gate** (`pnpm run build` + `git diff --exit-code dist/`) so the committed
  `dist/companion.cjs` can never silently diverge from `src/`.
- Tests for the previously-uncovered first-party core: `findings` (the
  review→fix JSON parsing), `zombie` (reaper logic), install-script atomicity,
  and a manifest/`package.json` version-sync guard.

### Changed

- **Laws release boundary**: `install-laws` / `/harry:init` now deploys HARRY.md as a
  **snapshot** to `~/.claude/harry/HARRY.md` and `@`-imports that copy, instead of
  live-importing the plugin checkout — "release" = re-run init, converging with the
  Codex build's resync model. Old direct-repo imports migrate automatically on re-run.
- **Standard tier executes inline** (session mode, isolated worktree) with a now
  **mandatory** independent reviewer subagent; subagent-per-task execution is Major-only.
  The Standard spec rule is canonicalized across all copies: a spec only when real
  alternatives were weighed, otherwise the decision lives at the top of the plan.
- **Tracking files simplified**: `.local/STATUS.md` merged into `.local/INDEX.md` as an
  `## In flight` section (now wired into the executing/finishing skills so start/finish
  marks actually happen); `HISTORY.md` rotates yearly to `.local/history/<year>.md`; the
  separate `.local/ledger/` is gone — progress marks live in the plan file itself, and
  Major-mode handoff files move to `.local/tmp/<branch>/`.
- **Audit orchestration hoisted**: the ~77%-identical `commands/audit.md` and
  `codex-skills/audit/SKILL.md` now share `references/audit/ORCHESTRATION.md`
  (same treatment as `review-orchestration.md`); the wrappers keep only their
  build-specific surface.
- The finishing skill now states completion evidence honestly: CI green when pushed,
  the full local suite when a merge stays local (CI does not run on local merges).
- Removed the unexplained `Intensity: full` orphan line from HARRY.md §1 and the
  contradictory "Every project, regardless of perceived simplicity" wording from the
  brainstorming HARD-GATE (the gate now defers tier claims to §3).
- **`fix`** isolates the pre-fix baseline with `git stash create` (an ephemeral
  snapshot) instead of committing the user's uncommitted work onto their branch —
  no branch-history mutation. It also now exits non-zero when the fix session
  fails or times out (was exit 0).
- **`state`** writes job state atomically (temp + rename) and with `0600`/`0700`
  permissions, and prunes per-job files/logs it drops past `MAX_JOBS` — closing a
  torn-read data-loss window and unbounded state-dir growth. Pruning never drops
  a running/queued job, and the zombie reaper's pid-reuse window scales with the
  job's own `--timeout` — a long-running job is never reaped or deleted mid-run.
- The CLI rejects unknown/typo'd flags per command and prints usage for
  `<command> --help` instead of launching a run.
- The shared `/review` orchestration (structured-review envelope, simplify
  dual-lane) moved to `references/review-orchestration.md`; the CC command and
  Codex skill both reference it instead of carrying diverging copies. Its `--fix`
  apply path now uses the same `git stash create` baseline as `fix` (no commit).
- Doc corrections: README documents the `/harry:` command namespace consistently;
  the `ask`/`fix` model-default claim and the RO/RW "instruction-only on both
  builds" wording in CLAUDE.md now match the code.
- Slimmed HARRY.md §5: the `.local/` doc-type taxonomy and lifecycle moved to
  `references/doc-types.md` (loaded on demand), keeping the resident law compact.
- Install scripts write the user's global files atomically with a one-time
  `.bak`, and no longer strip trailing bytes outside harry's marker block.

### Fixed

- `getCodexAvailability` never accepted an `env` override, so it always probed
  the real inherited `PATH` even when a caller (namely the test suite's fake
  Codex fixture) asked it to look elsewhere. Masked on a machine with a real
  `codex` CLI installed (the probe happened to succeed against the real
  binary); surfaced by this release's own new CI, which has no `codex` on
  `PATH` — `env` is now threaded through to `binaryAvailable` so the
  availability probe and the real RPC connection agree on which binary to use.

### Removed

- The no-op `SessionStart` hook (both `hooks.json` files) and its dead
  `setup --check` branch — it spawned `node` every session without refreshing
  anything. Docs that claimed a session-start quota refresh were corrected.
- ~170 lines of dead worktree-lifecycle code (`src/lib/worktree.ts`); the one
  live helper moved to the existing `src/lib/git.ts`.

## [0.7.0] - 2026-07-06

### Added

- **`/audit`**: a new whole-codebase structure & architecture-fitness audit —
  a six-round, iterative, multi-language (TypeScript/JavaScript, Go, Python)
  workflow that finds design-pattern mismatches, missed reuse/hoist candidates,
  layering violations, dead code, coupling, error-handling and observability
  gaps, and structural test-coverage holes. Ships as a Claude Code command
  (`commands/audit.md`) and a Codex skill (`codex-skills/audit/`), sharing one
  reference bundle under `references/audit/` via `${CLAUDE_PLUGIN_ROOT}`.
- `/audit` dimension 10 (over-engineering / unearned abstraction): the deep,
  evidence-verified, severity-ranked counterpart to `/review --simplify`'s new
  quick pass (below), governed by the same falsifiability anchor and drift-test
  discipline as `/audit`'s other nine dimensions.
- `/review --simplify` now runs as a "dual lane": the existing `gpt-5.3-codex`
  cleanup pass, plus a new CC-native (Codex build: sub-agent) over-engineering
  lane running in parallel, consolidated into one table. Costs no extra Codex
  quota — the new lane runs on the calling session's own compute.

### Removed

- **`/lean`** (command + Codex skill) is retired. Its quick per-diff scan is
  now `/review --simplify`'s new lane (above); its drift-test philosophy is now
  `/audit`'s dimension 10 (above). Existing `/lean` users should switch to
  `/review --simplify` for a quick per-diff check, or `/audit` for a deep,
  whole-repo, iterative pass.

## [0.6.1] - 2026-07-03

### Fixed

- `/init`'s `.gitignore` wiring (and the Codex `init` skill) referenced a stale
  `.worktrees/` entry instead of the `*worktrees/` glob this repo's own
  `.gitignore` was already fixed to use — the mismatch meant `scripts/
  init.mjs`'s dedupe couldn't recognize `*worktrees/` as already covering
  `.worktrees/`, so it kept re-adding a redundant marker block.

## [0.6.0] - 2026-07-03

### Added

- **Codex CLI compatibility**: harry now also ships as a Codex CLI plugin, a
  deliberate partial-parity companion to the Claude Code build. `.codex-plugin/
  plugin.json` + `.agents/plugins/marketplace.json` register the plugin — both
  schemas were live-verified against an authenticated Codex CLI install, not
  guessed from web docs. `codex-skills/` converts the mechanical/read-only
  slash commands (`ask`, `status`, `result`, `debt`, `lean`, `review`, `init`)
  into Codex Skills, since Codex's plugin manifest has no `commands`/`prompts`
  field. `scripts/install-codex.mjs` wires `HARRY.md` into `~/.codex/AGENTS.md`.
  The four pipeline skills and the `dist/companion.cjs` runtime are shared
  as-is between both builds.
- Known, documented degradations on the Codex build: `debate` has no Codex
  skill; `review --full` drops the Claude-only self-review lane and
  `--harry-fix`; `review`'s read-only/read-write boundary is instruction-only
  rather than tool-enforced; `init`'s law-wiring inlines `HARRY.md` as a
  snapshot rather than a live `@`-import.
- `pnpm run install-laws-codex` — mirrors `install-laws` for the Codex build.

## [0.5.0] - 2026-07-03

### Removed

- Copilot backend removed entirely. harry's agent commands (`ask`, `review`, `fix`) now
  run exclusively through Codex. The `Provider` dual-backend abstraction, the
  `@github/copilot-sdk` dependency, the `--provider` CLI flag, the `Backend provider`
  plugin setting, and Copilot's premium-request quota tracking (`status`'s `## Quota`
  block) are all gone. `/harry:debate`'s `gpt` voice now calls Codex directly instead of
  Copilot's `gpt-5.5`.

## [0.4.0] - 2026-07-02

### Added

- Restored the brainstorming **Visual Companion** — a zero-dependency local
  browser companion for genuinely visual design questions (mockups, wireframes,
  side-by-side layout comparisons), offered just-in-time.
- **Shared review rubric** (`references/review-rubric.md`): the in-house reviewer
  subagent now reviews against explicit dimensions (spec compliance, code
  quality, YAGNI/altitude, test hygiene) instead of an unnamed "shared rubric".

### Changed

- `executing`: a dispatched implementer/fixer now picks its model by **role and
  task nature** — capable by default (the role does judgment/exploration),
  cheaper only for mechanical/transcription work — and always sets it explicitly
  instead of silently inheriting the session model.
- `HARRY.md` §5: AI-assisted commits keep the `Co-Authored-By: Claude` trailer
  (previously stripped); the worktree law is rescoped from "any mutation" to
  work that can collide — a lone trivial edit needn't isolate.

### Fixed

- `.gitignore` now covers the native harness worktree path (`.claude/worktrees/`),
  so a lint run no longer breaks when a worktree is present.

## [0.3.1] - 2026-06-30

### Changed

- Active in-flight work now lives in a lazy `.local/STATUS.md` work list instead
  of `CLAUDE.local.md`, so in-flight state and history no longer ride in context
  every session. `CLAUDE.local.md` reverts to per-project specialization rules;
  the discipline is to mark a unit started in `STATUS.md` when work begins
  (HARRY.md §5).
- Renamed the completed-work archive `history.md` → `HISTORY.md`.

### Fixed

- `/init` no longer duplicates `.gitignore` entries the user already has outside
  harry's marked block; when every entry is already covered, no block is written.

## [0.3.0] - 2026-06-30

### Added

- `/init` wires the resident laws into global instructions and migrates legacy
  spec/plan artifacts into harry's format.
- Codex as a provider alongside Copilot.

### Fixed

- Restored the dropped `SessionStart` hook so `setup --check` refreshes the quota
  at session start.

### Changed

- Specs accumulate in `.local/specs/` and are never archived; only plans archive.
- Simplified the README install and providers prose.

## [0.2.0] - 2026-06-29

### Added

- Initial harry plugin: resident engineering laws (`HARRY.md`) loaded every
  session; brainstorming / writing-plans / executing / finishing skills;
  multi-model `/review` and `/debate`.
- `/review` `--full` multi-reviewer mode, a `--simplify` lane, and CC/Copilot fix
  backends.
- `/lean` whole-project scope with `--diff` for diff-only hunts.

### Changed

- `writing-plans` reframes asks as verifiable test goals before writing tasks.
- `finishing` runs the full wind-down tail even on a pre-decided merge.
- Tooling: Biome linter/formatter, TypeScript 7, dependency bumps.

[0.5.0]: https://github.com/kiraxie/harry/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kiraxie/harry/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kiraxie/harry/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kiraxie/harry/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kiraxie/harry/releases/tag/v0.2.0
