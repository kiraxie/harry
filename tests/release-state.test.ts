import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  detectState,
  gitBumpCommitExists,
  gitTagExists,
  latestTag,
  parseVersion,
} from "../scripts/release-state.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join(repoRoot, "scripts/release-state.mjs");

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function fixture(): {
  dir: string;
  git: (...args: string[]) => void;
  write: (file: string, body: string) => void;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "release-state-"));
  fixtures.push(dir);
  const git = (...args: string[]) => {
    execFileSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "tag.gpgsign=false",
        ...args,
      ],
      {
        cwd: dir,
        stdio: "ignore",
      },
    );
  };
  const write = (file: string, body: string) => writeFileSync(path.join(dir, file), body);
  git("init", "-q", "-b", "main");
  return { dir, git, write };
}

function cli(
  dir: string,
  ...args: string[]
): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

test("parseVersion accepts strict x.y.z and rejects everything else", () => {
  assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3 });
  for (const bad of ["v1.2.3", "1.2", "1.2.3-rc1", "1.2.3.4", "", "abc"]) {
    assert.throws(() => parseVersion(bad), `expected "${bad}" to be rejected`);
  }
});

test("compareVersions orders numerically, not lexicographically", () => {
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
});

describe("detectState", () => {
  const base = {
    latestTag: "0.19.0",
    tagExists: false,
    bumpCommitExists: false,
    fieldHoldsTarget: false,
  };
  test("invalid-version wins when the target itself is malformed", () => {
    assert.equal(
      detectState({ ...base, targetVersion: "v0.20.0", tagExists: true }),
      "invalid-version",
    );
  });
  test("already-tagged is terminal", () => {
    assert.equal(
      detectState({ ...base, targetVersion: "0.20.0", tagExists: true, bumpCommitExists: true }),
      "already-tagged",
    );
  });
  test("bumped-not-tagged when the bump commit is reachable", () => {
    assert.equal(
      detectState({
        ...base,
        targetVersion: "0.20.0",
        bumpCommitExists: true,
        fieldHoldsTarget: true,
      }),
      "bumped-not-tagged",
    );
  });
  test("version-mismatch-untracked when a declared field already holds the target with no bump commit", () => {
    assert.equal(
      detectState({ ...base, targetVersion: "0.20.0", fieldHoldsTarget: true }),
      "version-mismatch-untracked",
    );
  });
  test("not-bumped when the target is ahead of the latest tag", () => {
    assert.equal(detectState({ ...base, targetVersion: "0.20.0" }), "not-bumped");
  });
  test("not-bumped when the repo has no tag yet", () => {
    assert.equal(detectState({ ...base, latestTag: null, targetVersion: "0.1.0" }), "not-bumped");
  });
  test("invalid-target when the target is behind or equal to the latest tag", () => {
    assert.equal(detectState({ ...base, targetVersion: "0.18.0" }), "invalid-target");
    assert.equal(detectState({ ...base, targetVersion: "0.19.0" }), "invalid-target");
  });
  test("invalid-target even when a field holds a version behind the latest tag", () => {
    assert.equal(
      detectState({ ...base, targetVersion: "0.18.0", fieldHoldsTarget: true }),
      "invalid-target",
    );
  });
  test("invalid-target even when an old bump commit exists for a version behind the latest tag", () => {
    assert.equal(
      detectState({
        ...base,
        targetVersion: "0.18.0",
        bumpCommitExists: true,
        fieldHoldsTarget: true,
      }),
      "invalid-target",
    );
  });
});

