---
id: BACK-480
title: Refactor OpenSpec CLI to use Documents
status: Done
assignee: [Norman]
created_date: '2026-05-16 06:42'
labels:
  - enhancement
dependencies: []
priority: low
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Redesign `spec create`, `change create`, `spec validate`, and `change validate` to create Documents (type: spec, change) in backlog/docs/ instead of writing to backlog/specs/ and backlog/changes/. Use Core API for Document read/write via rawContent. Keep delta specs in backlog/changes/<name>/specs/ as-is.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 `spec create <name>` creates Document (type: spec) in backlog/docs/ via Core API instead of backlog/specs/<name>/spec.md
- [x] #2 `spec validate <name>` reads from Document rawContent via Core API instead of backlog/specs/<name>/spec.md
- [x] #3 `spec list` (already done in BACK-479) continues working
- [x] #4 `change create <name>` creates Document (type: other) with proposal content in backlog/docs/; still creates backlog/changes/<name>/specs/ dir for delta specs
- [x] #5 `change validate <name>` reads proposal from Document rawContent via Core API
- [x] #6 All other change/* commands keep reading/writing backlog/changes/<name>/ for delta specs, design.md, etc.
- [x] #7 bunx tsc --noEmit passes when TypeScript touched
- [x] #8 bun run check . passes when formatting/linting touched
- [x] #9 bun test (or scoped test) passes
<!-- DOD:END -->
