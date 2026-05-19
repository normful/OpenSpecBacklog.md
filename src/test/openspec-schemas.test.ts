/**
 * Tests for OpenSpec validation schemas (pure TS replacement for former Zod).
 */

import { describe, expect, it } from "bun:test";

import {
	MAX_DELTAS_PER_CHANGE,
	MAX_WHY_SECTION_LENGTH,
	MIN_WHY_SECTION_LENGTH,
	VALIDATION_MESSAGES,
	validateChange,
	validateRequirement,
	validateScenario,
	validateSpec,
} from "../openspec/schemas/index.ts";

// ─── Scenario ───

describe("validateScenario", () => {
	it("validates a valid scenario with rawText", () => {
		const result = validateScenario({ rawText: "GIVEN x WHEN y THEN z" });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.rawText).toBe("GIVEN x WHEN y THEN z");
		}
	});

	it("rejects empty rawText", () => {
		const result = validateScenario({ rawText: "" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(VALIDATION_MESSAGES.SCENARIO_EMPTY);
		}
	});

	it("rejects non-object input", () => {
		expect(validateScenario(null).success).toBe(false);
		expect(validateScenario("string").success).toBe(false);
		expect(validateScenario(42).success).toBe(false);
	});
});

// ─── Requirement ───

describe("validateRequirement", () => {
	it("validates a requirement with SHALL keyword and scenarios", () => {
		const result = validateRequirement({
			text: "The system SHALL export data in CSV format.",
			scenarios: [{ rawText: "WHEN user clicks Export THEN CSV is downloaded" }],
		});
		expect(result.success).toBe(true);
	});

	it("validates a requirement with MUST keyword", () => {
		const result = validateRequirement({
			text: "The system MUST authenticate all requests.",
			scenarios: [{ rawText: "WHEN request arrives THEN auth is checked" }],
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing SHALL/MUST keyword", () => {
		const result = validateRequirement({
			text: "The system should probably do something.",
			scenarios: [{ rawText: "WHEN test THEN test" }],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(VALIDATION_MESSAGES.REQUIREMENT_NO_SHALL);
		}
	});

	it("rejects empty text", () => {
		const result = validateRequirement({
			text: "",
			scenarios: [{ rawText: "WHEN test THEN test" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects zero scenarios", () => {
		const result = validateRequirement({
			text: "The system SHALL do something.",
			scenarios: [],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(VALIDATION_MESSAGES.REQUIREMENT_NO_SCENARIOS);
		}
	});
});

// ─── Spec ───

describe("validateSpec", () => {
	it("validates a valid spec", () => {
		const result = validateSpec({
			name: "user-auth",
			overview: "This spec describes user auth requirements.",
			requirements: [
				{
					text: "The system SHALL authenticate users via OAuth2.",
					scenarios: [{ rawText: "WHEN user logs in THEN OAuth2 flow starts" }],
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty name", () => {
		const result = validateSpec({
			name: "",
			overview: "Purpose text here.",
			requirements: [{ text: "System SHALL do X.", scenarios: [{ rawText: "desc" }] }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty overview", () => {
		const result = validateSpec({
			name: "my-spec",
			overview: "",
			requirements: [{ text: "System SHALL do X.", scenarios: [{ rawText: "desc" }] }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects zero requirements", () => {
		const result = validateSpec({
			name: "my-spec",
			overview: "Purpose text here.",
			requirements: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects requirement without SHALL", () => {
		const result = validateSpec({
			name: "my-spec",
			overview: "Purpose text.",
			requirements: [{ text: "Do X.", scenarios: [{ rawText: "desc" }] }],
		});
		expect(result.success).toBe(false);
	});
});

// ─── Change ───

describe("validateChange", () => {
	it("validates a valid change", () => {
		const result = validateChange({
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
							scenarios: [{ rawText: "WHEN user logs in THEN OAuth2 flow" }],
						},
					],
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects why section shorter than min length", () => {
		const result = validateChange({
			name: "test",
			why: "Too short.",
			whatChanges: "Something",
			deltas: [{ spec: "s", operation: "REMOVED" as const, description: "Test" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects why section exceeding max length", () => {
		const longWhy = "A".repeat(MAX_WHY_SECTION_LENGTH + 1);
		const result = validateChange({
			name: "test",
			why: longWhy,
			whatChanges: "Something",
			deltas: [{ spec: "s", operation: "REMOVED" as const, description: "Test" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty whatChanges", () => {
		const result = validateChange({
			name: "test",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "",
			deltas: [{ spec: "s", operation: "REMOVED" as const, description: "Test" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects zero deltas", () => {
		const result = validateChange({
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
			requirements: [{ text: `System SHALL handle delta ${i}.`, scenarios: [{ rawText: "WHEN test THEN ok" }] }],
		}));
		const result = validateChange({
			name: "test",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Many changes",
			deltas: tooManyDeltas,
		});
		expect(result.success).toBe(false);
	});

	it("validates ADDED delta with requirements", () => {
		const result = validateChange({
			name: "t",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Add OAuth2",
			deltas: [
				{
					spec: "user-auth",
					operation: "ADDED",
					description: "Add OAuth2",
					requirements: [
						{
							text: "The system SHALL support OAuth2.",
							scenarios: [{ rawText: "WHEN user clicks login THEN OAuth2 flow begins" }],
						},
					],
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("validates REMOVED delta without requirements", () => {
		const result = validateChange({
			name: "t",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Remove legacy auth",
			deltas: [{ spec: "user-auth", operation: "REMOVED", description: "Remove legacy API key auth" }],
		});
		expect(result.success).toBe(true);
	});

	it("validates RENAMED delta with rename object", () => {
		const result = validateChange({
			name: "t",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Rename Login to SignIn",
			deltas: [
				{
					spec: "user-auth",
					operation: "RENAMED",
					description: "Rename Login to SignIn",
					rename: { from: "Login", to: "SignIn" },
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects RENAMED delta without rename", () => {
		const result = validateChange({
			name: "t",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Rename",
			deltas: [{ spec: "user-auth", operation: "RENAMED", description: "Rename something" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects ADDED delta without requirements", () => {
		const result = validateChange({
			name: "t",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Add something",
			deltas: [{ spec: "user-auth", operation: "ADDED", description: "Add something" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid operation type", () => {
		const result = validateChange({
			name: "t",
			why: "This is a sufficiently long why section for validation purposes.",
			whatChanges: "Test",
			deltas: [{ spec: "user-auth", operation: "INVALID" as never, description: "Test" }],
		});
		expect(result.success).toBe(false);
	});
});

// ─── Validation thresholds ───

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
