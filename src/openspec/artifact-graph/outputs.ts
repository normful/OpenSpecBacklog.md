import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Checks if a path contains glob pattern characters.
 */
export function isGlobPattern(pattern: string): boolean {
	return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

/**
 * Checks if a generates path is project-root-relative (starts with backlog/ or openspec/).
 * Such paths should be resolved against the project root, not the change directory.
 */
export function isAbsoluteRelativePath(generates: string): boolean {
	return generates.startsWith("backlog/") || generates.startsWith("openspec/");
}

/**
 * Resolves an artifact's output path(s) to concrete files that currently exist.
 * Returns absolute file paths. Glob matches are sorted for deterministic output.
 *
 * When `generates` starts with a known project-root-relative prefix (backlog/ or openspec/)
 * and `projectRoot` is provided, resolves against projectRoot instead of changeDir.
 */
export function resolveArtifactOutputs(changeDir: string, generates: string, projectRoot?: string): string[] {
	const baseDir = isAbsoluteRelativePath(generates) && projectRoot ? projectRoot : changeDir;

	if (!isGlobPattern(generates)) {
		const fullPath = path.join(baseDir, generates);
		try {
			return fs.statSync(fullPath).isFile() ? [path.resolve(fullPath)] : [];
		} catch {
			return [];
		}
	}

	// Use Bun's native glob for pattern matching
	const glob = new Bun.Glob(generates);
	const matches = Array.from(glob.scanSync({ cwd: baseDir, absolute: true })).sort();

	return Array.from(new Set(matches)).sort();
}

/**
 * Checks if an artifact has at least one resolved output file.
 */
export function artifactOutputExists(changeDir: string, generates: string, projectRoot?: string): boolean {
	return resolveArtifactOutputs(changeDir, generates, projectRoot).length > 0;
}
