import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import type { MantleRuntime } from '@aotter/mantle-runtime'

import { createIndexedDbAssetRepository } from '../src/adapters/indexeddb/asset-repository.ts'
import { createIndexedDbCharacterLibraryRepository } from '../src/adapters/indexeddb/character-library-repository.ts'
import { createCharacterWorkspaceRepository } from '../src/adapters/indexeddb/character-workspace-repository.ts'
import { ASSET_STORE, ENTRY_STORE, openCompanionDatabase } from '../src/adapters/indexeddb/database.ts'
import { createIndexedDbEntryRepository } from '../src/adapters/indexeddb/mantle-storage.ts'
import { AUTHORING_NAMESPACE } from '../src/core/application/authoring.ts'
import { createCharacterDraft } from '../src/core/application/character-creation.ts'
import { characterLibraryDigest, type CharacterLibrarySnapshot } from '../src/core/application/character-library.ts'
import { characterAssetScope, type CharacterAssetInspection, type CharacterDraft } from '../src/core/domain/character.ts'

const barrier = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
const inspect = async (blob: Blob): Promise<CharacterAssetInspection> => ({
  width: 512, height: 768, genuineRgba: true, hasVisiblePixels: true, hasTransparentPixels: true,
  visibleBounds: { x: 1, y: 1, width: 2, height: 2 }, size: blob.size, sha256: await characterLibraryDigest(blob),
})
const header = new Uint8Array(33)
header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
new DataView(header.buffer).setUint32(16, 512)
new DataView(header.buffer).setUint32(20, 768)
header[24] = 8; header[25] = 6
const blob = new Blob([header, 'concurrency-fixture'], { type: 'image/png' })
const inspection = await inspect(blob)
const draft = { ...createCharacterDraft('concurrency-pack', 'concurrency-character'), updatedAt: 1 }
draft.variants[0]!.layers.body = { blob, inspection, source: 'user', filename: 'body.png' }
const dataFrom = ({ id: _id, updatedAt: _updatedAt, variants, ...data }: CharacterDraft) => ({
  ...data,
  variants: variants.map(({ layers, ...variant }) => ({
    ...variant,
    layers: Object.fromEntries(Object.entries(layers).map(([layer, asset]) => {
      const { blob: _blob, ...descriptor } = asset!
      return [layer, { ...descriptor, blobId: asset!.inspection.sha256 }]
    })),
  })),
})
const snapshot: CharacterLibrarySnapshot = {
  entries: [{
    bundleId: AUTHORING_NAMESPACE, id: draft.id, collection: 'character-workspaces', status: 'published',
    version: 1, data: dataFrom(draft), createdAt: 1, updatedAt: 1, authorId: null,
  }],
  assets: [{ bundleId: characterAssetScope(draft.packId), id: inspection.sha256, blob }],
  legacyDrafts: [],
}
const empty = { entries: [], assets: [], legacyDrafts: [] }
const database = await openCompanionDatabase()
const library = createIndexedDbCharacterLibraryRepository({ inspect })
const entries = createIndexedDbEntryRepository(AUTHORING_NAMESPACE)
await library.restore(snapshot, 'replace')

// Delay the procedure response after deletion commits, then restore before the caller resumes.
const deleted = barrier()
const finishDelete = barrier()
const runtime = {
  entries,
  async invokeProcedure({ input }: { input: { id: string } }) {
    const current = await entries.get(input.id)
    await entries.delete({ id: input.id, collection: 'character-workspaces', expectedVersion: current!.version, expectedStatus: 'published' })
    deleted.release()
    await finishDelete.promise
    return { ok: true, data: { removed: true } }
  },
} as unknown as MantleRuntime
const workspaces = createCharacterWorkspaceRepository(async () => runtime, createIndexedDbAssetRepository)
const deletion = workspaces.delete(draft.id)
await deleted.promise
assert.equal(await database.get(ASSET_STORE, [characterAssetScope(draft.packId), inspection.sha256]), undefined)
await library.restore(snapshot, 'replace')
finishDelete.release()
await deletion
assert.equal((await workspaces.get(draft.id))?.character.variants[0]!.layers.body!.blob.size, blob.size,
  'a delayed delete response must not remove assets recreated by a later restore')

// Replace after asset staging but before create: refuse the dangling workspace, preserving the replaced library.
await library.restore(empty, 'replace')
const staged = barrier()
const finishCreate = barrier()
const createRuntime = {
  entries,
  async invokeProcedure({ input }: { input: Record<string, unknown> }) {
    staged.release()
    await finishCreate.promise
    return { ok: true, data: await entries.create({
      id: draft.id, collection: 'character-workspaces', status: 'published', data: input, authorId: null, now: 1,
    }) }
  },
} as unknown as MantleRuntime
const creating = createCharacterWorkspaceRepository(async () => createRuntime, createIndexedDbAssetRepository).create(draft)
await staged.promise
await library.restore(empty, 'replace')
finishCreate.release()
await assert.rejects(creating, /assets changed during save/)
assert.equal(await entries.get(draft.id), null)

// Parallel creates cannot mint two Characters sharing one asset scope; missing assets also block updates.
await database.put(ASSET_STORE, snapshot.assets[0]!)
const creates = await Promise.allSettled(['concurrent-a', 'concurrent-b'].map((id) => entries.create({
  id, collection: 'character-workspaces', status: 'published', data: dataFrom(draft), authorId: null, now: 1,
})))
assert.equal(creates.filter(({ status }) => status === 'fulfilled').length, 1)
const failure = creates.find((result) => result.status === 'rejected')
assert.match(String(failure?.reason), /pack ID is already used/)
const created = (await entries.readPublished({ collection: 'character-workspaces' }))[0]!
await database.delete(ASSET_STORE, [characterAssetScope(draft.packId), inspection.sha256])
await assert.rejects(entries.update({
  id: created.id, collection: created.collection, expectedVersion: created.version, data: { ...created.data, name: 'Dangling' }, now: 2,
}), /assets changed during save/)
assert.equal((await database.get(ENTRY_STORE, [AUTHORING_NAMESPACE, created.id]))!.data.name, draft.name)
await library.restore(empty, 'replace')
console.log('character library concurrency: atomic deletion, staged-create replacement, pack uniqueness, and missing-asset update checks passed')
