import { z } from "zod";
import { RequirementSchema, VALIDATION_MESSAGES } from "./base.schema.ts";

/**
 * SpecSchema — a main specification document.
 * - `name`: non-empty spec name
 * - `overview`: non-empty purpose section content
 * - `requirements`: at least one Requirement block
 * - `metadata`: optional version + format tracking (matches OpenSpec)
 */
export const SpecSchema = z.object({
	name: z.string().min(1, VALIDATION_MESSAGES.SPEC_NAME_EMPTY),
	overview: z.string().min(1, VALIDATION_MESSAGES.SPEC_PURPOSE_EMPTY),
	requirements: z.array(RequirementSchema).min(1, VALIDATION_MESSAGES.SPEC_NO_REQUIREMENTS),
	metadata: z
		.object({
			version: z.string().default("1.0.0"),
			format: z.literal("openspec"),
			sourcePath: z.string().optional(),
		})
		.optional(),
});

export type Spec = z.infer<typeof SpecSchema>;
