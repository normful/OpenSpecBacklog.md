import { describe, expect, it } from "bun:test";
import { parseDeltaSpec } from "../openspec/parsers/requirement-blocks.ts";
import {
	buildDeltaEntryBody,
	buildDeltaSpecWithEntry,
	locateSection,
	removeDeltaByIndex,
} from "../openspec/serializers.ts";

// ─── buildDeltaEntryBody ───

describe("buildDeltaEntryBody", () => {
	it("builds ADDED entry with statement", () => {
		const body = buildDeltaEntryBody({
			operation: "ADDED",
			name: "Login",
			statement: "The system SHALL authenticate users.",
		});
		expect(body).toContain("### Requirement: Login");
		expect(body).toContain("The system SHALL authenticate users.");
	});

	it("builds ADDED entry with statement and scenario", () => {
		const body = buildDeltaEntryBody({
			operation: "ADDED",
			name: "Export",
			statement: "The system SHALL export CSV.",
			scenarioRawText: "GIVEN user clicks Export\nWHEN processing\nTHEN CSV downloads",
		});
		expect(body).toContain("### Requirement: Export");
		expect(body).toContain("GIVEN user clicks Export");
	});

	it("builds MODIFIED entry identically to ADDED", () => {
		const body = buildDeltaEntryBody({
			operation: "MODIFIED",
			name: "Login",
			statement: "The system SHALL now support SSO.",
		});
		expect(body).toContain("### Requirement: Login");
		expect(body).toContain("SHALL now support SSO");
	});

	it("builds REMOVED entry with just the header", () => {
		const body = buildDeltaEntryBody({
			operation: "REMOVED",
			name: "DeprecatedFeature",
		});
		expect(body).toBe("### Requirement: DeprecatedFeature");
	});

	it("builds RENAMED entry with FROM/TO", () => {
		const body = buildDeltaEntryBody({
			operation: "RENAMED",
			name: "Login",
			renameFrom: "OldLogin",
			renameTo: "NewLogin",
		});
		expect(body).toContain("FROM: `### Requirement: OldLogin`");
		expect(body).toContain("TO: `### Requirement: NewLogin`");
	});
});

// ─── locateSection ───

describe("locateSection", () => {
	it("finds existing ADDED section in content", () => {
		const content = "## ADDED Requirements\n### Requirement: Foo\nThe system SHALL foo.\n";
		const result = locateSection(content, "ADDED");
		expect(result.exists).toBe(true);
		expect(result.sectionBody).toContain("### Requirement: Foo");
	});

	it("returns not found for absent section", () => {
		const content = "## Some Other Section\nContent.\n";
		const result = locateSection(content, "ADDED");
		expect(result.exists).toBe(false);
		expect(result.sectionBody).toBe("");
	});

	it("returns not found for empty content", () => {
		const result = locateSection("", "ADDED");
		expect(result.exists).toBe(false);
	});

	it("preserves before/after boundaries", () => {
		const content = "## Header\nBefore\n## ADDED Requirements\n### Requirement: X\nBody\n## Appendix\nAfter\n";
		const result = locateSection(content, "ADDED");
		expect(result.exists).toBe(true);
		expect(result.before).toContain("## Header");
		expect(result.before).toContain("Before");
		expect(result.sectionBody).toContain("### Requirement: X");
		expect(result.sectionBody).toContain("Body");
		expect(result.after).toContain("## Appendix");
		expect(result.after).toContain("After");
	});
});

// ─── buildDeltaSpecWithEntry ───

