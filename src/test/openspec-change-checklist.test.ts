/**
 * Tests for the flat change checklist module.
 *
 * Replaces openspec-artifact-graph.test.ts and openspec-change-status.test.ts.
 * Tests pure status computation (no filesystem) and file-existence detection (tmpdir).
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
		const completed = new Set(["proposal", "deltas", "design", "publish"]);
		const statuses = computeArtifactStatus(completed);

		expect(statuses.every((s) => s.status === "done")).toBe(true);
		expect(statuses).toHaveLength(4);
	});

	it("nothing done: roots ready, publish blocked", () => {
		const completed = new Set<string>();
		const statuses = computeArtifactStatus(completed);

		expect(statuses).toEqual([
			{ id: "proposal", label: "Proposal", status: "ready" },
			{ id: "deltas", label: "Delta specs", status: "ready" },
			{ id: "design", label: "Design doc", status: "ready" },
			{ id: "publish", label: "Published docs", status: "blocked", missingDeps: ["design"] },
		]);
	});

	it("root only completed → publish stays blocked", () => {
		const completed = new Set(["proposal"]);
		const statuses = computeArtifactStatus(completed);

		expect(statuses).toEqual([
			{ id: "proposal", label: "Proposal", status: "done" },
			{ id: "deltas", label: "Delta specs", status: "ready" },
			{ id: "design", label: "Design doc", status: "ready" },
			{ id: "publish", label: "Published docs", status: "blocked", missingDeps: ["design"] },
		]);
	});

	it("middle done → publish becomes ready", () => {
		const completed = new Set(["proposal", "deltas", "design"]);
		const statuses = computeArtifactStatus(completed);

		expect(statuses).toEqual([
			{ id: "proposal", label: "Proposal", status: "done" },
			{ id: "deltas", label: "Delta specs", status: "done" },
			{ id: "design", label: "Design doc", status: "done" },
			{ id: "publish", label: "Published docs", status: "ready" },
		]);
	});

	it("parallel artifacts (deltas, design) both ready from root", () => {
		const completed = new Set(["proposal"]);
		const statuses = computeArtifactStatus(completed);

		const deltas = statuses.find((s) => s.id === "deltas");
		const design = statuses.find((s) => s.id === "design");
		expect(deltas?.status).toBe("ready");
		expect(design?.status).toBe("ready");
	});

	it("blocked shows correct missingDeps for publish", () => {
		const completed = new Set<string>();
		const statuses = computeArtifactStatus(completed);

		const publish = statuses.find((s) => s.id === "publish");
		expect(publish?.status).toBe("blocked");
		expect(publish?.missingDeps).toEqual(["design"]);
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
		const completed = new Set(["proposal", "deltas", "design", "publish"]);
		expect(isChangeComplete(completed)).toBe(true);
	});

	it("returns false when partial set", () => {
		const completed = new Set(["proposal"]);
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
		expect(isGlobPattern("specs/**/*.md")).toBe(true);
	});

	it("detects ? pattern", () => {
		expect(isGlobPattern("file?.md")).toBe(true);
	});

	it("detects [ pattern", () => {
		expect(isGlobPattern("file[0-9].md")).toBe(true);
	});

	it("returns false for plain path", () => {
		expect(isGlobPattern("proposal.md")).toBe(false);
		expect(isGlobPattern("design.md")).toBe(false);
	});
});

// ─── File-existence detection tests: detectCompleted ───

