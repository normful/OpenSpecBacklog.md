import { describe, expect, it } from "bun:test";
import { parseChange, parseSpecDeltas } from "../openspec/parsers/change-parser.ts";
import { extractRequirementsSection, parseDeltaSpec } from "../openspec/parsers/requirement-blocks.ts";

// ─── AC #1: RequirementBlock parser extracts header lines, names, and raw blocks ───

describe("RequirementBlock extraction", () => {
	it("parses canonical ### Requirement: headers", () => {
		const result = extractRequirementsSection("## Requirements\n### Requirement: Foo\nThe system SHALL foo.\n");
		expect(result.bodyBlocks).toHaveLength(1);
		expect(result.bodyBlocks[0]?.name).toBe("Foo");
		expect(result.bodyBlocks[0]?.headerLine).toBe("### Requirement: Foo");
		expect(result.bodyBlocks[0]?.raw).toContain("The system SHALL foo.");
	});

	it("parses mixed-case ### requirement: headers", () => {
		const variants = ["### requirement: Lowercase", "### REQUIREMENT: Uppercase", "### Requirement: Canonical"];
		for (const header of variants) {
			const result = extractRequirementsSection(`## Requirements\n${header}\nThe system SHALL foo.\n`);
			expect(result.bodyBlocks.length).toBeGreaterThan(0);
			expect(result.bodyBlocks[0]?.name).toBe(header.replace(/^###\s*requirement:\s*/i, ""));
		}
	});

	it("parses ###Requirement: header with no space after ###", () => {
		const result = extractRequirementsSection("## Requirements\n###Requirement: NoSpace\nThe system SHALL foo.\n");
		expect(result.bodyBlocks).toHaveLength(1);
		expect(result.bodyBlocks[0]?.name).toBe("NoSpace");
	});

	it("parses multiple blocks where first uses no-space header", () => {
		const content =
			"## Requirements\n###Requirement: First\nThe system SHALL first.\n\n### Requirement: Second\nThe system SHALL second.\n";
		const result = extractRequirementsSection(content);
		expect(result.bodyBlocks).toHaveLength(2);
		expect(result.bodyBlocks[0]?.name).toBe("First");
		expect(result.bodyBlocks[1]?.name).toBe("Second");
	});

	it("extracts full raw block content for each requirement", () => {
		const content = `## Requirements
### Requirement: Login
The system SHALL authenticate users via OAuth2.

#### Scenario: Successful login
Given valid credentials
When user submits
Then authenticated

### Requirement: Logout
The system SHALL end sessions on logout.
`;
		const result = extractRequirementsSection(content);
		expect(result.bodyBlocks).toHaveLength(2);
		expect(result.bodyBlocks[0]?.raw).toContain("### Requirement: Login");
		expect(result.bodyBlocks[0]?.raw).toContain("#### Scenario: Successful login");
		expect(result.bodyBlocks[0]?.raw).toContain("Given valid credentials");
		expect(result.bodyBlocks[1]?.raw).toContain("### Requirement: Logout");
		expect(result.bodyBlocks[1]?.raw).toContain("The system SHALL end sessions on logout.");
	});
});

// ─── AC #2: RequirementsSectionParts preserves before/preamble/body/after regions ───

describe("RequirementsSectionParts roundtrip preservation", () => {
	it("preserves content before the ## Requirements header", () => {
		const content = `# My Spec

## Purpose
This spec defines auth requirements.

## Requirements
### Requirement: Foo
The system SHALL foo.
`;
		const result = extractRequirementsSection(content);
		expect(result.before).toContain("# My Spec");
		expect(result.before).toContain("## Purpose");
		expect(result.before).toContain("This spec defines auth requirements.");
	});

	it("preserves content after the ## Requirements section", () => {
		const content = `## Requirements
### Requirement: Foo
The system SHALL foo.

## Appendix
Some additional notes.
`;
		const result = extractRequirementsSection(content);
		expect(result.after).toContain("## Appendix");
		expect(result.after).toContain("Some additional notes.");
	});

	it("captures preamble between ## Requirements and first ### Requirement:", () => {
		const content = `## Requirements
This section contains the following requirements.

### Requirement: Foo
The system SHALL foo.
`;
		const result = extractRequirementsSection(content);
		expect(result.preamble).toBe("This section contains the following requirements.");
	});

	it("preserves headerLine exactly", () => {
		const content = `## Requirements
### Requirement: Foo
The system SHALL foo.
`;
		const result = extractRequirementsSection(content);
		expect(result.headerLine).toBe("## Requirements");
	});

	it("reconstructs the full section from parts", () => {
		const content = `# My Spec

## Purpose
Overview text.

## Requirements
Preamble text.

### Requirement: Alpha
The system SHALL alpha.

### Requirement: Beta
The system SHALL beta.

## Appendix
Extra info.
`;
		const parts = extractRequirementsSection(content);
		// Reconstruct: before + headerLine + preamble + bodyBlocks + after
		const bodyRaw = parts.bodyBlocks.map((b) => b.raw).join("\n\n");
		const reconstructed = `${parts.before}${parts.headerLine}\n${parts.preamble}${parts.preamble ? "\n\n" : ""}${bodyRaw}\n${parts.after}`;
		expect(reconstructed.trim()).toBe(content.trim());
	});
});

// ─── AC #3: extractRequirementsSection handles missing ## Requirements gracefully ───

describe("missing ## Requirements section", () => {
	it("creates an empty RequirementsSectionParts when section is missing", () => {
		const content = `# My Spec
## Purpose
Some purpose text.
`;
		const result = extractRequirementsSection(content);
		expect(result.bodyBlocks).toHaveLength(0);
		expect(result.headerLine).toBe("## Requirements");
		expect(result.preamble).toBe("");
		// before should contain the rest of the content
		expect(result.before).toContain("# My Spec");
		expect(result.before).toContain("## Purpose");
	});

	it("returns empty bodyBlocks for empty content", () => {
		const result = extractRequirementsSection("");
		expect(result.bodyBlocks).toHaveLength(0);
		expect(result.headerLine).toBe("## Requirements");
	});
});

// ─── AC #4: parseDeltaSpec recognizes delta sections case-insensitively ───

describe("parseDeltaSpec", () => {
	it("parses ADDED section with requirement blocks", () => {
		const content = `## ADDED Requirements
### Requirement: NewFeature
The system SHALL provide new features.

#### Scenario: basic
Given X
When Y
Then Z
`;
		const result = parseDeltaSpec(content);
		expect(result.added).toHaveLength(1);
		expect(result.added[0]?.name).toBe("NewFeature");
		expect(result.sectionPresence.added).toBe(true);
		expect(result.sectionPresence.modified).toBe(false);
	});

	it("parses MODIFIED section with requirement blocks", () => {
		const content = `## MODIFIED Requirements
### Requirement: OldFeature
The system SHALL now behave differently.
`;
		const result = parseDeltaSpec(content);
		expect(result.modified).toHaveLength(1);
		expect(result.modified[0]?.name).toBe("OldFeature");
		expect(result.sectionPresence.modified).toBe(true);
	});

	it("parses REMOVED section with requirement names", () => {
		const content = `## REMOVED Requirements
### Requirement: Deprecated1
### Requirement: Deprecated2
`;
		const result = parseDeltaSpec(content);
		expect(result.removed).toEqual(["Deprecated1", "Deprecated2"]);
		expect(result.sectionPresence.removed).toBe(true);
	});

	it("parses RENAMED section with FROM/TO pairs", () => {
		const content = `## RENAMED Requirements
- FROM: \`### Requirement: OldName\`
- TO: \`### Requirement: NewName\`
`;
		const result = parseDeltaSpec(content);
		expect(result.renamed).toHaveLength(1);
		expect(result.renamed[0]?.from).toBe("OldName");
		expect(result.renamed[0]?.to).toBe("NewName");
	});

	it("detects all four section types case-insensitively", () => {
		const content = `## added requirements
### Requirement: A
The system SHALL a.

## modified requirements
### Requirement: B
The system SHALL b.

## removed requirements
### Requirement: C

## renamed requirements
- FROM: \`### Requirement: D\`
- TO: \`### Requirement: E\`
`;
		const result = parseDeltaSpec(content);
		expect(result.added).toHaveLength(1);
		expect(result.modified).toHaveLength(1);
		expect(result.removed).toHaveLength(1);
		expect(result.renamed).toHaveLength(1);
		expect(result.sectionPresence.added).toBe(true);
		expect(result.sectionPresence.modified).toBe(true);
		expect(result.sectionPresence.removed).toBe(true);
		expect(result.sectionPresence.renamed).toBe(true);
	});

	it("parses ###Requirement: header with no space in delta ADDED section", () => {
		const content = `## ADDED Requirements
###Requirement: NoSpace
The system SHALL foo.
`;
		const result = parseDeltaSpec(content);
		expect(result.added).toHaveLength(1);
		expect(result.added[0]?.name).toBe("NoSpace");
	});

	it("returns empty arrays for absent sections", () => {
		const result = parseDeltaSpec("## Some Other Section\nContent here.\n");
		expect(result.added).toHaveLength(0);
		expect(result.modified).toHaveLength(0);
		expect(result.removed).toHaveLength(0);
		expect(result.renamed).toHaveLength(0);
		expect(result.sectionPresence.added).toBe(false);
		expect(result.sectionPresence.modified).toBe(false);
		expect(result.sectionPresence.removed).toBe(false);
		expect(result.sectionPresence.renamed).toBe(false);
	});

	it("handles RENAMED with multiple FROM/TO pairs", () => {
		const content = `## RENAMED Requirements
- FROM: \`### Requirement: OldAlpha\`
- TO: \`### Requirement: NewAlpha\`
- FROM: \`### Requirement: OldBeta\`
- TO: \`### Requirement: NewBeta\`
`;
		const result = parseDeltaSpec(content);
		expect(result.renamed).toHaveLength(2);
		expect(result.renamed[0]).toEqual({ from: "OldAlpha", to: "NewAlpha" });
		expect(result.renamed[1]).toEqual({ from: "OldBeta", to: "NewBeta" });
	});
});

// ─── AC #5: parseChange reads Why + What Changes ───

describe("parseChange", () => {
	it("extracts Why and What Changes sections", () => {
		const content = `# Add User Authentication

## Why
We need to implement user authentication to secure the application and protect user data from unauthorized access.

## What Changes
- **user-auth:** Add new user authentication specification
- **api-endpoints:** Modify to include authentication endpoints
`;
		const change = parseChange(content);
		expect(change.why).toContain("secure the application");
		expect(change.whatChanges).toContain("user-auth");
	});

	it("throws if Why section is missing", () => {
		const content = `# Test

## What Changes
- **foo:** Add something
`;
		expect(() => parseChange(content)).toThrow("must have a Why section");
	});

	it("throws if What Changes section is missing", () => {
		const content = `# Test

## Why
Because we need it.
`;
		expect(() => parseChange(content)).toThrow("must have a What Changes section");
	});

	it("parses deltas from What Changes bullet list", () => {
		const content = `# Test Change

## Why
We need it because reasons that are sufficiently long.

## What Changes
- **spec-a:** Add a new requirement to spec-a
- **spec-b:** Rename requirement X to Y
- **spec-c:** Remove obsolete requirement
- **spec-d:** Update existing behavior
`;
		const change = parseChange(content);
		expect(change.deltas).toHaveLength(4);
		expect(change.deltas[0]?.spec).toBe("spec-a");
		expect(change.deltas[0]?.operation).toBe("ADDED");
		expect(change.deltas[1]?.spec).toBe("spec-b");
		expect(change.deltas[1]?.operation).toBe("RENAMED");
		expect(change.deltas[2]?.spec).toBe("spec-c");
		expect(change.deltas[2]?.operation).toBe("REMOVED");
		expect(change.deltas[3]?.spec).toBe("spec-d");
		expect(change.deltas[3]?.operation).toBe("MODIFIED");
	});

	it("handles empty What Changes with no deltas", () => {
		const content = `# Test Change

## Why
We need to make some changes for important reasons that justify this work.

## What Changes
Some general description without bullet deltas
`;
		const change = parseChange(content);
		expect(change.deltas).toHaveLength(0);
	});
});

// ─── AC #6: parseSpecDeltas reads spec deltas spec.md content ───

describe("parseSpecDeltas", () => {
	it("parses ADDED Requirements section into deltas", () => {
		const content = `# Delta Spec

## ADDED Requirements
### Requirement: NewThing
The system SHALL do the new thing.

#### Scenario: basic
Given X
When Y
Then Z
`;
		const deltas = parseSpecDeltas("my-spec", content);
		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.spec).toBe("my-spec");
		expect(deltas[0]?.operation).toBe("ADDED");
		expect(deltas[0]?.requirements).toHaveLength(1);
		expect(deltas[0]?.requirements?.[0]?.text).toContain("SHALL do the new thing");
		expect(deltas[0]?.requirements?.[0]?.scenarios).toHaveLength(1);
	});

	it("parses MODIFIED Requirements section into deltas", () => {
		const content = `## MODIFIED Requirements
### Requirement: Existing
The system SHALL now behave differently.
`;
		const deltas = parseSpecDeltas("my-spec", content);
		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.operation).toBe("MODIFIED");
		expect(deltas[0]?.requirements?.[0]?.text).toContain("SHALL now behave differently");
	});

	it("parses REMOVED Requirements section (no requirements body needed)", () => {
		const content = `## REMOVED Requirements
### Requirement: DeprecatedFeature
`;
		const deltas = parseSpecDeltas("my-spec", content);
		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.operation).toBe("REMOVED");
		// REMOVED requirements may include the header name as requirement text
		// (text may not pass SHALL/MUST validation at schema level — that's expected)
		expect(deltas[0]?.requirements).toBeDefined();
	});

	it("parses RENAMED Requirements section", () => {
		const content = `## RENAMED Requirements
- FROM: \`### Requirement: OldName\`
- TO: \`### Requirement: NewName\`
`;
		const deltas = parseSpecDeltas("my-spec", content);
		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.operation).toBe("RENAMED");
		expect(deltas[0]?.rename).toBeDefined();
		expect(deltas[0]?.rename).toEqual({ from: "OldName", to: "NewName" });
	});

	it("creates one delta per requirement in ADDED section", () => {
		const content = `## ADDED Requirements
### Requirement: First
The system SHALL do first.

### Requirement: Second
The system SHALL do second.
`;
		const deltas = parseSpecDeltas("multi-spec", content);
		expect(deltas).toHaveLength(2);
		expect(deltas[0]?.requirements?.[0]?.text).toContain("SHALL do first");
		expect(deltas[1]?.requirements?.[0]?.text).toContain("SHALL do second");
	});

	it("returns empty array for content with no delta sections", () => {
		const content = `## Other Section
Some content.
`;
		const deltas = parseSpecDeltas("my-spec", content);
		expect(deltas).toHaveLength(0);
	});

	it("handles multiple section types in one spec file", () => {
		const content = `## ADDED Requirements
### Requirement: NewOne
The system SHALL do new.

## REMOVED Requirements
### Requirement: OldOne
`;
		const deltas = parseSpecDeltas("combo", content);
		expect(deltas).toHaveLength(2);
		expect(deltas[0]?.operation).toBe("ADDED");
		expect(deltas[1]?.operation).toBe("REMOVED");
	});
});