describe("buildDeltaSpecWithEntry", () => {
	it("creates a new spec file with ADDED section from empty content", () => {
		const result = buildDeltaSpecWithEntry("", {
			operation: "ADDED",
			name: "Login",
			statement: "The system SHALL authenticate.",
		});
		expect(result).toContain("## ADDED Requirements");
		expect(result).toContain("### Requirement: Login");
		expect(result).toContain("The system SHALL authenticate.");
	});

	it("appends to existing ADDED section", () => {
		const existing = "## ADDED Requirements\n### Requirement: Alpha\nThe system SHALL alpha.\n";
		const result = buildDeltaSpecWithEntry(existing, {
			operation: "ADDED",
			name: "Beta",
			statement: "The system SHALL beta.",
		});
		expect(result).toContain("### Requirement: Alpha");
		expect(result).toContain("### Requirement: Beta");
		// Both requirements should be within ADDED section
		const deltaPlan = parseDeltaSpec(result);
		expect(deltaPlan.added).toHaveLength(2);
		expect(deltaPlan.added[0]?.name).toBe("Alpha");
		expect(deltaPlan.added[1]?.name).toBe("Beta");
	});

	it("inserts MODIFIED section before REMOVED when only REMOVED exists", () => {
		const existing = "## REMOVED Requirements\n### Requirement: Obsolete\n";
		const result = buildDeltaSpecWithEntry(existing, {
			operation: "MODIFIED",
			name: "Login",
			statement: "The system SHALL now do X.",
		});
		const deltaPlan = parseDeltaSpec(result);
		expect(deltaPlan.sectionPresence.modified).toBe(true);
		expect(deltaPlan.sectionPresence.removed).toBe(true);
		// MODIFIED should come before REMOVED
		const modifiedIdx = result.indexOf("## MODIFIED Requirements");
		const removedIdx = result.indexOf("## REMOVED Requirements");
		expect(removedIdx).toBeGreaterThan(modifiedIdx);
	});

	it("inserts sections in canonical order: ADDED → MODIFIED → REMOVED → RENAMED", () => {
		// Start with only RENAMED
		const existing = "## RENAMED Requirements\n- FROM: `### Requirement: Old`\n- TO: `### Requirement: New`\n";
		// Add ADDED, MODIFIED, REMOVED — should sort to canonical order
		let result = buildDeltaSpecWithEntry(existing, {
			operation: "ADDED",
			name: "New",
			statement: "The system SHALL new.",
		});
		result = buildDeltaSpecWithEntry(result, {
			operation: "MODIFIED",
			name: "Existing",
			statement: "The system SHALL modified.",
		});
		result = buildDeltaSpecWithEntry(result, {
			operation: "REMOVED",
			name: "OldThing",
		});

		const addedIdx = result.indexOf("## ADDED Requirements");
		const modifiedIdx = result.indexOf("## MODIFIED Requirements");
		const removedIdx = result.indexOf("## REMOVED Requirements");
		const renamedIdx = result.indexOf("## RENAMED Requirements");

		expect(modifiedIdx).toBeGreaterThan(addedIdx);
		expect(removedIdx).toBeGreaterThan(modifiedIdx);
		expect(renamedIdx).toBeGreaterThan(removedIdx);
	});

	it("adds REMOVED entry to existing REMOVED section", () => {
		const existing = "## REMOVED Requirements\n### Requirement: Alpha\n";
		const result = buildDeltaSpecWithEntry(existing, {
			operation: "REMOVED",
			name: "Beta",
		});
		const deltaPlan = parseDeltaSpec(result);
		expect(deltaPlan.removed).toEqual(["Alpha", "Beta"]);
	});

	it("adds RENAMED entry to existing RENAMED section", () => {
		const existing = "## RENAMED Requirements\n- FROM: `### Requirement: OldA`\n- TO: `### Requirement: NewA`\n";
		const result = buildDeltaSpecWithEntry(existing, {
			operation: "RENAMED",
			name: "OldB",
			renameFrom: "OldB",
			renameTo: "NewB",
		});
		const deltaPlan = parseDeltaSpec(result);
		expect(deltaPlan.renamed).toHaveLength(2);
		expect(deltaPlan.renamed[1]).toEqual({ from: "OldB", to: "NewB" });
	});

	it("creates RENAMED section when one doesn't exist yet", () => {
		const result = buildDeltaSpecWithEntry("", {
			operation: "RENAMED",
			name: "OldLogin",
			renameFrom: "OldLogin",
			renameTo: "NewLogin",
		});
		expect(result).toContain("## RENAMED Requirements");
		expect(result).toContain("FROM: `### Requirement: OldLogin`");
		expect(result).toContain("TO: `### Requirement: NewLogin`");
	});

	it("preserves non-delta content when adding entry", () => {
		const existing = "# Delta Spec\n\n## Context\nSome context here.\n";
		const result = buildDeltaSpecWithEntry(existing, {
			operation: "ADDED",
			name: "Feature",
			statement: "The system SHALL feature.",
		});
		expect(result).toContain("## Context");
		expect(result).toContain("Some context here.");
		expect(result).toContain("## ADDED Requirements");
		expect(result).toContain("### Requirement: Feature");
	});

	it("produces valid parseable output that matches input roundtrip", () => {
		// Start from empty, add several entries, then parse and verify
		const entries = [
			{ operation: "ADDED" as const, name: "Alpha", statement: "The system SHALL alpha." },
			{ operation: "ADDED" as const, name: "Beta", statement: "The system SHALL beta." },
			{ operation: "MODIFIED" as const, name: "Gamma", statement: "The system SHALL gamma." },
			{ operation: "REMOVED" as const, name: "Delta" },
			{ operation: "RENAMED" as const, name: "Epsilon", renameFrom: "OldE", renameTo: "NewE" },
		];

		let content = "";
		for (const entry of entries) {
			content = buildDeltaSpecWithEntry(content, entry);
		}

		const plan = parseDeltaSpec(content);
		expect(plan.added).toHaveLength(2);
		expect(plan.modified).toHaveLength(1);
		expect(plan.removed).toEqual(["Delta"]);
		expect(plan.renamed).toHaveLength(1);
		expect(plan.renamed[0]).toEqual({ from: "OldE", to: "NewE" });
	});
});

