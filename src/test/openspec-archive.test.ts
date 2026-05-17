/**
 * Tests for `backlog change archive` command — checklist-aware archive pipeline.
 * Tests the pure archive logic: completeness check, unsynced delta detection,
 * directory move, force override, and error reporting.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { archiveChange, archiveDirName, hasUnsyncedDeltas } from "../openspec/archive.ts";

// ─── Test helpers ───

interface TestEnv {
	root: string;
	changesDir: string;
}

function createTestEnv(name: string): TestEnv {
	const root = `/tmp/backlog-archive-test-${name}-${Date.now()}`;
	mkdirSync(root, { recursive: true });
	const changesDir = join(root, "backlog", "changes");
	mkdirSync(changesDir, { recursive: true });
	return { root, changesDir };
}

function cleanup(env: TestEnv): void {
	rmSync(env.root, { recursive: true, force: true });
}

function createChangeDir(env: TestEnv, name: string, files?: Record<string, string>): void {
	const dir = join(env.changesDir, name);
	mkdirSync(dir, { recursive: true });

	// Use provided files if given, otherwise create defaults
	const filesToWrite = files ?? {
		"proposal.md": "## Why\n\nTest change.\n## What Changes\n\n- **test:** Add feature.\n",
		"design.md": "# Design\n\nTest design.\n",
	};

	for (const [filename, content] of Object.entries(filesToWrite)) {
		const fullPath = join(dir, filename);
		// Create nested dirs if needed
		const parentDir = fullPath.slice(0, fullPath.lastIndexOf("/"));
		if (parentDir && !existsSync(parentDir)) {
			mkdirSync(parentDir, { recursive: true });
		}
		writeFileSync(fullPath, content, "utf-8");
	}
}

/**
 * Create publish artifact files (backlog/docs/) at the project root level.
 * Needed when a test requires all 4 change artifacts to be complete.
 */
function createPublishFiles(env: TestEnv, files?: Record<string, string>): void {
	const docsDir = join(env.root, "backlog", "docs");
	mkdirSync(docsDir, { recursive: true });
	const docsToWrite = files ?? { "guide.md": "# Guide\n\nTest doc.\n" };
	for (const [filename, content] of Object.entries(docsToWrite)) {
		writeFileSync(join(docsDir, filename), content, "utf-8");
	}
}

function changeDirExists(env: TestEnv, name: string): boolean {
	return existsSync(join(env.changesDir, name));
}

function archiveDirExists(env: TestEnv, name: string): boolean {
	const dir = join(env.changesDir, "archive");
	if (!existsSync(dir)) return false;
	const entries = readdirSync(dir);
	return entries.some((e) => e.endsWith(`-${name}`));
}

function hasArchiveEntries(env: TestEnv): string[] {
	const dir = join(env.changesDir, "archive");
	if (!existsSync(dir)) return [];
	return readdirSync(dir);
}

// ─── Unit tests: archiveDirName ───

describe("archiveDirName", () => {
	it("produces date-prefixed name", () => {
		const result = archiveDirName("my-change");
		// Pattern: YYYY-MM-DD-my-change
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-my-change$/);
	});

	it("preserves hyphens in name", () => {
		const result = archiveDirName("add-user-auth");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-add-user-auth$/);
	});

	it("handles single-word name", () => {
		const result = archiveDirName("fix");
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-fix$/);
	});
});

// ─── Unit tests: hasUnsyncedDeltas ───

describe("hasUnsyncedDeltas", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("unsynced");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("returns false when no specs dir exists", () => {
		createChangeDir(env, "my-change");
		expect(hasUnsyncedDeltas(join(env.changesDir, "my-change"))).toBe(false);
	});

	it("returns false when specs dir is empty", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		mkdirSync(join(dir, "specs"), { recursive: true });
		expect(hasUnsyncedDeltas(dir)).toBe(false);
	});

	it("returns true when specs dir has subdirectory entries", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		mkdirSync(join(dir, "specs", "auth"), { recursive: true });
		writeFileSync(join(dir, "specs", "auth", "spec.md"), "## ADDED Requirements", "utf-8");
		expect(hasUnsyncedDeltas(dir)).toBe(true);
	});

	it("returns true with multiple spec dirs", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		mkdirSync(join(dir, "specs", "auth"), { recursive: true });
		mkdirSync(join(dir, "specs", "billing"), { recursive: true });
		expect(hasUnsyncedDeltas(dir)).toBe(true);
	});

	it("ignores non-directory entries in specs dir", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		mkdirSync(join(dir, "specs"), { recursive: true });
		writeFileSync(join(dir, "specs", "notes.txt"), "some note", "utf-8");
		// Only directories count as potential delta specs
		expect(hasUnsyncedDeltas(dir)).toBe(false);
	});
});

