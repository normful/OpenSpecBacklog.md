---
id: BACK-477
title: Thread status through MCP doc tools
status: Done
assignee: []
created_date: '2026-05-16 06:07'
labels:
  - enhancement
dependencies: []
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add optional  field to MCP document create/update schemas, handlers, and response formatting. Include  in document summary lines.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

### Implementation Notes

Schemas and handler args already had `status` field. Added `status` to `formatDocumentSummaryLine` output so document list summaries show it.
