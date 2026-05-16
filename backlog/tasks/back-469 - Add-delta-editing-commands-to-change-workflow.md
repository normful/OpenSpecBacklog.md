---
id: BACK-469
title: Add delta editing commands to change workflow
status: To Do
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-468
priority: high
ordinal: 27000
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Add delta management commands: backlog change delta add <change> --spec <name> --op ADDED/MODIFIED/REMOVED/RENAMED --req '<requirement text>' — appends a delta to a change's delta spec. backlog change delta list <change> — shows all deltas grouped by op type. backlog change delta remove <change> --index <n> — removes a delta by index. Each delta is stored in backlog/changes/<change>/specs/<spec>/spec.md under the appropriate ## ADDED/MODIFIED/REMOVED/RENAMED Requirements section. Requirement text includes SHALL/MUST validation. Scenarios + via --scenario flag (Given/When/Then format).

### Established by BACK-468

BACK-468 created:
- `src/commands/openspec.ts` — `registerChangeCommand(program)` adds the `change` command group. BACK-469 delta subcommands should be added as subcommands of this same group.
- `backlog/changes/<name>/` directory convention — change data lives at this path with `proposal.md` + `specs/` + `design.md`. Delta files go under `specs/<spec>/spec.md`.
- `parseChange(content)` and `extractRequirementsSection(content)` — existing parsers reusable for delta editing.

### Key consideration for BACK-469

Delta spec file path: `backlog/changes/<name>/specs/<spec>/spec.md`. Each delta file uses `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` section headers. `extractRequirementsSection` can read these; BACK-469 needs to **write** (append/update/remove) sections.
<!-- SECTION:DESCRIPTION:END -->
## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 backlog change delta add creates delta spec file if not exists
- [ ] #2 Delta is stored under correct section header by op type
- [ ] #3 backlog change delta list shows deltas grouped by op type
- [ ] #4 backlog change delta remove removes delta by 1-based index
- [ ] #5 Requirement text is validated against RequirementSchema on add
- [ ] #6 --scenario flag appends GWT scenario to requirement
- [ ] #7 Supports --json output for agent consumption
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
