/**
 * Tests for `backlog change sync` command — delta spec sync pipeline.
 * Tests the pure sync logic: applying ADDED/MODIFIED/REMOVED/RENAMED deltas
 * to spec Documents via Core API, backup, validation, and dry-run.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Core } from "../core/backlog.ts";
import { syncSpecs } from "../openspec/sync.ts";

// ─── Test helpers ───

interface TestEnv {
	root: string;
	core: Core;
	changesDir: string;
}

function createTestEnv(name: string): TestEnv {
	const root = `/tmp/backlog-sync-test-${name}-${Date.now()}`;
	mkdirSync(root, { recursive: true });
	const changesDir = join(root, "backlog", "changes");
	mkdirSync(changesDir, { recursive: true });
	const core = new Core(root);
	return { root, core, changesDir };
}

function cleanup(env: TestEnv): void {
	rmSync(env.root, { recursive: true, force: true });
}

async function createSpecDoc(env: TestEnv, name: string, content: string): Promise<void> {
	await env.core.createDocumentFromInput({
		title: name,
		type: "specification",
		status: "draft",
		content,
	});
}

async function getSpecDoc(env: TestEnv, name: string) {
	const docs = await env.core.filesystem.listDocuments();
	return docs.find((d) => d.title.toLowerCase() === name.toLowerCase() && d.type === "specification") ?? null;
}

async function readSpecDoc(env: TestEnv, name: string): Promise<string | null> {
	const doc = await getSpecDoc(env, name);
	return doc?.rawContent ?? null;
}

async function specDocExists(env: TestEnv, name: string): Promise<boolean> {
	const doc = await getSpecDoc(env, name);
	return doc !== null;
}

async function getSpecId(env: TestEnv, specName: string): Promise<string> {
	const docs = await env.core.filesystem.listDocuments();
	const spec = docs.find((d) => d.title.toLowerCase() === specName.toLowerCase() && d.type === "specification");
	return spec?.id ?? specName;
}

async function createDeltaSpec(env: TestEnv, change: string, spec: string, content: string): Promise<void> {
	const dir = join(env.changesDir, change);
	mkdirSync(dir, { recursive: true });
	const targetId = await getSpecId(env, spec);
	const fm = `---
id: DELTA-999
title: ${spec}
type: spec-delta
created_date: 2026-05-19 00:00
sync_status: pending
target_spec_id: ${targetId}
---

`;
	// If content already has frontmatter, don't add it; otherwise prepend
	if (content.startsWith("---\n")) {
		writeFileSync(join(dir, `${spec}.spec-delta.md`), content, "utf-8");
	} else {
		writeFileSync(join(dir, `${spec}.spec-delta.md`), fm + content, "utf-8");
	}
}

function backupExists(env: TestEnv, change: string, spec: string): boolean {
	return existsSync(join(env.changesDir, change, "backups", `${spec}.md.bak`));
}

function readBackup(env: TestEnv, change: string, spec: string): string {
	return readFileSync(join(env.changesDir, change, "backups", `${spec}.md.bak`), "utf-8");
}

function makeSpec(name: string, requirements: string): string {
	return `## Purpose

Purpose of ${name}.

## Requirements
${requirements}
`;
}

/** Requirement block with statement and a default `#### Scenario:` block. */
function reqBlock(name: string, statement?: string): string {
	const body = statement ?? `The system SHALL ${name.toLowerCase()}.`;
	return `### Requirement: ${name}
${body}

#### Scenario: basic

GIVEN the system is ready
WHEN ${name.toLowerCase()} runs
THEN the system SHALL respond.`;
}

/** Requirement block with custom scenario content. */
function reqWithScenario(name: string, scenarioText?: string): string {
	const scenario =
		scenarioText ??
		`#### Scenario: basic

GIVEN the system is ready
WHEN ${name.toLowerCase()} is invoked
THEN the system SHALL respond.`;
	return `### Requirement: ${name}
The system SHALL ${name.toLowerCase()}.

${scenario}`;
}

/** Build a MODIFIED delta entry with a scenario (so validation passes). */
function modifiedBlock(name: string, statement: string, scenarioText?: string): string {
	const scenario =
		scenarioText ??
		`#### Scenario: basic

GIVEN the system is in test mode
WHEN ${name.toLowerCase()} runs
THEN the system SHALL respond correctly.`;
	return `### Requirement: ${name}
${statement}

${scenario}`;
}

// ─── Sync pipeline unit tests ───

