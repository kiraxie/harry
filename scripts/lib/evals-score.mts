import {
  type CaseEntry,
  type CheckInput,
  checkViolations,
  type EvalRecord,
  evaluateChecks,
  REGEX_CHECK_TYPES,
} from "./evals-cases.mts";

export type Outcome = { check?: unknown; ok: boolean; detail: string };

export const isOutcome = (o: unknown): o is Outcome =>
  o !== null &&
  typeof o === "object" &&
  "ok" in o &&
  typeof o.ok === "boolean" &&
  "detail" in o &&
  typeof o.detail === "string";

export interface ResultLine {
  [field: string]: unknown;
  id: string;
  condition: string;
}

const isResultLine = (r: EvalRecord): r is ResultLine =>
  typeof r.id === "string" && r.id !== "" && typeof r.condition === "string";

export const isErrored = (r: { [field: string]: unknown }): boolean => typeof r.error === "string";

const isAgentic = (r: ResultLine): boolean => r.mode === "agentic";

const judgedField = (r: ResultLine): string => (isAgentic(r) ? "checkOutcomes" : "checks");

const elementProblems = (r: ResultLine): string[] => {
  const list = r[judgedField(r)];
  if (!Array.isArray(list) || list.length === 0) return [`no "${judgedField(r)}" to judge`];
  return isAgentic(r)
    ? list.flatMap((o, k) =>
        isOutcome(o) ? [] : [`checkOutcome #${k + 1}: needs a boolean "ok" and a string "detail"`],
      )
    : list.flatMap((c, k) =>
        checkViolations(c, REGEX_CHECK_TYPES).map((v) => `check #${k + 1}: ${v}`),
      );
};

const judgedAgentic = (r: ResultLine): r is ResultLine & { checkOutcomes: Outcome[] } =>
  isAgentic(r) && elementProblems(r).length === 0;

const judgedText = (r: ResultLine): r is ResultLine & { checks: CheckInput[] } =>
  !isAgentic(r) && elementProblems(r).length === 0;

const fieldProblems = (r: ResultLine): string[] => [
  ...(["law", "pluginSha256"] as const).flatMap((f) =>
    r[f] === undefined || typeof r[f] === "string" ? [] : [`"${f}" must be a string when present`],
  ),
  ...(r.lawSha256 === undefined || r.lawSha256 === null || typeof r.lawSha256 === "string"
    ? []
    : ['"lawSha256" must be a string or null when present']),
  ...(r.trial === undefined || (Number.isInteger(r.trial) && Number(r.trial) > 0)
    ? []
    : ['"trial" must be a positive integer when present']),
];

export function validateResultLines(entries: CaseEntry[]): {
  lines: ResultLine[];
  errors: string[];
} {
  const lines: ResultLine[] = [];
  const errors: string[] = [];
  for (const { record, line } of entries) {
    if (!isResultLine(record)) {
      const missing =
        typeof record.id !== "string" || record.id === ""
          ? 'missing/empty string "id"'
          : 'missing string "condition"';
      errors.push(`line ${line}: ${missing}`);
    } else {
      const problems = [
        ...fieldProblems(record),
        ...(isErrored(record) ? [] : elementProblems(record)),
      ];
      if (problems.length) errors.push(...problems.map((p) => `line ${line}: ${p}`));
      else lines.push(record);
    }
  }
  return { lines, errors };
}

export interface ScoreGroup {
  id: string;
  condition: string;
  law?: string;
  informative: boolean;
  trials: number;
  passCount: number;
  errors: number;
  lawShas: string[];
  mixedLaw: boolean;
  pluginShas: string[];
  mixedPlugin: boolean;
  toolSetups: string[];
  mixedTools: boolean;
  pass: boolean;
}

export interface ScoreSummary {
  // `rows` is an alias of `groups`, kept for callers that read `rows`.
  rows: ScoreGroup[];
  groups: ScoreGroup[];
  summary: {
    total: number;
    trials: number;
    candidatePass: number;
    candidateTotal: number;
    baselinePass: number;
    baselineTotal: number;
    pluginPass: number;
    pluginTotal: number;
    informativePass: number;
    informativeTotal: number;
  };
  candidateFailed: boolean;
  pluginFailed: boolean;
}

