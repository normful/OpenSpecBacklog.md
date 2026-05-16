---
id: BACK-479
title: Add status filter to doc search and listing
status: Done
assignee: ["@nelson"]
created_date: '2026-05-16 06:08'
labels:
  - enhancement
dependencies: []
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add ability to filter/search documents by status across the Core query layer, MCP tools, server API, and web UI sidebar.
<!-- SECTION:DESCRIPTION:END -->
### Implementation Notes
- Core/filesystem: `listDocuments(status?)` accepts optional `status` param, filters docs by case-insensitive match
- MCP: `doc_list` schema now has `status` enum field (draft/published/archived); handler passes it to `listDocuments`
- Server API: `/api/docs?status=draft` filters by status
- Web UI sidebar: Added Draft/Published/Archived filter pills in the Documents section; click to toggle, Clear button to reset
- Search service: `DocumentSearchEntity` now tracks `statusLower`; `collectWithoutQuery` and Fuse search both filter documents by status when `filters.status` is set
- `doc search` MCP tool also respects status filters through the shared SearchService

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->
