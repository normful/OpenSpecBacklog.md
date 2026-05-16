import { describe, expect, it } from "bun:test";
import {
	ArtifactGraph,
	isGlobPattern,
	parseSchema,
	SchemaValidationError,
	SchemaYamlSchema,
} from "../openspec/artifact-graph/index.ts";

// ─── Helpers ───
interface ArtifactInput {
	id: string;
	generates: string;
	template: string;
	description?: string;
	requires?: string[];
}

function toArtifact(a: ArtifactInput) {
	return { ...a, description: a.description ?? "", requires: a.requires ?? [] };
}

function toSchemaYaml(artifacts: ArtifactInput[], extra?: Record<string, unknown>) {
	return JSON.stringify({
		name: "test",
		version: 1,
		description: "",
		artifacts: artifacts.map(toArtifact),
		...extra,
	});
}

const validArtifacts: ArtifactInput[] = [
	{ id: "proposal", generates: "proposal.md", template: "proposal.md" },
	{ id: "specs", generates: "specs/spec.md", template: "specs.md", requires: ["proposal"] },
	{ id: "design", generates: "design.md", template: "design.md", requires: ["proposal"] },
	{
		id: "tasks",
		generates: "tasks.md",
		template: "tasks.md",
		requires: ["specs", "design"],
	},
];

const validSchemaObject = JSON.parse(toSchemaYaml(validArtifacts, { name: "spec-driven" }));
const validSchemaYaml = toSchemaYaml(validArtifacts, { name: "spec-driven" });

function makeSchemaObject(artifacts: ArtifactInput[], extra?: Record<string, unknown>) {
	return JSON.parse(toSchemaYaml(artifacts, extra));
}