describe("detectCompleted", () => {
	it("proposal complete when proposal.md exists in change dir", () => {
		const dir = makeTestDir("proposal-done");
		writeFileSync(join(dir, "proposal.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir);

		expect(completed.has("proposal")).toBe(true);
		expect(completed.has("deltas")).toBe(false);
		expect(completed.has("design")).toBe(false);
		expect(completed.has("publish")).toBe(false);

		cleanupDir(dir);
	});

	it("deltas complete with glob matching spec files", () => {
		const dir = makeTestDir("deltas-glob");
		mkdirSync(join(dir, "specs"), { recursive: true });
		writeFileSync(join(dir, "specs", "auth.md"), "content");
		writeFileSync(join(dir, "specs", "api.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir);

		expect(completed.has("deltas")).toBe(true);
		expect(completed.has("proposal")).toBe(false);

		cleanupDir(dir);
	});

	it("publish complete with projectRoot-relative glob", () => {
		const dir = makeTestDir("publish-root-relative");
		const projectRoot = dir;
		const backlogDocsDir = join(dir, "backlog", "docs");
		mkdirSync(backlogDocsDir, { recursive: true });
		writeFileSync(join(backlogDocsDir, "guide.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir, projectRoot);

		expect(completed.has("publish")).toBe(true);

		cleanupDir(dir);
	});

	it("publish NOT complete without projectRoot arg", () => {
		// When projectRoot is not passed, publish's backlog/docs/** /* glob is resolved
		// against changeDir. If changeDir is NOT the project root, the glob won't match.
		const tempRoot = makeTestDir("publish-root");
		const changeDir = join(tempRoot, "backlog", "changes", "my-change");
		mkdirSync(changeDir, { recursive: true });
		const backlogDocsDir = join(tempRoot, "backlog", "docs");
		mkdirSync(backlogDocsDir, { recursive: true });
		writeFileSync(join(backlogDocsDir, "guide.md"), "content");

		// changeDir is a subdir of tempRoot, so backlog/docs/guide.md lives outside changeDir
		const completed = detectCompleted(CHANGE_ARTIFACTS, changeDir);

		expect(completed.has("publish")).toBe(false);

		cleanupDir(tempRoot);
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

	it("all 4 artifacts detected when all files present", () => {
		const dir = makeTestDir("all-four");
		const projectRoot = dir;

		// proposal
		writeFileSync(join(dir, "proposal.md"), "content");
		// deltas
		mkdirSync(join(dir, "specs"), { recursive: true });
		writeFileSync(join(dir, "specs", "auth.md"), "content");
		// design
		writeFileSync(join(dir, "design.md"), "content");
		// publish
		const backlogDocsDir = join(dir, "backlog", "docs");
		mkdirSync(backlogDocsDir, { recursive: true });
		writeFileSync(join(backlogDocsDir, "guide.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir, projectRoot);

		expect(completed).toEqual(new Set(["proposal", "deltas", "design", "publish"]));

		cleanupDir(dir);
	});
});

// ─── File-existence tests: resolveArtifactOutputs ───

describe("resolveArtifactOutputs", () => {
	it("resolves simple non-glob path", () => {
		const dir = makeTestDir("simple-path");
		writeFileSync(join(dir, "proposal.md"), "content");

		const proposal = CHANGE_ARTIFACTS.find((a) => a.id === "proposal")!;
		const outputs = resolveArtifactOutputs(dir, proposal);

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toEndWith("proposal.md");

		cleanupDir(dir);
	});

	it("resolves glob pattern to multiple files", () => {
		const dir = makeTestDir("glob-multi");
		mkdirSync(join(dir, "specs"), { recursive: true });
		writeFileSync(join(dir, "specs", "auth.md"), "content");
		writeFileSync(join(dir, "specs", "api.md"), "content");

		const deltas = CHANGE_ARTIFACTS.find((a) => a.id === "deltas")!;
		const outputs = resolveArtifactOutputs(dir, deltas);

		expect(outputs).toHaveLength(2);

		cleanupDir(dir);
	});

	it("resolves projectRootRelative artifact against project root", () => {
		const dir = makeTestDir("proj-rel");
		const backlogDocs = join(dir, "backlog", "docs");
		mkdirSync(backlogDocs, { recursive: true });
		writeFileSync(join(backlogDocs, "guide.md"), "content");

		const publish = CHANGE_ARTIFACTS.find((a) => a.id === "publish")!;
		const outputs = resolveArtifactOutputs(dir, publish, dir);

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toContain("backlog/docs/guide.md");

		cleanupDir(dir);
	});

	it("returns empty array for nonexistent file", () => {
		const dir = makeTestDir("nonexistent");

		const proposal = CHANGE_ARTIFACTS.find((a) => a.id === "proposal")!;
		const outputs = resolveArtifactOutputs(dir, proposal);

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
	it("produces correct statuses when proposal and design exist", () => {
		const dir = makeTestDir("int-partial");
		writeFileSync(join(dir, "proposal.md"), "content");
		writeFileSync(join(dir, "design.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir);
		const statuses = computeArtifactStatus(completed);

		expect(statuses.find((s) => s.id === "proposal")?.status).toBe("done");
		expect(statuses.find((s) => s.id === "deltas")?.status).toBe("ready");
		expect(statuses.find((s) => s.id === "design")?.status).toBe("done");
		expect(statuses.find((s) => s.id === "publish")?.status).toBe("ready");

		expect(isChangeComplete(completed)).toBe(false);

		cleanupDir(dir);
	});

	it("produces correct statuses when all files present", () => {
		const dir = makeTestDir("int-all-done");
		const projectRoot = dir;

		writeFileSync(join(dir, "proposal.md"), "content");
		mkdirSync(join(dir, "specs"), { recursive: true });
		writeFileSync(join(dir, "specs", "auth.md"), "content");
		writeFileSync(join(dir, "design.md"), "content");
		const backlogDocs = join(dir, "backlog", "docs");
		mkdirSync(backlogDocs, { recursive: true });
		writeFileSync(join(backlogDocs, "guide.md"), "content");

		const completed = detectCompleted(CHANGE_ARTIFACTS, dir, projectRoot);
		const statuses = computeArtifactStatus(completed);

		expect(statuses.every((s) => s.status === "done")).toBe(true);
		expect(isChangeComplete(completed)).toBe(true);

		cleanupDir(dir);
	});
});
