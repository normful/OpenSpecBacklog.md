---
id: BACK-470
title: Add schema YAML system and ArtifactGraph DAG engine
status: To Do
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
| `types.ts` (70L) | **Direct port — no changes** | Zod v4 compatible (z.str()). Contains SchemaYamlSchema, ArtifactSchema, CompletedSet, BlockedArtifacts. |
| `graph.ts` (167L) | **Direct port — no changes** | ArtifactGraph class with getBuildOrder (Kahn's algo), getNextArtifacts, getBlocked, isComplete. Pure data logic — no IO deps. |
| `schema.ts` (124L) | **Direct port — no changes** | loadSchema/parseSchema with validation (dup IDs, invalid requires refs, cycles via DFS). Only deps on types.ts + yaml npm. |
| `state.ts` (37L) | **Direct port — no changes** | detectCompleted calls artifactOutputExists for each artifact. Tiny — pure delegation. |
| `outputs.ts` (42L) | **Rewrite — Bun.Glob adapter** | Source imports `fast-glob` (not in Backlog deps) + `FileSystemUtils` (OpenSpec-internal). Replace with Bun's native `Bun.Glob`. Inline small helpers. |
| `resolver.ts` (302L) | **Rewrite — Backlog path conventions** | Source imports getGlobalDataDir from OpenSpec's global-config (XDG-based). Backlog has own FileSystem. Rewrite: project-local + built-in search paths. Skip user override initially. |
| `instruction-loader.ts` (548L) | **Skip entirely** | Not needed by BACK-470 nor downstream tasks (471-474). Instruction generation = OpenSpec-agent-specific. BACK-471 status formatting can be inline CLI handler. |

### Adaptation details

#### outputs.ts — Bun.Glob adapter

Source uses `fast-glob` + `FileSystemUtils.toPosixPath()` + `FileSystemUtils.canonicalizeExistingPath()`. Rewrite to use `Bun.Glob` (no new dep) and inline simple path helpers:

```ts
export function resolveArtifactOutputs(changeDir: string, generates: string): string[] {
  if (!isGlobPattern(generates)) {
    const fullPath = path.join(changeDir, generates);
    return fs.existsSync(fullPath) ? [path.resolve(fullPath)] : [];
  }
  const glob = new Bun.Glob(generates);
  return Array.from(glob.scanSync({ cwd: changeDir, absolute: true })).sort();
}
```

#### resolver.ts — Backlog path conventions

Source resolves: project-local → user override → package built-in.

For Backlog:
- **Package built-in**: Navigate from `src/openspec/artifact-graph/` → project root's `openspec/schemas/` dir via `import.meta.url`
- **Project-local**: `<projectRoot>/openspec/schemas/<name>/schema.yaml` (projectRoot from CLI handler)
- **User override**: Skip — BACK-474 only needs project-local + built-in

`getSchemaDir(name, projectRoot?)` checks: project-local (if projectRoot), then built-in. Returns first match.

### Files to create

Under `src/openspec/artifact-graph/`:
- `index.ts` — re-exports
- `types.ts` — direct port (SchemaYamlSchema, ArtifactSchema, ChangeMetadataSchema, TS types)
- `graph.ts` — direct port (ArtifactGraph class)
- `schema.ts` — direct port (loadSchema, parseSchema, SchemaValidationError)
- `state.ts` — direct port (detectCompleted)
- `outputs.ts` — rewrite (Bun.Glob adapter, inline helpers)
- `resolver.ts` — rewrite (Backlog path conventions, project-local + built-in only)

### Test file

`src/test/openspec-artifact-graph.test.ts` covering AC #1-8:
- SchemaYaml Zod validation (valid/invalid required fields)
- ArtifactGraph.getBuildOrder: linear chain, diamond, singleton, circular dep detection
- getNextArtifacts: empty completed, partial, all complete
- getBlocked: unmet deps map for blocked artifacts
- isComplete: false when any artifact missing, true when all present
- detectCompleted: filesystem existence checks
- Schema resolver: resolve by name, list all, not-found error
- Edge cases: empty artifacts, glob patterns, invalid schema parse errors

### What downstream tasks (BACK-471–474) use from this module

| Task | DAG features used |
|------|-------------------|
| BACK-471 (status) | resolveSchema, ArtifactGraph, detectCompleted, getNextArtifacts, getBlocked, isComplete — status formatting inline |
| BACK-472 (sync) | Light coupling — resolved schema for artifact awareness during delta apply |
| BACK-473 (archive) | ArtifactGraph.isComplete() — gating archive |
| BACK-474 (default schema) | Creates openspec/schemas/spec-driven/schema.yaml + templates — validated by parseSchema |
<!-- SECTION:DESCRIPTION:END -->
## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SchemaYaml is Zod-validated with required fields
- [ ] #2 ArtifactGraph.getBuildOrder() returns topological sort via Kahn's algorithm
- [ ] #3 getNextArtifacts returns sorted artifacts with all deps completed
- [ ] #4 getBlocked returns artifact→str[] map of unmet deps
- [ ] #5 detectCompleted checks filesystem existence of generate patterns
- [ ] #6 Schema resolver searches project local then built-in schemas
- [ ] #7 Schema list returns all available schemas with descriptions
- [ ] #8 Unit tests for graph edge cases: circular deps, singleton, diamond
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
- [ ] #5 bun run check . passes
