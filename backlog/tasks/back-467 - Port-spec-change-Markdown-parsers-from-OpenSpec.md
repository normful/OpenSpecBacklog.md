---
id: BACK-467
title: Port spec/change Markdown parsers from OpenSpec
status: To Do
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-466
priority: high
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port OpenSpec's three markdown parsers to Backlog.md: (1) requirement-blocks.ts — parses ### Requirement: blocks and delta sections (## ADDED/MODIFIED/REMOVED/RENAMED Requirements), extracts names, raw blocks, FROM/TO rename pairs. (2) spec-structure.ts — validates main spec files for structural issues. (3) change-parser.ts — parses proposal.md (Why / What Changes sections) + reads specs/<name>/spec.md for delta content. All parsers handle code-fence masking, nested section hierarchy, case-insensitive section matching, and cross-platform line endings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 RequirementBlock parser extracts header lines, names, and raw blocks
- [ ] #2 RequirementsSectionParts preserves before/preamble/body/after regions for roundtrip edits
- [ ] #3 extractRequirementsSection handles missing ## Requirements gracefully
- [ ] #4 parseDeltaSpec recognizes ADDED/MODIFIED/REMOVED/RENAMED sections case-insensitively
- [ ] #5 ChangeParser reads Why + What Changes from proposal.md
- [ ] #6 ChangeParser reads spec deltas from specs/<name>/spec.md files
- [ ] #7 Code-fence masking prevents false header matches inside code blocks
- [ ] #8 All parsers handle \r\n line endings
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
<!-- DOD:END -->
