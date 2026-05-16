/**
 * Markdown parsers for OpenSpec Requirement blocks and delta sections.
 * Ported from OpenSpec: `src/core/parsers/requirement-blocks.ts`
 *
 * Parses:
 * - `### Requirement:` headers within `## Requirements` sections
 * - Delta sections: `## ADDED/MODIFIED/REMOVED/RENAMED Requirements`
 *
 * Independent of Zod schemas — uses its own types (RequirementBlock, DeltaPlan)
 * for raw markdown parse results.
 */

// ─── Types ───

export interface RequirementBlock {
	/** Full header line, e.g. '### Requirement: Something' */
	headerLine: string;
	/** Extracted name, e.g. 'Something' */
	name: string;
	/** Full block including header line and following content */
	raw: string;
}

export interface RequirementsSectionParts {
	/** Content before the `## Requirements` header */
	before: string;
	/** The `## Requirements` header line itself */
	headerLine: string;
	/** Content between header line and first requirement block */
	preamble: string;
	/** Parsed requirement blocks in order */
	bodyBlocks: RequirementBlock[];
	/** Content after the requirements section */
	after: string;
}

export interface DeltaPlan {
	added: RequirementBlock[];
	modified: RequirementBlock[];
	removed: string[];
	renamed: Array<{ from: string; to: string }>;
	sectionPresence: {
		added: boolean;
		modified: boolean;
		removed: boolean;
		renamed: boolean;
	};
}

// ─── Regex ───

const REQUIREMENT_HEADER_REGEX = /^###\s*Requirement:\s*(.+)\s*$/i;
const REQUIREMENTS_SECTION_HEADER = /^##\s+Requirements\s*$/i;
const NEXT_TOP_LEVEL_HEADER = /^##\s+/;

// ─── Helpers ───

function normalizeLineEndings(content: string): string {
	return content.replace(/\r\n?/g, "\n");
}

export function normalizeRequirementName(name: string): string {
	return name.trim();
}

/**
 * Split content into top-level (##) sections.
 * Returns a map of section title → body content.
 */
