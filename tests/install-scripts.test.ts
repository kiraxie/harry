// Safety behavior of the three install scripts: they rewrite the user's
// hand-authored, un-versioned global files (~/.claude/CLAUDE.md,
// ~/.codex/AGENTS.md) and a project .gitignore, so they must write atomically,
// keep a one-time backup, and never mutate the user's bytes outside harry's
// marker block. Everything here runs against a throwaway temp dir — never the
// real ~/.claude — via the HARRY_GLOBAL / HARRY_CODEX_GLOBAL overrides and
// init's explicit target-dir argument.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { run as initRun } from "../scripts/init.mjs";
import { run as installRun } from "../scripts/install.mjs";
import { run as codexRun } from "../scripts/install-codex.mjs";
import { safeWrite } from "../scripts/lib/atomic-write.mjs";

const BEGIN = "# >>> harry >>>";

function tmpDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Run `fn` with HARRY_GLOBAL pointed at `file`, restoring the prior value after.
function withGlobal(file: string, fn: () => void): void {
  const prev = process.env.HARRY_GLOBAL;
  process.env.HARRY_GLOBAL = file;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.HARRY_GLOBAL;
    else process.env.HARRY_GLOBAL = prev;
  }
}

test("install.mjs: first install writes the block, drops a .bak, leaves no .tmp", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    const original = "# My rules\n\nUse TDD.\n";
    writeFileSync(g, original);

    withGlobal(g, () => installRun());

    const out = readFileSync(g, "utf8");
    assert.ok(out.includes(BEGIN), "marker block present");
    assert.ok(out.includes("# My rules"), "user content preserved");
    assert.ok(existsSync(`${g}.bak`), "one-time .bak created");
    assert.equal(readFileSync(`${g}.bak`, "utf8"), original, ".bak holds the pristine original");
    assert.ok(!existsSync(`${g}.tmp`), "no .tmp residue after an atomic write");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs: re-install is idempotent and never clobbers the .bak", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    const original = "# My rules\n\nUse TDD.\n";
    writeFileSync(g, original);

    withGlobal(g, () => {
      installRun();
      const afterFirst = readFileSync(g, "utf8");
      installRun();
      const afterSecond = readFileSync(g, "utf8");

      assert.equal(afterSecond, afterFirst, "second run is byte-identical (idempotent)");
      assert.equal(afterSecond.split(BEGIN).length, 2, "exactly one block");
      assert.equal(
        readFileSync(`${g}.bak`, "utf8"),
        original,
        ".bak still the pristine original, not the once-modified file",
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs: --remove strips the block cleanly", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    writeFileSync(g, "# My rules\n\nUse TDD.\n");

    withGlobal(g, () => {
      installRun();
      installRun({ remove: true });
    });

    const out = readFileSync(g, "utf8");
    assert.ok(!out.includes(BEGIN), "block removed");
    assert.ok(out.includes("Use TDD."), "user content kept");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs: user content outside the block (incl. trailing newlines) is byte-preserved", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    const original = "# My rules\n\nUse TDD.\n\n\n"; // deliberate trailing blank lines
    writeFileSync(g, original);

    withGlobal(g, () => {
      installRun();
      const installed = readFileSync(g, "utf8");
      assert.ok(
        installed.startsWith(original),
        "install leaves the user's bytes untouched as a prefix",
      );
      installRun({ remove: true });
    });

    assert.equal(
      readFileSync(g, "utf8"),
      original,
      "install + remove round-trips to the original bytes exactly",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init.mjs: writes the .gitignore block with a .bak and byte-preserves trailing user bytes", () => {
  const dir = tmpDir("harry-init-test-");
  try {
    const gi = path.join(dir, ".gitignore");
    const original = "node_modules/\n\n\n"; // trailing blank lines the user chose
    writeFileSync(gi, original);

    initRun(dir);

    assert.ok(readFileSync(gi, "utf8").includes(BEGIN), "block added");
    assert.ok(existsSync(`${gi}.bak`), "one-time .bak created");
    assert.equal(readFileSync(`${gi}.bak`, "utf8"), original, ".bak holds the pristine original");
    assert.ok(!existsSync(`${gi}.tmp`), "no .tmp residue");

    initRun(dir, { remove: true });
    assert.equal(
      readFileSync(gi, "utf8"),
      original,
      "install + remove round-trips to the original bytes exactly",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install-codex.mjs: inlines HARRY.md safely with a one-time .bak", () => {
  const dir = tmpDir("harry-codex-test-");
  try {
    const g = path.join(dir, "AGENTS.md");
    const original = "# My rules\n";
    writeFileSync(g, original);

    const prev = process.env.HARRY_CODEX_GLOBAL;
    process.env.HARRY_CODEX_GLOBAL = g;
    try {
      codexRun();
      const out = readFileSync(g, "utf8");
      assert.ok(out.includes(BEGIN), "marker block present");
      assert.ok(out.includes("Resident Engineering Laws"), "HARRY.md content inlined");
      assert.ok(existsSync(`${g}.bak`), "one-time .bak created");
      assert.equal(readFileSync(`${g}.bak`, "utf8"), original, ".bak holds the pristine original");
      assert.ok(!existsSync(`${g}.tmp`), "no .tmp residue");
    } finally {
      if (prev === undefined) delete process.env.HARRY_CODEX_GLOBAL;
      else process.env.HARRY_CODEX_GLOBAL = prev;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("safeWrite: backs up once, never clobbers the .bak, leaves no .tmp", () => {
  const dir = tmpDir("harry-safewrite-test-");
  try {
    const f = path.join(dir, "file.txt");
    writeFileSync(f, "v1");

    safeWrite(f, "v2");
    assert.equal(readFileSync(f, "utf8"), "v2", "target updated");
    assert.equal(readFileSync(`${f}.bak`, "utf8"), "v1", "backup holds pristine v1");
    assert.ok(!existsSync(`${f}.tmp`), "no .tmp residue");

    safeWrite(f, "v3");
    assert.equal(readFileSync(f, "utf8"), "v3", "target updated again");
    assert.equal(
      readFileSync(`${f}.bak`, "utf8"),
      "v1",
      "backup still v1, not clobbered on re-run",
    );

    // A brand-new target has nothing to back up.
    const fresh = path.join(dir, "fresh.txt");
    safeWrite(fresh, "hello");
    assert.equal(readFileSync(fresh, "utf8"), "hello", "new file written");
    assert.ok(!existsSync(`${fresh}.bak`), "no backup when there was nothing to preserve");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
