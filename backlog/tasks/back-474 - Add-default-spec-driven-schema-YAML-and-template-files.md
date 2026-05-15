---
id: BACK-474
title: Add default spec-driven schema YAML and template files
status: To Do
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
Create the default spec-driven schema and its template files under openspec/schemas/spec-driven/: (1) schema.yaml — defines artifacts: proposal, specs, design, tasks with their dependencies (proposal requires nothing, specs requires proposal, design requires proposal, tasks requires specs+design). (2) templates/proposal.md — template with sections for Why, What Changes, Affected Specs. (3) templates/specs.md — template for ## ADDED/MODIFIED/REMOVED/RENAMED Requirements sections with ### Requirement: / #### Scenario: structure. (4) templates/design.md — template with Architecture Decisions, Data Flow, Component Changes sections. (5) templates/tasks.md — task checklist template.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 schema.yaml validates against SchemaYamlSchema
- [ ] #2 proposal.md template includes Why + What Changes sections
- [ ] #3 specs.md template includes all 4 delta section headers with comment guidance
- [ ] #4 design.md template includes architecture + data flow + component sections
- [ ] #5 tasks.md template includes checklist markers
- [ ] #6 Templates are loaded by the schema resolver
- [ ] #7 Schema is resolvable via resolveSchema('spec-driven')
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
<!-- DOD:END -->
