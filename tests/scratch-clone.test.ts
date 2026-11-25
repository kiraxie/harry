import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { loadScript } from "./load-script.ts";

const { create, run } = await loadScript(() => import("../.claude/scripts/scratch-clone.mts"));

const SCRIPT = fileURLToPath(new URL("../.claude/scripts/scratch-clone.mts", import.meta.url));

/** A `pnpm` first on PATH that logs its call, then makes `node_modules/` or fails on demand. */
const stubDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harry-scratch-clone-bin-")));
test.after(() => rmSync(stubDir, { recursive: true, force: true }));
writeFileSync(
  path.join(stubDir, "pnpm"),
  `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(
  process.env.STUB_PNPM_LOG,
  JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), HOME: process.env.HOME }) + "\\n",
);
if (process.env.STUB_PNPM_FAIL) {
  process.stderr.write("stub: no tarball in the store\\n");
  process.exit(1);
}
fs.mkdirSync("node_modules");
`,
  { mode: 0o755 },
);
process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;

const pnpmCalls = (repo: string): { args: string[]; cwd: string; HOME: string }[] => {
  const log = path.join(stubDir, `${path.basename(repo)}.jsonl`);
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

/** A repo on branch `unit` with two commits, tag v1 on the first, and a store. */
const makeRepo = (t: TestContext): { repo: string; first: string; head: string } => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harry-scratch-clone-")));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(path.join(repo, ".gitignore"), ".local/\nnode_modules/\n");
  writeFileSync(path.join(repo, "a.txt"), "one\n");
  writeFileSync(path.join(repo, "pnpm-workspace.yaml"), "");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "one");
  git(repo, "tag", "v1");
  const first = git(repo, "rev-parse", "HEAD");
  writeFileSync(path.join(repo, "a.txt"), "two\n");
  git(repo, "commit", "-q", "-am", "two");
  git(repo, "switch", "-q", "-c", "unit");
  mkdirSync(path.join(repo, ".local"));
  process.env.STUB_PNPM_LOG = path.join(stubDir, `${path.basename(repo)}.jsonl`);
  return { repo, first, head: git(repo, "rev-parse", "HEAD") };
};

const clonesDir = (repo: string): string => path.join(repo, ".local", "tmp", "unit", "clones");

test("create leaves a clone of HEAD with its tags and its own offline-installed node_modules", (t) => {
  const { repo, head } = makeRepo(t);
  writeFileSync(path.join(repo, "a.txt"), "uncommitted\n");

  const made = create(repo, "replay");

  const clone = path.join(clonesDir(repo), "replay");
  assert.deepEqual(made, { clone });
  assert.equal(git(clone, "rev-parse", "HEAD"), head);
  assert.equal(git(clone, "tag", "-l"), "v1");
  assert.equal(readFileSync(path.join(clone, "a.txt"), "utf8"), "two\n");
  assert.deepEqual(pnpmCalls(repo), [
    { args: ["install", "--frozen-lockfile", "--offline"], cwd: clone, HOME: process.env.HOME },
  ]);
  assert.ok(lstatSync(path.join(clone, "node_modules")).isDirectory());
  assert.equal(existsSync(path.join(repo, "node_modules")), false);
  assert.equal(git(clone, "status", "--porcelain"), "");
  assert.deepEqual(readdirSync(clonesDir(repo)), ["replay"]);
});

test("create fails with pnpm's own words and leaves nothing when the offline install fails", (t) => {
  const { repo, head } = makeRepo(t);
  process.env.STUB_PNPM_FAIL = "1";
  t.after(() => delete process.env.STUB_PNPM_FAIL);

  assert.throws(
    () => create(repo, "nostore"),
    (err: Error) =>
      err.message.startsWith(
        `\`pnpm install --frozen-lockfile --offline\` failed for ${head.slice(0, 7)}; pnpm's output follows\n`,
      ) && err.message.includes("stub: no tarball in the store"),
  );
  assert.equal(pnpmCalls(repo).length, 1);
  assert.deepEqual(readdirSync(clonesDir(repo)), []);
});

test("create --ref checks the clone out at that commit", (t) => {
  const { repo, first } = makeRepo(t);
  const { clone } = create(repo, "old", "v1");
  assert.equal(git(clone, "rev-parse", "HEAD"), first);
  assert.equal(readFileSync(path.join(clone, "a.txt"), "utf8"), "one\n");
});

