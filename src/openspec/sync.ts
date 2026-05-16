/**
 * Sync pipeline for applying delta specs to main spec files.
 * Pure logic — no CLI imports, no side effects.
 *
 * Reads delta spec files from backlog/changes/<name>/specs/<spec>/spec.md,
 * parses them with parseDeltaSpec(), and applies each delta to the corresponding
 * main spec at backlog/specs/<spec>/spec.md.
 */

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { extractRequirementsSection, parseDeltaSpec } from "../openspec/parsers/index.ts";
import { SpecSchema } from "../openspec/schemas/index.ts";

// ─── Types ───

export interface SyncOptions {
	dryRun?: boolean;
}

// ─── Internal helpers ───

/**
 * Find the 1-based line number of a text snippet within larger content.
 * Returns -1 if not found (uses exact substring match).
 */
function findLineNumber(content: string, text: string): number {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line?.includes(text)) {
			return i + 1;
		}
	}
	return -1;
}

// ─── Types ───

export interface SyncOptions {
	dryRun?: boolean;
}

// ─── Internal helpers ───

/**
 * Escape special regex characters in a string for literal matching.
 */
function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate spec content from spec.md against SpecSchema.
 * Returns array of error strings (empty = valid).
 */
function validateSpecContent(content: string, name: string): string[] {
	const errors: string[] = [];

	const purposeMatch = content.match(/^## Purpose\s*\n([\s\S]*?)(?=\n## |$)/m);
	const purposeText = purposeMatch?.[1]?.trim() ?? "";

	const requirementsSection = extractRequirementsSection(content);

	const specInput: Record<string, unknown> = {
		name,
		overview: purposeText,
		requirements: requirementsSection.bodyBlocks.map((block) => {
			// Extract requirement text from the first non-header content line,
			// falling back to the header name if no content follows.
			const lines = block.raw.split("\n").filter((l) => l.trim());
			const firstLine = lines.length > 1 ? lines[1]!.trim() : "";
			const text = firstLine || block.name;

			const scenarioTexts = (block.raw.match(/#### Scenario:.*\n([\s\S]*?)(?=\n#### |\n### |$)/gi) ?? []).map((s) =>
				s.replace(/^#### Scenario:.*\n/i, "").trim(),
			);
			return {
				text,
				scenarios: scenarioTexts.map((rawText: string) => ({ rawText })),
			};
		}),
	};

	const result = SpecSchema.safeParse(specInput);
	if (!result.success) {
		for (const issue of result.error.issues) {
			const pathStr = issue.path.join(".");
			const line = findLineNumber(content, purposeMatch?.[1] ?? "");
			const lineInfo = line !== -1 ? ` (line ${line})` : "";
			errors.push(`  - ${pathStr}: ${issue.message}${lineInfo}`);
		}
	}

	return errors;
}

/**
 * Find the line range (start inclusive, end exclusive) of a requirement block
 * identified by its header name (case-insensitive match).
 * Returns [startLine, endLine] or null if not found.
 */
function findRequirementRange(content: string, name: string): [number, number] | null {
	const headerRegex = new RegExp(`^### Requirement:\\s*${escapeRegex(name)}\\s*$`, "im");
	const match = content.match(headerRegex);
	if (!match || match.index === undefined) {
		return null;
	}

	const lines = content.split("\n");
	const startLine = content.slice(0, match.index).split("\n").length - 1;
	let endLine = lines.length;
	for (let i = startLine + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		if (/^###\s/.test(line) || /^##\s/.test(line)) {
			endLine = i;
			break;
		}
	}
	return [startLine, endLine];
}

// ─── Core sync functions (testable, no CLI deps) ───

/**
 * Apply ADDED delta: append a new requirement block to ## Requirements.
 * Creates the spec skeleton if content is empty.
 */
export function applyAdded(content: string, blockRaw: string): { content: string; applied: boolean } {
	let result = content;
	if (!result.includes("## Purpose")) {
		result = `${result.trimEnd()}\n\n## Purpose\n\nTBD.\n`;
	}
	if (!result.includes("## Requirements")) {
		result = `${result.trimEnd()}\n\n## Requirements\n`;
	}

	const sep = result.trimEnd().endsWith("\n") ? "" : "\n";
	return { content: `${result.trimEnd()}${sep}\n\n${blockRaw}\n`, applied: true };
}

/**
 * Apply MODIFIED delta: find requirement by header name (case-insensitive)
 * and replace the entire block including body.
 */
export function applyModified(
	content: string,
	headerName: string,
	blockRaw: string,
): { content: string; applied: boolean; notFound?: boolean } {
	const range = findRequirementRange(content, headerName);
	if (!range) {
		return { content, applied: false, notFound: true };
	}

	const [startLine, endLine] = range;
	const lines = content.split("\n");
	const before = lines.slice(0, startLine).join("\n");
	const after = lines.slice(endLine).join("\n");

	const sep = before && !before.endsWith("\n") ? "\n" : "";
	return { content: `${before}${sep}\n${blockRaw}\n${after}`, applied: true };
}

/**
 * Apply REMOVED delta: find requirement by header name (case-insensitive)
 * and remove the entire block including body.
 */
export function applyRemoved(
	content: string,
	headerName: string,
): { content: string; applied: boolean; notFound?: boolean } {
	const range = findRequirementRange(content, headerName);
	if (!range) {
		return { content, applied: false, notFound: true };
	}

	const [startLine, endLine] = range;
	const lines = content.split("\n");
	const before = lines.slice(0, startLine).join("\n");
	const after = lines.slice(endLine).join("\n");

	const trimmed = before.trimEnd();
	return { content: `${trimmed}\n${after}`, applied: true };
}

/**
 * Apply RENAMED delta: find requirement header by old name (case-insensitive)
 * and replace it with new name, preserving body content.
 */
export function applyRenamed(
	content: string,
	oldName: string,
	newName: string,
): { content: string; applied: boolean; notFound?: boolean } {
	const oldHeaderRegex = new RegExp(`^(### Requirement:)\\s*${escapeRegex(oldName)}\\s*$`, "im");
	return {
		content: content.replace(oldHeaderRegex, `### Requirement: ${newName}`),
		applied: true,
	};
}

/**
 * Sync deltas from a change's delta specs to main spec files.
 *
 * @param changeName - Name of the change
 * @param projectRoot - Project root path
 * @param options - Sync options (dryRun)
 * @returns Summary string describing what was done
 */
export async function syncSpecs(changeName: string, projectRoot: string, options: SyncOptions): Promise<string> {
	const isDryRun = options.dryRun ?? false;
	const changePath = join(projectRoot, "backlog", "changes", changeName);

	if (!existsSync(changePath)) {
		return `Change "${changeName}" not found.`;
	}

	const specsDir = join(changePath, "specs");
	if (!existsSync(specsDir)) {
		return `No delta specs found for change "${changeName}".`;
	}

	const specDirs = await readdir(specsDir);
	if (specDirs.length === 0) {
		return `No delta specs found for change "${changeName}".`;
	}

	const perSpecResults: Array<{ spec: string; applied: number; errors: string[] }> = [];
	let totalDeltas = 0;
	let totalApplied = 0;

	for (const specName of specDirs) {
		const specFilePath = join(specsDir, specName, "spec.md");
		if (!existsSync(specFilePath)) continue;

		const specContent = readFileSync(specFilePath, "utf-8");
		const deltaPlan = parseDeltaSpec(specContent);

		const addedCount =
			deltaPlan.added.length + deltaPlan.modified.length + deltaPlan.removed.length + deltaPlan.renamed.length;

		if (addedCount === 0) continue;

		totalDeltas += addedCount;
		const specErrors: string[] = [];
		let specApplied = 0;

		const mainSpecPath = join(projectRoot, "backlog", "specs", specName, "spec.md");
		const specWasNew = !existsSync(mainSpecPath);
		const mainContent = specWasNew ? "" : readFileSync(mainSpecPath, "utf-8");

		let backedUp = false;
		let working = mainContent;
		let hasChanges = false;

		// 1. ADDED
		for (const block of deltaPlan.added) {
			const result = applyAdded(working, block.raw);
			if (result.applied) {
				if (!working) backedUp = true;
				working = result.content;
				hasChanges = true;
				specApplied++;
			}
		}

		// 2. MODIFIED
		for (const block of deltaPlan.modified) {
			const result = applyModified(working, block.name, block.raw);
			if (result.applied) {
				if (!working) backedUp = true;
				working = result.content;
				hasChanges = true;
				specApplied++;
			} else if (result.notFound) {
				specErrors.push(`Requirement "${block.name}" not found in spec "${specName}"`);
			}
		}

		// 3. REMOVED
		for (const name of deltaPlan.removed) {
			const result = applyRemoved(working, name);
			if (result.applied) {
				if (!working) backedUp = true;
				working = result.content;
				hasChanges = true;
				specApplied++;
			} else if (result.notFound) {
				specErrors.push(`Requirement "${name}" not found in spec "${specName}"`);
			}
		}

		// 4. RENAMED
		for (const rename of deltaPlan.renamed) {
			const result = applyRenamed(working, rename.from, rename.to);
			if (result.applied) {
				if (!working) backedUp = true;
				working = result.content;
				hasChanges = true;
				specApplied++;
			}
		}

		// Validate
		const validationErrors = validateSpecContent(working, specName);
		if (validationErrors.length > 0) {
			for (const err of validationErrors) {
				specErrors.push(`Validation error: ${err}`);
			}
		}

		// Write
		if (!isDryRun && hasChanges) {
			if (!specWasNew && !backedUp && mainContent) {
				copyFileSync(mainSpecPath, `${mainSpecPath}.bak`);
			}

			const mainSpecDir = join(projectRoot, "backlog", "specs", specName);
			await mkdir(mainSpecDir, { recursive: true });
			await writeFile(mainSpecPath, working, "utf-8");
		}

		totalApplied += specApplied;
		perSpecResults.push({ spec: specName, applied: specApplied, errors: specErrors });
	}

	if (totalDeltas === 0) {
		return `No deltas found for change "${changeName}".`;
	}

	const summaryLines: string[] = [];
	if (isDryRun) {
		summaryLines.push(`[dry run] Would sync ${totalDeltas} delta(s) from change "${changeName}":`);
	} else {
		summaryLines.push(`Synced ${totalApplied} delta(s) from change "${changeName}":`);
	}

	for (const r of perSpecResults) {
		if (r.applied > 0) {
			const created = isDryRun
				? ""
				: !existsSync(join(projectRoot, "backlog", "specs", r.spec, "spec.md"))
					? " (created)"
					: "";
			summaryLines.push(`  ${r.spec}: ${r.applied} delta(s) applied${created}`);
		}
		for (const err of r.errors) {
			summaryLines.push(`  ${r.spec}: ${err}`);
		}
	}

	return summaryLines.join("\n");
}
