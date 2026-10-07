# PR Body — what a pull request description holds

`skills/finishing` drafts every PR body from this template and shows it to the user before
`gh pr create`. The body is prose for people, so `references/plain-language.md` governs how
it reads; this file fixes what it holds.

```markdown
## Summary

<one visual of the change (see Summary below) and one or two sentences>

## Evidence

- **Before:** <screenshot / output / failing test run>
  **After:** <screenshot / output / passing test run>

## Merge Danger

**Door:** <one-way or two-way>

<optional: why>

**Blast radius:** <one word>

<optional: what could break, and for whom>
```

No preamble before `## Summary`, no section beyond these three.

## Summary

Pick the visual by the plain-language rule **Show the structure**. The kinds that fit a PR:

- **Pseudocode** for logic:

  ```text
  on(save)
    if content is unchanged
      return cached result
    write new content
  ```

- **Call tree** for runtime control flow:

  ```text
  submitForm
    createSession
      persistPrompt
    navigateToSession
  ```

- **File tree** for what each file owns, or a broad refactor:

  ```text
  src/
  ├── commands/    # parses user actions
  └── transport/   # sends API requests
  ```

- **Diff of the structure** when the surrounding structure already exists and the point is what
  changes in it — a call tree, a file tree, a component tree:

  ```diff
   submitForm
     createSession
       persistPrompt
  +    expandSkillMention
     navigateToSession
  ```

- **Mermaid** for interaction between components, or data flow.
- **The whole block** when most of it is new, or the reader needs a copyable target.

Usually one visual, sometimes two; never every kind.

## Evidence

A before and an after, showing the change works. A screenshot is the strongest evidence for
a visual change, when the environment can take one. Otherwise show execution: the test that
failed before and passes now — its steps as pseudocode, with the run output — or the command
output before and after. A change to prose or config alone still pairs them: the contract
test that failed before the edit and passes after it, or the old and new line side by side.
A green suite on its own is a claim, not a before and after.

## Merge Danger

- **Door** — a *two-way* door is cheap to walk back: a revert undoes it. A *one-way* door is
  not: a destructive operation, a data migration, a published contract, anything a revert
  leaves behind. Say which, and why when it is one-way.
- **Blast radius** — one word for how far a failure would reach (`local`, `module`,
  `consumers`, `users`), then, optionally, what could break: layout shift, a consumer's
  build, a migration that cannot re-run.
