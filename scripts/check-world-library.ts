import { createIndexedDbCharacterCollectionRepository } from '../src/adapters/indexeddb/character-collection-repository.ts'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { createWorldLibraryService } from '../src/core/application/world-library.ts'
import { locationAncestors, validateWorldLibrary, type LocationSetting } from '../src/core/domain/world-library.ts'
import { createStoryboardService } from '../src/core/application/storyboard.ts'
import { compileAuthoringBackbone } from '../src/core/mantle/backbone.ts'

const original = globalThis.createImageBitmap
globalThis.createImageBitmap = (async () => ({ width: 1, height: 1, close() {} })) as typeof createImageBitmap
const service = createWorldLibraryService(), boards = createStoryboardService()
try {
  assert.ok(compileAuthoringBackbone().schemas['world-library'])
  let library = await service.load()
  const location = (id: string, parentId: string | null): LocationSetting => ({ id, parentId, collectionId: 'default', name: id, description: '', consistency: '', updatedAt: 1, tags: [], images: [], conditions: [] })
  library.locations = [location('city', null), location('house', 'city'), location('room', 'house')]
  library = await service.save(library)
  assert.deepEqual(locationAncestors(library, 'room').map((l) => l.id), ['city', 'house', 'room'])
  const invalid = structuredClone(library); invalid.locations[0].parentId = 'room'
  await assert.rejects(service.save(invalid), /ancestor/)
  invalid.locations[0].parentId = 'missing'; assert.throws(() => validateWorldLibrary(invalid), /not found/)
  invalid.locations[0].parentId = null; invalid.locations[1].collectionId = 'other'; assert.throws(() => validateWorldLibrary(invalid), /same setting/)
  const stale = structuredClone(library)
  library.albums.push({ id: 'reference', name: 'References', description: 'Finished work and inspiration', updatedAt: 1 })
  library = await service.save(library)
  await assert.rejects(service.save(stale), /changed elsewhere/)
  const file = new File([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=', 'base64'))], 'room.png', { type: 'image/png' })
  library = await service.upload(library, 'reference', [file])
  const photo = library.photos[0]
  library.locations[2].images.push({ id: 'reference-image', photoId: photo.id, image: photo.image, label: 'Layout', purpose: 'design', source: 'Reference album' })
  library.locations[2].conditions.push({ id: 'night', name: 'Night', description: 'Warm light', updatedAt: 1, images: [] })
  library.folders.push({ id: 'episode', name: 'Episode one', description: '', synopsis: 'Return home', direction: 'Warm', collectionIds: ['default'], updatedAt: 1 })
  let board = await boards.update({ action: 'create', name: 'A story' })
  library.boardFolders[board.id] = 'episode'
  library = await service.save(library)
  assert.deepEqual(await service.load(), library)
  await assert.rejects(boards.update({ action: 'add-frame', boardId: board.id, expectedRevision: board.revision, title: 'Invalid photo' }, new Blob(['bad'], { type: 'image/png' })))
  assert.equal((await boards.get(board.id)).frames.length, 0, 'Invalid photo does not leave an empty frame')
  board = await boards.update({ action: 'add-frame', boardId: board.id, expectedRevision: board.revision, title: 'Room' }, file)
  const setting = { id: 'pinned', kind: 'location', sourceId: 'room', revision: library.revision, name: 'Room at night', details: 'Warm light; same doorway' }
  board = await boards.update({ action: 'pin-setting', boardId: board.id, expectedRevision: board.revision, frameId: board.frames[0].id, setting, filename: 'room.png' }, file)
  assert.equal(board.frames[0].selected, null)
  assert.equal(board.frames[0].references.length, 1)
  library.photos = []; library.locations[2].conditions[0].description = 'Changed source'
  library = await service.save(library)
  assert.deepEqual((await boards.get(board.id)).frames[0].settings?.[0], setting)
  assert.equal((await service.image(photo.image.sha256)).size, file.size, 'Removing a photo preserves an adopted setting image')
  const restoredBoard = await boards.import(await boards.export(board.id, board.revision))
  assert.deepEqual(restoredBoard.frames[0].settings?.[0], setting)
  const archive = await service.export()
  library = await service.import(archive, library)
  assert.equal(library.locations.length, 6)
  const copy = library.locations.find((l) => l.name === 'room' && l.id !== 'room')!
  assert.equal(locationAncestors(library, copy.id).length, 3)
  assert.equal(copy.images[0].image.sha256, photo.image.sha256)
  await assert.rejects(service.upload(library, 'default', [new File(['invalid'], 'bad.png', { type: 'image/png' })]))
  const bad = structuredClone(library); bad.boardFolders.bad = 'missing'
  await assert.rejects(service.save(bad), /folder not found/)
  assert.deepEqual(await service.load(), library, 'Rejected saves are atomic')
  const collections = createIndexedDbCharacterCollectionRepository(), collection = await collections.create('Temporary world')
  library.locations.push({ ...location('orphan', null), collectionId: collection.id })
  library = await service.save(library)
  const beforeDelete = structuredClone(library)
  await collections.delete(collection.id, collection.version)
  library = await service.load()
  assert.equal(library.locations.find((l) => l.id === 'orphan')?.collectionId, 'default')
  await assert.rejects(service.save(beforeDelete), /changed elsewhere/)
  const forged = structuredClone(library); forged.locations[2].images[0].image.width = 99
  await assert.rejects(service.save(forged), /descriptor|metadata/)
  library.locations = library.locations.map((l) => ({ ...l, images: [], conditions: l.conditions.map((c) => ({ ...c, images: [] })) }))
  library = await service.save(library)
  await assert.rejects(service.image(photo.image.sha256), /missing/, 'Unreferenced originals are reclaimed')
  assert.equal((await boards.image(board.images[0].id)).size, file.size, 'Board copies survive source cleanup')
  console.log('world-library: hierarchy, cycles, CAS, albums, immutable image references, storyboard snapshots and additive ZIP: ok')
} finally { globalThis.createImageBitmap = original; service.dispose(); boards.dispose() }
