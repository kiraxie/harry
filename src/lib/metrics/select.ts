import path from "node:path";

import { type Group, repoPath } from "./groups.ts";
import { rethrowInterrupt } from "./interrupt.ts";
import { type Site, scanChanged } from "./mutator.ts";
import { byPath } from "./scope.ts";
import type { Tool } from "./tools.ts";

/** Changed lines per repo-relative file. */
export type ChangedLines = Map<string, Set<number>>;

/**
 * The check of one file of `group` before mutator may run it (the overlay check, in
 * a unit run): null when mutator's worker can measure it, else the record of why not.
 */
export type Check<R extends object> = (group: Group, file: string) => R | null;

/** One changed-line site and the group it belongs to. */
export interface Entry {
  group: Group;
  /** The site's file by repo path. */
  at: string;
  site: Site;
}

/** What the walk decides for one group's changed-line sites. */
export interface Walk<R extends object> {
  /** Every site on a changed line, by repo path, then line. */
  sites: Site[];
  /**
   * The sites that run: every site of a file the check passed, or under --max-mutants
   * the first n of them, finishing the last line.
   */
  selected: Site[];
  /** The sites of the files the check rejected. */
  unmeasured: Site[];
  /** The sites the cap left out, in files never checked or that passed. */
  notSelected: Site[];
  /** The check's record for each file it rejected, in walk order. */
  notMeasured: R[];
  /** Every file the walk checked, group-relative, in walk order. */
  checked: string[];
}

export interface Selection<R extends object> extends Walk<R> {
  /** Every site the group's scan lists, the off-line ones included. */
  scanned: Site[];
}

/**
 * Runs `body` for `group`, naming the group's dir in front of any error it throws:
 * an error while sites are selected fails every group's section at once, under no
 * group heading. A repo-root group's errors stay as they are.
 */
function inGroup<T>(group: Group, body: () => T): T {
  try {
    return body();
  } catch (err) {
    rethrowInterrupt(err);
    if (group.dir === "") throw err;
    throw new Error(`${group.dir}: ${(err as Error).message}`);
  }
}

/**
 * Splits the unit's changed-line sites across groups: scans each group, sorts every
 * site by repo path, then line, and walks them (`walkSites`). A scan or check error
 * names its group (`inGroup`).
 */
export function selectSites<R extends object>(
  tool: Tool,
  root: string,
  groups: Group[],
  changed: ChangedLines,
  maxMutants: number | null,
  check: Check<R>,
): Map<Group, Selection<R>> {
  const scans = new Map<Group, Site[]>();
  const entries = groups.flatMap((group) => {
    const own = new Map(
      group.files.map((f) => [f, changed.get(repoPath(group, f)) ?? new Set<number>()]),
    );
    const { scanned, onChanged } = inGroup(group, () =>
      scanChanged(tool, path.join(root, group.dir), own),
    );
    scans.set(group, scanned);
    return onChanged.map((site) => ({ group, at: repoPath(group, site.file), site }));
  });
  entries.sort((a, b) => byPath(a.at, b.at) || a.site.line - b.site.line);
  const named: Check<R> = (group, file) => inGroup(group, () => check(group, file));
  const walked = walkSites(groups, entries, maxMutants, named);
  return new Map([...scans].map(([g, scanned]) => [g, { scanned, ...(walked.get(g) as Walk<R>) }]));
}

/**
 * Walks `entries`, sorted by repo path, then line, deciding each site's disposition
 * in its group's walk. A file is checked (the overlay check, in a unit run) when the
 * walk first reaches it, once per repo path: a rejected file's sites are unmeasured
 * and take none of the cap; a passing file's sites are selected. Under `maxMutants`
 * it selects no more once n are selected, finishing the last line reached whole,
 * since mutator selects by line; every later site is recorded not selected and its
 * file never checked. A check that errors throws.
 */
export function walkSites<R extends object>(
  groups: Group[],
  entries: Entry[],
  maxMutants: number | null,
  check: Check<R>,
): Map<Group, Walk<R>> {
  const out = new Map<Group, Walk<R>>(
    groups.map((g) => [
      g,
      { sites: [], selected: [], unmeasured: [], notSelected: [], notMeasured: [], checked: [] },
    ]),
  );
  const verdicts = new Map<string, R | null>();
  // The line the last selected site sits on; under the cap only its other sites still run.
  let lastAt: string | null = null;
  let lastLine = 0;
  let taken = 0;
  for (const e of entries) {
    const walk = out.get(e.group) as Walk<R>;
    walk.sites.push(e.site);
    const onLastLine = lastAt === e.at && lastLine === e.site.line;
    if (maxMutants !== null && taken >= maxMutants && !onLastLine) {
      walk.notSelected.push(e.site);
      continue;
    }
    if (!verdicts.has(e.at)) {
      const verdict = check(e.group, e.site.file);
      verdicts.set(e.at, verdict);
      walk.checked.push(e.site.file);
      if (verdict !== null) walk.notMeasured.push(verdict);
    }
    if (verdicts.get(e.at) !== null) {
      walk.unmeasured.push(e.site);
      continue;
    }
    walk.selected.push(e.site);
    taken++;
    lastAt = e.at;
    lastLine = e.site.line;
  }
  return out;
}
