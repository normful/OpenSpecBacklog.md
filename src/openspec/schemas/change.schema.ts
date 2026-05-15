import { z } from "zod";
import { MAX_DELTAS_PER_CHANGE, RequirementSchema, VALIDATION_MESSAGES } from "./base.schema.ts";

/**
 * Delta operation types matching OpenSpec's `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` headers.
 */
export const DeltaOperationType = z.enum(["ADDED", "MODIFIED", "REMOVED", "RENAMED"]);

export type DeltaOperation = z.infer<typeof DeltaOperationType>;

/**
 * DeltaSchema — a single change operation targeting one requirement in a spec.
 * - `spec`: the spec name this delta applies to (e.g. "user-auth")
 * - `operation`: ADDED | MODIFIED | REMOVED | RENAMED
 * - `description`: human-readable summary of this delta
 * - `requirements`: affected Requirement blocks (always array, simplifies OpenSpec's dual requirement? + requirements[]?)
 * - `rename`: required when op=RENAMED; carries from→to requirement header names
 *
 * Note: `requirements[]` is always an array. For REMOVED ops, it may be empty
 * since only the header name is needed (body dropped).
 * RENAMED uses the `rename` object instead of `requirements`.
 */
export const DeltaSchema = z
	.object({
		spec: z.string().min(1, VALIDATION_MESSAGES.DELTA_SPEC_EMPTY),
		operation: DeltaOperationType,
		description: z.string().min(1, VALIDATION_MESSAGES.DELTA_DESCRIPTION_EMPTY),
		requirements: z.array(RequirementSchema).optional(),
		rename: z
			.object({
				from: z.string().min(1),
				to: z.string().min(1),
			})
			.optional(),
	})
	.refine(
		(delta) => {
			if (delta.operation === "RENAMED") {
				return delta.rename !== undefined;
			}
			return true;
		},
		{
			message: VALIDATION_MESSAGES.DELTA_RENAME_MISSING,
			path: ["rename"],
		},
	)
	.refine(
		(delta) => {
			if (delta.operation === "ADDED" || delta.operation === "MODIFIED") {
				const hasReqs = delta.requirements !== undefined && delta.requirements.length > 0;
				if (!hasReqs) {
					return false;
				}
			}
			return true;
		},
		{
			message: VALIDATION_MESSAGES.DELTA_REQUIREMENTS_MISSING,
			path: ["requirements"],
		},
	);

export type Delta = z.infer<typeof DeltaSchema>;

/**
 * ChangeSchema — a proposed change with motivation and delta specs.
 * - `name`: non-empty change name
 * - `why`: motivation section (50-1000 chars)
 * - `whatChanges`: summary of what changes
 * - `deltas`: 1-10 delta operations
 * - `metadata`: optional version + format tracking (matches OpenSpec)
 */
export const ChangeSchema = z.object({
	name: z.string().min(1, VALIDATION_MESSAGES.CHANGE_NAME_EMPTY),
	why: z.string().min(50, VALIDATION_MESSAGES.CHANGE_WHY_TOO_SHORT).max(1000, VALIDATION_MESSAGES.CHANGE_WHY_TOO_LONG),
	whatChanges: z.string().min(1, VALIDATION_MESSAGES.CHANGE_WHAT_EMPTY),
	deltas: z
		.array(DeltaSchema)
		.min(1, VALIDATION_MESSAGES.CHANGE_NO_DELTAS)
		.max(MAX_DELTAS_PER_CHANGE, VALIDATION_MESSAGES.CHANGE_TOO_MANY_DELTAS),
	metadata: z
		.object({
			version: z.string().default("1.0.0"),
			format: z.literal("openspec-change"),
			sourcePath: z.string().optional(),
		})
		.optional(),
});

export type Change = z.infer<typeof ChangeSchema>;
