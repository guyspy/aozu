# ADR-0009: Organize the Character Library with Collections and Atomic Backups

- Status: Accepted
- Date: 2026-09-08

## Context

The 2D workshop needs to organize and move an entire local Character library,
including unfinished work and installed packs. Individual Character ZIPs do not
capture library organization. Restoring many records independently risks partial
writes, ID collisions, or a stale tab overwriting restored artwork.

## Decision

**Collection** is the one organizational term above Characters. A Character may
belong to one Collection or remain Uncollected. Collections have stable IDs,
names, and Character ID references. Deleting a Collection preserves its
Characters; deleting a Character removes its membership atomically.

Collections are operational `character-collections` Mantle-shaped entries in the
existing authoring namespace and IndexedDB entry store. The authoring backbone
declares their schema. Application-owned semantic IndexedDB operations enforce
membership and revision checks in transactions, following ADR-0003. They contain
no Blob data, React state, experience mechanics, or compatibility claims.

A versioned `aozu-character-library` ZIP contains authoring workspaces,
Collections, installed Character Packs, their asset namespaces (including staged
artwork), and legacy drafts when present. Old drafts are projected into the
current editable schema without writing during export. Derived atlases are
rebuilt and do not need to be stored in this backup. Experience bundles, active
Companion state, and browser preferences are outside this library archive.

`library.json` describes the records and assets. `integrity.json` records SHA-256
digests and byte lengths for every payload file, including the library manifest;
the manifest declares each asset's media type. These checks detect corruption;
they are not a signature authenticating the archive's author. Import validates
ZIP directories and local headers, paths, file counts, sizes, CRCs, JSON depth,
digests, schemas, duplicate IDs, references, PNG pixels/dimensions, and installed
pack compositions before storage changes. The library profile permits at most
256 MiB compressed or expanded, 20 MiB per file, and 10,000 files. Images retain
the stricter Character asset limits. Oversized libraries fail explicitly without
a partial export or restore.

The UI previews validated counts and offers two explicit behaviors:

- **Merge** adds new identities, keeps identical local content and its revision,
  and rejects the entire import if an ID has conflicting content or if combined
  references/membership are invalid. It does not rename IDs or choose a winner.
- **Replace** replaces only the Character library, including removal of records
  absent from the archive. The user explicitly chooses “Replace my library”
  after seeing its scope. An empty archive restores an empty library.

Restore revalidates the prepared snapshot, then performs conflict checks and all
writes in one IndexedDB transaction. Blob comparisons retain that transaction's
lock while hashing. Failure, including a quota/write error, rolls back the entire
operation. New/restored entry revisions exceed a retained revision floor, so a
previous tab's expected revision cannot overwrite restored content, including
after deletion and reimport of an identity. The local editor is closed after a
successful restore; unsaved or conflicted edits must first be saved or reloaded.
Workspace creation/update verifies asset references in the write transaction;
workspace deletion removes its owned assets in that transaction too. Legacy
migration and library transfer share a Web Lock across tabs. A browser without
Web Locks can transfer libraries but cannot migrate pending legacy drafts; the
recovery surface keeps export/upload available instead of racing their cleanup.

The existing single-Character ZIP remains a separate editable handoff. The new
**Download PNG** action instead paints the visible workshop composition once to
its transparent rig canvas, using the same layer resolver, transformations, and
painting path as composite previews. It excludes diagnostic guides and contains
no editable layers or atlas metadata.

`selected.props` is the persisted bottom-to-top addition order within each rig
slot. Selecting an active prop is a no-op. Removing and readding it moves it to
the top. Front/back rig planes still place props around the body. UI and the
`set_character_variant_selection` WebMCP tool share these commands; preview,
undo/redo, PNG, and pack export use the same order.

## Consequences

- Work in progress and complete reusable packs travel together without partial
  restore or silent conflict resolution.
- Local Collection membership stays independent of Character document history.
- Library imports are bounded, local operations; there is no cloud sync,
  marketplace, canon model, multi-Character scene editor, or Story activation.
- This is 2D mainline work. No 3D renderer, GLB delivery, Viking assets, or spike
  branch code is included.
