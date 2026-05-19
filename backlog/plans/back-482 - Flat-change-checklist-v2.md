---
status: Draft
source-of-truth: src/types/index.ts, src/file-system/operations.ts, src/openspec/change-checklist.ts, src/openspec/sync.ts, src/openspec/archive.ts, src/commands/openspec.ts, src/openspec/serializers.ts
---

# BACK-482 — Flat change checklist v2

## Summary

Replace the 4-artifact change checklist (proposal, deltas, design, publish) with a
2-artifact checklist (spec-delta, new-spec) using flat file conventions, type-routed
Document storage, a new `specs/` top-level output directory, and `syncStatus` tracking.

Removes `proposal` and `design` and `publish` artifacts. Flattens nested `specs/`
subdirectories. Sync IS publish. Published spec output goes to `specs/` at project root.

## Directory tree

```
<project-root>/
├── backlog/
│   ├── tasks/
│   ├── drafts/
│   ├── completed/
│   ├── archive/
│   ├── decisions/
│   ├── milestones/
│   └── changes/
│       ├── 2026-05-16-add-auth/
│       │   ├── auth.spec-delta.md         # ✅ Document (type: "spec-delta", syncStatus: pending|synced)
│       │   └── billing.new-spec.md        # ✅ Document (type: "new-spec",   syncStatus: pending|synced)
│       └── 2026-05-17-update-api/
│           └── api.spec-delta.md          # ✅ Document (type: "spec-delta", syncStatus: pending)
├── specs/                                  # published spec Documents
│   ├── SPC-1 - Auth Login.md              # ✅ Document (type: "specification")
│   └── SPC-2 - Auth SSO.md                # ✅ Document (type: "specification")
```

## What stays the same

- `change sync` logic for applying ADDED/MODIFIED/REMOVED/RENAMED delta sections
- `change archive` logic (move dir to archive)
- Zod schemas (ChangeSchema, SpecSchema, DeltaSchema)
- Parsers (requirement-blocks.ts, change-parser.ts)
- Delta section format (`## ADDED/MODIFIED/REMOVED/RENAMED Requirements`)

## What changes

### 1. New DocumentType values (`src/types/index.ts`)

Add `"spec-delta"` and `"new-spec"` to `DOCUMENT_TYPE_VALUES`:

```ts
export const DOCUMENT_TYPE_VALUES = ["readme", "guide", "specification", "other", "spec-delta", "new-spec"] as const;
```

Remove `"proposal"` — proposals are eliminated entirely. The change name + motivation
is embedded in the spec-delta or new-spec file content (as a `## Motivation` section).

### 2. `syncStatus` field on Document

```ts
export interface Document {
  id: string;
  title: string;
  type: DocumentType;
  status?: DocumentStatus;
  syncStatus?: "pending" | "synced";         // NEW
  createdDate: string;
  updatedDate?: string;
  rawContent: string;
  tags?: string[];
  name?: string;
  path?: string;
  lastModified?: string;
}
```

- Stored in frontmatter as `sync_status: synced` or `sync_status: pending`
- `"pending"` — default for new spec-delta/new-spec Documents
- `"synced"` — set by `change sync` after processing
- Read by `parseDocument` and written by `serializeDocument`

### 3. Type-based directory routing (`src/file-system/operations.ts`)

New `specsDir` getter on `FileSystem`:
```ts
get specsDir(): string {
  return join(this.projectRoot, "specs");
}
```

`saveDocument` gets a `directory` override parameter:
```ts
async saveDocument(document: Document, subPath = "", directory?: string): Promise<string> {
  const baseDir = directory ?? this.resolveDocumentDir(document.type);
  // ... rest of logic uses baseDir
}

private resolveDocumentDir(type: DocumentType): string {
  switch (type) {
    case "specification": return this.specsDir;
    case "spec-delta":
    case "new-spec":     throw new Error("Use directory parameter for change artifacts");
    default:             return this.docsDir;  // readme, guide, other
  }
}
```

For spec-delta/new-spec, the caller (e.g., `Core.createDocumentFromInput` or
`openspec.ts` command handlers) passes `directory: "backlog/changes/2026-05-16-add-auth"`.

