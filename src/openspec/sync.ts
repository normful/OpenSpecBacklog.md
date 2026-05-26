/**
 * Sync pipeline for applying change artifacts to published spec Documents.
 * Pure logic — no CLI imports, no side effects.
 *
 * Reads *.spec-delta.md and *.new-spec.md files from a change directory,
 * processes them, and writes/updates spec Documents in specs/.
 * Sync IS publish.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import matter from "gray-matter";
import { SPEC_FILENAME_PREFIX } from "../constants/index.ts";
import type { Core } from "../core/backlog.ts";
import { parseDocument, parseMarkdown } from "../markdown/parser.ts";
import { extractRequirementsSection, parseDeltaSpec } from "../openspec/parsers/index.ts";
import { validateSpec } from "../openspec/schemas/index.ts";
import type { Document } from "../types/index.ts";

// ─── Types ───

export interface SyncOptions {
	dryRun?: boolean;
}

export interface SyncSummary {
	deltaSpecs: Array<{ file: string; targetSpecId: string; applied: number; errors: string[] }>;
	newSpecs: Array<{ file: string; specDocId: string; errors: string[] }>;
}

// ─── Internal helpers (reused from original sync.ts) ───

/**
 * Find the 1-based line number of a text snippet within larger content.
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

/**
 * Escape special regex characters in a string for literal matching.
 */
