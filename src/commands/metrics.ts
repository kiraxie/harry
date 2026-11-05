import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getRepoRoot, gitChecked } from "../lib/git.ts";
import {
  beforeComplexity,
  type CrapEntry,
  changedRanges,
  functionSpans,
  judge,
  renderJudged,
  renderOverBar,
  runCrapper,
} from "../lib/metrics/crapper.ts";
import { DRYER_SCOPE_NOTE, renderPairs, runDryer, touching } from "../lib/metrics/dryer.ts";
import {
  coveragePlan,
  describe,
  type Group,
  groupFiles,
  packageManager,
  repoPath,
  runCoverage,
} from "../lib/metrics/groups.ts";
import { withArtifactGuard } from "../lib/metrics/guard.ts";
import { Interrupted, rethrowInterrupt } from "../lib/metrics/interrupt.ts";
import { renderSurvivor, runMutator } from "../lib/metrics/mutator.ts";
import { changedSourceFiles, trackedSourceFiles, withSnapshot } from "../lib/metrics/scope.ts";
import {
  displayPath,
  findTool,
  TOOL_NAMES,
  type Tool,
  type ToolName,
  toolsDir,
} from "../lib/metrics/tools.ts";

export interface MetricsOptions {
  base?: string;
  out?: string;
  audit?: boolean;
  runTests?: boolean;
}

type Tools = Record<ToolName, Tool | null>;

function notInstalled(name: ToolName): string {
  const where = displayPath(path.join(toolsDir(), name, name));
  return `not installed (expected at ${where}; \`/harry:sync --tools\` installs it)`;
}

function failed(err: unknown, tool: Tool): string {
  return `failed: ${(err as Error).message.trim()} (tool commit ${tool.commit})`;
}

function attempt(tool: Tool, body: (tool: Tool) => string): string {
  try {
    return body(tool);
  } catch (err) {
    rethrowInterrupt(err);
    return failed(err, tool);
  }
}

function section(name: ToolName, tool: Tool | null, body: (tool: Tool) => string): string {
  if (tool === null) return `## ${name}\n\n${notInstalled(name)}\n`;
  return `## ${name} (${tool.commit.slice(0, 7)})\n\n${attempt(tool, body)}\n`;
}

interface Coverage {
  /** Null when a coverage report is ready, else why the group is scored without one. */
  gap: string | null;
  how: string;
}

function measureCoverage(root: string, group: Group): Coverage {
  const plan = coveragePlan(root, group);
  if ("skip" in plan) return { gap: plan.skip, how: `complexity only: ${plan.skip}` };
  const gap = runCoverage(path.join(root, group.dir), plan.commands);
  return {
    gap,
    how: gap === null ? `coverage: ${describe(plan.commands)}` : `complexity only: ${gap}`,
  };
}

function groupLabel(group: Group): string {
  return group.dir === "" ? "(repo root)" : group.dir;
}

function beforeRun(tool: Tool, root: string, base: string, groups: Group[]) {
  return withSnapshot(root, base, (snap) => {
    const out = new Map<Group, Map<string, number>>();
    for (const group of groups) {
      const dir = path.join(snap, group.dir);
      const files = group.files.filter((f) => existsSync(path.join(dir, f)));
      const entries: CrapEntry[] = files.length > 0 ? runCrapper(tool, dir, files, false) : [];
      out.set(group, beforeComplexity(entries));
    }
    return out;
  });
}

function crapperGroup(
  tool: Tool,
  root: string,
  base: string,
  group: Group,
  before: Map<string, number>,
  coverageGap: string | null,
): string {
  const dir = path.join(root, group.dir);
  const after = runCrapper(tool, dir, group.files, coverageGap === null);
  const spans = functionSpans(tool, dir, group.files);
  const hits = judge(after, before, spans, (file) =>
    changedRanges(root, base, repoPath(group, file)),
  );
  const lines = hits.map((h) => renderJudged(h, (s) => `${repoPath(group, s.file)}:${s.start}`));
  return lines.length > 0 ? lines.join("\n") : "No new or touched function crosses the bar.";
}

