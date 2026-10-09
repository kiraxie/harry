// The eval cases file's schema and the text checks: parsing cases.jsonl,
// validating each case and its checks, and judging a first-response reply against
// its regex checks. Pure; the runner (scripts/run-evals.mts) and scoring
// (scripts/lib/evals-score.mts) import it.

export type TextCheckType = "regex_must" | "regex_must_not" | "declared_tier";
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
  tier?: string;
}

// A parsed JSONL row — used for both the cases file and result files, so fields
// are open. `validate`/`score` read what they need.
// biome-ignore lint/suspicious/noExplicitAny: a parsed JSONL row is open by design
export type EvalRecord = Record<string, any>;

export interface CheckOutcome {
  check: CheckInput;
  matched: boolean;
  ok: boolean;
}

// Text cases judge the model's first-response prose with regexes.
const CHECK_TYPES = new Set(["regex_must", "regex_must_not", "declared_tier"]);
const TIERS = ["trivial", "standard", "major"];
// A tier declaration: "**Tier: Major**", "**Tier:** Major", "tier is Major", "Tier: Major".
// A bare tier word ("a major change") is not one.
const TIER_DECLARATION = String.raw`(?:\*\*\s*tier\s*:?\s*\**\s*|\btier\s*(?:is|:)\s*\**\s*)`;
// Agentic cases judge the fixture REPO STATE after a full headless session.
const AGENTIC_CHECK_TYPES = new Set([
  "git_created_branch",
  "git_no_new_commits_on_initial",
  "file_contains",
  "file_not_contains",
  "repo_grep",
  "repo_grep_absent",
  "commit_message_matches",
  "test_command_passes",
]);
// Check types that carry a regex `pattern` (validated + compiled). The others
// (git_created_branch, test_command_passes) have no pattern.
const PATTERN_CHECK_TYPES = new Set([
  "regex_must",
  "regex_must_not",
  "file_contains",
  "file_not_contains",
  "repo_grep",
  "repo_grep_absent",
  "commit_message_matches",
]);
export const SUPPORTED_MODES: ReadonlySet<string> = new Set(["text", "agentic"]);

// ---- parsing & validation (pure) -------------------------------------------

// Parse JSONL into { cases, errors }. Blank lines are skipped; a malformed line
// becomes a parse error rather than throwing, so `validate` can report them all.
export function parseCasesJsonl(text: string): { cases: EvalRecord[]; errors: string[] } {
  const cases: EvalRecord[] = [];
  const errors: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line) continue;
    try {
      cases.push(JSON.parse(line));
    } catch (err) {
      errors.push(`line ${i + 1}: not valid JSON (${(err as Error).message})`);
    }
  }
  return { cases, errors };
}

// Compile a check's pattern; throws on an invalid regex or flags.
export function compileCheck(check: CheckInput): RegExp {
  return new RegExp(check.pattern ?? "", check.flags ?? "");
}

