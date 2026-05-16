/**
 * OpenSpec CLI command group - spec and change management.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { requireProjectRoot } from "../cli.ts";
import { Core } from "../core/backlog.ts";
import {
	ArtifactGraph,
	ChangeMetadataSchema,
	detectCompleted,
	listSchemas,
	resolveSchema,
} from "../openspec/artifact-graph/index.ts";
import type { SchemaYaml } from "../openspec/artifact-graph/types.ts";
import { parseChange } from "../openspec/parsers/change-parser.ts";
import { extractRequirementsSection, parseDeltaSpec } from "../openspec/parsers/index.ts";
import { ChangeSchema, RequirementSchema, SpecSchema } from "../openspec/schemas/index.ts";
import { buildDeltaSpecWithEntry, removeDeltaByIndex } from "../openspec/serializers.ts";
import { DESIGN_TEMPLATE, PROPOSAL_TEMPLATE, SPEC_TEMPLATE } from "../openspec/templates.ts";
import type { Document } from "../types/index.ts";

/**
 * Find the 1-based line number of a text snippet within larger content.
 * Returns -1 if not found (uses exact substring match).
 */
export function findLineNumber(content: string, text: string): number {
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
 * Build a spec directory path relative to project root.
 */
function specDir(name: string, projectRoot: string): string {
	return join(projectRoot, "backlog", "specs", name);
}

/**
 * Build a change directory path relative to project root.
 */
function changeDir(name: string, projectRoot: string): string {
	return join(projectRoot, "backlog", "changes", name);
}

/**
 * Validate spec content from spec.md against SpecSchema.
 * Returns array of error strings (empty = valid).
 */
function validateSpecContent(content: string, name: string): string[] {
	const errors: string[] = [];

	// Parse markdown sections for spec validation
	// Expected: ## Purpose (→ overview), ## Requirements (→ requirements[])
	const purposeMatch = content.match(/^## Purpose\s*\n([\s\S]*?)(?=\n## |$)/m);
	const purposeText = purposeMatch?.[1]?.trim() ?? "";

	const requirementsSection = extractRequirementsSection(content);

	const specInput: Record<string, unknown> = {
		name,
		overview: purposeText,
		requirements: requirementsSection.bodyBlocks.map((block) => {
			const scenarioTexts = (block.raw.match(/#### Scenario:.*\n([\s\S]*?)(?=\n#### |\n### |$)/gi) ?? []).map((s) =>
				s.replace(/^#### Scenario:.*\n/i, "").trim(),
			);
			return {
				text: block.name,
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
 * Validate change proposal.md content against ChangeSchema.
 * Returns array of error strings (empty = valid).
 */
async function validateChangeContent(content: string, changeName: string, projectRoot: string): Promise<string[]> {
	const errors: string[] = [];

	const parsed = parseChange(content);

	const changeInput: Record<string, unknown> = {
		name: changeName,
		why: parsed.why,
		whatChanges: parsed.whatChanges,
		deltas: parsed.deltas.map((delta) => ({
			spec: delta.spec,
			operation: delta.operation,
			description: delta.description,
			requirements: delta.requirements,
			rename: delta.rename,
		})),
	};

	const result = ChangeSchema.safeParse(changeInput);
	if (!result.success) {
		for (const issue of result.error.issues) {
			const pathStr = issue.path.join(".");
			const line = findLineNumber(content, issue.message);
			const lineInfo = line !== -1 ? ` (line ${line})` : "";
			errors.push(`  - ${pathStr}: ${issue.message}${lineInfo}`);
		}
	}

	// Also validate delta spec files if they exist
	const specsDir = join(changeDir(changeName, projectRoot), "specs");
	if (existsSync(specsDir)) {
		let specFiles: string[];
		try {
			const entries = await readdir(specsDir);
			specFiles = entries.filter((f) => f.endsWith(".md"));
		} catch {
			specFiles = [];
		}

		for (const specFile of specFiles) {
			const specFilePath = join(specsDir, specFile);
			try {
				const specContent = await Bun.file(specFilePath).text();
				const deltaPlan = parseDeltaSpec(specContent);
				if (
					deltaPlan.added.length === 0 &&
					deltaPlan.modified.length === 0 &&
					deltaPlan.removed.length === 0 &&
					deltaPlan.renamed.length === 0
				) {
					errors.push(`  - ${specFile}: no recognized delta sections found`);
				}
			} catch (err) {
				errors.push(`  - ${specFile}: failed to parse - ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	return errors;
}

/**
 * Register `spec` command group with the CLI program.
 */
export function registerSpecCommand(program: Command): void {
	const specCmd = program.command("spec");

	specCmd
		.command("create <name>")
		.description("scaffold a new spec document")
		.action(async (name: string) => {
			const projectRoot = await requireProjectRoot();
			const dir = specDir(name, projectRoot);
			const filePath = join(dir, "spec.md");

			if (existsSync(filePath)) {
				console.error(`Spec already exists at ${filePath.replace(projectRoot, ".")}`);
				process.exit(1);
			}

			await mkdir(dir, { recursive: true });
			await Bun.write(filePath, SPEC_TEMPLATE);
			console.log(`Created spec at ${filePath.replace(projectRoot, ".")}`);
		});

	specCmd
		.command("validate <name>")
		.description("validate a spec document against SpecSchema")
		.action(async (name: string) => {
			const projectRoot = await requireProjectRoot();
			const filePath = join(specDir(name, projectRoot), "spec.md");

			if (!existsSync(filePath)) {
				console.error(`Spec not found at ${filePath.replace(projectRoot, ".")}`);
				process.exit(1);
			}

			const content = await Bun.file(filePath).text();
			const errors = validateSpecContent(content, name);

			if (errors.length === 0) {
				console.log(`✓ ${name} is valid`);
			} else {
				console.error(`✗ ${name} has validation errors:`);
				for (const err of errors) {
					console.error(err);
				}
				process.exitCode = 1;
			}
		});

	specCmd
		.command("list")
		.description("list all specs with requirement counts")
		.option("--plain", "use plain text output")
		.action(async (options: { plain?: boolean }) => {
			const projectRoot = await requireProjectRoot();
			const core = new Core(projectRoot);
			const config = await core.filesystem.loadConfig();
			if (config) {
				await core.ensureConfigLoaded();
			}

			const docs = await core.filesystem.listDocuments();
			const specs = docs.filter((doc: Document) => doc.type === "specification");

			if (specs.length === 0) {
				console.log("No specs found.");
				return;
			}

			const usePlain = options?.plain ?? false;

			for (const spec of specs) {
				const reqSection = extractRequirementsSection(spec.rawContent);
				const reqCount = reqSection.bodyBlocks.length;
				if (usePlain) {
					console.log(`${spec.title} (${reqCount} requirements)`);
				} else {
					const filePathDisplay = spec.path ? ` (${spec.path})` : "";
					console.log(`  ${spec.title}${filePathDisplay} — ${reqCount} requirements`);
				}
			}
		});
}

/**
 * Register `change` command group with the CLI program.
 */
export function registerChangeCommand(program: Command): void {
	const changeCmd = program.command("change");

	changeCmd
		.command("create <name>")
		.description("scaffold a new change set")
		.action(async (name: string) => {
			const projectRoot = await requireProjectRoot();
			const dir = changeDir(name, projectRoot);

			if (existsSync(dir)) {
				console.error(`Change already exists at ${dir.replace(projectRoot, ".")}`);
				process.exit(1);
			}

			const specsDir = join(dir, "specs");
			await mkdir(specsDir, { recursive: true });

			// Write proposal.md
			await Bun.write(join(dir, "proposal.md"), PROPOSAL_TEMPLATE);

			// Write design.md
			await Bun.write(join(dir, "design.md"), DESIGN_TEMPLATE);

			console.log(`Created change at ${dir.replace(projectRoot, ".")}`);
		});

	changeCmd
		.command("validate <name>")
		.description("validate a change set")
		.action(async (name: string) => {
			const projectRoot = await requireProjectRoot();
			const dir = changeDir(name, projectRoot);
			const proposalPath = join(dir, "proposal.md");

			if (!existsSync(proposalPath)) {
				console.error(`Change proposal not found at ${proposalPath.replace(projectRoot, ".")}`);
				process.exit(1);
			}

			const content = await Bun.file(proposalPath).text();
			const errors = await validateChangeContent(content, name, projectRoot);

			if (errors.length === 0) {
				console.log(`✓ Change "${name}" is valid`);
			} else {
				console.error(`✗ Change "${name}" has validation errors:`);
				for (const err of errors) {
					console.error(err);
				}
				process.exitCode = 1;
			}
		});

	changeCmd
		.command("status <name>")
		.description("show artifact DAG state for a change set")
		.option("--json", "output as JSON for agent consumption")
		.action(async (name: string, options: { json?: boolean }) => {
			const projectRoot = await requireProjectRoot();
			const dir = changeDir(name, projectRoot);

			// Handle missing change dir gracefully
			if (!existsSync(dir)) {
				if (options.json) {
					console.log(JSON.stringify({ changeName: name, schemaName: null, artifacts: [] }));
				} else {
					console.log(`Change "${name}" not found.`);
					console.log("Run `backlog change create <name>` to scaffold a new change set.");
				}
				return;
			}

			// Resolve schema name from .openspec.yaml metadata
			const metadataPath = join(dir, ".openspec.yaml");
			let schemaName = "spec-driven";
			if (existsSync(metadataPath)) {
				try {
					const metadataContent = await readFile(metadataPath, "utf-8");
					const parsed = parseYaml(metadataContent);
					const result = ChangeMetadataSchema.safeParse(parsed);
					if (result.success) {
						schemaName = result.data.schema;
					} else {
						console.error(`Invalid .openspec.yaml at ${metadataPath.replace(projectRoot, ".")}:`);
						for (const issue of result.error.issues) {
							console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
						}
						process.exit(1);
					}
				} catch (err) {
					console.error(`Failed to read .openspec.yaml: ${err instanceof Error ? err.message : String(err)}`);
					process.exit(1);
				}
			}

			// Resolve schema
			let schema: SchemaYaml;
			try {
				schema = resolveSchema(schemaName, projectRoot);
			} catch {
				// Schema not found
				const available = listSchemas(projectRoot);
				if (available.length === 0) {
					console.error(`Schema "${schemaName}" is not available. No schemas found.`);
					console.error(
						"Create a schema at openspec/schemas/<name>/schema.yaml or install a package with built-in schemas.",
					);
				} else {
					console.error(`Schema "${schemaName}" not found. Available schemas: ${available.join(", ")}`);
				}
				process.exit(1);
			}

			// Build graph and detect completed artifacts
			const graph = ArtifactGraph.fromSchema(schema);
			const completed = detectCompleted(graph, dir);

			// Compute per-artifact status
			const artifacts = graph.getAllArtifacts().map((a) => {
				if (completed.has(a.id)) {
					return { id: a.id, status: "done" as const };
				}

				const ready = graph.getNextArtifacts(completed);
				if (ready.includes(a.id)) {
					return { id: a.id, status: "ready" as const };
				}

				const blocked = graph.getBlocked(completed);
				const missingDeps = blocked[a.id] ?? [];
				return { id: a.id, status: "blocked" as const, missingDeps };
			});

			const total = artifacts.length;
			const doneCount = artifacts.filter((a) => a.status === "done").length;

			// Output
			if (options.json) {
				console.log(
					JSON.stringify(
						{
							changeName: name,
							schemaName: graph.getName(),
							artifacts,
						},
						null,
						2,
					),
				);
				return;
			}

			// Text output with color-coded indicators
			const supportsColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
			const green = (s: string) => (supportsColor ? `\u001B[32m${s}\u001B[0m` : s);
			const blue = (s: string) => (supportsColor ? `\u001B[34m${s}\u001B[0m` : s);
			const red = (s: string) => (supportsColor ? `\u001B[31m${s}\u001B[0m` : s);
			const bold = (s: string) => (supportsColor ? `\u001B[1m${s}\u001B[0m` : s);

			console.log(`${bold("Change:")} ${name}`);
			console.log(`${bold("Schema:")} ${graph.getName()}`);
			console.log(`${bold("Progress:")} ${doneCount}/${total} artifacts complete`);
			console.log("");

			for (const a of artifacts) {
				if (a.status === "done") {
					console.log(`  ${green("✓")} ${a.id} (done)`);
				} else if (a.status === "ready") {
					console.log(`  ${blue("○")} ${a.id} (ready)`);
				} else {
					const deps = (a as { id: string; status: "blocked"; missingDeps: string[] }).missingDeps;
					console.log(`  ${red("◉")} ${a.id} (blocked — needs: ${deps.join(", ")})`);
				}
			}

			// Next action hint
			const ready = artifacts.filter((a) => a.status === "ready");
			if (ready.length > 0) {
				console.log("");
				console.log(`Next: ${ready[0]?.id} is ready to be created`);
			} else if (doneCount < total) {
				console.log("");
				console.log("All remaining artifacts are blocked. Complete ready artifacts first.");
			} else {
				console.log("");
				console.log("All artifacts complete!");
			}
		});

	// ─── Delta subcommand group ───

	const deltaCmd = changeCmd.command("delta");

	deltaCmd
		.command("add <change>")
		.description("add a delta entry to a change's spec file")
		.requiredOption("--spec <name>", "spec name to target (e.g. user-auth)")
		.requiredOption("--op <operation>", "delta operation: ADDED, MODIFIED, REMOVED, RENAMED")
		.option("--req <text>", "requirement text (required for ADDED/MODIFIED/REMOVED; name for RENAMED)")
		.option("--scenario <text>", "scenario raw text (for ADDED/MODIFIED requirements)")
		.option("--given <text>", "given context for scenario (auto-generates scenario header)")
		.option("--when <text>", "when action for scenario")
		.option("--then <text>", "then outcome for scenario")
		.option("--rename-from <name>", "original requirement name (for RENAMED)")
		.option("--rename-to <name>", "new requirement name (for RENAMED)")
		.action(
			async (
				change: string,
				options: {
					spec?: string;
					op?: string;
					req?: string;
					scenario?: string;
					given?: string;
					when?: string;
					then?: string;
					renameFrom?: string;
					renameTo?: string;
				},
			) => {
				const projectRoot = await requireProjectRoot();
				const changePath = changeDir(change, projectRoot);
				const specName = options.spec ?? "";

				if (!existsSync(changePath)) {
					console.error(`Change "${change}" not found at ${changePath.replace(projectRoot, ".")}`);
					process.exit(1);
				}

				if (!specName) {
					console.error("Missing required option: --spec <name>");
					process.exit(1);
				}

				if (!options.op) {
					console.error("Missing required option: --op ADDED|MODIFIED|REMOVED|RENAMED");
					process.exit(1);
				}

				const op = options.op.toUpperCase();
				const validOps = ["ADDED", "MODIFIED", "REMOVED", "RENAMED"];
				if (!validOps.includes(op)) {
					console.error(`Invalid --op: ${options.op}. Must be one of: ${validOps.join(", ")}`);
					process.exit(1);
				}

				const operation = op as "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED";

				// Build scenario raw text from --given/--when/--then flags
				let scenarioRawText = options.scenario ?? "";
				if (options.given || options.when || options.then) {
					const parts: string[] = [];
					if (options.given) parts.push(`GIVEN ${options.given}`);
					if (options.when) parts.push(`WHEN ${options.when}`);
					if (options.then) parts.push(`THEN ${options.then}`);
					scenarioRawText = parts.join("\n");
				}

				// Validate ADDED/MODIFIED requirements
				if (operation === "ADDED" || operation === "MODIFIED") {
					if (!options.req) {
						console.error(`--req <text> is required for ${operation} deltas`);
						process.exit(1);
					}

					if (!scenarioRawText) {
						console.error(`--scenario or --given/--when/--then is required for ${operation} deltas`);
						process.exit(1);
					}

					// Validate against RequirementSchema
					const reqResult = RequirementSchema.safeParse({
						text: options.req,
						scenarios: [{ rawText: scenarioRawText }],
					});

					if (!reqResult.success) {
						console.error("Requirement validation failed:");
						for (const issue of reqResult.error.issues) {
							console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
						}
						process.exit(1);
					}
				}

				if (operation === "REMOVED") {
					if (!options.req) {
						console.error("--req <name> is required for REMOVED deltas (requirement header name)");
						process.exit(1);
					}
				}

				if (operation === "RENAMED") {
					if (!options.renameFrom || !options.renameTo) {
						console.error("--rename-from <name> and --rename-to <name> are required for RENAMED deltas");
						process.exit(1);
					}
				}

				// Ensure specs/<spec>/ directory exists
				const specDirPath = join(changePath, "specs", specName);
				await mkdir(specDirPath, { recursive: true });

				const specFilePath = join(specDirPath, "spec.md");
				const existingContent = existsSync(specFilePath) ? await Bun.file(specFilePath).text() : "";

				const entryName = options.req ?? specName;
				const newContent = buildDeltaSpecWithEntry(existingContent, {
					operation,
					name: entryName,
					statement: options.req,
					scenarioRawText,
					renameFrom: options.renameFrom,
					renameTo: options.renameTo,
				});

				await writeFile(specFilePath, newContent, "utf-8");
				console.log(`Added ${operation} delta "${entryName}" to ${specFilePath.replace(projectRoot, ".")}`);
			},
		);

	deltaCmd
		.command("list <change>")
		.description("list all deltas in a change, grouped by operation type")
		.option("--json", "output as JSON for agent consumption")
		.action(async (change: string, options: { json?: boolean }) => {
			const projectRoot = await requireProjectRoot();
			const changePath = changeDir(change, projectRoot);

			if (!existsSync(changePath)) {
				console.error(`Change "${change}" not found at ${changePath.replace(projectRoot, ".")}`);
				process.exit(1);
			}

			const specsDir = join(changePath, "specs");
			if (!existsSync(specsDir)) {
				console.log(`No delta specs found for change "${change}".`);
				return;
			}

			const specDirs = await readdir(specsDir);
			let flatIndex = 1;
			const result: Array<{
				index: number;
				operation: string;
				spec: string;
				name: string;
				description: string;
			}> = [];

			for (const specName of specDirs) {
				const specFilePath = join(specsDir, specName, "spec.md");
				if (!existsSync(specFilePath)) continue;

				const content = await Bun.file(specFilePath).text();
				const deltaPlan = parseDeltaSpec(content);
				const sections: Array<{ operation: string; entries: Array<{ name: string; description: string }> }> = [
					{ operation: "ADDED", entries: deltaPlan.added.map((b) => ({ name: b.name, description: b.headerLine })) },
					{
						operation: "MODIFIED",
						entries: deltaPlan.modified.map((b) => ({ name: b.name, description: b.headerLine })),
					},
					{
						operation: "REMOVED",
						entries: deltaPlan.removed.map((n) => ({ name: n, description: `Remove requirement: ${n}` })),
					},
					{
						operation: "RENAMED",
						entries: deltaPlan.renamed.map((r) => ({
							name: `${r.from} → ${r.to}`,
							description: `Rename from "${r.from}" to "${r.to}"`,
						})),
					},
				];

				for (const section of sections) {
					for (const entry of section.entries) {
						result.push({
							index: flatIndex++,
							operation: section.operation,
							spec: specName,
							name: entry.name,
							description: entry.description,
						});
					}
				}
			}

			if (result.length === 0) {
				console.log(`No deltas found for change "${change}".`);
				return;
			}

			if (options.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}

			// Grouped plain text output
			for (const sectionName of ["ADDED", "MODIFIED", "REMOVED", "RENAMED"]) {
				const entries = result.filter((r) => r.operation === sectionName);
				if (entries.length === 0) continue;

				console.log(`\n${sectionName} Requirements:`);
				for (const entry of entries) {
					console.log(`  ${entry.index}. [${entry.spec}] ${entry.description}`);
				}
			}
		});

	deltaCmd
		.command("remove <change>")
		.description("remove a delta entry by its 1-based flat index")
		.requiredOption("--index <n>", "1-based flat index of the delta to remove (use list to see indices)")
		.action(async (change: string, options: { index?: string }) => {
			const projectRoot = await requireProjectRoot();
			const changePath = changeDir(change, projectRoot);

			if (!existsSync(changePath)) {
				console.error(`Change "${change}" not found at ${changePath.replace(projectRoot, ".")}`);
				process.exit(1);
			}

			if (!options.index) {
				console.error("Missing required option: --index <n>");
				process.exit(1);
			}

			const index = Number.parseInt(options.index, 10);
			if (Number.isNaN(index) || index < 1) {
				console.error("--index must be a positive integer");
				process.exit(1);
			}

			// Walk through all spec dirs to find the entry by flat index
			const specsDir = join(changePath, "specs");
			if (!existsSync(specsDir)) {
				console.error(`No specs found for change "${change}".`);
				process.exit(1);
			}

			const specDirs = await readdir(specsDir);
			let remaining = index;

			for (const specName of specDirs) {
				const specFilePath = join(specsDir, specName, "spec.md");
				if (!existsSync(specFilePath)) continue;

				const content = await Bun.file(specFilePath).text();
				const deltaPlan = parseDeltaSpec(content);
				const totalInSpec =
					deltaPlan.added.length + deltaPlan.modified.length + deltaPlan.removed.length + deltaPlan.renamed.length;

				if (remaining <= totalInSpec) {
					// Found the spec file containing the target entry
					const newContent = removeDeltaByIndex(content, remaining);
					if (newContent === null) {
						console.error(`Delta at index ${index} not found.`);
						process.exit(1);
					}

					await writeFile(specFilePath, newContent, "utf-8");
					console.log(`Removed delta #${index} from ${specFilePath.replace(projectRoot, ".")}`);
					return;
				}

				remaining -= totalInSpec;
			}

			console.error(`Delta at index ${index} not found.`);
			process.exit(1);
		});
}
