---
id: BACK-471
title: Add 'backlog change status' command with DAG state output
status: To Do
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
Add CLI command: backlog change status <name> [--json]. Computes artifact DAG state for a change: loads schema YAML from change's .openspec.yaml metadata (default: spec-driven), builds ArtifactGraph, runs detectCompleted on the change directory, then outputs per-artifact status (done/ready/blocked) with missing dependency info. Supports --json for agent consumption (same format as OpenSpec's openspec status --json). Text output shows progress bar (done/total), artifact list with status indicators, and next action hint.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Command resolves schema from change metadata or defaults to spec-driven
- [ ] #2 Response includes: changeName, schemaName, artifacts[] with {id, status, missingDeps?}
- [ ] #3 --json outputs structured JSON to stdout
- [ ] #4 Text output shows color-coded artifact states (✓ done, ○ ready, ◉ blocked)
- [ ] #5 Progress summary: N/M artifacts complete
- [ ] #6 Blocked artifacts show unmet dependency names
- [ ] #7 Handles missing change dirs, missing schema, uninitialized projects
- [ ] #8 Integrates into Commander.js under backlog change subcommand
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
- [ ] #5 bun run check . passes
<!-- DOD:END -->
