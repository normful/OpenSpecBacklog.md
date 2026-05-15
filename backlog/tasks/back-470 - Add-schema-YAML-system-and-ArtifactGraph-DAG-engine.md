---
id: BACK-470
title: Add schema YAML system and ArtifactGraph DAG engine
status: To Do
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-466
priority: high
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port OpenSpec's artifact dependency graph system: (1) SchemaYaml type with Zod validation — name, version, artifacts[] (id, generates, requires[], template). (2) ArtifactGraph class — topological sort (Kahn's algorithm), getNextArtifacts(completed), getBlocked(completed), isComplete(completed). (3) Schema loader — loadSchema(filePath), parseSchema(yamlContent), schema resolution from openspec/schemas/<name>/schema.yaml. (4) State detection — detectCompleted(graph, changeDir) via filesystem file existence for generate patterns. Support both simple paths and glob patterns. (5) Schema resolver — listSchemas(), resolveSchema(name), with user global + project-local + built-in search paths.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SchemaYaml is Zod-validated with required fields
- [ ] #2 ArtifactGraph.getBuildOrder() returns topological sort via Kahn's algorithm
- [ ] #3 getNextArtifacts returns sorted artifacts with all deps completed
- [ ] #4 getBlocked returns artifact→string[] map of unmet dependencies
- [ ] #5 detectCompleted checks filesystem existence of generate patterns
- [ ] #6 Schema resolver searches user global then project local schemas
- [ ] #7 Schema list returns all available schemas with descriptions
- [ ] #8 Unit tests for graph edge cases: circular deps, singleton, diamond
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
- [ ] #5 bun run check . passes
<!-- DOD:END -->