describe("an untracked older bump below a newer tag", () => {
  const { dir, git, write } = fixture();
  write("package.json", '{ "version": "1.1.0" }\n');
  git("add", ".");
  git("commit", "-qm", "init");
  git("tag", "v1.1.0");
  write("package.json", '{ "version": "1.2.0" }\n');
  git("commit", "-qam", "chore(release): bump version to 1.2.0");
  write("package.json", '{ "version": "1.3.0" }\n');
  git("commit", "-qam", "chore(release): bump version to 1.3.0");
  git("tag", "v1.3.0");

  test("the older version is invalid-target, never tagged onto the newer head", () => {
    assert.equal(cli(dir, "1.2.0", "--field", "package.json").stdout, "invalid-target");
  });
  test("a squash subject with GitHub's (#n) suffix still counts as the bump commit", () => {
    write("package.json", '{ "version": "1.4.0" }\n');
    git("commit", "-qam", "chore(release): bump version to 1.4.0 (#12)");
    assert.equal(gitBumpCommitExists(dir, "1.4.0"), true);
    assert.equal(cli(dir, "1.4.0", "--field", "package.json").stdout, "bumped-not-tagged");
  });
  test("any other trailing text does not count", () => {
    git("commit", "-q", "--allow-empty", "-m", "chore(release): bump version to 1.5.0 and more");
    assert.equal(gitBumpCommitExists(dir, "1.5.0"), false);
  });
});

describe("a tag-only repo (no fields, no CHANGELOG)", () => {
  const { dir, git, write } = fixture();
  write("main.go", "package x\n");
  git("add", ".");
  git("commit", "-qm", "init");
  git("tag", "v0.2.0");
  git("commit", "-q", "--allow-empty", "-m", "fix: a");
  git("tag", "v0.3.1");
  git("tag", "not-a-version");

  test("latestTag picks the highest semver v-tag, ignoring other tags", () => {
    assert.equal(latestTag(dir), "0.3.1");
  });
  test("a newer version is not-bumped", () => {
    assert.deepEqual(cli(dir, "0.3.2"), { code: 0, stdout: "not-bumped", stderr: "" });
  });
  test("an existing tag is already-tagged", () => {
    assert.equal(cli(dir, "0.3.1").stdout, "already-tagged");
  });
  test("an older version with no tag is invalid-target", () => {
    assert.equal(cli(dir, "0.3.0").stdout, "invalid-target");
  });
  test("a malformed version is invalid-version", () => {
    assert.equal(cli(dir, "v0.3.2").stdout, "invalid-version");
  });
  test("a missing version is invalid-version, not an environment error", () => {
    assert.deepEqual(cli(dir), { code: 0, stdout: "invalid-version", stderr: "" });
  });
  test("a version with a regex metacharacter is invalid-version, not an environment error", () => {
    assert.deepEqual(cli(dir, "1.2.3)"), { code: 0, stdout: "invalid-version", stderr: "" });
    assert.deepEqual(cli(dir, "(", "--field", "main.go"), {
      code: 0,
      stdout: "invalid-version",
      stderr: "",
    });
  });
});

describe("a repo with no tag yet", () => {
  const { dir, git } = fixture();
  git("commit", "-q", "--allow-empty", "-m", "init");
  test("any valid version is not-bumped", () => {
    assert.equal(latestTag(dir), null);
    assert.equal(cli(dir, "0.1.0").stdout, "not-bumped");
  });
});

describe("a repo that declares a version field", () => {
  const { dir, git, write } = fixture();
  write("package.json", '{ "version": "0.2.0" }\n');
  git("add", ".");
  git("commit", "-qm", "init");
  git("tag", "v0.2.0");

  test("before the bump, the next version is not-bumped", () => {
    assert.equal(cli(dir, "0.3.0", "--field", "package.json").stdout, "not-bumped");
  });
  test("a field edited to the target with no bump commit is version-mismatch-untracked", () => {
    write("package.json", '{ "version": "0.3.0" }\n');
    assert.equal(cli(dir, "0.3.0", "--field", "package.json").stdout, "version-mismatch-untracked");
  });
  test("after the bump commit, it is bumped-not-tagged", () => {
    git("commit", "-qam", "chore(release): bump version to 0.3.0");
    assert.equal(gitBumpCommitExists(dir, "0.3.0"), true);
    assert.equal(cli(dir, "0.3.0", "--field", "package.json").stdout, "bumped-not-tagged");
  });
  test("after the tag, it is already-tagged", () => {
    git("tag", "v0.3.0");
    assert.equal(gitTagExists(dir, "0.3.0"), true);
    assert.equal(cli(dir, "0.3.0", "--field", "package.json").stdout, "already-tagged");
  });
  test("a declared field that does not exist is an environment error, exit 1", () => {
    const r = cli(dir, "0.4.0", "--field", "missing.json");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /missing\.json/);
  });
  test("with a field declared, an older version is still invalid-target", () => {
    assert.equal(cli(dir, "0.1.0", "--field", "package.json").stdout, "invalid-target");
  });
  test("with a field declared, a malformed version is still invalid-version", () => {
    assert.equal(cli(dir, "0.4", "--field", "package.json").stdout, "invalid-version");
  });
});