// ─── SchemaYaml Zod validation ───
describe("SchemaYamlSchema validation", () => {
	it("accepts a valid schema", () => {
		const result = SchemaYamlSchema.safeParse(validSchemaObject);
		expect(result.success).toBe(true);
	});

	it("rejects missing name", () => {
		const result = SchemaYamlSchema.safeParse({
			version: 1,
			artifacts: validSchemaObject.artifacts,
		});
		expect(result.success).toBe(false);
	});

	it("rejects non-positive version", () => {
		const result = SchemaYamlSchema.safeParse({
			name: "x",
			version: 0,
			artifacts: validSchemaObject.artifacts,
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty artifacts array", () => {
		const result = SchemaYamlSchema.safeParse({ name: "x", version: 1, artifacts: [] });
		expect(result.success).toBe(false);
	});

	it("rejects artifact without id", () => {
		const copy = {
			...validSchemaObject,
			artifacts: [{ generates: "x.md", template: "x.md", description: "" }],
		};
		const result = SchemaYamlSchema.safeParse(copy);
		expect(result.success).toBe(false);
	});

	it("defaults requires to empty array", () => {
		const schema = SchemaYamlSchema.parse(validSchemaObject);
		for (const a of schema.artifacts) {
			expect(Array.isArray(a.requires)).toBe(true);
		}
	});

	it("defaults description to empty string", () => {
		const minimal = SchemaYamlSchema.parse({
			name: "minimal",
			version: 1,
			artifacts: [toArtifact({ id: "a", generates: "a.md", template: "a.md" })],
		});
		const first = minimal.artifacts[0];
		expect(first).toBeDefined();
		expect(first?.description).toBe("");
	});
});

// ─── parseSchema ───
describe("parseSchema", () => {
	it("parses valid YAML string", () => {
		const schema = parseSchema(validSchemaYaml);
		expect(schema.name).toBe("spec-driven");
		expect(schema.artifacts).toHaveLength(4);
	});

	it("throws SchemaValidationError for duplicate artifact IDs", () => {
		const yaml = toSchemaYaml([
			{ id: "a", generates: "a.md", template: "a.md" },
			{ id: "a", generates: "b.md", template: "b.md" },
		]);
		expect(() => parseSchema(yaml)).toThrow(SchemaValidationError);
		expect(() => parseSchema(yaml)).toThrow("Duplicate artifact ID");
	});

	it("throws SchemaValidationError for invalid requires reference", () => {
		const yaml = toSchemaYaml([{ id: "a", generates: "a.md", template: "a.md", requires: ["nonexistent"] }]);
		expect(() => parseSchema(yaml)).toThrow(SchemaValidationError);
		expect(() => parseSchema(yaml)).toThrow("does not exist");
	});

	it("throws SchemaValidationError for circular deps", () => {
		const yaml = toSchemaYaml([
			{ id: "a", generates: "a.md", template: "a.md", requires: ["b"] },
			{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
		]);
		expect(() => parseSchema(yaml)).toThrow(SchemaValidationError);
		expect(() => parseSchema(yaml)).toThrow("Cyclic dependency");
	});

	it("throws SchemaValidationError for self-loop", () => {
		const yaml = toSchemaYaml([{ id: "a", generates: "a.md", template: "a.md", requires: ["a"] }]);
		expect(() => parseSchema(yaml)).toThrow(SchemaValidationError);
		expect(() => parseSchema(yaml)).toThrow("Cyclic dependency");
	});
});

// ─── ArtifactGraph ───
describe("ArtifactGraph", () => {
	function makeGraph(artifacts: ArtifactInput[]): ArtifactGraph {
		return ArtifactGraph.fromSchema(makeSchemaObject(artifacts));
	}

	// ─── getBuildOrder ───
	describe("getBuildOrder", () => {
		it("returns linear build order for chain deps", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
				{ id: "c", generates: "c.md", template: "c.md", requires: ["b"] },
			]);
			expect(graph.getBuildOrder()).toEqual(["a", "b", "c"]);
		});

		it("returns diamond build order (roots first, parallel branches sorted)", () => {
			const artifacts: ArtifactInput[] = [
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
				{ id: "c", generates: "c.md", template: "c.md", requires: ["a"] },
				{ id: "d", generates: "d.md", template: "d.md", requires: ["b", "c"] },
			];
			const graph = makeGraph(artifacts);
			const order = graph.getBuildOrder();
			expect(order[0]).toBe("a");
			expect(order.slice(1, 3).sort()).toEqual(["b", "c"]);
			expect(order[3]).toBe("d");
		});

		it("returns single artifact for singleton", () => {
			const graph = makeGraph([{ id: "only", generates: "only.md", template: "only.md" }]);
			expect(graph.getBuildOrder()).toEqual(["only"]);
		});

		it("returns sorted roots for independent artifacts", () => {
			const graph = makeGraph([
				{ id: "z", generates: "z.md", template: "z.md" },
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "m", generates: "m.md", template: "m.md" },
			]);
			expect(graph.getBuildOrder()).toEqual(["a", "m", "z"]);
		});
	});

	// ─── getNextArtifacts ───
	describe("getNextArtifacts", () => {
		it("returns all roots when nothing completed", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
			]);
			expect(graph.getNextArtifacts(new Set())).toEqual(["a"]);
		});

		it("returns next tier when deps completed", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
				{ id: "c", generates: "c.md", template: "c.md", requires: ["a"] },
			]);
			expect(graph.getNextArtifacts(new Set(["a"]))).toEqual(["b", "c"]);
		});

		it("returns empty when all artifacts completed", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
			]);
			expect(graph.getNextArtifacts(new Set(["a", "b"]))).toEqual([]);
		});

		it("does not return artifacts with unmet deps", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a", "c"] },
				{ id: "c", generates: "c.md", template: "c.md" },
			]);
			const next = graph.getNextArtifacts(new Set());
			expect(next).toEqual(["a", "c"]);
		});
	});

	// ─── getBlocked ───
	describe("getBlocked", () => {
		it("returns empty map when nothing blocked", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
			]);
			expect(graph.getBlocked(new Set(["a"]))).toEqual({});
		});

		it("returns unmet deps for blocked artifacts", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
			]);
			expect(graph.getBlocked(new Set())).toEqual({ b: ["a"] });
		});

		it("reports multiple dependencies for deeply blocked artifact", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
				{ id: "c", generates: "c.md", template: "c.md", requires: ["a", "b"] },
			]);
			const blocked = graph.getBlocked(new Set(["a"]));
			expect(blocked.b).toBeUndefined(); // b is ready
			expect(blocked.c).toEqual(["b"]); // c blocked on b
		});

		it("omits completed artifacts from blocked map", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md", requires: ["a"] },
			]);
			const blocked = graph.getBlocked(new Set(["a", "b"]));
			expect(blocked).toEqual({});
		});
	});

	// ─── isComplete ───
	describe("isComplete", () => {
		it("returns false when no artifacts completed", () => {
			const graph = makeGraph([{ id: "a", generates: "a.md", template: "a.md" }]);
			expect(graph.isComplete(new Set())).toBe(false);
		});

		it("returns false when some artifacts missing", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md" },
			]);
			expect(graph.isComplete(new Set(["a"]))).toBe(false);
		});

		it("returns true when all artifacts completed", () => {
			const graph = makeGraph([
				{ id: "a", generates: "a.md", template: "a.md" },
				{ id: "b", generates: "b.md", template: "b.md" },
			]);
			expect(graph.isComplete(new Set(["a", "b"]))).toBe(true);
		});

		it("returns true for singleton after completion", () => {
			const graph = makeGraph([{ id: "only", generates: "only.md", template: "only.md" }]);
			expect(graph.isComplete(new Set(["only"]))).toBe(true);
		});
	});

	// ─── getArtifact / getAllArtifacts / name/version ───
	describe("accessors", () => {
		it("getArtifact returns artifact by ID", () => {
			const graph = makeGraph(validArtifacts);
			const a = graph.getArtifact("proposal");
			expect(a).toBeDefined();
			expect(a?.id).toBe("proposal");
		});

		it("getArtifact returns undefined for missing ID", () => {
			const graph = makeGraph(validArtifacts);
			expect(graph.getArtifact("nonexistent")).toBeUndefined();
		});

		it("getAllArtifacts returns all artifacts", () => {
			const graph = makeGraph(validArtifacts);
			expect(graph.getAllArtifacts()).toHaveLength(4);
		});

		it("getName and getVersion return schema metadata", () => {
			const graph = ArtifactGraph.fromSchema(makeSchemaObject([{ id: "a", generates: "a.md", template: "a.md" }]));
			expect(graph.getName()).toBe("test");
			expect(graph.getVersion()).toBe(1);
		});
	});
});

