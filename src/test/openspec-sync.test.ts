/**
 * Tests for `backlog change sync` command — delta spec sync pipeline.
 * Tests the pure sync logic: applying ADDED/MODIFIED/REMOVED/RENAMED deltas
 * to main spec content, backup, validation, and dry-run.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { syncSpecs } from "../openspec/sync.ts";

// ─── Test helpers ───

interface TestEnv {
	root: string;
	specsDir: string;
	changesDir: string;
}

function createTestEnv(name: string): TestEnv {
	const root = `/tmp/backlog-sync-test-${name}-${Date.now()}`;
	mkdirSync(root, { recursive: true });
	const specsDir = join(root, "backlog", "specs");
	const changesDir = join(root, "backlog", "changes");
	mkdirSync(specsDir, { recursive: true });
	mkdirSync(changesDir, { recursive: true });
	return { root, specsDir, changesDir };
}

function cleanup(env: TestEnv): void {
	rmSync(env.root, { recursive: true, force: true });
}

function createMainSpec(env: TestEnv, name: string, content: string): void {
	const dir = join(env.specsDir, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "spec.md"), content, "utf-8");
}

function createDeltaSpec(env: TestEnv, change: string, spec: string, content: string): void {
	const dir = join(env.changesDir, change, "specs", spec);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "spec.md"), content, "utf-8");
}

function readMainSpec(env: TestEnv, name: string): string {
	return readFileSync(join(env.specsDir, name, "spec.md"), "utf-8");
}

function mainSpecExists(env: TestEnv, name: string): boolean {
	return existsSync(join(env.specsDir, name, "spec.md"));
}

function backupExists(env: TestEnv, name: string): boolean {
	return existsSync(join(env.specsDir, name, "spec.md.bak"));
}

function readBackup(env: TestEnv, name: string): string {
	return readFileSync(join(env.specsDir, name, "spec.md.bak"), "utf-8");
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

	afterEach(() => {
		cleanup(env);
	});

	it("appends a new requirement to existing spec", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createDeltaSpec(env, "my-change", "auth", `## ADDED Requirements\n\n${reqWithScenario("Register")}\n`);

		const result = await syncSpecs("my-change", env.root, { dryRun: false });
		const content = readMainSpec(env, "auth");

		expect(content).toContain("### Requirement: Login");
		expect(content).toContain("### Requirement: Register");
		expect(content).toContain("SHALL register");
		expect(result).toContain("1 delta");
		expect(result).toContain("auth");
	});

	it("appends multiple new requirements", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## ADDED Requirements\n\n${reqWithScenario("Register")}\n\n${reqWithScenario("Logout")}\n`,
		);

		const result = await syncSpecs("my-change", env.root, { dryRun: false });
		const content = readMainSpec(env, "auth");

		expect(content).toContain("### Requirement: Register");
		expect(content).toContain("### Requirement: Logout");
		expect(content).toContain("### Requirement: Login");
		expect(result).toContain("2 delta(s)");
	});

	it("creates main spec file when it does not exist", async () => {
		createDeltaSpec(env, "my-change", "new-spec", `## ADDED Requirements\n\n${reqWithScenario("Feature")}\n`);

		const result = await syncSpecs("my-change", env.root, { dryRun: false });

		expect(mainSpecExists(env, "new-spec")).toBe(true);
		const content = readMainSpec(env, "new-spec");
		expect(content).toContain("### Requirement: Feature");
		expect(content).toContain("SHALL feature");
		expect(result).toContain("1 delta(s) applied");
		expect(result).toContain("new-spec");
	});

	it("preserves existing requirements when appending", async () => {
		createMainSpec(env, "auth", makeSpec("auth", `${reqBlock("Login")}\n\n${reqBlock("Logout")}`));
		createDeltaSpec(env, "my-change", "auth", `## ADDED Requirements\n\n${reqWithScenario("Register")}\n`);

		await syncSpecs("my-change", env.root, { dryRun: false });

		const content = readMainSpec(env, "auth");
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
		createMainSpec(env, "auth", makeSpec("auth", reqWithScenario("Login")));
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock(
				"Login",
				"The system SHALL authenticate with SSO.",
				"#### Scenario: sso\n\nGIVEN SSO is enabled\nWHEN user logs in\nTHEN the system SHALL use SSO.",
			)}\n`,
		);

		await syncSpecs("my-change", env.root, { dryRun: false });

		const content = readMainSpec(env, "auth");
		expect(content).toContain("### Requirement: Login");
		expect(content).not.toContain("the system is ready");
		expect(content).toContain("the system SHALL use SSO");
	});

	it("replaces requirement with different body text and keeps a scenario", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login", "The system SHALL use basic auth.")));
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock("Login", "The system SHALL use SSO authentication.")}\n`,
		);

		await syncSpecs("my-change", env.root, { dryRun: false });

		const content = readMainSpec(env, "auth");
		expect(content).toContain("SHALL use SSO authentication");
		expect(content).not.toContain("SHALL use basic auth");
	});

	it("replaces requirement by name case-insensitively", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login", "The system SHALL use basic auth.")));
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock("login", "The system SHALL use SSO.")}\n`,
		);

		await syncSpecs("my-change", env.root, { dryRun: false });

		const content = readMainSpec(env, "auth");
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
		createMainSpec(env, "auth", makeSpec("auth", `${reqWithScenario("Login")}\n\n${reqWithScenario("Logout")}`));
		createDeltaSpec(env, "my-change", "auth", "## REMOVED Requirements\n\n### Requirement: Login\n");

		await syncSpecs("my-change", env.root, { dryRun: false });

		const content = readMainSpec(env, "auth");
		expect(content).not.toContain("### Requirement: Login");
		expect(content).toContain("### Requirement: Logout");
	});

	it("removes requirement case-insensitively", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createDeltaSpec(env, "my-change", "auth", "## REMOVED Requirements\n\n### Requirement: LOGIN\n");

		await syncSpecs("my-change", env.root, { dryRun: false });

		const content = readMainSpec(env, "auth");
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
		createMainSpec(env, "auth", makeSpec("auth", reqWithScenario("Login")));
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			"## RENAMED Requirements\n\n- FROM: `### Requirement: Login`\n- TO: `### Requirement: SignIn`\n",
		);

		await syncSpecs("my-change", env.root, { dryRun: false });

		const content = readMainSpec(env, "auth");
		expect(content).toContain("### Requirement: SignIn");
		expect(content).not.toContain("### Requirement: Login");
		expect(content).toContain("SHALL login");
	});

	it("renames requirement case-insensitively", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login", "The system SHALL login.")));
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			"## RENAMED Requirements\n\n- FROM: `### Requirement: LOGIN`\n- TO: `### Requirement: SignIn`\n",
		);

		await syncSpecs("my-change", env.root, { dryRun: false });

		const content = readMainSpec(env, "auth");
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
		createMainSpec(env, "auth", original);
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock("Login", "The system SHALL authenticate with SSO.")}\n`,
		);

		await syncSpecs("my-change", env.root, { dryRun: false });

		expect(backupExists(env, "auth")).toBe(true);
		const backup = readBackup(env, "auth");
		expect(backup).toBe(original);
	});

	it("does not create backup for newly created spec", async () => {
		createDeltaSpec(env, "my-change", "new-spec", `## ADDED Requirements\n\n${reqWithScenario("Feature")}\n`);

		await syncSpecs("my-change", env.root, { dryRun: false });

		expect(backupExists(env, "new-spec")).toBe(false);
	});

	it("does not create backup when --dry-run is used", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## MODIFIED Requirements\n\n${modifiedBlock("Login", "The system SHALL authenticate with SSO.")}\n`,
		);

		await syncSpecs("my-change", env.root, { dryRun: true });

		expect(backupExists(env, "auth")).toBe(false);
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
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createDeltaSpec(env, "my-change", "auth", `## ADDED Requirements\n\n${reqWithScenario("Register")}\n`);

		const result = await syncSpecs("my-change", env.root, { dryRun: true });

		const content = readMainSpec(env, "auth");
		expect(content).not.toContain("### Requirement: Register");
		expect(result).toContain("dry run");
		expect(result).toContain("auth");
	});

	it("reports deltas grouped by spec", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createMainSpec(env, "billing", makeSpec("billing", reqBlock("Invoice")));
		createDeltaSpec(env, "my-change", "auth", `## ADDED Requirements\n\n${reqWithScenario("Register")}\n`);
		createDeltaSpec(
			env,
			"my-change",
			"billing",
			`## MODIFIED Requirements\n\n${modifiedBlock("Invoice", "The system SHALL generate PDF invoices.")}\n`,
		);

		const result = await syncSpecs("my-change", env.root, { dryRun: true });

		expect(result).toContain("dry run");
		expect(result).toContain("auth");
		expect(result).toContain("billing");
		expect(result).toContain("2 delta(s)");
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
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			"## ADDED Requirements\n\n### Requirement: Register\nThe system SHALL register users.\n\n#### Scenario: register-flow\n\nGIVEN a new user\nWHEN they register\nTHEN the system SHALL create an account.\n",
		);

		const result = await syncSpecs("my-change", env.root, { dryRun: false });
		expect(result).not.toContain("Validation error");
	});

	it("reports validation errors in summary", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		// Add a requirement without SHALL/MUST keyword
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			"## ADDED Requirements\n\n### Requirement: WeakReq\nThis requirement has no strong keyword.\n\n#### Scenario: test\n\nGIVEN something\nWHEN something happens\nTHEN check.\n",
		);

		const result = await syncSpecs("my-change", env.root, { dryRun: false });
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
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createDeltaSpec(env, "my-change", "auth", "");

		const result = await syncSpecs("my-change", env.root, { dryRun: false });

		expect(result).toContain("No deltas found");
	});

	it("handles multiple operation types in one sync", async () => {
		createMainSpec(
			env,
			"auth",
			makeSpec("auth", `${reqWithScenario("Login")}\n\n${reqWithScenario("Logout")}\n\n${reqWithScenario("Profile")}`),
		);

		createDeltaSpec(
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

		await syncSpecs("my-change", env.root, { dryRun: false });

		const content = readMainSpec(env, "auth");

		expect(content).toContain("### Requirement: Register");
		expect(content).toContain("SHALL authenticate with SSO");
		expect(content).not.toContain("SHALL login");
		expect(content).not.toContain("### Requirement: Profile");
		expect(content).toContain("### Requirement: SignOut");
		expect(content).not.toContain("### Requirement: Logout");
	});

	it("reports per-spec summary with counts", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createMainSpec(env, "billing", makeSpec("billing", reqBlock("Invoice")));
		createDeltaSpec(
			env,
			"my-change",
			"auth",
			`## ADDED Requirements\n\n${reqWithScenario("Register")}\n\n` +
				`## MODIFIED Requirements\n\n${modifiedBlock("Login", "The system SHALL authenticate with SSO.")}\n`,
		);
		createDeltaSpec(env, "my-change", "billing", "## REMOVED Requirements\n\n### Requirement: Invoice\n");

		const result = await syncSpecs("my-change", env.root, { dryRun: false });

		expect(result).toContain("auth");
		expect(result).toContain("billing");
		expect(result).toContain("3 delta(s)");
	});

	it("handles missing change directory gracefully", async () => {
		const result = await syncSpecs("nonexistent-change", env.root, { dryRun: false });
		expect(result).toContain("not found");
	});

	it("handles REMOVED on nonexistent requirement gracefully", async () => {
		createMainSpec(env, "auth", makeSpec("auth", reqBlock("Login")));
		createDeltaSpec(env, "my-change", "auth", "## REMOVED Requirements\n\n### Requirement: NonExistent\n");

		const result = await syncSpecs("my-change", env.root, { dryRun: false });
		expect(result).toContain("NonExistent");

		const content = readMainSpec(env, "auth");
		expect(content).toContain("### Requirement: Login");
	});
});
