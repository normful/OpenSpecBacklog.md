#!/usr/bin/env node
/**
 * Build and publish this fork to npm under the @normful scope.
 *
 * Dry run (default) builds every selected target, stages the publishable layout
 * under dist/npm/ and reports exactly what would be published.
 *
 * --publish performs the real thing: it publishes the platform packages, waits
 * for them to become installable, publishes the root package, then verifies a
 * clean install in a scratch directory.
 *
 * Usage:
 *   bun run publish:npm                                     # dry run, all targets
 *   bun run publish:npm -- --targets=darwin-arm64           # dry run, one target
 *   bun run publish:npm -- --publish                        # real publish
 *
 * Publishing a version is irreversible: a name@version can never be reused.
 */

const { spawnSync } = require("node:child_process");
const { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { PACKAGE_BASE } = require("./resolveBinary.cjs");

const REPO_ROOT = join(__dirname, "..");
const STAGING_DIR = join(REPO_ROOT, "dist", "npm");
const REGISTRY_ATTEMPTS = 40;
const REGISTRY_DELAY_MS = 15_000;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const BUILD_TARGETS = [
	"bun-darwin-arm64",
	"bun-darwin-x64",
	"bun-linux-arm64",
	"bun-linux-x64-baseline",
	"bun-windows-x64-baseline",
];

function log(message) {
	console.log(message);
}

function fail(message) {
	console.error(`\nError: ${message}`);
	process.exit(1);
}

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function firstLine(text) {
	return (text ?? "").split("\n").find((line) => line.trim().length > 0) ?? "";
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? REPO_ROOT,
		stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
		encoding: "utf8",
	});
	if (result.error) {
		if (options.allowFailure) return { ok: false, stdout: "", stderr: result.error.message };
		fail(`Could not run ${command}: ${result.error.message}`);
	}
	const ok = result.status === 0;
	const stdout = (result.stdout ?? "").trim();
	const stderr = (result.stderr ?? "").trim();
	if (!ok && !options.allowFailure) {
		fail(`${command} ${args.join(" ")} exited with ${result.status}${stderr ? `\n${stderr}` : ""}`);
	}
	return { ok, stdout, stderr };
}

/**
 * bun-linux-x64-baseline -> { suffix: "linux-x64", os: "linux", cpu: "x64" }
 * The npm package name drops the target flavour and uses npm's os names.
 */
function describeTarget(target) {
	const suffix = target.replace(/^bun-/, "").replace(/-baseline$/, "");
	const [platform, cpu] = suffix.split("-");
	return {
		target,
		suffix,
		os: platform === "windows" ? "win32" : platform,
		cpu,
		binary: platform === "windows" ? "backlog.exe" : "backlog",
		packageName: `${PACKAGE_BASE}-${suffix}`,
	};
}

function parseArgs(argv) {
	const options = { publish: false, allowDirty: false, version: null, suffixes: null, help: false };
	for (const arg of argv) {
		if (arg === "--publish") options.publish = true;
		else if (arg === "--allow-dirty") options.allowDirty = true;
		else if (arg === "--help" || arg === "-h") options.help = true;
		else if (arg.startsWith("--version=")) options.version = arg.slice("--version=".length);
		else if (arg.startsWith("--targets=")) {
			options.suffixes = arg
				.slice("--targets=".length)
				.split(",")
				.map((suffix) => suffix.trim())
				.filter(Boolean);
		} else fail(`Unknown argument: ${arg} (try --help)`);
	}
	return options;
}

function selectedTargets(suffixes) {
	if (!suffixes || suffixes.includes("all")) return BUILD_TARGETS.map(describeTarget);
	return suffixes.map((suffix) => {
		const target = BUILD_TARGETS.find((candidate) => describeTarget(candidate).suffix === suffix);
		if (!target) {
			fail(
				`Unknown target: ${suffix}. Known targets: ${BUILD_TARGETS.map((c) => describeTarget(c).suffix).join(", ")}`,
			);
		}
		return describeTarget(target);
	});
}

function rootDir() {
	return join(STAGING_DIR, "root");
}

