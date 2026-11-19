"""Check one file in a worker overlay built by mutator's own code.

Run with mutator's venv interpreter:

    python overlay-check.py <group root> <file> <test command or empty>

<file> is relative to the group root; an empty test command runs mutator's
default for the file's language. One worker is built the way mutator builds
its own, under <group root>/target/mutation-workers/run-<id>/worker-0, and the
test command runs there twice: unmodified (the worker baseline), then with a
canary line appended to the worker copy. The canary parses but throws when the
module loads, so a static step in the test command (a type check, `node
--check`, a linter) passes it and only a test that loads the file fails. The
run directory is removed either way. Prints one JSON object:

    {"baseline": "pass" | "fail", "canary": "fail" | "pass", "tail": "<output tail>"}

Limits, each erring one known way:
- Java and Rust take a syntax error, since no statement appended after the
  top level runs at load; their compile step reads every file, so such a file
  always reads as seen. Any other language with no CANARIES row exits non-zero,
  so the mutator section fails rather than measuring with the wrong canary.
- A file tests only run as a spawned script that exits before its last
  statement (`process.exit`, `sys.exit` under a `__main__` guard) never reaches
  the canary, so it reads unseen and is listed not measured.
- A formatter whose style differs from the canary line still fails on it, so
  the file reads as seen.

The mutator names imported below are the ones `SCHEDULE_READ_AT` in
src/lib/metrics/mutator.ts lists; a pin bump re-reads them. The language names
CANARIES and SYNTAX_LANGUAGES key on are crapper's (`discover.language_of`, the
values of `discover.EXTENSIONS`), read at crapper's own pin, which
SCHEDULE_READ_AT does not hold; a test compares the two sets on an installed
crapper.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from mutator.crapper_link import ensure_crapper
from mutator.runner import CommandRunner, test_plan
from mutator.workers import create_workers, delete_tree, mapped_cwd, new_run_dir

MARKER = "harry-overlay-canary"
# Per language, by the name crapper's language_of gives: a top-level statement
# that parses and throws when the module loads. Each is appended to the file
# with its trailing newlines stripped, its leading blank lines the ones the
# language's default formatter wants: two for Python (PEP 8 E305 after a
# top-level def or class), one elsewhere.
CANARIES = {
    "typescript": f'\n\nthrow new Error("{MARKER}");\n',
    "python": f'\n\n\nraise RuntimeError("{MARKER}")\n',
    "clojure": f'\n\n(throw (ex-info "{MARKER}" {{}}))\n',
    "go": f'\n\nfunc init() {{ panic("{MARKER}") }}\n',
}
# Unbalanced closers, which no language mutator handles parses at the top level.
SYNTAX_CANARY = "\n\n)]}\n"
# The languages whose canary is SYNTAX_CANARY: none of their statements runs
# at load from after the file's top level.
SYNTAX_LANGUAGES = {"java", "rust"}
TAIL_LINES = 20


def tail(output: str) -> str:
    return "\n".join(output.splitlines()[-TAIL_LINES:])


def canary_for(relative: str, language: str) -> bytes:
    """The canary for `language`; a name with none exits, before any test runs."""

    if language in CANARIES:
        return CANARIES[language].encode("utf-8")
    if language in SYNTAX_LANGUAGES:
        return SYNTAX_CANARY.encode("utf-8")
    raise SystemExit(
        f"overlay check: no canary for {relative}'s language {language}; "
        "add a CANARIES row or a SYNTAX_LANGUAGES entry for it"
    )


def check(root: Path, relative: str, override: str | None) -> dict[str, str]:
    source = root / relative
    language = ensure_crapper().discover.language_of(source)
    if language is None:
        raise SystemExit(f"overlay check: {relative} is in no language mutator handles")
    canary_line = canary_for(relative, language)
    command, cwd = test_plan(root, source, language, override)
    original = source.read_bytes()
    runner = CommandRunner()
    base = new_run_dir(root)
    try:
        worker = create_workers(base, root, relative, original, 1)[0]
        where = mapped_cwd(worker, root, cwd)
        baseline = runner.run(command, where, None)
        if baseline.code != 0:
            return {"baseline": "fail", "canary": "fail", "tail": tail(baseline.output)}
        (worker / relative).write_bytes(original.rstrip(b"\r\n") + canary_line)
        canary = runner.run(command, where, None)
        verdict = "fail" if canary.code != 0 else "pass"
        return {"baseline": "pass", "canary": verdict, "tail": tail(canary.output)}
    finally:
        delete_tree(base)


def main(argv: list[str]) -> None:
    if len(argv) != 3:
        raise SystemExit("usage: overlay-check.py <group root> <file> <test command or empty>")
    root, relative, override = argv
    print(json.dumps(check(Path(root).resolve(), relative, override or None)))


if __name__ == "__main__":
    main(sys.argv[1:])
