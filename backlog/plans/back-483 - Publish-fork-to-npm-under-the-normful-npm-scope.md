---
id: back-483
title: Publish fork to npm under the @normful npm scope
status: Draft
assignee: [pi]
created_date: '2026-09-29'
priority: high
---

# BACK-483 — Publish fork to npm under the @normful npm scope

## Summary

Add a local bun script that builds and publishes this fork to npm as
`@normful/openspec-backlog.md` (plus its per-platform binary packages), so that
`npm install @normful/openspec-backlog.md` produces a working `backlog` CLI.

The fork already has a complete release pipeline for the *upstream* names
(`backlog.md`, unscoped platform packages, `MrLesk/Backlog.md` + GitHub OIDC
trusted publishing). This plan reuses that pipeline's proven mechanics
(native-target builds, platform packages as `optionalDependencies`, bounded
propagation waits, install sanity) but points everything at the `@normful` scope
and drives it from a script on Norman's machine instead of a tag push.

## Goal / acceptance

- `npm install @normful/openspec-backlog.md` in an empty directory yields a
  `backlog` binary that runs and reports the repo's version.
- `npm install -g @normful/openspec-backlog.md` likewise works.
- One local command publishes; dry-run is the default and real publishing
  requires an explicit flag.
- Published package set is self-consistent: the root package never references a
  platform package that does not exist on the registry.

## Current state (verified 2026-09-29)

Repo (fork): `git@github.com:normful/OpenSpecBacklog.md.git`, `main` @ `edc180b`,
`package.json` version `1.45.1`.

Package wiring:

- `package.json:2` — `"name": "backlog.md"`.
- `package.json:11-13` — `bin: { backlog: "scripts/cli.cjs" }`.
- `package.json:14-20` — five `optionalDependencies` on unscoped
  `backlog.md-<platform>-<arch>` pinned to `"*"`.
- `scripts/cli.cjs:8` — shim resolves the real binary via `resolveBinaryPath()`
  and `spawn`s it (`scripts/cli.cjs:28`).
- `scripts/cli.cjs:20` — arg-cleaning regex hardcodes
  `node_modules/backlog\.md-(darwin|linux|windows)-...`.
- `scripts/resolveBinary.cjs:23-25` — hardcodes `` `backlog.md-${platform}-${arch}` ``.
- `scripts/postuninstall.cjs:6-12` — hardcodes the same five names, then shells
  out to `npm uninstall -g <pkg>`.
- `src/test/resolveBinary.test.ts:8,12` — asserts the unscoped names (the only
  place these names appear under `src/`).
- The compiled binary embeds the version at build time via
  `--define __EMBEDDED_VERSION__` (`package.json:59`, read in
  `src/utils/version.ts:11`), so `backlog -v` reports the version baked into the
  binary it was published from.

Release pipeline: `.github/workflows/release.yml` (523 lines), tag-triggered,
hardwired to upstream names/repo. Jobs and mechanics worth reusing:

- `build` — matrix of 5 targets built on native runners: `bun-linux-x64-baseline`,
  `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`,
  `bun-windows-x64-baseline` (plus a Windows cache-priming workaround).
- `publish-binaries` — one npm package per target, `os`/`cpu` constrained.
- `verify-platform-packages` — waits (40 × 15 s) until platform packages are
  visible/installable before publishing the root package.
- `npm-publish` — rewrites `package.json` with `jq` into `dist/`, then
  `npm publish --access public` (OIDC trusted publishing, no tokens).
- `install-sanity` — fresh-directory `npm i backlog.md@<v>` + `npx backlog -v`
  on ubuntu/macos/windows, retried the same way.

Local toolchain:

- bun `1.3.13`; `npm whoami` → `401` (not logged in); `nix` present, `bun2nix` absent.

Verified by experiment (not assumed):

- **Cross-compilation from this Mac works.** `bun build --compile --minify
  --target=bun-linux-x64-baseline` → 108 MB binary;
  `--target=bun-windows-x64-baseline` → 124 MB. (Native `dist/backlog` is 67 MB.)
