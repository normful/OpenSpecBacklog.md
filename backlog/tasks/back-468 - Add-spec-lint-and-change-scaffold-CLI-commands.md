---
id: BACK-468
title: Add spec/lint and change scaffold CLI commands
status: To Do
assignee:
  - norm
created_date: '2026-05-15 21:03'
labels: []
dependencies:
  - BACK-467
priority: high
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add new CLI commands: (1) backlog spec create <name> — scaffolds a new spec at backlog/specs/<name>/spec.md with template. (2) backlog spec validate <name> — parses and validates spec.md against SpecSchema. (3) backlog spec list — lists all specs with requirement counts. (4) backlog change create <name> — scaffolds new change directory with proposal.md + specs/ + design.md. (5) backlog change validate <name> — validates change structure + delta specs. Uses Commander.js subcommands consistent with Backlog.md's existing pattern (like backlog task, backlog board). Register in src/cli.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 backlog spec create scaffolds valid spec.md with template
- [ ] #2 backlog spec validate reports schema violations with line numbers
- [ ] #3 backlog spec list shows specs and requirement counts
- [ ] #4 backlog change create scaffolds proposal.md + specs/ skeleton
- [ ] #5 backlog change validate validates proposal structure and all delta specs
- [ ] #6 Subcommand structure mirrors existing Backlog.md conventions
- [ ] #7 All commands support --plain for non-interactive output
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
- [ ] #5 bun run check . passes
<!-- DOD:END -->
