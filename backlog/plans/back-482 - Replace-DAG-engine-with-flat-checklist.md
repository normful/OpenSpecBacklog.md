id: back-482
title: Replace DAG engine with flat checklist
status: Draft
assignee: []
created_date: '2026-05-18'
priority: medium
## Source of truth
- `src/openspec/change-checklist.ts`
- `src/commands/openspec.ts`
- `src/openspec/archive.ts`
## Other docs to read first
- `backlog/tasks/back-481 - Fix-OpenSpec-sync-pipeline-and-DAG-documents-glob.md` — prior work, same area
- `openspec/schemas/spec-driven/schema.yaml` — the file being deleted; read to understand current artifact structure
- `src/openspec/artifact-graph/` (all 7 modules) — being deleted; read to understand what to port

Delete the generic DAG engine (ArtifactGraph class, schema YAML, resolver, topological sort). Replace with a single hardcoded data structure in code that defines the change checklist with explicit per-artifact deps. Eliminate conceptual overlap between delta specs, canonical spec Documents, and DAG artifacts.

## Motivation

The DAG engine (7 modules + schema YAML + 5 template files) was built for generic workflow graphs, but only ever has one consumer with a 4-node linear chain. This creates:

1. **Conceptual overlap** — the `specs` artifact glob-matches delta spec files in the change dir but its name and desc suggest canonical spec Documents
2. **Dead path references** — `schema.yaml` instructions ref `openspec/specs/` which doesn't exist post-BACK-480
3. **Unnecessary complexity** — Kahn's algorithm, schema validation, duplicate/cycle detection, resolver with project-local vs. pkg fallback, all for a hardcoded 4-entry list
4. **Schema YAML misalignment** — the `documents` artifact requires a project-root-relative glob hack (`isAbsoluteRelativePath`) because the schema lives in `openspec/schemas/` but needs to check files in `backlog/docs/`
5. **Dangling templates dir** — 5 template files (`proposal.md`, `design.md`, `spec.md`, `document.md`, `document.md`) plus `schema.yaml` serve only the DAG engine; the only string used at runtime is `SPEC_TEMPLATE` (already inlined in `templates.ts`)

## New file: `src/openspec/change-checklist.ts`

A single module defining the change workflow as a flat data structure + pure helper functions + file-checking utilities.

### Types and constant

```ts
export interface ChangeArtifact {
  id: string;
  /** Human-readable label for CLI output */
  label: string;
  /** Glob pattern — resolved against change dir unless projectRootRelative=true */
  generates: string;
  /** True if generates is project-root-relative (e.g. backlog/docs/**\/*.md) */
  projectRootRelative: boolean;
  /** Artifact IDs that must be completed first */
  dependsOn: string[];
}

/**
 * The change workflow checklist.
 * Dependencies are minimal — only real ordering constraints.
 * - proposal and deltas don't depend on each other (proposal is guidance, not a gate)
 * - design is independent of deltas (can design before or after writing deltas)
 * - publish depends on design because you can't doc before designing
 * - publish and deltas are independent of each other (docs vs. spec changes)
 */
export const CHANGE_ARTIFACTS: ChangeArtifact[] = [
  { id: "proposal", label: "Proposal", generates: "proposal.md", projectRootRelative: false, dependsOn: [] },
  { id: "deltas",   label: "Delta specs", generates: "specs/**/*.md", projectRootRelative: false, dependsOn: [] },
  { id: "design",   label: "Design doc", generates: "design.md", projectRootRelative: false, dependsOn: [] },
  { id: "publish",  label: "Published docs", generates: "backlog/docs/**/*.md", projectRootRelative: true, dependsOn: ["design"] },
];

export interface ArtifactStatus {
  id: string;
  label: string;
  status: "done" | "ready" | "blocked";
  missingDeps?: string[];
}
```

### Pure functions (no filesystem)

```ts
/**
 * Compute per-artifact status from a set of completed IDs.
 * Pure function — no I/O, no side effects.
 * - 'done': ID is in completed set
 * - 'ready': not done and all dependsOn IDs are in completed set
 * - 'blocked': not done and at least one dependsOn ID is missing
 */
export function computeArtifactStatus(
  completed: Set<string>,
  allArtifacts?: ChangeArtifact[],
): ArtifactStatus[];

/**
 * Returns true when every artifact's ID is in the completed set.
 */
export function isChangeComplete(
  completed: Set<string>,
  allArtifacts?: ChangeArtifact[],
): boolean;
```

