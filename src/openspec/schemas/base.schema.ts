import { z } from "zod";

// Validation threshold constants (matching OpenSpec's constants.ts)
// These are default values; can be overridden via BacklogConfig.validation
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
	// Warnings
	PURPOSE_TOO_BRIEF: `Purpose section is too brief (less than ${MIN_PURPOSE_LENGTH} characters)`,
	REQUIREMENT_TOO_LONG: `Requirement text is very long (>${MAX_REQUIREMENT_TEXT_LENGTH} characters). Consider breaking it down.`,
	DELTA_DESCRIPTION_TOO_BRIEF: "Delta description is too brief",
	// Guidance snippets
	GUIDE_MISSING_SPEC_SECTIONS: 'Missing required sections. Expected headers: "## Purpose" and "## Requirements".',
} as const;

/**
 * ScenarioSchema — raw text block under a `#### Scenario: Name` header.
 * Matches OpenSpec's base.schema.ts exactly: unstructured `rawText: string`.
 * GIVEN/WHEN/THEN structure is a markdown convention enforced at the parser layer.
 */
export const ScenarioSchema = z.object({
	rawText: z.string().min(1, VALIDATION_MESSAGES.SCENARIO_EMPTY),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

/**
 * RequirementSchema — a single requirement block.
 * - `text`: the requirement statement (first non-metadata line after `### Requirement: Name`)
 * - Must contain SHALL or MUST keyword (case-insensitive, word-boundary)
 * - `scenarios`: at least one Scenario block
 */
export const RequirementSchema = z.object({
	text: z
		.string()
		.min(1, VALIDATION_MESSAGES.REQUIREMENT_EMPTY)
		.refine((text) => /\b(SHALL|MUST)\b/i.test(text), VALIDATION_MESSAGES.REQUIREMENT_NO_SHALL),
	scenarios: z.array(ScenarioSchema).min(1, VALIDATION_MESSAGES.REQUIREMENT_NO_SCENARIOS),
});

export type Requirement = z.infer<typeof RequirementSchema>;
