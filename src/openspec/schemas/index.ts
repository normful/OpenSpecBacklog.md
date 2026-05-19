/**
 * Barrel exports for OpenSpec schemas.
 * Zod schemas replaced with pure TypeScript validators.
 */

export type { Requirement, Scenario } from "./base.schema.ts";
export {
	MAX_DELTAS_PER_CHANGE,
	MAX_REQUIREMENT_TEXT_LENGTH,
	MAX_WHY_SECTION_LENGTH,
	MIN_PURPOSE_LENGTH,
	MIN_WHY_SECTION_LENGTH,
	VALIDATION_MESSAGES,
	validateRequirement,
	validateScenario,
} from "./base.schema.ts";
export type { Change, Delta, DeltaOperation, DeltaRename } from "./change.schema.ts";
export { validateChange } from "./change.schema.ts";
export type { SafeParseResult, Spec, ValidationError, ValidationFailure, ValidationResult } from "./spec.schema.ts";
export { validateSpec } from "./spec.schema.ts";
