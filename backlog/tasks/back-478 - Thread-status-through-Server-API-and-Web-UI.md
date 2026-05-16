---
id: BACK-478
title: Thread status through Server API and Web UI
status: Done
assignee: []
created_date: '2026-05-16 06:08'
labels:
  - enhancement
dependencies: []
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add optional  field to server document endpoints (create/update/list) and the web UI DocumentationDetail component for display alongside metadata.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes

### Implementation Notes

- Server `handleCreateDoc`/`handleUpdateDoc` already parsed `status` from request body
- Added `status: doc.status ?? null` to `handleListDocs` response object
- Web `apiClient.createDoc` and `updateDoc` now accept optional `status` param
- Web `DocumentationDetail` component displays status badge alongside other metadata
- Made commit 9526bbb
<!-- DOD:END -->
