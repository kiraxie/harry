/**
 * loadScript (tests/load-script.ts) is what keeps a guarded script's CLI, fired on import
 * by a wrong guard, away from the user's ~/.claude and this checkout. Each test loads a
 * probe module that records what it sees when it is evaluated.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { loadScript } from "./load-script.ts";

interface Seen {
  home: string | undefined;
  global: string | undefined;
  cwd: string;
}

/** Writes a probe module that records HOME, HARRY_GLOBAL and cwd on globalThis when imported. */
function probe(key: string, body = ""): { url: string; done: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harry-load-probe-"));
  const file = path.join(dir, "probe.mjs");
  writeFileSync(
    file,
    `globalThis[${JSON.stringify(key)}] = { home: process.env.HOME, global: process.env.HARRY_GLOBAL, cwd: process.cwd() };\n${body}`,
  );
  return {
    url: pathToFileURL(file).href,
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const seen = (key: string): Seen => (globalThis as Record<string, unknown>)[key] as Seen;

test("loadScript points HOME, HARRY_GLOBAL and cwd at one fresh temp dir while the script loads", async () => {
  const before = { home: process.env.HOME, cwd: process.cwd() };
  const p = probe("loadScriptSeen1");
  try {
    await loadScript(() => import(p.url));
    const s = seen("loadScriptSeen1");
    assert.ok(s.home, "HOME was unset during the load");
    assert.notEqual(s.home, before.home);
    assert.equal(s.cwd, s.home, "cwd is the same temp dir as HOME");
    assert.equal(s.global, path.join(s.home, ".claude", "CLAUDE.md"));
    assert.ok(s.home.startsWith(realpathSync(os.tmpdir())), s.home);
    assert.ok(!existsSync(s.home), "the temp dir is removed after the load");
  } finally {
    p.done();
  }
});

test("loadScript restores HOME, HARRY_GLOBAL and cwd after the load, an unset one left unset", async () => {
  const saved = { home: process.env.HOME, global: process.env.HARRY_GLOBAL, cwd: process.cwd() };
  delete process.env.HARRY_GLOBAL;
  const p = probe("loadScriptSeen2");
  try {
    await loadScript(() => import(p.url));
    assert.equal(process.env.HOME, saved.home);
    assert.ok(!("HARRY_GLOBAL" in process.env), "an unset HARRY_GLOBAL is left unset");
    assert.equal(process.cwd(), saved.cwd);
  } finally {
    if (saved.global === undefined) delete process.env.HARRY_GLOBAL;
    else process.env.HARRY_GLOBAL = saved.global;
    p.done();
  }
});

test("loadScript restores and cleans up when the load throws", async () => {
  const saved = { home: process.env.HOME, global: process.env.HARRY_GLOBAL, cwd: process.cwd() };
  process.env.HARRY_GLOBAL = "/outer/CLAUDE.md";
  const p = probe("loadScriptSeen3", 'throw new Error("probe failed to load");\n');
  try {
    await assert.rejects(
      loadScript(() => import(p.url)),
      /probe failed to load/,
    );
    const s = seen("loadScriptSeen3");
    assert.ok(s.home && !existsSync(s.home), "the temp dir is removed after a failed load");
    assert.equal(process.env.HOME, saved.home);
    assert.equal(process.env.HARRY_GLOBAL, "/outer/CLAUDE.md");
    assert.equal(process.cwd(), saved.cwd);
  } finally {
    if (saved.global === undefined) delete process.env.HARRY_GLOBAL;
    else process.env.HARRY_GLOBAL = saved.global;
    p.done();
  }
});
