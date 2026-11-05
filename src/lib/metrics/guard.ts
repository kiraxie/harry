import { createHash } from "node:crypto";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import { gitChecked } from "../git.ts";
import { holdStopSignals } from "./interrupt.ts";

const ARTIFACTS = [
  ".metrics",
  ".coverage",
  "coverage",
  "target/coverage",
  "target/mutation-workers",
  "target/mutator-backup",
];

const STASH_NAME = "harry-metrics-stash";

export interface GuardResult<T> {
  result: T;
  /** Status entries that differ from before the run, and dirty paths whose content changed. */
  leftovers: string[];
  /** Paths moved aside that could not be put back, with where they are now. */
  unrestored: string[];
}

interface StatusEntry {
  line: string;
  path: string;
}

function statusEntries(root: string): StatusEntry[] {
  const tokens = gitChecked(root, ["status", "--porcelain", "-z", "-uall"]).stdout.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "") continue;
    const xy = token.slice(0, 2);
    const file = token.slice(3);
    if (/[RC]/.test(xy)) {
      entries.push({ line: `${xy} ${tokens[i + 1]} -> ${file}`, path: file });
      i++;
    } else {
      entries.push({ line: token, path: file });
    }
  }
  return entries;
}

function present(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function fingerprint(file: string): string {
  try {
    const st = lstatSync(file);
    if (st.isSymbolicLink()) return `link:${readlinkSync(file)}`;
    if (!st.isFile()) return `other:${st.mode}`;
    return `file:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
  } catch {
    return "absent";
  }
}

function readManifest(stash: string): string[] {
  try {
    return readFileSync(path.join(stash, "manifest"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace("\t", " → "));
  } catch {
    return [];
  }
}

/** The stash dir doubles as the lock: one run at a time, and never over a stash an earlier run left. */
function claimStash(stash: string): void {
  try {
    mkdirSync(stash);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const held = readManifest(stash);
    const entries = readdirSync(stash).filter((e) => e !== "manifest");
    throw new Error(
      [
        `${stash} exists: another metrics run is in progress, or an earlier one stopped before restoring.`,
        held.length > 0
          ? `It holds (entry → original path):\n${held.map((h) => `  ${h}`).join("\n")}`
          : `It holds: ${entries.length > 0 ? entries.join(", ") : "nothing"}`,
        "Once no run is in progress, move each entry back to its path and remove the dir.",
      ].join("\n"),
    );
  }
}

/**
 * Runs `fn` with every tool artifact path in `dirs` absent: a pre-existing one
 * is moved into the git dir and put back afterwards, so tools start fresh and
 * read no stale report. Afterwards only paths absent before the run are deleted.
 */
export function withArtifactGuard<T>(root: string, dirs: string[], fn: () => T): GuardResult<T> {
  const gitDir = gitChecked(root, ["rev-parse", "--absolute-git-dir"]).stdout.trim();
  const stash = path.join(gitDir, STASH_NAME);
  claimStash(stash);
  const releaseSignals = holdStopSignals();
  const unrestored: string[] = [];
  try {
    return guarded(root, dirs, stash, unrestored, fn);
  } finally {
    if (unrestored.length === 0) rmSync(stash, { recursive: true, force: true });
    releaseSignals();
  }
}

function guarded<T>(
  root: string,
  dirs: string[],
  stash: string,
  unrestored: string[],
  fn: () => T,
): GuardResult<T> {
  const before = statusEntries(root);
  const sums = new Map(before.map((e) => [e.path, fingerprint(path.join(root, e.path))]));

  const unique = [...new Set(dirs.map((d) => path.resolve(root, d)))];
  const existed = new Set(
    unique.flatMap((d) => ARTIFACTS.map((rel) => path.join(d, rel))).filter(present),
  );
  const hadTarget = new Map(unique.map((d) => [d, present(path.join(d, "target"))]));
  const moved: [string, string][] = [];
  const notRemoved: string[] = [];
  const remove = (p: string) => {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch (err) {
      notRemoved.push(`${p} (could not remove: ${(err as Error).message})`);
    }
  };

  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    for (const p of existed) {
      const aside = path.join(stash, String(moved.length));
      // Written before the move: kill -9 skips the restore, and the manifest is then
      // what names where each entry goes back.
      appendFileSync(path.join(stash, "manifest"), `${moved.length}\t${p}\n`);
      renameSync(p, aside);
      moved.push([p, aside]);
    }
    outcome = { ok: true, value: fn() };
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    const restoring = new Set(moved.map(([p]) => p));
    for (const dir of unique) {
      for (const rel of ARTIFACTS) {
        const p = path.join(dir, rel);
        if (!existed.has(p) || restoring.has(p)) remove(p);
      }
      if (!hadTarget.get(dir)) remove(path.join(dir, "target"));
    }
    for (const [p, aside] of moved) {
      try {
        mkdirSync(path.dirname(p), { recursive: true });
        renameSync(aside, p);
      } catch (err) {
        unrestored.push(`${p} (left at ${aside}: ${(err as Error).message})`);
      }
    }
  }

  const after = statusEntries(root);
  const beforeLines = new Set(before.map((e) => e.line));
  const afterLines = new Set(after.map((e) => e.line));
  const changedInPlace = before
    .filter((e) => afterLines.has(e.line))
    .filter((e) => fingerprint(path.join(root, e.path)) !== sums.get(e.path))
    .map((e) => `${e.line} (content changed during the run)`);
  const leftovers = [
    ...after.filter((e) => !beforeLines.has(e.line)).map((e) => e.line),
    ...before.filter((e) => !afterLines.has(e.line)).map((e) => e.line),
    ...changedInPlace,
    ...notRemoved,
  ];
  if (!outcome.ok) {
    const error = outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
    if (leftovers.length > 0) error.message += `\nleft in the checkout:\n${leftovers.join("\n")}`;
    if (unrestored.length > 0) error.message += `\nnot restored:\n${unrestored.join("\n")}`;
    throw error;
  }
  return { result: outcome.value, leftovers, unrestored };
}
