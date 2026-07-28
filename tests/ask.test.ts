/**
 * `ask`'s failure contract.
 *
 * Both of `ask`'s doors instruct their consumers to "Return the command stdout
 * verbatim, exactly as-is", and `/debate` folds that stdout into a three-voice
 * synthesis. So a failed turn MUST be self-describing on stdout: without a
 * marker, a truncated answer is indistinguishable from a complete one and gets
 * presented (or synthesized) as the model's real answer.
 *
 * This mirrors `review`'s failure shape — `# Review Failed` on stdout plus a
 * `Review failed:` line on stderr — because the two commands share a stdout
 * contract and drifting apart is what produced this gap in the first place.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildEnv, installFakeCodex } from "./fake-codex.mjs";

const CLI = path.resolve(import.meta.dirname, "../src/companion.ts");

/**
 * `ask`'s failure signals, declared once. The CLI assertions below and the
 * prose contract at the bottom of this file both read these, so the code and
 * every door move together instead of drifting apart.
 *
 * `Fatal error:` comes from companion.ts's top-level handler rather than from
 * ask itself, but two doors name it as a signal to watch for, so it needs the
 * same pinning — a door quoting a string nothing asserts is exactly the drift
 * this file exists to stop. (`Ask failed:` is asserted against the CLI too but
 * is deliberately absent here: no door names it, so it cannot go stale in prose.)
 */
const ASK_FAILED_MARKER = "# Ask Failed";
const FATAL_ERROR_PREFIX = "Fatal error:";

/**
 * The phantom guard the doors used to carry: `ask` has no JSON mode and no
 * `status` field, so an instruction to check one can never fire. It was removed
 * once; this keeps it from drifting back in.
 */
const PHANTOM_STATUS_GUARD = "is `failed`";

interface AskDoor {
  /** Repo-relative path. */
  path: string;
  /** Failure signals this door tells its consumer to watch for. */
  quotes: readonly string[];
  /**
   * The door's prohibition on relaying a failed body. A short fragment, not a
   * sentence — pinning whole sentences just moves the brittleness.
   */
  prohibition: string;
}

/**
 * Every door that tells a consumer to return `ask`'s stdout verbatim, and so
 * must also name the signals that say not to. Hand-maintained on purpose: this
 * is a declaration of intent (same as role-mapping-drift.test.ts's PAIRS), and
 * a derived list would also sweep in a future door that invokes `ask` without
 * relaying stdout verbatim — a false failure that would get silenced by an
 * allowlist, which is how a guard rots. The cross-check test below keeps the
 * hand list honest instead.
 *
 * `debate.md`'s prohibition differs by design: on a failed `gpt` leg it records
 * a failed source and continues with the remaining two voices rather than
 * stopping, so it has no "stop" instruction to assert.
 */
const ASK_DOORS: readonly AskDoor[] = [
  {
    path: "commands/ask.md",
    quotes: [ASK_FAILED_MARKER, FATAL_ERROR_PREFIX],
    prohibition: "never present",
  },
  {
    path: "codex-skills/ask/SKILL.md",
    quotes: [ASK_FAILED_MARKER, FATAL_ERROR_PREFIX],
    prohibition: "never present",
  },
  {
    path: "commands/debate.md",
    quotes: [ASK_FAILED_MARKER],
    prohibition: "never relay",
  },
];

/**
 * Doors that invoke `ask` but deliberately do NOT relay its stdout verbatim
 * (e.g. one that parses the answer). Each needs a stated reason; an entry here
 * is a conscious exemption, not a silencer.
 */
const ASK_DOORS_EXEMPT: ReadonlyArray<{ path: string; reason: string }> = [];

/** Dirs holding executable doors — prose a consumer follows, not commentary. */
const DOOR_DIRS = ["commands", "codex-skills", "skills", "references"];

const repoRoot = path.resolve(import.meta.dirname, "..");

function listMarkdownFiles(dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { recursive: true, encoding: "utf-8" })
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => path.join(dir, rel));
}

/** Read prose with whitespace collapsed, so substring checks survive wrapping. */
function readProse(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8").replace(/\s+/g, " ");
}

/** Every door that shells out to `companion.cjs ask`, discovered from the tree. */
const DISCOVERED_ASK_DOORS = DOOR_DIRS.flatMap(listMarkdownFiles).filter((rel) =>
  /companion\.cjs"?\s+ask\b/.test(fs.readFileSync(path.join(repoRoot, rel), "utf-8")),
);

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Run the CLI in an isolated cwd + state dir. */
function runCli(
  args: string[],
  opts: { cwd?: string; binDir?: string } = {},
): { status: number | null; stdout: string; stderr: string } {
  const dataDir = makeTempDir("harry-ask-data-");
  const cwd = opts.cwd ?? makeTempDir("harry-ask-cwd-");
  const base = opts.binDir ? buildEnv(opts.binDir) : process.env;
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...base, CLAUDE_PLUGIN_DATA: dataDir },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("ask marks a truncated answer as failed instead of passing it off as the reply", () => {
  const binDir = makeTempDir("harry-ask-bin-");
  installFakeCodex(binDir, "task-truncated-then-error");

  const res = runCli(["ask", "why is it slow"], { cwd: binDir, binDir });

  // The headline defect: the body arrives and reads like a finished answer.
  assert.match(
    res.stdout,
    /The three main causes are:/,
    `expected the partial body to be preserved, got:\n${res.stdout}`,
  );
  // ...so stdout must say, in the stdout itself, that it is NOT a real answer.
  // Opening with the marker also pins it ABOVE the body: a consumer quoting
  // stdout verbatim has to hit the warning before the text it qualifies.
  assert.ok(
    res.stdout.startsWith(`${ASK_FAILED_MARKER}\n`),
    `expected stdout to open with the "${ASK_FAILED_MARKER}" marker, got:\n${res.stdout}`,
  );
  assert.match(res.stderr, /^Ask failed: /m, `expected an "Ask failed:" line on stderr`);
  // The other stderr signal the doors tell consumers to watch for.
  assert.ok(
    res.stderr.includes(FATAL_ERROR_PREFIX),
    `expected a "${FATAL_ERROR_PREFIX}" line on stderr, got:\n${res.stderr}`,
  );
  assert.notEqual(res.status, 0, "expected a non-zero exit status");
});

