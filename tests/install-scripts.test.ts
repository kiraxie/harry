// Safety behavior of the three install scripts: they rewrite the user's
// hand-authored, un-versioned global files (~/.claude/CLAUDE.md,
// ~/.codex/AGENTS.md) and a project .gitignore, so they must write atomically,
// keep a one-time backup, and never mutate the user's bytes outside harry's
// marker block. Everything here runs against a throwaway temp dir — never the
// real ~/.claude — via the HARRY_GLOBAL / HARRY_CODEX_GLOBAL overrides and
// init's explicit target-dir argument.

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
import { run as initRun } from "../scripts/init.mjs";
import { run as installRun } from "../scripts/install.mjs";
import { run as codexRun } from "../scripts/install-codex.mjs";
import { safeWrite, tempPathFor } from "../scripts/lib/atomic-write.mjs";

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
      for (const role of ["scout", "analyst", "referee"]) {
        assert.ok(out.includes(role), `role map names ${role}`);
      }
      for (const model of ["gpt-5.6-luna"]) {
        assert.ok(out.includes(model), `role map binds ${model}`);
      }
      // gpt-5.6-sol 400s on a ChatGPT login; it may appear only in the note saying so.
      const solRows = out.split("\n").filter((l) => l.startsWith("|") && l.includes("gpt-5.6-sol"));
      assert.deepEqual(solRows, [], "no role-map row binds gpt-5.6-sol");
      assert.ok(existsSync(`${g}.bak`), "one-time .bak created");
      assert.equal(readFileSync(`${g}.bak`, "utf8"), original, ".bak holds the pristine original");
      assertNoTempResidue(dir, "install-codex.mjs");
    } finally {
      if (prev === undefined) delete process.env.HARRY_CODEX_GLOBAL;
      else process.env.HARRY_CODEX_GLOBAL = prev;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Residue is NOT re-checked here — the temp-path test below owns that assertion.
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
  const entries = ["install.mjs", "install-codex.mjs", "init.mjs"].map((f) =>
    path.join(pluginRoot, "scripts", f),
  );
  const seen = new Set<string>();
  const queue = [...entries];
  const offenders: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"(\.\.?\/[^"]+)"/gms)) {
      const target = path.resolve(path.dirname(file), m[1] as string);
      if (!target.endsWith(".mjs")) offenders.push(`${path.relative(pluginRoot, file)} → ${m[1]}`);
      else queue.push(target);
    }
  }
  assert.ok(seen.size > entries.length, "the walk followed the scripts' lib imports");
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

test("install-codex.mjs CLI: a first run says Wired", () => {
  withTmp("harry-codex-cli-", (dir) => {
    const env = { HARRY_CODEX_GLOBAL: path.join(dir, "AGENTS.md") };
    assert.match(cli("install-codex.mjs", [], env).stdout, /^Wired HARRY\.md into /);
  });
});

test("install-codex.mjs CLI: a re-run that changes nothing says so", () => {
  withTmp("harry-codex-cli-", (dir) => {
    const env = { HARRY_CODEX_GLOBAL: path.join(dir, "AGENTS.md") };
    cli("install-codex.mjs", [], env);
    assert.match(cli("install-codex.mjs", [], env).stdout, /^Already up to date: /);
  });
});

test("install-codex.mjs CLI: --remove says what it removed", () => {
  withTmp("harry-codex-cli-", (dir) => {
    const env = { HARRY_CODEX_GLOBAL: path.join(dir, "AGENTS.md") };
    cli("install-codex.mjs", [], env);
    assert.match(cli("install-codex.mjs", ["--remove"], env).stdout, /^Removed harry laws from /);
  });
});

test("install-codex.mjs CLI: --remove with nothing installed says so", () => {
  withTmp("harry-codex-cli-", (dir) => {
    const env = { HARRY_CODEX_GLOBAL: path.join(dir, "AGENTS.md") };
    assert.match(
      cli("install-codex.mjs", ["--remove"], env).stdout,
      /^No harry laws to remove in /,
    );
  });
});

test("install-codex.mjs CLI: --remove on a fresh home creates no directory", () => {
  withTmp("harry-codex-cli-", (dir) => {
    cli("install-codex.mjs", ["--remove"], {
      HARRY_CODEX_GLOBAL: path.join(dir, "codex", "AGENTS.md"),
    });
    assert.ok(!existsSync(path.join(dir, "codex")), "no empty codex/ left behind");
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
