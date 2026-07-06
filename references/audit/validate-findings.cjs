#!/usr/bin/env node

/**
 * Validates findings.json against report-schema.json.
 * Usage: node validate-findings.cjs <path-to-findings.json>
 *
 * The validation rules live in report-schema.json — the single source of truth.
 * This script reads that schema at runtime and interprets the subset of JSON
 * Schema it uses: type (object|array|string|integer), properties, required,
 * additionalProperties:false, enum, const, items, minItems, and oneOf.
 *
 * A few constraints can't be expressed in that subset; they're applied as an
 * explicit, clearly-labelled semantic layer after schema validation:
 *   - a confirmed finding needs a non-empty concrete_cost
 *   - a reusability-hoist or copy-paste finding needs >=2 evidence sites and a
 *     drift_test (duplication is inherently multi-site — a single location
 *     can't be "duplicated")
 *   - no confirmed reuse/duplication finding may declare drift_test.verdict
 *     "normal-to-diverge" (that means incidental duplication — it should have
 *     been rejected)
 *
 * Zero dependencies. Exits 0 on success, 1 on validation failure.
 */

const fs = require("fs");
const path = require("path");

const file = process.argv[2];
if (!file) {
	console.error("Usage: node validate-findings.cjs <path-to-findings.json>");
	process.exit(1);
}

const schemaPath = path.join(__dirname, "report-schema.json");
let itemSchema;
try {
	const doc = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
	itemSchema = doc.output_schema;
	if (!itemSchema) throw new Error('report-schema.json is missing top-level "output_schema"');
} catch (e) {
	console.error(`Failed to load schema from ${schemaPath}:`, e.message);
	process.exit(1);
}

let findings;
try {
	findings = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
	console.error("Failed to parse JSON:", e.message);
	process.exit(1);
}

if (!Array.isArray(findings)) {
	console.error("findings.json must be an array");
	process.exit(1);
}

// --- Generic JSON Schema interpreter (the subset used by report-schema.json) ---

function typeOf(v) {
	if (Array.isArray(v)) return "array";
	if (v === null) return "null";
	return typeof v; // "object" | "string" | "number" | "boolean"
}

// For oneOf: find a property defined with a `const` so error messages can point
// at the intended branch (e.g. discriminate confirmed vs rejected by "verdict").
function findDiscriminator(schema) {
	if (!schema.properties) return null;
	for (const [key, sub] of Object.entries(schema.properties)) {
		if (sub && Object.prototype.hasOwnProperty.call(sub, "const")) {
			return { key, value: sub.const };
		}
	}
	return null;
}

function validate(value, schema, p, errors) {
	if (schema.oneOf) {
		for (const branch of schema.oneOf) {
			const disc = findDiscriminator(branch);
			if (disc && value && typeof value === "object" && value[disc.key] === disc.value) {
				validate(value, branch, p, errors);
				return;
			}
		}
		const discs = schema.oneOf.map(findDiscriminator).filter(Boolean);
		if (discs.length === schema.oneOf.length && value && typeof value === "object") {
			const key = discs[0].key;
			const allowed = discs.map((d) => JSON.stringify(d.value)).join(", ");
			errors.push(`${p}: "${key}" must be one of ${allowed}, got ${JSON.stringify(value[key])}`);
			return;
		}
		const passing = schema.oneOf.filter((b) => collect(value, b, p).length === 0);
		if (passing.length !== 1) {
			errors.push(`${p}: does not match exactly one of the allowed schemas`);
		}
		return;
	}

	if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) {
		errors.push(`${p}: must equal ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
	}

	if (schema.enum && !schema.enum.includes(value)) {
		const allowed = schema.enum.map((v) => JSON.stringify(v)).join(", ");
		errors.push(`${p}: invalid value ${JSON.stringify(value)} (expected one of ${allowed})`);
	}

	switch (schema.type) {
		case "object": {
			if (typeOf(value) !== "object") {
				errors.push(`${p}: expected object, got ${typeOf(value)}`);
				return;
			}
			for (const req of schema.required || []) {
				if (!(req in value)) errors.push(`${p}: missing required field "${req}"`);
			}
			for (const key of Object.keys(value)) {
				if (schema.properties && key in schema.properties) {
					validate(value[key], schema.properties[key], `${p}.${key}`, errors);
				} else if (schema.additionalProperties === false) {
					errors.push(`${p}: unexpected field "${key}"`);
				}
			}
			break;
		}
		case "array": {
			if (typeOf(value) !== "array") {
				errors.push(`${p}: expected array, got ${typeOf(value)}`);
				return;
			}
			if (typeof schema.minItems === "number" && value.length < schema.minItems) {
				errors.push(`${p}: must have at least ${schema.minItems} item(s), got ${value.length}`);
			}
			if (schema.items) {
				value.forEach((el, i) => validate(el, schema.items, `${p}[${i}]`, errors));
			}
			break;
		}
		case "integer": {
			if (typeOf(value) !== "number" || !Number.isInteger(value)) {
				errors.push(`${p}: expected integer, got ${typeOf(value)}`);
			}
			break;
		}
		case "string": {
			if (typeOf(value) !== "string") {
				errors.push(`${p}: expected string, got ${typeOf(value)}`);
			}
			break;
		}
		default:
			break; // no type constraint at this node
	}
}

function collect(value, schema, p) {
	const errors = [];
	validate(value, schema, p, errors);
	return errors;
}

// --- Run ----------------------------------------------------------------------

const REUSE_DIMENSIONS = new Set(["reusability-hoist", "copy-paste"]);

let errorCount = 0;

findings.forEach((f, i) => {
	const label = `[${i}] ${(f && f.title) || "(untitled)"}`;
	console.log(`Checking ${label}`);

	const errs = collect(f, itemSchema, `[${i}]`);

	// Semantic layer — constraints the schema subset can't express.
	if (f && f.verdict === "confirmed") {
		if (typeof f.concrete_cost === "string" && f.concrete_cost.trim() === "") {
			errs.push(`[${i}].concrete_cost must not be empty — a confirmed finding needs a named cost`);
		}
		if (REUSE_DIMENSIONS.has(f.dimension)) {
			if (!f.drift_test) {
				errs.push(`[${i}]: dimension "${f.dimension}" requires a drift_test`);
			} else if (f.drift_test.verdict === "normal-to-diverge") {
				errs.push(
					`[${i}].drift_test.verdict is "normal-to-diverge" — that is incidental duplication and must be rejected, not confirmed`,
				);
			}
		}
		if (REUSE_DIMENSIONS.has(f.dimension) && Array.isArray(f.evidence) && f.evidence.length < 2) {
			errs.push(`[${i}]: a "${f.dimension}" finding needs >=2 evidence sites, got ${f.evidence.length}`);
		}
	}

	for (const msg of errs) console.error("  ERROR:", msg);
	errorCount += errs.length;
});

console.log();
if (errorCount === 0) {
	console.log(`PASS: ${findings.length} findings valid`);
} else {
	console.error(`FAIL: ${errorCount} error(s) across ${findings.length} findings`);
	process.exit(1);
}