test("ask leaves the failure marker off a successful answer", () => {
  // The marker is a discriminator, so it needs both poles: proving it appears on
  // failure is only half. If it also appeared on success, every door-following
  // consumer would refuse every good answer — and the failure-path tests above
  // would still pass.
  const binDir = makeTempDir("harry-ask-bin-");
  installFakeCodex(binDir, "task-ok");

  const res = runCli(["ask", "hello there"], { cwd: binDir, binDir });

  assert.equal(res.status, 0, `ask failed:\n${res.stderr}`);
  assert.match(res.stdout, /Handled the requested task\./);
  assert.ok(
    !res.stdout.includes(ASK_FAILED_MARKER),
    `a successful ask must not emit the "${ASK_FAILED_MARKER}" marker, got:\n${res.stdout}`,
  );
  assert.ok(
    !res.stderr.includes(FATAL_ERROR_PREFIX),
    `a successful ask must not emit a "${FATAL_ERROR_PREFIX}" line, got:\n${res.stderr}`,
  );
});

test("ask marks a timed-out turn as failed and names the timeout", () => {
  const binDir = makeTempDir("harry-ask-bin-");
  installFakeCodex(binDir, "task-stuck");

  const res = runCli(["ask", "hello there", "--timeout", "500"], { cwd: binDir, binDir });

  assert.ok(
    res.stdout.startsWith(`${ASK_FAILED_MARKER}\n`),
    `expected stdout to open with the "${ASK_FAILED_MARKER}" marker, got:\n${res.stdout}`,
  );
  assert.match(
    res.stdout,
    /Timed out after 500ms\./,
    `expected the timeout reason on stdout, got:\n${res.stdout}`,
  );
  assert.match(res.stderr, /^Ask failed: Timed out after 500ms\./m);
  assert.notEqual(res.status, 0, "expected a non-zero exit status");
});

test("every door that tells a consumer to trust ask's stdout quotes the failure signals", () => {
  // Live prose↔code contract, the same shape as tests/args.test.ts's --harry-fix
  // guard. Each door instructs consumers to return ask's stdout verbatim and
  // names these signals as the reasons not to. The signals are declared once
  // above and asserted against the LIVE CLI by the tests above, so renaming one
  // in src/ fails there and rewording any single door fails here — neither side
  // can move alone.
  for (const { path: door, quotes, prohibition } of ASK_DOORS) {
    const prose = readProse(door);
    for (const signal of quotes) {
      assert.ok(
        prose.includes(signal),
        `${door} no longer quotes ask's failure signal ("${signal}"). ` +
          `That door is now stale: it will tell consumers to present a failed body as the model's answer.`,
      );
    }
    // Quoting the signal is not enough — the door must also tell the consumer
    // NOT to relay the body. A door can name the marker and still say "ignore
    // it and return the body verbatim", which is worse than silence.
    assert.ok(
      prose.includes(prohibition),
      `${door} quotes ask's failure signals but no longer prohibits relaying the body ` +
        `("${prohibition}"). Naming a signal without a directive leaves the consumer free to present it as the answer.`,
    );
    assert.ok(
      !prose.includes(PHANTOM_STATUS_GUARD),
      `${door} has regrown the phantom status guard ("${PHANTOM_STATUS_GUARD}"). ` +
        `ask has no JSON mode and no status field, so that instruction can never fire.`,
    );
  }
});

test("every discovered ask-invoking door is declared in ASK_DOORS or explicitly exempt", () => {
  // Keeps the hand-maintained list above honest: a new door that shells out to
  // `ask` must be classified, not silently skipped. A derived list that matches
  // nothing would be worse than no list, so pin the floor first.
  assert.ok(
    DISCOVERED_ASK_DOORS.length >= ASK_DOORS.length,
    `door discovery matched only ${DISCOVERED_ASK_DOORS.length} file(s) but ${ASK_DOORS.length} are declared — ` +
      `the invocation pattern has drifted and this guard is now vacuous.`,
  );

  for (const door of DISCOVERED_ASK_DOORS) {
    const declared =
      ASK_DOORS.some((d) => d.path === door) || ASK_DOORS_EXEMPT.some((e) => e.path === door);
    assert.ok(
      declared,
      `${door} invokes \`ask\` but is not in ASK_DOORS. Either it relays stdout verbatim ` +
        `(add it to ASK_DOORS so its failure instructions are pinned), or it does not ` +
        `(add it to ASK_DOORS_EXEMPT with a reason).`,
    );
  }
});
