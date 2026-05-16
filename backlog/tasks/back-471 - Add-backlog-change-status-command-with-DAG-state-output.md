---
id: BACK-471
title: Add 'backlog change status' cmd with DAG state output
status: Done
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-470
priority: high
ordinal: 29000
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Add CLI cmd: `backlog change status <name> [--json]`. Computes artifact DAG state for a change: loads schema YAML from change's `.openspec.yaml` metadata (default: `spec-driven`), builds `ArtifactGraph`, runs `detectCompleted` on the change dir, then outputs per-artifact status (done/ready/blocked) with missing dep info. Supports `--json` for agent consumption. Text output shows progress bar (done/total), artifact list with status indicators, and next action hint.

### Imports from BACK-470 module

```
import {
  resolveSchema,   // resolveSchema(name, projectRoot) → SchemaYaml | throws
  ArtifactGraph,   // ArtifactGraph.fromSchema(schema) → ArtifactGraph
  detectCompleted, // detectCompleted(graph, changeDir) → CompletedSet
  listSchemas,     // listSchemas(projectRoot?) → string[]
} from "../openspec/artifact-graph/index.ts";
```

### Command logic

```
1. Resolve change dir: backlog/changes/<name>/
2. Load .openspec.yaml metadata → schema name (default: "spec-driven")
3. resolveSchema(schemaName, projectRoot) → SchemaYaml
4. ArtifactGraph.fromSchema(schema) → graph
5. detectCompleted(graph, changeDir) → completed Set<string>
6. Compute status per artifact:
   - completed.has(id) → "done"
   - graph.getNextArtifacts(completed).includes(id) → "ready"
   - else → "blocked" (get missingDeps from getBlocked(completed)[id])
7. Output:
   - JSON (--json): { changeName, schemaName, artifacts: [{id, status, missingDeps?}] }
   - Text: ✓/○/◉ indicators, progress N/M, next action hint
```

### Status mapping

| State | Condition | Indicator |
|-------|-----------|-----------|
| done | artifact ID in CompletedSet | ✓ (green) |
| ready | getNextArtifacts includes ID | ○ (blue) |
| blocked | not done and not ready → blocked deps from getBlocked | ◉ (red) |

### Schema resolution behavior

- `resolveSchema(name, projectRoot)` searches: project-local → built-in
- Default `spec-driven` schema: currently no built-in schema exists yet (BACK-474). Status command should handle missing default gracefully — fall back to listing change directory files as a heuristic, or show a clear error with `listSchemas()`
- BACK-474 will create the default `spec-driven` schema under `openspec/schemas/spec-driven/schema.yaml` in the project root

### Error handling

- Missing change directory → empty output (0/0 artifacts), hint to run `backlog change init`
- Missing schema → list available schemas via `listSchemas(projectRoot)`, suggest creating one
- Uninitialized project (no backlog) → clear error message
<!-- SECTION:DESCRIPTION:END -->
### Implementation
- File modified: `src/commands/openspec.ts` — added `change status` subcommand handler (~130 lines)
- File created: `src/test/openspec-change-status.test.ts` — 14 tests
- Test coverage: all status states (done/ready/blocked), diamond dep resolution, glob patterns, deeply blocked, missing change dir, JSON output shape, ChangeMetadataSchema validation
- Public API surface used from BACK-470: `resolveSchema`, `ArtifactGraph.fromSchema`, `detectCompleted`, `listSchemas`, `ChangeMetadataSchema`, `SchemaYaml` type
- Pre-existing Biome warnings in `graph.ts` (3 noNonNullAssertion) and `schema.ts` (1 noNonNullAssertion) not from this task
## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Command resolves schema from change metadata or defaults to spec-driven
- [x] #2 Response includes: changeName, schemaName, artifacts[] with {id, status, missingDeps?}
- [x] #3 --json outputs structured JSON to stdout
- [x] #4 Text output shows color-coded artifact states (✓ done, ○ ready, ◉ blocked)
- [x] #5 Progress summary: N/M artifacts complete
- [x] #6 Blocked artifacts show unmet dep names
- [x] #7 Handles missing change dirs, missing schema, uninitialized projects
- [x] #8 Integrates into Commander.js under backlog change subcommand
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched (pre-existing warnings only)
- [x] #3 bun test (or scoped test) passes
- [x] #4 bun test (scoped: 152 tests across 5 OpenSpec test files) passes
- [x] #5 bun run check . passes
