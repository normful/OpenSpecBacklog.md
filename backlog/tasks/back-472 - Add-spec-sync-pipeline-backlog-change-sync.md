---
id: BACK-472
title: 'Add spec sync pipeline: backlog change sync'
status: Done
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-467
  - BACK-470
priority: high
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the sync command: backlog change sync <name>. Reads delta specs from backlog/changes/<name>/specs/<spec>/spec.md, then applies each delta to the corresponding main spec at backlog/specs/<spec>/spec.md. Delta application: ADDED → appends requirement to ## Requirements section. MODIFIED → finds and replaces requirement by header name in ## Requirements. REMOVED → deletes requirement block by header name from ## Requirements. RENAMED → changes ### Requirement: Old to ### Requirement: New. Creates main spec file if it doesn't exist. Validates the result against SpecSchema after sync. Backs up main spec before modifying.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ADDED delta appends requirement with scenarios to ## Requirements
- [x] #2 MODIFIED delta finds requirement by header name (case-insensitive) and replaces
- [x] #3 REMOVED delta deletes requirement block by name
- [x] #4 RENAMED delta changes requirement header from old to new name
- [x] #5 Creates backlog/specs/<spec>/spec.md if it doesn't exist
- [x] #6 Validates synced spec against SpecSchema before final write
- [x] #7 Backs up original spec to .bak before modification
- [x] #8 Reports summary: N deltas applied, M specs updated
- [x] #9 --dry-run flag shows what would happen without writing
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
- [x] #4 bun test passes
- [x] #5 bun run check . passes
<!-- DOD:END -->