interface Phase {
  crapper: string | null;
  mutator: string | null;
  problems: string[];
}

function eachGroup(groups: Group[], tool: Tool, body: (group: Group) => [string, string]): string {
  return groups
    .map((group) => {
      let heading: string;
      let text: string;
      try {
        [heading, text] = body(group);
      } catch (err) {
        rethrowInterrupt(err);
        heading = "";
        text = failed(err, tool);
      }
      return `### ${groupLabel(group)}${heading ? ` — ${heading}` : ""}\n\n${text}`;
    })
    .join("\n\n");
}

/**
 * Coverage, crapper and mutator in the user's checkout, under the artifact
 * guard. `crapperBody` scores one group; null leaves crapper out of the phase.
 */
function checkoutPhase(
  root: string,
  groups: Group[],
  tools: Tools,
  crapperBody: ((tool: Tool) => (group: Group, gap: string | null) => string) | null,
): Phase {
  const guarded = withArtifactGuard(root, ["", ...groups.map((g) => g.dir)], () => {
    const needsCoverage = (crapperBody && tools.crapper) || tools.mutator;
    const coverage = new Map<Group, Coverage>(
      needsCoverage ? groups.map((g) => [g, measureCoverage(root, g)]) : [],
    );
    const covOf = (g: Group) => coverage.get(g) as Coverage;

    const crapper =
      crapperBody === null || tools.crapper === null
        ? null
        : attempt(tools.crapper, (tool) => {
            const score = crapperBody(tool);
            return eachGroup(groups, tool, (g) => [covOf(g).how, score(g, covOf(g).gap)]);
          });

    const mutator =
      tools.mutator === null
        ? null
        : attempt(tools.mutator, (tool) => {
            const pm = packageManager(root);
            return eachGroup(groups, tool, (group) => {
              const gap = covOf(group).gap;
              const testCommand = group.kind === "node" ? `${pm} test` : null;
              const dir = path.join(root, group.dir);
              const survivors = runMutator(tool, dir, group.files, gap === null, testCommand);
              const text =
                survivors.length > 0
                  ? survivors
                      .map((s) => renderSurvivor(s, `${repoPath(group, s.file)}:${s.line}`))
                      .join("\n")
                  : "No mutant survived.";
              return [
                gap === null ? "uncovered lines skipped" : "every site run (no coverage)",
                text,
              ];
            });
          });

    return { crapper, mutator };
  });
  return {
    ...guarded.result,
    problems: [
      ...guarded.leftovers.map((l) => `left in the checkout: ${l}`),
      ...guarded.unrestored.map((u) => `not restored: ${u}`),
    ],
  };
}

function writeFacts(file: string, header: string, sections: string[], problems: string[]): void {
  const facts = ["# Metrics facts", "", header, "", ...sections];
  if (problems.length > 0) {
    facts.push("## Checkout", "", ...problems.map((p) => `- ${p}`), "");
    console.error(`metrics changed the checkout:\n${problems.join("\n")}`);
    process.exitCode = 1;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, facts.join("\n"));
}

function loadTools(): Tools {
  return Object.fromEntries(TOOL_NAMES.map((n) => [n, findTool(n)])) as Tools;
}

function headOf(root: string): string {
  return gitChecked(root, ["rev-parse", "HEAD"]).stdout.trim();
}

