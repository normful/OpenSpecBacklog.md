---
status: draft
source-of-truth: src/constants/index.ts, src/file-system/operations.ts, src/core/init.ts, src/commands/openspec.ts, src/openspec/change-checklist.ts
other-docs:
  - src/types/index.ts (Document type)
  - src/openspec/archive.ts
  - src/openspec/sync.ts
---

# Backlog Directory Structure

## What `backlog init` creates

When `bun run backlog init` runs, `ensureBacklogStructure()` (`src/file-system/operations.ts:199`) creates these directories under `backlog/` (or `.backlog/`, configurable):

```ts
// src/constants/index.ts
const DEFAULT_DIRECTORIES = {
  BACKLOG: "backlog",
  HIDDEN_BACKLOG: ".backlog",
  TASKS: "tasks",
  DRAFTS: "drafts",
  COMPLETED: "completed",
  ARCHIVE_TASKS: "archive/tasks",
  ARCHIVE_DRAFTS: "archive/drafts",
  ARCHIVE_MILESTONES: "archive/milestones",
  DOCS: "docs",
  DECISIONS: "decisions",
  MILESTONES: "milestones",
};
```

Resulting tree:

```
<project-root>/
├── backlog/                          # DEFAULT_DIRECTORIES.BACKLOG
│   ├── config.yml                    # DEFAULT_FILES.CONFIG (project config)
│   ├── tasks/                        # DEFAULT_DIRECTORIES.TASKS
│   │   ├── task-1 - Title.md
│   │   └── task-2 - Another.md
│   ├── drafts/                       # DEFAULT_DIRECTORIES.DRAFTS
│   │   └── draft-1 - WIP.md
│   ├── completed/                    # DEFAULT_DIRECTORIES.COMPLETED
│   │   └── task-3 - Done.md
│   ├── archive/
│   │   ├── tasks/                    # DEFAULT_DIRECTORIES.ARCHIVE_TASKS
│   │   ├── drafts/                   # DEFAULT_DIRECTORIES.ARCHIVE_DRAFTS
│   │   └── milestones/              # DEFAULT_DIRECTORIES.ARCHIVE_MILESTONES
│   ├── docs/                         # DEFAULT_DIRECTORIES.DOCS
│   │   ├── doc-1 - Auth-Spec.md
│   │   └── guides/
│   │       └── doc-2 - Setup.md
│   ├── decisions/                    # DEFAULT_DIRECTORIES.DECISIONS
│   │   └── decision-1 - Tech-Stack.md
│   ├── milestones/                   # DEFAULT_DIRECTORIES.MILESTONES
│   │   └── m-0 - v1.md
│   └── changes/                      # CREATED BY `openspec change create`
│       ├── add-auth/
│       │   ├── proposal.md
│       │   ├── design.md
│       │   └── specs/
│       │       └── user-auth/
│       │           └── spec.md
│       └── archive/                  # CREATED BY `openspec change archive`
│           └── 2026-05-16-add-auth/
```

## What each directory stores and how

### `backlog/tasks/`

- **Written by**: `FileSystem.saveTask()` (`src/file-system/operations.ts:228`)
- **Read by**: `FileSystem.listTasks()`, Core task commands, cross-branch task loader, CLI list/board
- **Naming**: `<prefix>-<id> - Title.md` (prefix defaults to `task`, configurable via `task_prefix` in config.yml)
- **Format**: Parsed with `parseTask()` from `src/markdown/parser.ts`
- **Lifecycle**: Tasks can be completed (moved to `completed/` via `renameSync`), archived (moved to `archive/tasks/`), or demoted (copied to `drafts/` with new ID)

### `backlog/drafts/`

- **Written by**: `FileSystem.saveDraft()`, `demoteTask()`
- **Read by**: `FileSystem.listDrafts()`, promotion logic
- **Naming**: `draft-<id> - Title.md` (prefix hardcoded to `draft`, not configurable)
- **Lifecycle**: Drafts can be promoted to tasks (new ID generated), archived (copy to `archive/drafts/`)

### `backlog/completed/`

- **Written by**: `FileSystem.completeTask()` via `renameSync` from `tasks/`
- **Read by**: `FileSystem.listCompletedTasks()`
- **Naming**: Same as task files, just moved

### `backlog/archive/tasks/`

- **Written by**: `FileSystem.archiveTask()` via `renameSync` from `tasks/`
- **Read by**: `FileSystem.listArchivedTasks()`

### `backlog/archive/drafts/`

- **Written by**: `FileSystem.archiveDraft()` via copy + `unlink` from `drafts/`

### `backlog/archive/milestones/`

- **Written by**: `FileSystem.archiveMilestone()` via `renameSync` from `milestones/`
- **Read by**: `FileSystem.listArchivedMilestones()`

### `backlog/docs/`

