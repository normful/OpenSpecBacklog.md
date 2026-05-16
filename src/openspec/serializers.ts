/**
 * Markdown serializers for OpenSpec delta spec files.
 * Builds delta spec.md content from individual requirement/rename entries.
 *
 * Inverse of parseDeltaSpec() — used by `backlog change delta add` etc.
 */

import type { DeltaOperation } from "./schemas/index.ts";

// ─── Delta entry types ───

export interface DeltaAddEntry {
	operation: DeltaOperation;
	name: string;
	/** Requirement statement (for ADDED/MODIFIED) */
	statement?: string;
	/** Scenario raw block text (for ADDED/MODIFIED) */
	scenarioRawText?: string;
	/** Rename from/to (for RENAMED) */
	renameFrom?: string;
	renameTo?: string;
}

/**
 * Parsed section info returned by locateSection.
 */
export interface SectionInfo {
	exists: boolean;
	sectionBody: string;
	before: string;
	after: string;
}

// ─── Helpers ───

function normalizeLineEndings(content: string): string {
	return content.replace(/\r\n?/g, "\n");
}

function escapeBackticks(text: string): string {
	return text.replace(/`/g, "\\`");
}

/**
 * Build the requirement body lines under a ### Requirement: header.
 */
function buildRequirementBody(statement: string, scenarioRawText?: string): string {
	if (!scenarioRawText) {
		return statement;
	}
	return `${statement}\n\n${scenarioRawText}`;
}

/**
 * Build the markdown block for a single delta entry (without the section header).
 */
export function buildDeltaEntryBody(entry: DeltaAddEntry): string {
	switch (entry.operation) {
		case "ADDED":
		case "MODIFIED": {
			const body = entry.statement ? buildRequirementBody(entry.statement, entry.scenarioRawText) : "TBD";
			return `### Requirement: ${entry.name}\n${body}`;
		}
		case "REMOVED":
			return `### Requirement: ${entry.name}`;
		case "RENAMED": {
			const from = escapeBackticks(entry.renameFrom ?? entry.name);
			const to = escapeBackticks(entry.renameTo ?? "");
			return `- FROM: \`### Requirement: ${from}\`\n- TO: \`### Requirement: ${to}\``;
		}
	}
}

/**
 * Locate a delta section (`## <OP> Requirements`) in a spec.md content string.
 * Returns before/sectionBody/after split around the section.
 */
export function locateSection(content: string, operation: DeltaOperation): SectionInfo {
	const sectionHeader = new RegExp(`^##\\s+${operation}\\s+Requirements\\s*$`, "im");
	const normalized = normalizeLineEndings(content);
	const lines = normalized.split("\n");

	const headerIndex = lines.findIndex((l) => sectionHeader.test(l));

	if (headerIndex === -1) {
		return { exists: false, sectionBody: "", before: normalized, after: "" };
	}

	// Find end: next ## section or EOF
	let endIndex = lines.length;
	for (let i = headerIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line !== undefined && /^##\s+/.test(line)) {
			endIndex = i;
			break;
		}
	}

	const before = lines.slice(0, headerIndex).join("\n");
	const sectionBody = lines
		.slice(headerIndex + 1, endIndex)
		.join("\n")
		.trim();
	const after = lines.slice(endIndex).join("\n");

	return { exists: true, sectionBody, before, after };
}

// Canonical ordering of delta sections in spec.md files
const SECTION_ORDER: DeltaOperation[] = ["ADDED", "MODIFIED", "REMOVED", "RENAMED"];

/**
 * Find the insertion point for a new section with the given operation.
 * Scans through lines to find the first section header that should come
 * after our operation in canonical order, and inserts before it.
 */
