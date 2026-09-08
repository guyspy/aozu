import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { AUTHORING_NAMESPACE } from '../src/core/application/authoring.ts'
import { buildCharacterPack, createCharacterDraft } from '../src/core/application/character-creation.ts'
import {
  CHARACTER_LIBRARY_PACK_NAMESPACE, CHARACTER_LIBRARY_REVISION_FLOOR, characterLibraryDigest,
  characterLibraryJson, validateCharacterLibrarySnapshot, type CharacterLibrarySnapshot,
} from '../src/core/application/character-library.ts'
import { characterAssetScope, type CharacterAssetInspection, type CharacterDraft, type CharacterDraftAsset } from '../src/core/domain/character.ts'
import { exportCharacterLibraryZip, readCharacterLibraryZip } from '../src/adapters/zip/character-library.ts'
import { createIndexedDbCharacterLibraryRepository } from '../src/adapters/indexeddb/character-library-repository.ts'
import { ASSET_STORE, CHARACTER_DRAFT_STORE, ENTRY_STORE, META_STORE, openCompanionDatabase } from '../src/adapters/indexeddb/database.ts'
import { createIndexedDbEntryRepository } from '../src/adapters/indexeddb/mantle-storage.ts'

const inspect = async (blob: Blob): Promise<CharacterAssetInspection> => ({
  width: 512, height: 768, genuineRgba: true, hasVisiblePixels: true, hasTransparentPixels: true,
  visibleBounds: { x: 100, y: 100, width: 20, height: 20 }, size: blob.size, sha256: await characterLibraryDigest(blob),
})
// The injected decoder isolates persistence/ZIP checks. Browser smoke separately decodes real PNG fixtures.
const pngHeader = new Uint8Array(33)
pngHeader.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
new DataView(pngHeader.buffer).setUint32(16, 512)
new DataView(pngHeader.buffer).setUint32(20, 768)
pngHeader[24] = 8
pngHeader[25] = 6
const art = new Blob([pngHeader, 'fixture-art-one'], { type: 'image/png' })
const inspection = await inspect(art)
const asset: CharacterDraftAsset = { blob: art, filename: 'body.png', source: 'user', inspection }
const draft = { ...createCharacterDraft('archive-test', 'archive-workspace'), updatedAt: 100 }
draft.variants[0].layers.body = asset
const dataFrom = ({ id: _id, updatedAt: _time, variants, ...data }: CharacterDraft) => ({
  ...data, variants: variants.map(({ layers, ...variant }) => ({ ...variant, layers: Object.fromEntries(Object.entries(layers).map(([layer, asset]) => {
    const { blob: _blob, ...descriptor } = asset!
    return [layer, { ...descriptor, blobId: descriptor.inspection.sha256 }]
  })) })),
})
const entry = {
  bundleId: AUTHORING_NAMESPACE, id: draft.id, collection: 'character-workspaces', status: 'published' as const,
  version: 4, data: dataFrom(draft), createdAt: 100, updatedAt: 100, authorId: null,
}
const legacy = { ...structuredClone(draft), id: 'archive-legacy', packId: 'archive-legacy' }
const pack = buildCharacterPack(draft)
const packKey = `${pack.id}@${pack.version}`
const snapshot: CharacterLibrarySnapshot = {
  entries: [entry, {
    ...entry, id: 'archive-collection', collection: 'character-collections', data: { name: 'A'.repeat(100), characterIds: [draft.id] },
  }, {
    ...entry, bundleId: CHARACTER_LIBRARY_PACK_NAMESPACE, id: packKey, collection: 'character-packs',
    data: { name: 'Installed art', pack, composition: pack.defaultComposition },
  }],
  assets: [
    { bundleId: characterAssetScope(draft.packId), id: inspection.sha256, blob: art },
    { bundleId: CHARACTER_LIBRARY_PACK_NAMESPACE, id: `${packKey}:${pack.assets[0].blobId}`, blob: art },
  ],
  legacyDrafts: [legacy],
}
const zip = await exportCharacterLibraryZip(snapshot, inspect)
const restored = await readCharacterLibraryZip(zip, inspect)
assert.equal(characterLibraryJson(restored), characterLibraryJson(snapshot))
assert.equal(await characterLibraryDigest(restored.legacyDrafts[0].variants[0].layers.body!.blob), inspection.sha256)
assert.equal(await characterLibraryDigest(restored.assets[1].blob), inspection.sha256)

