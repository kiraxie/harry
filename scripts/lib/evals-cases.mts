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

export const REGEX_CHECK_TYPES: ReadonlySet<string> = new Set(["regex_must", "regex_must_not"]);
const CHECK_TYPES = new Set([...REGEX_CHECK_TYPES, "declared_tier"]);
const TIERS = ["trivial", "standard", "major"];
// A tier declaration: "**Tier: Major**", "**Tier:** Major", "tier is Major", "Tier: Major".
// A bare tier word ("a major change") is not one.
const TIER_DECLARATION = String.raw`(?:\*\*\s*tier\s*:?\s*\**\s*|\btier\s*(?:is|:)\s*\**\s*)`;
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

const isRecord = (v: unknown): v is EvalRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type CaseEntry = { record: EvalRecord; line: number };

// A malformed line becomes a parse error rather than throwing, so `validate` can
// report them all.
export function parseCasesJsonl(text: string): { entries: CaseEntry[]; errors: string[] } {
  const entries: CaseEntry[] = [];
  const errors: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (err) {
      errors.push(`line ${i + 1}: not valid JSON (${(err as Error).message})`);
      continue;
    }
    if (isRecord(value)) entries.push({ record: value, line: i + 1 });
    else errors.push(`line ${i + 1}: not an object`);
  }
  return { entries, errors };
}

export function compileCheck(check: CheckInput): RegExp {
  return new RegExp(check.pattern ?? "", check.flags ?? "");
}

export function caseName(c: unknown, line: number): string {
  const id = (c as EvalRecord | null)?.id;
  return typeof id === "string" ? `case "${id}"` : `line ${line}`;
}

export function checkViolations(check: unknown, allowedTypes: ReadonlySet<string>): string[] {
  const v: string[] = [];
  if (!isRecord(check)) return ["not an object"];
  if (!allowedTypes.has(check.type)) {
    v.push(`"type" must be one of ${[...allowedTypes].join(", ")}`);
  }
  if (PATTERN_CHECK_TYPES.has(check.type)) {
    if (typeof check.pattern !== "string" || !check.pattern) {
      v.push(`missing/empty string "pattern"`);
    } else {
      try {
        compileCheck(check as CheckInput);
      } catch (err) {
        v.push(`invalid regex (${(err as Error).message})`);
      }
    }
  }
  if (
    (check.type === "file_contains" || check.type === "file_not_contains") &&
    (typeof check.path !== "string" || !check.path)
  ) {
    v.push(`"${check.type}" needs a non-empty string "path"`);
  }
  if (
    check.type === "test_command_passes" &&
    check.command !== undefined &&
    typeof check.command !== "string"
  ) {
    v.push(`"command" must be a string when present`);
  }
  if (check.pathPattern !== undefined) {
    if (check.type !== "repo_grep" && check.type !== "repo_grep_absent") {
      v.push(`"pathPattern" only applies to repo_grep/repo_grep_absent`);
    } else if (typeof check.pathPattern !== "string" || !check.pathPattern) {
      v.push(`"pathPattern" must be a non-empty string when present`);
    } else {
      try {
        new RegExp(check.pathPattern);
      } catch (err) {
        v.push(`invalid pathPattern regex (${(err as Error).message})`);
      }
    }
  }
  if (check.type === "declared_tier" && !TIERS.includes(check.tier)) {
    v.push(`"tier" must be one of ${TIERS.join(", ")}`);
  }
  if (check.flags !== undefined && typeof check.flags !== "string") {
    v.push(`"flags" must be a string when present`);
  }
  return v;
}

export function validateCases(entries: { record: unknown; line: number }[]): string[] {
  const violations: string[] = [];
  const seen = new Set();
  entries.forEach(({ record, line }) => {
    const c = record as EvalRecord;
    const where = caseName(c, line);
    if (!isRecord(c)) {
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
    if (c.informative !== undefined && typeof c.informative !== "boolean") {
      violations.push(`${where}: "informative" must be a boolean when present`);
    }
    const isAgentic = c.mode === "agentic";
    if (isAgentic && (typeof c.fixture !== "string" || !c.fixture.trim())) {
      violations.push(`${where}: agentic case needs a non-empty string "fixture"`);
    }
    if (!Array.isArray(c.checks) || c.checks.length === 0) {
      violations.push(`${where}: "checks" must be a non-empty array`);
      return;
    }
    const allowedTypes = isAgentic ? AGENTIC_CHECK_TYPES : CHECK_TYPES;
    c.checks.forEach((check: unknown, ci: number) => {
      for (const v of checkViolations(check, allowedTypes))
        violations.push(`${where} check #${ci + 1}: ${v}`);
    });
  });
  return violations;
}

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

// Any type other than regex_must / regex_must_not (an unexpanded declared_tier
// included) is refused rather than judged as an absence check.
export function evaluateCheck(check: CheckInput, responseText: string | undefined): CheckOutcome {
  if (!REGEX_CHECK_TYPES.has(check.type))
    throw new Error(`evaluateCheck judges regex checks only, got "${check.type}"`);
  const re = compileCheck(check);
  const matched = re.test(responseText ?? "");
  const ok = check.type === "regex_must" ? matched : !matched;
  return { check, matched, ok };
}

export function evaluateChecks(
  checks: CheckInput[] | undefined,
  responseText: string | undefined,
): { pass: boolean; results: CheckOutcome[] } {
  const results = (checks ?? []).map((check) => evaluateCheck(check, responseText));
  return { pass: results.every((r) => r.ok), results };
}
