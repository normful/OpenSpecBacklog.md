---
id: BACK-469
title: Add delta editing commands to change workflow
status: To Do
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-468
priority: high
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add delta management commands: backlog change delta add <change> --spec <name> --op ADDED/MODIFIED/REMOVED/RENAMED --req '<requirement text>' — appends a delta to a change's delta spec. backlog change delta list <change> — shows all deltas grouped by operation type. backlog change delta remove <change> --index <n> — removes a delta by index. Each delta is stored in backlog/changes/<change>/specs/<spec>/spec.md under the appropriate ## ADDED/MODIFIED/REMOVED/RENAMED Requirements section. Requirement text includes SHALL/MUST validation. Scenarios added via --scenario flag (Given/When/Then format).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 backlog change delta add creates delta spec file if not exists
- [ ] #2 Delta is stored under correct section header by operation type
- [ ] #3 backlog change delta list shows deltas grouped by op type
- [ ] #4 backlog change delta remove removes delta by 1-based index
- [ ] #5 Requirement text is validated against RequirementSchema on add
- [ ] #6 --scenario flag appends GWT scenario to requirement
- [ ] #7 Supports --json output for agent consumption
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
<!-- DOD:END -->
