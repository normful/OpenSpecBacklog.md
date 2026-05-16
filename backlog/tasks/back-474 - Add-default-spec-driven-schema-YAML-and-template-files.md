---
id: BACK-474
title: Add default spec-driven schema YAML and template files
status: Done
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-470
priority: medium
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the default spec-driven schema and its template files under openspec/schemas/spec-driven/: (1) schema.yaml — defines artifacts: proposal, specs, design with their dependencies (proposal requires nothing, specs requires proposal, design requires proposal). (2) templates/proposal.md — template with sections for Why, What Changes. (3) templates/specs.md — template for ## ADDED/MODIFIED/REMOVED/RENAMED Requirements sections with ### Requirement: / #### Scenario: structure. (4) templates/design.md — template with Architecture Decisions, Data Flow, Component Changes sections.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 schema.yaml validates against SchemaYamlSchema
- [x] #2 proposal.md template includes Why + What Changes sections
- [x] #3 specs.md template includes all 4 delta section headers with comment guidance
- [x] #4 design.md template includes architecture + data flow + component sections
- [x] #5 Templates are loaded by the schema resolver
- [x] #6 Schema is resolvable via resolveSchema('spec-driven')
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
- [x] #4 bun test passes
<!-- DOD:END -->

## Implementation Notes

Removed duplicate `/tmp/test-debug.ts` and `/tmp/test-regex.ts` from summary (not part of this project).

### Changes made:
- `openspec/schemas/spec-driven/schema.yaml` — removed `tasks` artifact and `apply` section (3 artifacts: proposal, specs, design)
- `openspec/schemas/spec-driven/templates/design.md` — added `## Data Flow` and `## Component Changes` sections
- `openspec/schemas/spec-driven/templates/tasks.md` — deleted (artifact removed)
