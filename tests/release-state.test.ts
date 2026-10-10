import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bumpSubject,
  compareVersions,
  detectState,
  gitBumpCommitExists,
  gitTagExists,
  latestTag,
  parseVersion,
  RELEASE_STATES,
} from "../.claude/scripts/release-state.mts";
import { headingSection, section } from "./section.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join(repoRoot, ".claude/scripts/release-state.mts");

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
  for (const [name, facts, state] of [
    ["already-tagged outranks waiting-for-merge", { tagExists: true }, "already-tagged"],
    ["invalid-target outranks waiting-for-merge", { targetVersion: "0.18.0" }, "invalid-target"],
    [
      "bumped-not-tagged outranks waiting-for-merge",
      { bumpCommitExists: true },
      "bumped-not-tagged",
    ],
    [
      "version-mismatch-untracked outranks waiting-for-merge",
      { fieldHoldsTarget: true },
      "version-mismatch-untracked",
    ],
    ["waiting-for-merge outranks not-bumped", {}, "waiting-for-merge"],
  ] as const) {
    test(name, () => {
      assert.equal(
        detectState({ ...base, targetVersion: "0.20.0", startHasBumpCommit: true, ...facts }),
        state,
      );
    });
  }
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

function olderBumpRepo() {
  const f = fixture();
  f.write("package.json", '{ "version": "1.1.0" }\n');
  f.git("add", ".");
  f.git("commit", "-qm", "init");
  f.git("tag", "v1.1.0");
  f.write("package.json", '{ "version": "1.2.0" }\n');
  f.git("commit", "-qam", "chore(release): bump version to 1.2.0");
  f.write("package.json", '{ "version": "1.3.0" }\n');
  f.git("commit", "-qam", "chore(release): bump version to 1.3.0");
  f.git("tag", "v1.3.0");
  return f;
}