const zipBlob = (files: Record<string, Uint8Array>) => new Blob([zipSync(files)], { type: 'application/zip' })
const filesFrom = async () => unzipSync(new Uint8Array(await zip.arrayBuffer()))
const mutateManifest = async (mutate: (manifest: any) => void) => {
  const files = await filesFrom()
  const manifest = JSON.parse(strFromU8(files['library.json']))
  mutate(manifest)
  files['library.json'] = strToU8(JSON.stringify(manifest))
  const integrity = JSON.parse(strFromU8(files['integrity.json']))
  const descriptor = integrity.files.find((item: { path: string }) => item.path === 'library.json')
  descriptor.byteLength = files['library.json'].byteLength
  descriptor.sha256 = await characterLibraryDigest(new Blob([files['library.json']]))
  files['integrity.json'] = strToU8(JSON.stringify(integrity))
  return zipBlob(files)
}
const wrongBytes = await filesFrom()
wrongBytes['assets/0.png'][0] ^= 1
await assert.rejects(readCharacterLibraryZip(zipBlob(wrongBytes), inspect), /integrity mismatch/)
const wrongDigest = await filesFrom()
const digestManifest = JSON.parse(strFromU8(wrongDigest['integrity.json']))
digestManifest.files[0].sha256 = '0'.repeat(64)
wrongDigest['integrity.json'] = strToU8(JSON.stringify(digestManifest))
await assert.rejects(readCharacterLibraryZip(zipBlob(wrongDigest), inspect), /integrity mismatch/)
await assert.rejects(readCharacterLibraryZip(zipBlob({ ...await filesFrom(), '../escape.png': strToU8('bad') }), inspect), /Unsafe ZIP/)
await assert.rejects(readCharacterLibraryZip(zipBlob({ ...await filesFrom(), 'surprise.txt': strToU8('bad') }), inspect), /Unsafe ZIP/)
await assert.rejects(readCharacterLibraryZip(new Blob([new Uint8Array(await zip.arrayBuffer()).slice(0, -1)]), inspect), /ZIP directory/)
await assert.rejects(readCharacterLibraryZip(await mutateManifest((value) => value.entries.push(value.entries[0])), inspect), /duplicate entry ID/)
await assert.rejects(readCharacterLibraryZip(await mutateManifest((value) => value.assets.push(value.assets[0])), inspect), /duplicate.*asset path/)
await assert.rejects(readCharacterLibraryZip(await mutateManifest((value) => value.entries[0].data.selected.props = ['missing']), inspect), /prop selection/)
await assert.rejects(readCharacterLibraryZip(await mutateManifest((value) => value.entries[0].data.selected.props = ['prop-1', 'prop-1']), inspect), /schema|prop selection/)
await assert.rejects(readCharacterLibraryZip(await mutateManifest((value) => value.entries[0].data.surprise = true), inspect), /schema/)
await assert.rejects(readCharacterLibraryZip(await mutateManifest((value) => value.entries[1].data.characterIds = ['missing']), inspect), /Collection Character reference/)
await assert.rejects(readCharacterLibraryZip(await mutateManifest((value) => value.entries.push({ ...value.entries[1], id: 'second-collection' })), inspect), /duplicate.*Collection Character reference/)
await assert.rejects(readCharacterLibraryZip(await mutateManifest((value) => value.entries[0].data.variants[0].layers.body.inspection.sha256 = '0'.repeat(64)), inspect), /inconsistent Character asset/)
await assert.rejects(readCharacterLibraryZip(zip, async (blob) => ({ ...await inspect(blob), width: 1024 })), /512|dimensions|canvas/i)
let decodes = 0
const hugeHeader = pngHeader.slice()
new DataView(hugeHeader.buffer).setUint32(16, 100_000)
const hugeImage = new Blob([hugeHeader, 'fixture-art-one'], { type: 'image/png' })
const oversized = structuredClone(snapshot)
oversized.assets[0].blob = hugeImage
await assert.rejects(exportCharacterLibraryZip(oversized, async (blob) => { decodes++; return inspect(blob) }), /PNG header or canvas dimensions/)
assert.equal(decodes, 0)
const invalidInstalled = structuredClone(snapshot)
;(invalidInstalled.entries[2].data.pack as typeof pack).assets[0].sha256 = '0'.repeat(64)
await assert.rejects(exportCharacterLibraryZip(invalidInstalled, inspect), /Invalid character asset/)

