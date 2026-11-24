// Safety behavior of the two install scripts: they rewrite the user's
// hand-authored, un-versioned global file (~/.claude/CLAUDE.md) and a project
// .gitignore, so they must write atomically, keep a one-time backup, and never
// mutate the user's bytes outside harry's marker block. Everything here runs
// against a throwaway temp dir — never the real ~/.claude — via the HARRY_GLOBAL
// override and init's explicit target-dir argument.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { safeWrite, tempPathFor } from "../scripts/lib/atomic-write.mjs";
import { run as initRun } from "../scripts/lib/init-ignore.mjs";
import { run as installRun } from "../scripts/lib/install-laws.mjs";
import { headingSection } from "./section.ts";

const BEGIN = "# >>> harry >>>";
const END = "# <<< harry <<<";

// The plugin's own HARRY.md — the source that install deploys as a snapshot.
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceLaws = readFileSync(path.join(pluginRoot, "HARRY.md"), "utf8");

function tmpDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// The one authoritative residue check, shared by every writer below. It scans the
// fixture tree rather than probing a hardcoded `<target>.tmp`, because temp names
// carry a per-call pid+random suffix (scripts/lib/atomic-write.mjs's tempPathFor):
// a name-probing assertion can never match, so it would pass no matter what
// leaked. Recursive so a leak beside a nested write (the deployed HARRY.md
// snapshot) is caught too.
function assertNoTempResidue(dir: string, what: string): void {
  const residue = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((n) =>
    path.basename(n).includes(".tmp"),
  );
  assert.deepEqual(residue, [], `${what}: temp-file residue left behind`);
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

// The stale-entry WARNING is one piece of knowledge split across two installers:
// the STALE list (scripts/lib/stale-entries.mjs) was single-sourced precisely so
// the two could not drift (the drift test in `references/review-rubric.md`), but the renderer that turns that list
// into the user-facing warning must be single-sourced for the same reason — a
// second copy re-opens the drift the module header claims to have closed.
//
// Matches a DEFINITION in either form — `function warnStale` and
// `const warnStale = …` — but not a call: `warnStale(existing)` is what both
// installers legitimately do, so a bare `warnStale\s*[=(]` would flag them as
// definitions. `=(?!=)` keeps a `warnStale ===` comparison out too.
const WARN_STALE_DEFINITION = /function\s+warnStale\b|\bwarnStale\s*=(?!=)/;

test("warnStale is defined exactly once across scripts/, beside the data it renders", () => {
  const scriptsDir = path.join(pluginRoot, "scripts");
  const defs = readdirSync(scriptsDir, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(".mjs"))
    .filter((rel) => WARN_STALE_DEFINITION.test(readFileSync(path.join(scriptsDir, rel), "utf8")))
    .map((rel) => path.posix.join("scripts", rel.split(path.sep).join("/")))
    .sort();
  assert.deepEqual(
    defs,
    ["scripts/lib/stale-entries.mjs"],
    "warnStale must live once, in the module that owns STALE",
  );
});

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
    assertNoTempResidue(dir, "install.mjs first install");
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

test("install.mjs: run reports each file it acted on, by path", () => {
  withTmp("harry-install-test-", (dir) => {
    const global = path.join(dir, "CLAUDE.md");
    const snapshot = { path: path.join(dir, "harry", "HARRY.md") };
    const explore = path.join(dir, "agents", "Explore.md");
    withGlobal(global, () => {
      assert.deepEqual(installRun(), {
        path: global,
        imported: true,
        snapshot: { ...snapshot, changed: true },
        explore: null,
      });
      assert.deepEqual(installRun({ explore: true }), {
        path: global,
        imported: false,
        snapshot: { ...snapshot, changed: false },
        explore: { path: explore, outcome: "deployed" },
      });
      assert.deepEqual(installRun({ remove: true }), {
        path: global,
        imported: true,
        snapshot: { ...snapshot, changed: false },
        explore: { path: explore, outcome: "removed" },
      });
    });
  });
});

test("init.mjs: appends plain ignore entries (no harry branding) with a .bak", () => {
  const dir = tmpDir("harry-init-test-");
  try {
    const gi = path.join(dir, ".gitignore");
    const original = "node_modules/\n";
    writeFileSync(gi, original);

    initRun(dir);

    const out = readFileSync(gi, "utf8");
    assert.ok(out.includes(".local/"), "entry added");
    assert.ok(out.includes("*worktrees/"), "entry added");
    assert.ok(out.includes("CLAUDE.local.md"), "entry added");
    assert.ok(!out.includes("harry"), "no harry branding written to the shared .gitignore");
    assert.ok(existsSync(`${gi}.bak`), "one-time .bak created");
    assert.equal(readFileSync(`${gi}.bak`, "utf8"), original, ".bak holds the pristine original");
    assertNoTempResidue(dir, "init.mjs");

    initRun(dir, { remove: true });
    const removed = readFileSync(gi, "utf8");
    assert.ok(removed.includes("node_modules/"), "unrelated entries kept");
    assert.ok(!removed.includes("*worktrees/"), "remove strips harry's entries");
    assert.ok(!removed.includes("CLAUDE.local.md"), "remove strips harry's entries");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function withPresetGitignore(fn: (gi: string, lines: () => string[]) => void): void {
  const dir = tmpDir("harry-init-test-");
  try {
    const gi = path.join(dir, ".gitignore");
    writeFileSync(gi, "node_modules/\n.local/\n");
    fn(gi, () => readFileSync(gi, "utf8").split("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("init.mjs: an entry already present is not added twice, while the missing ones are", () => {
  withPresetGitignore((gi, lines) => {
    initRun(path.dirname(gi));
    assert.equal(
      lines().filter((l) => l === ".local/").length,
      1,
      "the present .local/ is not added twice",
    );
    assert.ok(lines().includes("*worktrees/"), "the missing entries are still added");
    assert.ok(lines().includes("CLAUDE.local.md"), "the missing entries are still added");
  });
});

test("init.mjs: --remove strips a hand-typed entry and keeps unrelated lines", () => {
  withPresetGitignore((gi, lines) => {
    initRun(path.dirname(gi), { remove: true });
    assert.ok(
      !lines().includes(".local/"),
      "the hand-typed .local/ goes too: there is no marker to spare it",
    );
    assert.ok(lines().includes("node_modules/"), "unrelated entries kept");
  });
});

// Mutator's worker dirs left untracked made a consumer test that lists untracked files
// read them during a metrics run and fail on a directory symlink. Metrics writes them
// under each group's dir, so each is ignored at any depth.
const METRICS_ENTRIES = [
  "**/.metrics/",
  "**/target/coverage/",
  "**/target/mutation-workers/",
  "**/target/mutator-backup/",
];

// guard.ts clears what metrics writes and the project's coverage output; a dir metrics
// writes is added to metrics-artifacts.mjs, which init reads, never to guard's own list.
test("guard.ts's ARTIFACTS is METRICS_DIRS plus the project's coverage output", () => {
  const guard = readFileSync(path.join(pluginRoot, "src", "lib", "metrics", "guard.ts"), "utf8");
  const list = guard.match(/^const ARTIFACTS = \[([^\]]*)\];$/m)?.[1];
  assert.ok(list, "src/lib/metrics/guard.ts: ARTIFACTS not found");
  const rows = list
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  assert.deepEqual(rows, ["...METRICS_DIRS", '".coverage"', '"coverage"']);
});

const initEntries = (dir: string): string[] => {
  initRun(dir);
  return readFileSync(path.join(dir, ".gitignore"), "utf8").split("\n");
};

test("init.mjs: appends after exactly one blank line, whatever blank lines the file ends in", () => {
  withTmp("harry-init-test-", (dir) => {
    const gi = path.join(dir, ".gitignore");
    writeFileSync(gi, "node_modules/\n\n\n");
    initRun(dir);
    assert.equal(
      readFileSync(gi, "utf8"),
      "node_modules/\n\n.local/\n*worktrees/\nCLAUDE.local.md\n**/.metrics/\n**/target/coverage/\n" +
        "**/target/mutation-workers/\n**/target/mutator-backup/\n",
    );
  });
});

test("init.mjs: ignores every dir metrics writes", () => {
  withTmp("harry-init-test-", (dir) => {
    writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
    const lines = initEntries(dir);
    for (const d of METRICS_ENTRIES) assert.ok(lines.includes(d), `${d} added`);
  });
});

test("init.mjs: --remove takes back the metrics dirs and keeps the user's lines", () => {
  withTmp("harry-init-test-", (dir) => {
    const gi = path.join(dir, ".gitignore");
    writeFileSync(gi, "node_modules/\n");
    initRun(dir);
    initRun(dir, { remove: true });
    const lines = readFileSync(gi, "utf8").split("\n");
    for (const d of METRICS_ENTRIES) assert.ok(!lines.includes(d), `${d} removed`);
    assert.ok(lines.includes("node_modules/"), "the user's line kept");
  });
});

// The user's own excludes file could hold target/ and answer for the repo's .gitignore,
// so git reads no config but the repo's and -v names the rule that matched.
function checkIgnore(cwd: string, probe: string): { status: number | null; stdout: string } {
  const r = spawnSync(
    "git",
    ["-c", "core.excludesFile=/dev/null", "check-ignore", "-v", "--no-index", probe],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    },
  );
  return { status: r.status, stdout: r.stdout };
}

test("init.mjs: a nested group's metrics dirs are ignored, its other target/ dirs are not", () => {
  withTmp("harry-init-test-", (dir) => {
    const init = spawnSync("git", ["init", "-q"], {
      cwd: dir,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
    assert.equal(init.status, 0, String(init.stderr));
    initRun(dir);
    for (const d of METRICS_ENTRIES) {
      for (const probe of [`packages/web/${d.slice(3)}x`, `${d.slice(3)}x`]) {
        const r = checkIgnore(dir, probe);
        assert.equal(r.status, 0, `${probe} is not ignored`);
        assert.ok(r.stdout.startsWith(".gitignore:") && r.stdout.includes(`:${d}\t`), r.stdout);
      }
    }
    assert.equal(checkIgnore(dir, "packages/web/target/release/x").status, 1, "build output kept");
  });
});

// /sync's Phase 2 tells the session what init adds; it still named three entries after
// init had six.
test("references/sync-migration.md Phase 2 names every entry init adds", () => {
  const phase = headingSection(
    readFileSync(path.join(pluginRoot, "references", "sync-migration.md"), "utf8"),
    "references/sync-migration.md",
    "## Phase 2 — Gitignore",
  );
  withTmp("harry-init-test-", (dir) => {
    const entries = initEntries(dir).filter(Boolean);
    assert.ok(entries.length > 0, "init adds no entry to an empty .gitignore");
    const missing = entries.filter((e) => !phase.includes(`\`${e}\``));
    assert.deepEqual(missing, [], "list each entry in backticks");
  });
});

for (const own of ["target/", ".metrics/"]) {
  test(`init.mjs: a ${own} line the user wrote survives init and --remove`, () => {
    withTmp("harry-init-test-", (dir) => {
      const gi = path.join(dir, ".gitignore");
      const lines = (): string[] => readFileSync(gi, "utf8").split("\n");
      writeFileSync(gi, `${own}\n`);
      initRun(dir);
      assert.ok(lines().includes(own), "kept by init");
      initRun(dir, { remove: true });
      assert.ok(lines().includes(own), "kept by --remove");
    });
  });
}

test("safeWrite: backs up once and never clobbers the .bak", () => {
  const dir = tmpDir("harry-safewrite-test-");
  try {
    const f = path.join(dir, "file.txt");
    writeFileSync(f, "v1");

    safeWrite(f, "v2");
    assert.equal(readFileSync(f, "utf8"), "v2", "target updated");
    assert.equal(readFileSync(`${f}.bak`, "utf8"), "v1", "backup holds pristine v1");

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

// The write is atomic per process; concurrency is the remaining hole. Two
// installers running at once (a second /harry:sync, or a sync racing
// `pnpm run install-laws`) share one target — with a fixed `<target>.tmp` they
// write the SAME temp file and rename it twice, so one process can rename a
// half-written file over the user's ~/.claude/CLAUDE.md. That is exactly the
// truncation this module exists to prevent, so the temp name must be unique
// per call while staying a sibling of the target (same filesystem → atomic
// rename).
test("safeWrite: each write picks a unique temp path in the target's directory", () => {
  const dir = tmpDir("harry-safewrite-tmp-");
  try {
    const f = path.join(dir, "file.txt");
    const a = tempPathFor(f);
    const b = tempPathFor(f);

    assert.notEqual(a, b, "two writes to the same target must not share a temp path");
    assert.equal(path.dirname(a), dir, "temp file is a sibling of the target");
    assert.equal(path.dirname(b), dir, "temp file is a sibling of the target");
    assert.ok(path.basename(a).startsWith("file.txt.tmp"), "temp name is traceable to its target");

    // …and the real write still leaves nothing behind under the new naming.
    writeFileSync(f, "v1");
    safeWrite(f, "v2");
    assertNoTempResidue(dir, "completed safeWrite");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Per-call temp names mean a failed write can no longer be reclaimed by the next
// run overwriting a fixed path: whatever it leaves behind accumulates next to the
// user's ~/.claude/CLAUDE.md forever. So the failure path must clean up after
// itself — and must still report the failure, never swallow it.
test("safeWrite: a failed write cleans up its temp file and rethrows", () => {
  const dir = tmpDir("harry-safewrite-fail-");
  try {
    // Make the rename fail, and only the rename: the target is a regular file, so
    // the no-op read succeeds and the temp file is written before the failure. No
    // real filesystem setup fails a rename while the read succeeds, so the rename
    // is mocked; syncBuiltinESMExports carries the mock to atomic-write's named import.
    const target = path.join(dir, "t");
    writeFileSync(target, "old");
    writeFileSync(`${target}.bak`, "old");
    const rename = mock.method(fs, "renameSync", () => {
      throw Object.assign(new Error("rename failed"), { syscall: "rename" });
    });
    syncBuiltinESMExports();

    assert.throws(
      () => safeWrite(target, "new"),
      { syscall: "rename" },
      "the rename failure must surface",
    );
    assert.equal(rename.mock.callCount(), 1, "the temp file reached the rename step");
    assertNoTempResidue(dir, "failed safeWrite");
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});

// The shipped scripts run on the consumer's Node through /sync, with no type
// stripping assumed, so nothing they load may be a .mts or .ts module. Typecheck
// accepts such an import and this repo's own Node runs it, so only this walk sees it.
test("the shipped scripts reach only .mjs modules through their relative imports", () => {
  const entries = ["install.mjs", "init.mjs"].map((f) => path.join(pluginRoot, "scripts", f));
  const seen = new Set<string>();
  const queue = [...entries];
  const offenders: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    // A static import or export, or an await import(): the CLIs load their library late.
    for (const m of source.matchAll(
      /^\s*(?:(?:import|export)\b[^;]*?\bfrom\s+|.*\bimport\()"(\.\.?\/[^"]+)"/gm,
    )) {
      const target = path.resolve(path.dirname(file), m[1] as string);
      if (!target.endsWith(".mjs")) offenders.push(`${path.relative(pluginRoot, file)} → ${m[1]}`);
      else queue.push(target);
    }
  }
  for (const lib of ["init-ignore.mjs", "install-laws.mjs", "tools.mjs"])
    assert.ok(seen.has(path.join(pluginRoot, "scripts", "lib", lib)), `the walk missed ${lib}`);
  assert.deepEqual(offenders, [], "a shipped script reaches a module that needs type stripping");
});

// An installer rewrote its target on every run, even when nothing changed, so it
// could not tell the user whether it had changed anything: `/sync` printed
// "Updated .gitignore" over a file it left byte-identical.
test("safeWrite: content equal to the target's writes nothing and returns false", () => {
  const dir = tmpDir("harry-safewrite-test-");
  try {
    const f = path.join(dir, "file.txt");
    writeFileSync(f, "same");
    utimesSync(f, 0, 0);
    assert.equal(safeWrite(f, "same"), false, "an unchanged write reports false");
    assert.equal(statSync(f).mtimeMs, 0, "the target was not rewritten");
    assert.ok(!existsSync(`${f}.bak`), "no backup for a write that changed nothing");
    assert.equal(safeWrite(f, "new"), true, "a real write reports true");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("safeWrite: empty content over a missing target creates nothing", () => {
  const dir = tmpDir("harry-safewrite-test-");
  try {
    const missing = path.join(dir, "missing.txt");
    assert.equal(safeWrite(missing, ""), false, "empty content over a missing target is no change");
    assert.ok(!existsSync(missing), "a missing target is not created empty");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

type CliResult = { stdout: string; stderr: string };

function cli(
  script: string,
  args: string[],
  env: Record<string, string> = {},
  { expectStatus = 0 }: { expectStatus?: number } = {},
): CliResult {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", script), ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(
    r.status,
    expectStatus,
    `${script} ${args.join(" ")} exited ${r.status}: ${r.stderr}`,
  );
  return { stdout: r.stdout, stderr: r.stderr };
}

function withTmp(prefix: string, fn: (dir: string) => void): void {
  const dir = tmpDir(prefix);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("init.mjs CLI: a first run says Updated", () => {
  withTmp("harry-init-cli-", (dir) => {
    assert.match(cli("init.mjs", [dir]).stdout, /^Updated /);
  });
});

test("init.mjs CLI: a re-run that changes nothing says so", () => {
  withTmp("harry-init-cli-", (dir) => {
    cli("init.mjs", [dir]);
    assert.match(cli("init.mjs", [dir]).stdout, /^Already up to date: /);
  });
});

test("init.mjs CLI: --remove says what it removed", () => {
  withTmp("harry-init-cli-", (dir) => {
    cli("init.mjs", [dir]);
    assert.match(cli("init.mjs", ["--remove", dir]).stdout, /^Removed harry's entries from /);
  });
});

test("init.mjs CLI: --remove with no .gitignore says there is nothing to remove", () => {
  withTmp("harry-init-cli-", (dir) => {
    assert.match(cli("init.mjs", ["--remove", dir]).stdout, /^No harry entries to remove in /);
  });
});

test("init.mjs CLI: --remove with no .gitignore creates none", () => {
  withTmp("harry-init-cli-", (dir) => {
    cli("init.mjs", ["--remove", dir]);
    assert.ok(!existsSync(path.join(dir, ".gitignore")), "no .gitignore created");
  });
});

test("init.mjs CLI: a missing target directory is one stderr line and exit 1", () => {
  withTmp("harry-init-cli-", (dir) => {
    const r = cli("init.mjs", [path.join(dir, "typo")], {}, { expectStatus: 1 });
    assert.match(r.stderr, /^harry: not a directory: .*typo\n$/, "one line, no stack trace");
  });
});

test("init.mjs CLI: a file as target is one stderr line and exit 1", () => {
  withTmp("harry-init-cli-", (dir) => {
    const file = path.join(dir, "a-file");
    writeFileSync(file, "");
    const r = cli("init.mjs", [file], {}, { expectStatus: 1 });
    assert.match(r.stderr, /^harry: not a directory: .*a-file\n$/, "one line, no stack trace");
  });
});

// The CLI prints the paths run acted on; a prefix match cannot tell one path from another.
test("install.mjs CLI: --explore then --remove print each file's full path", () => {
  withTmp("harry-install-cli-", (dir) => {
    const env = { HARRY_GLOBAL: path.join(dir, "CLAUDE.md") };
    assert.equal(
      cli("install.mjs", ["--explore"], env).stdout,
      `Wired HARRY.md into ${dir}/CLAUDE.md\n` +
        `Deployed HARRY.md snapshot to ${dir}/harry/HARRY.md\n` +
        `Deployed Explore override to ${dir}/agents/Explore.md\n`,
    );
    assert.equal(
      cli("install.mjs", ["--remove"], env).stdout,
      `Removed harry import from ${dir}/CLAUDE.md\n` +
        `Removed Explore override ${dir}/agents/Explore.md\n`,
    );
  });
});

test("install.mjs CLI: a first run names the global file and each deployed file", () => {
  withTmp("harry-install-cli-", (dir) => {
    const out = cli("install.mjs", ["--explore"], { HARRY_GLOBAL: path.join(dir, "CLAUDE.md") });
    assert.match(
      out.stdout,
      /^Wired HARRY\.md into .*\nDeployed HARRY\.md snapshot to .*\nDeployed Explore override to /,
    );
  });
});

test("install.mjs CLI: a re-run that changes nothing says so", () => {
  withTmp("harry-install-cli-", (dir) => {
    const env = { HARRY_GLOBAL: path.join(dir, "CLAUDE.md") };
    cli("install.mjs", ["--explore"], env);
    assert.match(cli("install.mjs", ["--explore"], env).stdout, /^Already up to date: [^\n]*\n$/);
  });
});

test("install.mjs CLI: a resync that only refreshes the snapshot names only the snapshot", () => {
  withTmp("harry-install-cli-", (dir) => {
    const env = { HARRY_GLOBAL: path.join(dir, "CLAUDE.md") };
    cli("install.mjs", [], env);
    writeFileSync(path.join(dir, "harry", "HARRY.md"), "an older HARRY.md\n");
    assert.match(cli("install.mjs", [], env).stdout, /^Deployed HARRY\.md snapshot to [^\n]*\n$/);
  });
});

test("install.mjs CLI: --remove names the global file and the removed override", () => {
  withTmp("harry-install-cli-", (dir) => {
    const env = { HARRY_GLOBAL: path.join(dir, "CLAUDE.md") };
    cli("install.mjs", ["--explore"], env);
    assert.match(
      cli("install.mjs", ["--remove"], env).stdout,
      /^Removed harry import from .*\nRemoved Explore override /,
    );
  });
});

test("install.mjs CLI: --remove with nothing installed says so", () => {
  withTmp("harry-install-cli-", (dir) => {
    const env = { HARRY_GLOBAL: path.join(dir, "CLAUDE.md") };
    assert.match(
      cli("install.mjs", ["--remove"], env).stdout,
      /^No harry import to remove in [^\n]*\n$/,
    );
  });
});

test("install.mjs CLI: a deploy skipped for a user's own Explore.md is reported as a skip", () => {
  withTmp("harry-install-cli-", (dir) => {
    mkdirSync(path.join(dir, "agents"));
    writeFileSync(path.join(dir, "agents", "Explore.md"), "my own\n");
    const r = cli("install.mjs", ["--explore"], { HARRY_GLOBAL: path.join(dir, "CLAUDE.md") });
    assert.match(r.stdout, /^Wired HARRY\.md into /);
    assert.doesNotMatch(r.stdout, /Deployed Explore override/);
    assert.match(r.stderr, /isn't harry's — leaving it untouched/);
  });
});

test("install.mjs CLI: --remove that only drops the Explore override names that file", () => {
  withTmp("harry-install-cli-", (dir) => {
    mkdirSync(path.join(dir, "agents"));
    writeFileSync(path.join(dir, "agents", "Explore.md"), "harry:explore-override\n");
    assert.match(
      cli("install.mjs", ["--remove"], { HARRY_GLOBAL: path.join(dir, "CLAUDE.md") }).stdout,
      /^Removed Explore override [^\n]*\n$/,
    );
  });
});

test("install.mjs CLI: --remove on a fresh home creates no directory", () => {
  withTmp("harry-install-cli-", (dir) => {
    cli("install.mjs", ["--remove"], { HARRY_GLOBAL: path.join(dir, "claude", "CLAUDE.md") });
    assert.ok(!existsSync(path.join(dir, "claude")), "no empty claude/ left behind");
  });
});

test("init.mjs: a missing target directory is an error, not a directory to create", () => {
  const dir = tmpDir("harry-init-test-");
  try {
    const missing = path.join(dir, "typo");
    assert.throws(() => initRun(missing), /not a directory/);
    assert.ok(!existsSync(missing), "the typo'd directory was not created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
