import assert from "node:assert/strict";
import test from "node:test";

import { resolveProvider } from "../src/lib/provider.ts";

const ENV_KEY = "CLAUDE_PLUGIN_OPTION_PROVIDER";

function withProviderEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  }
}

test("flag wins over setting and codexUsable", () => {
  withProviderEnv("codex", () => {
    const id = resolveProvider("/tmp", { provider: "copilot" }, { codexUsable: () => true });
    assert.equal(id, "copilot");
  });
});

test("setting wins when no flag is given", () => {
  withProviderEnv("copilot", () => {
    const id = resolveProvider("/tmp", {}, { codexUsable: () => true });
    assert.equal(id, "copilot");
  });
});

test("defaults to codex when usable and no flag/setting", () => {
  withProviderEnv(undefined, () => {
    const id = resolveProvider("/tmp", {}, { codexUsable: () => true });
    assert.equal(id, "codex");
  });
});

test("falls back to copilot when codex is not usable", () => {
  withProviderEnv(undefined, () => {
    const id = resolveProvider("/tmp", {}, { codexUsable: () => false });
    assert.equal(id, "copilot");
  });
});
