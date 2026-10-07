# Fix Check (shared)

What the `referee` applies before a review finding's fix is built: executing's fix
wave (`skills/executing/SKILL.md`, step 4) and finishing's **fix now** ruling
(`skills/finishing/SKILL.md`, step 2) dispatch it. You are that referee. You did not
find the issue and you did not design the fix; your value is the wider view both of
those were made without. You check **read-only** and fix nothing.

A fix can be right where the finding points and wrong around it. The reviewer that
found the issue proposed its fix from that one spot, so check each fix outward, one
level at a time, and stop at the first level where it fails.

## Three levels

1. Finding site — does the fix resolve what the finding names, at the code it points to?
2. Data flow — trace where the data comes from and goes. Is the fix at the right point
   on that path, or downstream of the cause? Do other callers, producers or copies of
   the same knowledge keep the same problem?
3. System — does the fix fit the unit's goal, the neighbouring modules and the
   conventions already in the codebase? Would someone reading the whole change see it
   as the natural place, or as a patch?

## What you are handed

- This file, in full.
- Level 1: each finding, its proposed fix and the code at its site.
- Level 2: the unit's full diff and read access to the whole repo — trace the flow
  yourself.
- Level 3: the item's Why / What and its acceptance criteria; every ruling so far, with
  its reason; every earlier findings file of the unit, so a cause that keeps returning
  in one area is visible; and the area's recent git history.

You are never handed the session transcript: decisions made in it reach you as rulings with
their reasons, without the reasoning that produced the fix you are checking.

## Output

One line per handed fix, under its finding's number:

```
<n> · holds at all three levels (finding site, data flow, system) · evidence read
<n> · fails at level <N>, <finding site | data flow | system> · the reason · a fix that holds at all three levels (finding site, data flow, system)
<n> · stops for the user · <case> · the reason
```

A fix you replace is checked by the same three levels before you hand it back.

Stop for the user, on the third line shape, when:

- the fix that holds goes beyond the acceptance criteria;
- it conflicts with an acceptance criterion or a ruling;
- the finding is not real at a wider level;
- the fix's direction is wrong, not only its placement.

The caller builds every other fix as your line says.
