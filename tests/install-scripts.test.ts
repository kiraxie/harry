// Safety behavior of the three install scripts: they rewrite the user's
// hand-authored, un-versioned global files (~/.claude/CLAUDE.md,
// ~/.codex/AGENTS.md) and a project .gitignore, so they must write atomically,
// keep a one-time backup, and never mutate the user's bytes outside harry's
// marker block. Everything here runs against a throwaway temp dir — never the
// real ~/.claude — via the HARRY_GLOBAL / HARRY_CODEX_GLOBAL overrides and
// init's explicit target-dir argument.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { run as initRun } from "../scripts/init.mjs";
import { run as installRun } from "../scripts/install.mjs";
import { run as codexRun } from "../scripts/install-codex.mjs";
import { safeWrite } from "../scripts/lib/atomic-write.mjs";

const BEGIN = "# >>> harry >>>";
const END = "# <<< harry <<<";

// The plugin's own HARRY.md — the source that install deploys as a snapshot.
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceLaws = readFileSync(path.join(pluginRoot, "HARRY.md"), "utf8");

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

test("install.mjs: deploys a HARRY.md snapshot and imports the deployed copy, not the repo", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    writeFileSync(g, "# My rules\n\nUse TDD.\n");
    // Snapshot lives beside the global file (both under <home>/.claude in real use).
    const snapshot = path.join(dir, "harry", "HARRY.md");

    withGlobal(g, () => installRun());

    assert.ok(existsSync(snapshot), "snapshot deployed under the fake HOME");
    assert.equal(
      readFileSync(snapshot, "utf8"),
      sourceLaws,
      "deployed snapshot is a byte copy of the plugin's HARRY.md",
    );

    const out = readFileSync(g, "utf8");
    assert.ok(out.includes(`@${snapshot}`), "block imports the deployed snapshot path");
    assert.ok(
      !out.includes(`@${path.join(pluginRoot, "HARRY.md")}`),
      "block does NOT import the live repo/plugin HARRY.md",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs: re-run redeploys the snapshot and stays idempotent", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    writeFileSync(g, "# My rules\n\nUse TDD.\n");
    const snapshot = path.join(dir, "harry", "HARRY.md");

    withGlobal(g, () => {
      installRun();
      const afterFirst = readFileSync(g, "utf8");
      // Simulate the deployed snapshot drifting; a re-run must overwrite it.
      writeFileSync(snapshot, "STALE\n");
      installRun();
      const afterSecond = readFileSync(g, "utf8");

      assert.equal(afterSecond, afterFirst, "global file byte-identical across re-runs");
      assert.equal(afterSecond.split(BEGIN).length, 2, "exactly one block");
      assert.equal(
        readFileSync(snapshot, "utf8"),
        sourceLaws,
        "re-run redeploys the current HARRY.md over the stale snapshot",
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs: migrates an old direct-repo import to the deployed snapshot on re-run", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    // A global file that already has a harry block wired the OLD way: a live
    // @-import pointing straight at the plugin checkout's HARRY.md.
    const oldImport = `@${path.join(pluginRoot, "HARRY.md")}`;
    writeFileSync(g, `# My rules\n\n${BEGIN}\n${oldImport}\n${END}\n`);
    const snapshot = path.join(dir, "harry", "HARRY.md");

    withGlobal(g, () => installRun());

    const out = readFileSync(g, "utf8");
    assert.equal(out.split(BEGIN).length, 2, "still exactly one block (no duplicate)");
    assert.ok(!out.includes(oldImport), "old direct-repo import is gone");
    assert.ok(out.includes(`@${snapshot}`), "block now imports the deployed snapshot");
    assert.ok(out.includes("# My rules"), "user content preserved through migration");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs: --explore deploys the user-level Explore override (haiku, marked)", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    writeFileSync(g, "# My rules\n");
    const explore = path.join(dir, "agents", "Explore.md");

    withGlobal(g, () => installRun({ explore: true }));

    assert.ok(existsSync(explore), "Explore override written under the fake HOME's agents/");
    const body = readFileSync(explore, "utf8");
    assert.ok(body.includes("harry:explore-override"), "carries the harry marker line");
    assert.ok(body.includes("model: haiku"), "pins the override to haiku");
    assert.ok(body.includes("name: Explore"), "named Explore to shadow the built-in");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs: a plain install does NOT deploy the Explore override (opt-in)", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    writeFileSync(g, "# My rules\n");
    withGlobal(g, () => installRun());
    assert.ok(
      !existsSync(path.join(dir, "agents", "Explore.md")),
      "no Explore override without --explore",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs: --explore does NOT overwrite a user's own (unmarked) Explore.md", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    writeFileSync(g, "# My rules\n");
    const explore = path.join(dir, "agents", "Explore.md");
    const mine = "---\nname: Explore\nmodel: opus\n---\nmy own explore\n";
    mkdirSync(path.dirname(explore), { recursive: true });
    writeFileSync(explore, mine);

    withGlobal(g, () => installRun({ explore: true }));

    assert.equal(
      readFileSync(explore, "utf8"),
      mine,
      "an existing unmarked Explore is left untouched, not silently clobbered",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.mjs: --remove deletes harry's Explore override but never a user's own", () => {
  const dir = tmpDir("harry-install-test-");
  try {
    const g = path.join(dir, "CLAUDE.md");
    writeFileSync(g, "# My rules\n");
    const explore = path.join(dir, "agents", "Explore.md");

    withGlobal(g, () => {
      // harry's own override → --remove deletes it
      installRun({ explore: true });
      assert.ok(existsSync(explore), "override present after --explore");
      installRun({ remove: true });
      assert.ok(!existsSync(explore), "--remove deletes harry's marked override");

      // a user's hand-written Explore (no marker) → --remove must NOT touch it
      const mine = "---\nname: Explore\nmodel: opus\n---\nmy own explore\n";
      writeFileSync(explore, mine);
      installRun({ remove: true });
      assert.equal(
        readFileSync(explore, "utf8"),
        mine,
        "--remove leaves an unmarked user Explore intact",
      );
    });
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
