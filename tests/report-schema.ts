import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

export const confirmedBranch = (doc: { output_schema?: { oneOf: Branch[] } } = SCHEMA): Branch => {
  const branch = doc.output_schema?.oneOf.find((b) => b.properties.verdict.const === "confirmed");
  assert.ok(branch, `${REL} has no output_schema.oneOf branch whose verdict is "confirmed"`);
  return branch;
};
