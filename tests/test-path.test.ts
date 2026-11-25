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
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadScript } from "./load-script.ts";

const { withoutWrapperDir } = await loadScript(() => import("../.claude/scripts/test-path.mts"));

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join(repoRoot, ".claude/scripts/test-path.mts");

const CASES: { name: string; path: string; want: string }[] = [
  { name: "first entry", path: "/h/.claude/hooks/bin:/usr/bin:/bin", want: "/usr/bin:/bin" },
  { name: "middle entry", path: "/usr/bin:/h/.claude/hooks/bin:/bin", want: "/usr/bin:/bin" },
  {
    name: "several occurrences",
    path: "/h/.claude/hooks/bin:/usr/bin:/h/.claude/hooks/bin",
    want: "/usr/bin",
  },
  { name: "a trailing slash", path: "/h/.claude/hooks/bin/:/usr/bin", want: "/usr/bin" },
  { name: "absent", path: "/b:/a:/c", want: "/b:/a:/c" },
  {
    name: "a dir that only starts with it",
    path: "/h/.claude/hooks/bin2:/h/.claude/hooks:/usr/bin",
    want: "/h/.claude/hooks/bin2:/h/.claude/hooks:/usr/bin",
  },
  {
    name: "another home's dir",
    path: "/other/.claude/hooks/bin:/bin",
    want: "/other/.claude/hooks/bin:/bin",
  },
  { name: "an empty entry is kept", path: "/a::/h/.claude/hooks/bin:/b", want: "/a::/b" },
];

for (const c of CASES) {
  test(`withoutWrapperDir drops only the home's hooks dir: ${c.name}`, () => {
    assert.equal(withoutWrapperDir(c.path, "/h"), c.want);
  });
}

test("test-path.mts prints PATH without the HOME's hooks dir", () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { HOME: "/h", PATH: "/h/.claude/hooks/bin:/usr/bin:/bin" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "/usr/bin:/bin");
});

test("the test script runs a test's git without the wrapper that is first on PATH", (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "harry-test-path-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const hooks = path.join(home, ".claude", "hooks", "bin");
  const marker = path.join(home, "wrapper-ran");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(path.join(hooks, "git"), `#!/bin/sh\necho ran > "${marker}"\n`);
  chmodSync(path.join(hooks, "git"), 0o755);
  const inner = path.join(home, "inner.test.ts");
  writeFileSync(
    inner,
    'import { spawnSync } from "node:child_process";\nimport test from "node:test";\ntest("git", () => { spawnSync("git", ["--version"]); });\n',
  );
  const script: string = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"))
    .scripts.test;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${hooks}:${path.dirname(process.execPath)}:${process.env.PATH}`,
  };
  delete env.NODE_TEST_CONTEXT;

  const r = spawnSync("sh", ["-c", `${script} "$0"`, inner], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /pass 1\b/);
  assert.equal(existsSync(marker), false, "the wrapper's git ran");
});
