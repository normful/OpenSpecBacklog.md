---
id: BACK-473
title: Add DAG-aware archive command
status: To Do
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-471
  - BACK-472
priority: medium
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend backlog change archive <name> to check the ArtifactGraph: only allow archiving if all artifacts are done (isComplete returns true). If blockers exist, show which artifacts are still blocked/ready and refuse to archive. Add --force flag to override. On successful archive: move change from backlog/changes/<name> to backlog/changes/archive/<date>-<name>/. If any syncing is needed, prompt to run backlog change sync first (unless --no-sync-check).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Archive blocked if artifacts incomplete (shows blocker list)
- [ ] #2 --force bypasses completeness check
- [ ] #3 Moves change dir to archives with date prefix
- [ ] #4 Prompts to sync if unsynced deltas detected (unless --no-sync-check)
- [ ] #5 Reports which artifacts were done at time of archive
- [ ] #6 Mirrors OpenSpec's /opsx:archive workflow behavior
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
<!-- DOD:END -->
