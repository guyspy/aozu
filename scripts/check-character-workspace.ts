import assert from 'node:assert/strict'
import type { Entry } from '@aotter/mantle-spec'
import type { MantleRuntime } from '@aotter/mantle-runtime'

import { createCharacterWorkspaceRepository } from '../src/adapters/indexeddb/character-workspace-repository.ts'
import { createCharacterDraft } from '../src/core/application/character-creation.ts'
import { CharacterRevisionConflict } from '../src/core/application/ports.ts'

let row: Entry | null = null
let now = 1
let writes = 0
let assetReads: string[] = []
const assets = new Map<string, Map<string, Blob>>()
const runtime = {
  entries: {
    async readPublished({ collection }: { collection?: string } = {}) { return row && (!collection || row.collection === collection) ? [row] : [] },
    async readById(id: string) { return row?.id === id ? row : null },
  },
  async invokeProcedure({ procedure, input }: { procedure: string; input: Record<string, unknown> }) {
    writes++
    if (procedure === 'create-character-workspace') {
      row = { id: 'workspace-1', collection: 'character-workspaces', status: 'published', version: 1, data: structuredClone(input), createdAt: now, updatedAt: now++ }
      return { ok: true as const, data: row }
    }
    if (procedure === 'update-character-workspace' && row) {
      const { id: _id, expectedVersion, ...data } = input
      if (expectedVersion !== row.version) return { ok: false as const, diagnostic: { code: 'CONFLICT', message: 'Version mismatch' } }
      row = { ...row, data: structuredClone(data), version: row.version + 1, updatedAt: now++ }
      return { ok: true as const, data: row }
    }
    if (row) assets.delete(`character:${String(row.data.packId)}`)
    row = null
    return { ok: true as const, data: { removed: true } }
  },
} as unknown as MantleRuntime
const repository = createCharacterWorkspaceRepository(
  async () => runtime,
  (scope) => ({
    async put(id, blob) { const scoped = assets.get(scope) ?? new Map(); scoped.set(id, blob); assets.set(scope, scoped) },
    async get(id) { assetReads.push(id); return assets.get(scope)?.get(id) ?? null },
    async list() { return [...(assets.get(scope) ?? [])].map(([id, blob]) => ({ id, blob })) },
    async deleteAll() { assets.delete(scope) },
  }),
)

const draft = createCharacterDraft('boar-pack', 'legacy-id')
draft.description = 'A steadfast trail guide.'
draft.backstory = 'First line.\n\nSecond line.'
draft.attributes = { courage: 8, nocturnal: true }
draft.variants.push({ group: 'prop', id: 'prop-2', label: 'Second prop', layers: {} })
draft.selected.props = ['prop-2', 'prop-1']
const blob = new Blob(['boar'], { type: 'image/png' })
draft.variants[0]!.layers.body = {
  blob,
  filename: 'boar.png',
  source: 'user',
  inspection: {
    width: 512, height: 768, hasTransparentPixels: true, hasVisiblePixels: true, genuineRgba: true,
    visibleBounds: { x: 1, y: 2, width: 500, height: 760 }, visiblePixelCount: 100, size: 4, sha256: 'a'.repeat(64),
  },
}
const created = await repository.create(draft)
assert.equal(created.character.id, 'workspace-1')
assert.equal(created.version, 1)
assert.equal(await created.character.variants[0]!.layers.body!.blob.text(), 'boar')
assert.equal(created.character.backstory, draft.backstory)
assert.deepEqual(created.character.attributes, draft.attributes)
assert.deepEqual(created.character.selected.props, ['prop-2', 'prop-1'])
assert.equal('blob' in ((row!.data.variants as Array<{ layers: { body: object } }>)[0]!.layers.body), false)
assert.equal((row!.data.variants as Array<{ layers: { body: { blobId: string } } }>)[0]!.layers.body.blobId, 'a'.repeat(64))
assert.equal('revision' in row!.data, false)

