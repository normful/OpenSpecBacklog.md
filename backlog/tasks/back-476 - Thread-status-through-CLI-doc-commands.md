---
id: BACK-476
title: Thread status through CLI doc commands
status: Done
assignee: ["@nelson"]
created_date: '2026-05-16 06:07'
labels:
  - enhancement
dependencies: []
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `--status` filter to `doc list` CLI command, and show document status in plain text output. Validation against known document lifecycle values (draft, published, archived).
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->

### Implementation Notes

- `doc create` and `doc update` already had `--status` with validation from prior work
- Added `--status` filter to `doc list` — filters by `draft`, `published`, or `archived`
- Added `status` display in `doc list` plain text output (e.g. `doc-1 - Guide (draft)`)
- Added `status` display in `printSearchResults` for document search results (for consistency)