async function runUnit(cwd: string, baseRef: string, out: string): Promise<void> {
  const root = getRepoRoot(cwd);
  const base = gitChecked(root, ["merge-base", baseRef, "HEAD"]).stdout.trim();
  const changed = changedSourceFiles(root, base);
  const head = headOf(root);
  const tools = loadTools();
  const none = "skipped: no changed source files";

  const dryer = section("dryer", tools.dryer, (tool) => {
    if (changed.length === 0) return none;
    const pairs = withSnapshot(root, head, (dir) => runDryer(tool, dir));
    const hits = renderPairs(
      touching(pairs, new Set(changed)),
      "No duplicate pair touches a changed file.",
    );
    return `${hits}\n\n${DRYER_SCOPE_NOTE}`;
  });

  const groups = changed.length > 0 ? groupFiles(root, changed) : [];
  const phase =
    groups.length === 0
      ? { crapper: none, mutator: none, problems: [] }
      : checkoutPhase(root, groups, tools, (tool) => {
          const before = beforeRun(tool, root, base, groups);
          return (group, gap) =>
            crapperGroup(tool, root, base, group, before.get(group) ?? new Map(), gap);
        });

  writeFacts(
    path.resolve(cwd, out),
    `Base: ${baseRef} (branch point ${base.slice(0, 7)}) · Head: ${head.slice(0, 7)} · Changed source files: ${changed.length}`,
    [
      dryer,
      section("crapper", tools.crapper, () => phase.crapper ?? ""),
      section("mutator", tools.mutator, () => phase.mutator ?? ""),
    ],
    phase.problems,
  );
}

function copyFrom(dir: string, rel: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(path.join(dir, rel), to);
}

async function runAudit(cwd: string, out: string, runTests: boolean): Promise<void> {
  const root = getRepoRoot(cwd);
  const head = headOf(root);
  const tools = loadTools();
  const outDir = path.resolve(cwd, out);
  mkdirSync(outDir, { recursive: true });

  const dryer = section("dryer", tools.dryer, (tool) => {
    const pairs = withSnapshot(root, head, (dir) => {
      const found = runDryer(tool, dir);
      if (existsSync(path.join(dir, ".metrics/dry.edn"))) {
        copyFrom(dir, ".metrics/dry.edn", path.join(outDir, "dry.edn"));
      }
      return found;
    });
    return `${renderPairs(pairs, "No duplicate pair found.")}\n\n${DRYER_SCOPE_NOTE}`;
  });

  const phase = runTests
    ? checkoutPhase(
        root,
        groupFiles(root, trackedSourceFiles(root)),
        tools,
        (tool) => (group, gap) => {
          const dir = path.join(root, group.dir);
          return renderOverBar(runCrapper(tool, dir, group.files, gap === null), {
            spans: functionSpans(tool, dir, group.files),
            where: (s) => `${repoPath(group, s.file)}:${s.start}`,
          });
        },
      )
    : null;

  const crapper = section("crapper", tools.crapper, (tool) => {
    const complexity = attempt(tool, () =>
      withSnapshot(root, head, (dir) => {
        const entries = runCrapper(tool, dir, [], false);
        copyFrom(dir, ".metrics/crap.edn", path.join(outDir, "crap.edn"));
        return renderOverBar(entries);
      }),
    );
    const parts = [`### complexity only, tracked files at ${head.slice(0, 7)}\n\n${complexity}`];
    if (phase?.crapper) parts.push(phase.crapper);
    return parts.join("\n\n");
  });
  const mutator = section(
    "mutator",
    tools.mutator,
    () =>
      phase?.mutator ??
      "skipped: runs only with --run-tests (it runs the test suite once per mutant)",
  );

  writeFacts(
    path.join(outDir, "metrics.md"),
    `Audit of ${head.slice(0, 7)} (tracked files)${runTests ? " · with --run-tests" : ""}`,
    [dryer, crapper, mutator],
    phase?.problems ?? [],
  );
}

export async function runMetrics(cwd: string, options: MetricsOptions): Promise<void> {
  try {
    await dispatch(cwd, options);
  } catch (err) {
    if (!(err instanceof Interrupted)) throw err;
    console.error(err.message);
    process.exitCode = err.exitCode;
  }
}

async function dispatch(cwd: string, options: MetricsOptions): Promise<void> {
  if (!options.out) throw new Error("metrics requires --out <file|dir>.");
  if (options.audit) {
    if (options.base) throw new Error("metrics --audit takes no --base.");
    return runAudit(cwd, options.out, options.runTests === true);
  }
  if (options.runTests) throw new Error("--run-tests applies only to metrics --audit.");
  if (!options.base) throw new Error("metrics requires --base <ref> (or --audit).");
  return runUnit(cwd, options.base, options.out);
}
