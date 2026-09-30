#!/usr/bin/env node

/**
 * Validates findings.json against report-schema.json.
 * Usage: node validate-findings.cjs <path-to-findings.json>
 *
 * The validation rules live in report-schema.json — the single source of truth.
 * This script reads that schema at runtime and interprets the subset of JSON
 * Schema it uses: type (object|array|string|integer), properties, required,
 * additionalProperties:false, enum, const, pattern, items, minItems, and oneOf.
 * A schema using any other keyword, one of these with a value the script does not
 * interpret (another type, a schema-valued additionalProperties), a keyword on a
 * node whose type it does not apply to, or a keyword beside oneOf is refused. So is
 * a schema missing a dimension or path the semantic layer below names, so no rule
 * is silently skipped.
 *
 * A few constraints can't be expressed in that subset; they're applied as an
 * explicit, clearly-labelled semantic layer after schema validation:
 *   - a reusability-hoist or copy-paste finding needs >=2 evidence sites and a
 *     drift_test (duplication is inherently multi-site — a single location
 *     can't be "duplicated")
 *   - no confirmed reuse/duplication finding may declare drift_test.verdict
 *     "normal-to-diverge" (that means incidental duplication — it should have
 *     been rejected)
 *   - a confirmed low-value-tests finding needs a retention_check whose
 *     contract is "none" (a test guarding a retained contract stays)
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

const KEYWORDS = new Set([
	"type",
	"properties",
	"required",
	"additionalProperties",
	"enum",
	"const",
	"pattern",
	"items",
	"minItems",
	"oneOf",
	"description",
	"$comment",
]);
const TYPES = new Set(["object", "array", "string", "integer"]);
// Keywords validate() applies only under one type; anywhere else they would be skipped.
const APPLIES_TO = {
	properties: "object",
	required: "object",
	additionalProperties: "object",
	items: "array",
	minItems: "array",
	pattern: "string",
};
const BESIDE_ONEOF = new Set(["oneOf", "description", "$comment"]);
const patterns = new Map();
const isObject = (v) => typeOf(v) === "object";

function checkSchema(node, p) {
	if (!isObject(node)) throw new Error(`${p}: a schema must be an object`);
	for (const key of Object.keys(node)) {
		if (!KEYWORDS.has(key)) throw new Error(`${p}: unsupported schema keyword "${key}"`);
	}
	if ("type" in node && !TYPES.has(node.type)) {
		throw new Error(`${p}: unsupported type ${JSON.stringify(node.type)}`);
	}
	for (const key of Object.keys(node)) {
		if ("oneOf" in node && !BESIDE_ONEOF.has(key)) throw new Error(`${p}: ${key} cannot sit beside oneOf`);
		if (APPLIES_TO[key] && node.type !== APPLIES_TO[key]) {
			throw new Error(`${p}: ${key} applies only to type "${APPLIES_TO[key]}"`);
		}
	}
	if ("additionalProperties" in node && node.additionalProperties !== false) {
		throw new Error(`${p}: additionalProperties must be false`);
	}
	if ("required" in node && !(Array.isArray(node.required) && node.required.every((r) => typeof r === "string"))) {
		throw new Error(`${p}: required must be an array of strings`);
	}
	if ("enum" in node && !Array.isArray(node.enum)) throw new Error(`${p}: enum must be an array`);
	if ("properties" in node && !isObject(node.properties)) throw new Error(`${p}: properties must be an object`);
	if ("oneOf" in node && !(Array.isArray(node.oneOf) && node.oneOf.length > 0)) {
		throw new Error(`${p}: oneOf must be a non-empty array`);
	}
	if ("minItems" in node && !(Number.isInteger(node.minItems) && node.minItems >= 0)) {
		throw new Error(`${p}: minItems must be a non-negative integer`);
	}
	if ("pattern" in node) {
		if (typeof node.pattern !== "string") throw new Error(`${p}: pattern must be a string`);
		try {
			patterns.set(node, new RegExp(node.pattern));
		} catch (e) {
			throw new Error(`${p}: invalid pattern ${JSON.stringify(node.pattern)} (${e.message})`);
		}
	}
	for (const [name, sub] of Object.entries(node.properties || {})) checkSchema(sub, `${p}.${name}`);
	if ("items" in node) checkSchema(node.items, `${p}[]`);
	(node.oneOf || []).forEach((branch, i) => checkSchema(branch, `${p}.oneOf[${i}]`));
	const key = node.oneOf && findDiscriminator(node.oneOf);
	if (key) {
		const seen = new Set();
		for (const branch of node.oneOf) {
			const value = branch.properties[key].const;
			if (seen.has(value)) throw new Error(`${p}: oneOf branches share the "${key}" value ${JSON.stringify(value)}`);
			seen.add(value);
		}
	}
}

const NAMES = {
	confirmedVerdict: "confirmed",
	reuseDimensions: ["reusability-hoist", "copy-paste"],
	lowValueDimension: "low-value-tests",
	incidentalVerdict: "normal-to-diverge",
	noContract: "none",
};

function checkSemanticNames() {
	const missing = (what) =>
		new Error(`output_schema: the semantic layer reads ${what}, which the schema does not define`);
	const confirmed = (itemSchema.oneOf || []).find((b) => b.properties?.verdict?.const === NAMES.confirmedVerdict);
	if (!confirmed) throw missing(`a "${NAMES.confirmedVerdict}" verdict branch`);
	const props = confirmed.properties;
	const dims = props.dimension?.enum || [];
	for (const dim of [...NAMES.reuseDimensions, NAMES.lowValueDimension]) {
		if (!dims.includes(dim)) throw missing(`dimension "${dim}"`);
	}
	if (props.drift_test?.type !== "object") throw missing("drift_test");
	if (!props.drift_test.properties?.verdict?.enum?.includes(NAMES.incidentalVerdict)) {
		throw missing(`drift_test.verdict "${NAMES.incidentalVerdict}"`);
	}
	if (props.evidence?.type !== "array") throw missing("evidence");
	const contracts = props.retention_check?.properties?.contract?.enum;
	if (!Array.isArray(contracts)) throw missing("retention_check.contract's enum");
	if (!contracts.includes(NAMES.noContract)) throw missing(`retention_check.contract "${NAMES.noContract}"`);
	return {
		confirmedVerdict: NAMES.confirmedVerdict,
		reuseDimensions: new Set(NAMES.reuseDimensions),
		lowValueDimension: NAMES.lowValueDimension,
		incidentalVerdict: NAMES.incidentalVerdict,
		retainedContracts: contracts.filter((c) => c !== NAMES.noContract),
	};
}

let semantic;
try {
	checkSchema(itemSchema, "output_schema");
	semantic = checkSemanticNames();
} catch (e) {
	console.error(`Schema ${schemaPath} is outside the subset this script enforces:`, e.message);
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

// For oneOf: the property every branch defines with a `const` (e.g. "verdict"
// for confirmed vs rejected), so a value is checked against its intended branch.
function findDiscriminator(branches) {
	const hasConst = (branch, key) =>
		branch.properties?.[key] && Object.hasOwn(branch.properties[key], "const");
	return Object.keys(branches[0].properties || {}).find((key) => branches.every((b) => hasConst(b, key))) || null;
}

function validate(value, schema, p, errors) {
	if (schema.oneOf) {
		const key = findDiscriminator(schema.oneOf);
		if (key && value && typeof value === "object") {
			const branch = schema.oneOf.find((b) => b.properties[key].const === value[key]);
			if (branch) {
				validate(value, branch, p, errors);
			} else {
				const allowed = schema.oneOf.map((b) => JSON.stringify(b.properties[key].const)).join(", ");
				errors.push(`${p}: "${key}" must be one of ${allowed}, got ${JSON.stringify(value[key])}`);
			}
			return;
		}
		const passing = schema.oneOf.filter((b) => collect(value, b, p).length === 0);
		if (passing.length !== 1) {
			errors.push(`${p}: does not match exactly one of the allowed schemas`);
		}
		return;
	}

	if (Object.hasOwn(schema, "const") && value !== schema.const) {
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
				if (!Object.hasOwn(value, req)) errors.push(`${p}: missing required field "${req}"`);
			}
			for (const key of Object.keys(value)) {
				if (schema.properties && Object.hasOwn(schema.properties, key)) {
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
			} else if (patterns.has(schema) && !patterns.get(schema).test(value)) {
				const why = schema.description ? ` — ${schema.description}` : "";
				errors.push(`${p}: must match pattern /${schema.pattern}/, got ${JSON.stringify(value)}${why}`);
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

let errorCount = 0;

findings.forEach((f, i) => {
	const label = `[${i}] ${(f && f.title) || "(untitled)"}`;
	console.log(`Checking ${label}`);

	const errs = collect(f, itemSchema, `[${i}]`);

	// Semantic layer — constraints the schema subset can't express.
	if (f && f.verdict === semantic.confirmedVerdict) {
		if (semantic.reuseDimensions.has(f.dimension)) {
			if (!f.drift_test) {
				errs.push(`[${i}]: dimension "${f.dimension}" requires a drift_test`);
			} else if (f.drift_test.verdict === semantic.incidentalVerdict) {
				errs.push(
					`[${i}].drift_test.verdict is "${semantic.incidentalVerdict}" — that is incidental duplication and must be rejected, not confirmed`,
				);
			}
		}
		if (f.dimension === semantic.lowValueDimension) {
			const r = f.retention_check;
			if (!r) {
				errs.push(`[${i}]: dimension "${f.dimension}" requires a retention_check`);
			} else if (semantic.retainedContracts.includes(r.contract)) {
				errs.push(
					`[${i}].retention_check.contract is "${r.contract}" — a test guarding a retained contract stays and must be rejected, not confirmed`,
				);
			}
		}
		if (semantic.reuseDimensions.has(f.dimension) && Array.isArray(f.evidence) && f.evidence.length < 2) {
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
