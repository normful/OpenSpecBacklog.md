/**
 * Tests for `backlog change archive` command — checklist-aware archive pipeline (v2).
 * Tests flat change artifacts: spec-delta, new-spec, syncStatus-based unsynced check.
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

	if (files) {
		for (const [filename, content] of Object.entries(files)) {
			const fullPath = join(dir, filename);
			const parentDir = fullPath.slice(0, fullPath.lastIndexOf("/"));
			if (parentDir && !existsSync(parentDir)) {
				mkdirSync(parentDir, { recursive: true });
			}
			writeFileSync(fullPath, content, "utf-8");
		}
	}
}

function changeDirExists(env: TestEnv, name: string): boolean {
	return existsSync(join(env.changesDir, name));
}

function archiveDirExists(env: TestEnv, name: string): boolean {
	const dir = join(env.changesDir, "archive");
	if (!existsSync(dir)) return false;
	return readdirSync(dir).some((e) => e.endsWith(`-${name}`));
}

function hasArchiveEntries(env: TestEnv): string[] {
	const dir = join(env.changesDir, "archive");
	if (!existsSync(dir)) return [];
	return readdirSync(dir);
}

/** Build a spec-delta file with sync_status frontmatter */
function specDeltaContent(specName: string, syncStatus: string, body?: string): string {
	return `---
id: DELTA-1
title: ${specName}
type: spec-delta
created_date: 2026-05-19 00:00
sync_status: ${syncStatus}
target_spec_id: SPC-1
---

${body ?? "## ADDED Requirements\n\n### Requirement: Test\n\nThe system SHALL test.\n"}
`;
}

/** Build a new-spec file with sync_status frontmatter */
function newSpecContent(specName: string, syncStatus: string): string {
	return `---
id: NEWSPEC-1
title: ${specName}
type: new-spec
created_date: 2026-05-19 00:00
sync_status: ${syncStatus}
---

## Motivation
Test.

## Purpose
Test purpose.

## Requirements
### Requirement: Test

The system SHALL test.
`;
}

// ─── Unit tests: archiveDirName ───

