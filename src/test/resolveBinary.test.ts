import { describe, expect, it } from "bun:test";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PACKAGE_BASE, getPackageName } = require("../../scripts/resolveBinary.cjs");

describe("getPackageName", () => {
	it("maps win32 platform to windows package", () => {
		expect(getPackageName("win32", "x64")).toBe("@normful/openspec-backlog.md-windows-x64");
	});

	it("returns linux name unchanged", () => {
		expect(getPackageName("linux", "arm64")).toBe("@normful/openspec-backlog.md-linux-arm64");
	});
});

describe("PACKAGE_BASE", () => {
	it("matches the package.json name", async () => {
		const pkg = await Bun.file("package.json").json();
		expect(PACKAGE_BASE).toBe(pkg.name);
	});
});