// A duplicated ZIP name must be rejected before fflate can collapse it into a single object property.
const duplicateZip = new Uint8Array(await zip.arrayBuffer())
const needle = strToU8('assets/1.png')
for (let index = 0; index <= duplicateZip.length - needle.length; index++) {
  if (needle.every((byte, offset) => duplicateZip[index + offset] === byte)) duplicateZip[index + 7] = '0'.charCodeAt(0)
}
await assert.rejects(readCharacterLibraryZip(new Blob([duplicateZip]), inspect), /Unsafe ZIP entry/)
const brokenLocal = new Uint8Array(await zip.arrayBuffer())
brokenLocal[8] = 99
await assert.rejects(readCharacterLibraryZip(new Blob([brokenLocal]), inspect), /local header mismatch/)
const payloadCorrupt = new Uint8Array(await zip.arrayBuffer())
payloadCorrupt[30 + new DataView(payloadCorrupt.buffer).getUint16(26, true)] ^= 1
await assert.rejects(readCharacterLibraryZip(new Blob([payloadCorrupt]), inspect), /ZIP checksum mismatch/)
const enormous = new Uint8Array(await zip.arrayBuffer())
const view = new DataView(enormous.buffer)
for (let index = 0; index < enormous.length - 46; index++) {
  if (view.getUint32(index, true) === 0x02014b50) { view.setUint32(index + 24, 300 * 1024 * 1024, true); break }
}
await assert.rejects(readCharacterLibraryZip(new Blob([enormous]), inspect), /Unsafe ZIP entry/)

// Real IndexedDB transactions: preserve unrelated data, merge idempotently, abort every write on failure.
const database = await openCompanionDatabase()
const repository = createIndexedDbCharacterLibraryRepository({ inspect })
const foreign = { ...entry, bundleId: 'active-experience', id: 'untouched', collection: 'runs', data: { sentinel: true } }
await database.put(ENTRY_STORE, foreign)
await database.put(ASSET_STORE, { bundleId: 'active-experience', id: 'art', blob: art })
await database.put(META_STORE, 'active-experience', 'activeBundleId')
await repository.restore(snapshot, 'replace')
let current = await repository.snapshot()
assert.equal(current.entries.length, snapshot.entries.length)
assert.equal(current.legacyDrafts.length, 1)
const initialVersion = current.entries.find(({ id }) => id === draft.id)!.version
assert.ok(initialVersion > entry.version)
await repository.restore(snapshot, 'merge')
assert.equal((await repository.snapshot()).entries.find(({ id }) => id === draft.id)!.version, initialVersion)
const another = { ...createCharacterDraft('another-pack', 'another-character'), updatedAt: 100 }
await repository.restore({ entries: [{ ...entry, id: another.id, data: dataFrom(another) }], assets: [], legacyDrafts: [] }, 'merge')
assert.equal((await repository.snapshot()).entries.filter(({ collection }) => collection === 'character-workspaces').length, 2)
const beforeConflict = characterLibraryJson(await repository.snapshot())
const conflict = structuredClone(snapshot)
conflict.entries[0].data.name = 'Divergent Character'
await assert.rejects(repository.restore(conflict, 'merge'), /merge conflict/)
assert.equal(characterLibraryJson(await repository.snapshot()), beforeConflict)
const forged = structuredClone(snapshot)
forged.assets[0].blob = new Blob([pngHeader, 'different-art!!'], { type: 'image/png' })
await assert.rejects(repository.restore(forged, 'replace'), /digest|inconsistent/)
assert.equal(characterLibraryJson(await repository.snapshot()), beforeConflict)

// Replace never overwrites an unrelated entry with a colliding key in the shared authoring namespace.
const collision = { ...entry, id: 'foreign-collision', collection: 'experience-drafts', data: { sentinel: true } }
await database.put(ENTRY_STORE, collision)
await assert.rejects(repository.restore({ entries: [{ ...entry, id: collision.id }], assets: snapshot.assets, legacyDrafts: [] }, 'replace'), /unrelated local data/)
assert.deepEqual(await database.get(ENTRY_STORE, [AUTHORING_NAMESPACE, collision.id]), collision)

// Simulate an actual storage failure after entries have been written; IDB must roll everything back.
const put = IDBObjectStore.prototype.put
IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
  if (this.name === ASSET_STORE) throw new DOMException('Fixture quota failure', 'QuotaExceededError')
  return put.apply(this, args)
}
try { await assert.rejects(repository.restore(snapshot, 'replace'), /Fixture quota failure/) }
finally { IDBObjectStore.prototype.put = put }
assert.equal(characterLibraryJson(await repository.snapshot()), beforeConflict)