- **Written by**: `FileSystem.saveDocument()` (`src/file-system/operations.ts:848`), `Core.createDocumentFromInput()` (`src/core/backlog.ts`)
- **Read by**: `FileSystem.listDocuments()`, MCP tools, CLI `spec list`, Web UI
- **Naming**: `doc-<id> - Title.md` (supports subfolders via `subPath` parameter in `saveDocument()`)
- **Glob**: `listDocuments()` uses `**/*.md` recursively, excluding `README.md` variants
- **Supported types**: `specification`, `other` (and any `DocumentType` in the union)
- **Lifecycle**: Documents can be created, updated (renamed + file moved), and listed. No archive/completed flow for docs.

### `backlog/decisions/`

- **Written by**: `FileSystem.saveDecision()` (`src/file-system/operations.ts:888`)
- **Read by**: `FileSystem.listDecisions()`, CLI decision commands
- **Naming**: `decision-<id> - Title.md` (ID normalized to strip `decision-` prefix)

### `backlog/milestones/`

- **Written by**: `FileSystem.createMilestone()` (`src/file-system/operations.ts:1203`)
- **Read by**: `FileSystem.listMilestones()`, board view, milestone commands
- **Naming**: `m-<id> - title.md` (IDs auto-incrementing, title slugified to ~50 chars)
- **Format**: YAML frontmatter (`id`, `title`) + `## Description` body
- **Lifecycle**: Can be renamed (file rename + title rewrite), archived (moved to `archive/milestones/`)

### `backlog/changes/` (OpenSpec-specific)

- **Created by**: `openspec change create` command (`src/commands/openspec.ts:283`)
- **Not part of `ensureBacklogStructure()`** — created lazily on first `change create`
- **Structure**: Each change gets a subdirectory `<name>/` with:
  - `proposal.md` — flat file (alongside a Document of type `other` in `backlog/docs/`)
  - `design.md` — flat file (created by user, detected by checklist)
  - `specs/<spec-name>/spec.md` — delta spec files
- **Archived by**: `openspec change archive` → moves `backlog/changes/<name>/` to `backlog/changes/archive/<date>-<name>/` via `renameSync()` (`src/openspec/archive.ts:148`)

## What the 4-artifact flat checklist cares about

Defined in `src/openspec/change-checklist.ts` — the `CHANGE_ARTIFACTS` constant:

```ts
// src/openspec/change-checklist.ts:48-71
const CHANGE_ARTIFACTS = [
  { id: "proposal", label: "Proposal",       generates: "proposal.md",                projectRootRelative: false },
  { id: "deltas",   label: "Delta specs",    generates: "specs/**/*.md",             projectRootRelative: false },
  { id: "design",   label: "Design doc",     generates: "design.md",                 projectRootRelative: false },
  { id: "publish",  label: "Published docs", generates: "backlog/docs/**/*.md",      projectRootRelative: true },
];
```

`detectCompleted()` (`src/openspec/change-checklist.ts:157`) resolves each artifact's `generates` glob against either `backlog/changes/<name>/` (for `projectRootRelative: false`) or the project root (for `publish` artifact). If any file exists at the resolved path, the artifact is marked `done`.

### What the checklist **checks**

1. `backlog/changes/<name>/proposal.md` — checks file existence in change dir
2. `backlog/changes/<name>/specs/**/*.md` — checks for any delta spec files
3. `backlog/changes/<name>/design.md` — checks file existence in change dir
4. `backlog/docs/**/*.md` — checks for any published doc file in the project root

### What the checklist **does NOT check**

- **Document type** (`specification` vs `other` vs anything else) — the `publish` glob just checks *any* `.md` file exists in `backlog/docs/`
- **Document status** (draft/review/published) — all doc statuses match equally
- **Decision logs** (`backlog/decisions/`) — never read by the checklist
- **Milestones** (`backlog/milestones/`) — never read
- **Tasks/drafts/completed tasks** (`backlog/tasks/`, `drafts/`, `completed/`) — unrelated
- **Delta spec validity** — `detectCompleted()` only checks file existence, not whether `spec.md` files contain valid delta operations

## Wire References

| Concern | Location |
|---|---|
| Default directory constants | `src/constants/index.ts:4-26` |
| Directory creation on init | `src/file-system/operations.ts:199-215` |
| Directory path getters | `src/file-system/operations.ts` `tasksDir`, `docsDir`, `decisionsDir`, etc. |
| Document CRUD | `src/file-system/operations.ts:848-947` |
| Change checklist | `src/openspec/change-checklist.ts:48-71` (artifacts), `:157-172` (detectCompleted) |
| Change command registration | `src/commands/openspec.ts:248-601` |
| Archive command | `src/openspec/archive.ts:79-169` |
| Sync pipeline | `src/openspec/sync.ts:1-365` (reads from `backlog/changes/<name>/specs/`, writes to `backlog/docs/`) |
| `listDocuments()` glob | `src/file-system/operations.ts:915-917` (`**/*.md` recursive, ex. README) |
| `saveDocument()` naming | `src/file-system/operations.ts:849-852` (`doc-<id> - Title.md`, subfolder support) |
