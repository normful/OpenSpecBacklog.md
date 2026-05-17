/**
 * Archive pipeline for change sets.
 * Pure logic — no CLI imports, no side effects.
 *
 * Checks change checklist completeness, detects unsynced deltas,
 * then moves backlog/changes/<name> to backlog/changes/archive/<date>-<name>/.
 */

import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import {
	CHANGE_ARTIFACTS,
	computeArtifactStatus,
	detectCompleted,
	isChangeComplete,
} from "../openspec/change-checklist.ts";

// ─── Types ───

export interface ArchiveOptions {
	force?: boolean;
	noSyncCheck?: boolean;
}

export interface ArchiveResult {
	success: boolean;
	changeName: string;
	archivePath: string | null;
	blockers: string[];
	hasUnsyncedDeltas: boolean;
	doneArtifacts: string[];
	totalArtifacts: number;
	reason?: string;
}

// ─── Public API ───

/**
 * Generate an archive directory name with the current date prefix.
 * Format: <YYYY-MM-DD>-<name>
 */
export function archiveDirName(name: string): string {
	const date = new Date();
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}-${name}`;
}

/**
 * Check if a change has unsynced delta spec files.
 * Returns true if any spec files exist under the change's specs/ directory.
 */
export function hasUnsyncedDeltas(changeDir: string): boolean {
	const specsDir = join(changeDir, "specs");
	if (!existsSync(specsDir)) {
		return false;
	}

	const entries = readdirSync(specsDir, { withFileTypes: true });
	return entries.some((entry) => entry.isDirectory());
}

/**
 * Build the archive directory path relative to project root.
 */
export function archiveDir(projectRoot: string, archivedName: string): string {
	return join(projectRoot, "backlog", "changes", "archive", archivedName);
}

/**
 * Archive a change set: checks completeness, then moves to archive dir.
 *
 * Steps:
 * 1. Detect completed artifacts using flat checklist
 * 2. Check isComplete — if incomplete and not --force, return blockers
 * 3. Check for unsynced deltas — warn unless --no-sync-check
 * 4. Move backlog/changes/<name> → backlog/changes/archive/<date>-<name>/
 * 5. Return result summary
 *
 * @param changeName - Name of the change to archive
 * @param projectRoot - Project root path
 * @param options - Archive options (force, noSyncCheck)
 * @returns ArchiveResult with status and details
 */
export function archiveChange(changeName: string, projectRoot: string, options: ArchiveOptions): ArchiveResult {
	const changePath = join(projectRoot, "backlog", "changes", changeName);

	if (!existsSync(changePath)) {
		return {
			success: false,
			changeName,
			archivePath: null,
			blockers: [],
			hasUnsyncedDeltas: false,
			doneArtifacts: [],
			totalArtifacts: 0,
			reason: `Change "${changeName}" not found at ${changePath.replace(projectRoot, ".")}`,
		};
	}

	// 1. Detect completed artifacts using flat checklist
	const completed = detectCompleted(CHANGE_ARTIFACTS, changePath, projectRoot);
	const statuses = computeArtifactStatus(completed, CHANGE_ARTIFACTS);
	const doneArtifacts = statuses.filter((s) => s.status === "done").map((s) => s.id);
	const blockers = statuses
		.filter((s) => s.status === "blocked")
		.map((s) =>
			s.missingDeps && s.missingDeps.length > 0
				? `${s.id} (needs: ${s.missingDeps.join(", ")})`
				: `${s.id} (not started)`,
		);

	// 2. Check completeness
	const allDone = isChangeComplete(completed, CHANGE_ARTIFACTS);

	if (!allDone && !options.force) {
		return {
			success: false,
			changeName,
			archivePath: null,
			blockers,
			hasUnsyncedDeltas: false,
			doneArtifacts,
			totalArtifacts: CHANGE_ARTIFACTS.length,
			reason: `Artifacts incomplete (${completed.size}/${CHANGE_ARTIFACTS.length} done). Use --force to archive anyway.`,
		};
	}

	// 3. Check for unsynced deltas
	const unsynced = hasUnsyncedDeltas(changePath);

	if (unsynced && !options.noSyncCheck) {
		return {
			success: false,
			changeName,
			archivePath: null,
			blockers,
			hasUnsyncedDeltas: true,
			doneArtifacts,
			totalArtifacts: CHANGE_ARTIFACTS.length,
			reason: "Unsynced deltas detected. Run `backlog change sync <name>` first, or use --no-sync-check to bypass.",
		};
	}

	// 4. Move to archive
	const archivedName = archiveDirName(changeName);
	const archivePath = join(projectRoot, "backlog", "changes", "archive", archivedName);

	// Ensure archive parent dir exists
	const archiveParent = join(projectRoot, "backlog", "changes", "archive");
	if (!existsSync(archiveParent)) {
		mkdirSync(archiveParent, { recursive: true });
	}

	renameSync(changePath, archivePath);

	// 5. Return result
	return {
		success: true,
		changeName,
		archivePath: archivePath.replace(projectRoot, "."),
		blockers: [],
		hasUnsyncedDeltas: unsynced,
		doneArtifacts,
		totalArtifacts: CHANGE_ARTIFACTS.length,
	};
}