describe("an untracked older bump below a newer tag", () => {
  test("the older version is invalid-target, never tagged onto the newer head", () => {
    const { dir } = olderBumpRepo();
    assert.equal(cli(dir, "1.2.0", "--field", "package.json").stdout, "invalid-target");
  });
  test("a squash subject with GitHub's (#n) suffix still counts as the bump commit", () => {
    const { dir, git, write } = olderBumpRepo();
    write("package.json", '{ "version": "1.4.0" }\n');
    git("commit", "-qam", "chore(release): bump version to 1.4.0 (#12)");
    assert.equal(gitBumpCommitExists(dir, "1.4.0"), true);
    assert.equal(cli(dir, "1.4.0", "--field", "package.json").stdout, "bumped-not-tagged");
  });
  test("a body line equal to the bump subject does not count", () => {
    const { dir, git } = olderBumpRepo();
    git(
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "docs: explain the release flow",
      "-m",
      "chore(release): bump version to 1.4.0",
    );
    assert.equal(gitBumpCommitExists(dir, "1.4.0"), false);
    assert.equal(cli(dir, "1.4.0", "--field", "package.json").stdout, "not-bumped");
  });
  test("any other trailing text does not count", () => {
    const { dir, git } = olderBumpRepo();
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
  test("latest-tag prints the version latestTag picks", () => {
    assert.deepEqual(cli(dir, "latest-tag"), { code: 0, stdout: "0.3.1", stderr: "" });
  });
  test("latest-tag with any argument is a usage error, never a printed state", () => {
    for (const extra of [["extra"], ["--field", "main.go"], ["--start", "HEAD"]]) {
      const r = cli(dir, "latest-tag", ...extra);
      assert.equal(r.code, 1, extra.join(" "));
      assert.equal(r.stdout, "", extra.join(" "));
      assert.match(r.stderr, /latest-tag takes no arguments/, extra.join(" "));
    }
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
  test("latest-tag prints none", () => {
    assert.deepEqual(cli(dir, "latest-tag"), { code: 0, stdout: "none", stderr: "" });
  });
  test("any valid version is not-bumped", () => {
    assert.equal(latestTag(dir), null);
    assert.equal(cli(dir, "0.1.0").stdout, "not-bumped");
  });
});

function fieldRepo() {
  const f = fixture();
  f.write("package.json", '{ "version": "0.2.0" }\n');
  f.git("add", ".");
  f.git("commit", "-qm", "init");
  f.git("tag", "v0.2.0");
  return f;
}

describe("a repo that declares a version field", () => {
  test("before the bump, the next version is not-bumped", () => {
    const { dir } = fieldRepo();
    assert.equal(cli(dir, "0.3.0", "--field", "package.json").stdout, "not-bumped");
  });
  test("a field edited to the target with no bump commit is version-mismatch-untracked", () => {
    const { dir, write } = fieldRepo();
    write("package.json", '{ "version": "0.3.0" }\n');
    assert.equal(cli(dir, "0.3.0", "--field", "package.json").stdout, "version-mismatch-untracked");
  });
  test("after the bump commit, it is bumped-not-tagged", () => {
    const { dir, git, write } = fieldRepo();
    write("package.json", '{ "version": "0.3.0" }\n');
    git("commit", "-qam", "chore(release): bump version to 0.3.0");
    assert.equal(gitBumpCommitExists(dir, "0.3.0"), true);
    assert.equal(cli(dir, "0.3.0", "--field", "package.json").stdout, "bumped-not-tagged");
  });
  test("after the tag, it is already-tagged", () => {
    const { dir, git, write } = fieldRepo();
    write("package.json", '{ "version": "0.3.0" }\n');
    git("commit", "-qam", "chore(release): bump version to 0.3.0");
    git("tag", "v0.3.0");
    assert.equal(gitTagExists(dir, "0.3.0"), true);
    assert.equal(cli(dir, "0.3.0", "--field", "package.json").stdout, "already-tagged");
  });
  test("a declared field that does not exist is an environment error, exit 1", () => {
    const { dir } = fieldRepo();
    const r = cli(dir, "0.4.0", "--field", "missing.json");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /missing\.json/);
  });
  test("with a field declared, an older version is still invalid-target", () => {
    const { dir } = fieldRepo();
    assert.equal(cli(dir, "0.1.0", "--field", "package.json").stdout, "invalid-target");
  });
  test("with a field declared, a malformed version is still invalid-version", () => {
    const { dir } = fieldRepo();
    assert.equal(cli(dir, "0.4", "--field", "package.json").stdout, "invalid-version");
  });
});

function waitingRepo() {
  const f = fieldRepo();
  f.git("checkout", "-q", "-b", "release");
  f.write("package.json", '{ "version": "0.3.0" }\n');
  f.git("commit", "-qam", "chore(release): bump version to 0.3.0");
  f.git("checkout", "-q", "main");
  return f;
}

describe("a release waiting for its merge", () => {
  test("with --start on the bump branch, it is waiting-for-merge", () => {
    const { dir } = waitingRepo();
    assert.equal(
      cli(dir, "0.3.0", "--field", "package.json", "--start", "release").stdout,
      "waiting-for-merge",
    );
  });
  test("without --start, it is not-bumped", () => {
    const { dir } = waitingRepo();
    assert.equal(cli(dir, "0.3.0", "--field", "package.json").stdout, "not-bumped");
  });
  test("with --start on the default branch, it is not-bumped", () => {
    const { dir } = waitingRepo();
    assert.equal(
      cli(dir, "0.3.0", "--field", "package.json", "--start", "main").stdout,
      "not-bumped",
    );
  });
  test("once squash-merged, it is bumped-not-tagged whatever --start says", () => {
    const { dir, git } = waitingRepo();
    git("merge", "-q", "--squash", "release");
    git("commit", "-qm", "chore(release): bump version to 0.3.0 (#7)");
    assert.equal(
      cli(dir, "0.3.0", "--field", "package.json", "--start", "release").stdout,
      "bumped-not-tagged",
    );
  });
  test("squash-merged under another subject, it is version-mismatch-untracked whatever --start says", () => {
    const { dir, git } = waitingRepo();
    git("merge", "-q", "--squash", "release");
    git("commit", "-qm", "Release 0.3.0 (#5)");
    assert.equal(
      cli(dir, "0.3.0", "--field", "package.json", "--start", "release").stdout,
      "version-mismatch-untracked",
    );
  });
  test("a --start value that looks like an option is a revision, not a git option", () => {
    const { dir } = waitingRepo();
    const r = cli(dir, "0.3.0", "--field", "package.json", "--start", "--all");
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stderr, /release-state:.*--all/);
  });
  test("a --start ref that is also a file name resolves to the ref", () => {
    const { dir, write } = waitingRepo();
    write("release", "a file named like the branch\n");
    assert.equal(
      cli(dir, "0.3.0", "--field", "package.json", "--start", "release").stdout,
      "waiting-for-merge",
    );
  });
  test("a repeated --start says so", () => {
    const { dir } = waitingRepo();
    const r = cli(dir, "0.3.0", "--start", "main", "--start", "release");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--start given twice/);
  });
  test("a history whose subjects pass git's 1 MiB output buffer still classifies", () => {
    const { dir, git } = fieldRepo();
    const long = path.join(dir, ".subject");
    writeFileSync(long, `fix: ${"x".repeat(100_000)}\n`);
    for (let i = 0; i < 12; i++) git("commit", "-q", "--allow-empty", "-F", long);
    assert.deepEqual(cli(dir, "0.3.0", "--field", "package.json", "--start", "main"), {
      code: 0,
      stdout: "not-bumped",
      stderr: "",
    });
  });
  test("an unknown --start ref is an environment error, exit 1", () => {
    const { dir } = waitingRepo();
    const r = cli(dir, "0.3.0", "--start", "no-such-ref");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /release-state:.*no-such-ref/);
  });
});

