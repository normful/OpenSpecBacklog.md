/**
 * Base validation schemas and constants for OpenSpec.
 *
 * Pure TypeScript replacement for the former Zod-based schemas.
 * Exports: ScenarioSchema, RequirementSchema scenarios, validation constants.
 */

export interface Scenario {
	rawText: string;
}

export interface Requirement {
	text: string;
	scenarios: Scenario[];
}

// Validation threshold constants (matching OpenSpec's constants.ts)
export const MIN_WHY_SECTION_LENGTH = 50;
export const MAX_WHY_SECTION_LENGTH = 1000;
export const MIN_PURPOSE_LENGTH = 50;
export const MAX_REQUIREMENT_TEXT_LENGTH = 500;
export const MAX_DELTAS_PER_CHANGE = 10;

export const VALIDATION_MESSAGES = {
	SCENARIO_EMPTY: "Scenario text cannot be empty",
	REQUIREMENT_EMPTY: "Requirement text cannot be empty",
	REQUIREMENT_NO_SHALL: "Requirement must contain SHALL or MUST keyword",
	REQUIREMENT_NO_SCENARIOS: "Requirement must have at least one scenario",
	SPEC_NAME_EMPTY: "Spec name cannot be empty",
	SPEC_PURPOSE_EMPTY: "Purpose section cannot be empty",
	SPEC_NO_REQUIREMENTS: "Spec must have at least one requirement",
	CHANGE_NAME_EMPTY: "Change name cannot be empty",
	CHANGE_WHY_TOO_SHORT: `Why section must be at least ${MIN_WHY_SECTION_LENGTH} characters`,
	CHANGE_WHY_TOO_LONG: `Why section should not exceed ${MAX_WHY_SECTION_LENGTH} characters`,
	CHANGE_WHAT_EMPTY: "What Changes section cannot be empty",
	CHANGE_NO_DELTAS: "Change must have at least one delta",
	CHANGE_TOO_MANY_DELTAS: `Consider splitting changes with more than ${MAX_DELTAS_PER_CHANGE} deltas`,
	DELTA_SPEC_EMPTY: "Spec name cannot be empty",
	DELTA_DESCRIPTION_EMPTY: "Delta description cannot be empty",
	DELTA_REQUIREMENTS_MISSING: "ADDED/MODIFIED deltas should include the affected requirements",
	DELTA_RENAME_MISSING: "RENAMED delta must include rename.from and rename.to",
	PURPOSE_TOO_BRIEF: `Purpose section is too brief (less than ${MIN_PURPOSE_LENGTH} characters)`,
	REQUIREMENT_TOO_LONG: `Requirement text is very long (>${MAX_REQUIREMENT_TEXT_LENGTH} characters). Consider breaking it down.`,
	DELTA_DESCRIPTION_TOO_BRIEF: "Delta description is too brief",
	GUIDE_MISSING_SPEC_SECTIONS: 'Missing required sections. Expected headers: "## Purpose" and "## Requirements".',
} as const;

interface ValidationError {
	path: string;
	message: string;
}

interface ValidationResult<T> {
	success: true;
	data: T;
}

interface ValidationFailure {
	success: false;
	error: { issues: ValidationError[] };
}

type SafeParseResult<T> = ValidationResult<T> | ValidationFailure;

function fail(issues: ValidationError[]): ValidationFailure {
	return { success: false as const, error: { issues } };
}

function ok<T>(data: T): ValidationResult<T> {
	return { success: true as const, data };
}

/**
 * Validate a Scenario input.
 * Scenarios have a single field: rawText (non-empty string).
 */
const SHALL_MUST_RE = /\b(SHALL|MUST)\b/i;

export function validateScenario(input: unknown): SafeParseResult<Scenario> {
	if (!input || typeof input !== "object") {
		return fail([{ path: "", message: "Scenario must be an object" }]);
	}
	const obj = input as Record<string, unknown>;
	if (typeof obj.rawText !== "string" || obj.rawText.trim().length === 0) {
		return fail([{ path: "rawText", message: VALIDATION_MESSAGES.SCENARIO_EMPTY }]);
	}
	return ok({ rawText: obj.rawText });
}

export function validateRequirement(input: unknown): SafeParseResult<Requirement> {
	const issues: ValidationError[] = [];

	if (!input || typeof input !== "object") {
		return fail([{ path: "", message: "Requirement must be an object" }]);
	}

	const obj = input as Record<string, unknown>;

	// text: non-empty string with SHALL/MUST
	if (typeof obj.text !== "string" || obj.text.trim().length === 0) {
		issues.push({ path: "text", message: VALIDATION_MESSAGES.REQUIREMENT_EMPTY });
	} else if (!SHALL_MUST_RE.test(obj.text)) {
		issues.push({ path: "text", message: VALIDATION_MESSAGES.REQUIREMENT_NO_SHALL });
	}

	// scenarios: array, min 1
	if (!Array.isArray(obj.scenarios) || obj.scenarios.length === 0) {
		issues.push({ path: "scenarios", message: VALIDATION_MESSAGES.REQUIREMENT_NO_SCENARIOS });
	} else {
		for (let i = 0; i < obj.scenarios.length; i++) {
			const scResult = validateScenario(obj.scenarios[i]);
			if (!scResult.success) {
				for (const issue of scResult.error.issues) {
					issues.push({ path: `scenarios.${i}.${issue.path}`, message: issue.message });
				}
			}
		}
	}

	if (issues.length > 0) {
		return fail(issues);
	}

	return ok({
		text: String(obj.text),
		scenarios: (obj.scenarios as unknown[]).map((s) => (validateScenario(s) as ValidationResult<Scenario>).data),
	});
}