// Pause the asynchronous merge hash while a second writer tries to replace the same asset.
// That writer must wait for the import's transaction lock, including the time spent hashing Blob bytes.
const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
let releaseHash!: () => void
let hashEntered!: () => void
const hashGate = new Promise<void>((resolve) => { releaseHash = resolve })
const entered = new Promise<void>((resolve) => { hashEntered = resolve })
let paused = false
crypto.subtle.digest = async (...args: Parameters<SubtleCrypto['digest']>) => {
  if (!paused) { paused = true; hashEntered(); await hashGate }
  return originalDigest(...args)
}
const lockingRepository = createIndexedDbCharacterLibraryRepository({ inspect: async (blob) => ({
  ...inspection, size: blob.size,
  sha256: Array.from(new Uint8Array(await originalDigest('SHA-256', await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join(''),
}) })
try {
  const importing = lockingRepository.restore({ entries: [entry], assets: [snapshot.assets[0]], legacyDrafts: [] }, 'merge')
  await entered
  let writerFinished = false
  const racingBlob = new Blob([pngHeader, 'racing-art-one!'], { type: 'image/png' })
  const racingWriter = database.put(ASSET_STORE, { ...snapshot.assets[0], blob: racingBlob }).then(() => { writerFinished = true })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(writerFinished, false)
  releaseHash()
  await importing
  await racingWriter
  assert.equal(await (await database.get(ASSET_STORE, [snapshot.assets[0].bundleId, snapshot.assets[0].id]))!.blob.text(), await racingBlob.text())
} finally {
  releaseHash()
  crypto.subtle.digest = originalDigest
}

// Replacing a library invalidates an old open editor, even when the archive carries its original version.
await repository.restore(snapshot, 'replace')
current = await repository.snapshot()
assert.ok(current.entries.find(({ id }) => id === draft.id)!.version > initialVersion)
const workspaceEntries = createIndexedDbEntryRepository(AUTHORING_NAMESPACE)
await assert.rejects(workspaceEntries.update({ id: draft.id, collection: 'character-workspaces', expectedVersion: initialVersion, data: entry.data, now: Date.now() }), /EntryVersionConflict/)
const saved = current.entries.find(({ id }) => id === draft.id)!
// A removed Character's last version remains a floor, avoiding an ABA match on restore.
await database.put(ENTRY_STORE, { ...saved, version: saved.version + 100_000 })
await workspaceEntries.delete({ id: draft.id, collection: 'character-workspaces', expectedVersion: saved.version + 100_000, expectedStatus: 'published' })
await repository.restore(snapshot, 'replace')
assert.ok((await database.get(ENTRY_STORE, [AUTHORING_NAMESPACE, draft.id]))!.version > saved.version + 100_000)
assert.ok(Number(await database.get(META_STORE, CHARACTER_LIBRARY_REVISION_FLOOR)) > saved.version + 100_000)

// Replace also recovers a missing old asset or malformed legacy draft, without trying to hydrate them.
await database.delete(ASSET_STORE, [characterAssetScope(draft.packId), inspection.sha256])
await database.put(CHARACTER_DRAFT_STORE, { id: 'broken-legacy' } as CharacterDraft)
await repository.restore(snapshot, 'replace')
validateCharacterLibrarySnapshot(await repository.snapshot())
assert.deepEqual(await database.get(ENTRY_STORE, [foreign.bundleId, foreign.id]), foreign)
assert.equal(await database.get(META_STORE, 'activeBundleId'), 'active-experience')
assert.equal((await database.get(ASSET_STORE, ['active-experience', 'art']))!.blob.size, art.size)

// Leave an empty Character library for the independent Collection repository fixture.
await repository.restore({ entries: [], assets: [], legacyDrafts: [] }, 'replace')
await database.delete(ENTRY_STORE, [foreign.bundleId, foreign.id])
await database.delete(ENTRY_STORE, [AUTHORING_NAMESPACE, collision.id])
await database.delete(ASSET_STORE, ['active-experience', 'art'])
await database.delete(META_STORE, 'activeBundleId')
console.log('character library: ZIP/digest/reference attacks, PNG allocation guard, full restore, merge conflicts/locking, IDB rollback, revision ABA, and recovery: ok')
