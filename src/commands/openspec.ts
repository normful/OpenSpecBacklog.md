/**
 * OpenSpec CLI command group - spec and change management.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { requireProjectRoot } from "../cli.ts";
import { Core } from "../core/backlog.ts";
import { parseChange } from "../openspec/parsers/change-parser.ts";
import { extractRequirementsSection, parseDeltaSpec } from "../openspec/parsers/index.ts";
import { ChangeSchema, SpecSchema } from "../openspec/schemas/index.ts";
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
}