// ─── Integration tests: archiveChange ───

describe("archiveChange — completeness check", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("completeness");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("blocks archive when artifacts incomplete (shows blockers)", () => {
		// 4-artifact hardcoded checklist: proposal, deltas, design, publish
		// Only proposal.md and design.md exist — no specs/ files, no backlog/docs/ files
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
			"design.md": "design content",
		});

		const result = archiveChange("my-change", env.root, { force: false });

		// proposal=done, design=done, deltas=ready, publish=ready
		// isChangeComplete returns false (deltas, publish missing)
		expect(result.success).toBe(false);
		expect(result.reason).toContain("incomplete");
		expect(result.doneArtifacts).toEqual(["proposal", "design"]);
		expect(result.totalArtifacts).toBe(4);
		expect(result.reason).toContain("2/4");
		expect(changeDirExists(env, "my-change")).toBe(true);
	});

	it("allows archive when all artifacts complete", () => {
		// All 4 change artifacts present
		// Use flat spec file (not a subdirectory) to avoid triggering unsynced delta detection
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
			"design.md": "design content",
			"specs/auth.md": "## ADDED\n",
		});
		createPublishFiles(env);

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(true);
		expect(result.archivePath).toContain("my-change");
		// Change dir should be moved
		expect(changeDirExists(env, "my-change")).toBe(false);
		// Archive dir should exist
		expect(archiveDirExists(env, "my-change")).toBe(true);
	});

	it("reports which artifacts were done at time of archive", () => {
		// All 4 change artifacts present
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
			"design.md": "design content",
			"specs/auth.md": "## ADDED\n",
		});
		createPublishFiles(env);

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(true);
		expect(result.doneArtifacts).toContain("proposal");
		expect(result.doneArtifacts).toContain("deltas");
		expect(result.doneArtifacts).toContain("design");
		expect(result.doneArtifacts).toContain("publish");
		expect(result.totalArtifacts).toBe(4);
		expect(result.doneArtifacts.length).toBe(4);
	});

	it("reports partial done when some artifacts complete but archive blocked", () => {
		// Only pass proposal.md — design.md not created
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
		});

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(false);
		expect(result.doneArtifacts).toEqual(["proposal"]);
		expect(result.totalArtifacts).toBe(4);
		expect(result.reason).toContain("1/4");
	});
});

describe("archiveChange — --force override", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("force");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("--force archives despite incomplete artifacts", () => {
		// Only proposal.md exists, design.md is missing
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
		});

		const result = archiveChange("my-change", env.root, { force: true });

		expect(result.success).toBe(true);
		expect(result.archivePath).toContain("my-change");
		expect(changeDirExists(env, "my-change")).toBe(false);
		expect(archiveDirExists(env, "my-change")).toBe(true);
	});

	it("--force bypasses completeness check and reports done/total", () => {
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
		});

		const result = archiveChange("my-change", env.root, { force: true });

		expect(result.success).toBe(true);
		expect(result.blockers).toEqual([]);
		expect(result.doneArtifacts).toEqual(["proposal"]);
		expect(result.totalArtifacts).toBe(4);
	});
});