describe("syncSpecs — ADDED deltas", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("added");
	});

	afterEach(async () => {
		cleanup(env);
	});

	it("appends a new requirement to existing spec", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createDeltaSpec(env, "my-change", "auth", `## ADDED Requirements\n\n${reqWithScenario("Register")}\n`);

		const result = await syncSpecs("my-change", env.core, { dryRun: false });
		const content = await readSpecDoc(env, "auth");

		expect(content).toContain("### Requirement: Login");
		expect(content).toContain("### Requirement: Register");
		expect(content).toContain("SHALL register");
		expect(result).toContain("1 delta");
		expect(result).toContain("auth");
	});

	it("appends multiple new requirements", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## ADDED Requirements\n\n${reqWithScenario("Register")}\n\n${reqWithScenario("Logout")}\n`,
		);

		const result = await syncSpecs("my-change", env.core, { dryRun: false });
		const content = await readSpecDoc(env, "auth");

		expect(content).toContain("### Requirement: Register");
		expect(content).toContain("### Requirement: Logout");
		expect(content).toContain("### Requirement: Login");
		expect(result).toContain("2 delta(s)");
	});

	it("creates new spec document from a .new-spec.md file", async () => {
		const dir = join(env.changesDir, "my-change");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "billing.new-spec.md"),
			"---\nid: NEWSPEC-1\ntitle: billing\ntype: new-spec\ncreated_date: 2026-05-19 00:00\nsync_status: pending\n---\n\n## Motivation\nNeed billing.\n\n## Purpose\nHandle billing.\n\n## Requirements\n### Requirement: Feature\nThe system SHALL feature.\n\n#### Scenario: test\n\nGIVEN a state\nWHEN action\nTHEN outcome.\n",
		);

		const result = await syncSpecs("my-change", env.core, { dryRun: false });

		expect(await specDocExists(env, "billing")).toBe(true);
		const content = await readSpecDoc(env, "billing");
		expect(content).toContain("### Requirement: Feature");
		expect(content).toContain("SHALL feature");
		expect(content).not.toContain("## Motivation");
		expect(result).toContain("billing");
	});

	it("preserves existing requirements when appending", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", `${reqBlock("Login")}\n\n${reqBlock("Logout")}`));
		await createDeltaSpec(env, "my-change", "auth", `## ADDED Requirements\n\n${reqWithScenario("Register")}\n`);

		await syncSpecs("my-change", env.core, { dryRun: false });

		const content = (await readSpecDoc(env, "auth")) ?? "";
		const loginIdx = content.indexOf("### Requirement: Login");
		const logoutIdx = content.indexOf("### Requirement: Logout");
		const registerIdx = content.indexOf("### Requirement: Register");
		expect(loginIdx).toBeGreaterThan(-1);
		expect(logoutIdx).toBeGreaterThan(loginIdx);
		expect(registerIdx).toBeGreaterThan(logoutIdx);
	});
});