### File-checking helpers (filesystem)

Ported from `outputs.ts` (being deleted). Minimal — only what's needed for `detectCompleted`.

```ts
/**
 * Checks if a path contains glob pattern characters (*, ?, [).
 */
export function isGlobPattern(pattern: string): boolean;

/**
 * Resolves an artifact's output path(s) to concrete files that currently exist.
 * When artifact.projectRootRelative=true, resolves generates against projectRoot
 * instead of changeDir.
 */
export function resolveArtifactOutputs(
  changeDir: string,
  artifact: ChangeArtifact,
  projectRoot?: string,
): string[];

/**
 * Scans the change dir (and optionally project root) for completed artifact files.
 * Returns the set of artifact IDs whose generates glob/file exists.
 */
export function detectCompleted(
  artifacts: ChangeArtifact[],
  changeDir: string,
  projectRoot?: string,
): Set<string>;
```

### Design notes

- `detectCompleted` is a public fn here rather than inlined in openspec.ts because both `archive.ts` and `openspec.ts` need it.
- `isAbsoluteRelativePath` is NOT extracted — it's replaced by `artifact.projectRootRelative: boolean` on the data structure itself. No need to string-prefix-check when the artifact declares its resolution base.
- `isGlobPattern` is kept as a small helper since it's used by `resolveArtifactOutputs`.

## Files to delete

| Path | Reason |
|------|--------|
| `src/openspec/artifact-graph/` (entire dir) | DAG engine — 7 modules, all unused after this change |
| `src/openspec/templates.ts` | 2 template strings — move inline into openspec.ts (SPEC_TEMPLATE already there) |
| `openspec/schemas/spec-driven/` (entire dir) | schema.yaml + 5 template files — schema was only consumed by DAG engine. 5 templates are inline instruction stubs that were never imported at runtime. `SPEC_TEMPLATE` constant in `templates.ts` is already the runtime-used spec template. |
| `src/test/openspec-artifact-graph.test.ts` | Tests the deleted DAG engine + outputs.ts helpers |

**Note on `document.md` template**: This file exists on disk but is NOT the `SPEC_TEMPLATE` string — it's a separate template file. No code imports it. The `spec create` command uses the `SPEC_TEMPLATE` import from `templates.ts` (which gets inlined into openspec.ts). Safe to delete.

## File rewrite: `src/commands/openspec.ts`

### Import changes

- **Remove**: `ArtifactGraph`, `detectCompleted` (from state.ts), `listSchemas`, `resolveSchema`, `SchemaYaml` — all from `../openspec/artifact-graph/index.ts`
- **Remove**: `PROPOSAL_TEMPLATE`, `SPEC_TEMPLATE` from `../openspec/templates.ts`
- **Add**: `CHANGE_ARTIFACTS`, `computeArtifactStatus`, `isChangeComplete`, `detectCompleted` from `../openspec/change-checklist.ts`
- **Add**: `PROPOSAL_TEMPLATE`, `SPEC_TEMPLATE`, `DESIGN_TEMPLATE` as inline `const` strings at module top (65 lines total)

### `backlog change status <name>` handler

**Before**:
1. `resolveSchema("spec-driven", projectRoot)` — filesystem lookup, can throw
2. `ArtifactGraph.fromSchema(schema)` — wraps 4-artifact array in class
3. `detectCompleted(graph, dir, projectRoot)` — needs graph object
4. `graph.getNextArtifacts(completed)` / `graph.getBlocked(completed)` — class methods
5. `graph.getAllArtifacts().map(...)` — compute status manually

**After**:
1. `detectCompleted(CHANGE_ARTIFACTS, dir, projectRoot)` — returns `Set<string>`
2. `computeArtifactStatus(completed)` — returns `ArtifactStatus[]`
3. `isChangeComplete(completed)` — returns boolean

No schema resolution, no error path for missing schema. The constant always exists.

Color-coded output preserved identically:
- `green("✓")` + `(done)`
- `blue("○")` + `(ready)`
- `red("◉")` + `(blocked — needs: ...)`

Next-action hint logic unchanged.

### Other handlers unchanged

