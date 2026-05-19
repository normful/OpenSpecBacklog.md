/**
 * ChangeSchema — validates a proposed change with motivation and delta specs.
 *
 * Pure TypeScript replacement for the former Zod-based ChangeSchema.
 * Validates: name (non-empty), why (50-1000 chars), whatChanges (non-empty),
 * deltas (1-10), each delta's operation-specific constraints.
 */

import { MAX_DELTAS_PER_CHANGE, type Requirement, validateRequirement } from "./base.schema.ts";

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

// ─── Types ───

export type DeltaOperation = "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED";

export interface DeltaRename {
	from: string;
	to: string;
}

export interface Delta {
	spec: string;
	operation: DeltaOperation;
	description: string;
	requirements?: Requirement[];
	rename?: DeltaRename;
}

export interface Change {
	name: string;
	why: string;
	whatChanges: string;
	deltas: Delta[];
}

// ─── Validate helpers ───

function validateDeltaOperation(value: unknown): value is DeltaOperation {
	return typeof value === "string" && ["ADDED", "MODIFIED", "REMOVED", "RENAMED"].includes(value);
}

function validateDelta(input: unknown): SafeParseResult<Delta> {
	const issues: ValidationError[] = [];

	if (!input || typeof input !== "object") {
		return fail([{ path: "", message: "Delta must be an object" }]);
	}

	const obj = input as Record<string, unknown>;

	// spec: non-empty string
	if (typeof obj.spec !== "string" || obj.spec.trim().length === 0) {
		issues.push({ path: "spec", message: "Spec name cannot be empty" });
	}

	// operation: one of ADDED/MODIFIED/REMOVED/RENAMED
	const op = obj.operation;
	if (!validateDeltaOperation(op)) {
		issues.push({ path: "operation", message: "Operation must be ADDED, MODIFIED, REMOVED, or RENAMED" });
	}

	// description: non-empty string
	if (typeof obj.description !== "string" || obj.description.trim().length === 0) {
		issues.push({ path: "description", message: "Delta description cannot be empty" });
	}

	// requirements: required for ADDED/MODIFIED
	if (op === "ADDED" || op === "MODIFIED") {
		if (!Array.isArray(obj.requirements) || obj.requirements.length === 0) {
			issues.push({ path: "requirements", message: "ADDED/MODIFIED deltas should include the affected requirements" });
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
	}

	// rename: required for RENAMED
	if (op === "RENAMED") {
		const rename = obj.rename as Record<string, unknown> | undefined;
		if (
			!rename ||
			typeof rename !== "object" ||
			typeof rename.from !== "string" ||
			!rename.from ||
			typeof rename.to !== "string" ||
			!rename.to
		) {
			issues.push({ path: "rename", message: "RENAMED delta must include rename.from and rename.to" });
		}
	}

	if (issues.length > 0) {
		return fail(issues);
	}

	return ok({
		spec: String(obj.spec),
		operation: op as DeltaOperation,
		description: String(obj.description),
		requirements: Array.isArray(obj.requirements)
			? (obj.requirements as unknown[]).map((r) => (validateRequirement(r) as ValidationResult<Requirement>).data)
			: undefined,
		rename: obj.rename
			? {
					from: String((obj.rename as Record<string, unknown>).from),
					to: String((obj.rename as Record<string, unknown>).to),
				}
			: undefined,
	});
}

// ─── Change validation ───

export function validateChange(input: unknown): SafeParseResult<Change> {
	const issues: ValidationError[] = [];

	if (!input || typeof input !== "object") {
		return fail([{ path: "", message: "Change must be an object" }]);
	}

	const obj = input as Record<string, unknown>;

	// name: non-empty string
	if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
		issues.push({ path: "name", message: "Change name cannot be empty" });
	}

	// why: 50-1000 chars
	if (typeof obj.why !== "string") {
		issues.push({ path: "why", message: "Why section is required" });
	} else {
		const len = obj.why.trim().length;
		if (len < 50) {
			issues.push({ path: "why", message: `Why section must be at least ${50} characters` });
		} else if (len > 1000) {
			issues.push({ path: "why", message: `Why section should not exceed ${1000} characters` });
		}
	}

	// whatChanges: non-empty string
	if (typeof obj.whatChanges !== "string" || obj.whatChanges.trim().length === 0) {
		issues.push({ path: "whatChanges", message: "What Changes section cannot be empty" });
	}

	// deltas: 1-10
	if (!Array.isArray(obj.deltas) || obj.deltas.length === 0) {
		issues.push({ path: "deltas", message: "Change must have at least one delta" });
	} else if (obj.deltas.length > MAX_DELTAS_PER_CHANGE) {
		issues.push({
			path: "deltas",
			message: `Consider splitting changes with more than ${MAX_DELTAS_PER_CHANGE} deltas`,
		});
	} else {
		for (let i = 0; i < obj.deltas.length; i++) {
			const deltaResult = validateDelta(obj.deltas[i]);
			if (!deltaResult.success) {
				for (const issue of deltaResult.error.issues) {
					issues.push({ path: `deltas.${i}.${issue.path}`, message: issue.message });
				}
			}
		}
	}

	if (issues.length > 0) {
		return fail(issues);
	}

	return ok({
		name: String(obj.name),
		why: String(obj.why),
		whatChanges: String(obj.whatChanges),
		deltas: (obj.deltas as unknown[]).map((d) => (validateDelta(d) as ValidationResult<Delta>).data),
	});
}
