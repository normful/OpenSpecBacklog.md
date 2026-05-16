/**
 * Markdown parser for OpenSpec Change files (proposal.md) and delta spec files.
 * Ported from OpenSpec: `src/core/parsers/change-parser.ts` and `src/core/parsers/markdown-parser.ts`
 *
 * Parses:
 * - Change proposals: `## Why` and `## What Changes` sections
 * - Delta spec files: `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` sections
 * - Simple delta bullet lists: `- **spec:** Action description`
 *
 * Synchronous (no file I/O) — receives text content, returns parsed data.
 */

import type { Delta, DeltaOperation, Requirement, Scenario } from "../schemas/index.ts";

// ─── Types ───

export interface Section {
	level: number;
	title: string;
	content: string;
	children: Section[];
}

export interface ParsedChange {
	why: string;
	whatChanges: string;
	deltas: Delta[];
}

// ─── Regex ───

const HEADER_REGEX = /^(#{1,6})\s+(.+)$/;

// ─── Helpers ───

function normalizeContent(content: string): string {
	return content.replace(/\r\n?/g, "\n");
}

function buildCodeFenceMask(lines: string[]): boolean[] {
	const mask = new Array(lines.length).fill(false);
	let activeFence: { marker: "`" | "~"; length: number } | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);

		if (!activeFence) {
			if (fenceMatch?.[1]) {
				activeFence = {
					marker: fenceMatch[1][0] as "`" | "~",
					length: fenceMatch[1].length,
				};
				mask[i] = true;
			}
			continue;
		}

		mask[i] = true;

		const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
		if (closeMatch?.[1] && closeMatch[1][0] === activeFence.marker && closeMatch[1].length >= activeFence.length) {
			activeFence = null;
		}
	}

	return mask;
}

function findSection(sections: Section[], title: string): Section | undefined {
	for (const section of sections) {
		if (section.title.toLowerCase() === title.toLowerCase()) {
			return section;
		}
		const child = findSection(section.children, title);
		if (child) {
			return child;
		}
	}
	return undefined;
}

/**
 * Parse markdown content into a hierarchical section tree.
 * Headers inside fenced code blocks are ignored.
 */
function parseSections(content: string): Section[] {
	const normalizedContent = normalizeContent(content);
	const lines = normalizedContent.split("\n");
	const codeFenceLineMask = buildCodeFenceMask(lines);
	const sections: Section[] = [];
	const stack: Section[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;

		if (codeFenceLineMask[i]) {
			continue;
		}

		const headerMatch = line.match(HEADER_REGEX);
		if (!headerMatch?.[2]) {
			continue;
		}

		const level = headerMatch[1]?.length ?? 1;
		const title = headerMatch[2]?.trim() ?? "";
		const contentLines = getContentUntilNextHeader(lines, codeFenceLineMask, i + 1, level);

		const section: Section = {
			level,
			title,
			content: contentLines.join("\n").trim(),
			children: [],
		};

		while (stack.length > 0) {
			const top = stack[stack.length - 1];
			if (top === undefined || top.level < level) break;
			stack.pop();
		}

		if (stack.length === 0) {
			sections.push(section);
		} else {
			const parent = stack[stack.length - 1];
			if (parent !== undefined) {
				parent.children.push(section);
			}
		}

		stack.push(section);
	}

	return sections;
}