// Each result carries its own checks (embedded at run time) so scoring is
// self-contained and never drifts from a mutated cases file.
function scoreTrial(line: ResultLine) {
  // Agentic lines can't be re-judged offline (the fixture temp dir is gone), so
  // the run recorded per-check outcomes; text lines re-evaluate the response so
  // scoring stays independent of a later-edited cases file.
  const errored = isErrored(line);
  const pass = errored
    ? false
    : judgedAgentic(line)
      ? line.checkOutcomes.every((o) => o.ok)
      : judgedText(line)
        ? evaluateChecks(line.checks, typeof line.response === "string" ? line.response : undefined)
            .pass
        : null;
  if (pass === null) {
    throw new Error(`result "${line.id}" (${line.condition}) has nothing to judge`);
  }
  return {
    id: line.id,
    condition: line.condition,
    trial: typeof line.trial === "number" ? line.trial : 1,
    law: typeof line.law === "string" ? line.law : undefined,
    informative: line.informative === true,
    pass,
    errored,
  };
}

type Tally = Omit<
  ScoreGroup,
  "lawShas" | "pluginShas" | "toolSetups" | "mixedLaw" | "mixedPlugin" | "mixedTools" | "pass"
> & { lawShas: Set<string>; pluginShas: Set<string>; toolSetups: Set<string> };

export function scoreResults(lines: ResultLine[]): ScoreSummary {
  const groupMap = new Map<string, Tally>();
  for (const line of lines) {
    const t = scoreTrial(line);
    // JSON-array key: an unambiguous (id, condition) tuple that can never
    // collide regardless of what characters an id contains.
    const key = JSON.stringify([t.id, t.condition]);
    let g = groupMap.get(key);
    if (!g) {
      g = {
        id: t.id,
        condition: t.condition,
        law: t.law,
        informative: t.informative,
        trials: 0,
        passCount: 0,
        errors: 0,
        // Every distinct law text this group's trials were taken under. More than
        // one means the group's verdict averages ACROSS law versions, which is the
        // one thing a law-effect measurement must never do silently: on 2026-07-30
        // a tiers probe read 3/3 twice on one text and 1/3 on the next, and pooling
        // them into a single "weak" hid both numbers. Legacy lines predate the
        // stamp and contribute no hash rather than a false one.
        lawShas: new Set(),
        // The same guard for the plugin condition, whose result also depends on the
        // plugin copy it ran against.
        pluginShas: new Set(),
        // And the tool flags: a trial taken with Read available is not the same
        // measurement as one taken with no tools.
        toolSetups: new Set(),
      };
      groupMap.set(key, g);
    }
    g.trials += 1;
    if (t.pass) g.passCount += 1;
    if (t.errored) g.errors += 1;
    if (typeof line.lawSha256 === "string" && line.lawSha256) g.lawShas.add(line.lawSha256);
    if (typeof line.pluginSha256 === "string" && line.pluginSha256)
      g.pluginShas.add(line.pluginSha256);
    g.toolSetups.add(typeof line.toolSetup === "string" ? line.toolSetup : "(unrecorded)");
    // Backfill law/informative from any trial that carries them (a legacy line
    // may omit law; a later trial may supply it).
    if (!g.law && t.law) g.law = t.law;
    if (t.informative) g.informative = true;
  }
  const groups = [...groupMap.values()].map((g) => ({
    ...g,
    lawShas: [...g.lawShas].sort(),
    // A group whose trials span more than one law text is NOT a measurement of
    // either text. Surfaced per group so the table can say so; the verdict is
    // still computed (refusing to score would lose the run) but it is marked.
    mixedLaw: g.lawShas.size > 1,
    pluginShas: [...g.pluginShas].sort(),
    mixedPlugin: g.pluginShas.size > 1,
    toolSetups: [...g.toolSetups].sort(),
    mixedTools: g.toolSetups.size > 1,
    pass: g.passCount * 2 > g.trials,
  }));

  const graded = groups.filter((g) => !g.informative);
  const candidate = graded.filter((g) => g.condition === "candidate");
  const baseline = graded.filter((g) => g.condition === "baseline");
  const plugin = graded.filter((g) => g.condition === "plugin");
  const informative = groups.filter((g) => g.informative);
  return {
    rows: groups,
    groups,
    summary: {
      total: groups.length,
      trials: lines.length,
      candidatePass: candidate.filter((g) => g.pass).length,
      candidateTotal: candidate.length,
      baselinePass: baseline.filter((g) => g.pass).length,
      baselineTotal: baseline.length,
      pluginPass: plugin.filter((g) => g.pass).length,
      pluginTotal: plugin.length,
      informativePass: informative.filter((g) => g.pass).length,
      informativeTotal: informative.length,
    },
    candidateFailed: candidate.some((g) => !g.pass),
    pluginFailed: plugin.some((g) => !g.pass),
  };
}
