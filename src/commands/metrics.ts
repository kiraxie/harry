import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
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
  type Group,
  groupFiles,
  packageManager,
  repoPath,
  runCoverage,
} from "../lib/metrics/groups.ts";
import { withArtifactGuard } from "../lib/metrics/guard.ts";
import { Interrupted, rethrowInterrupt } from "../lib/metrics/interrupt.ts";
import {
  mutatorCores,
  type NotMeasured,
  type Outcome,
  OVERLAY_CHECK_RUNS,
  renderSurvivor,
  runCost,
  runMutator,
  runSelected,
  type Site,
  scanChanged,
  siteKey,
} from "../lib/metrics/mutator.ts";
import {
  addedLines,
  byPath,
  changedSourceFiles,
  trackedSourceFiles,
  withSnapshot,
} from "../lib/metrics/scope.ts";
import {
  findTool,
  isMissing,
  type Missing,
  TOOL_NAMES,
  type Tool,
  type ToolName,
} from "../lib/metrics/tools.ts";

export interface MetricsOptions {
  base?: string;
  out?: string;
  audit?: boolean;
  runTests?: boolean;
  plan?: boolean;
  only?: string;
  testCommand?: string;
  coverageCommand?: string;
  maxWorkers?: number;
  maxMutants?: number;
}

/** What a unit run takes from the command line beyond its base and output. */
interface UnitOptions {
  only: string | null;
  testCommand: string | null;
  coverageCommand: string | null;
  maxWorkers: number | null;
  maxMutants: number | null;
}

type Tools = Record<ToolName, Tool | Missing>;

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

function section(name: ToolName, tool: Tool | Missing, body: (tool: Tool) => string): string {
  if (isMissing(tool)) return `## ${name}\n\n${tool.missing}\n`;
  return `## ${name} (${tool.commit.slice(0, 7)})\n\n${attempt(tool, body)}\n`;
}

interface Coverage {
  /** Null when a coverage report is ready, else why the group is scored without one. */
  gap: string | null;
  how: string;
  /** The coverage command that ran, null when none could. */
  command: string | null;
}

function measureCoverage(root: string, group: Group, override: string | null): Coverage {
  const plan = coveragePlan(root, group, override);
  if ("skip" in plan) {
    return { gap: plan.skip, how: `complexity only: ${plan.skip}`, command: null };
  }
  const gap = runCoverage(path.join(root, group.dir), plan);
  return {
    gap,
    how: gap === null ? `coverage: ${plan.label}` : `complexity only: ${gap}`,
    command: plan.label,
  };
}

function groupLabel(group: Group): string {
  return group.dir === "" ? "(repo root)" : group.dir;
}

