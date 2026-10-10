# Architecture Review (shared)

What a reviewer applies when finishing's architecture-review step
(`skills/finishing/SKILL.md`, step 2) dispatches it: a lead reading the whole
change for its shape, before anything merges or is pushed. You are that reviewer.
You review **read-only** — no working-tree, index, or HEAD mutation — and you do
not fix anything; what you find goes to the user, who rules on each finding, except a
Minor finding from round 2 on, which goes to the item's `## Follow-ups` without a ruling.

A **shape** is the outward form other code depends on: an API, a DB schema, a
public interface, or a module or service boundary. You judge only shapes. You are
handed:

- **The shape list** — the shapes this change added or altered. Judge these; read
  anything else only to judge them.
- **The item's `## Why / What` and its acceptance criteria** — known facts, not
  claims to re-litigate. Neighbouring services the design names are facts too.
  A unit with no item hands you the task as the user stated it instead.
- **The branch diff**, as a file — on a later round, only the diff since the head
  the previous round reviewed. On the Codex build you are told the base instead and
  run the diff yourself.
- **This file, in full.**
- **The last 20 commits touching the changed paths** — for the history pass below.
- **Read access to the whole repo** — read callers, neighbours and older code
  freely; the diff alone never shows how a shape fits.
- **On a later round, the rulings recorded so far** — each **leave as is**
  record as Output below defines it, and each **backlog** — and the Minor findings sent to
  `## Follow-ups` from round 2 on. Do not raise a ruled finding or one of those Minor
  findings again unless the fix changed the shape it concerns.

## Not your job

Line-level code quality and tests are out of scope — the per-diff review standard
(`references/review-rubric.md` and the files it declares) owns both, and executing's own
review applies it. Do not report naming, error handling inside a function, style, edge
cases, test coverage or test hygiene. A finding that would read the same with every
shape left as it is belongs to that rubric, not here.

## Five categories

1. **API and interfaces.** Shaped for its callers, not for its implementation. No
   internals leak through it — storage layout, internal IDs, a helper's return type.
   Consistent with the neighbouring APIs it sits beside (naming, errors, paging,
   versioning). A new caller could use it correctly without reading the
   implementation.
2. **DB schema.** Keys, relations and nullability say what the data really is. A
   rule the schema should enforce (uniqueness, a required relation, an allowed
   range) that lives only in application code is a finding. Ask how painful the
   next migration of this shape will be — a column that will need splitting, a
   relation that will need to become many-to-many.
3. **Boundaries.** Each module knows only what it must about the others.
   Dependencies point one way — toward the more stable side, never back up from a
   lower layer. Logic sits in the layer that owns it: no business rule in a
   transport handler, no presentation choice in the data layer.
4. **Abstraction timing** — in this review, apply it only to abstractions that form
   a listed shape or sit on one; a helper inside one function is the rubric's call.
   The definitions below hold for any module. Too early, by callers: a public
   interface or module boundary shaped for callers that do not exist yet. Too early,
   by implementations: a seam — the place where one implementation can be swapped
   for another without editing the callers — with one implementation behind it. A
   seam is real once two sit behind it. A test adapter is the second only when the
   dependency behind the seam is a remote service, yours over a network or a third
   party's, which the suite does not run for real. Otherwise the seam is
   indirection. See **Seams and what sits behind them** in `references/red-green.md`.
   Too late: the same knowledge copied into three modules or services, which now
   has to change in three places. Too thin: a **shallow module**, whose interface —
   everything a caller must know to use it, invariants and error modes included — is
   nearly as large as what it hides. Run the **deletion test** on it: picture the
   codebase without the module. When nothing it does has to be rewritten elsewhere,
   it only passes calls through and fails the test — a candidate finding. When each
   caller would have to take back the work it hides, it passes — no finding.
5. **System level (across services).** Should this live in an existing service, or
   does it justify a new one? Who owns each piece of data — and is any data now
   shared by two services, each writing it? Is a synchronous call the right
   choice, or should it be an asynchronous message? When the other side fails,
   what happens here — does the failure stop at this boundary or spread? Does a
   cross-service contract stay backward compatible for the callers already
   deployed?

## Two passes beyond the diff

- **Step up one level.** After judging each shape at its own level, step up one:
  function → module → service → system. Ask whether the shape still fits from
  there — a function that is fine can make its module incoherent; a module that is
  fine can put a service in the wrong role. Label every finding that only appears
  from the higher level `seen only one level up`.
- **Read the history for accumulation.** Read the 20 commits you were handed as a
  sequence. Each change can be fine on its own while together they drift — a
  boundary crossed a little more each time, a table widened column by column into
  two concepts. A drift finding cites the commits that make it up.

## Judge only what you can see

- **Name the unseen side; never guess it.** When a shape crosses a boundary whose
  far side is not in this repo — another service, a client, a database owned
  elsewhere — say which side you could not see and judge only the side you could.
- **Missing context becomes a question.** A finding that holds only if something
  you were not told is true is written as a question to the user, not as a
  verdict: "Do other services write to `orders`? If so, …".
- **Review it yourself.** Never dispatch a subagent to review part of the change.
  A change too large for one pass is reviewed in passes — say so in the output.

## Output

Every finding carries five things: **where** (`file:line`, or the shape's name
when it spans files), **why** it matters, its **severity**, the **structural fix**,
and your **recommended ruling**. The structural fix is the long-term one, never a workaround
(`references/review-rubric.md`, **Engineering judgment**). The user rules each finding one of three ways. A Minor finding from round 2 on is the
exception: it goes to the item's `## Follow-ups` without a ruling. You recommend one of the
same three for every finding:

- **fix now** — fix it before this merges. The work goes back to be fixed, and
  this review then re-checks the shapes the fix changed.
- **backlog** — real, but not for this merge. It becomes a new backlog item and
  the merge goes ahead.
- **leave as is** — the shape stays as it is. Its location, its gist and the user's
  reason are recorded, and the finding is not raised again.

Severity is judged on the shape, one of three:

- **Critical** — the shape breaks a caller already deployed, loses data, or leaves an
  acceptance criterion unmet.
- **Important** — merged as is, the shape costs a migration or a boundary rewrite later.
- **Minor** — real, but nothing in this unit builds on it; it can wait.

```
### Shapes reviewed
[each shape from the list, one line: what it is · unseen side, if any]

### Findings
1. <shape> · <category> [· seen only one level up] [· question]
   Where: <file:line or shape name>
   Why: <what goes wrong, and for whom>
   Severity: Critical / Important / Minor
   Structural fix: <the long-term change>
   [Short-term fix: <only when the structural one is not simple>]
   Recommended ruling: fix now / backlog / leave as is · <one-line reason>
2. …
```

A finding phrased as a question still carries a recommended ruling — the one you
would give if the answer is the worse case.

When there is nothing to report, say so plainly — the whole `### Findings`
section is the single line `No findings.` Never pad it with praise, with
line-level notes this file excludes, or with findings you do not believe.
