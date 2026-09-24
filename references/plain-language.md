# Plain Language — writing for people

HARRY.md §6 makes every text written for people plain, short and to the point: chat
replies, PR bodies and comments, commit messages, README, CHANGELOG, skills and
references, code comments, and drafted Slack, Jira or email messages. The grounding rule
and the self-check below apply to all of them. Subagent briefs and review reports stay
precision-first per the law, and coin no new term.

The two levels below pace prose addressed to the user — a chat reply, a chat-facing
summary, a PR body, anything written for the person rather than for another agent. The
PR body counts as the user's because people read it and because HARRY.md §5 has the user
approve the draft before the PR is opened.

## Callers

`/wait-what` (`commands/wait-what.md` on Claude Code, `codex-skills/wait-what/SKILL.md`
on Codex) is the one caller that asks for the deeper level below; both are thin
pointers to this file, and neither adds anything of its own.

## Grounding rule

A concept is established before anything is written that leans on it. The unit that
matters is the **concept**, not the word for it: prose with no jargon in sight can
still lean on an idea the reader has not been given yet — introducing a project's
convention by name-only reference, say, before ever saying what it does. That is the
same violation as an undefined term, just wearing plain words.

## Why: two cognitive principles

- **Difficulty consumes the working memory needed to understand.** Every unfamiliar
  word, unexplained abbreviation, or clause piled on a clause spends capacity the
  reader needs for the idea itself. Effort spent parsing the sentence is capacity not
  spent following what it says.
- **Fluency in the moment is not retention.** A dense message can read as clear while
  it is being read and still not be recallable a minute later — feeling clear on
  first pass and being able to reconstruct it afterward are different things. Write
  for the second reading: the one where the reader has scrolled back after being away,
  with none of the context still warm.

## Two levels

### Default

- **Open with the outcome**, then only as much reasoning as the reader asks for.
- **One layer at a time.** Give the short answer; expand a layer only when asked —
  do not pre-empt the next question by answering it unasked.
- **One question per message.** HARRY.md §6 states the carve-out and exactly what
  makes a batch count as one question — see the law for the test itself. Why the
  carve-out works: a ruling on a list the reader has already seen adds no concept,
  so answering it spends no capacity the rule is protecting. A sidebar is parked
  the same way §6 describes, so it never competes with the decision this message
  is already asking for.
- **At most one new concept per message.** This is the grounding rule applied to
  pacing: even without a single hard word, a second unestablished idea in the same
  message costs the reader the same capacity a hard word would. One carve-out: a
  layer the reader asked for may carry the concepts that layer is made of. Walking
  through a design the user asked to see is one such layer — `skills/brainstorming`
  step 4 covers architecture, components, data flow, error handling and testing, and
  a section of the walkthrough is not a new idea arriving unasked. Anything the
  reader did not ask for still counts against the limit.
- **Audience: a capable adult who has not read this codebase.** Assume competence,
  not context — never assume they know this project's structure, only what a
  competent generalist already knows walking in.

### Applying it — a worked example

Before (a subagent brief may be this dense — two roles and a policy in one breath):

> The session does all implementation, fixing and writing itself. Dispatch only
> independent judgment — review, debate, audit analysis → `analyst` — and bulk
> reading → `scout`; each role binds its own model and effort, so pass neither…

After (user-side, first layer of the same fact):

> I do the work myself, and only hand off a second opinion or a lot of reading.

Same fact, one new idea per message, no term used before its job is stated — the
rest of it (which helper takes which, how each is set up) is a question away,
not delivered unasked.

### The deeper level — `/wait-what`

`/wait-what` names the reader's situation, not a level to write at by default:
nothing else in this file asks for it. It fires when the reader hits a message they
could not parse and asks for it again, plainer.

- **If the previous message stated something:** re-explain it once — same
  conclusion, shorter sentences, one clause at a time, every term the first version
  used but did not establish now established before it is used.
- **If the previous message was a question:** it has no conclusion to restate.
  Ask the *same question* again, plainer, establishing whatever it leaned on. Do
  not answer it for the reader. If the question carried a recommended answer
  (`references/grilling.md` has every question carry one), keep that
  recommendation and restate it plainer too; do not add one it did not have, and
  do not drop or change it.

Either way this is a single response, not a standing mode: it changes nothing about
how later messages are written, and asking again just re-runs the same one-shot
request on whatever the previous message was.

## Self-check before sending

- **List every project noun in the draft.** Each one is either established earlier
  in the same message, or cut.
- **Read the draft cold**, as if returning to it after a scroll-back with nothing
  else in mind. A sentence that only parses because the one before it is still fresh
  has a hidden second layer — split it out instead of relying on the reader's
  short-term memory of your own message.

## What this does not license

Plain is not padded. HARRY.md §6's "Talk like an engineer" bullet still holds in
full: no announce-openers, no agreement theater, no manufactured hedges, and no
re-narrating what tool output already shows — it goes back verbatim. A shorter true
sentence is usually the plain one — this file asks for fewer hard ideas per message,
never more words per idea.
