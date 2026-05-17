id: BACK-481
title: Fix OpenSpec sync pipeline to write Documents and fix DAG documents artifact glob
status: To Do
assignee: []
created_date: '2026-05-17'
labels:
  - bug
  - enhancement
dependencies:
  - BACK-480
priority: medium
ordinal: 39000

## Description

Two bugs discovered during post-BACK-480 audit.

### Bug 1: `change sync` writes to old `backlog/specs/` path

`src/openspec/sync.ts` (lines 252, 322) constructs `backlog/specs/<spec>/spec.md` paths directly. After BACK-480, specs live as Documents (type: specification) in `backlog/docs/`. After `change sync`, the applied deltas never reach the Document — they write to a stale directory.

**Fix**: Make `syncSpecs` accept a Core instance, find the spec Document by title, and call `core.updateDocumentFromInput()` with the updated rawContent.

### Bug 2: `documents` artifact `generates` glob resolves relative to change dir

`openspec/schemas/spec-driven/schema.yaml` has:
```yaml
- id: documents
  generates: "backlog/docs/**/*.md"
```

`detectCompleted` in `state.ts` passes the change directory as `cwd` to `outputs.ts`, so the glob resolves against `backlog/changes/<name>/backlog/docs/**/*.md` — which never exists. The `documents` artifact is **always shown as blocked** regardless of actual document creation.

**Fix**: Add `projectRoot` parameter to `detectCompleted` and `artifactOutputExists`. For absolute-like paths (starting with `backlog/`), resolve relative to project root instead of change dir.

## Relevant Files

- `src/openspec/sync.ts` — syncSpecs writes to `backlog/specs/<spec>/spec.md`
- `src/openspec/artifact-graph/outputs.ts` — `resolveArtifactOutputs` uses changeDir as cwd for all paths
- `src/openspec/artifact-graph/state.ts` — `detectCompleted` receives only changeDir
- `src/openspec/artifact-graph/index.ts` — re-exports `detectCompleted`
- `openspec/schemas/spec-driven/schema.yaml` — `documents` artifact `generates: "backlog/docs/**/*.md"`
- `src/commands/openspec.ts` — calls `detectCompleted(graph, dir)` and `syncSpecs(name, projectRoot, options)`
- `src/openspec/archive.ts` — calls `detectCompleted` for archive completeness check
- `src/test/openspec-sync.test.ts` — tests call `syncSpecs(name, root, options)` with old signature
- `src/test/openspec-artifact-graph.test.ts` — tests for `detectCompleted`
- `src/test/openspec-change-status.test.ts` — tests for DAG state with `detectCompleted`

## Proposed Fix: Bug 1 — syncSpecs writes to Documents

### API change

```diff
- export async function syncSpecs(changeName: string, projectRoot: string, options: SyncOptions): Promise<string>
+ export async function syncSpecs(changeName: string, core: Core, options: SyncOptions): Promise<string>
```

### Implementation

1. Remove all `join(projectRoot, "backlog", "specs", ...)` path construction in `syncSpecs`.
2. Instead of reading/writing `backlog/specs/<spec>/spec.md`:
   - Read existing content via `core.filesystem.listDocuments()` → find doc with matching title + type "specification" → get `rawContent`
   - Write updated content via `core.updateDocumentFromInput({ id: doc.id, content: updatedContent })`
3. For backup: store backup content in-memory (no `.bak` file), or write to a `backlog/changes/<name>/backups/` dir.
   - **Decision**: write backup to `backlog/changes/<name>/backups/<spec>.md.bak` to keep it alongside the change

### Caller updates

| File | Change |
|---|---|
| `src/commands/openspec.ts` handler | Pass `core` instance instead of `projectRoot` to `syncSpecs` |
| `src/test/openspec-sync.test.ts` | Create `Core` in test env instead of raw directories; pass to `syncSpecs` |

### Test implications

Tests currently create raw directory structures (`backlog/specs/`, `backlog/changes/`) and read/write files directly. After fix, they need a real `Core` with `FileSystem` initialized. Options:

- **A**: Create `Core` pointing at the temp directory + call `core.filesystem.ensureBacklogStructure()` + use `core.createDocumentFromInput` to create spec docs in the proper path
- **B**: Create `Core` + write documents directly via `core.filesystem` helpers

Option A is cleaner — tests use the same API as production.

## Proposed Fix: Bug 2 — documents artifact glob

### Design (per your choice: Option B)

Parse `generates` strings that start with known prefixes (`backlog/`) as project-root-relative paths. The private helper `isProjectRootRelativePath()` checks if a generates path starts with `backlog/`. If true, `resolveArtifactOutputs` resolves relative to projectRoot (passed through `detectCompleted`) instead of changeDir.

### API changes to `detectCompleted`

Keep backward compatibility — `projectRoot` is optional. When `generates` is a project-root-relative path and `projectRoot` is provided, resolve against `projectRoot`. Otherwise, fall back to current behavior (changeDir-relative).

```diff
- export function detectCompleted(graph: ArtifactGraph, changeDir: string): CompletedSet
+ export function detectCompleted(graph: ArtifactGraph, changeDir: string, projectRoot?: string): CompletedSet
```

Similarly for `artifactOutputExists` and `resolveArtifactOutputs`.

### Caller updates

| Caller | Current | After |
|---|---|---|
| `src/commands/openspec.ts` status handler | `detectCompleted(graph, dir)` | `detectCompleted(graph, dir, projectRoot)` — `projectRoot` is already available from `requireProjectRoot()` |
| `src/openspec/archive.ts` | `detectCompleted(graph, changePath)` | `detectCompleted(graph, changePath, projectRoot)` — add projectRoot param to `archiveChange` (it already receives it) |

### How the parser works

```typescript
function isProjectRootRelativePath(generates: string): boolean {
  return generates.startsWith("backlog/") || generates.startsWith("openspec/");
}

// In resolveArtifactOutputs:
if (isProjectRootRelativePath(generates) && projectRoot) {
  const fullPath = path.join(projectRoot, generates);
  // check file existence against this absolute path
}
```

## Definition of Done

- [ ] #1 `syncSpecs` accepts Core, writes to spec Document via `core.updateDocumentFromInput`
- [ ] #2 Backup files written to `backlog/changes/<name>/backups/` when syncing existing specs
- [ ] #3 `detectCompleted(graph, changeDir, projectRoot?)` supports project-root-relative generates paths
- [ ] #4 `resolveArtifactOutputs` and `artifactOutputExists` accept optional `projectRoot`
- [ ] #5 `change status` correctly shows `documents` artifact as done when `backlog/docs/**/*.md` files exist
- [ ] #6 `archiveChange` correctly checks `documents` artifact completeness
- [ ] #7 Tests updated: sync tests use Core API; DAG tests exercise project-root-relative globs
- [ ] #8 bunx tsc --noEmit passes
- [ ] #9 bun run check . passes
- [ ] #10 bun test passes