describe("syncSpecs — MODIFIED deltas", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("modified");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("replaces requirement block including scenarios", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqWithScenario("Login")));
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock(
				"Login",
				"The system SHALL authenticate with SSO.",
				"#### Scenario: sso\n\nGIVEN SSO is enabled\nWHEN user logs in\nTHEN the system SHALL use SSO.",
			)}\n`,
		);

		await syncSpecs("my-change", env.core, { dryRun: false });

		const content = await readSpecDoc(env, "auth");
		expect(content).toContain("### Requirement: Login");
		expect(content).not.toContain("the system is ready");
		expect(content).toContain("the system SHALL use SSO");
	});

	it("replaces requirement with different body text and keeps a scenario", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login", "The system SHALL use basic auth.")));
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock("Login", "The system SHALL use SSO authentication.")}\n`,
		);

		await syncSpecs("my-change", env.core, { dryRun: false });

		const content = await readSpecDoc(env, "auth");
		expect(content).toContain("SHALL use SSO authentication");
		expect(content).not.toContain("SHALL use basic auth");
	});

	it("replaces requirement by name case-insensitively", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login", "The system SHALL use basic auth.")));
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock("login", "The system SHALL use SSO.")}\n`,
		);

		await syncSpecs("my-change", env.core, { dryRun: false });

		const content = await readSpecDoc(env, "auth");
		expect(content).toContain("### Requirement: login");
		expect(content).not.toContain("SHALL use basic auth");
		expect(content).toContain("SHALL use SSO");
	});
});

describe("syncSpecs — REMOVED deltas", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("removed");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("removes requirement block by header name", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", `${reqWithScenario("Login")}\n\n${reqWithScenario("Logout")}`));
		await createDeltaSpec(env, "my-change", "auth", "## REMOVED Requirements\n\n### Requirement: Login\n");

		await syncSpecs("my-change", env.core, { dryRun: false });

		const content = await readSpecDoc(env, "auth");
		expect(content).not.toContain("### Requirement: Login");
		expect(content).toContain("### Requirement: Logout");
	});

	it("removes requirement case-insensitively", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createDeltaSpec(env, "my-change", "auth", "## REMOVED Requirements\n\n### Requirement: LOGIN\n");

		await syncSpecs("my-change", env.core, { dryRun: false });

		const content = await readSpecDoc(env, "auth");
		expect(content).not.toContain("### Requirement: Login");
	});
});

describe("syncSpecs — RENAMED deltas", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("renamed");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("renames requirement header from old to new name", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqWithScenario("Login")));
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			"## RENAMED Requirements\n\n- FROM: `### Requirement: Login`\n- TO: `### Requirement: SignIn`\n",
		);

		await syncSpecs("my-change", env.core, { dryRun: false });

		const content = await readSpecDoc(env, "auth");
		expect(content).toContain("### Requirement: SignIn");
		expect(content).not.toContain("### Requirement: Login");
		expect(content).toContain("SHALL login");
	});

	it("renames requirement case-insensitively", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login", "The system SHALL login.")));
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			"## RENAMED Requirements\n\n- FROM: `### Requirement: LOGIN`\n- TO: `### Requirement: SignIn`\n",
		);

		await syncSpecs("my-change", env.core, { dryRun: false });

		const content = await readSpecDoc(env, "auth");
		expect(content).toContain("### Requirement: SignIn");
		expect(content).not.toContain("### Requirement: Login");
	});
});

describe("syncSpecs — backup behavior", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("backup");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("backs up original spec before modifying", async () => {
		const original = makeSpec("auth", reqBlock("Login", "The system SHALL login."));
		await createSpecDoc(env, "auth", original);
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock("Login", "The system SHALL authenticate with SSO.")}\n`,
		);

		await syncSpecs("my-change", env.core, { dryRun: false });

		expect(backupExists(env, "my-change", "auth")).toBe(true);
		const backup = readBackup(env, "my-change", "auth");
		// Compare trimmed since Document serialization adds trailing newline
		expect(backup.trimEnd()).toBe(original.trimEnd());
	});

	it("does not create backup for newly created spec", async () => {
		await createDeltaSpec(env, "my-change", "new-spec", `## ADDED Requirements\n\n${reqWithScenario("Feature")}\n`);

		await syncSpecs("my-change", env.core, { dryRun: false });

		expect(backupExists(env, "my-change", "new-spec")).toBe(false);
	});

	it("does not create backup when --dry-run is used", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock("Login", "The system SHALL authenticate with SSO.")}\n`,
		);

		await syncSpecs("my-change", env.core, { dryRun: true });

		expect(backupExists(env, "my-change", "auth")).toBe(false);
	});
});

describe("syncSpecs — dry-run mode", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("dryrun");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("reports what would happen without writing", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createDeltaSpec(env, "my-change", "auth", `## ADDED Requirements\n\n${reqWithScenario("Register")}\n`);

		const result = await syncSpecs("my-change", env.core, { dryRun: true });

		const content = await readSpecDoc(env, "auth");
		expect(content).not.toContain("### Requirement: Register");
		expect(result).toContain("dry run");
		expect(result).toContain("auth");
	});

	it("reports deltas grouped by spec", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createSpecDoc(env, "billing", makeSpec("billing", reqBlock("Invoice")));
		await createDeltaSpec(env, "my-change", "auth", `## ADDED Requirements\n\n${reqWithScenario("Register")}\n`);
		await createDeltaSpec(
			env,
			"my-change",
			"billing",
			`## MODIFIED Requirements\n\n${modifiedBlock("Invoice", "The system SHALL generate PDF invoices.")}\n`,
		);

		const result = await syncSpecs("my-change", env.core, { dryRun: true });

		expect(result).toContain("dry run");
		expect(result).toContain("auth");
		expect(result).toContain("billing");
		expect(result).toContain("2 spec-delta(s)");
	});
});