- `backlog change archive <name>`: unchanged signature, passes through to archive.ts (which now uses new imports)
- `backlog spec create/validate/list`: unchanged
- `backlog change create/sync/delta add/list/remove`: unchanged
- `PROPOSAL_TEMPLATE`, `SPEC_TEMPLATE`, `DESIGN_TEMPLATE` inlined from deleted `templates.ts` (DESIGN_TEMPLATE is new — was in `templates.ts` but never imported; include for completeness)

## File rewrite: `src/openspec/archive.ts`

### Import changes

- **Remove**: `ArtifactGraph`, `detectCompleted` (from state.ts), `resolveSchema` — all from `../openspec/artifact-graph/index.ts`
- **Add**: `CHANGE_ARTIFACTS`, `computeArtifactStatus`, `isChangeComplete`, `detectCompleted` from `../openspec/change-checklist.ts`

### `archiveChange()` rewrite

1. **No schema resolution** — read `CHANGE_ARTIFACTS` directly (constant always exists, no catch block for schema errors)
2. **detectCompleted**: `detectCompleted(CHANGE_ARTIFACTS, changePath, projectRoot)`
3. **completeness check**: `isChangeComplete(completed)` instead of `graph.isComplete(completed)`
4. **blockers**: use `computeArtifactStatus(completed)` and filter for blocked — instead of `graph.getBlocked()` + `formatBlockers()` helper
5. **done/total counts**: use `computeArtifactStatus()` result or `completed.size` / `CHANGE_ARTIFACTS.length`
6. **Error path removed**: the old `try/catch` around `resolveSchema` is gone — the schema constant always exists. The "change not found" check remains.
7. Everything else (unsynced delta check, directory move, ArchiveResult type, ArchiveOptions) — unchanged.

### ArchiveResult changes

- `totalArtifacts` now derived from `CHANGE_ARTIFACTS.length` instead of `allArtifacts.length` (same value)
- `reason` strings updated to remove schema-related messaging

## Test: new file `src/test/openspec-change-checklist.test.ts`

All DAG-removal-related tests go here. The existing `openspec-change-status.test.ts` is deleted entirely.

### Pure function tests (computeArtifactStatus, isChangeComplete)

No filesystem needed. Construct completed sets directly.

- **all done**: `completed = new Set(["proposal", "deltas", "design", "publish"])` → all 4 artifacts status=done
- **nothing done**: empty completed set → proposal, deltas, design=ready; publish=blocked(missingDeps:["design"])
- **root only**: completed={"proposal"} → proposal=done, deltas=ready, design=ready, publish=blocked(["design"])
- **middle done**: completed={"proposal","deltas","design"} → proposal/deltas/design=done, publish=ready
- **all done → isChangeComplete**: `isChangeComplete(allDoneSet)` → true
- **partial → isChangeComplete**: `isChangeComplete(new Set(["proposal"]))` → false
- **blocked shows correct missingDeps**: publish with empty completed → publish.blocked with missingDeps=["design"]
- **parallel artifacts (deltas, design) both ready**: completed={"proposal"} → deltas and design both status=ready (no interdep between them)

### File-existence detection tests (detectCompleted)

Use tmpdir filesystem (same pattern as current tests).

- **proposal complete when proposal.md exists**: write proposal.md in changeDir → detectCompleted returns Set with "proposal"
- **deltas complete with glob**: mkdir specs/ + write specs/auth.md, specs/api.md → detectCompleted returns Set with "deltas"
- **publish complete with projectRoot-relative glob**: mkdir backlog/docs/ + write guide.md under projectRoot → detectCompleted(..., projectRoot) includes "publish"
- **publish NOT complete without projectRoot**: same setup but no projectRoot arg → "publish" not in result
- **missing change dir returns empty set**: pass nonexistent path → empty Set
- **no matching glob files returns empty**: changeDir exists but no files match → empty Set (except artifacts with no file pattern — edge case: all 4 artifacts have generates patterns so this works)

## Test file to delete: `src/test/openspec-artifact-graph.test.ts`

All 477 lines — tests DAG-specific classes (SchemaYamlSchema validation, parseSchema, ArtifactGraph, isGlobPattern, isAbsoluteRelativePath, detectCompleted via state.ts). The detectCompleted tests are ported to `openspec-change-checklist.test.ts`.

