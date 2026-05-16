---
id: BACK-467
title: Port spec/change Markdown parsers from OpenSpec
status: In Progress
created_date: '2026-05-15 21:03'
labels: []
deps:
  - BACK-466
priority: high
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port OpenSpec's three markdown parsers to Backlog.md: (1) requirement-blocks.ts — parses ### Requirement: blocks and delta sections (## ADDED/MODIFIED/REMOVED/RENAMED Requirements), extracts names, raw blocks, FROM/TO rename pairs. (2) spec-structure.ts — validates main spec files for structural issues. (3) change-parser.ts — parses proposal.md (Why / What Changes sections) + reads specs/<name>/spec.md for delta content. All parsers handle code-fence masking, nested section hierarchy, case-insensitive section matching, and cross-platform line endings.

Relationship to BACK-466: Parsers are independent of the Zod schemas — they have their own types (RequirementBlock, RequirementsSectionParts, DeltaPlan) for raw markdown parse results. The Zod schemas validate the *parsed data* after the markdown → data transformation. The parsers' DeltaPlan.R type (Array<{from; to}>) matches DeltaSchema's rename?: {from; to} from BACK-466. Parsers live in src/openspec/parsers/. File paths for specs in backlog.md project: specs at backlog/specs/<name>/spec.md, changes at backlog/changes/<name>/proposal.md + specs/<name>/spec.md (mirrors OpenSpec's openspec/ layout but under backlog/).
<!-- SECTION:DESCRIPTION:END -->

## Research & Design Decisions

### Sources Researched

- OpenSpec reference source: `/Users/norman/.opensrc/repos/github.com/Fission-AI/OpenSpec/main/src/core/parsers/requirement-blocks.ts`
- OpenSpec reference source: `/Users/norman/.opensrc/repos/github.com/Fission-AI/OpenSpec/main/src/core/parsers/spec-structure.ts`
- OpenSpec reference source: `/Users/norman/.opensrc/repos/github.com/Fission-AI/OpenSpec/main/src/core/parsers/change-parser.ts`
- OpenSpec reference source: `/Users/norman/.opensrc/repos/github.com/Fission-AI/OpenSpec/main/src/core/parsers/markdown-parser.ts`
- OpenSpec test files for all three parsers (confirmed test patterns)
- Backlog.md existing codebase: `src/markdown/parser.ts`, `src/markdown/structured-sections.ts`, `src/types/index.ts`, `src/file-system/operations.ts`

### Design Decisions (Socrates-confirmed)

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Standalone functions in `src/openspec/parsers/` | OpenSpec parsing is a completely different concern from task/doc frontmatter parsing. Clean separation, no imports from `src/markdown/`. |
| DeltaSchema mapping | `requirements[]` array only (no singular field) | Each delta holds all affected requirements for that spec. Our DeltaSchema already uses this shape. |
| File I/O | Synchronous core parsers (text in → parsed data out) | Callers (CLI commands/MCP tools) handle file reading with `Bun.file(path).text()`. Pattern matches existing `parseTask(content)`, `parseDecision(content)` etc. |
| spec-structure.ts | Deferred (not in ACs) | `findMainSpecStructureIssues()` is used by validate commands which are a future task (BACK-470). Code-fence masking utility from spec-structure will be reused in change-parser. |
| RENAMED format | Exact OpenSpec port: FROM: `### Requirement: OldName` / TO: `### Requirement: NewName` | Matching OpenSpec ensures interchange compatibility. |
| REMOVED format | Only `### Requirement: Name` headers (no bullet-list format) | Simpler; covers primary use case. |
| Code-fence masking | Shared utility in `requirement-blocks.ts` as exported helper | Needed by change-parser for hierarchical section parsing; spec-structure has its own variant deferred. |
| CRLF handling | Normalize at function entry via `.replace(/\r\n?/g, '\n')` | Matches OpenSpec pattern and Backlog.md `normalizeToLF()` in structured-sections.ts. |

### Implementation Plan

**Files to create:**

1. `src/openspec/parsers/requirement-blocks.ts` — RequirementBlock, RequirementsSectionParts, DeltaPlan types + `extractRequirementsSection()`, `parseDeltaSpec()`, `normalizeLineEndings()`, `splitTopLevelSections()`
2. `src/openspec/parsers/change-parser.ts` — `parseChange(content)` (Why + What Changes), `parseSpecDeltas(content)` (delta sections), `parseSections(content)` (hierarchical with code-fence masking), `parseRequirements(section)`, `parseScenarios(section)`, `parseRenames(content)`
3. `src/openspec/parsers/index.ts` — barrel exports
4. `src/test/openspec-parsers.test.ts` — comprehensive tests

**Key OpenSpec functions to port:**

`requirement-blocks.ts`:
- `normalizeRequirementName(name)` → trim
- `extractRequirementsSection(content)` → RequirementsSectionParts (before, headerLine, preamble, bodyBlocks[], after)
- `parseDeltaSpec(content)` → DeltaPlan (added[], modified[], removed[], renamed[], sectionPresence)
- `splitTopLevelSections(content)` → Record<string, string> (splits on ## headers)
- `getSectionCaseInsensitive(sections, desired)` → {body, found}
- `parseRequirementBlocksFromSection(sectionBody)` → RequirementBlock[]
- `parseRemovedNames(sectionBody)` → string[] (only ### Requirement: headers)
- `parseRenamedPairs(sectionBody)` → Array<{from, to}> (FROM:/TO: format)

`change-parser.ts`:
- `parseChange(content)` → {why, whatChanges, deltas} (synchronous, no file I/O)
- `parseSpecDeltas(content)` → Delta[] (parse delta sections from spec.md content)
- `parseSections(content)` → Section[] (hierarchical with code-fence masking)
- `parseRequirements(section)` → Requirement[] (from Zod schemas)
- `parseScenarios(section)` → Scenario[] (from Zod schemas)
- `parseDeltas(content)` → Delta[] (simple bullet-list format)
- `parseRenames(content)` → Array<{from, to}>
- `normalizeContent(content)` → string (CRLF→LF)
- `buildCodeFenceMask(lines)` → boolean[]
- `findSection(sections, title)` → Section | undefined (case-insensitive)

**Test cases (red-green TDD for each AC):**

- #1: RequirementBlock extraction (canonical, mixed-case, no-space-after-###, multiple blocks)
- #2: RequirementsSectionParts with before/preamble/body/after for roundtrip (content before/after preserved)
- #3: extractRequirementsSection handles missing ## Requirements (creates empty one at end)
- #4: parseDeltaSpec case-insensitive ADDED/MODIFIED/REMOVED/RENAMED section recognition, cross-validation (RENAMED needs rename, ADDED needs requirements)
- #5: parseChange reads Why + What Changes from proposal.md, infers delta ops from bullet descriptions
- #6: parseSpecDeltas reads delta sections from spec.md content (ADDED/MODIFIED/REMOVED/RENAMED with Requirement blocks)
- #7: Code-fence masking prevents false header matches inside fenced code blocks
- #8: CRLF line endings handled correctly (parsed identically to LF)

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
