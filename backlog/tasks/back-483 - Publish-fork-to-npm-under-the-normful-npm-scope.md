---
id: BACK-483
title: Publish fork to npm under the @normful npm scope
status: Done
assignee:
  - '@pi'
created_date: '2026-09-29 20:37+09:00'
updated_date: '2026-09-29 21:46+09:00'
labels: []
dependencies: []
references:
  - backlog/plans/back-483 - Publish-fork-to-npm-under-the-normful-npm-scope.md
priority: high
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a local bun script that builds and publishes this fork to npm under the @normful scope so it can be installed with `npm install @normful/openspec-backlog.md`.

Context: the repo currently publishes as unscoped `backlog.md` plus five unscoped platform packages via .github/workflows/release.yml (GitHub OIDC trusted publishing, hardwired to MrLesk/Backlog.md). The fork needs its own scoped names, published under Norman's npm scope and runnable from this machine with bun.

Full plan: backlog/plans/back-483 - Publish-fork-to-npm-under-the-normful-npm-scope.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A local script stages and publishes @normful/openspec-backlog.md plus its platform packages; real publish requires an explicit flag (dry-run is the default).
- [x] #2 npm install @normful/openspec-backlog.md in a clean dir yields a working backlog CLI reporting the repo version.
- [x] #3 Root package optionalDependencies reference only platform packages published in the same run.
- [x] #4 Source package names, resolveBinary.cjs, postuninstall.cjs and resolveBinary tests agree on the scoped names.
- [x] #5 No publish ever runs without npm auth and a clean git tree.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the rename and the publish script.

Source changes: package.json name/optionalDependencies/repository/bugs + publish:npm script; resolveBinary.cjs now owns PACKAGE_BASE as the single source of truth; cli.cjs arg filter and postuninstall.cjs platform list derive from it; resolveBinary.test.ts asserts the scoped names and that PACKAGE_BASE matches package.json name.

New: scripts/publish-npm.cjs (bun run publish:npm). Dry run by default (builds all 5 targets, stages dist/npm/, validates every package with npm publish --dry-run); --publish publishes platform packages, waits for registry propagation, publishes the root package, then verifies a clean install. --targets/--version/--allow-dirty flags. Staged layout verified locally: the shim resolves the platform package and reports 1.45.1.

Remaining step is gated on the user: npm login plus @normful scope ownership confirmation, then `bun run publish:npm -- --publish`. Publishing is irreversible (a name@version can never be reused).

bun.lock regenerated (bun install --ignore-scripts --lockfile-only) because it records the root package name and optionalDependencies. That also cleared stale zod/yaml root entries left by b765ecd, which had already broken `bun install --frozen-lockfile` before this change (confirmed against the pre-change manifest).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Published the fork to npm under the @normful scope and verified it end to end.

Source: package rename to @normful/openspec-backlog.md (scoped optionalDependencies, fork repository/bugs), PACKAGE_BASE as the single source of truth in resolveBinary.cjs with cli.cjs arg filter and postuninstall.cjs deriving from it, PACKAGE_BASE-vs-package.json drift test, bun.lock synced (also cleared the stale zod/yaml root entries that were already breaking bun install --frozen-lockfile).

New scripts/publish-npm.cjs (bun run publish:npm): dry run by default; --publish builds all five targets, publishes the platform packages, waits for propagation, publishes the root package, then verifies a clean install.

Result: @normful/openspec-backlog.md@1.45.1 plus darwin-arm64, darwin-x64, linux-arm64, linux-x64 and windows-x64 platform packages, all on the latest tag (~177 MB uploaded). Acceptance: a fresh npm install pulls only the root plus the matching platform package and the installed backlog reports 1.45.1 and lists tasks in this repo. Remaining known gap: the four non-native binaries are published but unverified locally; a fix needs a new version for all six packages.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->
