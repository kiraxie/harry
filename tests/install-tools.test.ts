/**
 * `install.mjs --tools`: clone crapper, dryer and mutator at harry's pins into
 * the tools dir. Runs against local bare repos in temp dirs, never GitHub.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PINNED_TOOLS, syncTools, toolReadiness } from "../scripts/lib/tools.mjs";
import { SCHEDULE_READ_AT } from "../src/lib/metrics/mutator.ts";
import { findTool, isMissing, TOOL_NAMES, type ToolName } from "../src/lib/metrics/tools.ts";

const INSTALL = path.resolve(import.meta.dirname, "../scripts/install.mjs");

const cleanup: string[] = [];
test.after(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanup.push(d);
  return d;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@e", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
}

interface Source {
  name: string;
  url: string;
  pin: string;
  later: string;
}

/** Builds a venv whose --help passes, holding the dist-info of the project named in the clone's `.dist`. */
const BUILDS_VENV = `#!/bin/sh
dir="$(dirname "$0")"
site="$dir/.venv/lib/python3.13/site-packages"
mkdir -p "$dir/.venv/bin" "$site/$(cat "$dir/.dist")-1.0.dist-info"
touch "$dir/.venv/bin/python" && chmod 755 "$dir/.venv/bin/python"
`;

/** As the real launchers do: builds the venv only when its python is missing, and needs the install to have finished. */
const NEEDS_INSTALLED_VENV = `#!/bin/sh
dir="$(dirname "$0")"
venv="$dir/.venv"
if [ ! -e "$venv/bin/python" ]; then
  mkdir -p "$venv/bin" "$venv/lib/python3.13/site-packages/$(cat "$dir/.dist")-1.0.dist-info"
  touch "$venv/bin/python" "$venv/installed" && chmod 755 "$venv/bin/python"
fi
[ -e "$venv/installed" ] || { echo "No module named tool" >&2; exit 1; }
`;

/** Half-builds its venv on every run, then fails, as an old pip refusing the install does. */
const ALWAYS_FAILS = `#!/bin/sh
mkdir -p "$(dirname "$0")/.venv/bin" && touch "$(dirname "$0")/.venv/bin/python"
echo "pip refused the install" >&2
exit 1
`;

/** Fails before it builds any venv, as a machine with no python3 does. */
const FAILS_WITHOUT_VENV = '#!/bin/sh\necho "python3: command not found" >&2\nexit 1\n';

/** Half-builds its venv and fails; from its second run on it also leaves its clone unwritable. */
const UNWRITABLE_ON_RETRY = `#!/bin/sh
dir="$(dirname "$0")"
mkdir -p "$dir/.venv/bin" && touch "$dir/.venv/bin/python"
if [ -e "$dir/.git/ran-once" ]; then chmod 555 "$dir"; else touch "$dir/.git/ran-once"; fi
echo "pip refused the install" >&2
exit 1
`;

/** A bare repo whose first commit is the pin and whose second is newer; its launcher builds .venv. */
function source(name: string, launcherBody = BUILDS_VENV, installs = name): Source {
  const work = tempDir(`harry-tool-${name}-`);
  git(work, ["init", "-q", "-b", "main"]);
  writeFileSync(path.join(work, ".gitignore"), ".venv/\n");
  writeFileSync(path.join(work, ".dist"), `${installs}\n`);
  const launcher = path.join(work, name);
  writeFileSync(launcher, launcherBody);
  chmodSync(launcher, 0o755);
  git(work, ["add", "-A"]);
  git(work, ["commit", "-q", "-m", "pin"]);
  const pin = git(work, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(work, "NEWS"), "newer\n");
  git(work, ["add", "-A"]);
  git(work, ["commit", "-q", "-m", "later"]);
  const later = git(work, ["rev-parse", "HEAD"]);
  const bare = `${tempDir(`harry-tool-${name}-bare-`)}/repo.git`;
  git(work, ["clone", "-q", "--bare", work, bare]);
  return { name, url: bare, pin, later };
}

