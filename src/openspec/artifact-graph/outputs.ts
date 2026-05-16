import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Checks if a path contains glob pattern characters.
 */
export function isGlobPattern(pattern: string): boolean {
	return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

/**
 * Resolves an artifact's output path(s) to concrete files that currently exist.
 * Returns absolute file paths. Glob matches are sorted for deterministic output.
 */
export function resolveArtifactOutputs(changeDir: string, generates: string): string[] {
	if (!isGlobPattern(generates)) {
		const fullPath = path.join(changeDir, generates);
		try {
			return fs.statSync(fullPath).isFile() ? [path.resolve(fullPath)] : [];
		} catch {
			return [];
		}
	}

	// Use Bun's native glob for pattern matching
	const glob = new Bun.Glob(generates);
	const matches = Array.from(glob.scanSync({ cwd: changeDir, absolute: true })).sort();

	return Array.from(new Set(matches)).sort();
}

/**
 * Checks if an artifact has at least one resolved output file.
 */
export function artifactOutputExists(changeDir: string, generates: string): boolean {
	return resolveArtifactOutputs(changeDir, generates).length > 0;
}
