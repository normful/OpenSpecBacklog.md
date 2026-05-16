---
id: doc-4
title: Document status field proposal
type: specification
status: draft
created_date: '2026-05-16 06:43'
---

## Purpose

Add an optional `status` field to the Document domain object to track lifecycle
state. Documents currently have no concept of lifecycle — they are static
markdown files. Adding status enables workflow stages (draft, review, approved,
deprecated) that are especially useful for specification and change documents.

## Requirements

### Requirement: `status` field on Document interface
An optional `status?: string` field on `Document`, `DocumentCreateInput`, and
`DocumentUpdateInput`.

### Requirement: Allowed status values: draft, review, approved, deprecated
- `draft` — initial state, work in progress
- `review` — ready for peer review
- `approved` — finalized, authoritative
- `deprecated` — superseded, no longer current
- `undefined`/unset — legacy documents without status

### Requirement: Persist `status` in YAML frontmatter
- Parser: `String(frontmatter.status)` if present, otherwise `undefined`
- Serializer: Omit when undefined; write `status: <value>` when present

### Requirement: Thread through all layers
- Core create/update (`createDocumentFromInput`, `updateDocumentFromInput`)
- CLI `doc create --status` and `doc update --status`
- MCP doc tools (schemas, handlers, response formatting)
- Server API endpoints (create, update, list)
- Web UI DocumentationDetail display

### Requirement: Add `"change"` to `DOCUMENT_TYPE_VALUES`
Extend supported document types from `["readme", "guide", "specification",
"other"]` to `["readme", "guide", "specification", "change", "other"]`.

### Requirement: Status filter for document listing
Allow filtering documents by status in:
- Core document query layer
- MCP `doc_list` tool
- Server `/api/docs` endpoint
- Web UI sidebar

### Requirement: Search-index the `status` field
Include `status` in the `DocumentSearchEntity` so full-text search can match
and filter by status values.

### Requirement: Backwards compatibility
- Existing documents without `status` in frontmatter parse as `undefined`
- Serializer omits `status` when undefined (no YAML key written)
- All existing tests pass without modification

## Scenarios

#### Scenario: Create a spec document with draft status
```
backlog doc create "API Spec" -t specification --status draft
```
→ Creates document with `status: draft` in frontmatter.
→ Web UI shows "Draft" badge next to the document title.

#### Scenario: Approve a document after review
```
backlog doc update doc-5 --status approved
```
→ Updates document, sets `status: approved` in frontmatter.
→ Web UI shows "Approved" badge.

#### Scenario: Deprecate an outdated spec
```
backlog doc update doc-5 --status deprecated
```
→ Document still exists but marked as superseded.
→ Search/filter by `deprecated` to find stale specs.

#### Scenario: List only approved documents
```
backlog search --type document --status approved
```
→ Returns only documents with `status: approved`.

#### Scenario: Legacy document without status
```
backlog doc create "Quick Guide" -t guide
```
→ No `status` in frontmatter.
→ Parser returns `status: undefined`.
→ Serializer omits the field entirely.
→ Everything works as before.

#### Scenario: Change proposal document
```
backlog doc create "Add auth" -t change --status draft --path proposals/
```
→ Creates document with `type: change` and `status: draft`.
→ Shows up in document listings with type "Change".

## Consequences

- **Positive**: Documents get lifecycle management previously unavailable.
- **Positive**: Spec and change Documents can be tracked through approval workflow.
- **Positive**: Single `status` set for all Documents avoids type-specific complexity.
- **Positive**: Backwards compatible — no migration needed for existing files.
- **Caution**: The `status` field on Document is unrelated to `status` on Task or
  Decision. Each entity has independent lifecycle semantics.