describe("syncSpecs — validation", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("validation");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("validates synced spec against SpecSchema", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			"## ADDED Requirements\n\n### Requirement: Register\nThe system SHALL register users.\n\n#### Scenario: register-flow\n\nGIVEN a new user\nWHEN they register\nTHEN the system SHALL create an account.\n",
		);

		const result = await syncSpecs("my-change", env.core, { dryRun: false });
		expect(result).not.toContain("Validation error");
	});

	it("reports validation errors in summary", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		// Add a requirement without SHALL/MUST keyword
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			"## ADDED Requirements\n\n### Requirement: WeakReq\nThis requirement has no strong keyword.\n\n#### Scenario: test\n\nGIVEN something\nWHEN something happens\nTHEN check.\n",
		);

		const result = await syncSpecs("my-change", env.core, { dryRun: false });
		expect(result).toContain("Validation error");
		expect(result).toContain("must contain SHALL");
	});
});

describe("syncSpecs — edge cases", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("edge");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("handles empty delta spec (no deltas)", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createDeltaSpec(env, "my-change", "auth", "");

		const result = await syncSpecs("my-change", env.core, { dryRun: false });

		expect(result).toContain("0 delta(s) applied");
	});

	it("handles multiple operation types in one sync", async () => {
		await createSpecDoc(
			env,
			"auth",
			makeSpec("auth", `${reqWithScenario("Login")}\n\n${reqWithScenario("Logout")}\n\n${reqWithScenario("Profile")}`),
		);

		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## ADDED Requirements\n\n${reqWithScenario("Register")}\n\n` +
				`## MODIFIED Requirements\n\n${modifiedBlock(
					"Login",
					"The system SHALL authenticate with SSO.",
					"#### Scenario: sso\n\nGIVEN SSO is configured\nWHEN user logs in\nTHEN the system SHALL use SSO.",
				)}\n\n` +
				"## REMOVED Requirements\n\n### Requirement: Profile\n\n" +
				"## RENAMED Requirements\n\n- FROM: `### Requirement: Logout`\n- TO: `### Requirement: SignOut`\n",
		);

		await syncSpecs("my-change", env.core, { dryRun: false });

		const content = await readSpecDoc(env, "auth");

		expect(content).toContain("### Requirement: Register");
		expect(content).toContain("SHALL authenticate with SSO");
		expect(content).not.toContain("SHALL login");
		expect(content).not.toContain("### Requirement: Profile");
		expect(content).toContain("### Requirement: SignOut");
		expect(content).not.toContain("### Requirement: Logout");
	});

	it("reports per-spec summary with counts", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createSpecDoc(env, "billing", makeSpec("billing", reqBlock("Invoice")));
		await createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## ADDED Requirements\n\n${reqWithScenario("Register")}\n\n` +
				`## MODIFIED Requirements\n\n${modifiedBlock("Login", "The system SHALL authenticate with SSO.")}\n`,
		);
		await createDeltaSpec(env, "my-change", "billing", "## REMOVED Requirements\n\n### Requirement: Invoice\n");

		const result = await syncSpecs("my-change", env.core, { dryRun: false });

		expect(result).toContain("auth");
		expect(result).toContain("billing");
		expect(result).toContain("2 delta(s)");
	});

	it("handles missing change directory gracefully", async () => {
		const result = await syncSpecs("nonexistent-change", env.core, { dryRun: false });
		expect(result).toContain("not found");
	});

	it("handles REMOVED on nonexistent requirement gracefully", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createDeltaSpec(env, "my-change", "auth", "## REMOVED Requirements\n\n### Requirement: NonExistent\n");

		const result = await syncSpecs("my-change", env.core, { dryRun: false });
		expect(result).toContain("NonExistent");

		const content = await readSpecDoc(env, "auth");
		expect(content).toContain("### Requirement: Login");
	});
});

