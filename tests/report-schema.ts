import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REL = "references/audit/report-schema.json";

export const SCHEMA = JSON.parse(
  readFileSync(fileURLToPath(new URL(`../${REL}`, import.meta.url)), "utf-8"),
);

type ProofKind = { properties: { kind: { const: string } } };

export type Branch = {
  properties: {
    verdict: { const: string };
    dimension?: { enum: string[] };
    evidence?: { description: string };
    drift_test?: { description: string };
    retention_check?: {
      description: string;
      properties?: { contract?: { enum: string[] }; proof?: { oneOf?: ProofKind[] } };
    };
  };
};

const validator: typeof import("../references/audit/validate-findings.cjs") = createRequire(
  import.meta.url,
)("../references/audit/validate-findings.cjs");

export const { NAMES } = validator;

export const confirmedBranch = (doc: { output_schema?: { oneOf: Branch[] } } = SCHEMA): Branch => {
  const branch = validator.confirmedBranch(doc.output_schema);
  assert.ok(branch, `${REL} has no output_schema.oneOf branch whose verdict is "confirmed"`);
  return branch;
};