function tokenRepo() {
  const f = fixture();
  f.write(
    "package.json",
    '{ "version": "0.9.0", "engines": { "node": ">=26.0.0" }, "dependencies": { "x": "^10.10.0" } }\n',
  );
  f.git("add", ".");
  f.git("commit", "-qm", "init");
  f.git("tag", "v0.9.0");
  return f;
}

describe("a field holds the target only as a whole version token", () => {
  test("a longer version that ends in the target's digits does not count", () => {
    const { dir } = tokenRepo();
    assert.equal(cli(dir, "0.10.0", "--field", "package.json").stdout, "not-bumped");
  });
  test("a range bound that ends in the target's digits does not count", () => {
    const { dir } = tokenRepo();
    assert.equal(cli(dir, "6.0.0", "--field", "package.json").stdout, "not-bumped");
  });
  test("a bump subject matches its version exactly, dots included", () => {
    const { dir, git } = tokenRepo();
    // The body line gets the commit past git's literal prefilter, so the subject regex decides.
    git(
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "chore(release): bump version to 1x2x3",
      "-m",
      "chore(release): bump version to 1.2.3",
    );
    assert.equal(gitBumpCommitExists(dir, "1.2.3"), false);
  });
  test("a v-prefixed field counts as holding the version", () => {
    const { dir, write } = tokenRepo();
    write("version.go", 'const Version = "v0.12.0"\n');
    assert.equal(cli(dir, "0.12.0", "--field", "version.go").stdout, "version-mismatch-untracked");
  });
  test("a longer dotted number does not count", () => {
    const { dir, write } = tokenRepo();
    write("build.txt", "1.2.3.4\n");
    assert.equal(cli(dir, "2.3.4", "--field", "build.txt").stdout, "not-bumped");
  });
});

test(".claude/commands/release.md runs the state script at its real path", () => {
  const md = readFileSync(path.join(repoRoot, ".claude/commands/release.md"), "utf8");
  assert.ok(md.includes(`node ${path.relative(repoRoot, SCRIPT)} `));
});

test(".claude/commands/release.md passes --start and leaves the bump-commit rule to the script", () => {
  const md = readFileSync(path.join(repoRoot, ".claude/commands/release.md"), "utf8");
  assert.match(md, /release-state\.mts <version> .*--start <starting-commit>/);
  assert.doesNotMatch(md, /git log <starting-commit>/);
});

test("the subject release.md's Phase A commits under is the script's bump subject", () => {
  const md = readFileSync(path.join(repoRoot, ".claude/commands/release.md"), "utf8");
  const step = section(md, ".claude/commands/release.md", "5. **Commit**", "6. **Hand off**");
  assert.equal(
    md.split("bump version to <version>").length - 1,
    1,
    "release.md writes the bump subject only in its commit step",
  );
  const written = step.match(/`([^`]*<version>[^`]*)`/);
  assert.ok(written, `no subject with <version> in the commit step: ${step}`);
  const subject = written[1].replace("<version>", "9.8.7");
  assert.equal(subject, bumpSubject("9.8.7"));
  const { dir, git } = fieldRepo();
  git("commit", "-q", "--allow-empty", "-m", subject);
  assert.equal(gitBumpCommitExists(dir, "9.8.7"), true);
});

test(".claude/commands/release.md takes the latest tag from the script, not a git tag pipeline", () => {
  const md = readFileSync(path.join(repoRoot, ".claude/commands/release.md"), "utf8");
  assert.ok(md.includes(`node ${path.relative(repoRoot, SCRIPT)} latest-tag`));
  assert.doesNotMatch(md, /git tag (-l|--list|--sort)|git describe/);
});

test(".claude/commands/release.md greps with the script's token boundary, never grep -w", () => {
  const md = readFileSync(path.join(repoRoot, ".claude/commands/release.md"), "utf8");
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

test(".claude/commands/release.md's state section names exactly the script's states", () => {
  const md = readFileSync(path.join(repoRoot, ".claude/commands/release.md"), "utf8");
  const states = headingSection(md, ".claude/commands/release.md", "## Classify the state");
  const names = [...states.matchAll(/`([a-z-]+)`/g)]
    .map((m) => m[1])
    .filter((n) => /^[a-z]+(-[a-z]+)+$/.test(n));
  assert.deepEqual(new Set(names), new Set(RELEASE_STATES));
});