/** A group dir as `--only` spells it: `.` for the repo root. */
function onlyName(dir: string): string {
  return dir === "" ? "." : dir;
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

type MutatorBody = (tool: Tool) => (group: Group, coverage: Coverage) => [string, string];

/**
 * Coverage, crapper and mutator in the user's checkout, under the artifact
 * guard. `crapperBody` scores one group; null leaves crapper out of the phase.
 * `mutatorBody` runs mutator on one group, once the factory has set it up.
 */
function checkoutPhase(
  root: string,
  groups: Group[],
  tools: Tools,
  coverageCommand: string | null,
  crapperBody: ((tool: Tool) => (group: Group, gap: string | null) => string) | null,
  mutatorBody: MutatorBody,
): Phase {
  const guarded = withArtifactGuard(root, ["", ...groups.map((g) => g.dir)], () => {
    const needsCoverage =
      (crapperBody !== null && !isMissing(tools.crapper)) || !isMissing(tools.mutator);
    const coverage = new Map<Group, Coverage>(
      needsCoverage ? groups.map((g) => [g, measureCoverage(root, g, coverageCommand)]) : [],
    );
    const covOf = (g: Group) => coverage.get(g) as Coverage;

    const crapper =
      crapperBody === null || isMissing(tools.crapper)
        ? null
        : attempt(tools.crapper, (tool) => {
            const score = crapperBody(tool);
            return eachGroup(groups, tool, (g) => [covOf(g).how, score(g, covOf(g).gap)]);
          });

    const mutator = isMissing(tools.mutator)
      ? null
      : attempt(tools.mutator, (tool) => {
          const body = mutatorBody(tool);
          return eachGroup(groups, tool, (group) => body(group, covOf(group)));
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

/**
 * The survivors among `outcomes`. `ran` is whether mutator executed any mutant at
 * all; when none ran, the section says so, never that nothing survived.
 */
function survivorLines(group: Group, outcomes: Outcome[], ran: boolean): string {
  if (!ran) return "No mutant ran.";
  const survivors = outcomes.filter((o) => o.survived);
  if (survivors.length === 0) return "No mutant survived.";
  return survivors.map((s) => renderSurvivor(s, `${repoPath(group, s.file)}:${s.line}`)).join("\n");
}

function coverageHeading(coverage: Coverage): string {
  return coverage.gap === null ? "uncovered lines skipped" : "every site run (no coverage)";
}

/** Audit mode: every site in every tracked file, with today's default test command. */
function auditMutator(root: string): MutatorBody {
  const pm = packageManager(root);
  return (tool) => (group, coverage) => {
    const testCommand = group.kind === "node" ? `${pm} test` : null;
    const outcomes = runMutator(
      tool,
      path.join(root, group.dir),
      group.files,
      coverage.gap === null,
      {
        testCommand,
        lines: null,
        maxWorkers: null,
      },
    );
    return [coverageHeading(coverage), survivorLines(group, outcomes, outcomes.length > 0)];
  };
}

/** Changed lines per repo-relative file. */
type ChangedLines = Map<string, Set<number>>;

function changedLinesOf(root: string, base: string, groups: Group[]): ChangedLines {
  const lines: ChangedLines = new Map();
  for (const group of groups) {
    for (const file of group.files) {
      const rel = repoPath(group, file);
      lines.set(rel, addedLines(root, base, rel));
    }
  }
  return lines;
}

interface Selection {
  /** Every site the group's scan lists, the off-line ones included. */
  scanned: Site[];
  /** Every site on a changed line, by repo path, then line. */
  sites: Site[];
  /** The sites that run: all of them, or the first n under --max-mutants, finishing the last line. */
  selected: Site[];
}

/**
 * Splits the unit's changed-line sites across groups. Under `maxMutants` the first
 * n by repo path, then line, are selected and the last line reached is finished
 * whole, since mutator selects by line.
 */
function selectSites(
  tool: Tool,
  root: string,
  groups: Group[],
  changed: ChangedLines,
  maxMutants: number | null,
): Map<Group, Selection> {
  const out = new Map<Group, Selection>();
  const all = groups.flatMap((group) => {
    const own = new Map(
      group.files.map((f) => [f, changed.get(repoPath(group, f)) ?? new Set<number>()]),
    );
    const { scanned, onChanged } = scanChanged(tool, path.join(root, group.dir), own);
    out.set(group, { scanned, sites: [], selected: [] });
    return onChanged.map((site) => ({ group, site }));
  });
  const where = (e: { group: Group; site: Site }) => repoPath(e.group, e.site.file);
  all.sort((a, b) => byPath(where(a), where(b)) || a.site.line - b.site.line);
  let cut = all.length;
  if (maxMutants !== null && maxMutants < all.length) {
    cut = maxMutants;
    const last = all[cut - 1];
    while (
      cut < all.length &&
      where(all[cut]) === where(last) &&
      all[cut].site.line === last.site.line
    ) {
      cut++;
    }
  }
  all.forEach((e, i) => {
    const sel = out.get(e.group) as Selection;
    sel.sites.push(e.site);
    if (i < cut) sel.selected.push(e.site);
  });
  return out;
}

/** `file:line` of each site not selected, with how many sites share the line. */
function notSelectedLines(group: Group, sel: Selection): string[] {
  const selected = new Set(sel.selected.map(siteKey));
  const counts = new Map<string, number>();
  for (const site of sel.sites) {
    if (selected.has(siteKey(site))) continue;
    const at = `${repoPath(group, site.file)}:${site.line}`;
    counts.set(at, (counts.get(at) ?? 0) + 1);
  }
  return [...counts].map(([at, n]) => `- ${at}${n > 1 ? ` (${n} sites)` : ""}`);
}

/** Each file mutator's worker cannot measure, with the reason and, under it, the worker baseline's tail. */
function notMeasuredLines(group: Group, notMeasured: NotMeasured[]): string[] {
  return notMeasured.flatMap((n) => [
    `- ${repoPath(group, n.file)}: ${n.reason}`,
    ...(n.tail === "" ? [] : n.tail.split("\n").map((l) => `    ${l}`)),
  ]);
}

/**
 * Unit mode: only the selected sites on changed lines run, and only their outcomes
 * count. A handed file mutator's worker cannot measure is listed, never mutated.
 */
function unitMutator(
  root: string,
  groups: Group[],
  changed: ChangedLines,
  opts: UnitOptions,
): MutatorBody {
  const pm = packageManager(root);
  return (tool) => {
    const selection = selectSites(tool, root, groups, changed, opts.maxMutants);
    return (group, coverage) => {
      const sel = selection.get(group) as Selection;
      const defaultCommand = group.kind === "node" ? `${pm} test` : null;
      const testCommand = opts.testCommand ?? defaultCommand;
      const { outcomes, executedPerFile, notMeasured } = runSelected(
        tool,
        path.join(root, group.dir),
        sel.selected,
        coverage.gap === null,
        { testCommand, maxWorkers: opts.maxWorkers },
      );
      // Every changed-line site of a file the check rejected is not measured, the
      // ones the cap left out included: no cap would ever measure them.
      const unmeasured = new Set(notMeasured.map((n) => n.file));
      const measured = (s: Site) => !unmeasured.has(s.file);
      const notMeasuredSites = sel.sites.length - sel.sites.filter(measured).length;
      const uncovered = sel.selected.filter(measured).length - outcomes.length;
      const leftOut = { ...sel, sites: sel.sites.filter(measured) };
      const notSelected = leftOut.sites.length - sel.selected.filter(measured).length;
      const executed = [...executedPerFile.values()].reduce((a, b) => a + b, 0);
      const ranPerFile = [...executedPerFile].map(([f, n]) => `${repoPath(group, f)} ${n}`);
      const facts = [
        `Test command: ${testCommand === null ? "mutator's default for the language" : `\`${testCommand}\``} · Coverage command: ${coverage.command === null ? "none" : `\`${coverage.command}\``}`,
        `Sites on changed lines: ${sel.sites.length} · run: ${outcomes.length} · not run (uncovered): ${uncovered} · not measured: ${notMeasuredSites} · not selected (--max-mutants): ${notSelected}`,
        `Executed by mutator, off-line sites included: ${executed}${ranPerFile.length > 0 ? ` (${ranPerFile.join(", ")})` : ""}`,
        "",
        survivorLines(group, outcomes, executed > 0),
      ];
      if (notMeasured.length > 0) {
        facts.push("", "Not measured:", ...notMeasuredLines(group, notMeasured));
      }
      if (notSelected > 0) {
        facts.push("", "Not selected (--max-mutants):", ...notSelectedLines(group, leftOut));
      }
      return [coverageHeading(coverage), facts.join("\n")];
    };
  };
}

/** The groups a unit run covers; a command flag needs them all in one directory. */
function scopeGroups(groups: Group[], opts: UnitOptions): Group[] {
  const names = (gs: Group[]) => [...new Set(gs.map((g) => onlyName(g.dir)))];
  let scoped = groups;
  if (opts.only !== null) {
    const dir = path.posix.normalize(opts.only).replace(/^\.\/|\/$/g, "");
    scoped = groups.filter((g) => g.dir === (dir === "." ? "" : dir));
    if (scoped.length === 0) {
      const known = names(groups);
      throw new Error(
        `--only ${opts.only} matches no group with changed source files${known.length > 0 ? ` (groups: ${known.join(", ")})` : ""}.`,
      );
    }
  }
  const dirs = names(scoped);
  if ((opts.testCommand !== null || opts.coverageCommand !== null) && dirs.length > 1) {
    throw new Error(
      `--test-command and --coverage-command apply to one group directory, and ${dirs.length} are in scope: ${dirs.join(", ")}. Pick one with --only <dir>.`,
    );
  }
  return scoped;
}

interface UnitScope {
  root: string;
  base: string;
  changed: string[];
  groups: Group[];
}

function unitScope(cwd: string, baseRef: string, opts: UnitOptions): UnitScope {
  const root = getRepoRoot(cwd);
  const base = gitChecked(root, ["merge-base", baseRef, "HEAD"]).stdout.trim();
  const changed = changedSourceFiles(root, base);
  const groups = scopeGroups(changed.length > 0 ? groupFiles(root, changed) : [], opts);
  return { root, base, changed, groups };
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Read-only: the changed-line sites per group, before coverage, the machine's
 * capacity, and the estimate's units: coverage runs, baselines and test-command rounds,
 * the overlay check's runs included.
 */
function runPlan(cwd: string, baseRef: string, opts: UnitOptions): void {
  const { root, base, groups } = unitScope(cwd, baseRef, opts);
  const mutator = findTool("mutator");
  const cores = mutatorCores();
  let estimate: string;
  const lines = [
    `Mutation sites per group and file, before coverage (a run skips uncovered lines): on changed lines,${opts.maxMutants === null ? "" : " selected by the cap,"} and executed (one --lines set serves every handed file); each handed file adds ${count(OVERLAY_CHECK_RUNS, "check run")}, mutator's worker checked before mutator runs:`,
  ];
  if (isMissing(mutator)) {
    lines.push(`- mutator ${mutator.missing}`);
    estimate = `none (mutator ${mutator.missing})`;
  } else if (groups.length === 0) {
    lines.push("- none: no changed source files");
    estimate = "none (no changed source files)";
  } else {
    // Each group runs its own coverage run and one mutator call.
    let coverageRuns = 0;
    let baselines = 0;
    let allRounds = 0;
    let checkRuns = 0;
    const changed = changedLinesOf(root, base, groups);
    const cap = opts.maxMutants;
    const selection = selectSites(mutator, root, groups, changed, cap);
    const picked = (n: number, groupLine: boolean) =>
      cap === null ? "" : ` ${n} selected${groupLine ? ` (--max-mutants ${cap})` : ""},`;
    for (const group of groups) {
      const sel = selection.get(group) as Selection;
      const cost = runCost(sel.scanned, sel.selected, opts.maxWorkers, cores);
      const none = { executed: 0, workers: 0, rounds: 0 };
      const files = [...new Set(sel.sites.map((s) => s.file))].map((file) => ({
        file,
        ...(cost.files.get(file) ?? none),
      }));
      const total = files.reduce((a, f) => a + f.executed, 0);
      if (!("skip" in coveragePlan(root, group, opts.coverageCommand))) coverageRuns++;
      baselines += cost.baselines;
      allRounds += cost.rounds;
      checkRuns += cost.checkRuns;
      lines.push(
        `- ${onlyName(group.dir)} (${group.kind}): ${sel.sites.length} on changed lines,${picked(sel.selected.length, true)} ${total} executed, ${count(cost.rounds, "round")}, ${count(cost.checkRuns, "check run")}`,
      );
      for (const f of files) {
        const own = sel.sites.filter((s) => s.file === f.file).length;
        const chosen = sel.selected.filter((s) => s.file === f.file).length;
        lines.push(
          `  - ${repoPath(group, f.file)}: ${own} on changed lines,${picked(chosen, false)} ${f.executed} executed, ${count(f.workers, "worker")}, ${count(f.rounds, "round")}, ${count(cost.files.has(f.file) ? OVERLAY_CHECK_RUNS : 0, "check run")}`,
        );
      }
    }
    // A check run is one test-command run on its own, so it costs one round's time.
    estimate = `${count(coverageRuns, "coverage run")} + ${count(baselines, "baseline")} + ${count(allRounds + checkRuns, "test-command round")} (${allRounds} for mutants, ${checkRuns} for overlay checks)`;
  }
  const [one, five] = os.loadavg();
  lines.push(
    `Cores: ${cores}`,
    `Load average: 1 min ${one.toFixed(2)} · 5 min ${five.toFixed(2)}`,
    `Estimate: ${estimate}`,
  );
  console.log(lines.join("\n"));
}

async function runUnit(
  cwd: string,
  baseRef: string,
  out: string,
  opts: UnitOptions,
): Promise<void> {
  const { root, base, changed, groups } = unitScope(cwd, baseRef, opts);
  const head = headOf(root);
  const tools = loadTools();
  const none = "skipped: no changed source files";
  const inScope = new Set(groups.flatMap((g) => g.files.map((f) => repoPath(g, f))));

  const dryer = section("dryer", tools.dryer, (tool) => {
    if (inScope.size === 0) return none;
    const pairs = withSnapshot(root, head, (dir) => runDryer(tool, dir));
    const hits = renderPairs(touching(pairs, inScope), "No duplicate pair touches a changed file.");
    return `${hits}\n\n${DRYER_SCOPE_NOTE}`;
  });

  const phase =
    groups.length === 0
      ? { crapper: none, mutator: none, problems: [] }
      : checkoutPhase(
          root,
          groups,
          tools,
          opts.coverageCommand,
          (tool) => {
            const before = beforeRun(tool, root, base, groups);
            return (group, gap) =>
              crapperGroup(tool, root, base, group, before.get(group) ?? new Map(), gap);
          },
          unitMutator(root, groups, changedLinesOf(root, base, groups), opts),
        );

  const only = opts.only === null ? "" : ` · Only: ${opts.only}`;
  writeFacts(
    path.resolve(cwd, out),
    `Base: ${baseRef} (branch point ${base.slice(0, 7)}) · Head: ${head.slice(0, 7)} · Changed source files: ${changed.length}${only}`,
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
        null,
        (tool) => (group, gap) => {
          const dir = path.join(root, group.dir);
          return renderOverBar(runCrapper(tool, dir, group.files, gap === null), {
            spans: functionSpans(tool, dir, group.files),
            where: (s) => `${repoPath(group, s.file)}:${s.start}`,
          });
        },
        auditMutator(root),
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

/** The flags only a unit run (`--base`) takes, by option name. */
const UNIT_ONLY: [keyof MetricsOptions, string][] = [
  ["plan", "--plan"],
  ["only", "--only"],
  ["testCommand", "--test-command"],
  ["coverageCommand", "--coverage-command"],
  ["maxWorkers", "--max-workers"],
  ["maxMutants", "--max-mutants"],
];

async function dispatch(cwd: string, options: MetricsOptions): Promise<void> {
  if (options.audit) {
    if (options.base) throw new Error("metrics --audit takes no --base.");
    const given = UNIT_ONLY.find(([key]) => options[key] !== undefined && options[key] !== false);
    if (given) throw new Error(`${given[1]} applies only to metrics --base.`);
    if (!options.out) throw new Error("metrics requires --out <file|dir>.");
    return runAudit(cwd, options.out, options.runTests === true);
  }
  if (options.runTests) throw new Error("--run-tests applies only to metrics --audit.");
  if (!options.base) throw new Error("metrics requires --base <ref> (or --audit).");
  const opts: UnitOptions = {
    only: options.only ?? null,
    testCommand: options.testCommand ?? null,
    coverageCommand: options.coverageCommand ?? null,
    maxWorkers: options.maxWorkers ?? null,
    maxMutants: options.maxMutants ?? null,
  };
  if (options.plan) {
    if (options.out) throw new Error("metrics --plan writes no file; drop --out.");
    return runPlan(cwd, options.base, opts);
  }
  if (!options.out) throw new Error("metrics requires --out <file|dir>.");
  return runUnit(cwd, options.base, options.out, opts);
}