function sources(launcherBody = BUILDS_VENV): Source[] {
  return ["crapper", "dryer", "mutator"].map((name) => source(name, launcherBody));
}

const asTools = (s: Source[]) =>
  s.map(({ name, url, pin }) => ({ name, dist: name, url, commit: pin }));

/** Runs `fn` with HOME at a fresh temp dir; returns the tools dir sync writes to there. */
function inHome<T>(fn: (dir: string) => T, home = tempDir("harry-tools-home-")): T {
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn(path.join(home, ".claude", "harry", "tools"));
  } finally {
    process.env.HOME = prev;
  }
}

test("a fresh sync leaves each tool at its pin, already run once", () => {
  const src = sources();

  const [dir, results] = inHome((d) => [d, syncTools({ tools: asTools(src) })] as const);

  for (const s of src) {
    const clone = path.join(dir, s.name);
    assert.equal(git(clone, ["rev-parse", "HEAD"]), s.pin);
    assert.ok(existsSync(path.join(clone, ".venv")), `${s.name} was not run once`);
  }
  assert.deepEqual(
    results.map((r) => [r.name, r.outcome]),
    src.map((s) => [s.name, "cloned"]),
  );
});

test("an existing clean clone moves to the pin", () => {
  const src = sources();
  const home = tempDir("harry-tools-home-");
  const dir = path.join(home, ".claude", "harry", "tools");
  mkdirSync(dir, { recursive: true });
  for (const s of src) git(dir, ["clone", "-q", s.url, s.name]);
  assert.equal(git(path.join(dir, "dryer"), ["rev-parse", "HEAD"]), src[1].later);

  const results = inHome(() => syncTools({ tools: asTools(src) }), home);

  for (const s of src) assert.equal(git(path.join(dir, s.name), ["rev-parse", "HEAD"]), s.pin);
  assert.deepEqual(
    results.map((r) => r.outcome),
    ["moved", "moved", "moved"],
  );
});

test("a clone with local changes is left as it is and reported", () => {
  const src = [source("crapper"), source("dryer"), source("mutator", ALWAYS_FAILS)];
  const home = tempDir("harry-tools-home-");
  const dir = path.join(home, ".claude", "harry", "tools");
  mkdirSync(dir, { recursive: true });
  for (const s of src) git(dir, ["clone", "-q", s.url, s.name]);
  const edited = path.join(dir, "mutator", "NEWS");
  writeFileSync(edited, "my local patch\n");
  const kept = path.join(dir, "mutator", ".venv", "mine");
  mkdirSync(path.dirname(kept));
  writeFileSync(kept, "mine\n");

  const results = inHome(() => syncTools({ tools: asTools(src) }), home);

  const mutator = results.find((r) => r.name === "mutator");
  assert.equal(mutator?.outcome, "local changes");
  assert.equal(git(path.join(dir, "mutator"), ["rev-parse", "HEAD"]), src[2].later);
  assert.equal(readFileSync(edited, "utf8"), "my local patch\n");
  assert.equal(readFileSync(kept, "utf8"), "mine\n");
  assert.equal(git(path.join(dir, "crapper"), ["rev-parse", "HEAD"]), src[0].pin);
});

test("a clone at its pin whose venv is missing is run again and rebuilt", () => {
  const src = sources();
  const [dir] = inHome((d) => [d, syncTools({ tools: asTools(src) })] as const);
  rmSync(path.join(dir, "dryer", ".venv"), { recursive: true });

  const results = inHome(
    () => syncTools({ tools: asTools(src) }),
    path.dirname(path.dirname(path.dirname(dir))),
  );

  assert.equal(results.find((r) => r.name === "dryer")?.outcome, "current");
  assert.ok(existsSync(path.join(dir, "dryer", ".venv")));
});

