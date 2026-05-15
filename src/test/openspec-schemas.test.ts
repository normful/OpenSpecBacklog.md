import { describe, expect, it } from "bun:test";

import {
	ChangeSchema,
	DeltaOperationType,
	DeltaSchema,
	MAX_DELTAS_PER_CHANGE,
	MAX_WHY_SECTION_LENGTH,
	MIN_WHY_SECTION_LENGTH,
	RequirementSchema,
	ScenarioSchema,
	SpecSchema,
	VALIDATION_MESSAGES,
} from "../openspec/schemas/index.ts";

// ---------------------------------------------------------------------------
// ScenarioSchema
// ---------------------------------------------------------------------------
describe("ScenarioSchema", () => {
	it("validates a valid scenario with rawText", () => {
		const result = ScenarioSchema.safeParse({
			rawText: "- **WHEN** user clicks Export\n- **THEN** CSV is downloaded",
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty rawText", () => {
		const result = ScenarioSchema.safeParse({ rawText: "" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(VALIDATION_MESSAGES.SCENARIO_EMPTY);
		}
	});
});

// ---------------------------------------------------------------------------
// RequirementSchema
// ---------------------------------------------------------------------------
describe("RequirementSchema", () => {
	it("validates a requirement with SHALL keyword and scenarios", () => {
		const result = RequirementSchema.safeParse({
			text: "The system SHALL export data in CSV format.",
			scenarios: [{ rawText: "- **WHEN** user clicks Export\n- **THEN** CSV is downloaded" }],
		});
		expect(result.success).toBe(true);
	});

	it("validates a requirement with MUST keyword", () => {
		const result = RequirementSchema.safeParse({
			text: "The system MUST authenticate all requests.",
			scenarios: [{ rawText: "- **WHEN** request arrives\n- **THEN** auth is checked" }],
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing SHALL/MUST keyword", () => {
		const result = RequirementSchema.safeParse({
			text: "The system should probably do something.",
			scenarios: [{ rawText: "- **WHEN** test\n- **THEN** test" }],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(VALIDATION_MESSAGES.REQUIREMENT_NO_SHALL);
		}
	});

	it("rejects empty text", () => {
		const result = RequirementSchema.safeParse({
			text: "",
			scenarios: [{ rawText: "- **WHEN** test\n- **THEN** test" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects zero scenarios", () => {
		const result = RequirementSchema.safeParse({
			text: "The system SHALL do something.",
			scenarios: [],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(VALIDATION_MESSAGES.REQUIREMENT_NO_SCENARIOS);
		}
	});

	it("infers correct TypeScript type", () => {
		const req = RequirementSchema.parse({
			text: "System SHALL work.",
			scenarios: [{ rawText: "desc" }],
		});
		// TypeScript compile-time check: should have text and scenarios
		expect(req.text).toBeString();
		expect(req.scenarios).toBeArray();
	});
});

// ---------------------------------------------------------------------------
// SpecSchema
// ---------------------------------------------------------------------------
describe("SpecSchema", () => {
	it("validates a valid spec", () => {
		const result = SpecSchema.safeParse({
			name: "user-auth",
			overview: "This spec describes user authentication requirements.",
			requirements: [
				{
					text: "The system SHALL authenticate users via OAuth2.",
					scenarios: [{ rawText: "- **WHEN** user logs in\n- **THEN** OAuth2 flow starts" }],
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty name", () => {
		const result = SpecSchema.safeParse({
			name: "",
			overview: "Purpose text here.",
			requirements: [
				{
					text: "System SHALL do X.",
					scenarios: [{ rawText: "desc" }],
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty overview", () => {
		const result = SpecSchema.safeParse({
			name: "my-spec",
			overview: "",
			requirements: [
				{
					text: "System SHALL do X.",
					scenarios: [{ rawText: "desc" }],
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects zero requirements", () => {
		const result = SpecSchema.safeParse({
			name: "my-spec",
			overview: "Purpose text here.",
			requirements: [],
		});
		expect(result.success).toBe(false);
	});

	it("accepts optional metadata", () => {
		const result = SpecSchema.safeParse({
			name: "my-spec",
			overview: "Purpose text.",
			requirements: [
				{
					text: "System SHALL do X.",
					scenarios: [{ rawText: "desc" }],
				},
			],
			metadata: {
				version: "2.0.0",
				format: "openspec",
				sourcePath: "openspec/specs/my-spec/spec.md",
			},
		});
		expect(result.success).toBe(true);
		expect(result.data?.metadata?.version).toBe("2.0.0");
	});

	it("infers correct TypeScript type", () => {
		const spec = SpecSchema.parse({
			name: "x",
			overview: "y",
			requirements: [{ text: "System SHALL x.", scenarios: [{ rawText: "d" }] }],
		});
		expect(spec.name).toBeString();
		expect(spec.requirements[0]?.text).toBeString();
	});
});

// ---------------------------------------------------------------------------
// DeltaSchema
// ---------------------------------------------------------------------------
describe("DeltaSchema", () => {
	it("validates ADDED delta with requirements", () => {
		const result = DeltaSchema.safeParse({
			spec: "user-auth",
			operation: "ADDED",
			description: "Add OAuth2 requirement for user authentication",
			requirements: [
				{
					text: "The system SHALL support OAuth2.",
					scenarios: [{ rawText: "- **WHEN** user clicks login\n- **THEN** OAuth2 flow begins" }],
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("validates MODIFIED delta with requirements", () => {
		const result = DeltaSchema.safeParse({
			spec: "user-auth",
			operation: "MODIFIED",
			description: "Update rate limiting to 100 req/s",
			requirements: [
				{
					text: "The system MUST rate limit to 100 req/s.",
					scenarios: [{ rawText: "- **WHEN** 101st request\n- **THEN** 429 returned" }],
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("validates REMOVED delta (no requirements required)", () => {
		const result = DeltaSchema.safeParse({
			spec: "user-auth",
			operation: "REMOVED",
			description: "Remove legacy API key auth",
		});
		expect(result.success).toBe(true);
	});

	it("validates RENAMED delta with rename object", () => {
		const result = DeltaSchema.safeParse({
			spec: "user-auth",
			operation: "RENAMED",
			description: "Rename 'Login' to 'SignIn'",
			rename: { from: "Login", to: "SignIn" },
		});
		expect(result.success).toBe(true);
	});

	it("rejects RENAMED delta without rename object", () => {
		const result = DeltaSchema.safeParse({
			spec: "user-auth",
			operation: "RENAMED",
			description: "Rename something",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const renameIssue = result.error.issues.find((i) => i.path.includes("rename"));
			expect(renameIssue?.message).toBe(VALIDATION_MESSAGES.DELTA_RENAME_MISSING);
		}
	});

	it("rejects ADDED delta without requirements", () => {
		const result = DeltaSchema.safeParse({
			spec: "user-auth",
			operation: "ADDED",
			description: "Add something",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const reqIssue = result.error.issues.find((i) => i.path.includes("requirements"));
			expect(reqIssue?.message).toBe(VALIDATION_MESSAGES.DELTA_REQUIREMENTS_MISSING);
		}
	});

	it("rejects invalid operation type", () => {
		const result = DeltaSchema.safeParse({
			spec: "user-auth",
			operation: "INVALID",
			description: "Test",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty spec and description", () => {
		const result = DeltaSchema.safeParse({
			spec: "",
			operation: "REMOVED",
			description: "",
		});
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// DeltaOperationType (enum)
// ---------------------------------------------------------------------------
describe("DeltaOperationType", () => {
	it("accepts ADDED, MODIFIED, REMOVED, RENAMED", () => {
		for (const op of ["ADDED", "MODIFIED", "REMOVED", "RENAMED"]) {
			expect(DeltaOperationType.safeParse(op).success).toBe(true);
		}
	});

	it("rejects invalid values", () => {
		expect(DeltaOperationType.safeParse("ADDDED").success).toBe(false);
		expect(DeltaOperationType.safeParse("added").success).toBe(false); // case-sensitive
		expect(DeltaOperationType.safeParse("DELETED").success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// ChangeSchema
// ---------------------------------------------------------------------------
describe("ChangeSchema", () => {
	it("validates a valid change", () => {
		const result = ChangeSchema.safeParse({
			name: "add-oauth-support",
			why: "OAuth2 support is needed to comply with enterprise SSO requirements.",
			whatChanges: "Add OAuth2 login flow to user-auth spec",
			deltas: [
				{
					spec: "user-auth",
					operation: "ADDED",
					description: "Add OAuth2 requirement",
					requirements: [
						{
							text: "The system SHALL support OAuth2.",
							scenarios: [{ rawText: "- **WHEN** user logs in\n- **THEN** OAuth2 flow" }],
						},
					],
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects why section shorter than minimum length", () => {
		const result = ChangeSchema.safeParse({
			name: "test",
			why: "Too short.",
			whatChanges: "Something",
			deltas: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects why section exceeding maximum length", () => {
		const longWhy = "A".repeat(MAX_WHY_SECTION_LENGTH + 1);
		const result = ChangeSchema.safeParse({
			name: "test",
			why: longWhy,
			whatChanges: "Something",
			deltas: [
				{
					spec: "x",
					operation: "REMOVED",
					description: "Test delta",
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty whatChanges", () => {
		const result = ChangeSchema.safeParse({
			name: "test",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "",
			deltas: [
				{
					spec: "x",
					operation: "REMOVED",
					description: "Test",
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects zero deltas", () => {
		const result = ChangeSchema.safeParse({
			name: "test",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Something",
			deltas: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects more than MAX_DELTAS_PER_CHANGE deltas", () => {
		const tooManyDeltas = Array.from({ length: MAX_DELTAS_PER_CHANGE + 1 }, (_, i) => ({
			spec: `spec-${i}`,
			operation: "ADDED" as const,
			description: `Delta ${i}`,
			requirements: [
				{
					text: `System SHALL handle delta ${i}.`,
					scenarios: [{ rawText: `- **WHEN** test ${i}\n- **THEN** ok` }],
				},
			],
		}));
		const result = ChangeSchema.safeParse({
			name: "test",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Many changes",
			deltas: tooManyDeltas,
		});
		expect(result.success).toBe(false);
	});

	it("accepts optional metadata", () => {
		const result = ChangeSchema.safeParse({
			name: "test",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Something",
			deltas: [
				{
					spec: "x",
					operation: "REMOVED",
					description: "Test",
				},
			],
			metadata: {
				version: "1.5.0",
				format: "openspec-change",
				sourcePath: "openspec/changes/test/proposal.md",
			},
		});
		expect(result.success).toBe(true);
		expect(result.data?.metadata?.version).toBe("1.5.0");
	});
});

// ---------------------------------------------------------------------------
// Validation thresholds
// ---------------------------------------------------------------------------
describe("validation thresholds", () => {
	it("MIN_WHY_SECTION_LENGTH is 50", () => {
		expect(MIN_WHY_SECTION_LENGTH).toBe(50);
	});

	it("MAX_WHY_SECTION_LENGTH is 1000", () => {
		expect(MAX_WHY_SECTION_LENGTH).toBe(1000);
	});

	it("MAX_DELTAS_PER_CHANGE is 10", () => {
		expect(MAX_DELTAS_PER_CHANGE).toBe(10);
	});
});
