#!/usr/bin/env node

/**
 * Validates findings.json against report-schema.json.
 * Usage: node validate-findings.cjs <path-to-findings.json>
 *
 * The validation rules live in report-schema.json — the single source of truth.
 * This script reads that schema at runtime and interprets the subset of JSON
 * Schema declared in KEYWORDS below, one entry per keyword. At load it refuses a
 * schema using any other keyword, one of these with a value the script does not
 * interpret, a keyword on a node whose type it does not apply to, or a keyword
 * beside oneOf. It also refuses a schema missing a dimension or path the
 * semantic layer below names, so no rule is silently skipped.
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
 * Zero dependencies. Exits 0 on success, 1 on any failure.
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

const patterns = new Map();
const isObject = (v) => typeOf(v) === "object";
const is = (value, type) => (type === "integer" ? Number.isInteger(value) : typeOf(value) === type);

const KEYWORDS = {
	oneOf: {
		place(node, p) {
			for (const key of Object.keys(node)) {
				if (!KEYWORDS[key]?.besideOneOf) throw new Error(`${p}: ${key} cannot sit beside oneOf`);
			}
		},
		check(node, p) {
			if (!(Array.isArray(node.oneOf) && node.oneOf.length > 0)) throw new Error(`${p}: oneOf must be a non-empty array`);
		},
		besideOneOf: true,
		descend(node, p) {
			node.oneOf.forEach((branch, i) => checkSchema(branch, `${p}.oneOf[${i}]`));
			const key = findDiscriminator(node.oneOf);
			if (!key) return;
			const seen = new Set();
			for (const branch of node.oneOf) {
				const value = branch.properties[key].const;
				if (seen.has(value)) throw new Error(`${p}: oneOf branches share the "${key}" value ${JSON.stringify(value)}`);
				seen.add(value);
			}
		},
		apply(value, schema, p, errors) {
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
			if (passing.length !== 1) errors.push(`${p}: does not match exactly one of the allowed schemas`);
		},
	},
	const: {
		apply(value, schema, p, errors) {
			if (value !== schema.const) {
				errors.push(`${p}: must equal ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
			}
		},
	},
	enum: {
		check(node, p) {
			if (!Array.isArray(node.enum)) throw new Error(`${p}: enum must be an array`);
		},
		apply(value, schema, p, errors) {
			if (!schema.enum.includes(value)) {
				const allowed = schema.enum.map((v) => JSON.stringify(v)).join(", ");
				errors.push(`${p}: invalid value ${JSON.stringify(value)} (expected one of ${allowed})`);
			}
		},
	},
	type: {
		check(node, p) {
			if (!["object", "array", "string", "integer"].includes(node.type)) {
				throw new Error(`${p}: unsupported type ${JSON.stringify(node.type)}`);
			}
		},
		apply(value, schema, p, errors) {
			if (!is(value, schema.type)) errors.push(`${p}: expected ${schema.type}, got ${typeOf(value)}`);
		},
	},
	required: {
		on: "object",
		check(node, p) {
			if (!(Array.isArray(node.required) && node.required.every((r) => typeof r === "string"))) {
				throw new Error(`${p}: required must be an array of strings`);
			}
		},
		apply(value, schema, p, errors) {
			for (const req of schema.required) {
				if (!Object.hasOwn(value, req)) errors.push(`${p}: missing required field "${req}"`);
			}
		},
	},
	properties: {
		on: "object",
		check(node, p) {
			if (!isObject(node.properties)) throw new Error(`${p}: properties must be an object`);
		},
		descend(node, p) {
			for (const [name, sub] of Object.entries(node.properties)) checkSchema(sub, `${p}.${name}`);
		},
		apply(value, schema, p, errors) {
			for (const key of Object.keys(value)) {
				if (Object.hasOwn(schema.properties, key)) validate(value[key], schema.properties[key], `${p}.${key}`, errors);
			}
		},
	},
	additionalProperties: {
		on: "object",
		check(node, p) {
			if (node.additionalProperties !== false) throw new Error(`${p}: additionalProperties must be false`);
		},
		apply(value, schema, p, errors) {
			for (const key of Object.keys(value)) {
				if (!(schema.properties && Object.hasOwn(schema.properties, key))) errors.push(`${p}: unexpected field "${key}"`);
			}
		},
	},
	minItems: {
		on: "array",
		check(node, p) {
			if (!(Number.isInteger(node.minItems) && node.minItems >= 0)) {
				throw new Error(`${p}: minItems must be a non-negative integer`);
			}
		},
		apply(value, schema, p, errors) {
			if (value.length < schema.minItems) {
				errors.push(`${p}: must have at least ${schema.minItems} item(s), got ${value.length}`);
			}
		},
	},
	items: {
		on: "array",
		descend(node, p) {
			checkSchema(node.items, `${p}[]`);
		},
		apply(value, schema, p, errors) {
			value.forEach((el, i) => validate(el, schema.items, `${p}[${i}]`, errors));
		},
	},
	pattern: {
		on: "string",
		check(node, p) {
			if (typeof node.pattern !== "string") throw new Error(`${p}: pattern must be a string`);
			try {
				patterns.set(node, new RegExp(node.pattern));
			} catch (e) {
				throw new Error(`${p}: invalid pattern ${JSON.stringify(node.pattern)} (${e.message})`);
			}
		},
		apply(value, schema, p, errors) {
			if (!patterns.get(schema).test(value)) {
				const why = schema.description ? ` — ${schema.description}` : "";
				errors.push(`${p}: must match pattern /${schema.pattern}/, got ${JSON.stringify(value)}${why}`);
			}
		},
	},
	description: { besideOneOf: true, apply() {} },
	$comment: { besideOneOf: true, apply() {} },
};

function checkSchema(node, p) {
	if (!isObject(node)) throw new Error(`${p}: a schema must be an object`);
	const keys = Object.keys(node);
	for (const key of keys) {
		if (!Object.hasOwn(KEYWORDS, key)) throw new Error(`${p}: unsupported schema keyword "${key}"`);
	}
	if (Object.hasOwn(node, "type")) KEYWORDS.type.check(node, p);
	for (const key of keys) KEYWORDS[key].place?.(node, p);
	for (const key of keys) {
		const { on } = KEYWORDS[key];
		if (on && node.type !== on) throw new Error(`${p}: ${key} applies only to type "${on}"`);
	}
	for (const key of keys) if (key !== "type") KEYWORDS[key].check?.(node, p);
	for (const key of keys) KEYWORDS[key].descend?.(node, p);
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

for (const [key, keyword] of Object.entries(KEYWORDS)) {
	if (typeof keyword.apply !== "function") {
		console.error(`validate-findings.cjs is broken: KEYWORDS.${key} has no apply step`);
		process.exit(1);
	}
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
	for (const [key, keyword] of Object.entries(KEYWORDS)) {
		if (!Object.hasOwn(schema, key)) continue;
		if (keyword.on && !is(value, keyword.on)) continue;
		keyword.apply(value, schema, p, errors);
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