test("a clone at its pin whose venv cannot run the tool is rebuilt in the same sync", () => {
  const src = sources(NEEDS_INSTALLED_VENV);
  const home = tempDir("harry-tools-home-");
  const dir = inHome((d) => {
    syncTools({ tools: asTools(src) });
    return d;
  }, home);
  const venv = path.join(dir, "dryer", ".venv");
  rmSync(path.join(venv, "installed"));
  assert.ok(existsSync(path.join(venv, "bin", "python")), "the broken venv still looks built");

  const results = inHome(() => syncTools({ tools: asTools(src) }), home);

  assert.deepEqual(
    results.map((r) => [r.name, r.outcome]),
    src.map((s) => [s.name, "current"]),
  );
  assert.ok(existsSync(path.join(venv, "installed")), "the venv was not rebuilt");
});

test("a tool that still fails after the retry is left with no venv, and its report says so", () => {
  const src = sources(ALWAYS_FAILS);

  const [dir, results] = inHome((d) => [d, syncTools({ tools: asTools(src) })] as const);

  for (const r of results) {
    assert.equal(r.outcome, "failed", r.name);
    assert.match(r.detail, /pip refused the install/, "the launcher's own error is reported");
    assert.match(r.detail, /\.venv was removed/);
    assert.ok(!existsSync(path.join(dir, r.name, ".venv")), `${r.name} kept its venv`);
  }
});

test("a tool whose first run passes but leaves the venv without its package is rebuilt once, then reported not ready", () => {
  const src = [source("mutator", BUILDS_VENV, "other_pkg")];

  const [dir, results] = inHome((d) => [d, syncTools({ tools: asTools(src) })] as const);

  const venv = path.join(dir, "mutator", ".venv");
  assert.equal(results[0].outcome, "failed");
  assert.equal(
    results[0].detail,
    `first run failed twice: not ready: package at ${venv}; its .venv was removed`,
  );
  assert.ok(!existsSync(venv), "the half-built venv was kept");
});

test("metrics finds installed exactly the tools sync reports usable", () => {
  const src = [
    source("crapper"),
    source("dryer", ALWAYS_FAILS),
    source("mutator", BUILDS_VENV, "other_pkg"),
  ];

  const home = tempDir("harry-tools-home-");
  const atLater = src.map(({ name, url, later }) => ({ name, dist: name, url, commit: later }));
  for (const [run, tools, outcome] of [
    [1, asTools(src), "cloned"],
    [2, asTools(src), "current"],
    [3, atLater, "moved"],
  ] as const) {
    const [results, found] = inHome(() => {
      const results = syncTools({ tools });
      return [results, results.map((r) => !isMissing(findTool(r.name as ToolName)))] as const;
    }, home);

    assert.equal(results[0].outcome, outcome, `sync ${run}`);
    const usable = results.map((r) => ["cloned", "moved", "current"].includes(r.outcome));
    assert.deepEqual(
      found,
      usable,
      `sync ${run}: metrics and sync disagree on which tools are usable`,
    );
    assert.deepEqual(
      usable,
      [true, false, false],
      `sync ${run}: the fixture no longer covers both answers`,
    );
  }
});

test("a first run that fails before building a venv reports stderr, then the spawn error, then the exit status", () => {
  const cases = [
    { name: "stderr", launcher: FAILS_WITHOUT_VENV, want: () => "python3: command not found" },
    {
      name: "spawn error",
      launcher: "#!/nonexistent/sh\n",
      want: (launcher: string) => `spawnSync ${launcher} ENOENT`,
    },
    { name: "exit status", launcher: "#!/bin/sh\nexit 3\n", want: () => "exit 3" },
  ];
  for (const c of cases) {
    const src = [source("crapper", c.launcher)];

    const [dir, results] = inHome((d) => [d, syncTools({ tools: asTools(src) })] as const);

    assert.equal(results[0].outcome, "failed", c.name);
    const launcher = path.join(dir, "crapper", "crapper");
    assert.equal(results[0].detail, `first run failed: ${c.want(launcher)}`, c.name);
  }
});

