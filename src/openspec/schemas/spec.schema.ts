/**
 * SpecSchema — validates a main specification document.
 *
 * Pure TypeScript replacement for the former Zod-based SpecSchema.
 * Validates: name (non-empty), overview (non-empty), requirements (min 1,
 * each with SHALL/MUST keyword and at least one scenario).
 */

import { type Requirement, validateRequirement } from "./base.schema.ts";

export interface ValidationError {
	path: string;
	message: string;
}

export interface ValidationResult<T> {
	success: true;
	data: T;
}

export interface ValidationFailure {
	success: false;
	error: { issues: ValidationError[] };
}

export type SafeParseResult<T> = ValidationResult<T> | ValidationFailure;

function fail(issues: ValidationError[]): ValidationFailure {
	return { success: false as const, error: { issues } };
}

function ok<T>(data: T): ValidationResult<T> {
	return { success: true as const, data };
}

export interface Spec {
	name: string;
	overview: string;
	requirements: Requirement[];
}

/**
 * Validate an unknown input as a Spec.
 * Returns { success, data } or { success, error: { issues } }.
 */
export function validateSpec(input: unknown): SafeParseResult<Spec> {
	const issues: ValidationError[] = [];

	if (!input || typeof input !== "object") {
		return fail([{ path: "", message: "Spec must be an object" }]);
	}

	const obj = input as Record<string, unknown>;

	// name: non-empty string
	if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
		issues.push({ path: "name", message: "Spec name cannot be empty" });
	}

	// overview: non-empty string
	if (typeof obj.overview !== "string" || obj.overview.trim().length === 0) {
		issues.push({ path: "overview", message: "Purpose section cannot be empty" });
	}

	// requirements: array, min 1
	if (!Array.isArray(obj.requirements) || obj.requirements.length === 0) {
		issues.push({ path: "requirements", message: "Spec must have at least one requirement" });
	} else {
		for (let i = 0; i < obj.requirements.length; i++) {
			const reqResult = validateRequirement(obj.requirements[i]);
			if (!reqResult.success) {
				for (const issue of reqResult.error.issues) {
					issues.push({ path: `requirements.${i}.${issue.path}`, message: issue.message });
				}
			}
		}
	}

	if (issues.length > 0) {
		return fail(issues);
	}

	return ok({
		name: String(obj.name),
		overview: String(obj.overview),
		requirements: (obj.requirements as unknown[]).map(
			(r) => (validateRequirement(r) as ValidationResult<Requirement>).data,
		),
	});
}

// Re-export safeParse alias for drop-in compatibility
export const SpecSchema = { safeParse: validateSpec };