- **A 404 `optionalDependency` is non-fatal for bun.** `bun install
  --ignore-scripts` in a scratch project declaring an unpublished
  `@scope/pkg@*` warns and exits 0. So renaming the source
  `optionalDependencies` to not-yet-published scoped names will not break local
  dev.
- **The target name is valid.** `npm pack --dry-run` in a scratch dir with
  `"name": "@normful/openspec-backlog.md"` succeeds; the registry returns a plain
  404 for it (not-yet-published, not an invalid-name error).
- **`@normful` scope ownership is unverified.** `GET registry.npmjs.org/-/org/normful`
  → `404 ResourceNotFound`, while `GET registry.npmjs.org/-/org/normful/user`
  → `{"normful":"owner"}`. These contradict each other and both may be
  auth-gated. It must be checked with an authenticated session (Phase 0).

## Design

### Package names

| Package | Contents |
| --- | --- |
| `@normful/openspec-backlog.md` | shim (`cli.js`), `resolveBinary.cjs`, `postuninstall.cjs`, README, LICENSE |
| `@normful/openspec-backlog.md-darwin-arm64` | compiled binary |
| `@normful/openspec-backlog.md-darwin-x64` | compiled binary |
| `@normful/openspec-backlog.md-linux-arm64` | compiled binary |
| `@normful/openspec-backlog.md-linux-x64` | compiled binary |
| `@normful/openspec-backlog.md-windows-x64` | compiled binary (`.exe`) |

The executable stays named `backlog` (so existing docs, MCP configs and
`backlog/` project dirs keep working). Only package names change.

### Generated package.json shapes

Root (`dist/npm/root/package.json`), generated — never the tracked `package.json`:

```json
{
  "name": "@normful/openspec-backlog.md",
  "version": "1.45.1",
  "bin": { "backlog": "cli.js" },
  "files": ["cli.js", "resolveBinary.cjs", "postuninstall.cjs", "package.json", "README.md", "LICENSE"],
  "scripts": { "postuninstall": "node postuninstall.cjs" },
  "publishConfig": { "access": "public" },
  "repository": { "type": "git", "url": "git+https://github.com/normful/OpenSpecBacklog.md.git" },
  "optionalDependencies": { "@normful/openspec-backlog.md-darwin-arm64": "1.45.1" }
}
```

Platform (`dist/npm/platform/<target>/package.json`):

```json
{
  "name": "@normful/openspec-backlog.md-darwin-arm64",
  "version": "1.45.1",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "files": ["backlog", "package.json", "LICENSE"],
  "publishConfig": { "access": "public" }
}
```

Rules baked into the generator:

1. **Only declare what you publish.** `optionalDependencies` is built from the
   set of platform packages actually published in that run, pinned to the exact
   version. No `"*"`, no dangling references.
2. Scoped packages must be public — `publishConfig.access: "public"` plus an
   explicit `--access public` on the command line.
3. No `devDependencies`, no `type: "module"`, no build scripts in the published
   manifests.

### `scripts/publish-npm.cjs`

Written in CommonJS to match the other files in `scripts/` (`cli.cjs`,
`postuninstall.cjs`, `resolveBinary.cjs`); it is dev tooling, covered by
`bun run check .` and excluded from the published tarball by the `files`
whitelist. Invoked as `bun scripts/publish-npm.cjs` via a new npm script
`"publish:npm"`.

Flags:

| Flag | Effect |
| --- | --- |
| *(none)* | build, stage, `npm publish --dry-run` for every package, print staged contents. Publishes nothing. |
| `--publish` | real publish (platform packages → wait for propagation → root). |
| `--targets=<csv>` | restrict targets, e.g. `--targets=darwin-arm64`. Default: all five. |
| `--version=<v>` | override version. Default: `package.json` version. |
| `--allow-dirty` | permit publishing from a dirty git tree (logged loudly). |

Step sequence for `--publish`:

1. Preflight: `git status --porcelain` empty (unless `--allow-dirty`);
   `npm whoami` succeeds; `PACKAGE_BASE` === `package.json.name`;
   `npm view @normful/openspec-backlog.md@<v> version` must 404 (refuse to
   re-publish an existing version).
