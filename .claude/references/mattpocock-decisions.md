# mattpocock-skills: decisions

Each skill in `mattpocock-skills` was judged one at a time (2026-10). This file records
the outcome and the reason, so a later re-sync does not re-open a settled skip or re-add
something taken out on purpose. `upstream.json` `derived[]` notes say where each pulled
rule landed; this file says why the rest did not.

## Intake bar

A skill, or part of one, comes in only when all three hold:

1. It changes how a session behaves, and a probe on an old-versus-new text shows it
   (`references/tier-gates.md` **Red-green for an instruction edit**). An idea harry's
   laws already cover is a skip.
2. It works without an issue tracker, a glossary file or a decision-record folder.
   harry's unit of work is a local `.local/` item, and the team keeps decisions and
   tickets elsewhere (a central knowledge base and Jira).
3. It does not move writing away from the session, or turn a plugin rule into a
   user-specific one.

Re-judge a skip only when the condition in its **Re-evaluate when** cell now holds.

## Pulled

| Skill | What came in | Where |
|---|---|---|
| grilling (+ grill-me) | "Word it so 'yes' accepts that recommendation." Harry keeps one question per round. | `references/grilling.md` |
| diagnosing-bugs | Minimise, then ranked falsifiable hypotheses; diff proof for a forced red; measure a baseline before bisecting a slowdown | `references/root-cause-tracing.md`, `references/red-green.md` |
| tdd | Each seam proposal carries a note on what it catches and misses. The REFACTOR step and tiered seam timing stay harry's. | `references/red-green.md` |
| prototype | A prototype opens by stating the question it answers | `skills/brainstorming/SKILL.md` |
| code-review | The reviewer also judges against the repo's own documented standards. No smell baseline and no parallel reviewers: one reviewer plus two independent lanes is enough. | `references/review-rubric.md` |
| research | Not a skill. The discipline of tracing a claim to its first-hand source is a claim-evidence row. | `references/claim-evidence.md` |
| retro | Not a command. It became finishing's leftover check and lessons offer. | `skills/finishing/SKILL.md` |
| to-tickets | Three splitting rules: vertical slices, prefactor first, expand then contract for a wide refactor. | `skills/brainstorming/SKILL.md` |

## Kept harry's own

| Skill | Why nothing changed |
|---|---|
| codebase-design | The vocabulary and the deletion test are already in `references/architecture-review.md`. |
| writing-for-agents | Already covered by `.claude/references/skill-authoring.md` and `references/plain-language.md`. |
| pr | Already covered by `references/pr-body.md`. |
| wait-what | Name and idea borrowed; the rules, the re-ask in plainer words and the one-shot form are harry's. Recorded in `upstream.json`. |

## Skipped

| Skill | Reason | Re-evaluate when |
|---|---|---|
| handoff | A `.local/` item with its `## Progress` is already the durable handoff, and `executing` resumes from it. A conversation without an item needs `/compact`. Handoff files matter for a new harness, a new directory, a colleague or a forked side task, none of which this team does often. | Sessions regularly move between harnesses or people |
| implement | `executing` already covers it and is stricter: an AC that is wrong becomes BLOCKED, never rewritten. The one gap, a verification cadence while building, showed no failure in a probe. Fetching a ticket by number depends on a tracker. | A probe shows full-suite runs after every small edit |
| implement-spec | Has subagents write the code, against `skills/executing/SKILL.md` **Who writes** (the session writes; dispatch only judges and readers). It also needs tracker blocking links. | The session-length discussion changes who writes |
| wayfinder | Built on a shared tracker map with native blocking links and claims. harry works one session per task. Its "fog" idea overlaps the residue manifest. | A task routinely spans many sessions with several writers |
| to-spec | An item's `## Why / What` already holds every part, plus "Approaches Considered". Its long user-story list pads; an AC is a verifiable outcome and reviews are checked against it. | Never, unless items stop being single-session |
| triage | A label state machine for public issues and external PRs. harry has no such queue. Its useful checks, "is it already built" and "reproduce before briefing", are the ladder and diagnosing-bugs. | The repo starts taking external issues |
| setup-matt-pocock-skills | It configures the tracker, labels and glossary layout that the skipped skills need. `/harry:sync` already does harry's own setup. | Any tracker-bound skill is adopted |
| ask-matt | A router over that repo's own skills, naming several skipped ones. harry's skills fire by tier. Its **Phase boundaries** page is kept for the session-length discussion. | The session-length discussion |
| improve-codebase-architecture | `/harry:audit` and the architecture review at finishing cover it. An HTML report with before/after pictures changes presentation, not judgment. | A user asks for a visual report |
| grill-with-docs, domain-modeling | Their output is a `GLOSSARY.md` plus ADRs. The team keeps decisions on a central knowledge-base site, and a repo-level ADR folder would be a second, stale copy. | A repo has no central place for decisions |
| wizard | A script generator for setup steps only a human can do. That is project-specific setup, not an engineering law. HARRY.md **Secrets** already keeps secrets out of the transcript. | Harry gains a deploy or setup workflow |
| teach | A personal learning workspace across sessions. No engineering rule to extract. | Never for this repo |
| to-questionnaire | Writes a questionnaire for someone else. The team asks colleagues in chat and Jira. | Written questionnaires become a team habit |
