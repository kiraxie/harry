---
description: Rethink a subsystem from scratch — an independent design from the user's brief alone, compared difference by difference with the current design, then a direction and an incremental path.
argument-hint: '<subsystem to rethink>'
---

Rethink the subsystem the user named:
`$ARGUMENTS`

Discussion anchored on the current code patches near the existing design. This
command gets a design made without it, then weighs the two. Run the four steps in
order; each one finishes before the next starts.

## 1. Brief

The user writes the brief in their own words: what the subsystem must do, who it
serves, its data volume, and the external contracts that must not break. Ask for
it, and ask about each of the four it leaves out, one question per message.

Do not read the subsystem's current code, docs or history in this step, and never
fill a gap in the brief yourself — a brief written from the code carries the
current design's vocabulary into the independent design.

## 2. Independent design

`ask --isolated` runs the model in a new empty working directory, so it finds no
code, no project `CLAUDE.md` or `AGENTS.md` by looking around where it starts;
the companion removes that directory itself, on success and on failure. The
read-only sandbox can still read absolute paths; the prompt's "do not read the
filesystem" is what keeps it to the brief.

1. Create a directory for the brief and note the path it prints:
   `mktemp -d -t harry-prompt.XXXXXX`
2. Write the user's brief, verbatim, to `<D>/brief.md` with the Write tool. The
   brief goes in through a file, never through shell source, so nothing in it can
   run as a command.
3. Run the design in one Bash call with `run_in_background: true` (a high-effort
   turn can outlast the foreground timeout), `<D>` pasted as the literal path:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/companion.cjs" ask --isolated "Design this subsystem from scratch, from the Background alone. You have no access to any codebase: do not read the filesystem or run commands. Give the design (data model, interfaces, mechanisms), then list every assumption you made where the Background was silent." --reasoning high --context @'<D>/brief.md'
   ```

4. Once the run has ended, remove the brief and its directory, only when its path
   carries the prefix; `rmdir` refuses a directory holding anything else:
   `case '<D>' in */harry-prompt.*) rm -f '<D>/brief.md' && rmdir '<D>';; esac`

A call with no result after 20 minutes counts as a failure: stop the background
task, then run step 4.

**On failure** — a non-zero exit, whose stdout is `# Ask Failed`, a blank line and
one reason line, or a `Fatal error:` line on stderr — give the user the error text
verbatim and the fix: `codex login` when it is not logged in; for a missing CLI,
the reason line names the install. Then stop, and never present a failed run's
stdout as the design. Never fall back to an agent in this repository: it reads the
code and the project's `CLAUDE.md`, which is the anchoring this step exists to
avoid.

**On success**, show the answer to the user verbatim, before any comparison.

## 3. Compare

Only now read the current design of the subsystem. Set the two side by side and
give each difference one verdict:

- **Has a reason** — the current design does this for a lesson learned. Cite the
  source: a commit, a doc line, a test, or a `DEBT:` note.
- **No reason found** — no source explains it. Say so; never call it baggage. The
  user decides whether it goes.
- **The new design is worse** — say what the current design handles that the new
  one misses.

## 4. Direction and path

Recommend a direction, and the incremental steps from the current design to it.
Each step states:

1. what it moves — data, an API or external contract, a schema;
2. how to roll it back;
3. whether it touches a HARRY.md **Tiers** red line — that step then tiers Major
   when it is picked up.

Split a wide change as expand, migrate, contract: add the new form beside the old,
move the callers over, then remove the old form. When no difference is worth
adopting, the result is "keep the current design", stated as the result.

End in the chat. Write no file and open no item; a difference becomes a backlog
item, or goes into brainstorming, only when the user names it.