test("a venv left by the failed retry that cannot be removed is not reported as removed", () => {
  const src = [source("crapper", UNWRITABLE_ON_RETRY)];
  const home = tempDir("harry-tools-home-");
  const clone = path.join(home, ".claude", "harry", "tools", "crapper");

  let results: ReturnType<typeof syncTools>;
  try {
    results = inHome(() => syncTools({ tools: asTools(src) }), home);
  } finally {
    chmodSync(clone, 0o755);
  }

  assert.equal(results[0].outcome, "failed");
  assert.match(results[0].detail, /pip refused the install/);
  assert.match(results[0].detail, /could not remove/);
  assert.doesNotMatch(results[0].detail, /was removed/);
});

test("a broken venv that cannot be removed is reported, and the other tools still sync", () => {
  const src = sources(NEEDS_INSTALLED_VENV);
  const home = tempDir("harry-tools-home-");
  const dir = inHome((d) => {
    syncTools({ tools: asTools(src) });
    return d;
  }, home);
  const clone = path.join(dir, "crapper");
  rmSync(path.join(clone, ".venv", "installed"));
  chmodSync(clone, 0o555);

  let results: ReturnType<typeof syncTools>;
  try {
    results = inHome(() => syncTools({ tools: asTools(src) }), home);
  } finally {
    chmodSync(clone, 0o755);
  }

  assert.deepEqual(
    results.map((r) => [r.name, r.outcome]),
    [
      ["crapper", "failed"],
      ["dryer", "current"],
      ["mutator", "current"],
    ],
  );
  assert.match(results[0].detail, /could not remove/);
  assert.doesNotMatch(results[0].detail, /was removed/);
});

test("a tools entry that is not its own git clone is reported, never treated as the repo above it", () => {
  const src = sources();
  const home = tempDir("harry-tools-home-");
  git(home, ["init", "-q"]);
  const plain = path.join(home, ".claude", "harry", "tools", "crapper");
  mkdirSync(plain, { recursive: true });
  writeFileSync(path.join(plain, "notes.txt"), "mine\n");
  writeFileSync(path.join(plain, "crapper"), ALWAYS_FAILS);
  chmodSync(path.join(plain, "crapper"), 0o755);
  const kept = path.join(plain, ".venv", "mine");
  mkdirSync(path.dirname(kept));
  writeFileSync(kept, "mine\n");

  const results = inHome(() => syncTools({ tools: asTools(src) }), home);

  const crapper = results.find((r) => r.name === "crapper");
  assert.equal(crapper?.outcome, "failed");
  assert.match(crapper?.detail ?? "", /not a git clone/);
  assert.equal(readFileSync(path.join(plain, "notes.txt"), "utf8"), "mine\n");
  assert.equal(readFileSync(kept, "utf8"), "mine\n");
});

test("install.mjs --tools prints its full report and exits 1 when a tool failed", () => {
  const home = tempDir("harry-tools-cli-home-");
  const mirror = tempDir("harry-tools-mirror-");
  for (const s of sources()) git(mirror, ["clone", "-q", "--bare", s.url, `${s.name}.git`]);
  const res = spawnSync(process.execPath, [INSTALL, "--tools"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      HARRY_GLOBAL: path.join(home, ".claude", "CLAUDE.md"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${mirror}/.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/unclebob/",
    },
  });

  assert.equal(res.status, 1, res.stderr);
  const dir = path.join(home, ".claude", "harry", "tools");
  assert.match(res.stdout, new RegExp(`Tools dir: ${dir}`));
  for (const name of ["crapper", "dryer", "mutator"]) {
    assert.match(res.stdout, new RegExp(`tool ${name}: failed \\(.*tree`), res.stdout);
    assert.equal(
      git(path.join(dir, name), ["remote", "get-url", "origin"]),
      `https://github.com/unclebob/${name}.git`,
    );
    assert.ok(existsSync(path.join(dir, name, "NEWS")), "cloned from the local mirror");
    assert.ok(!existsSync(path.join(dir, name, ".venv")));
  }
});

