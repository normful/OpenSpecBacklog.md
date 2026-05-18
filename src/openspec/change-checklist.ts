/**
 * Flat checklist definitions for the OpenSpec change workflow.
 *
 * Replaces the DAG engine (ArtifactGraph class, schema YAML, resolver,
 * topological sort) with a single hardcoded data structure + pure helpers.
 *
 * The change workflow has 2 artifacts with no ordering constraints:
 * - deltas (spec-delta files) and new-specs (new-spec files) are independent
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

// ─── Types ───

export interface ChangeArtifact {
	/** Unique ID for this artifact (e.g. "proposal", "deltas") */
	id: string;
	/** Human-readable label for CLI output */
	label: string;
	/** Glob pattern — resolved against change dir unless projectRootRelative=true */
	generates: string;
	/** True if generates is project-root-relative (e.g. backlog/docs/** / *.md) */
	projectRootRelative: boolean;
	/** Artifact IDs that must be completed first */
	dependsOn: string[];
}

export interface ArtifactStatus {
	id: string;
	label: string;
	status: "done" | "ready" | "blocked";
	missingDeps?: string[];
}

// ─── Constants ───

/**
 * The change workflow checklist.
 * Dependencies are minimal — only real ordering constraints.
 */
export const CHANGE_ARTIFACTS: ChangeArtifact[] = [
	{
		id: "deltas",
		label: "Delta specs",
		generates: "*.spec-delta.md",
		projectRootRelative: false,
		dependsOn: [],
	},
	{
		id: "new-specs",
		label: "New specs",
		generates: "*.new-spec.md",
		projectRootRelative: false,
		dependsOn: [],
	},
];

// ─── Pure functions (no filesystem) ───

/**
 * Compute per-artifact status from a set of completed IDs.
 *
 * - 'done': ID is in the completed set
 * - 'ready': not done and all dependsOn IDs are in the completed set
 * - 'blocked': not done and at least one dependsOn ID is missing
 */
export function computeArtifactStatus(
	completed: Set<string>,
	allArtifacts: ChangeArtifact[] = CHANGE_ARTIFACTS,
): ArtifactStatus[] {
	return allArtifacts.map((a) => {
		if (completed.has(a.id)) {
			return { id: a.id, label: a.label, status: "done" as const };
		}

		const missingDeps = a.dependsOn.filter((dep) => !completed.has(dep));
		if (missingDeps.length > 0) {
			return { id: a.id, label: a.label, status: "blocked" as const, missingDeps };
		}

		return { id: a.id, label: a.label, status: "ready" as const };
	});
}

/**
 * Returns true when every artifact's ID is in the completed set.
 */
export function isChangeComplete(completed: Set<string>, allArtifacts: ChangeArtifact[] = CHANGE_ARTIFACTS): boolean {
	return allArtifacts.every((a) => completed.has(a.id));
}

// ─── File-checking helpers ───

/**
 * Checks if a path contains glob pattern characters (*, ?, [).
 */
export function isGlobPattern(pattern: string): boolean {
	return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

/**
 * Resolves an artifact's output path(s) to concrete files that currently exist.
 *
 * When artifact.projectRootRelative is true, resolves generates against projectRoot
 * instead of changeDir.
 *
 * Returns absolute file paths sorted for deterministic output.
 */
export function resolveArtifactOutputs(changeDir: string, artifact: ChangeArtifact, projectRoot?: string): string[] {
	const baseDir = artifact.projectRootRelative && projectRoot ? projectRoot : changeDir;

	if (!isGlobPattern(artifact.generates)) {
		const fullPath = join(baseDir, artifact.generates);
		try {
			return existsSync(fullPath) ? [join(fullPath)] : [];
		} catch {
			return [];
		}
	}

	// Use Bun's native glob for pattern matching
	const glob = new Bun.Glob(artifact.generates);
	const matches = Array.from(glob.scanSync({ cwd: baseDir, absolute: true })).sort();
	return Array.from(new Set(matches)).sort();
}

/**
 * Scans the change dir (and optionally project root) for completed artifact files.
 * Returns the set of artifact IDs whose generates glob/file exists.
 */
export function detectCompleted(artifacts: ChangeArtifact[], changeDir: string, projectRoot?: string): Set<string> {
	const completed = new Set<string>();

	// Handle missing change directory gracefully
	if (!existsSync(changeDir)) {
		return completed;
	}

	for (const artifact of artifacts) {
		const outputs = resolveArtifactOutputs(changeDir, artifact, projectRoot);
		if (outputs.length > 0) {
			completed.add(artifact.id);
		}
	}

	return completed;
}