function splitTopLevelSections(content: string): Record<string, string> {
	const lines = content.split("\n");
	const result: Record<string, string> = {};
	const indices: Array<{ title: string; index: number }> = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const m = line.match(/^(##)\s+(.+)$/);
		if (m?.[2]) {
			indices.push({ title: m[2].trim(), index: i });
		}
	}

	for (let i = 0; i < indices.length; i++) {
		const current = indices[i];
		if (current === undefined) continue;
		const next = indices[i + 1];
		const body = lines.slice(current.index + 1, next ? next.index : lines.length).join("\n");
		result[current.title] = body;
	}

	return result;
}

function getSectionCaseInsensitive(
	sections: Record<string, string>,
	desired: string,
): { body: string; found: boolean } {
	const target = desired.toLowerCase();
	for (const [title, body] of Object.entries(sections)) {
		if (title.toLowerCase() === target) {
			return { body, found: true };
		}
	}
	return { body: "", found: false };
}

function parseRequirementBlocksFromSection(sectionBody: string): RequirementBlock[] {
	if (!sectionBody) {
		return [];
	}

	const lines = normalizeLineEndings(sectionBody).split("\n");
	const blocks: RequirementBlock[] = [];
	let i = 0;

	while (i < lines.length) {
		// Seek next requirement header
		while (i < lines.length) {
			const line = lines[i];
			if (line !== undefined && REQUIREMENT_HEADER_REGEX.test(line)) {
				break;
			}
			i++;
		}

		if (i >= lines.length) {
			break;
		}

		const headerLine = lines[i] as string;
		const m = headerLine.match(REQUIREMENT_HEADER_REGEX);
		if (!m?.[1]) {
			i++;
			continue;
		}

		const name = normalizeRequirementName(m[1]);
		const buf: string[] = [headerLine];
		i++;

		while (i < lines.length) {
			const line = lines[i];
			if (line === undefined || REQUIREMENT_HEADER_REGEX.test(line) || NEXT_TOP_LEVEL_HEADER.test(line)) {
				break;
			}
			buf.push(line);
			i++;
		}

		blocks.push({ headerLine, name, raw: buf.join("\n").trimEnd() });
	}

	return blocks;
}

function parseRemovedNames(sectionBody: string): string[] {
	if (!sectionBody) {
		return [];
	}

	const names: string[] = [];
	const lines = normalizeLineEndings(sectionBody).split("\n");

	for (const line of lines) {
		const m = line?.match(REQUIREMENT_HEADER_REGEX);
		if (m?.[1]) {
			names.push(normalizeRequirementName(m[1]));
		}
	}

	return names;
}

function parseRenamedPairs(sectionBody: string): Array<{ from: string; to: string }> {
	if (!sectionBody) {
		return [];
	}

	const pairs: Array<{ from: string; to: string }> = [];
	const lines = normalizeLineEndings(sectionBody).split("\n");
	let current: { from?: string; to?: string } = {};

	for (const line of lines) {
		const fromMatch = line?.match(/^\s*-?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
		const toMatch = line?.match(/^\s*-?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);

		if (fromMatch?.[1]) {
			current.from = normalizeRequirementName(fromMatch[1]);
		} else if (toMatch?.[1]) {
			current.to = normalizeRequirementName(toMatch[1]);
			if (current.from && current.to) {
				pairs.push({ from: current.from, to: current.to });
				current = {};
			}
		}
	}

	return pairs;
}

// ─── Public API ───

/**
 * Extract the `## Requirements` section from a spec file and parse requirement blocks.
 * If the section is missing, creates an empty one appended to the content.
 */
export function extractRequirementsSection(content: string): RequirementsSectionParts {
	const normalized = normalizeLineEndings(content);
	const lines = normalized.split("\n");
	const reqHeaderIndex = lines.findIndex((l) => REQUIREMENTS_SECTION_HEADER.test(l));

	if (reqHeaderIndex === -1) {
		const before = content.trimEnd();
		const headerLine = "## Requirements";
		return {
			before: before ? `${before}\n\n` : "",
			headerLine,
			preamble: "",
			bodyBlocks: [],
			after: "\n",
		};
	}

	// Find end of this section: next line that starts with '## ' at same or higher level
	let endIndex = lines.length;
	for (let i = reqHeaderIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line !== undefined && NEXT_TOP_LEVEL_HEADER.test(line)) {
			endIndex = i;
			break;
		}
	}

	const before = lines.slice(0, reqHeaderIndex).join("\n");
	const headerLine = lines[reqHeaderIndex] as string;
	const sectionBodyLines = lines.slice(reqHeaderIndex + 1, endIndex);

	// Parse requirement blocks within section body
	const blocks: RequirementBlock[] = [];
	let cursor = 0;
	const preambleLines: string[] = [];

	// Collect preamble lines until first requirement header
	while (cursor < sectionBodyLines.length) {
		const line = sectionBodyLines[cursor];
		if (line !== undefined && REQUIREMENT_HEADER_REGEX.test(line)) {
			break;
		}
		preambleLines.push(line ?? "");
		cursor++;
	}

	while (cursor < sectionBodyLines.length) {
		const headerLineCandidate = sectionBodyLines[cursor] as string;
		const headerMatch = headerLineCandidate.match(REQUIREMENT_HEADER_REGEX);
		if (!headerMatch?.[1]) {
			cursor++;
			continue;
		}

		const name = normalizeRequirementName(headerMatch[1]);
		cursor++;

		// Gather lines until next requirement header or end of section
		const bodyLines: string[] = [headerLineCandidate];
		while (cursor < sectionBodyLines.length) {
			const line = sectionBodyLines[cursor];
			if (line === undefined || REQUIREMENT_HEADER_REGEX.test(line) || NEXT_TOP_LEVEL_HEADER.test(line)) {
				break;
			}
			bodyLines.push(line);
			cursor++;
		}

		const raw = bodyLines.join("\n").trimEnd();
		blocks.push({ headerLine: headerLineCandidate, name, raw });
	}

	const after = lines.slice(endIndex).join("\n");
	const preamble = preambleLines.join("\n").trimEnd();

	return {
		before: before.trimEnd() ? `${before}\n` : before,
		headerLine,
		preamble,
		bodyBlocks: blocks,
		after: after.startsWith("\n") ? after : `\n${after}`,
	};
}

/**
 * Parse delta-formatted spec change content into a DeltaPlan with raw blocks.
 * Recognizes ADDED/MODIFIED/REMOVED/RENAMED Requirements sections case-insensitively.
 */
export function parseDeltaSpec(content: string): DeltaPlan {
	const normalized = normalizeLineEndings(content);
	const sections = splitTopLevelSections(normalized);

	const addedLookup = getSectionCaseInsensitive(sections, "ADDED Requirements");
	const modifiedLookup = getSectionCaseInsensitive(sections, "MODIFIED Requirements");
	const removedLookup = getSectionCaseInsensitive(sections, "REMOVED Requirements");
	const renamedLookup = getSectionCaseInsensitive(sections, "RENAMED Requirements");

	const added = parseRequirementBlocksFromSection(addedLookup.body);
	const modified = parseRequirementBlocksFromSection(modifiedLookup.body);
	const removedNames = parseRemovedNames(removedLookup.body);
	const renamedPairs = parseRenamedPairs(renamedLookup.body);

	return {
		added,
		modified,
		removed: removedNames,
		renamed: renamedPairs,
		sectionPresence: {
			added: addedLookup.found,
			modified: modifiedLookup.found,
			removed: removedLookup.found,
			renamed: renamedLookup.found,
		},
	};
}
