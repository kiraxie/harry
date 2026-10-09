// Scoring a results file: one verdict per (case id, condition) group, pooled across
// trials. Pure; the runner's `score` command (scripts/run-evals.mts) uses it.

import { type EvalRecord, evaluateChecks } from "./evals-cases.mts";

// One (case id, condition) group: all its trial lines pooled (from a --trials N
// run and/or several appended runs of the same condition). Its verdict is a
// STRICT MAJORITY of the pooled trials — `pass` is true iff passCount*2 > trials.
export interface ScoreGroup {
  id: string;
  condition: string;
  law?: string;
  informative: boolean;
  trials: number;
  passCount: number;
  errors: number;
  // Every distinct law text (lawSha256) the group's trials ran under, sorted;
  // mixedLaw is true when there is more than one, so the verdict spans law texts.
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

// Score one result line to a single-trial pass. Each result carries its own
// checks (embedded at run time) so scoring is self-contained and never drifts
// from a mutated cases file. A legacy line with no `trial` field is trial 1.
function scoreTrial(line: EvalRecord) {
  // Agentic lines can't be re-judged offline (the fixture temp dir is gone), so
  // the run recorded per-check outcomes; text lines re-evaluate the response so
  // scoring stays independent of a later-edited cases file.
  const pass =
    line.mode === "agentic"
      ? (line.checkOutcomes ?? []).every((o: { ok: boolean }) => o.ok)
      : evaluateChecks(line.checks, line.response).pass;
  return {
    id: line.id,
    condition: line.condition,
    trial: line.trial ?? 1,
    law: line.law,
    informative: line.informative === true,
    pass: line.error ? false : pass,
    error: line.error ?? null,
  };
}

// Score a whole results array. Trials are POOLED per (id, condition) group —
// every line for a group counts, whether it came from one --trials N run or
// several appended runs of the same condition (that is the documented way to
// add trials post-hoc). A group's verdict is a STRICT MAJORITY of its trials:
// it passes iff more than half passed (2/3, 2/2 — a 1/2 tie FAILS). An errored
// trial counts as a failing trial. candidateFailed and pluginFailed (the CLI exit code) derive
// only from graded (non-informative) candidate and plugin GROUP verdicts; informative
// groups are tallied separately and never gate.
export function scoreResults(lines: EvalRecord[]): ScoreSummary {
  const groupMap = new Map();
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
    if (t.error) g.errors += 1;
    if (line.lawSha256) g.lawShas.add(line.lawSha256);
    if (line.pluginSha256) g.pluginShas.add(line.pluginSha256);
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
    // Strict majority: passCount > trials/2  ⇔  2*passCount > trials.
    pass: g.passCount * 2 > g.trials,
  }));

  // Informative groups are contrast-only: split them out so they never gate the
  // run, and the gating counts (and exit code) consider only the graded groups.
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
