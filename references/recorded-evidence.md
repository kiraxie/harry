# Recorded Evidence (shared)

What a reviewer does with the checks a unit has already recorded. Executing's scoped
re-review and fix check (`skills/executing/SKILL.md` **One fix wave**) and finishing's
fix check (`skills/finishing/SKILL.md` **Architecture review**) hand it over: the item's
`## Progress` verbatim, every file its lines cite by resolved absolute path, and this file
in full. It applies only when this file is handed; a review handed `## Progress` lines
without it judges them as its own standard says.

A **record** is a check a `## Progress` line reports: a suite run
(`suite at <sha7>: <command>, exit <code>, <n> passed, <m> failed`), a mutant replay,
a test watched failing, a probe (`AC-<n>: probe: …`), a metrics run. A **kind** is one
of those five. A line that reports several checks holds several records; a line naming
a commit range is recorded at the range's head. Your value is your independence; a
record saves you only the re-runs you do not need, never the judgment.

## Rules

1. **Spot-check a sample of what you rest on.** Rest your verdict only on records you
   would cite as evidence for it; a suite run at a head the proposed fixes are not yet
   built on is evidence for none of them. Of each kind you rest on, spot-check at
   least one record yourself, and not every one while each you check matches:
   - a suite run or mutant replay: re-run it at the head you review;
   - a test watched failing: re-run it on the code before the change it guards;
   - a probe: re-read its saved fixture and reply against the text at the head you
     review, with no new model call; a probe line that cites no saved fixture or reply
     is no record (rule 4);
   - a metrics run: replay by hand one site it lists, or one mutant of your own on a
     line the run covered when it lists none — never a new metrics run.

   A record that reports mutants without naming them is sampled with one or two
   mutants of your own on the lines it covers.
2. **A record holds only for the commit it names.** For code changed after that commit
   it is no record: verify that code directly (rule 4). A suite run covers the whole
   tree, so any commit after its own makes it no record. A record that names no commit
   holds while the files its check covers are unchanged in the range you review. A
   probe that names no commit also holds where that range changed the text it probed,
   while its saved fixture's copy of that text — the one its new answer was given on —
   equals the text at the head you review. Compare the two for every such probe you
   rest on: that settles whether the record holds, and is not its spot-check (rule 1).
3. **A mismatch is a finding.** A spot-check that disagrees with its record is a
   finding, at least Important, and then every record of that kind is spot-checked. A
   mismatch that looks environmental — a flake, a wrapper on PATH — is still reported
   as a finding, with that reason; the caller rules on it. In a fix check, whose output
   has no issues section of its own, put it under a `### New issues` block after the
   fix lines, stating its severity, numbered on from the last number handed — the
   findings list's last, not the last fix you check.
4. **Anything unrecorded or doubted is verified as before.** So is a record whose cited
   file cannot be read: it counts as no record, and its report line says so. Nothing
   handed means everything is verified.
5. **Report every spot-check.** Your report ends with this section, one line per
   record you spot-checked, or whose cited file you could not read:

```
### Recorded evidence
<the record, as its line names it> · <re-ran | re-read | replayed> <what> at <sha7> · matched | mismatch, finding <n> | cited file unreadable, verified directly
```