describe("a field holds the target only as a whole version token", () => {
  const { dir, git, write } = fixture();
  write(
    "package.json",
    '{ "version": "0.9.0", "engines": { "node": ">=26.0.0" }, "dependencies": { "x": "^10.10.0" } }\n',
  );
  git("add", ".");
  git("commit", "-qm", "init");
  git("tag", "v0.9.0");

  test("a longer version that ends in the target's digits does not count", () => {
    assert.equal(cli(dir, "0.10.0", "--field", "package.json").stdout, "not-bumped");
  });
  test("a range bound that ends in the target's digits does not count", () => {
    assert.equal(cli(dir, "6.0.0", "--field", "package.json").stdout, "not-bumped");
  });
  test("a bump subject matches its version exactly, dots included", () => {
    git("commit", "-q", "--allow-empty", "-m", "chore(release): bump version to 1x2x3");
    assert.equal(gitBumpCommitExists(dir, "1.2.3"), false);
  });
  test("a v-prefixed field counts as holding the version", () => {
    write("version.go", 'const Version = "v0.12.0"\n');
    assert.equal(cli(dir, "0.12.0", "--field", "version.go").stdout, "version-mismatch-untracked");
  });
  test("a longer dotted number does not count", () => {
    write("build.txt", "1.2.3.4\n");
    assert.equal(cli(dir, "2.3.4", "--field", "build.txt").stdout, "not-bumped");
  });
});

test("references/release.md greps with the script's token boundary, never grep -w", () => {
  const md = readFileSync(path.join(repoRoot, "references/release.md"), "utf8");
  assert.doesNotMatch(md, /grep -[a-zA-Z]*w/);
  const greps = [...md.matchAll(/`((?:git )?grep [^`]*)`/g)]
    .map((m) => m[1])
    .filter((g) => g.includes("<"));
  assert.ok(
    greps.length >= 2,
    `expected the listing and counting greps, found: ${greps.join(" | ")}`,
  );
  for (const g of greps)
    assert.match(
      g,
      /\(\^\|\[\^0-9\.\]\).*\(\$\|\[\^0-9\.\]\)/,
      `grep without the token boundary: ${g}`,
    );
});

test("outside a git repo the CLI exits 1 and says why", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "release-state-nogit-"));
  fixtures.push(dir);
  const r = cli(dir, "0.1.0");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /release-state:/);
});

test("this repo's own released version classifies as already-tagged", () => {
  assert.equal(cli(repoRoot, "0.22.0", "--field", "package.json").stdout, "already-tagged");
});

// The six state names are written in three places; divergence is a bug.
const CANONICAL_STATES = [
  "invalid-version",
  "invalid-target",
  "not-bumped",
  "bumped-not-tagged",
  "already-tagged",
  "version-mismatch-untracked",
];

test("release-state.d.mts's ReleaseState union names exactly the six states", () => {
  const dts = readFileSync(path.join(repoRoot, "scripts/release-state.d.mts"), "utf8");
  const union = dts.match(/export type ReleaseState =([\s\S]*?);/);
  assert.ok(union, "no ReleaseState union");
  assert.deepEqual(
    new Set([...union[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1])),
    new Set(CANONICAL_STATES),
  );
});

test("references/release.md's state section names exactly the six states", () => {
  const md = readFileSync(path.join(repoRoot, "references/release.md"), "utf8");
  const start = md.indexOf("## Classify the state");
  const end = md.indexOf("## Phase A");
  assert.ok(start >= 0 && end > start, "references/release.md: no state section before Phase A");
  const names = [...md.slice(start, end).matchAll(/`([a-z-]+)`/g)]
    .map((m) => m[1])
    .filter((n) => /^[a-z]+(-[a-z]+)+$/.test(n));
  assert.deepEqual(new Set(names), new Set(CANONICAL_STATES));
});
