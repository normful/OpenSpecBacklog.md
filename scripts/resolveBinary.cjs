// Single source of truth for the published package name.
// Must match "name" in package.json; scripts/publish-npm.cjs asserts this and
// src/test/resolveBinary.test.ts guards it.
const PACKAGE_BASE = "@normful/openspec-backlog.md";

function mapPlatform(platform = process.platform) {
	switch (platform) {
		case "win32":
			return "windows";
		case "darwin":
		case "linux":
			return platform;
		default:
			return platform;
	}
}

function mapArch(arch = process.arch) {
	switch (arch) {
		case "x64":
		case "arm64":
			return arch;
		default:
			return arch;
	}
}

function getPackageName(platform = process.platform, arch = process.arch) {
	return `${PACKAGE_BASE}-${mapPlatform(platform)}-${mapArch(arch)}`;
}

function resolveBinaryPath(platform = process.platform, arch = process.arch) {
	const packageName = getPackageName(platform, arch);
	const binary = `backlog${platform === "win32" ? ".exe" : ""}`;
	return require.resolve(`${packageName}/${binary}`);
}

module.exports = { PACKAGE_BASE, getPackageName, resolveBinaryPath };
