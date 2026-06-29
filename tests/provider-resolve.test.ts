import assert from "node:assert/strict";
import test from "node:test";

import { resolveExplicit } from "../src/lib/provider.ts";

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

test("flag wins over setting", () => {
  withProviderEnv("codex", () => {
    assert.equal(resolveExplicit({ provider: "copilot" }), "copilot");
  });
});

test("setting used when no flag is given", () => {
  withProviderEnv("codex", () => {
    assert.equal(resolveExplicit({}), "codex");
  });
});

test("undefined when neither flag nor setting (caller probes codex-usable)", () => {
  withProviderEnv(undefined, () => {
    assert.equal(resolveExplicit({}), undefined);
  });
});
