export type CheckType = "regex_must" | "regex_must_not";

// Loose input shape: the runtime narrows `type` against CHECK_TYPES, so callers
// (and test literals) may pass a plain string here.
export interface CheckInput {
  type: string;
  pattern: string;
  flags?: string;
}

// A parsed JSONL row — used for both the cases file and result files, so fields
// are open. `validate`/`score` read what they need.
export type EvalRecord = Record<string, any>;

export interface CheckOutcome {
  check: CheckInput;
  matched: boolean;
  ok: boolean;
}

export interface ScoreRow {
  id: string;
  condition: string;
  trial: number;
  law?: string;
  pass: boolean;
  error: string | null;
  failures: CheckInput[];
}

export interface ScoreSummary {
  rows: ScoreRow[];
  summary: {
    total: number;
    candidatePass: number;
    candidateTotal: number;
    baselinePass: number;
    baselineTotal: number;
  };
  candidateFailed: boolean;
}

export interface RunOpts {
  condition: string;
  model?: string;
  cases?: string[];
  out?: string;
  trials?: string | number;
}

export function parseCasesJsonl(text: string): { cases: EvalRecord[]; errors: string[] };
export function compileCheck(check: CheckInput): RegExp;
export function validateCases(cases: unknown[]): string[];
export function evaluateCheck(check: CheckInput, responseText: string | undefined): CheckOutcome;
export function evaluateChecks(
  checks: CheckInput[] | undefined,
  responseText: string | undefined,
): { pass: boolean; results: CheckOutcome[] };
export function scoreResults(lines: EvalRecord[]): ScoreSummary;
export function resolveModel(
  opts: { model?: string },
  env: Record<string, string | undefined>,
): string;
export function prepareConditionDir(condition: string, lawsText: string, root?: string): string;
export function runEvals(
  opts: RunOpts,
  env?: Record<string, string | undefined>,
): { outPath: string; configDir: string; workDir: string; lines: EvalRecord[] };
export function main(argv: string[], env?: Record<string, string | undefined>): number;
