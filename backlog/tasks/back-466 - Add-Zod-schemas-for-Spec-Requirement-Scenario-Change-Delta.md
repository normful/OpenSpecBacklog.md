---
id: BACK-466
title: 'Add Zod schemas for Spec, Requirement, Scenario, Change, Delta'
status: To Do
assignee:
  - norm
created_date: '2026-05-15 21:02'
labels: []
dependencies: []
priority: high
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port OpenSpec's Zod schema validation system into Backlog.md. Create Zod schemas for: SpecSchema (name, overview, requirements[]), RequirementSchema (text with SHALL/MUST enforcement, scenarios[]), ScenarioSchema (rawText), ChangeSchema (name, why, whatChanges, deltas[]), DeltaSchema (spec, operation ∈ {ADDED/MODIFIED/REMOVED/RENAMED}, description, requirement?, requirements[]?). Add validation threshold constants (min_why_section_length=50, max_deltas_per_change=10). Add config.yaml integration for validation settings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zod is added as a dependency
- [ ] #2 SpecSchema validates non-empty name, min 1 requirement
- [ ] #3 RequirementSchema enforces SHALL/MUST keyword presence
- [ ] #4 RequirementSchema enforces min 1 scenario
- [ ] #5 ChangeSchema enforces why section length bounds and delta limits
- [ ] #6 DeltaSchema validates operation type enum and spec/description non-empty
- [ ] #7 Validation thresholds are configurable via backlog/config.yml
- [ ] #8 All schemas export TypeScript types
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
- [ ] #5 bun run check . passes
<!-- DOD:END -->