2. Build: `bun run build:css`, then per target
   `bun build --production --compile --minify --target=<t>
   --define __EMBEDDED_VERSION__="\"<v>\"" --outfile=dist/npm/platform/<t>/backlog`.
3. Stage root and platform dirs under `dist/npm/` (gitignored).
4. Publish platform packages in order, `--access public`.
5. Wait for each platform package to be installable (reuse the
   `verify-platform-packages` retry policy: 40 attempts × 15 s,
   `npm view <pkg>@<v> version`).
6. Publish the root package.
7. Install sanity: scratch dir → `npm i @normful/openspec-backlog.md@<v>` →
   `node_modules/.bin/backlog -v` must print `<v>`; retry with the same bounded
   policy because the root can resolve before optional deps propagate.
8. Print the run summary (packages, versions, registry URLs).

Explicitly *not* in this script: git tagging, GitHub releases, version bumps in
tracked files, and touching the `~/.bun/bin/backlog` dev symlink created by
`bun link` (unrelated to npm installs).

### Source changes (one-time rename)

| File | Change |
| --- | --- |
| `package.json:2` | `name` → `@normful/openspec-backlog.md` |
| `package.json:15-19` | `optionalDependencies` → the five scoped names (safe per the 404-optional-dep experiment) |
| `package.json:77-84` | `repository`/`bugs` → the fork; `homepage` decision (open question 3) |
| `package.json:51-58` | add `"publish:npm": "bun scripts/publish-npm.cjs"` |
| `scripts/resolveBinary.cjs:23-25` | single `const PACKAGE_BASE = "@normful/openspec-backlog.md"` exported alongside `getPackageName`; `getPackageName` builds from it |
| `scripts/cli.cjs:20` | arg-cleaning regex → scoped name (e.g. `@normful/openspec-backlog\.md-(darwin\|linux\|windows)-...`) |
| `scripts/postuninstall.cjs:6-12` | derive the five names in a loop from `getPackageName` instead of a hardcoded list |
| `src/test/resolveBinary.test.ts:8,12` | expectations → scoped names |

Nothing else in `src/` depends on the package name (`src/utils/app-info.ts:5`
returns `"backlog.md"` but is used only as the MCP server's `APP_NAME` at
`src/mcp/server.ts:53` — see open question 3).

## Phases

### Phase 0 — scope prerequisite (Norman, ~5 min, blocking)

`npm login`, then confirm the scope: `npm whoami` and `npm org ls normful`
(and `npm access list packages @normful`). If `@normful` is not owned by this
account, either create the org at npmjs.com/org/create or pick a different name
before any code lands. Nothing below works without write access to the scope.

### Phase 1 — rename + script, publish `darwin-arm64` only

The minimum that makes `npm install @normful/openspec-backlog.md` work on this
Mac, and the only target whose binary can be smoke-tested locally.

1. Apply the source changes table above.
2. Add `scripts/publish-npm.cjs`.
3. `bun test src/test/resolveBinary.test.ts`, `bunx tsc --noEmit`,
   `bun run check .`.
4. `bun run publish:npm` (dry run) — inspect generated manifests and the staged
   file lists (`npm pack --dry-run` in each staged dir).
5. `bun run publish:npm --publish --targets=darwin-arm64` (requires Norman's
   go-ahead — publishing is irreversible).
6. Acceptance test per "Verification" below.

### Phase 2 — all five platforms

- Run the same script with the full target list. Cross-compilation for
  `linux-x64-baseline` and `windows-x64-baseline` is already verified working
  from this machine; `darwin-x64` and `linux-arm64` follow the same path.
- Cross-compiled binaries cannot be executed here, so they ship
  "published but unverified" unless Phase 3 is done. The root package declares
  all five only after all five are published.

### Phase 3 (optional) — CI parity

Adapt `.github/workflows/release.yml` to the fork: rename the five package names
everywhere, point trusted publishers at `normful/OpenSpecBacklog.md`, and update
the install-sanity checks to the scoped names. Needs npm-side setup (link each
of the six packages as a trusted publisher, or fall back to an `NPM_TOKEN`
secret). Payoff: provenance attestations and native-runner verification on all
three OSes. Out of scope for Phase 1 deliberately — it is a 523-line workflow
coupled to upstream naming and OIDC configuration.

