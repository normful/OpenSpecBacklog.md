import * as fs from "node:fs";
import type { ArtifactGraph } from "./graph.ts";
import { artifactOutputExists } from "./outputs.ts";
import type { CompletedSet } from "./types.ts";

/**
 * Detects which artifacts are completed by checking file existence.
 * Returns a Set of completed artifact IDs.
 *
 * @param graph - The artifact graph to check
 * @param changeDir - The change directory to scan for files
 * @param projectRoot - Optional project root for resolving project-root-relative generates paths
 * @returns Set of artifact IDs whose generated files exist
 */
export function detectCompleted(graph: ArtifactGraph, changeDir: string, projectRoot?: string): CompletedSet {
	const completed = new Set<string>();

	// Handle missing change directory gracefully
	if (!fs.existsSync(changeDir)) {
		return completed;
	}

	for (const artifact of graph.getAllArtifacts()) {
		if (isArtifactComplete(artifact.generates, changeDir, projectRoot)) {
			completed.add(artifact.id);
		}
	}

	return completed;
}

/**
 * Checks if an artifact is complete by checking if its generated file(s) exist.
 * Supports both simple paths and glob patterns.
 */
function isArtifactComplete(generates: string, changeDir: string, projectRoot?: string): boolean {
	return artifactOutputExists(changeDir, generates, projectRoot);
}
