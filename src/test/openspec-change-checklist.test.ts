/**
 * Tests for the flat change checklist module (v2).
 *
 * 2 artifacts: deltas (spec-delta files), new-specs (new-spec files).
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	CHANGE_ARTIFACTS,
	type ChangeArtifact,
	computeArtifactStatus,
	detectCompleted,
	isChangeComplete,
	isGlobPattern,
	resolveArtifactOutputs,
} from "../openspec/change-checklist.ts";

// ─── Test helpers ───

function makeTestDir(name: string): string {
	const dir = `/tmp/backlog-checklist-test-${name}-${Date.now()}`;
	mkdirSync(dir, { recursive: true });
	return dir;
}

function cleanupDir(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

// ─── Pure function tests: computeArtifactStatus ───

describe("computeArtifactStatus", () => {
	it("all done when all artifact IDs in completed set", () => {
		const completed = new Set(["deltas", "new-specs"]);
		const statuses = computeArtifactStatus(completed);

		expect(statuses.every((s) => s.status === "done")).toBe(true);
		expect(statuses).toHaveLength(2);
	});

	it("nothing done: both ready (no dependencies)", () => {
		const completed = new Set<string>();
		const statuses = computeArtifactStatus(completed);

		expect(statuses).toEqual([
			{ id: "deltas", label: "Delta specs", status: "ready" },
			{ id: "new-specs", label: "New specs", status: "ready" },
		]);
	});

	it("partial completion: one done, one ready", () => {
		const completed = new Set(["deltas"]);
		const statuses = computeArtifactStatus(completed);

		expect(statuses).toEqual([
			{ id: "deltas", label: "Delta specs", status: "done" },
			{ id: "new-specs", label: "New specs", status: "ready" },
		]);
	});

	it("uses custom artifact list when provided", () => {
		const customArtifacts: ChangeArtifact[] = [
			{ id: "a", label: "A", generates: "a.md", projectRootRelative: false, dependsOn: [] },
			{ id: "b", label: "B", generates: "b.md", projectRootRelative: false, dependsOn: ["a"] },
		];
		const completed = new Set<string>();
		const statuses = computeArtifactStatus(completed, customArtifacts);

		expect(statuses).toEqual([
			{ id: "a", label: "A", status: "ready" },
			{ id: "b", label: "B", status: "blocked", missingDeps: ["a"] },
		]);
	});
});

// ─── Pure function tests: isChangeComplete ───

describe("isChangeComplete", () => {
	it("returns true when all artifact IDs in completed set", () => {
		const completed = new Set(["deltas", "new-specs"]);
		expect(isChangeComplete(completed)).toBe(true);
	});

	it("returns false when partial set", () => {
		const completed = new Set(["deltas"]);
		expect(isChangeComplete(completed)).toBe(false);
	});

	it("returns false for empty set", () => {
		expect(isChangeComplete(new Set())).toBe(false);
	});

	it("uses custom artifact list when provided", () => {
		const customArtifacts: ChangeArtifact[] = [
			{ id: "a", label: "A", generates: "a.md", projectRootRelative: false, dependsOn: [] },
		];
		expect(isChangeComplete(new Set(["a"]), customArtifacts)).toBe(true);
		expect(isChangeComplete(new Set<string>(), customArtifacts)).toBe(false);
	});
});

// ─── Pure function tests: isGlobPattern ───

describe("isGlobPattern", () => {
	it("detects * pattern", () => {
		expect(isGlobPattern("*.spec-delta.md")).toBe(true);
	});

	it("detects ? pattern", () => {
		expect(isGlobPattern("file?.md")).toBe(true);
	});

	it("detects [ pattern", () => {
		expect(isGlobPattern("file[0-9].md")).toBe(true);
	});

	it("returns false for plain path", () => {
		expect(isGlobPattern("plain.md")).toBe(false);
	});
});

// ─── File-existence detection tests: detectCompleted ───

describe("detectCompleted", () => {
	it("deltas complete when .spec-delta.md file exists in change dir", () => {
		const dir = makeTestDir("deltas-done");
		writeFileSync(join(dir, "auth.spec-delta.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir);

		expect(completed.has("deltas")).toBe(true);
		expect(completed.has("new-specs")).toBe(false);

		cleanupDir(dir);
	});

	it("new-specs complete when .new-spec.md file exists", () => {
		const dir = makeTestDir("new-specs-done");
		writeFileSync(join(dir, "billing.new-spec.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir);

		expect(completed.has("new-specs")).toBe(true);
		expect(completed.has("deltas")).toBe(false);

		cleanupDir(dir);
	});

	it("missing change dir returns empty set", () => {
		const completed = detectCompleted(CHANGE_ARTIFACTS, "/tmp/nonexistent-change-dir-xyz");

		expect(completed.size).toBe(0);
	});

	it("no matching glob files returns empty set (change dir exists but empty)", () => {
		const dir = makeTestDir("empty-glob");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir);

		expect(completed.size).toBe(0);

		cleanupDir(dir);
	});

	it("both artifacts detected when both file types present", () => {
		const dir = makeTestDir("both-artifacts");

		writeFileSync(join(dir, "auth.spec-delta.md"), "content");
		writeFileSync(join(dir, "billing.new-spec.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir);

		expect(completed).toEqual(new Set(["deltas", "new-specs"]));

		cleanupDir(dir);
	});
});

// ─── File-existence tests: resolveArtifactOutputs ───

describe("resolveArtifactOutputs", () => {
	it("resolves glob pattern for spec-delta files", () => {
		const dir = makeTestDir("glob-spec-delta");
		writeFileSync(join(dir, "auth.spec-delta.md"), "content");
		writeFileSync(join(dir, "api.spec-delta.md"), "content");

		const deltas = CHANGE_ARTIFACTS.find((a) => a.id === "deltas")!;
		const outputs = resolveArtifactOutputs(dir, deltas);

		expect(outputs).toHaveLength(2);

		cleanupDir(dir);
	});

	it("resolves glob pattern for new-spec files", () => {
		const dir = makeTestDir("glob-new-spec");
		writeFileSync(join(dir, "billing.new-spec.md"), "content");

		const newSpecs = CHANGE_ARTIFACTS.find((a) => a.id === "new-specs")!;
		const outputs = resolveArtifactOutputs(dir, newSpecs);

		expect(outputs).toHaveLength(1);

		cleanupDir(dir);
	});

	it("returns empty array for nonexistent files", () => {
		const dir = makeTestDir("nonexistent");

		const deltas = CHANGE_ARTIFACTS.find((a) => a.id === "deltas")!;
		const outputs = resolveArtifactOutputs(dir, deltas);

		expect(outputs).toEqual([]);

		cleanupDir(dir);
	});

	it("uses custom artifact with projectRootRelative false", () => {
		const dir = makeTestDir("custom-artifact");
		writeFileSync(join(dir, "my-file.md"), "content");

		const custom: ChangeArtifact = {
			id: "custom",
			label: "Custom",
			generates: "my-file.md",
			projectRootRelative: false,
			dependsOn: [],
		};
		const outputs = resolveArtifactOutputs(dir, custom);

		expect(outputs).toHaveLength(1);

		cleanupDir(dir);
	});
});

// ─── Integration: detectCompleted + computeArtifactStatus end-to-end ───

describe("detectCompleted + computeArtifactStatus integration", () => {
	it("produces correct statuses when only spec-delta exists", () => {
		const dir = makeTestDir("int-partial");
		writeFileSync(join(dir, "auth.spec-delta.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir);
		const statuses = computeArtifactStatus(completed);

		expect(statuses.find((s) => s.id === "deltas")?.status).toBe("done");
		expect(statuses.find((s) => s.id === "new-specs")?.status).toBe("ready");
		expect(isChangeComplete(completed)).toBe(false);

		cleanupDir(dir);
	});

	it("produces correct statuses when all artifacts present", () => {
		const dir = makeTestDir("int-all-done");

		writeFileSync(join(dir, "auth.spec-delta.md"), "content");
		writeFileSync(join(dir, "billing.new-spec.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir);
		const statuses = computeArtifactStatus(completed);

		expect(statuses.every((s) => s.status === "done")).toBe(true);
		expect(isChangeComplete(completed)).toBe(true);

		cleanupDir(dir);
	});
});