// ─── removeDeltaByIndex ───

describe("removeDeltaByIndex", () => {
	it("removes first entry from ADDED section", () => {
		const content =
			"## ADDED Requirements\n### Requirement: Alpha\nThe system SHALL alpha.\n\n### Requirement: Beta\nThe system SHALL beta.\n";
		const result = removeDeltaByIndex(content, 1);
		expect(result).not.toBeNull();
		if (result) {
			const plan = parseDeltaSpec(result);
			expect(plan.added).toHaveLength(1);
			expect(plan.added[0]?.name).toBe("Beta");
		}
	});

	it("removes entry from MODIFIED section by flat index", () => {
		const content =
			"## ADDED Requirements\n### Requirement: Alpha\nThe system SHALL alpha.\n\n## MODIFIED Requirements\n### Requirement: Beta\nThe system SHALL beta.\n";
		// Beta is index 2 (Alpha=1, Beta=2)
		const result = removeDeltaByIndex(content, 2);
		expect(result).not.toBeNull();
		if (result) {
			const plan = parseDeltaSpec(result);
			expect(plan.added).toHaveLength(1);
			expect(plan.modified).toHaveLength(0);
		}
	});

	it("removes entry from REMOVED section", () => {
		const content = "## REMOVED Requirements\n### Requirement: Gone1\n### Requirement: Gone2\n";
		const result = removeDeltaByIndex(content, 2);
		expect(result).not.toBeNull();
		if (result) {
			const plan = parseDeltaSpec(result);
			expect(plan.removed).toEqual(["Gone1"]);
		}
	});

	it("removes RENAMED entry", () => {
		const content =
			"## RENAMED Requirements\n- FROM: `### Requirement: OldA`\n- TO: `### Requirement: NewA`\n\n- FROM: `### Requirement: OldB`\n- TO: `### Requirement: NewB`\n";
		const result = removeDeltaByIndex(content, 2);
		expect(result).not.toBeNull();
		if (result) {
			const plan = parseDeltaSpec(result);
			expect(plan.renamed).toHaveLength(1);
			expect(plan.renamed[0]).toEqual({ from: "OldA", to: "NewA" });
		}
	});

	it("returns null for out-of-range index", () => {
		const content = "## ADDED Requirements\n### Requirement: Foo\nThe system SHALL foo.\n";
		const result = removeDeltaByIndex(content, 5);
		expect(result).toBeNull();
	});

	it("removes entire section when last entry is deleted", () => {
		const content =
			"## ADDED Requirements\n### Requirement: Lone\nThe system SHALL lone.\n\n## MODIFIED Requirements\n### Requirement: Existing\nThe system SHALL existing.\n";
		const result = removeDeltaByIndex(content, 1);
		expect(result).not.toBeNull();
		if (result) {
			// Lone is removed, ADDED section should be gone
			expect(result).not.toContain("## ADDED Requirements");
			expect(result).toContain("## MODIFIED Requirements");
		}
	});

	it("indices shift down correctly", () => {
		// Add 3 items, remove middle (index 2), remaining should be 1 and 3
		const content =
			"## ADDED Requirements\n### Requirement: First\nFirst statement.\n\n### Requirement: Second\nSecond statement.\n\n### Requirement: Third\nThird statement.\n";
		const result = removeDeltaByIndex(content, 2);
		expect(result).not.toBeNull();
		if (result) {
			const plan = parseDeltaSpec(result);
			expect(plan.added).toHaveLength(2);
			expect(plan.added[0]?.name).toBe("First");
			expect(plan.added[1]?.name).toBe("Third");
		}
	});

	it("rejects index < 1", () => {
		const result = removeDeltaByIndex("some content", 0);
		expect(result).toBeNull();
	});
});