// ─── AC #7: Code-fence masking prevents false header matches ───

describe("code-fence masking", () => {
	it("ignores delta headers inside fenced code blocks in change parsing", () => {
		const content = `# Test Change

## Why
We need to handle code fences.

## What Changes
Some changes.

\`\`\`markdown
## ADDED Requirements
### Requirement: Example
The system SHALL ...
\`\`\`
`;
		const change = parseChange(content);
		// If deltas were parsed from the fenced block, there would be a delta
		expect(change.deltas).toHaveLength(0);
	});

	it("ignores requirement headers inside fenced code blocks in spec delta parsing", () => {
		const content = `## ADDED Requirements
### Requirement: Real
The system SHALL work.

\`\`\`
## ADDED Requirements
### Requirement: Fake
The system SHALL not appear.
\`\`\`
`;
		const deltas = parseSpecDeltas("test-spec", content);
		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.requirements).toHaveLength(1);
		expect(deltas[0]?.requirements?.[0]?.text).toContain("SHALL work");
	});

	it("handles tilde-style code fences", () => {
		const content = `## ADDED Requirements
### Requirement: Real
The system SHALL work.

~~~
## ADDED Requirements
### Requirement: Fake
The system SHALL not appear.
~~~
`;
		const deltas = parseSpecDeltas("tilde-spec", content);
		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.requirements?.[0]?.text).toContain("SHALL work");
	});
});