function findInsertionPoint(content: string, operation: DeltaOperation): { before: string; after: string } {
	const opIndex = SECTION_ORDER.indexOf(operation);
	if (opIndex === -1) {
		return { before: content, after: "" };
	}

	const normalized = normalizeLineEndings(content);
	const SECTION_HEADER_RE = /^##\s+\w+\s+Requirements\s*$/i;

	// Collect all section headers in order of appearance
	const headers: Array<{ line: number; op: string }> = [];
	for (const [i, line] of normalized.split("\n").entries()) {
		if (SECTION_HEADER_RE.test(line)) {
			const m = line.match(/^##\s+(\w+)\s+Requirements\s*$/i);
			if (m?.[1]) {
				headers.push({ line: i, op: m[1].toUpperCase() });
			}
		}
	}

	// Scan headers to find first one that comes after our op in canonical order
	for (const h of headers) {
		const hIndex = SECTION_ORDER.indexOf(h.op as DeltaOperation);
		if (hIndex > opIndex) {
			// Insert right before this section
			const before = normalized.split("\n").slice(0, h.line).join("\n");
			const after = normalized.split("\n").slice(h.line).join("\n");
			return { before, after };
		}
	}

	// All existing sections come before ours — insert after the last one
	if (headers.length > 0) {
		const lastHeader = headers[headers.length - 1];
		if (lastHeader) {
			// Find end of last header's section
			const lines = normalized.split("\n");
			let endIdx = lines.length;
			for (let i = lastHeader.line + 1; i < lines.length; i++) {
				const line = lines[i];
				if (line !== undefined && SECTION_HEADER_RE.test(line)) {
					endIdx = i;
					break;
				}
			}
			const before = lines.slice(0, endIdx).join("\n");
			const after = lines.slice(endIdx).join("\n");
			return { before, after };
		}
	}

	// No sections exist — insertion at EOF
	return { before: content, after: "" };
}

/**
 * Build the full markdown content for a delta spec file, inserting a new
 * delta entry into the appropriate section. Creates the section header if
 * it doesn't exist. Sections are always ordered: ADDED → MODIFIED → REMOVED → RENAMED.
 *
 * @param existingContent - Current spec.md content (may be empty string)
 * @param entry - The delta entry to add
 * @returns The new full markdown content
 */
export function buildDeltaSpecWithEntry(existingContent: string, entry: DeltaAddEntry): string {
	const sectionKey = `## ${entry.operation} Requirements`;
	const entryBody = buildDeltaEntryBody(entry);

	const { exists, sectionBody, before, after } = locateSection(existingContent, entry.operation);

	if (exists) {
		// Section exists — append entry to its body
		const sep = sectionBody ? "\n\n" : "";
		return `${before}\n${sectionKey}\n${sectionBody}${sep}${entryBody}\n${after}`;
	}

	// Section doesn't exist — insert in canonical order
	const { before: insBefore, after: insAfter } = findInsertionPoint(existingContent, entry.operation);
	const sectionBlock = `${sectionKey}\n${entryBody}\n`;

	// Determine separator between insBefore and sectionBlock
	const needsLeadingNewline = insBefore.length > 0 && !insBefore.endsWith("\n") && !insBefore.endsWith("\n\n");
	const separator = needsLeadingNewline ? "\n\n" : insBefore.length > 0 ? "\n" : "";

	return `${insBefore}${separator}${sectionBlock}${insAfter}`;
}

/**
 * Remove a delta entry from the spec file content by its flat index (1-based).
 * The index counts across all sections in canonical order (ADDED → MODIFIED →
 * REMOVED → RENAMED), with each section's entries numbered sequentially.
 *
 * @returns The updated content, or null if index is out of range.
 */
export function removeDeltaByIndex(content: string, index: number): string | null {
	if (index < 1) {
		return null;
	}

	const normalized = normalizeLineEndings(content);
	let remaining = index;

	// Process sections in canonical order
	for (const op of SECTION_ORDER) {
		const { exists, sectionBody, before, after } = locateSection(normalized, op);
		if (!exists || !sectionBody) {
			continue;
		}

		// Parse entries in this section body
		const entries = parseSectionEntries(sectionBody, op);

		if (remaining <= entries.length) {
			// Found the entry to remove
			const entryIndex = remaining - 1;
			const entry = entries[entryIndex];
			if (entry === undefined) {
				return null;
			}

			// Remove the entry from section body
			const newSectionBody = entries
				.filter((_, i) => i !== entryIndex)
				.map((e) => e.raw)
				.join("\n\n");

			// Rebuild content
			let newContent: string;
			if (newSectionBody.trim()) {
				newContent = `${before}\n## ${op} Requirements\n${newSectionBody}\n${after}`;
			} else {
				// Section is now empty — remove the section header too
				newContent = `${before}\n${after}`;
				// Clean up excessive blank lines
				newContent = newContent.replace(/\n{3,}/g, "\n\n");
			}

			return `${newContent.trimEnd()}\n`;
		}

		remaining -= entries.length;
	}

	return null;
}

/**
 * Parse entries within a section body, returning the raw text and the
 * header name (or rename from/to for RENAMED sections).
 */
interface SectionEntry {
	raw: string;
	name: string;
}

function parseSectionEntries(sectionBody: string, operation: DeltaOperation): SectionEntry[] {
	const trimmed = sectionBody.trim();
	if (!trimmed) {
		return [];
	}

	if (operation === "RENAMED") {
		// RENAMED entries are FROM/TO pairs separated by blank lines
		const blocks = trimmed.split(/\n\n+/);
		return blocks
			.filter((b) => b.trim())
			.map((block) => {
				const fromMatch = block.match(/FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/im);
				const name = fromMatch?.[1]?.trim() ?? "(unnamed rename)";
				return { raw: block.trim(), name };
			});
	}

	// For ADDED/MODIFIED/REMOVED: split on ### Requirement: headers
	const entries: SectionEntry[] = [];
	const parts = trimmed.split(/(?=^###\s*Requirement:\s)/im);

	for (const part of parts) {
		const p = part.trim();
		if (!p) continue;
		const headerMatch = p.match(/^###\s*Requirement:\s*(.+)$/im);
		const name = headerMatch?.[1]?.trim() ?? "(unnamed)";
		entries.push({ raw: p, name });
	}

	return entries;
}