describe("archiveDirName", () => {
	it("produces date-prefixed name", () => {
		const result = archiveDirName("my-change");
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

	it("returns false when change dir is empty", () => {
		createChangeDir(env, "my-change");
		expect(hasUnsyncedDeltas(join(env.changesDir, "my-change"))).toBe(false);
	});

	it("returns false when all artifacts are synced", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");
		writeFileSync(join(dir, "billing.new-spec.md"), newSpecContent("billing", "synced"), "utf-8");
		expect(hasUnsyncedDeltas(dir)).toBe(false);
	});

	it("returns true when spec-delta is pending", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "pending"), "utf-8");
		expect(hasUnsyncedDeltas(dir)).toBe(true);
	});

	it("returns true when new-spec is pending", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "billing.new-spec.md"), newSpecContent("billing", "pending"), "utf-8");
		expect(hasUnsyncedDeltas(dir)).toBe(true);
	});

	it("returns true when one of multiple artifacts is unsynced", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");
		writeFileSync(join(dir, "billing.new-spec.md"), newSpecContent("billing", "pending"), "utf-8");
		expect(hasUnsyncedDeltas(dir)).toBe(true);
	});

	it("defaults to pending for artifacts without sync_status", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		// File without frontmatter
		writeFileSync(join(dir, "auth.spec-delta.md"), "## ADDED Requirements\n", "utf-8");
		expect(hasUnsyncedDeltas(dir)).toBe(true);
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
		// Only spec-delta file exists — new-specs artifact is missing
		createChangeDir(env, "my-change", { "auth.spec-delta.md": specDeltaContent("auth", "synced") });

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(false);
		expect(result.reason).toContain("incomplete");
		expect(result.doneArtifacts).toEqual(["deltas"]);
		expect(result.totalArtifacts).toBe(2);
		expect(result.reason).toContain("1/2");
		expect(changeDirExists(env, "my-change")).toBe(true);
	});

	it("allows archive when all artifacts complete and synced", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");
		writeFileSync(join(dir, "billing.new-spec.md"), newSpecContent("billing", "synced"), "utf-8");

		const result = archiveChange("my-change", env.root, { force: false, noSyncCheck: true });

		expect(result.success).toBe(true);
		expect(result.archivePath).toContain("my-change");
		expect(changeDirExists(env, "my-change")).toBe(false);
		expect(archiveDirExists(env, "my-change")).toBe(true);
	});

	it("reports which artifacts were done at time of archive", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");
		writeFileSync(join(dir, "billing.new-spec.md"), newSpecContent("billing", "synced"), "utf-8");

		const result = archiveChange("my-change", env.root, { force: false, noSyncCheck: true });

		expect(result.success).toBe(true);
		expect(result.doneArtifacts).toContain("deltas");
		expect(result.doneArtifacts).toContain("new-specs");
		expect(result.totalArtifacts).toBe(2);
		expect(result.doneArtifacts.length).toBe(2);
	});

	it("reports partial done when some artifacts complete but archive blocked", () => {
		createChangeDir(env, "my-change", { "auth.spec-delta.md": specDeltaContent("auth", "synced") });

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(false);
		expect(result.doneArtifacts).toEqual(["deltas"]);
		expect(result.totalArtifacts).toBe(2);
		expect(result.reason).toContain("1/2");
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
		createChangeDir(env, "my-change", { "auth.spec-delta.md": specDeltaContent("auth", "synced") });

		const result = archiveChange("my-change", env.root, { force: true, noSyncCheck: true });

		expect(result.success).toBe(true);
		expect(result.archivePath).toContain("my-change");
		expect(changeDirExists(env, "my-change")).toBe(false);
		expect(archiveDirExists(env, "my-change")).toBe(true);
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

	it("blocks archive when unsynced deltas exist", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");
		writeFileSync(join(dir, "billing.new-spec.md"), newSpecContent("billing", "pending"), "utf-8");

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(false);
		expect(result.hasUnsyncedDeltas).toBe(true);
		expect(result.reason).toContain("sync");
		expect(changeDirExists(env, "my-change")).toBe(true);
	});

	it("--no-sync-check bypasses unsynced delta detection", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");
		writeFileSync(join(dir, "billing.new-spec.md"), newSpecContent("billing", "pending"), "utf-8");

		const result = archiveChange("my-change", env.root, { force: false, noSyncCheck: true });

		expect(result.success).toBe(true);
		expect(result.hasUnsyncedDeltas).toBe(true);
		expect(changeDirExists(env, "my-change")).toBe(false);
		expect(archiveDirExists(env, "my-change")).toBe(true);
	});

	it("--force does NOT bypass unsynced delta check", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");
		writeFileSync(join(dir, "billing.new-spec.md"), newSpecContent("billing", "pending"), "utf-8");

		const result = archiveChange("my-change", env.root, { force: true });

		expect(result.success).toBe(false);
		expect(result.hasUnsyncedDeltas).toBe(true);
		expect(result.reason).toContain("synced");
	});

	it("prioritizes incomplete artifacts over unsynced deltas", () => {
		// Only spec-delta exists (new-specs missing) AND it's pending
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "pending"), "utf-8");

		const result = archiveChange("my-change", env.root, { force: false });

		expect(result.success).toBe(false);
		expect(result.reason).toContain("incomplete");
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
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");

		const result = archiveChange("my-change", env.root, { force: true, noSyncCheck: true });

		expect(result.success).toBe(true);
		expect(changeDirExists(env, "my-change")).toBe(false);

		const archives = hasArchiveEntries(env);
		expect(archives.length).toBe(1);
		const archivePath = join(env.changesDir, "archive", archives[0] as string);
		expect(existsSync(join(archivePath, "auth.spec-delta.md"))).toBe(true);
	});

	it("sets archiveDirPath with date prefix", () => {
		const dir = join(env.changesDir, "my-change");
		createChangeDir(env, "my-change");
		writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");
		writeFileSync(join(dir, "billing.new-spec.md"), newSpecContent("billing", "synced"), "utf-8");

		const result = archiveChange("my-change", env.root, { force: false, noSyncCheck: true });

		expect(result.success).toBe(true);
		expect(result.archivePath).toMatch(/\d{4}-\d{2}-\d{2}-my-change/);
		expect(result.archivePath).toContain("backlog/changes/archive/");
	});

	it("archives multiple changes independently", () => {
		for (const name of ["change-a", "change-b"]) {
			const dir = join(env.changesDir, name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "auth.spec-delta.md"), specDeltaContent("auth", "synced"), "utf-8");
		}

		const r1 = archiveChange("change-a", env.root, { force: true, noSyncCheck: true });
		expect(r1.success).toBe(true);

		const r2 = archiveChange("change-b", env.root, { force: true, noSyncCheck: true });
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