function getContentUntilNextHeader(
	lines: string[],
	codeFenceLineMask: boolean[],
	startLine: number,
	currentLevel: number,
): string[] {
	const contentLines: string[] = [];

	for (let i = startLine; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;

		if (!codeFenceLineMask[i]) {
			const headerMatch = line.match(/^(#{1,6})\s+/);
			const matchLevel = headerMatch?.[1]?.length ?? 0;
			if (matchLevel > 0 && matchLevel <= currentLevel) {
				break;
			}
		}

		contentLines.push(line);
	}

	return contentLines;
}

function parseRequirements(section: Section): Requirement[] {
	const requirements: Requirement[] = [];

	for (const child of section.children) {
		// Extract requirement text from first non-empty content line, fall back to heading
		let text: string = child.title ?? "";

		// Get content before any child sections (scenarios)
		if (child.content.trim()) {
			const lines = child.content.split("\n");
			const contentBeforeChildren: string[] = [];

			for (const line of lines) {
				if (line.trim().startsWith("#")) {
					break;
				}
				contentBeforeChildren.push(line);
			}

			const directContent = contentBeforeChildren.join("\n").trim();
			if (directContent) {
				const firstLine = directContent.split("\n").find((l) => l.trim());
				if (firstLine) {
					text = firstLine.trim();
				}
			}
		}

		const scenarios = parseScenarios(child);

		requirements.push({
			text,
			scenarios,
		});
	}

	return requirements;
}

function parseScenarios(requirementSection: Section): Scenario[] {
	const scenarios: Scenario[] = [];

	for (const scenarioSection of requirementSection.children) {
		if (scenarioSection.content.trim()) {
			scenarios.push({
				rawText: scenarioSection.content,
			});
		}
	}

	return scenarios;
}

/**
 * Parse a simple delta bullet list from What Changes section content.
 * Each bullet: `- **spec-name:** description` — operation inferred from description text.
 */
function parseDeltas(content: string): Delta[] {
	const deltas: Delta[] = [];
	const lines = content.split("\n");

	for (const line of lines) {
		if (line === undefined) continue;
		const deltaMatch = line.match(/^\s*-\s*\*\*([^*:]+)(?::\*\*|\*\*:)\s*(.+)$/);
		if (!deltaMatch) {
			continue;
		}

		const specName = deltaMatch[1]?.trim() ?? "";
		const description = deltaMatch[2]?.trim() ?? "";
		let operation: DeltaOperation = "MODIFIED";
		const lowerDesc = description.toLowerCase();

		if (/\brename(s|d|ing)?\b/.test(lowerDesc) || /\brenamed\s+(to|from)\b/.test(lowerDesc)) {
			operation = "RENAMED";
		} else if (
			/\badd(s|ed|ing)?\b/.test(lowerDesc) ||
			/\bcreate(s|d|ing)?\b/.test(lowerDesc) ||
			/\bnew\b/.test(lowerDesc)
		) {
			operation = "ADDED";
		} else if (/\bremove(s|d|ing)?\b/.test(lowerDesc) || /\bdelete(s|d|ing)?\b/.test(lowerDesc)) {
			operation = "REMOVED";
		}

		deltas.push({
			spec: specName,
			operation,
			description,
		});
	}

	return deltas;
}

/**
 * Parse rename FROM/TO pairs from a RENAMED section body.
 * Format: `- FROM: \`### Requirement: OldName\` \n - TO: \`### Requirement: NewName\``
 */
function parseRenames(content: string): Array<{ from: string; to: string }> {
	const renames: Array<{ from: string; to: string }> = [];
	const lines = normalizeContent(content).split("\n");
	let currentRename: { from?: string; to?: string } = {};

	for (const line of lines) {
		if (line === undefined) continue;
		const fromMatch = line.match(/^\s*-?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
		const toMatch = line.match(/^\s*-?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);

		if (fromMatch?.[1]) {
			currentRename.from = fromMatch[1].trim();
		} else if (toMatch?.[1]) {
			currentRename.to = toMatch[1].trim();
			if (currentRename.from && currentRename.to) {
				renames.push({
					from: currentRename.from,
					to: currentRename.to,
				});
				currentRename = {};
			}
		}
	}

	return renames;
}

// ─── Public API ───

/**
 * Parse a change proposal markdown content.
 * Extracts Why and What Changes sections, and parses deltas from the What Changes bullet list.
 *
 * @param content - Raw markdown text of the change proposal
 * @returns ParsedChange with why, whatChanges, and deltas
 */
export function parseChange(content: string): ParsedChange {
	const normalized = normalizeContent(content);
	const sections = parseSections(normalized);

	const whySection = findSection(sections, "Why");
	const whatChangesSection = findSection(sections, "What Changes");

	if (!whySection) {
		throw new Error("Change must have a Why section");
	}

	if (!whatChangesSection) {
		throw new Error("Change must have a What Changes section");
	}

	const why = whySection.content.trim();
	const whatChanges = whatChangesSection.content.trim();
	const deltas = parseDeltas(whatChanges);

	return {
		why,
		whatChanges,
		deltas,
	};
}

/**
 * Parse delta sections from a spec.md content file into Delta objects.
 * Handles ADDED/MODIFIED/REMOVED/RENAMED sections with hierarchical parsing and code-fence masking.
 *
 * @param specName - The spec name to assign to all resulting deltas
 * @param content - Raw markdown content of the spec file
 * @returns Array of Delta objects
 */
export function parseSpecDeltas(specName: string, content: string): Delta[] {
	const normalized = normalizeContent(content);
	const sections = parseSections(normalized);
	const deltas: Delta[] = [];

	// ADDED requirements
	const addedSection = findSection(sections, "ADDED Requirements");
	if (addedSection) {
		const requirements = parseRequirements(addedSection);
		for (const req of requirements) {
			deltas.push({
				spec: specName,
				operation: "ADDED",
				description: `Add requirement: ${req.text}`,
				requirements: [req],
			});
		}
	}

	// MODIFIED requirements
	const modifiedSection = findSection(sections, "MODIFIED Requirements");
	if (modifiedSection) {
		const requirements = parseRequirements(modifiedSection);
		for (const req of requirements) {
			deltas.push({
				spec: specName,
				operation: "MODIFIED",
				description: `Modify requirement: ${req.text}`,
				requirements: [req],
			});
		}
	}

	// REMOVED requirements
	const removedSection = findSection(sections, "REMOVED Requirements");
	if (removedSection) {
		const requirements = parseRequirements(removedSection);
		if (requirements.length > 0) {
			for (const req of requirements) {
				deltas.push({
					spec: specName,
					operation: "REMOVED",
					description: `Remove requirement: ${req.text}`,
					requirements: [req],
				});
			}
		} else {
			deltas.push({
				spec: specName,
				operation: "REMOVED",
				description: `Remove requirements from ${specName}`,
				requirements: [],
			});
		}
	}

	// RENAMED requirements
	const renamedSection = findSection(sections, "RENAMED Requirements");
	if (renamedSection) {
		const renames = parseRenames(renamedSection.content);
		for (const rename of renames) {
			deltas.push({
				spec: specName,
				operation: "RENAMED",
				description: `Rename requirement from "${rename.from}" to "${rename.to}"`,
				rename: { from: rename.from, to: rename.to },
			});
		}
	}

	return deltas;
}

// ─── Async file-reading convenience helpers ───

/**
 * Read and parse a change proposal from a file path.
 * Uses Bun.file() for file I/O.
 *
 * @param filePath - Path to the proposal.md file
 * @returns ParsedChange with why, whatChanges, and deltas
 */
export async function parseChangeFromFile(filePath: string): Promise<ParsedChange> {
	const content = await Bun.file(filePath).text();
	return parseChange(content);
}

/**
 * Read and parse delta sections from a spec.md file.
 * Uses Bun.file() for file I/O.
 *
 * @param specName - The spec name to assign to all resulting deltas
 * @param filePath - Path to the spec.md file
 * @returns Array of Delta objects
 */
export async function parseSpecDeltasFromFile(specName: string, filePath: string): Promise<Delta[]> {
	const content = await Bun.file(filePath).text();
	return parseSpecDeltas(specName, content);
}
