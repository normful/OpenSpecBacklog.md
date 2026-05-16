import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchema, SchemaValidationError } from "./schema.ts";
import type { SchemaYaml } from "./types.ts";

/**
 * Error thrown when loading a schema fails.
 */
export class SchemaLoadError extends Error {
	public readonly schemaPath: string;

	constructor(message: string, schemaPath: string, cause?: Error) {
		super(message, { cause });
		this.name = "SchemaLoadError";
		this.schemaPath = schemaPath;
	}
}

/**
 * Gets the package's built-in schemas directory path.
 * Uses import.meta.url to resolve relative to the current module.
 * Navigates from src/openspec/artifact-graph/ to project root's openspec/schemas/.
 * import.meta.url resolves to the .ts source file under src/, so 3 levels up
 * from artifact-graph/ → openspec/ → src/ → project root.
 */
export function getPackageSchemasDir(): string {
	const currentFile = fileURLToPath(import.meta.url);
	return path.join(path.dirname(currentFile), "..", "..", "..", "openspec", "schemas");
}

/**
 * Gets the project-local schemas directory path.
 * @param projectRoot - The project root directory
 * @returns The path to the project's schemas directory
 */
export function getProjectSchemasDir(projectRoot: string): string {
	return path.join(projectRoot, "openspec", "schemas");
}

/**
 * Resolves a schema name to its directory path.
 *
 * Resolution order (when projectRoot is provided):
 * 1. Project-local: <projectRoot>/openspec/schemas/<name>/schema.yaml
 * 2. Package built-in: built-in openspec/schemas/<name>/schema.yaml
 *
 * @param name - Schema name (e.g., "spec-driven")
 * @param projectRoot - Optional project root directory for project-local schema resolution
 * @returns The path to the schema directory, or null if not found
 */
export function getSchemaDir(name: string, projectRoot?: string): string | null {
	// 1. Check project-local directory (if projectRoot provided)
	if (projectRoot) {
		const projectDir = path.join(getProjectSchemasDir(projectRoot), name);
		const projectSchemaPath = path.join(projectDir, "schema.yaml");
		if (fs.existsSync(projectSchemaPath)) {
			return projectDir;
		}
	}

	// 2. Check package built-in directory
	const packageDir = path.join(getPackageSchemasDir(), name);
	const packageSchemaPath = path.join(packageDir, "schema.yaml");
	if (fs.existsSync(packageSchemaPath)) {
		return packageDir;
	}

	return null;
}

/**
 * Resolves a schema name to a SchemaYaml object.
 *
 * Resolution order (when projectRoot is provided):
 * 1. Project-local: <projectRoot>/openspec/schemas/<name>/schema.yaml
 * 2. Package built-in: built-in openspec/schemas/<name>/schema.yaml
 *
 * @param name - Schema name (e.g., "spec-driven")
 * @param projectRoot - Optional project root directory for project-local schema resolution
 * @returns The resolved schema object
 * @throws Error if schema is not found in any location
 */
export function resolveSchema(name: string, projectRoot?: string): SchemaYaml {
	// Normalize name (remove .yaml extension if provided)
	const normalizedName = name.replace(/\.ya?ml$/, "");

	const schemaDir = getSchemaDir(normalizedName, projectRoot);
	if (!schemaDir) {
		const availableSchemas = listSchemas(projectRoot);
		throw new Error(`Schema '${normalizedName}' not found. Available schemas: ${availableSchemas.join(", ")}`);
	}

	const schemaPath = path.join(schemaDir, "schema.yaml");

	// Load and parse the schema
	let content: string;
	try {
		content = fs.readFileSync(schemaPath, "utf-8");
	} catch (err) {
		const ioError = err instanceof Error ? err : new Error(String(err));
		throw new SchemaLoadError(`Failed to read schema at '${schemaPath}': ${ioError.message}`, schemaPath, ioError);
	}

	try {
		return parseSchema(content);
	} catch (err) {
		if (err instanceof SchemaValidationError) {
			throw new SchemaLoadError(`Invalid schema at '${schemaPath}': ${err.message}`, schemaPath, err);
		}
		const parseError = err instanceof Error ? err : new Error(String(err));
		throw new SchemaLoadError(
			`Failed to parse schema at '${schemaPath}': ${parseError.message}`,
			schemaPath,
			parseError,
		);
	}
}

/**
 * Lists all available schema names.
 * Combines project-local and package built-in schemas.
 *
 * @param projectRoot - Optional project root directory for project-local schema resolution
 */
export function listSchemas(projectRoot?: string): string[] {
	const schemas = new Set<string>();

	// Add package built-in schemas
	const packageDir = getPackageSchemasDir();
	if (fs.existsSync(packageDir)) {
		for (const entry of fs.readdirSync(packageDir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				const schemaPath = path.join(packageDir, entry.name, "schema.yaml");
				if (fs.existsSync(schemaPath)) {
					schemas.add(entry.name);
				}
			}
		}
	}

	// Add project-local schemas (if projectRoot provided, may add schemas not in built-in)
	if (projectRoot) {
		const projectDir = getProjectSchemasDir(projectRoot);
		if (fs.existsSync(projectDir)) {
			for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
				if (entry.isDirectory()) {
					const schemaPath = path.join(projectDir, entry.name, "schema.yaml");
					if (fs.existsSync(schemaPath)) {
						schemas.add(entry.name);
					}
				}
			}
		}
	}

	return Array.from(schemas).sort();
}

/**
 * Schema info with metadata (name, description, artifacts).
 */
export interface SchemaInfo {
	name: string;
	description: string;
	artifacts: string[];
	source: "project" | "package";
}

/**
 * Lists all available schemas with their descriptions and artifact lists.
 * Useful for agent skills to present schema selection to users.
 *
 * @param projectRoot - Optional project root directory for project-local schema resolution
 */
export function listSchemasWithInfo(projectRoot?: string): SchemaInfo[] {
	const schemas: SchemaInfo[] = [];
	const seenNames = new Set<string>();

	// Add project-local schemas first (highest priority, if projectRoot provided)
	if (projectRoot) {
		const projectDir = getProjectSchemasDir(projectRoot);
		if (fs.existsSync(projectDir)) {
			for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
				if (entry.isDirectory()) {
					const schemaPath = path.join(projectDir, entry.name, "schema.yaml");
					if (fs.existsSync(schemaPath)) {
						try {
							const schema = parseSchema(fs.readFileSync(schemaPath, "utf-8"));
							schemas.push({
								name: entry.name,
								description: schema.description || "",
								artifacts: schema.artifacts.map((a) => a.id),
								source: "project",
							});
							seenNames.add(entry.name);
						} catch {
							// Skip invalid schemas
						}
					}
				}
			}
		}
	}

	// Add package built-in schemas (if not overridden by project)
	const packageDir = getPackageSchemasDir();
	if (fs.existsSync(packageDir)) {
		for (const entry of fs.readdirSync(packageDir, { withFileTypes: true })) {
			if (entry.isDirectory() && !seenNames.has(entry.name)) {
				const schemaPath = path.join(packageDir, entry.name, "schema.yaml");
				if (fs.existsSync(schemaPath)) {
					try {
						const schema = parseSchema(fs.readFileSync(schemaPath, "utf-8"));
						schemas.push({
							name: entry.name,
							description: schema.description || "",
							artifacts: schema.artifacts.map((a) => a.id),
							source: "package",
						});
					} catch {
						// Skip invalid schemas
					}
				}
			}
		}
	}

	return schemas.sort((a, b) => a.name.localeCompare(b.name));
}