describe("syncSpecs — error cases", () => {
	let env: TestEnv;

	beforeEach(() => {
		env = createTestEnv("errors");
	});

	afterEach(() => {
		cleanup(env);
	});

	it("reports error when spec-delta is missing target_spec_id", async () => {
		const dir = join(env.changesDir, "my-change");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "auth.spec-delta.md"),
			"---\nid: DELTA-1\ntitle: auth\ntype: spec-delta\nsync_status: pending\n---\n\n## ADDED Requirements\n### Requirement: Test\nThe system SHALL test.\n\n#### Scenario: t\n\nGIVEN x\nWHEN y\nTHEN z.\n",
		);

		const result = await syncSpecs("my-change", env.core, { dryRun: false });

		expect(result).toContain("Missing target_spec_id");
	});

	it("reports error when target_spec_id does not match any spec", async () => {
		const dir = join(env.changesDir, "my-change");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "auth.spec-delta.md"),
			"---\nid: DELTA-1\ntitle: auth\ntype: spec-delta\nsync_status: pending\ntarget_spec_id: SPC-999\n---\n\n## ADDED Requirements\n### Requirement: Test\nThe system SHALL test.\n\n#### Scenario: t\n\nGIVEN x\nWHEN y\nTHEN z.\n",
		);

		const result = await syncSpecs("my-change", env.core, { dryRun: false });

		expect(result).toContain("SPC-999");
		expect(result).toContain("not found");
	});

	it("reports error when new-spec body has no ## Purpose section", async () => {
		const dir = join(env.changesDir, "my-change");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "broken.new-spec.md"),
			"---\nid: NEWSPEC-1\ntitle: broken\ntype: new-spec\nsync_status: pending\n---\n\n## Motivation\nNope.\n\n## Requirements\n### Requirement: X\nThe system SHALL X.\n\n#### Scenario: t\n\nGIVEN x\nWHEN y\nTHEN z.\n",
		);

		const result = await syncSpecs("my-change", env.core, { dryRun: false });

		expect(result).toContain("must contain a ## Purpose section");
	});

	it("reports error when new-spec body has no ## Requirements section", async () => {
		const dir = join(env.changesDir, "my-change");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "broken.new-spec.md"),
			"---\nid: NEWSPEC-1\ntitle: broken\ntype: new-spec\nsync_status: pending\n---\n\n## Motivation\nNope.\n\n## Purpose\nTest.\n",
		);

		const result = await syncSpecs("my-change", env.core, { dryRun: false });

		expect(result).toContain("must contain a ## Requirements section");
	});

	it("preserves target_spec_id in spec-delta frontmatter after sync", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		const dir = join(env.changesDir, "my-change");
		mkdirSync(dir, { recursive: true });
		const specId = await getSpecId(env, "auth");
		writeFileSync(
			join(dir, "auth.spec-delta.md"),
			`---\nid: DELTA-1\ntitle: auth\ntype: spec-delta\nsync_status: pending\ntarget_spec_id: ${specId}\n---\n\n## ADDED Requirements\n### Requirement: New\nThe system SHALL do new.\n\n#### Scenario: t\n\nGIVEN x\nWHEN y\nTHEN z.\n`,
		);

		await syncSpecs("my-change", env.core, { dryRun: false });

		const artifactContent = readFileSync(join(dir, "auth.spec-delta.md"), "utf-8");
		expect(artifactContent).toContain(`target_spec_id: ${specId}`);
		expect(artifactContent).toContain("sync_status: synced");
	});

	it("sets syncStatus on published spec after sync", async () => {
		await createSpecDoc(env, "auth", makeSpec("auth", reqBlock("Login")));
		await createDeltaSpec(env, "my-change", "auth", `## ADDED Requirements\n\n${reqWithScenario("Register")}\n`);

		await syncSpecs("my-change", env.core, { dryRun: false });

		const docs = await env.core.filesystem.listDocuments();
		const spec = docs.find((d) => d.title.toLowerCase() === "auth");
		expect(spec?.syncStatus).toBe("synced");
	});

	it("sets syncStatus on both artifacts after new-spec sync", async () => {
		const dir = join(env.changesDir, "my-change");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "billing.new-spec.md"),
			"---\nid: NEWSPEC-1\ntitle: billing\ntype: new-spec\ncreated_date: 2026-05-19 00:00\nsync_status: pending\n---\n\n## Motivation\nNeed billing.\n\n## Purpose\nHandle billing.\n\n## Requirements\n### Requirement: X\nThe system SHALL X.\n\n#### Scenario: t\n\nGIVEN x\nWHEN y\nTHEN z.\n",
		);

		await syncSpecs("my-change", env.core, { dryRun: false });

		// Check spec has syncStatus
		const docs = await env.core.filesystem.listDocuments();
		const spec = docs.find((d) => d.title.toLowerCase() === "billing");
		expect(spec?.syncStatus).toBe("synced");

		// Check artifact has syncStatus
		const artifactContent = readFileSync(join(dir, "billing.new-spec.md"), "utf-8");
		expect(artifactContent).toContain("sync_status: synced");
	});
});