// ─── isGlobPattern ───
describe("isGlobPattern", () => {
	it("detects asterisk globs", () => {
		expect(isGlobPattern("specs/*.md")).toBe(true);
	});

	it("detects question mark globs", () => {
		expect(isGlobPattern("spec?.md")).toBe(true);
	});

	it("detects bracket globs", () => {
		expect(isGlobPattern("spec[12].md")).toBe(true);
	});

	it("returns false for simple paths", () => {
		expect(isGlobPattern("proposal.md")).toBe(false);
		expect(isGlobPattern("specs/spec.md")).toBe(false);
	});
});

// ─── detectCompleted (via state.ts — uses real filesystem) ───
describe("detectCompleted", () => {
	it("returns empty set for missing change directory", async () => {
		const { detectCompleted } = await import("../openspec/artifact-graph/state.ts");
		const graph = ArtifactGraph.fromSchema(makeSchemaObject([{ id: "a", generates: "a.md", template: "a.md" }]));
		const result = detectCompleted(graph, "/tmp/nonexistent-dir-12345");
		expect(result.size).toBe(0);
	});

	it("detects completed artifacts by file existence", async () => {
		const { detectCompleted } = await import("../openspec/artifact-graph/state.ts");
		const tmpDir = `/tmp/backlog-test-detect-${Date.now()}`;
		const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
		mkdirSync(tmpDir, { recursive: true });
		writeFileSync(`${tmpDir}/proposal.md`, "content");

		const graph = ArtifactGraph.fromSchema(
			makeSchemaObject([
				{ id: "proposal", generates: "proposal.md", template: "proposal.md" },
				{ id: "specs", generates: "specs.md", template: "specs.md", requires: ["proposal"] },
			]),
		);

		const completed = detectCompleted(graph, tmpDir);
		expect(completed.has("proposal")).toBe(true);
		expect(completed.has("specs")).toBe(false);

		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("handles glob patterns in generates", async () => {
		const { detectCompleted } = await import("../openspec/artifact-graph/state.ts");
		const tmpDir = `/tmp/backlog-test-glob-${Date.now()}`;
		const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
		mkdirSync(tmpDir, { recursive: true });
		mkdirSync(`${tmpDir}/specs`, { recursive: true });
		writeFileSync(`${tmpDir}/specs/alpha.md`, "content");
		writeFileSync(`${tmpDir}/specs/beta.md`, "content");

		const graph = ArtifactGraph.fromSchema(
			makeSchemaObject([
				{
					id: "specs",
					generates: "specs/*.md",
					template: "specs.md",
					requires: ["proposal"],
				},
				{ id: "proposal", generates: "proposal.md", template: "proposal.md" },
			]),
		);

		const completed = detectCompleted(graph, tmpDir);
		expect(completed.has("specs")).toBe(true); // files exist matching glob
		expect(completed.has("proposal")).toBe(false); // proposal.md doesn't exist

		rmSync(tmpDir, { recursive: true, force: true });
	});
});