describe("archiveChange — unsynced delta detection", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("unsynced-check");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("blocks archive when unsynced deltas exist (no --no-sync-check)", () => {
		// All 4 artifacts present so completeness passes, but specs/ has subdirectories → unsynced
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
			"design.md": "design content",
			"specs/hidden/spec.md": "## ADDED Requirements\n",
		});
		createPublishFiles(env);

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(false);
		expect(result.hasUnsyncedDeltas).toBe(true);
		expect(result.reason).toContain("sync");
		expect(changeDirExists(env, "my-change")).toBe(true);
	});

	it("--no-sync-check bypasses unsynced delta detection", () => {
		// All 4 artifacts present
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
			"design.md": "design content",
			"specs/auth.md": "## MODIFIED Requirements\n",
		});
		createPublishFiles(env);
		// Add an unsynced delta (subdirectory under specs/)
		mkdirSync(join(env.changesDir, "my-change", "specs", "unsynced"), { recursive: true });
		writeFileSync(join(env.changesDir, "my-change", "specs", "unsynced", "spec.md"), "## ADDED\n", "utf-8");

		const result = archiveChange("my-change", env.root, { force: false, noSyncCheck: true });

		expect(result.success).toBe(true);
		expect(result.hasUnsyncedDeltas).toBe(true);
		expect(changeDirExists(env, "my-change")).toBe(false);
		expect(archiveDirExists(env, "my-change")).toBe(true);
	});

	it("--force does NOT bypass unsynced delta check (use --no-sync-check for that)", () => {
		// All 4 artifacts present, but specs/ has subdirectories → unsynced
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
			"design.md": "design content",
			"specs/hidden/spec.md": "## ADDED Requirements\n",
		});
		createPublishFiles(env);

		const result = archiveChange("my-change", env.root, { force: true });

		// force bypasses completeness check, but NOT unsynced delta check
		expect(result.success).toBe(false);
		expect(result.hasUnsyncedDeltas).toBe(true);
		expect(result.reason).toContain("synced");
		expect(changeDirExists(env, "my-change")).toBe(true);
	});

	it("prioritizes incomplete artifacts over unsynced deltas", () => {
		// Only proposal.md — design.md missing AND specs dir exists
		createChangeDir(env, "my-change", {
			"proposal.md": "proposal content",
			"specs/auth/spec.md": "## ADDED Requirements",
		});

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(false);
		expect(result.reason).toContain("incomplete");
		// Unsynced check not reached since completeness check failed first
		expect(result.hasUnsyncedDeltas).toBe(false);
	});
});

describe("archiveChange — directory move", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("move");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("moves all files from change dir to archive dir", () => {
		createChangeDir(env, "my-change", {
			"proposal.md": "prop content",
			"design.md": "design content",
			"specs/auth/spec.md": "## ADDED",
		});

		const result = archiveChange("my-change", env.root, { force: true, noSyncCheck: true });

		expect(result.success).toBe(true);
		expect(changeDirExists(env, "my-change")).toBe(false);

		// Check archive dir has all files
		const archives = hasArchiveEntries(env);
		expect(archives.length).toBe(1);
		const archivePath = join(env.changesDir, "archive", archives[0] as string);
		expect(existsSync(join(archivePath, "proposal.md"))).toBe(true);
		expect(existsSync(join(archivePath, "design.md"))).toBe(true);
		expect(existsSync(join(archivePath, "specs", "auth", "spec.md"))).toBe(true);
	});

	it("sets archiveDirPath with date prefix", () => {
		createChangeDir(env, "my-change", {
			"proposal.md": "prop content",
			"design.md": "design content",
			"specs/auth.md": "## ADDED\n",
		});
		createPublishFiles(env);

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(true);
		expect(result.archivePath).toMatch(/\d{4}-\d{2}-\d{2}-my-change/);
		expect(result.archivePath).toContain("backlog/changes/archive/");
	});

	it("archives multiple changes independently", () => {
		createChangeDir(env, "change-a", {
			"proposal.md": "a",
			"design.md": "b",
			"specs/auth.md": "## ADDED\n",
		});
		createChangeDir(env, "change-b", {
			"proposal.md": "c",
			"design.md": "d",
			"specs/auth.md": "## ADDED\n",
		});
		createPublishFiles(env);

		const r1 = archiveChange("change-a", env.root, { force: false });
		const r2 = archiveChange("change-b", env.root, { force: false });

		expect(r1.success).toBe(true);
		expect(r2.success).toBe(true);
		expect(changeDirExists(env, "change-a")).toBe(false);
		expect(changeDirExists(env, "change-b")).toBe(false);

		const archives = hasArchiveEntries(env);
		expect(archives.length).toBe(2);
		expect(archives.some((e) => e.endsWith("-change-a"))).toBe(true);
		expect(archives.some((e) => e.endsWith("-change-b"))).toBe(true);
	});
});

describe("archiveChange — error handling", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("errors");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("reports missing change directory", () => {
		const result = archiveChange("nonexistent", env.root, { force: false });

		expect(result.success).toBe(false);
		expect(result.reason).toContain("not found");
		expect(result.archivePath).toBeNull();
	});
});