// ─── AC #8: CRLF line endings ───

describe("CRLF line endings", () => {
	it("extractRequirementsSection handles \\r\\n", () => {
		const crlf = "## Requirements\r\n### Requirement: Foo\r\nThe system SHALL foo.\r\n";
		const result = extractRequirementsSection(crlf);
		expect(result.bodyBlocks).toHaveLength(1);
		expect(result.bodyBlocks[0]?.name).toBe("Foo");
	});

	it("parseDeltaSpec handles \\r\\n", () => {
		const crlf = "## ADDED Requirements\r\n### Requirement: Bar\r\nThe system SHALL bar.\r\n";
		const result = parseDeltaSpec(crlf);
		expect(result.added).toHaveLength(1);
		expect(result.added[0]?.name).toBe("Bar");
	});

	it("parseChange handles \\r\\n", () => {
		const crlf = [
			"# CRLF Change",
			"",
			"## Why",
			"Reasons on Windows editors should parse like POSIX.",
			"",
			"## What Changes",
			"- **alpha:** Add cross-platform parsing coverage",
		].join("\r\n");
		const change = parseChange(crlf);
		expect(change.why).toContain("Windows editors should parse");
		expect(change.deltas).toHaveLength(1);
		expect(change.deltas[0]?.spec).toBe("alpha");
	});

	it("parseSpecDeltas handles \\r\\n", () => {
		const crlf = "## ADDED Requirements\r\n### Requirement: CRLF\r\nThe system SHALL work with CRLF.\r\n";
		const deltas = parseSpecDeltas("crlf-spec", crlf);
		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.requirements?.[0]?.text).toContain("SHALL work with CRLF");
	});
});
