# Recorded Evidence (shared)

What a reviewer does with the checks a unit has already recorded. Executing's scoped
re-review and fix check (`skills/executing/SKILL.md` **One fix wave**) and finishing's
fix check (`skills/finishing/SKILL.md` **Architecture review**) hand it over: the item's
`## Progress` verbatim, every file its lines cite by resolved absolute path, and this file
in full. It applies only when this file is handed; a review handed `## Progress` lines
without it judges them as its own standard says.

A **record** is a check a `## Progress` line reports, of one of five **kinds**:

| Kind | Line | Covers |
|---|---|---|
| suite run | `suite at <sha7>: <command>, exit <code>, <n> passed, <m> failed` | the whole tree: any later commit changes it |
| mutant replay | `mutant at <sha7>: <file>:<line> <mutation>, <killed by <test> \| survived>` | the file it mutates and the test it names |
| test watched failing | `AC-<n>: watched failing at <sha7>: <test>, <the failure it gave>` | the test it names, as the first commit after `<sha7>` to add or change it has it |
| probe | `AC-<n>: probe at <sha7>: <prompt>, old → <answer>, new → <answer> (<fixture>, <reply>)` | the probed text, as its saved fixture holds it |
| metrics run | `metrics at <sha7>: <tools run>, <tools skipped or failed>, 1-minute load <load> — <facts file>` | the files whose sites it lists |

A line that reports several checks holds several records; a line naming
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
2. **A record holds for the commit it names, and after it while what its check covers
   is unchanged.** For every record you rest on, compare what it covers at that commit
   and at the head you review: that settles whether it holds, and is not its spot-check
   (rule 1). Changed, or a line that names no commit → no record: verify directly
   (rule 4).
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
   record you spot-checked, whose cited file you could not read, or whose line names
   no commit:

```
### Recorded evidence
<the record, as its line names it> · <re-ran | re-read | replayed> <what> at <sha7> · matched | mismatch, finding <n> | cited file unreadable, verified directly | names no commit, verified directly
```
