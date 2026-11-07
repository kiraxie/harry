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

import { PINNED_TOOLS, syncTools } from "../scripts/lib/tools.mjs";
import { TOOL_NAMES } from "../src/lib/metrics/tools.ts";

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

/** A bare repo whose first commit is the pin and whose second is newer; its launcher builds .venv. */
function source(name: string): Source {
  const work = tempDir(`harry-tool-${name}-`);
  git(work, ["init", "-q", "-b", "main"]);
  writeFileSync(path.join(work, ".gitignore"), ".venv/\n");
  const launcher = path.join(work, name);
  writeFileSync(launcher, '#!/bin/sh\nmkdir -p "$(dirname "$0")/.venv"\n');
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

function sources(): Source[] {
  return ["crapper", "dryer", "mutator"].map(source);
}

const asTools = (s: Source[]) => s.map(({ name, url, pin }) => ({ name, url, commit: pin }));

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
  const src = sources();
  const home = tempDir("harry-tools-home-");
  const dir = path.join(home, ".claude", "harry", "tools");
  mkdirSync(dir, { recursive: true });
  for (const s of src) git(dir, ["clone", "-q", s.url, s.name]);
  const edited = path.join(dir, "mutator", "NEWS");
  writeFileSync(edited, "my local patch\n");

  const results = inHome(() => syncTools({ tools: asTools(src) }), home);

  const mutator = results.find((r) => r.name === "mutator");
  assert.equal(mutator?.outcome, "local changes");
  assert.equal(git(path.join(dir, "mutator"), ["rev-parse", "HEAD"]), src[2].later);
  assert.equal(readFileSync(edited, "utf8"), "my local patch\n");
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

test("a tools entry that is not its own git clone is reported, never treated as the repo above it", () => {
  const src = sources();
  const home = tempDir("harry-tools-home-");
  git(home, ["init", "-q"]);
  const plain = path.join(home, ".claude", "harry", "tools", "crapper");
  mkdirSync(plain, { recursive: true });
  writeFileSync(path.join(plain, "notes.txt"), "mine\n");

  const results = inHome(() => syncTools({ tools: asTools(src) }), home);

  const crapper = results.find((r) => r.name === "crapper");
  assert.equal(crapper?.outcome, "failed");
  assert.match(crapper?.detail ?? "", /not a git clone/);
  assert.equal(readFileSync(path.join(plain, "notes.txt"), "utf8"), "mine\n");
});

test("install.mjs --tools clones the pinned tools into the tools dir under HOME", () => {
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

  assert.equal(res.status, 0, res.stderr);
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

test("the pins name exactly the tools metrics looks for, each at a full commit", () => {
  assert.deepEqual(PINNED_TOOLS.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
  for (const t of PINNED_TOOLS) assert.match(t.commit, /^[0-9a-f]{40}$/, t.name);
});