## Test file to rewrite: `src/test/openspec-archive.test.ts`

### Changes

- **Remove**: `ensureSchemaAvailable()` calls and schema YAML creation in `beforeEach`
- **Remove**: the "reports missing schema" test case (no longer possible — schema is hardcoded constant)
- **Keep**: all other test cases unchanged
- **Update**: `archiveChange` call expectations — `totalArtifacts` is now always 4 (CHANGE_ARTIFACTS.length) instead of matching the test's ad-hoc schema artifact count
- **Unchanged**: archive when all done, reject when incomplete, --force bypass, unsynced deltas, --no-sync-check, directory move, dir naming, error for missing change, partially-done reporting

### Changed test expectations

- **`blocks archive when artifacts incomplete` test**: previously used custom schema with 3 artifacts (proposal, design, review). Now will use the hardcoded 4-artifact list. The test creates only `proposal.md` and `design.md` → `detectCompleted` finds proposal+design done → `isChangeComplete` returns false (missing deltas, publish). 2/4 done. Adjust assertions.
- **`allows archive when all artifacts complete` test**: was default 2-artifact (proposal, design). Now need 4 files: `proposal.md`, `specs/.keep` (or any file under specs/), `design.md`, `backlog/docs/.keep` (or any .md file). Use changed file map to create all 4.
- **Test data counts change from 2→4 artifacts**: update `totalArtifacts` expectations from 2→4.

## Unchanged files

| File | Why unchanged |
|------|---------------|
| `src/openspec/sync.ts` | Sync pipeline uses Core API, not DAG |
| `src/openspec/parsers/` | Parsers for delta specs and markdown — independent of DAG |
| `src/openspec/schemas/` (Zod schemas in `src/openspec/schemas/`) | Zod schemas (SpecSchema, ChangeSchema, RequirementSchema) — used by CLI validation. NOT the same as `openspec/schemas/` (config dir deleted above) |
| `src/openspec/serializers.ts` | buildDeltaSpecWithEntry, removeDeltaByIndex — used by delta add/remove |
| `src/test/openspec-sync.test.ts` | Sync tests are independent of DAG |
| `src/test/openspec-parsers.test.ts` | Parser tests are independent of DAG |
| `src/test/openspec-schemas.test.ts` | Schema tests are independent of DAG |
| `src/test/openspec-serializer.test.ts` | Serializer tests are independent of DAG |
| All `src/web/`, `src/server/`, `src/mcp/` | OpenSpec is CLI-only, not exposed via MCP/Web/Server |

**Clarification on `src/openspec/schemas/` vs `openspec/schemas/`**:
- `src/openspec/schemas/` (2 files: `spec.schema.ts`, `change.schema.ts`) contains Zod validation schemas used by CLI commands — **KEEP**
- `openspec/schemas/` (the config dir at project root) contains `schema.yaml` + template files used only by the DAG engine — **DELETE**

## Verification steps

1. `bun run check .` — lint + format pass
2. `bunx tsc --noEmit` — type check pass
3. `bun test` — all tests pass
4. Manual: `backlog change status <name>` — correct done/ready/blocked output
5. Manual: `backlog change archive <name>` — accepts only when all artifacts done, --force bypasses
6. Manual: `backlog spec create/validate/list` — unchanged
7. Manual: `backlog change sync <name>` — unchanged
8. Manual: `backlog change delta add/list/remove` — unchanged

### Implementation order

1. Create `src/openspec/change-checklist.ts` — the core replacement module
2. Create `src/test/openspec-change-checklist.test.ts` — tests for the new module
3. Rewrite `src/commands/openspec.ts` — remove DAG imports, use change-checklist, inline templates
4. Rewrite `src/openspec/archive.ts` — remove DAG imports, use change-checklist
5. Update `src/test/openspec-archive.test.ts` — remove schema setup, update expectations
6. Delete `src/test/openspec-change-status.test.ts` — all tests ported to new file
7. Delete `src/openspec/artifact-graph/` — entire directory (7 files)
8. Delete `src/openspec/templates.ts` — strings now inline in openspec.ts
9. Delete `openspec/schemas/spec-driven/` — schema.yaml + 5 template files

**After each file deletion, verify with `bunx tsc --noEmit` and `bun run check .`** to catch remaining references early.
