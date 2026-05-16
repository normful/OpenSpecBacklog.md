---
id: BACK-475
title: Add status field to Document entity
status: To Do
assignee: []
created_date: '2026-05-16 06:07'
labels:
  - enhancement
dependencies: []
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add an optional  field to the Document domain object, persisting it in YAML frontmatter and threading it through parser, serializer, types, Core create/update, CLI, MCP, server, and web UI.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
<!-- DOD:END -->