test("the CLI prints the clone's path and that uncommitted changes are left out", (t) => {
  const { repo } = makeRepo(t);
  const r = spawnSync(process.execPath, [SCRIPT, "create", "cli"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(path.join(clonesDir(repo), "cli")), r.stdout);
  assert.match(r.stdout, /uncommitted changes are not included/);
  assert.doesNotMatch(r.stdout, /HOME/);
});

const REFUSED: {
  name: string;
  arrange?: (repo: string) => void;
  clone?: string;
  ref?: string;
  message: RegExp;
}[] = [
  { name: "a name with a slash", clone: "a/b", message: /invalid name/ },
  { name: "a name of dots", clone: "..", message: /invalid name/ },
  { name: "a name starting with a dot", clone: ".x", message: /invalid name/ },
  { name: "a name with a space", clone: "a b", message: /invalid name/ },
  { name: "an empty name", clone: "", message: /invalid name/ },
  {
    name: "a checkout on main",
    arrange: (r) => git(r, "switch", "-q", "main"),
    message: /on main/,
  },
  {
    name: "a checkout on master",
    arrange: (r) => git(r, "switch", "-q", "-c", "master"),
    message: /on master/,
  },
  {
    name: "a detached HEAD",
    arrange: (r) => git(r, "switch", "-q", "--detach"),
    message: /detached HEAD/,
  },
  { name: "an unknown ref", ref: "no-such-ref", message: /unknown ref/ },
  {
    name: "a commit with no pnpm-workspace.yaml",
    arrange: (r) => {
      git(r, "rm", "-q", "pnpm-workspace.yaml");
      git(r, "commit", "-q", "-m", "no workspace file");
    },
    message: /has no pnpm-workspace\.yaml/,
  },
  {
    name: "a repo with no item store",
    arrange: (r) => rmSync(path.join(r, ".local"), { recursive: true }),
    message: /no \.local/,
  },
];

for (const c of REFUSED) {
  test(`create refuses ${c.name} and creates nothing`, (t) => {
    const { repo } = makeRepo(t);
    c.arrange?.(repo);
    const store = path.join(repo, ".local");
    const before = existsSync(store) ? readdirSync(store) : null;
    assert.throws(() => create(repo, c.clone ?? "x", c.ref), c.message);
    assert.deepEqual(existsSync(store) ? readdirSync(store) : null, before);
  });
}

test("create refuses a name that exists and leaves the first clone as it was", (t) => {
  const { repo, head } = makeRepo(t);
  const { clone } = create(repo, "twice");
  assert.throws(() => create(repo, "twice", "v1"), /already exists/);
  assert.equal(git(clone, "rev-parse", "HEAD"), head);
  assert.deepEqual(readdirSync(clonesDir(repo)).sort(), ["twice"]);
});

test("the CLI exits 1 with the refusal on stderr", (t) => {
  const { repo } = makeRepo(t);
  const r = spawnSync(process.execPath, [SCRIPT, "create", "a/b"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^scratch-clone: invalid name/);
});

test("run executes the command in the clone with the caller's HOME and returns its exit code", (t) => {
  const { repo } = makeRepo(t);
  const { clone } = create(repo, "runner");
  const home = path.join(repo, "callers-home");
  const r = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "run",
      "runner",
      "--",
      process.execPath,
      "-e",
      "console.log(process.cwd()); console.log(process.env.HOME); process.exit(7)",
    ],
    { cwd: repo, encoding: "utf8", env: { ...process.env, HOME: home } },
  );
  assert.equal(r.stdout, `${clone}\n${home}\n`, r.stderr);
  assert.equal(r.status, 7);
});

test("run gives 128 plus the signal's number for a command a signal killed", (t) => {
  const { repo } = makeRepo(t);
  create(repo, "killed");
  assert.equal(run(repo, "killed", ["sh", "-c", "kill -TERM $$"]), 143);
});

test("run refuses a name with no clone", (t) => {
  const { repo } = makeRepo(t);
  assert.throws(
    () => run(repo, "missing", [process.execPath, "-e", "0"]),
    /no clone named missing/,
  );
});

test("the CLI outside a git repository exits 1 with git's reason on stderr", (t) => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harry-scratch-clone-norepo-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [SCRIPT, "create", "x"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^scratch-clone: /);
  assert.match(r.stderr, /not a git repository/);
  assert.deepEqual(readdirSync(dir), []);
});