// Metadata refreshes must not touch PNGs; previews hydrate only selected, current layers.
const base = draft.variants[0]!.layers.body!
const happy = draft.variants.find((variant) => variant.id === 'happy')!
happy.layers.head = { ...base, canonicalSha256: base.inspection.sha256, inspection: { ...base.inspection, sha256: 'b'.repeat(64) } }
const sad = draft.variants.find((variant) => variant.id === 'sad')!
sad.layers.head = { ...base, canonicalSha256: base.inspection.sha256, inspection: { ...base.inspection, sha256: 'c'.repeat(64) } }
draft.selected.expression = 'happy'
await repository.put({ ...draft, id: created.character.id }, 1)
assetReads = []
const [summary] = await repository.listSummaries()
assert.deepEqual(assetReads, [])
const preview = await repository.getPreview(created.character.id)
assert.deepEqual(assetReads.sort(), ['a'.repeat(64), 'b'.repeat(64)])
assert.deepEqual(preview.map(({ id }) => id), ['body-base-body', 'expression-happy-head'])
const metadata = row!.data as unknown as import('../src/core/domain/character.ts').CharacterWorkspaceData
metadata.name = 'Renamed only'
assert.equal((await repository.listSummaries())[0]!.previewKey, summary!.previewKey)
metadata.variants.find((variant) => variant.id === 'happy')!.transform = { x: 10, y: 0, scale: 1 }
assert.notEqual((await repository.listSummaries())[0]!.previewKey, summary!.previewKey)
assetReads = []
await assert.rejects(repository.getPreview(created.character.id, summary!.previewKey), /preview changed/)
assert.deepEqual(assetReads, [], 'Stale thumbnail request read newer PNGs under an old cache key')
metadata.variants.find((variant) => variant.id === 'happy')!.layers.head!.canonicalSha256 = 'stale'
assetReads = []
assert.equal((await repository.getPreview(created.character.id)).length, 1)
assert.deepEqual(assetReads, ['a'.repeat(64)])
// An outfit still validates against canonical metadata without reading the hidden body PNG.
metadata.variants.push({ group: 'outfit', id: 'uniform', label: 'Uniform', layers: { body: {
  ...metadata.variants.find((variant) => variant.id === 'sad')!.layers.head!,
} } })
metadata.selected.outfit = 'uniform'
assetReads = []
assert.deepEqual((await repository.getPreview(created.character.id)).map(({ id }) => id), ['outfit-uniform-body'])
assert.deepEqual(assetReads, ['c'.repeat(64)])
// A stale outfit falls back to the body without ever reading the stale PNG.
metadata.variants.at(-1)!.layers.body!.canonicalSha256 = 'stale'
assetReads = []
assert.deepEqual((await repository.getPreview(created.character.id)).map(({ id }) => id), ['body-base-body'])
assert.deepEqual(assetReads, ['a'.repeat(64)])
// Restore the original fixture for the write/conflict checks below.
row!.version = 1
row!.data = structuredClone({ ...row!.data, name: draft.name })

// Legacy metadata stays stored until the next real save; hydration drops it without writing.
row!.data.revision = 4
row!.data.published = { version: 2, revision: 4 }
const writesBeforeRead = writes
const read = await repository.get('workspace-1')
assert.equal(read?.version, 1)
assert.deepEqual(read?.character.selected.props, ['prop-2', 'prop-1'])
assert.equal('revision' in read!.character, false)
assert.equal('published' in read!.character, false)
assert.equal(row!.data.revision, 4)
assert.equal(writes, writesBeforeRead)

// A write reports the revision and updatedAt of the same settled entry snapshot.
const saved = await repository.put({ ...created.character, name: 'Boar' }, created.version)
assert.deepEqual(saved, { version: 2, updatedAt: row!.updatedAt })
assert.equal(row!.data.name, 'Boar')
assert.equal(row!.data.description, draft.description)
assert.equal('revision' in row!.data, false)
assert.equal('published' in row!.data, false)
await assert.rejects(() => repository.put({ ...created.character, name: 'Stale' }, 1), CharacterRevisionConflict)
assert.equal(row!.data.name, 'Boar')
await repository.delete('workspace-1')
assert.equal(await repository.get('workspace-1'), null)
assert.equal(assets.size, 0)

console.log('character workspace: ok')
