---
description: Upgrade every dependency of this repo to its latest stable release — the package manager and CI setup actions included — verify, and land it through the merge-vs-PR ask. Repo-local.
---

# `/upgrade-deps` — upgrade dependencies

This command brings every dependency of the current repo to its latest stable release — the
package manager and the CI setup actions included — verifies the result, and lands
it through the usual merge-vs-PR ask. It never deploys unless the user asks.

A full upgrade touching CI is at least Standard (HARRY.md **Tiers**). Work on a fresh
branch, never the default branch.

## 1. Read the toolchain before touching anything

Find out what is actually in use and how each tool was installed — before
diagnosing any version or lockfile problem, not after:

- the manager's own version and install route (`which <tool>` and `<tool> --version`;
  a Homebrew install and a corepack one behave differently on upgrade);
- the version pins the repo declares (see the notes per ecosystem below);
- the CI workflow's setup actions and the versions they pin.

## 2. Bump to latest stable

Upgrade every dependency, the package manager itself where the repo pins it, and
every CI setup action. Look up each action's latest release rather than assuming it.
Upgrading what is already there is not adding a package; **adding a new package
still needs the user's approval** — if an upgrade seems to need one, stop and ask.

## 3. Take majors one at a time

For each major bump, read its migration notes and fix the code. When one cannot be
fixed now, pin it at the last working major with a `DEBT:` note that names the
blocker and what unblocks it (HARRY.md **Code**), and move on.

## 4. Verify

Run the repo's full checks — tests, typecheck, lint, build, and one real run of the
app or its main entry point. Report exit codes and failure counts as printed. Never
commit on red.

## 5. Dependabot

List every open alert, all pages:
`gh api --paginate 'repos/{owner}/{repo}/dependabot/alerts?state=open'`. For each, confirm the upgrade closed it, or say why not —
an alert that needs a package swapped for another is a plan for the user, not a
change to make here.

## 6. Land

Hand off to the finishing skill: merge or PR is always the user's call (HARRY.md **Ask first**),
landed as a squash. Do not deploy unless the user asks.

## Notes per ecosystem

- **pnpm / Node.** Pins: `packageManager` and `engines` in `package.json`. First
  `pnpm up` (add `-r` in a workspace), which stays inside the declared ranges; then
  list the majors with `pnpm outdated` and take each one alone with
  `pnpm up <pkg>@latest` (again with `-r` in a workspace), verifying before the next (step 3). Never
  `pnpm up --latest`: it takes every major at once. Then `packageManager` to the
  latest pnpm. CI: `pnpm/action-setup` (it reads `packageManager` when given no
  version) and `actions/setup-node`.
- **Go.** Pins: the `go` and `toolchain` directives in `go.mod`. Upgrade with
  `go get -u ./...` then `go mod tidy`; a major version of a module is a new import
  path (`/v2`), so step 3 applies. CI: `actions/setup-go`, and the golangci-lint
  action's version when the repo lints.
- **Python (uv).** Pins: `requires-python` in `pyproject.toml` and the uv version the
  CI installs. Upgrade with `uv lock --upgrade` then `uv sync`; raise a lower bound
  in `pyproject.toml` only when the code now needs it. CI: `astral-sh/setup-uv` and
  `actions/setup-python`.
