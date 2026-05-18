/**
 * OpenSpec CLI command group - spec and change management.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { requireProjectRoot } from "../cli.ts";
import { Core } from "../core/backlog.ts";
import { archiveChange } from "../openspec/archive.ts";
import { CHANGE_ARTIFACTS, computeArtifactStatus, detectCompleted } from "../openspec/change-checklist.ts";
import { extractRequirementsSection, parseDeltaSpec } from "../openspec/parsers/index.ts";
import { RequirementSchema, SpecSchema } from "../openspec/schemas/index.ts";
import { buildDeltaSpecWithEntry, removeDeltaByIndex } from "../openspec/serializers.ts";
import { syncSpecs } from "../openspec/sync.ts";
import type { Document } from "../types/index.ts";

// ─── Inline template strings (ported from deleted src/openspec/templates.ts) ───

const SPEC_TEMPLATE = `## Purpose

Describe the purpose of this specification.

## Requirements

### Requirement: placeholder-requirement

The system SHALL satisfy this requirement.

#### Scenario: basic-behavior

GIVEN a starting state
WHEN an action occurs
THEN an expected outcome happens
`;

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
 * Build a change directory path relative to project root.
 * Changes still write delta specs (specs/<name>/spec.md) to this dir.
 * The proposal and design content are now Documents in backlog/docs/.
 */
function changeDir(name: string, projectRoot: string): string {
	return join(projectRoot, "backlog", "changes", name);
}

/**
 * Generate a date-prefixed change directory name.
 * Format: YYYY-MM-DD-<name>
 */
