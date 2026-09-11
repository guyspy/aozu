# Home and the visual library

## Decision

Home (`/`) links to setting collections, albums and storyboards, with creation shortcuts and recently updated work. Opening the application no longer redirects to a character workshop. The logo always returns home. The existing default collection ID and all character URLs remain stable; its displayed name is now My settings.

Routes:
- `/collections` → `/collections/:collectionId` (characters)
- `/collections/:collectionId/locations` → `/:locationId`
- `/albums` → `/albums/:albumId` → `/photos/:photoId`
- `/storyboards` → `/storyboards/folders/:folderId` (one level; `unfiled` is virtual)
- `/storyboards/:boardId` remains the board editor, regardless of its folder.

Locations belong to one setting collection and optionally one parent location. No mandatory country/city/building taxonomy or required depth. Parents must be in the same collection and cycles are rejected. Moving a location to another collection moves its descendants. Deleting a location reparents its children; removing a setting collection rehomes its locations to default in the same database transaction. Character-library replacement also reconciles remaining location and folder links.

Each location has its own description, consistency notes, tags, labeled images and optional named conditions. Ancestors provide geographic/world context; local descriptions and chosen conditions take precedence. Setting images explicitly distinguish inspiration from adopted design. Albums hold both finished images and reference material, without a mandatory type distinction.

Storyboard folders hold description, synopsis, creative direction and setting-collection references. Folder removal leaves boards unfiled. Moving a board changes its folder assignment, not its content or URL. Scene/character/photo references in a frame are explicit snapshots; reference PNGs are copied into the board's existing immutable image store. Subsequent source edits/deletion do not replace or approve shots. Adding an album photo and its new unselected frame is one transaction.

## Storage and portability

Reuse the existing Mantle Entry/Asset stores and a compiled `world-library` schema, in the separate `aozu-world-library` namespace. No new database stores or dependencies. A compare-and-swap revision protects one metadata document across tabs; this deliberately bounds the first version to 4 MiB metadata and 256 MiB referenced images. Split records only when concurrent library edits become common. Images are content-addressed PNG/JPEG/WebP, at most 5 MiB / 4096×4096; conversion to a board PNG goes through its existing validator.

World-library ZIP exports albums, locations (including hierarchy/conditions/reference images) and folder metadata. Import is additive with new IDs: locations go to default, collection links and local board assignments are not restored into an unrelated workspace. The UI explains this before import. Existing character-library and storyboard ZIP workflows remain separate. Board ZIP carries pinned setting snapshots and original referenced PNGs, including references in undo history.

## Checks

`pnpm test` includes `scripts/check-world-library.ts` for hierarchy validation, revision conflicts, immutable references, deletion/rehome, image descriptor validation and ZIP round trips. `scripts/check-world-library.html?responsive=1` runs the UI flow with memory-only IndexedDB at 320, 757 and 1440px. It covers home, collection navigation, child locations, conditions, album references, album-to-board, setting pinning, folders and logo/parent navigation.
