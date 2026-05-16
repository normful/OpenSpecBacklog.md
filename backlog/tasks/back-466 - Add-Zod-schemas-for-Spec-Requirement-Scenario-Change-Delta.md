id: BACK-466
title: 'Add Zod schemas for Spec, Requirement, Scenario, Change, Delta'
status: In Progress
created_date: '2026-05-15 21:02'
labels: []
deps: []
priority: high
ordinal: 24000
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Port OpenSpec's Zod schema validation system into Backlog.md. Create Zod schemas for: SpecSchema (name, overview, requirements[]), RequirementSchema (text with SHALL/MUST enforcement, scenarios[]), ScenarioSchema (rawText), ChangeSchema (name, why, whatChanges, deltas[]), DeltaSchema (spec, op ∈ {ADDED/MODIFIED/REMOVED/RENAMED}, description, requirements[], rename?: {from, to}). All markdown output must match OpenSpec's expected shape (#### Scenario: headers, ### Requirement: blocks, ## ADDED/MODIFIED/REMOVED/RENAMED Requirements sections). Add validation threshold constants matching OpenSpec (minWhySectionLength=50, maxDeltasPerChange=10, etc.) with optional config.yml integration via BacklogConfig.validation.

Header level note: Spec/change/delta files live in backlog/specs/<name>/spec.md and backlog/changes/<name>/*.md — standalone files separate from Backlog.md task/docs/decision files. OpenSpec's ## sections (Purpose, Requirements, ADDED Requirements, etc.), ### Requirement: blocks, and #### Scenario: headers operate within their own file boundaries and never collide with Backlog.md's existing ## sections (Description, Acceptance Criteria, Implementation Plan, etc.). No conflict.
<!-- SECTION:DESCRIPTION:END -->
## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zod@^4 added as a runtime dep
- [ ] #2 SpecSchema validates non-empty name, non-empty overview, min 1 requirement
- [ ] #3 RequirementSchema enforces SHALL/MUST keyword presence via .refine()
- [ ] #4 RequirementSchema enforces min 1 scenario
- [ ] #5 ScenarioSchema: rawText: string (matches OpenSpec)
- [ ] #6 DeltaSchema: requirements[] only (always array, simplified from OpenSpec's dual requirement? + requirements[]?)
- [ ] #7 DeltaSchema: rename?: { from: string; to: string } for RENAMED ops (matches OpenSpec)
- [ ] #8 ChangeSchema enforces why section length bounds (min 50, max 1000) and max 10 deltas
- [ ] #9 Validation thresholds have hardcoded defaults, overridable via BacklogConfig.validation section
- [ ] #10 All schemas export TypeScript types via z.infer<> aliases
- [ ] #11 Schemas are at src/openspec/schemas/ with individual files + barrel index.ts
- [ ] #12 bun run check . passes on new files
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
- [ ] #5 bun run check . passes