export function datedChangeDirName(name: string): string {
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}-${name}`;
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
			// Extract requirement text from the first non-header content line,
			// falling back to the header name if no content follows.
			const lines = block.raw.split("\n").filter((l) => l.trim());
			const firstLine = lines.length > 1 ? lines[1]?.trim() : "";
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
 * Register `spec` command group with the CLI program.
 */
export function registerSpecCommand(program: Command): void {
	const specCmd = program.command("spec");

	specCmd
		.command("create <name>")
		.description("scaffold a new spec document in backlog/docs/")
		.action(async (name: string) => {
			const projectRoot = await requireProjectRoot();
			const core = new Core(projectRoot);

			// Check for existing spec with same title
			const existing = await core.filesystem.listDocuments();
			const duplicate = existing.find(
				(d) => d.title.toLowerCase() === name.toLowerCase() && d.type === "specification",
			);
			if (duplicate) {
				console.error(`Spec "${name}" already exists as document ${duplicate.id} in backlog/docs/`);
				process.exit(1);
			}

			const doc = await core.createDocumentFromInput({
				title: name,
				type: "specification",
				status: "draft",
				content: SPEC_TEMPLATE,
			});
			console.log(`Created spec "${name}" as document ${doc.id} in backlog/docs/`);
		});

	specCmd
		.command("validate <name>")
		.description("validate a spec document against SpecSchema")
		.action(async (name: string) => {
			const projectRoot = await requireProjectRoot();
			const core = new Core(projectRoot);

			const docs = await core.filesystem.listDocuments();
			const spec = docs.find((d) => d.title.toLowerCase() === name.toLowerCase() && d.type === "specification");
			if (!spec) {
				console.error(`Spec "${name}" not found in backlog/docs/.`);
				process.exit(1);
			}

			const content = spec.rawContent;
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
		.description("scaffold a new change set with date-prefixed directory")
		.action(async (name: string) => {
			const projectRoot = await requireProjectRoot();
			const dirName = datedChangeDirName(name);
			const dir = changeDir(dirName, projectRoot);

			if (existsSync(dir)) {
				console.error(`Change "${dirName}" already exists at ${dir.replace(projectRoot, ".")}`);
				process.exit(1);
			}

			await mkdir(dir, { recursive: true });

			console.log(`Created change "${dirName}" at ${dir.replace(projectRoot, ".")}/`);
			console.log("  Add spec-delta or new-spec files with `backlog change delta add`");
		});

	changeCmd
		.command("validate <name>")
		.description("validate a change set's artifact files")
		.action(async (name: string) => {
			const projectRoot = await requireProjectRoot();
			const dir = changeDir(name, projectRoot);

			if (!existsSync(dir)) {
				console.error(`Change "${name}" not found at ${dir.replace(projectRoot, ".")}`);
				process.exit(1);
			}

			const entries = await readdir(dir);
			const deltaFiles = entries.filter((e) => e.endsWith(".spec-delta.md"));
			const newSpecFiles = entries.filter((e) => e.endsWith(".new-spec.md"));

			if (deltaFiles.length === 0 && newSpecFiles.length === 0) {
				console.log(`No artifact files found in change "${name}".`);
				return;
			}

			let hasErrors = false;

			for (const f of [...deltaFiles, ...newSpecFiles]) {
				try {
					const filePath = join(dir, f);
					const fcontent = await Bun.file(filePath).text();

					if (f.endsWith(".spec-delta.md")) {
						const deltaPlan = parseDeltaSpec(fcontent);
						if (
							deltaPlan.added.length === 0 &&
							deltaPlan.modified.length === 0 &&
							deltaPlan.removed.length === 0 &&
							deltaPlan.renamed.length === 0
						) {
							console.error(`  ✗ ${f}: no recognized delta sections found`);
							hasErrors = true;
						} else {
							console.log(`  ✓ ${f}: valid`);
						}
					} else {
						const { parseMarkdown } = await import("../markdown/parser.ts");
						const { content: body } = parseMarkdown(fcontent);
						if (!body.includes("## Purpose") || !body.includes("## Requirements")) {
							console.error(`  ✗ ${f}: missing ## Purpose or ## Requirements section`);
							hasErrors = true;
						} else {
							console.log(`  ✓ ${f}: valid`);
						}
					}
				} catch (err) {
					console.error(`  ✗ ${f}: failed to parse - ${err instanceof Error ? err.message : String(err)}`);
					hasErrors = true;
				}
			}

			if (!hasErrors) {
				console.log(`✓ Change "${name}" is valid (${deltaFiles.length + newSpecFiles.length} artifact(s))`);
			} else {
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
					console.log(JSON.stringify({ changeName: name, artifacts: [] }));
				} else {
					console.log(`Change "${name}" not found.`);
					console.log("Run `backlog change create <name>` to scaffold a new change set.");
				}
				return;
			}

			// Detect completed artifacts using the flat checklist
			const completed = detectCompleted(CHANGE_ARTIFACTS, dir, projectRoot);

			// Compute per-artifact status using the flat checklist
			const statuses = computeArtifactStatus(completed, CHANGE_ARTIFACTS);
			const total = CHANGE_ARTIFACTS.length;
			const doneCount = statuses.filter((s) => s.status === "done").length;

			// Output
			if (options.json) {
				console.log(
					JSON.stringify(
						{
							changeName: name,
							artifacts: statuses,
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
			console.log(`${bold("Progress:")} ${doneCount}/${total} artifacts complete`);
			console.log("");

			for (const s of statuses) {
				if (s.status === "done") {
					console.log(`  ${green("✓")} ${s.id} (done)`);
				} else if (s.status === "ready") {
					console.log(`  ${blue("○")} ${s.id} (ready)`);
				} else {
					console.log(`  ${red("◉")} ${s.id} (blocked — needs: ${s.missingDeps?.join(", ")})`);
				}
			}

			// Next action hint
			const readyArtifacts = statuses.filter((s) => s.status === "ready");
			if (readyArtifacts.length > 0) {
				console.log("");
				console.log(`Next: ${readyArtifacts[0]?.id} is ready to be created`);
			} else if (doneCount < total) {
				console.log("");
				console.log("All remaining artifacts are blocked. Complete ready artifacts first.");
			} else {
				console.log("");
				console.log("All artifacts complete!");
			}
		});

	// ─── Sync subcommand ───

	changeCmd
		.command("sync <name>")
		.description("sync delta specs to main spec files")
		.option("--dry-run", "show what would happen without writing")
		.action(async (name: string, options: { dryRun?: boolean }) => {
			const projectRoot = await requireProjectRoot();
			const core = new Core(projectRoot);
			const summary = await syncSpecs(name, core, { dryRun: options.dryRun ?? false });
			console.log(summary);
		});

	// ─── Archive subcommand ───

	changeCmd
		.command("archive <name>")
		.description("archive a completed change set (moves to backlog/changes/archive/)")
		.option("--force", "bypass artifact completeness check")
		.option("--no-sync-check", "skip unsynced delta detection")
		.action(async (name: string, options: { force?: boolean; noSyncCheck?: boolean }) => {
			const projectRoot = await requireProjectRoot();
			const result = archiveChange(name, projectRoot, {
				force: options.force ?? false,
				noSyncCheck: options.noSyncCheck ?? false,
			});

			if (result.success) {
				console.log(`✓ Change "${result.changeName}" archived to ${result.archivePath}`);
				console.log(`  ${result.doneArtifacts.length}/${result.totalArtifacts} artifacts complete`);
				if (result.doneArtifacts.length > 0) {
					console.log(`  Done: ${result.doneArtifacts.join(", ")}`);
				}
				if (result.hasUnsyncedDeltas) {
					console.log("  (unsynced deltas were present but archived anyway)");
				}
			} else {
				console.error(`✗ ${result.reason}`);
				if (result.blockers.length > 0) {
					console.error("  Blocked artifacts:");
					for (const blocker of result.blockers) {
						console.error(`    ◉ ${blocker}`);
					}
				}
				if (result.doneArtifacts.length > 0) {
					console.error(`  Done: ${result.doneArtifacts.join(", ")}`);
				}
				process.exitCode = 1;
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

				const changeRoot = changeDir(change, projectRoot);
				const specDeltaPath = join(changeRoot, `${specName}.spec-delta.md`);
				const existingContent = existsSync(specDeltaPath) ? await Bun.file(specDeltaPath).text() : "";

				const entryName = options.req ?? specName;
				const newContent = buildDeltaSpecWithEntry(existingContent, {
					operation,
					name: entryName,
					statement: options.req,
					scenarioRawText,
					renameFrom: options.renameFrom,
					renameTo: options.renameTo,
				});

				await writeFile(specDeltaPath, newContent, "utf-8");
				console.log(`Added ${operation} delta "${entryName}" to ${specDeltaPath.replace(projectRoot, ".")}`);
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

			const entries = await readdir(changePath);
			const deltaFiles = entries.filter((e) => e.endsWith(".spec-delta.md")).sort();
			let flatIndex = 1;
			const result: Array<{
				index: number;
				operation: string;
				spec: string;
				name: string;
				description: string;
			}> = [];

			for (const deltaFile of deltaFiles) {
				const specFilePath = join(changePath, deltaFile);
				const specName = deltaFile.slice(0, -".spec-delta.md".length);
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

			// Walk through all spec-delta files to find the entry by flat index
			const entries = await readdir(changePath);
			const deltaFiles = entries.filter((e) => e.endsWith(".spec-delta.md")).sort();
			let remaining = index;

			for (const deltaFile of deltaFiles) {
				const specFilePath = join(changePath, deltaFile);
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
