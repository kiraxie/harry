import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readProse } from "./citations.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const SKILL = "skills/finishing/SKILL.md";

const OPENING = 'T="$STORE/.local/tmp/<branch>"';

const commandTemplate = (): string => {
  const spans = readProse(SKILL, readFileSync(path.join(repoRoot, SKILL), "utf-8"))
    .flatMap((block) => block.code)
    .map((span) => span.value)
    .filter((value) => value.startsWith(OPENING));
  assert.equal(spans.length, 1, `expected one Temp files command opening ${OPENING} in ${SKILL}`);
  return spans[0] ?? "";
};

function runCleanup(cwd: string, store: string | undefined, branch: string) {
  const env = { ...process.env };
  delete env.STORE;
  if (store !== undefined) env.STORE = store;
  return spawnSync("sh", ["-c", commandTemplate().replaceAll("<branch>", branch)], {
    cwd,
    env,
    encoding: "utf8",
  });
}

function withStore(fn: (store: string, tmp: string) => void, name = "harry-f5-"): void {
  const root = mkdtempSync(path.join(tmpdir(), name));
  try {
    const tmp = path.join(root, ".local", "tmp");
    mkdirSync(tmp, { recursive: true });
    fn(root, tmp);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const makeDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "review-1.md"), "x");
};

test("f.5 refuses an unset store", () => {
  withStore((root) => {
    const r = runCleanup(root, undefined, "feat-x");
    assert.notEqual(r.status, 0, r.stdout);
  });
});

test("f.5 refuses the relative store a failed git resolves to", () => {
  withStore((root, tmp) => {
    makeDir(path.join(tmp, "feat-x"));
    const r = runCleanup(root, ".", "feat-x");
    assert.notEqual(r.status, 0, r.stdout);
    assert.ok(existsSync(path.join(tmp, "feat-x", "review-1.md")), "the dir under cwd survives");
  });
});

test("f.5 refuses an empty branch name and leaves .local/tmp alone", () => {
  withStore((store, tmp) => {
    makeDir(path.join(tmp, "other"));
    const r = runCleanup(store, store, "");
    assert.notEqual(r.status, 0, r.stdout);
    assert.ok(existsSync(path.join(tmp, "other", "review-1.md")), "a sibling's dir survives");
  });
});

test("f.5 removes this branch's dir and keeps a sibling's", () => {
  withStore((store, tmp) => {
    makeDir(path.join(tmp, "feat-x"));
    makeDir(path.join(tmp, "feat-y"));
    const r = runCleanup(store, store, "feat-x");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(path.join(tmp, "feat-x")), "this branch's dir is gone");
    assert.ok(existsSync(path.join(tmp, "feat-y", "review-1.md")), "a sibling's dir survives");
  });
});

test("f.5 treats a missing dir as nothing to remove", () => {
  withStore((store, tmp) => {
    const r = runCleanup(store, store, "feat-x");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(tmp), ".local/tmp itself survives");
  });
});

test("f.5 removes a / branch's parent only when it is left empty", () => {
  withStore((store, tmp) => {
    makeDir(path.join(tmp, "chore", "x"));
    assert.equal(runCleanup(store, store, "chore/x").status, 0);
    assert.ok(!existsSync(path.join(tmp, "chore")), "the emptied parent is gone");

    makeDir(path.join(tmp, "chore", "x"));
    makeDir(path.join(tmp, "chore", "y"));
    assert.equal(runCleanup(store, store, "chore/x").status, 0);
    assert.ok(!existsSync(path.join(tmp, "chore", "x")), "this branch's dir is gone");
    assert.ok(
      existsSync(path.join(tmp, "chore", "y", "review-1.md")),
      "the parent with a sibling stays",
    );
  });
});

test("f.5 exits non-zero when rm fails", () => {
  withStore((store, tmp) => {
    const locked = path.join(tmp, "feat-x", "locked");
    makeDir(locked);
    chmodSync(locked, 0o555);
    try {
      assert.notEqual(runCleanup(store, store, "feat-x").status, 0);
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});

test("f.5 removes the dir under a store path holding a space and a quote", () => {
  withStore((store, tmp) => {
    makeDir(path.join(tmp, "feat-x"));
    const r = runCleanup(store, store, "feat-x");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(path.join(tmp, "feat-x")), "this branch's dir is gone");
  }, "harry f5 it's-");
});