### 4. Change artifact filename convention

| type | filename | frontmatter |
|---|---|---|
| `spec-delta` | `<name>.spec-delta.md` | id, title, type, createdDate, syncStatus, **targetSpecId** |
| `new-spec` | `<name>.new-spec.md` | id, title, type, createdDate, syncStatus |

The `title` field stores the spec name (e.g., `"auth"`, `"billing"`). The `id` field
is auto-generated (different prefix per type, e.g., `DELTA-1`, `NEWSPEC-1`).

For `spec-delta` artifacts, `targetSpecId` is a required frontmatter field that
references the published spec's ID (e.g., `SPC-3`). User sets this manually when
creating the spec-delta artifact. Sync uses it to resolve which spec to apply
deltas to.

Frontmatter example:
```yaml
---
id: DELTA-1
title: auth
type: spec-delta
created_date: 2026-05-16 10:30
sync_status: pending
target_spec_id: SPC-3
---
```

`saveDocument` overrides filename logic when `directory` is provided:
- Uses `<title>.spec-delta.md` or `<title>.new-spec.md` instead of
  `<id> - <title>.md`
- No ID-based dedup (change artifacts are transient — no renames or moves)

### 5. Frontmatter for change artifacts

Example `auth.spec-delta.md`:
```markdown
---
id: DELTA-1
title: auth
type: spec-delta
created_date: 2026-05-16 10:30
sync_status: pending
target_spec_id: SPC-3
---

## Motivation
Add OAuth2 login to replace basic auth.

## ADDED Requirements
### Requirement: Login with email
...
```

Example `billing.new-spec.md`:
```markdown
---
id: NEWSPEC-1
title: billing
type: new-spec
created_date: 2026-05-16 10:30
sync_status: pending
---

## Motivation
Need billing capability for subscription management.

## Purpose
Handle subscription billing and invoicing.

## Requirements
### Requirement: Process monthly invoices
...
```

### 6. Published spec Documents (`specs/`)

| type | filename | frontmatter |
|---|---|---|
| `specification` | `SPC-<id> - <title>.md` | id, title, type, status, createdDate, syncStatus |

`saveDocument` routes `type: "specification"` to `specs/` using `resolveDocumentDir`.

### 7. Artifact checklist (`CHANGE_ARTIFACTS`)

Now 2 artifacts (proposal removed, design removed, publish removed):

```ts
const CHANGE_ARTIFACTS: ChangeArtifact[] = [
  { id: "deltas",   label: "Delta specs",  generates: "*.spec-delta.md", projectRootRelative: false, dependsOn: [] },
  { id: "new-specs", label: "New specs",   generates: "*.new-spec.md",  projectRootRelative: false, dependsOn: [] },
];
```

A change is "complete" when both artifacts are done. No dependencies between them.

### 8. `change sync` is the publish step

Reads `*.spec-delta.md` and `*.new-spec.md` Documents from change dir.
Two-step flow — different handling per artifact type.

#### spec-delta processing

- Resolve target spec by `target_spec_id` frontmatter field (e.g., `SPC-3`)
  - User sets manually when creating the spec-delta artifact
  - Sync globs `specs/SPC-*.md` to find the matching spec Document
  - Error if `target_spec_id` is missing or no spec found with that ID
- Applies ADDED/MODIFIED/REMOVED/RENAMED delta sections to the target spec content
- Backup original spec content before modifying (to `backlog/changes/<name>/backups/`)
- Validate result against SpecSchema
- Write updated spec Document back to `specs/`
- Update change artifact's `syncStatus` to `"synced"`

#### new-spec processing

- Reads `*.new-spec.md` body
- Strips frontmatter and `## Motivation` section (if present)
- Keeps `## Purpose` and `## Requirements` sections as the spec body
- Creates a new spec Document in `specs/` with:
  - `type: "specification"`
  - ID auto-generated (`SPC-<N>`)
  - `syncStatus: "synced"`
  - `status: "draft"`
- Updates change artifact's `syncStatus` to `"synced"`

#### Post-sync

- Both change artifact frontmatter and published spec frontmatter get
  `syncStatus: "synced"`
