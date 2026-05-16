---
id: BACK-480
title: Refactor OpenSpec CLI to use Documents
status: To Do
assignee: []
created_date: '2026-05-16 06:42'
labels:
  - enhancement
dependencies: []
priority: low
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Redesign  and  to create Documents (type: specification, change) in backlog/docs/ instead of writing to backlog/specs/ and backlog/changes/. Update  to read/write Document rawContent via Core API. Keep delta specs in backlog/changes/<name>/specs/ as-is.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
<!-- DOD:END -->