function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate spec content against SpecSchema.
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
			const lines = block.raw.split("\n").filter((l) => l.trim());
			const firstLine = lines.length > 1 ? (lines[1]?.trim() ?? "") : "";
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

	const result = validateSpec(specInput);
	if (!result.success) {
		for (const issue of result.error.issues) {
			const pathStr = issue.path;
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

// ─── Delta application functions (unchanged from original) ───

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

// ─── Frontmatter update helper ───

/**
 * Update sync_status in frontmatter of a markdown file, preserving all other
 * frontmatter fields (including custom ones like target_spec_id that are not
 * part of the Document interface).
 */
async function updateSyncStatus(filePath: string, newStatus: "pending" | "synced"): Promise<void> {
	const content = readFileSync(filePath, "utf-8");
	// Parse with gray-matter to preserve all frontmatter fields (including custom ones
	// like target_spec_id that are not part of the Document interface)
	const parsed = matter(content);
	const result = matter.stringify(parsed.content, { ...parsed.data, sync_status: newStatus });
	await writeFile(filePath, result, "utf-8");
}

/**
 * Read a Document's raw content from a file path.
 */
function readDocumentFromFile(filePath: string): Document {
	const content = readFileSync(filePath, "utf-8");
	return parseDocument(content);
}

// ─── spec-delta processing ───

async function processSpecDelta(
	deltaFilePath: string,
	core: Core,
	changePath: string,
	specsDir: string,
	isDryRun: boolean,
): Promise<{ file: string; targetSpecId: string; applied: number; errors: string[] }> {
	const fileName = basename(deltaFilePath);
	const errors: string[] = [];
	let applied = 0;

	// Parse the spec-delta Document and extract target_spec_id from raw frontmatter
	let deltaDoc: Document;
	let targetSpecId: string | undefined;
	try {
		deltaDoc = readDocumentFromFile(deltaFilePath);
		// Parse raw frontmatter to extract target_spec_id (not part of the Document interface)
		const { frontmatter } = parseMarkdown(readFileSync(deltaFilePath, "utf-8"));
		targetSpecId = frontmatter.target_spec_id ? String(frontmatter.target_spec_id) : undefined;
	} catch (err) {
		return { file: fileName, targetSpecId: "?", applied: 0, errors: [`Failed to parse: ${err}`] };
	}

	if (!targetSpecId) {
		return { file: fileName, targetSpecId: "?", applied: 0, errors: ["Missing target_spec_id in frontmatter"] };
	}

	// Find target spec Document in specs/ by ID
	const allDocs = await core.filesystem.listDocuments();
	const specDoc = allDocs.find((d) => d.id.toLowerCase() === targetSpecId.toLowerCase() && d.type === "spec");
	if (!specDoc) {
		return { file: fileName, targetSpecId, applied: 0, errors: [`Target spec "${targetSpecId}" not found in specs/`] };
	}

	const specName = specDoc.title;
	const mainContent = specDoc.rawContent;
	let working = mainContent;
	let hasChanges = false;

	// Parse delta sections
	const deltaPlan = parseDeltaSpec(deltaDoc.rawContent);

	// 1. ADDED
	for (const block of deltaPlan.added) {
		const result = applyAdded(working, block.raw);
		if (result.applied) {
			working = result.content;
			hasChanges = true;
			applied++;
		}
	}

	// 2. MODIFIED
	for (const block of deltaPlan.modified) {
		const result = applyModified(working, block.name, block.raw);
		if (result.applied) {
			working = result.content;
			hasChanges = true;
			applied++;
		} else if (result.notFound) {
			errors.push(`Requirement "${block.name}" not found in spec "${specName}"`);
		}
	}

	// 3. REMOVED
	for (const name of deltaPlan.removed) {
		const result = applyRemoved(working, name);
		if (result.applied) {
			working = result.content;
			hasChanges = true;
			applied++;
		} else if (result.notFound) {
			errors.push(`Requirement "${name}" not found in spec "${specName}"`);
		}
	}

	// 4. RENAMED
	for (const rename of deltaPlan.renamed) {
		const result = applyRenamed(working, rename.from, rename.to);
		if (result.applied) {
			working = result.content;
			hasChanges = true;
			applied++;
		}
	}

	// Validate
	const validationErrors = validateSpecContent(working, specName);
	for (const err of validationErrors) {
		errors.push(`Validation error: ${err}`);
	}

	// Write
	if (!isDryRun && hasChanges) {
		// Backup original spec
		if (mainContent) {
			const backupDir = join(changePath, "backups");
			await mkdir(backupDir, { recursive: true });
			await writeFile(join(backupDir, `${specDoc.title}.md.bak`), mainContent, "utf-8");
		}

		// Update spec Document via Core API
		await core.updateDocumentFromInput({
			id: specDoc.id,
			content: working,
		});

		// Set syncStatus on published spec
		const specFilePath = join(specsDir, specDoc.path ?? `${specDoc.id}.md`);
		if (existsSync(specFilePath)) {
			await updateSyncStatus(specFilePath, "synced");
		}

		// Set syncStatus on change artifact
		await updateSyncStatus(deltaFilePath, "synced");
	}

	return { file: fileName, targetSpecId, applied, errors };
}

// ─── new-spec processing ───

async function processNewSpec(
	newSpecFilePath: string,
	core: Core,
	_changePath: string,
	specsDir: string,
	isDryRun: boolean,
): Promise<{ file: string; specDocId: string; errors: string[] }> {
	const fileName = basename(newSpecFilePath);
	const errors: string[] = [];

	// Parse the new-spec Document
	let newSpecDoc: Document;
	try {
		newSpecDoc = readDocumentFromFile(newSpecFilePath);
	} catch (err) {
		return { file: fileName, specDocId: "", errors: [`Failed to parse: ${err}`] };
	}

	// Strip frontmatter and ## Motivation section from body
	let body = newSpecDoc.rawContent;
	body = body.replace(/^## Motivation\s*\n[\s\S]*?(?=\n## |$)/m, "").trim();

	const specName = newSpecDoc.title;

	// Validate body has Purpose and Requirements
	if (!body.includes("## Purpose")) {
		errors.push("new-spec body must contain a ## Purpose section");
	}
	if (!body.includes("## Requirements")) {
		errors.push("new-spec body must contain a ## Requirements section");
	}

	if (errors.length > 0) {
		return { file: fileName, specDocId: "", errors };
	}

	// Validate against SpecSchema
	const validationErrors = validateSpecContent(body, specName);
	for (const err of validationErrors) {
		errors.push(`Validation error: ${err}`);
	}

	// Create spec Document
	if (!isDryRun) {
		const createdDoc = await core.createDocumentFromInput({
			title: specName,
			type: "spec",
			status: "draft",
			content: body,
		});

		// Set syncStatus on the new spec
		const specFileName = `${SPEC_FILENAME_PREFIX}-${createdDoc.id.replace(new RegExp(`^${SPEC_FILENAME_PREFIX}-`, "i"), "")} - ${sanitizeFilename(specName)}.md`;
		const specFilePath = join(specsDir, specFileName);
		if (existsSync(specFilePath)) {
			await updateSyncStatus(specFilePath, "synced");
		}

		// Set syncStatus on change artifact
		await updateSyncStatus(newSpecFilePath, "synced");

		return { file: fileName, specDocId: createdDoc.id, errors };
	}

	// dry run — still report the ID that would be created
	return { file: fileName, specDocId: "(would create)", errors };
}

function sanitizeFilename(filename: string): string {
	return filename
		.replace(/[<>:"/\\|?*]/g, "-")
		.replace(/['(),!@#$%^&+=[\]{};]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

// ─── Main sync function ───

/**
 * Sync change artifacts from a change directory to published spec Documents.
 *
 * @param changeName - Name of the change (e.g., "add-auth" or "2026-05-16-add-auth")
 * @param core - Core instance for Document read/write
 * @param options - Sync options (dryRun)
 * @returns Summary string describing what was done
 */
export async function syncSpecs(changeName: string, core: Core, options: SyncOptions): Promise<string> {
	const isDryRun = options.dryRun ?? false;
	const projectRoot = core.fs.rootDir;
	const changePath = join(projectRoot, "backlog", "changes", changeName);
	const specsDir = join(projectRoot, "specs");

	if (!existsSync(changePath)) {
		return `Change "${changeName}" not found.`;
	}

	// List artifact files in change dir
	let entries: string[];
	try {
		entries = await readdir(changePath);
	} catch {
		return `Cannot read change dir "${changeName}".`;
	}

	const specDeltaFiles = entries.filter((e) => e.endsWith(".spec-delta.md")).map((f) => join(changePath, f));

	const newSpecFiles = entries.filter((e) => e.endsWith(".new-spec.md")).map((f) => join(changePath, f));

	if (specDeltaFiles.length === 0 && newSpecFiles.length === 0) {
		return `No change artifacts found for "${changeName}".`;
	}

	// Ensure specs/ directory exists
	if (!existsSync(specsDir)) {
		await mkdir(specsDir, { recursive: true });
	}

	const summary: SyncSummary = { deltaSpecs: [], newSpecs: [] };

	// Process spec-delta files
	for (const f of specDeltaFiles) {
		const result = await processSpecDelta(f, core, changePath, specsDir, isDryRun);
		summary.deltaSpecs.push(result);
	}

	// Process new-spec files
	for (const f of newSpecFiles) {
		const result = await processNewSpec(f, core, changePath, specsDir, isDryRun);
		summary.newSpecs.push(result);
	}

	// Build summary string
	const lines: string[] = [];
	if (isDryRun) {
		lines.push(
			`[dry run] Would sync ${specDeltaFiles.length} spec-delta(s) and ${newSpecFiles.length} new-spec(s) from "${changeName}":`,
		);
	} else {
		lines.push(
			`Synced ${specDeltaFiles.length} spec-delta(s) and ${newSpecFiles.length} new-spec(s) from "${changeName}":`,
		);
	}

	if (summary.deltaSpecs.length > 0) {
		lines.push("");
		lines.push("  spec-delta artifacts:");
		for (const r of summary.deltaSpecs) {
			const status = r.errors.length > 0 ? ` (${r.errors.length} error(s))` : "";
			lines.push(`    ${r.file} → ${r.targetSpecId}: ${r.applied} delta(s) applied${status}`);
			for (const err of r.errors) {
				lines.push(`      ERROR: ${err}`);
			}
		}
	}

	if (summary.newSpecs.length > 0) {
		lines.push("");
		lines.push("  new-spec artifacts:");
		for (const r of summary.newSpecs) {
			const status = r.errors.length > 0 ? ` (${r.errors.length} error(s))` : "";
			lines.push(`    ${r.file} → ${r.specDocId}${status}`);
			for (const err of r.errors) {
				lines.push(`      ERROR: ${err}`);
			}
		}
	}

	return lines.join("\n");
}