## Decisions (and rejected alternatives)

1. **Keep the `backlog` executable name; change only package names.** Renaming
   the binary or the `backlog/` project directory would break this repo's own
   docs, MCP configs and instructions for no gain.
2. **Keep the platform-package architecture** (per-OS/arch tarball +
   `optionalDependencies`). Rejected: one tarball containing all five binaries
   (67–124 MB each, ~460 MB unpacked — a slow install; npm documents no hard
   size cap, but its publish path serializes the whole tarball in memory, so
   large publishes are failure-prone); a `postinstall` download
   script (adds a network side effect at install time, breaks offline/CI
   installs, and the repo deliberately removed download scripts).
3. **Single source of truth for the package base name** in
   `resolveBinary.cjs` with `postuninstall.cjs` deriving from it, plus a
   drift assertion in the publish script. Today the name is duplicated in three
   files, which is exactly how a half-renamed publish happens.
4. **Stage into gitignored `dist/npm/`; never rewrite tracked `package.json`.**
   Upstream rewrites a copy under `dist/` too — same property, no version churn
   in git.
5. **Defaults to dry-run; `--publish` required for real publishing.** A published
   version cannot be reused, so an accidental publish is unrecoverable (best case
   is burning the next version number).
6. **Ambient npm session auth (`npm login`), no tokens in the repo.** The script
   preflights `npm whoami` and fails with instructions instead of half-publishing.
7. **No provenance for local publishes.** npm provenance requires CI OIDC; local
   publishes will lack attestations until Phase 3. Acceptable for a personal
   fork, and documented rather than glossed over.
8. **Partial first publish is intentional.** Phase 1 publishes one platform
   package; other platforms get a clear runtime error from the shim
   (`Binary package not installed for <platform>`) rather than a broken install.

## Risks

- **Irreversible publish.** Mitigations: dry-run default, existing-version
  preflight, staged content listing before publish, all-or-nothing per package.
- **Unverified scope ownership.** If `@normful` belongs to someone else, the
  target name changes and this plan's names must be revisited (Phase 0 catches it
  before any code is written).
- **Unverified non-native binaries.** Only `darwin-arm64` can be smoke-tested
  here; Phase 2 ships four targets untested locally unless Phase 3 lands.
- **Version monotonicity per package.** All six packages move in lock-step; a
  partial publish at version *v* followed by a retry at *v* will be refused by the
  preflight, so a retry needs a new version or a targeted re-run.
- **`postuninstall` side effect.** `postuninstall.cjs` runs `npm uninstall -g` for
  every platform package of the published name when the root package is removed.
  Behaviour is unchanged from upstream, but with scoped names the derived list
  must be correct — covered by the derivation change and a test.
- **Rebranding leftovers.** `src/utils/app-info.ts` still reports `backlog.md`
  as the MCP app name, and MCP docs reference `backlog.md`. Deliberately out of
  scope (open question 3).

## Verification

- `dist/npm/root/package.json` name/version/`optionalDependencies` exactly match
  the staged platform directories, with no entry for an unpublished platform.
- `npm pack --dry-run` in each staged dir lists only the intended files
  (no `src/`, no `scripts/`, no test files).
- Fresh-directory install on this Mac: `npm i @normful/openspec-backlog.md` then
  `./node_modules/.bin/backlog -v` → the published version; `backlog --help`
  renders; one real command (`backlog task list`) works inside a scratch project.
- Global install: `npm i -g @normful/openspec-backlog.md` then `backlog -v`.
- Registry: `npm view @normful/openspec-backlog.md version`,
  `npm view @normful/openspec-backlog.md dependencies` (shows pinned scoped
  optional deps), and one platform package metadata check.
- Repo hygiene after a dry run: `git status` shows only the intended source
  rename plus the new script (no generated artifacts — `dist/` is gitignored).
