#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { getPackageName } = require("./resolveBinary.cjs");

// Platform-specific packages to uninstall, derived from the published naming scheme
const platformPackages = [
	["linux", "x64"],
	["linux", "arm64"],
	["darwin", "x64"],
	["darwin", "arm64"],
	["win32", "x64"],
].map(([platform, arch]) => getPackageName(platform, arch));

// Detect package manager
const packageManager = process.env.npm_config_user_agent?.split("/")[0] || "npm";

console.log("Cleaning up platform-specific packages...");

// Try to uninstall all platform packages
for (const pkg of platformPackages) {
	const args = packageManager === "bun" ? ["remove", "-g", pkg] : ["uninstall", "-g", pkg];

	const child = spawn(packageManager, args, {
		stdio: "pipe", // Don't show output to avoid spam
		windowsHide: true,
	});

	child.on("exit", (code) => {
		if (code === 0) {
			console.log(`✓ Cleaned up ${pkg}`);
		}
		// Silently ignore failures - package might not be installed
	});
}

console.log("Platform package cleanup completed.");