// Return a list of human-readable schema violations ([] means valid).
export function validateCases(cases: unknown[]): string[] {
  const violations: string[] = [];
  const seen = new Set();
  (cases as EvalRecord[]).forEach((c, idx) => {
    const where = c && typeof c.id === "string" ? `case "${c.id}"` : `case #${idx + 1}`;
    if (!c || typeof c !== "object") {
      violations.push(`${where}: not an object`);
      return;
    }
    if (typeof c.id !== "string" || !c.id.trim()) {
      violations.push(`${where}: missing/empty string "id"`);
    } else if (seen.has(c.id)) {
      violations.push(`${where}: duplicate id`);
    } else {
      seen.add(c.id);
    }
    if (!SUPPORTED_MODES.has(c.mode)) {
      violations.push(`${where}: "mode" must be one of ${[...SUPPORTED_MODES].join(", ")}`);
    }
    if (typeof c.prompt !== "string" || !c.prompt.trim()) {
      violations.push(`${where}: missing/empty string "prompt"`);
    }
    if (typeof c.law !== "string" || !c.law.trim()) {
      violations.push(`${where}: missing/empty string "law"`);
    }
    // An informative case is contrast-only: its failures never gate the run.
    if (c.informative !== undefined && typeof c.informative !== "boolean") {
      violations.push(`${where}: "informative" must be a boolean when present`);
    }
    const isAgentic = c.mode === "agentic";
    // Agentic cases name a committed fixture the runner materializes and runs in.
    if (isAgentic && (typeof c.fixture !== "string" || !c.fixture.trim())) {
      violations.push(`${where}: agentic case needs a non-empty string "fixture"`);
    }
    if (!Array.isArray(c.checks) || c.checks.length === 0) {
      violations.push(`${where}: "checks" must be a non-empty array`);
      return;
    }
    const allowedTypes = isAgentic ? AGENTIC_CHECK_TYPES : CHECK_TYPES;
    c.checks.forEach((check: EvalRecord, ci: number) => {
      const cw = `${where} check #${ci + 1}`;
      if (!check || typeof check !== "object") {
        violations.push(`${cw}: not an object`);
        return;
      }
      if (!allowedTypes.has(check.type)) {
        violations.push(`${cw}: "type" must be one of ${[...allowedTypes].join(", ")}`);
      }
      // Pattern-bearing checks need a compilable regex; git_created_branch and
      // test_command_passes carry no pattern.
      if (PATTERN_CHECK_TYPES.has(check.type)) {
        if (typeof check.pattern !== "string" || !check.pattern) {
          violations.push(`${cw}: missing/empty string "pattern"`);
        } else {
          try {
            compileCheck(check as CheckInput);
          } catch (err) {
            violations.push(`${cw}: invalid regex (${(err as Error).message})`);
          }
        }
      }
      // file_contains/file_not_contains target a specific file.
      if (
        (check.type === "file_contains" || check.type === "file_not_contains") &&
        (typeof check.path !== "string" || !check.path)
      ) {
        violations.push(`${cw}: "${check.type}" needs a non-empty string "path"`);
      }
      if (
        check.type === "test_command_passes" &&
        check.command !== undefined &&
        typeof check.command !== "string"
      ) {
        violations.push(`${cw}: "command" must be a string when present`);
      }
      // repo_grep/repo_grep_absent may narrow to files whose relative path
      // matches an optional pathPattern regex before content-grepping.
      if (check.pathPattern !== undefined) {
        if (check.type !== "repo_grep" && check.type !== "repo_grep_absent") {
          violations.push(`${cw}: "pathPattern" only applies to repo_grep/repo_grep_absent`);
        } else if (typeof check.pathPattern !== "string" || !check.pathPattern) {
          violations.push(`${cw}: "pathPattern" must be a non-empty string when present`);
        } else {
          try {
            new RegExp(check.pathPattern);
          } catch (err) {
            violations.push(`${cw}: invalid pathPattern regex (${(err as Error).message})`);
          }
        }
      }
      if (check.type === "declared_tier" && !TIERS.includes(check.tier)) {
        violations.push(`${cw}: "tier" must be one of ${TIERS.join(", ")}`);
      }
      if (check.flags !== undefined && typeof check.flags !== "string") {
        violations.push(`${cw}: "flags" must be a string when present`);
      }
    });
  });
  return violations;
}

// ---- text checks (pure) ----------------------------------------------------

// A declared_tier check is shorthand for its regex pair: the reply declares that tier,
// and declares no other. Expanded before a result line embeds it, so result files carry
// their matcher as data.
export function expandChecks(checks: CheckInput[]): CheckInput[] {
  return checks.flatMap((check) => {
    if (check.type !== "declared_tier") return [check];
    const others = TIERS.filter((t) => t !== check.tier).join("|");
    return [
      { type: "regex_must", pattern: String.raw`${TIER_DECLARATION}${check.tier}\b`, flags: "i" },
      {
        type: "regex_must_not",
        pattern: String.raw`${TIER_DECLARATION}(?:${others})\b`,
        flags: "i",
      },
    ];
  });
}

// Evaluate one check against a response. regex_must → pattern must match;
// regex_must_not → pattern must NOT match. Any other type (an unexpanded
// declared_tier included) is refused rather than judged as an absence check.
export function evaluateCheck(check: CheckInput, responseText: string | undefined): CheckOutcome {
  if (check.type !== "regex_must" && check.type !== "regex_must_not")
    throw new Error(`evaluateCheck judges regex checks only, got "${check.type}"`);
  const re = compileCheck(check);
  const matched = re.test(responseText ?? "");
  const ok = check.type === "regex_must" ? matched : !matched;
  return { check, matched, ok };
}

// Score one result line's checks against its recorded response.
export function evaluateChecks(
  checks: CheckInput[] | undefined,
  responseText: string | undefined,
): { pass: boolean; results: CheckOutcome[] } {
  const results = (checks ?? []).map((check) => evaluateCheck(check, responseText));
  return { pass: results.every((r) => r.ok), results };
}