- Unit tests: `bun test src/test/resolveBinary.test.ts`, `bunx tsc --noEmit`,
  `bun run check .`.

## Open questions (defaults chosen)

1. **Does `@normful` exist and does Norman own it?** Default: Phase 0 confirms;
   abort if not. (Could not be verified without auth — see Current state.)
2. **First publish scope: one platform or all five?** Default: `darwin-arm64`
   only in Phase 1, extend in Phase 2.
3. **Rebrand the user-visible name** (`homepage`, `app-info.ts` MCP `APP_NAME`,
   MCP docs that say `npx backlog.md`)? Default: no — keep `backlog` and
   `Backlog.md` branding untouched in this change; the package name is the only
   thing that moves.
4. **Include GitHub release assets / tag-driven CI in this change?** Default: no
   (Phase 3, optional).
5. **What goes in the binary's `-v` output path?** Default: reuse the existing
   build invocation verbatim so the compiled binary is identical to
   `bun run build` apart from the target and `__EMBEDDED_VERSION__`.

## Implementation notes (2026-09-29)

Phase 1 and Phase 2 are implemented; the actual publish is the only step left and
it is gated on an npm login + scope confirmation (Phase 0).

What shipped:

- `package.json`: `name` → `@normful/openspec-backlog.md`, scoped
  `optionalDependencies`, fork `repository`/`bugs`, new `publish:npm` script.
- `scripts/resolveBinary.cjs`: `PACKAGE_BASE` is the single source of truth.
- `scripts/cli.cjs`: the leaked-arg filter now matches `node_modules/<package>/`
  using `getPackageName()` instead of a hardcoded regex.
- `scripts/postuninstall.cjs`: the five platform package names are derived.
- `src/test/resolveBinary.test.ts`: scoped expectations plus a new
  `PACKAGE_BASE === package.json.name` drift guard.
- `scripts/publish-npm.cjs`: the publish script (see below).

Deviations from this plan, all deliberate:

1. **Preflights are severity-split.** A dirty git tree, a missing npm login and an
   already-published version are hard failures only with `--publish`; in dry-run
   mode they warn. Otherwise the flow could not be exercised before logging in.
2. **The published README is generated, not copied.** Shipping the repo README
   would tell users to `npm i -g backlog.md` (the upstream package).
3. **`__EMBEDDED_VERSION__` is passed as `__EMBEDDED_VERSION__="${version}"`.**
   Matching the shell-expanded value of `bun run build`; the first attempt passed
   an extra level of quoting and `backlog -v` printed `"1.45.1"` with quotes.
4. **Staging is wiped once, before the build**, not inside the staging step —
   wiping after the compiles deleted the freshly built binaries.
5. **`bun.lock` was regenerated** (`bun install --ignore-scripts --lockfile-only`)
   because it records the root package name and `optionalDependencies`. That
   pull-in also drops stale `zod`/`yaml` root entries left by commit `b765ecd`
   ("drop zod + yaml deps, replace with pure TS validators"), which had already
   broken `bun install --frozen-lockfile` before this change — verified by
   running the frozen check against the pre-change manifest. No new versions are
   introduced: the lock's transitive `zod@3.25.76` / `yaml@2.8.3` resolutions
   simply become the root resolution, so the per-package override entries
   disappear.

Local verification performed against the staged layout (no registry involved):

- `npm publish --dry-run` succeeds for all six packages; tarball contents are
  exactly the intended files (no `src/`, no `scripts/`).
- `node_modules/@normful/openspec-backlog.md-darwin-arm64` resolved from the
  staged shim: `node dist/npm/root/cli.js -v` → `1.45.1`.
- The shim strips a leaked deep platform-binary path argument while still
  rejecting a genuinely unknown flag.
- Cross-built unpacked sizes: darwin-arm64 69.6 MB, darwin-x64 74.8 MB,
  linux-arm64 107.9 MB, linux-x64 107.4 MB, windows-x64 123.4 MB. The non-native
  targets carry a larger embedded runtime, so expect ~25–45 MB tarballs each.
- `bun test` (1422 pass, 2 skip), `bunx tsc --noEmit`, `bun run check .` all pass.
