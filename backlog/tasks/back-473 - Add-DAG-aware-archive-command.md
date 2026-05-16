id: BACK-473
title: Add DAG-aware archive cmd
status: Done
created_date: '2026-05-15 21:03'
labels: []
  - BACK-471
  - BACK-472
priority: medium
ordinal: 31000
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Extend backlog change archive <name> to check the ArtifactGraph: only allow archiving if all artifacts are done (isComplete returns true). If blockers exist, show which artifacts are still blocked/ready and refuse to archive. Add --force flag to override. On successful archive: move change from backlog/changes/<name> to backlog/changes/archive/<date>-<name>/. If any syncing is needed, prompt to run backlog change sync first (unless --no-sync-check).
<!-- SECTION:DESCRIPTION:END -->
### Implementation
- File created: `src/openspec/archive.ts` — pure archive pipeline module (~180 lines):
  - `archiveChange(changeName, projectRoot, options)` — main entry point, checks completeness → unsynced deltas → move
  - `hasUnsyncedDeltas(changeDir)` — checks for delta spec subdirectories
  - `archiveDirName(name)` — generates `<YYYY-MM-DD>-<name>` prefix
  - `formatBlockers(blockedMap)` — formats blocker descriptions from BlockedArtifacts map
  - Logic order: (1) resolve spec-driven schema (2) check isComplete (3) check unsynced deltas (4) renameSync
- File modified: `src/commands/openspec.ts` — registers `backlog change archive <name>` subcommand with `--force` and `--no-sync-check` options
- File created: `src/test/openspec-archive.test.ts` — 23 tests covering all ACs (completeness check, --force, unsynced deltas, directory move, error handling)
### Deviations from Plan
- `force` only bypasses completeness check, not unsynced delta check (user must also use `--no-sync-check` or run sync first)
- Test helper `createChangeDir` changed to only create files that are explicitly passed (no implicit defaults), to support testing incomplete artifact scenarios
- Schema in completeness-blocked tests uses 3-artifact chain (proposal → design → review) so review is truly "blocked" (needs design) not just "ready" when only design is missing
## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Archive blocked if artifacts incomplete (shows blocker list)
- [x] #2 --force bypasses completeness check
- [x] #3 Moves change dir to archives with date prefix
- [x] #4 Prompts to sync if unsynced deltas detected (unless --no-sync-check)
- [x] #5 Reports which artifacts were done at time of archive
- [x] #6 Mirrors OpenSpec's /opsx:archive workflow behavior
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
- [x] #4 bun test passes