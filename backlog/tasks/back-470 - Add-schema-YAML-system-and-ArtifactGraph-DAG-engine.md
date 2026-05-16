---
id: BACK-470
title: Add schema YAML system and ArtifactGraph DAG engine
status: Done
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-466
priority: high
ordinal: 28000
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Port OpenSpec's artifact dep graph system: (1) SchemaYaml type with Zod validation — name, version, artifacts[] (id, generates, requires[], template). (2) ArtifactGraph class — topological sort (Kahn's algorithm), getNextArtifacts(completed), getBlocked(completed), isComplete(completed). (3) Schema loader — loadSchema(filePath), parseSchema(yamlContent), schema resolution from openspec/schemas/<name>/schema.yaml. (4) State detection — detectCompleted(graph, changeDir) via filesystem file existence for generate patterns. Support both simple paths and glob patterns. (5) Schema resolver — listSchemas(), resolveSchema(name), with user global + project-local + built-in search paths.

### Source: OpenSpec /src/core/artifact-graph/

Source retrieved via `opensrc` at `/Users/norman/.opensrc/repos/github.com/Fission-AI/OpenSpec/main/src/core/artifact-graph/`.

| Source file | Verdict | Reason |
|-------------|---------|--------|
| `types.ts` (70L) | **Direct port — no changes** | Zod v4 compatible. Contains SchemaYamlSchema, ArtifactSchema, CompletedSet, BlockedArtifacts. |
| `graph.ts` (167L) | **Direct port — no changes** | ArtifactGraph class with getBuildOrder (Kahn's algo), getNextArtifacts, getBlocked, isComplete. Pure data logic — no IO deps. |
| `schema.ts` (124L) | **Direct port — no changes** | loadSchema/parseSchema with validation (dup IDs, invalid requires refs, cycles via DFS). Only deps on types.ts + yaml npm. |
| `state.ts` (37L) | **Direct port — no changes** | detectCompleted calls artifactOutputExists for each artifact. Tiny — pure delegation. |
| `outputs.ts` (42L) | **Rewrite — Bun.Glob adapter** | Source imports `fast-glob` (not in Backlog deps) + `FileSystemUtils` (OpenSpec-internal). Replace with Bun's native `Bun.Glob`. Inline small helpers. |
| `resolver.ts` (302L) | **Rewrite — Backlog path conventions** | Source imports getGlobalDataDir from OpenSpec's global-config (XDG-based). Backlog has own FileSystem. Rewrite: project-local + built-in search paths. Skip user override initially. |
| `instruction-loader.ts` (548L) | **Skip entirely** | Not needed by BACK-470 nor downstream tasks (471-474). Instruction generation is OpenSpec-agent-specific. BACK-471 status formatting can be inline CLI handler. |

### Adaptation details

#### outputs.ts — Bun.Glob adapter

Source uses `fast-glob` + `FileSystemUtils`. Rewrote to use `Bun.Glob` (no new dep):
- `isGlobPattern(pattern)` — detects *, ?, [ characters in pattern
- `resolveArtifactOutputs(changeDir, generates)` — uses `Bun.Glob.scanSync` for globs, simple `fs.statSync` for paths
- `artifactOutputExists(changeDir, generates)` — delegates to resolveArtifactOutputs

#### resolver.ts — Backlog path conventions

Source resolves: project-local → user override → package built-in.
Backlog variant: project-local → built-in only. No user override (BACK-474 only needs project-local + built-in).

`getSchemaDir(name, projectRoot?)` checks in order: project-local (if projectRoot), then built-in. Returns first match.

#### SchemaLoadError class fix

Original source used `public readonly schemaPath: string` in the constructor (parameter property with `override`). TypeScript strict mode rejected this because `Error` doesn't have `schemaPath`. Changed to class field declaration + this assignment in constructor body. Used `super(message, { cause })` to avoid `override` modifier on `cause`.

### Files created

Under `src/openspec/artifact-graph/`:
- `index.ts` — re-exports all public API
- `types.ts` — direct port (SchemaYamlSchema, ArtifactSchema, ChangeMetadataSchema, TS types)
- `graph.ts` — direct port (ArtifactGraph class)
- `schema.ts` — direct port (loadSchema, parseSchema, SchemaValidationError)
- `state.ts` — direct port (detectCompleted)
- `outputs.ts` — rewritten (Bun.Glob adapter)
- `resolver.ts` — rewritten (Backlog path conventions, project-local + built-in only)

### Test file

`src/test/openspec-artifact-graph.test.ts` — 39 tests covering all ACs:
- SchemaYaml Zod validation (missing name, zero version, empty artifacts, missing id, defaults)
- parseSchema validation errors (duplicate IDs, invalid refs, circular deps, self-loop)
- ArtifactGraph.getBuildOrder (linear chain, diamond, singleton, sorted roots)
- getNextArtifacts (empty roots, partial completion, all done, unmet deps)
- getBlocked (empty blocked map, unmet deps, deeply blocked, completed omitted)
- isComplete (none, partial, all, singleton)
- Accessors (getArtifact by ID/missing, getAllArtifacts, getName/getVersion)
- isGlobPattern (asterisk, question, bracket, simple paths)
- detectCompleted (missing dir, file existence, glob patterns)

### What downstream tasks (BACK-471–474) use from this module

| Task | DAG features used |
|------|-------------------|
| BACK-471 (status) | resolveSchema, ArtifactGraph (fromYaml/fromSchema), detectCompleted, getNextArtifacts, getBlocked, isComplete — status formatting inline |
| BACK-472 (sync) | Light coupling — resolved schema for artifact awareness during delta apply |
| BACK-473 (archive) | ArtifactGraph.isComplete() — gating archive |
| BACK-474 (default schema) | Creates openspec/schemas/spec-driven/schema.yaml + templates — validated by parseSchema |

### Deviations from Plan

- `SchemaLoadError` class: original source used `override` parameter property for `schemaPath`. TypeScript strict TS4114 error — changed to class field + body assignment pattern.
- `super(message, { cause })` used for cause propagation instead of separate `public readonly cause` field, avoiding need for `override` modifier.
- Tests: needed an `ArtifactInput` helper interface + `toSchemaYaml()` that `JSON.stringify`s objects so `parseSchema()` (which calls `parseYaml()`) gets string input. Direct object literals didn't satisfy the `Artifact` TS type (missing `description`, `requires` which have defaults at Zod level but are required at TS type level).
- `yaml` added as direct dependency in `package.json` (was only transitive via devDeps).
<!-- SECTION:DESCRIPTION:END -->
## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SchemaYaml is Zod-validated with required fields
- [x] #2 ArtifactGraph.getBuildOrder() returns topological sort via Kahn's algorithm
- [x] #3 getNextArtifacts returns sorted artifacts with all deps completed
- [x] #4 getBlocked returns artifact→str[] map of unmet deps
- [x] #5 detectCompleted checks filesystem existence of generate patterns
- [x] #6 Schema resolver searches project local then built-in schemas
- [x] #7 Schema list returns all available schemas with descriptions
- [x] #8 Unit tests for graph edge cases: circular deps, singleton, diamond
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
- [x] #4 bun test passes
- [x] #5 bun run check . passes
