---
id: back-482
title: Replace DAG engine with flat checklist
status: Draft
assignee: []
created_date: '2026-05-18'
priority: medium
---

## Status

Draft

## Source of truth

- `src/openspec/change-checklist.ts`
- `src/commands/openspec.ts`
- `src/openspec/archive.ts`

## Other docs to read first

- `backlog/tasks/back-481 - Fix-OpenSpec-sync-pipeline-and-DAG-documents-glob.md` — prior work, same area
- `openspec/schemas/spec-driven/schema.yaml` — the file being deleted

## Goal

Delete the generic DAG engine (ArtifactGraph class, schema YAML, resolver, topological sort). Replace with a single hardcoded data structure in code that defines the change checklist with explicit per-artifact dependencies. Eliminate conceptual overlap between delta specs, canonical spec Documents, and DAG artifacts.

## Motivation

The DAG engine (7 modules + schema YAML + 4 template files) was built for generic workflow graphs, but only ever has one consumer with a 4-node linear chain. This creates:

1. **Conceptual overlap** — the `specs` artifact glob-matches delta spec files in the change dir but its name and description suggest canonical spec Documents
2. **Dead path references** — `schema.yaml` instructions reference `openspec/specs/` which doesn't exist post-BACK-480
3. **Unnecessary complexity** — Kahn's algorithm, schema validation, duplicate/cycle detection, resolver with project-local vs. package fallback, all for a hardcoded 4-entry list
4. **Schema YAML misalignment** — the `documents` artifact requires a project-root-relative glob hack (isAbsoluteRelativePath) because the schema lives in `openspec/schemas/` but needs to check files in `backlog/docs/`

## Design

### New file: `src/openspec/change-checklist.ts`

A single module defining the change workflow as a flat data structure + pure helper functions.

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
 * deltas and design don't depend on proposal because users
 * can work on them in parallel (proposal is guidance, not a gate).
 * publish depends on design because you can't document before designing.
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
  missingDeps: string[];
}

export function computeArtifactStatus(completed: Set<string>, allArtifacts?: ChangeArtifact[]): ArtifactStatus[];
export function isChangeComplete(completed: Set<string>, allArtifacts?: ChangeArtifact[]): boolean;
```

### File deletion

| Path | Reason |
|------|--------|
| `src/openspec/artifact-graph/` (entire directory) | DAG engine — 7 modules, all unused after this change |
| `src/openspec/templates.ts` | Two template strings — move inline into openspec.ts |
| `openspec/schemas/` (entire directory) | schema.yaml + 4 template files — schema was only read by DAG engine |
| `src/test/openspec-artifact-graph.test.ts` | Tests the deleted DAG engine |

### File rewrite: `src/openspec/archive.ts`

- Remove `ArtifactGraph`, `detectCompleted` (from state.ts), `resolveSchema` imports
- Replace with `CHANGE_ARTIFACTS`, `computeArtifactStatus`, `isChangeComplete` imports
- `archiveChange()` now:
  1. Reads `CHANGE_ARTIFACTS` directly (no schema resolution)
  2. Calls `detectCompleted()` (inline helper or from change-checklist.ts) to detect which artifact files exist
  3. Calls `computeArtifactStatus()` to compute done/ready/blocked
  4. Calls `isChangeComplete()` to check all done
  5. Falls back to `--force` bypass

### File rewrite: `src/commands/openspec.ts`

- Remove `ArtifactGraph`, `detectCompleted` (from state.ts), `listSchemas`, `resolveSchema`, `SchemaYaml` imports
- Add `CHANGE_ARTIFACTS`, `computeArtifactStatus`, `isChangeComplete` imports
- Add inline `detectCompleted()` helper that checks file/glob existence for each artifact
- `backlog change status <name>`:
  - Before: resolveSchema → ArtifactGraph.fromSchema → detectCompleted → getNextArtifacts → getBlocked
  - After: detectCompleted(CHANGE_ARTIFACTS, dir, projectRoot) → computeArtifactStatus → format output
  - Color-coded output preserved identically (green ✓, blue ○, red ◉)
- `backlog change archive <name>`: unchanged signature, passes through to archive.ts
- `backlog spec create/validate/list`: unchanged
- `backlog change create/sync/delta add/list/remove`: unchanged
- `PROPOSAL_TEMPLATE` and `SPEC_TEMPLATE` strings moved inline (were in templates.ts, which is deleted)

### Test rewrite: `src/test/openspec-change-status.test.ts`

- Delete all tests that used `ArtifactGraph` + `makeGraph` + `makeSchemaObject`
- New tests (pure function, no filesystem needed for computeArtifactStatus):
  - all artifacts done when all in completed set
  - root artifacts ready when nothing completed
  - design ready when proposal completed
  - publish blocked when design not done
  - publish ready when design completed
  - isChangeComplete returns true only when all artifacts done
- File-existence detection tests still use tmpdir:
  - glob patterns detect completion (deltas artifact)
  - project-root-relative glob detects completion (publish artifact)
  - missing change dir returns empty

### Test update: `src/test/openspec-archive.test.ts`

- Remove `ensureSchemaAvailable()` calls — archive no longer needs schema YAML on disk
- Remove schema YAML creation from test env setup
- Keep all existing test cases (archive behavior is same, just backend changes)
- Key tests to preserve: archive when all done, reject when incomplete, --force bypass, unsynced deltas, archive dir naming

### Unchanged files

| File | Why unchanged |
|------|---------------|
| `src/openspec/sync.ts` | Sync pipeline uses Core API, not DAG |
| `src/openspec/parsers/` | Parsers for delta specs and markdown — independent of DAG |
| `src/openspec/schemas/` (schemas/) | Zod schemas (SpecSchema, ChangeSchema, RequirementSchema) — used by CLI validation |
| `src/openspec/serializers.ts` | buildDeltaSpecWithEntry, removeDeltaByIndex — used by delta add/remove |
| `src/test/openspec-sync.test.ts` | Sync tests are independent of DAG |
| `src/test/openspec-parsers.test.ts` | Parser tests are independent of DAG |
| `src/test/openspec-schemas.test.ts` | Schema test are independent of DAG |
| `src/test/openspec-serializer.test.ts` | Serializer tests are independent of DAG |
| All src/web/, src/server/, src/mcp/ | OpenSpec is CLI-only, not exposed via MCP/Web/Server |

## Verification steps

1. `bun run check .` — lint + format pass
2. `bunx tsc --noEmit` — type check pass
3. `bun test` — all tests pass
4. Manual: `backlog change status <name>` — correct done/ready/blocked output
5. Manual: `backlog change archive <name>` — accepts only when all artifacts done, --force bypasses
6. Manual: `backlog spec create/validate/list` — unchanged
7. Manual: `backlog change sync <name>` — unchanged
8. Manual: `backlog change delta add/list/remove` — unchanged
