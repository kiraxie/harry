import path from "node:path";

import { pluginRoot } from "../plugin-root.ts";
import { failureTail, runToolPython, type Tool } from "./tools.ts";

/**
 * The overlay check: whether mutator's worker can measure a file at all. It runs
 * as the cap selects sites (src/lib/metrics/select.ts), wired in by
 * src/commands/metrics.ts. Removing it once mutator checks this itself starts from
 * this module and overlay-check.py; every other place it reaches is what
 * `grep -ril overlay src tests` lists.
 */

/** A file mutator's worker cannot measure, so mutator never runs it. */
export interface NotMeasured {
  file: string;
  /** `baseline`: the tests fail in the worker without a mutant; `unseen`: no test sees the file there. */
  kind: "baseline" | "unseen";
  /** The worker baseline's output tail; empty for an unseen file. */
  tail: string;
}

/** The check runs the test command twice per file: the worker baseline, then the canary. */
export const OVERLAY_CHECK_RUNS = 2;

const OVERLAY_VERDICTS = { baseline: ["pass", "fail"], canary: ["pass", "fail"] } as const;

/**
 * Checks `file` (relative to `dir`) in one worker that mutator's own code builds
 * (src/lib/metrics/overlay-check.py): a red worker baseline, or a canary that
 * breaks the file and leaves the tests green, means mutator's outcomes for it
 * would be false kills or false survivors. Null when mutator can measure it.
 * A check that exits non-zero or prints no verdict throws, as a mutator failure does.
 */
export function checkFile(
  tool: Tool,
  dir: string,
  file: string,
  testCommand: string | null,
): NotMeasured | null {
  const script = path.join(pluginRoot(), "src", "lib", "metrics", "overlay-check.py");
  const run = runToolPython(tool, [script, dir, file, testCommand ?? ""]);
  const verdict = run.status === 0 ? parseVerdict(run.stdout) : null;
  if (verdict === null) {
    throw new Error(
      `overlay check of ${file} exited ${run.status} with no verdict\n${failureTail(run)}`,
    );
  }
  if (verdict.baseline === "fail") return { file, kind: "baseline", tail: verdict.tail };
  if (verdict.canary === "pass") return { file, kind: "unseen", tail: "" };
  return null;
}

function parseVerdict(stdout: string): { baseline: string; canary: string; tail: string } | null {
  const last = stdout.trim().split("\n").at(-1) ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    return null;
  }
  const v = parsed as Record<string, unknown> | null;
  if (
    v === null ||
    typeof v !== "object" ||
    !OVERLAY_VERDICTS.baseline.some((b) => b === v.baseline) ||
    !OVERLAY_VERDICTS.canary.some((c) => c === v.canary) ||
    typeof v.tail !== "string"
  ) {
    return null;
  }
  return { baseline: v.baseline as string, canary: v.canary as string, tail: v.tail };
}