test("install.mjs --tools exits 0 when every tool was left for its local changes", () => {
  const home = tempDir("harry-tools-cli-home-");
  const dir = path.join(home, ".claude", "harry", "tools");
  mkdirSync(dir, { recursive: true });
  for (const s of sources()) {
    git(dir, ["clone", "-q", s.url, s.name]);
    writeFileSync(path.join(dir, s.name, "NEWS"), "my local patch\n");
  }

  const res = spawnSync(process.execPath, [INSTALL, "--tools"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, HARRY_GLOBAL: path.join(home, ".claude", "CLAUDE.md") },
  });

  assert.equal(res.status, 0, res.stderr);
  for (const name of ["crapper", "dryer", "mutator"]) {
    assert.match(res.stdout, new RegExp(`tool ${name}: local changes`), res.stdout);
  }
});

test("install.mjs --tools exits 1 when one tool failed beside others left for local changes", () => {
  const home = tempDir("harry-tools-cli-home-");
  const dir = path.join(home, ".claude", "harry", "tools");
  const mirror = tempDir("harry-tools-mirror-");
  mkdirSync(dir, { recursive: true });
  for (const s of sources()) {
    if (s.name === "mutator") {
      git(mirror, ["clone", "-q", "--bare", s.url, `${s.name}.git`]);
      continue;
    }
    git(dir, ["clone", "-q", s.url, s.name]);
    writeFileSync(path.join(dir, s.name, "NEWS"), "my local patch\n");
  }

  const res = spawnSync(process.execPath, [INSTALL, "--tools"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      HARRY_GLOBAL: path.join(home, ".claude", "CLAUDE.md"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${mirror}/.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/unclebob/",
    },
  });

  assert.match(res.stdout, /tool crapper: local changes/);
  assert.match(res.stdout, /tool dryer: local changes/);
  assert.match(res.stdout, /tool mutator: failed/);
  assert.equal(res.status, 1, res.stderr);
});

test("sync never runs a git from a relative PATH entry, such as a repo's own ./git", () => {
  const src = sources();
  const repo = tempDir("harry-tools-trap-");
  const marker = path.join(repo, "trap-ran");
  writeFileSync(path.join(repo, "git"), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
  chmodSync(path.join(repo, "git"), 0o755);
  const prev = { cwd: process.cwd(), PATH: process.env.PATH };
  process.chdir(repo);
  process.env.PATH = `.:${prev.PATH}`;
  try {
    inHome(() => syncTools({ tools: asTools(src) }));
  } finally {
    process.chdir(prev.cwd);
    process.env.PATH = prev.PATH;
  }
  assert.ok(!existsSync(marker), "the repo's ./git ran");
});

test("install.mjs without --tools never touches the tools dir", () => {
  const home = tempDir("harry-tools-cli-home-");
  const res = spawnSync(process.execPath, [INSTALL], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, HARRY_GLOBAL: path.join(home, ".claude", "CLAUDE.md") },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!existsSync(path.join(home, ".claude", "harry", "tools")));
});

test("the pins name exactly the tools metrics looks for, each at a full commit with its package name", () => {
  assert.deepEqual(PINNED_TOOLS.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
  for (const t of PINNED_TOOLS) {
    assert.match(t.commit, /^[0-9a-f]{40}$/, t.name);
    assert.match(t.dist, /^\S+$/, t.name);
  }
});

const OVERLAY_CHECK = path.resolve(import.meta.dirname, "../src/lib/metrics/overlay-check.py");

/** Each mutator module the overlay check imports from, with the names it takes. */
function overlayImports(): { module: string; names: string[] }[] {
  const text = readFileSync(OVERLAY_CHECK, "utf8");
  return [...text.matchAll(/^from mutator\.(\w+) import (.+)$/gm)].map((m) => ({
    module: `${m[1]}.py`,
    names: m[2].split(",").map((n) => n.trim()),
  }));
}

const PIN_MOVED = `the mutator pin moved: re-read worker_count (workers.py), the per-invocation baseline cache (cli.py) and its (command, cwd) key (engine.py) at the new commit, update runCost in src/lib/metrics/mutator.ts and the executing skill's Workers bullet to match; check that src/lib/metrics/overlay-check.py's imports (${overlayImports()
  .map((i) => `${i.names.join(", ")} from ${i.module}`)
  .join(
    "; ",
  )}) still build and run a worker as mutator does; then set SCHEDULE_READ_AT to the new pin`;

test("the mutator pin is the commit runCost's scheduling facts and the overlay check's imports were read at", () => {
  const pin = PINNED_TOOLS.find((t) => t.name === "mutator")?.commit;
  assert.equal(pin, SCHEDULE_READ_AT, PIN_MOVED);
});

test("SCHEDULE_READ_AT's comment names every mutator internal the overlay check imports", () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../src/lib/metrics/mutator.ts"),
    "utf8",
  );
  const doc =
    /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\nexport const SCHEDULE_READ_AT/.exec(source)?.[1] ?? "";
  const imports = overlayImports();
  assert.ok(imports.length > 0, "overlay-check.py imports nothing from mutator");
  for (const { module, names } of imports) {
    for (const name of names) {
      assert.match(doc, new RegExp(`\`${name}\`[^.;]*\\(${module.replace(".", "\\.")}\\)`), name);
    }
  }
});

