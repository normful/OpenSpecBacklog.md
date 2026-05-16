id: BACK-468
title: Add spec/lint and change scaffold CLI commands
status: To Do
created_date: '2026-05-15 21:03'
labels: []
  - BACK-467
priority: high
ordinal: 26000
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Add new CLI commands: (1) backlog spec create <name> — scaffolds a new spec at backlog/specs/<name>/spec.md with template. (2) backlog spec validate <name> — parses and validates spec.md against SpecSchema. (3) backlog spec list — lists all specs with requirement counts. (4) backlog change create <name> — scaffolds new change dir with proposal.md + specs/ + design.md. (5) backlog change validate <name> — validates change structure + delta specs. Uses Commander.js subcommands consistent with Backlog.md's existing pattern (like backlog task, backlog board). Register in src/cli.ts.

### Import Sources (updated after BACK-467)

BACK-467 exposes:
- `parseChange(content)`, `parseChangeFromFile(filePath)` — parse proposal.md
- `parseSpecDeltas(specName, content)`, `parseSpecDeltasFromFile(specName, filePath)` — parse delta spec files
- `extractRequirementsSection(content)` — parse ## Requirements into body blocks
- `parseDeltaSpec(content)` — parse delta sections into DeltaPlan

Async helpers ready for CLI cmd handlers. No async wrapper needed in this task.

### Decisions (confirmed Socrates 2026-05-16)

| Decision | Choice | Rationale |
|----------|--------|----------|
| Line numbers for `spec validate` | Lightweight helper fn searching text snippet → 1-based line index | Simpler than porting spec-structure.ts; only need line numbers for error messages, not editing |
| Template style | `src/openspec/templates.ts` with inline template string constants | Matches existing Backlog.md pattern (createDecisionWithTitle, createDocumentFromInput all use inline strings) |
| Spec list data source | Iterate `backlog/docs/` files, parse YAML frontmatter for `type: spec` | No spec index yet; docs with frontmatter key `type: spec` are the canonical source |

### Implementation Plan

**Files to create:**
1. `src/openspec/templates.ts` — inline template strings for spec.md, proposal.md, design.md
2. `src/commands/openspec.ts` — `registerSpecCommand()`, `registerChangeCommand()`; subcommands: `spec create`, `spec validate`, `spec list`, `change create`, `change validate`
3. `src/test/openspec-cli.test.ts` — tests for CLI command handlers

**Files to modify:**
1. `src/cli.ts` — import + call `registerSpecCommand(program)` and `registerChangeCommand(program)` at bottom

**Line-number helper (in openspec.ts):**
- `findLineNumber(content: string, text: string): number` — splits content into lines, searches for exact text match, returns 1-based index (or -1)
- Used by `spec validate` to annotate Zod error paths with line numbers

**Templates (templates.ts):**
- `SPEC_TEMPLATE` — `## Purpose` + `## Requirements` sections with placeholder requirement
- `PROPOSAL_TEMPLATE` — `## Why` + `## What Changes` sections
- `DESIGN_TEMPLATE` — `## Overview` + `## Architecture` + `## Tradeoffs` sections
- Filled at creation; user edits after scaffolding

**Registration pattern (matches existing Backlog.md style):**
- `registerSpecCommand(program: Command)` — adds `spec` command group with `create`, `validate`, `list` subcommands
- `registerChangeCommand(program: Command)` — adds `change` command group with `create`, `validate` subcommands
- Both use Commander.js `.command()` / `.description()` / `.action()` pattern
- Support `--plain` via existing `isPlainRequested()` helper

**Spec list implementation:**
- Call `core.filesystem.listDocuments()` — filter docs where `doc.type === "spec"`
- Parses frontmatter from each doc markdown file to get the type
- Falls back to listing `backlog/specs/` directory if it exists (future-proof)

<!-- SECTION:DESCRIPTION:END -->
## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `backlog spec create <name>` scaffolds valid spec.md with template at `backlog/specs/<name>/spec.md`
- [ ] #2 `backlog spec validate <name>` parses + validates spec.md against SpecSchema, reports schema violations with line numbers
- [ ] #3 `backlog spec list` shows specs (type:spec docs) with requirement counts
- [ ] #4 `backlog change create <name>` scaffolds proposal.md + specs/ + design.md skeleton at `backlog/changes/<name>/`
- [ ] #5 `backlog change validate <name>` validates proposal.md via ChangeSchema + all delta spec files via parseSpecDeltas
- [ ] #6 Subcommand registration uses export pattern (registerSpecCommand, registerChangeCommand), matching existing conventions
- [ ] #7 All commands support --plain for non-interactive output
- [ ] #8 Template strings are inline constants in `src/openspec/templates.ts`
- [ ] #9 Line number reporting uses lightweight findLineNumber helper (text search → 1-based index)
<!-- DOD:BEGIN -->
- [ ] #1 bunx tsc --noEmit passes when TypeScript touched
- [ ] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
- [ ] #4 bun test passes
- [ ] #5 bun run check . passes
- [ ] #6 Tests cover: spec create wiring, spec validate with line numbers, spec list filtering by type:spec, change create wiring, change validate with proposal + delta parsing
