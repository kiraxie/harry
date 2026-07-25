export type TextCheckType = "regex_must" | "regex_must_not";
export type AgenticCheckType =
  | "git_created_branch"
  | "git_no_new_commits_on_initial"
  | "file_contains"
  | "file_not_contains"
  | "repo_grep"
  | "repo_grep_absent"
  | "commit_message_matches"
  | "test_command_passes";
export type CheckType = TextCheckType | AgenticCheckType;

// Loose input shape: the runtime narrows `type`, so callers (and test literals)
// may pass a plain string. `pattern` is optional because some agentic check
// types (git_created_branch, git_no_new_commits_on_initial, test_command_passes)
// carry none. `pathPattern` narrows repo_grep/repo_grep_absent to matching paths.
export interface CheckInput {
  type: string;
  pattern?: string;
  flags?: string;
  path?: string;
  pathPattern?: string;
  command?: string;
}

// A parsed JSONL row — used for both the cases file and result files, so fields
// are open. `validate`/`score` read what they need.
export type EvalRecord = Record<string, any>;

export interface CheckOutcome {
  check: CheckInput;
  matched: boolean;
  ok: boolean;
}

// One agentic artifact-check outcome. `detail` is a human-readable trace of what
// the check saw (matched file, failing branch list, test exit); `matched` from
// the text shape is absent here.
export interface ArtifactCheckOutcome {
  check: CheckInput;
  ok: boolean;
  detail: string;
}

// A snapshot of a fixture repo after a session, the input the artifact checks
// judge. `newCommitMessages` excludes the seed commit; `files` is tracked +
// untracked (minus .git).
export interface RepoState {
  fixtureDir: string;
  initialBranch: string;
  initialCommit: string;
  branches: string[];
  newCommitMessages: string[];
  newCommitsOnInitial: number;
  files: string[];
  env?: Record<string, string | undefined>;
}

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
    informativePass: number;
    informativeTotal: number;
  };
  candidateFailed: boolean;
}

export interface RunOpts {
  condition: string;
  model?: string;
  cases?: string[];
  out?: string;
  trials?: string | number;
  agentic?: boolean;
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
export function resolveTrials(opts: { trials?: string | number | null }): number;
export function resolveModel(
  opts: { model?: string },
  env: Record<string, string | undefined>,
): string;
export function prepareConditionDir(
  condition: string,
  lawsText: string,
  root?: string,
  env?: Record<string, string | undefined>,
): string;
export function materializeFixture(
  name: string,
  root?: string,
  env?: Record<string, string | undefined>,
): { dir: string; initialBranch: string; initialCommit: string };
export function collectRepoState(
  fixtureDir: string,
  initialBranch: string,
  initialCommit: string,
  env?: Record<string, string | undefined>,
): RepoState;
export function evaluateArtifactCheck(check: CheckInput, state: RepoState): ArtifactCheckOutcome;
export function evaluateArtifactChecks(
  checks: CheckInput[] | undefined,
  state: RepoState,
): { pass: boolean; results: ArtifactCheckOutcome[] };
export function runEvals(
  opts: RunOpts,
  env?: Record<string, string | undefined>,
): {
  outPath: string;
  configDir: string;
  workDir: string;
  lines: EvalRecord[];
  skipped: string[];
};
export function main(argv: string[], env?: Record<string, string | undefined>): number;
