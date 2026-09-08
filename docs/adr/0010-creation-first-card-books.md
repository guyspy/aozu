# ADR-0010: Creation-first collections and shared world context

- Status: Accepted
- Date: 2026-09-08
- Extends: ADR-0009

## Entry and navigation

An empty library opens the Character workshop immediately. Opening or reloading
`/characters/new/expressions` creates an in-memory draft at revision zero, not a
persisted empty Character. The first real command creates the Mantle workspace;
queued edits and history keep the pack identity while adopting Mantle’s permanent
entry ID. Existing commands, autosave failures, retries, conflicts and undo remain
in the same editor lifecycle.

Returning users open their last available collection, falling back to My characters.
`/collections` is the bookshelf and `/collections/:id` is a book’s card grid.
The Logo always links to `/`. The retired `/characters` entrance and `/start`
are no longer routes; unmatched URLs display 404 without changing the address. The five unmounted legacy start, starter, review, creation and Story UI
pages and the Story teaser are removed. Shared domain/runtime and archive formats
remain available to the existing Character and import/export paths.

## Collections

Every Character belongs to exactly one book. Explicit membership still belongs to
one custom Collection. My characters (`default`) contains the complement of those
memberships. New, copied, imported and formerly Uncollected Characters therefore
appear there without a second membership write or data migration. Deleting a
custom book returns its Characters to My characters atomically by removing the
book; deleting a Character still removes explicit memberships in its transaction.

The default book is implicit until its metadata is edited. Its stored Mantle entry
has an empty `characterIds` array; its displayed membership is derived. It cannot
be deleted or renamed in the application. An absent default profile has revision
zero, so concurrent first profile writes conflict rather than overwrite.

Collection metadata is `name` (1–100 characters), `description` (up to 500), and
`backstory` (up to 8,000). The authoring Mantle schema validates these fields, and
the shared `update-collection-profile` Procedure/Trigger serves the UI and WebMCP.
The IndexedDB semantic repository retains transaction-level membership and exact
revision checks. Whole-library backups carry metadata in the existing Collection
entries; old archives without the optional fields still work.

`backstory` is the shared setting, history and world rules for the book. Workspace
inspection and Character contracts expose it alongside the individual Character
profile, without duplicating it into or overwriting personal backstories. This
adds context for authoring; it does not start Story mode or introduce game rules.

## Progressive organization

The default book shows its cards and a create-character action immediately. Book
switching and creation live in the book-name menu; moving a Character lives in its
card menu. Book details and library transfer use the existing accessible Sheet.
The bookshelf, management forms and backup controls do not occupy the main card
browsing surface. At narrow widths cards remain in two columns. Opening a
collection deals the first nine cards through the original fan geometry, then
settles into the grid. Reduced-motion users see the grid immediately. Metadata
refreshes do not replay the entrance. User-facing naming is Collection / 角色集;
the book remains a visual treatment.

## Checks

`pnpm test` covers deferred creation, queued edits/history, Collection membership,
metadata validation, stale revisions and Mantle trigger validation.
`/scripts/check-card-books.html` runs the actual application against memory-only
IndexedDB and preferences: first visit/reload, save, book CRUD, shared world,
move, return navigation, last-book behavior and ZIP/restore. Add `?responsive`
to repeat that flow at 320, 390, 757 and 1280 CSS pixels.