- sync.ts handles frontmatter updates directly:
  - Reads change artifact via `parseDocument`
  - Modifies frontmatter `sync_status` field
  - Writes back via `serializeDocument` + disk write
  - Same for the published spec Document

### 9. `listDocuments` — multi-directory scan

`listDocuments()` scans both `backlog/docs/` and `specs/`:

```ts
async listDocuments(type?: DocumentType): Promise<Document[]> {
  const allDocs: Document[] = [];
  const dirsToScan: string[] = [];

  dirsToScan.push({ dir: this.docsDir, glob: "**/*.md" });  // always
  dirsToScan.push({ dir: this.specsDir, glob: "**/*.md" }); // always

  for (const { dir, glob } of dirsToScan) {
    // scan and parse as today, with exclusions
  }

  return allDocs.sort((a, b) => a.title.localeCompare(b.title));
}
```

Change artifacts (`backlog/changes/`) are NOT scanned by `listDocuments`. They're
listed via a separate method or by scanning the specific change dir.

### 10. Change name resolution

User passes short name (e.g., `add-auth`). System:
1. Globs `backlog/changes/*-add-auth/`
2. If multiple matches, uses most recent by date prefix
3. If none, error: change not found

`change create <name>` creates `backlog/changes/YYYY-MM-DD-<name>/`.

Change artifact Documents inside the change dir have their `path` field set to
the change name (e.g., `"2026-05-16-add-auth"`).

### 11. `change archive` unsynced check

`archiveChange` checks:
1. List all Documents in the change dir
2. If any have `syncStatus: "pending"`, block archive (unless `--force`)
3. If all synced, move the change dir to `backlog/changes/archive/<date>-<name>/`

### 12. Files changed

| File | Change |
|---|---|
| `src/types/index.ts` | Add `"spec-delta"`, `"new-spec"` to `DOCUMENT_TYPE_VALUES`. Add `syncStatus?: "pending" \| "synced"` to `Document`. |
| `src/markdown/parser.ts` | Parse `sync_status` from frontmatter in `parseDocument`. |
| `src/markdown/serializer.ts` | Write `sync_status` to frontmatter in `serializeDocument`. |
| `src/file-system/operations.ts` | Add `specsDir` getter. Add `directory` param to `saveDocument`. Add `resolveDocumentDir`. Update `listDocuments` to scan `specs/` and produce `backlog/docs/` too. |
| `src/constants/index.ts` | (if needed) Add `SPECS` constant. |
| `src/openspec/change-checklist.ts` | Remove `proposal`, `design`, `publish` artifacts. Keep only `deltas` + `new-specs`. |
| `src/openspec/archive.ts` | Check `syncStatus` on Documents instead of checking nested dirs. |
| `src/openspec/sync.ts` | Glob `*.spec-delta.md` and `*.new-spec.md` from change root. Resolve target spec by `target_spec_id` frontmatter. Create new specs from `*.new-spec.md` body (strip frontmatter + `## Motivation`, keep `## Purpose` + `## Requirements`). Write to `specs/`. Set `syncStatus` on both change artifact and published spec via parseDocument/modify/serializeDocument. |
| `src/openspec/serializers.ts` | No functional change. |
| `src/commands/openspec.ts` | Remove proposal scaffolding. `change create` no longer creates `specs/` subdir. `delta add` writes `.spec-delta.md` via `saveDocument` with directory param. `delta list`/`remove` glob flat files. `validate` reads flat files. |
| `src/core/backlog.ts` | `createDocumentFromInput` routes `spec-delta`/`new-spec` to `saveDocument` with directory override. `createDocumentFromInput` routes `specification` to `specs/` via type routing. |
| `src/test/openspec-change-checklist.test.ts` | Update to 2 artifacts. |
| `src/test/openspec-archive.test.ts` | Remove design/proposal fixtures. Update unsynced check for `syncStatus`. |
| `src/test/openspec-sync.test.ts` | Add `*.new-spec.md` test cases. |
| `src/test/markdown.test.ts` | Add `syncStatus` serde tests. |
| `docs/backlog-directory-structure.md` | Update. |