function platformDir(target) {
	return join(STAGING_DIR, "platform", target.suffix);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function preflight(options, targets, version, pkg) {
	if (pkg.name !== PACKAGE_BASE) {
		fail(`package.json name (${pkg.name}) does not match resolveBinary.cjs PACKAGE_BASE (${PACKAGE_BASE})`);
	}
	if (!SEMVER_PATTERN.test(version)) fail(`Not a semver version: ${version}`);

	const dirty = run("git", ["status", "--porcelain"], { capture: true, allowFailure: true });
	if (dirty.ok && dirty.stdout.length > 0) {
		const message = `Git tree is not clean (${dirty.stdout.split("\n").length} changed path(s)). Commit first, or pass --allow-dirty.`;
		if (options.publish) fail(message);
		log(`Warning: ${message}`);
	}

	const whoami = run("npm", ["whoami"], { capture: true, allowFailure: true });
	if (!whoami.ok) {
		const message = "Not authenticated with npm. Run `npm login` (the scope must be writable by that account).";
		if (options.publish) fail(message);
		log(`Warning: ${message}`);
	} else {
		log(`npm user: ${whoami.stdout}`);
	}

	for (const name of [PACKAGE_BASE, ...targets.map((target) => target.packageName)]) {
		const existing = run("npm", ["view", `${name}@${version}`, "version"], { capture: true, allowFailure: true });
		if (existing.stdout === version) {
			const message = `${name}@${version} is already published. A published version can never be reused.`;
			if (options.publish) fail(message);
			log(`Warning: ${message}`);
		}
	}
}

function build(targets, version) {
	log("\nBuilding CSS bundle...");
	run("bun", ["run", "build:css"]);
	for (const target of targets) {
		log(`\nCompiling ${target.target}...`);
		const outfile = join(platformDir(target), target.binary);
		mkdirSync(platformDir(target), { recursive: true });
		run("bun", [
			"build",
			"--production",
			"--compile",
			"--minify",
			`--target=${target.target}`,
			"--define",
			`__EMBEDDED_VERSION__="${version}"`,
			`--outfile=${outfile}`,
			"src/cli.ts",
		]);
		chmodSync(outfile, 0o755);
	}
}

function rootManifest(version, targets, pkg) {
	return {
		name: PACKAGE_BASE,
		version,
		description: "Markdown-native task manager for humans and AI agents (personal fork of Backlog.md).",
		bin: { backlog: "cli.js" },
		files: ["cli.js", "resolveBinary.cjs", "postuninstall.cjs", "package.json", "README.md", "LICENSE"],
		scripts: { postuninstall: "node postuninstall.cjs" },
		publishConfig: { access: "public" },
		repository: pkg.repository,
		bugs: pkg.bugs,
		homepage: pkg.homepage,
		license: pkg.license,
		keywords: pkg.keywords,
		// Only the platform packages published in this run, pinned to the shared version.
		optionalDependencies: Object.fromEntries(targets.map((target) => [target.packageName, version])),
	};
}

function platformManifest(target, version, pkg) {
	return {
		name: target.packageName,
		version,
		description: `Prebuilt ${target.suffix} binary for ${PACKAGE_BASE}.`,
		os: [target.os],
		cpu: [target.cpu],
		files: [target.binary, "package.json", "LICENSE"],
		publishConfig: { access: "public" },
		repository: pkg.repository,
		license: pkg.license,
	};
}

function publishedReadme(version, targets) {
	const platforms = targets.map((target) => `\`${target.suffix}\``).join(", ");
	return `# ${PACKAGE_BASE}

Prebuilt binaries of [Backlog.md](https://backlog.md) — a markdown-native task
manager CLI — published as a personal fork. Provides the \`backlog\` command.

## Install

\`\`\`bash
npm install -g ${PACKAGE_BASE}
\`\`\`

Platform binaries ship as optional dependencies
(\`${PACKAGE_BASE}-<os>-<arch>\`) and are published for ${platforms} at the
same version ${version}.

## Source

https://github.com/normful/OpenSpecBacklog.md

Fork of https://github.com/MrLesk/Backlog.md. MIT licensed, see LICENSE.
`;
}

function stage(version, targets, pkg) {
	const root = rootDir();
	mkdirSync(root, { recursive: true });
	copyFileSync(join(__dirname, "cli.cjs"), join(root, "cli.js"));
	chmodSync(join(root, "cli.js"), 0o755);
	copyFileSync(join(__dirname, "resolveBinary.cjs"), join(root, "resolveBinary.cjs"));
	copyFileSync(join(__dirname, "postuninstall.cjs"), join(root, "postuninstall.cjs"));
	copyFileSync(join(REPO_ROOT, "LICENSE"), join(root, "LICENSE"));
	writeFileSync(join(root, "README.md"), publishedReadme(version, targets));
	writeJson(join(root, "package.json"), rootManifest(version, targets, pkg));

	for (const target of targets) {
		copyFileSync(join(REPO_ROOT, "LICENSE"), join(platformDir(target), "LICENSE"));
		writeJson(join(platformDir(target), "package.json"), platformManifest(target, version, pkg));
	}
}

function inspect(targets, publish) {
	for (const dir of [rootDir(), ...targets.map(platformDir)]) {
		const manifest = readJson(join(dir, "package.json"));
		log(`\n${manifest.name}@${manifest.version}`);
		run("npm", ["publish", "--access", "public", "--dry-run"], { cwd: dir });
	}
	if (!publish) {
		log("\nDry run only. Re-run with --publish to publish these packages.");
	}
}

function waitForPackage(name, version) {
	for (let attempt = 1; attempt <= REGISTRY_ATTEMPTS; attempt++) {
		const result = run("npm", ["view", `${name}@${version}`, "version"], { capture: true, allowFailure: true });
		if (result.stdout === version) {
			log(`  visible: ${name}@${version}`);
			return;
		}
		log(`  waiting for ${name}@${version} (${attempt}/${REGISTRY_ATTEMPTS})`);
		if (attempt < REGISTRY_ATTEMPTS) sleep(REGISTRY_DELAY_MS);
	}
	fail(`Timed out waiting for ${name}@${version} to become installable`);
}

function publish(targets, version) {
	log("\nPublishing platform packages...");
	for (const target of targets) {
		log(`  ${target.packageName}@${version}`);
		run("npm", ["publish", "--access", "public"], { cwd: platformDir(target) });
	}

	log("\nWaiting for platform packages to reach the registry...");
	for (const target of targets) waitForPackage(target.packageName, version);

	log(`\nPublishing ${PACKAGE_BASE}@${version}...`);
	run("npm", ["publish", "--access", "public"], { cwd: rootDir() });

	log("\nVerifying a clean install...");
	installSanity(version);
}

function installSanity(version) {
	const dir = join(STAGING_DIR, "sanity");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	writeJson(join(dir, "package.json"), { name: "install-sanity", version: "0.0.0", private: true });

	for (let attempt = 1; attempt <= REGISTRY_ATTEMPTS; attempt++) {
		rmSync(join(dir, "node_modules"), { recursive: true, force: true });
		rmSync(join(dir, "package-lock.json"), { force: true });
		const install = run(
			"npm",
			["install", `${PACKAGE_BASE}@${version}`, "--prefer-online", "--no-audit", "--no-fund"],
			{
				cwd: dir,
				capture: true,
				allowFailure: true,
			},
		);
		if (install.ok) {
			const check = run(join(dir, "node_modules", ".bin", "backlog"), ["-v"], {
				cwd: dir,
				capture: true,
				allowFailure: true,
			});
			if (check.stdout === version) {
				log(`  install sanity ok: backlog -v -> ${check.stdout}`);
				return;
			}
			log(`  backlog -v reported "${check.stdout}" (expected ${version})`);
		} else {
			log(`  attempt ${attempt}/${REGISTRY_ATTEMPTS} failed: ${firstLine(install.stderr)}`);
		}
		if (attempt < REGISTRY_ATTEMPTS) sleep(REGISTRY_DELAY_MS);
	}
	fail(`Install sanity failed for ${PACKAGE_BASE}@${version} after ${REGISTRY_ATTEMPTS} attempts`);
}

function printUsage() {
	log(`Usage: bun run publish:npm [-- --publish] [--targets=<a,b>] [--version=<v>] [--allow-dirty]

  (default)          build, stage and validate without publishing anything
  --publish          publish platform packages, then the root package
  --targets=<list>   comma separated suffixes, default all:
                     ${BUILD_TARGETS.map((target) => describeTarget(target).suffix).join(", ")}
  --version=<v>      version to publish, default: package.json version
  --allow-dirty      allow publishing from a dirty git tree

Staged output lives in dist/npm/ (gitignored).`);
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printUsage();
		return;
	}

	const targets = selectedTargets(options.suffixes);
	const pkg = readJson(join(REPO_ROOT, "package.json"));
	const version = options.version ?? pkg.version;

	log(`Publishing ${PACKAGE_BASE}@${version} for: ${targets.map((target) => target.suffix).join(", ")}`);
	preflight(options, targets, version, pkg);
	// Fresh staging area for both the compiled binaries and the assembled packages.
	rmSync(STAGING_DIR, { recursive: true, force: true });
	build(targets, version);
	stage(version, targets, pkg);
	inspect(targets, options.publish);
	if (options.publish) publish(targets, version);

	log(`\nDone. Users install with: npm install -g ${PACKAGE_BASE}`);
}

main();
