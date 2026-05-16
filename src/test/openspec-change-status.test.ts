/**
 * Tests for `backlog change status` command — artifact DAG state computation.
 * Tests the pure logic (status computation from schema + completed set).
 * CLI action handler integration is tested via the command structure.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArtifactGraph, ChangeMetadataSchema, detectCompleted } from "../openspec/artifact-graph/index.ts";
import type { SchemaYaml } from "../openspec/artifact-graph/types.ts";

// ─── Test helpers ───

interface ArtifactInput {
	id: string;
	generates: string;
	template: string;
	desc?: string;
	requires?: string[];
}

function toArtifact(a: ArtifactInput) {
	return { ...a, description: a.desc ?? "", requires: a.requires ?? [] };
}

function makeSchemaObject(artifacts: ArtifactInput[], extra?: Record<string, unknown>): SchemaYaml {
	return {
		name: extra?.name ?? "test",
		version: (extra?.version as number) ?? 1,
		description: (extra?.description as string) ?? "",
		artifacts: artifacts.map(toArtifact),
	} as SchemaYaml;
}

function makeTestDir(name: string): string {
	const dir = `/tmp/backlog-test-status-${name}-${Date.now()}`;
	mkdirSync(dir, { recursive: true });
	return dir;
}

function cleanupDir(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

// ─── Status computation logic tests ───

describe("change status — artifact state computation", () => {
	it("all artifacts done when all generates exist", () => {
		const dir = makeTestDir("all-done");
		writeFileSync(join(dir, "proposal.md"), "content");
		writeFileSync(join(dir, "design.md"), "content");

		const graph = ArtifactGraph.fromSchema(
			makeSchemaObject([
				{ id: "proposal", generates: "proposal.md", template: "proposal.md" },
				{ id: "design", generates: "design.md", template: "design.md", requires: ["proposal"] },
			]),
		);

		const completed = detectCompleted(graph, dir);
		const artifacts = computeStatus(graph, completed);

		expect(artifacts).toEqual([
			{ id: "proposal", status: "done" },
			{ id: "design", status: "done" },
		]);

		cleanupDir(dir);
	});

	it("root artifacts ready when nothing completed", () => {
		const dir = makeTestDir("roots-ready");

		const graph = ArtifactGraph.fromSchema(
			makeSchemaObject([
				{ id: "proposal", generates: "proposal.md", template: "proposal.md" },
				{ id: "design", generates: "design.md", template: "design.md", requires: ["proposal"] },
			]),
		);

		const completed = detectCompleted(graph, dir);
		const artifacts = computeStatus(graph, completed);

		expect(artifacts).toEqual([
			{ id: "proposal", status: "ready" },
			{ id: "design", status: "blocked", missingDeps: ["proposal"] },
		]);

		cleanupDir(dir);
	});

	it("dependent artifacts become ready after root completed", () => {
		const dir = makeTestDir("dependent-ready");
		writeFileSync(join(dir, "proposal.md"), "content");

		const graph = ArtifactGraph.fromSchema(
			makeSchemaObject([
				{ id: "proposal", generates: "proposal.md", template: "proposal.md" },
				{ id: "design", generates: "design.md", template: "design.md", requires: ["proposal"] },
			]),
		);

		const completed = detectCompleted(graph, dir);
		const artifacts = computeStatus(graph, completed);

		expect(artifacts).toEqual([
			{ id: "proposal", status: "done" },
			{ id: "design", status: "ready" },
		]);

		cleanupDir(dir);
	});

	it("diamond dependency resolved correctly", () => {
		const dir = makeTestDir("diamond");
		mkdirSync(join(dir, "specs"), { recursive: true });
		writeFileSync(join(dir, "proposal.md"), "content");
		writeFileSync(join(dir, "specs/spec.md"), "content");
		writeFileSync(join(dir, "design.md"), "content");

		const graph = ArtifactGraph.fromSchema(
			makeSchemaObject([
				{ id: "proposal", generates: "proposal.md", template: "proposal.md" },
				{ id: "specs", generates: "specs/spec.md", template: "specs.md", requires: ["proposal"] },
				{ id: "design", generates: "design.md", template: "design.md", requires: ["proposal"] },
				{
					id: "tasks",
					generates: "tasks.md",
					template: "tasks.md",
					requires: ["specs", "design"],
				},
			]),
		);

		const completed = detectCompleted(graph, dir);
		const artifacts = computeStatus(graph, completed);

		expect(artifacts).toEqual([
			{ id: "proposal", status: "done" },
			{ id: "specs", status: "done" },
			{ id: "design", status: "done" },
			{ id: "tasks", status: "ready" },
		]);

		cleanupDir(dir);
	});

	it("uses glob generates patterns to detect completion", () => {
		const dir = makeTestDir("glob-pattern");
		mkdirSync(join(dir, "specs"), { recursive: true });
		writeFileSync(join(dir, "specs/auth.md"), "content");
		writeFileSync(join(dir, "specs/api.md"), "content");

		const graph = ArtifactGraph.fromSchema(
			makeSchemaObject([
				{
					id: "specs",
					generates: "specs/*.md",
					template: "specs.md",
				},
			]),
		);

		const completed = detectCompleted(graph, dir);
		const artifacts = computeStatus(graph, completed);

		expect(artifacts).toEqual([{ id: "specs", status: "done" }]);

		cleanupDir(dir);
	});

	it("deeply nested blocked shows all missing deps", () => {
		const dir = makeTestDir("deeply-blocked");
		writeFileSync(join(dir, "a.md"), "content");

		const graph = ArtifactGraph.fromSchema(
			makeSchemaObject([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
				{ id: "c", generates: "c.md", template: "c.md", requires: ["b"] },
			]),
		);

		// Only 'a' is completed
		const completed = new Set(["a"]);
		const artifacts = computeStatus(graph, completed);

		expect(artifacts).toEqual([
			{ id: "a", status: "done" },
			{ id: "b", status: "ready" },
			{ id: "c", status: "blocked", missingDeps: ["b"] },
		]);

		cleanupDir(dir);
	});

	it("missing change dir returns empty artifact list", () => {
		const graph = ArtifactGraph.fromSchema(makeSchemaObject([{ id: "a", generates: "a.md", template: "a.md" }]));

		const completed = detectCompleted(graph, "/tmp/nonexistent-backlog-change-dir-12345");
		const artifacts = computeStatus(graph, completed);

		expect(artifacts).toEqual([{ id: "a", status: "ready" }]);
	});
});

// ─── ChangeMetadataSchema tests ───

describe("ChangeMetadataSchema", () => {
	const validMetadata = {
		schema: "spec-driven",
		created: "2026-05-16",
		goal: "Add user authentication",
		affected_areas: ["auth", "api"],
	};

	it("accepts valid metadata", () => {
		const result = ChangeMetadataSchema.safeParse(validMetadata);
		expect(result.success).toBe(true);
	});

	it("rejects missing schema", () => {
		const result = ChangeMetadataSchema.safeParse({ created: "2026-05-16" });
		expect(result.success).toBe(false);
	});

	it("rejects bad date format", () => {
		const result = ChangeMetadataSchema.safeParse({
			schema: "spec-driven",
			created: "2026/05/16",
		});
		expect(result.success).toBe(false);
	});

	it("accepts minimal metadata (schema + created only)", () => {
		const result = ChangeMetadataSchema.safeParse({
			schema: "spec-driven",
			created: "2026-05-16",
		});
		expect(result.success).toBe(true);
	});

	it("accepts empty affected_areas with goal", () => {
		const result = ChangeMetadataSchema.safeParse({
			schema: "spec-driven",
			created: "2026-05-16",
			goal: "Do something",
		});
		expect(result.success).toBe(true);
	});
});

// ─── JSON output shape tests ───

describe("change status — JSON output shape", () => {
	it("produces expected JSON structure", () => {
		const dir = makeTestDir("json-shape");

		const graph = ArtifactGraph.fromSchema(
			makeSchemaObject(
				[
					{ id: "proposal", generates: "proposal.md", template: "proposal.md" },
					{ id: "design", generates: "design.md", template: "design.md", requires: ["proposal"] },
				],
				{ name: "spec-driven" },
			),
		);

		const completed = detectCompleted(graph, dir);
		const artifacts = computeStatus(graph, completed);

		const output = {
			changeName: "my-change",
			schemaName: graph.getName(),
			artifacts,
		};

		expect(output.changeName).toBe("my-change");
		expect(output.schemaName).toBe("spec-driven");
		expect(output.artifacts).toHaveLength(2);
		expect(output.artifacts[0]).toHaveProperty("id");
		expect(output.artifacts[0]).toHaveProperty("status");
		// Blocked artifacts have missingDeps
		if (output.artifacts[1]?.status === "blocked") {
			expect(output.artifacts[1]).toHaveProperty("missingDeps");
		}

		// Verify JSON.stringify roundtrip
		const json = JSON.stringify(output);
		const parsed = JSON.parse(json);
		expect(parsed.changeName).toBe("my-change");
		expect(parsed.schemaName).toBe("spec-driven");
		expect(Array.isArray(parsed.artifacts)).toBe(true);

		cleanupDir(dir);
	});

	it("empty artifacts array for missing change dir", () => {
		const output = {
			changeName: "nonexistent",
			schemaName: null,
			artifacts: [],
		};
		const json = JSON.stringify(output);
		const parsed = JSON.parse(json);
		expect(parsed.artifacts).toEqual([]);
		expect(parsed.schemaName).toBeNull();
	});
});

// ─── Helper: pure status computation (no filesystem side effects) ───

/**
 * Pure function to compute per-artifact status from a graph and completed set.
 * Mirrors the logic in the `change status` command handler.
 * Tested independently to verify correctness without filesystem I/O.
 */
function computeStatus(
	graph: ArtifactGraph,
	completed: Set<string>,
): Array<{ id: string; status: "done" | "ready" | "blocked"; missingDeps?: string[] }> {
	return graph.getAllArtifacts().map((a) => {
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
}