test("toolReadiness names the first missing piece, and finds the package by the pin's dist in normalized form", () => {
  const pin = { name: "mutator", dist: "mutator", url: "", commit: "" };
  const cases: {
    name: string;
    tool?: typeof pin;
    launcher?: boolean;
    python?: boolean;
    dirs?: string[];
    want: { kind: string; path: string } | null;
  }[] = [
    { name: "no launcher", launcher: false, want: { kind: "launcher", path: "mutator" } },
    { name: "no venv Python", python: false, want: { kind: "python", path: ".venv/bin/python" } },
    { name: "no .venv/lib", want: { kind: "package", path: ".venv" } },
    {
      name: "own dist-info",
      dirs: ["pip-25.0.dist-info", "mutator-0.1.0.dist-info"],
      want: null,
    },
    {
      name: "only other packages",
      dirs: ["pip-25.0.dist-info", "tree_sitter-0.25.dist-info"],
      want: { kind: "package", path: ".venv" },
    },
    {
      name: "a longer name sharing the prefix",
      dirs: ["mutatorx-1.0.dist-info"],
      want: { kind: "package", path: ".venv" },
    },
    {
      name: "a dist that differs from the tool name is found by the dist",
      tool: { ...pin, dist: "mut-core" },
      dirs: ["mut_core-1.0.dist-info"],
      want: null,
    },
    {
      name: "a dist that differs from the tool name is not found by the tool name",
      tool: { ...pin, dist: "mut-core" },
      dirs: ["mutator-0.1.0.dist-info"],
      want: { kind: "package", path: ".venv" },
    },
    {
      name: "a run of separators collapses to one underscore",
      tool: { ...pin, dist: "My--Tool" },
      dirs: ["my_tool-1.0.dist-info"],
      want: null,
    },
    {
      name: "case, dots and dashes normalize to the dist-info form",
      tool: { ...pin, dist: "My.Tool" },
      dirs: ["my_tool-1.0.dist-info"],
      want: null,
    },
  ];
  for (const c of cases) {
    const clone = tempDir("harry-tools-ready-");
    if (c.launcher !== false) {
      writeFileSync(path.join(clone, "mutator"), "#!/bin/sh\n");
      chmodSync(path.join(clone, "mutator"), 0o755);
    }
    if (c.python !== false) {
      mkdirSync(path.join(clone, ".venv/bin"), { recursive: true });
      writeFileSync(path.join(clone, ".venv/bin/python"), "");
      chmodSync(path.join(clone, ".venv/bin/python"), 0o755);
    }
    for (const d of c.dirs ?? []) {
      mkdirSync(path.join(clone, ".venv/lib/python3.13/site-packages", d), { recursive: true });
    }
    const want = c.want && { kind: c.want.kind, path: path.join(clone, c.want.path) };
    assert.deepEqual(toolReadiness(clone, c.tool ?? pin), want, c.name);
  }
});
