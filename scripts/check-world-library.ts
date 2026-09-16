import { createIndexedDbCharacterCollectionRepository } from '../src/adapters/indexeddb/character-collection-repository.ts'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { createWorldLibraryService, validateAlbumComposition } from '../src/core/application/world-library.ts'
import { locationAncestors, validateWorldLibrary, type LocationSetting } from '../src/core/domain/world-library.ts'
import { createStoryboardService } from '../src/core/application/storyboard.ts'
import { exportLibraryArchive, importLibraryArchive } from '../src/core/application/library-archive.ts'
import { compileAuthoringBackbone } from '../src/core/mantle/backbone.ts'

const original = globalThis.createImageBitmap
globalThis.createImageBitmap = (async () => ({ width: 1, height: 1, close() {} })) as typeof createImageBitmap
const service = createWorldLibraryService(), boards = createStoryboardService()
try {
  assert.ok(compileAuthoringBackbone().schemas['world-library'])
  const composedLocation = { id: 'field', parentId: null, collectionId: 'default', name: 'Field', description: '', consistency: '', updatedAt: 1, tags: [], images: [], conditions: [{ id: 'rain', name: 'Rain', description: '', updatedAt: 1, images: [] }] }
  assert.match(validateAlbumComposition({ characterSources: [{ characterId: 'hero', revision: 2, sha256: 'a'.repeat(64) }], sourceLocationId: 'field', sourceConditionId: 'rain', prompt: 'Hero repairs the Field in Rain' }, [{ id: 'hero', name: 'Hero', revision: 2, sha256: 'a'.repeat(64) }], [composedLocation]), /Hero.*Field.*Rain/)
  assert.doesNotThrow(() => validateAlbumComposition({ characterSources: [{ characterId: 'hero-real', revision: 1, sha256: 'b'.repeat(64) }], prompt: 'Hero｜Real crosses an unknown bridge' }, [{ id: 'hero', name: 'Hero', revision: 2, sha256: '' }, { id: 'hero-real', name: 'Hero｜Real', revision: 1, sha256: 'b'.repeat(64) }], [composedLocation]))
  assert.match(validateAlbumComposition({ prompt: 'An undefined traveler crosses an unknown bridge' }, [{ id: 'hero', name: 'Hero', revision: 2, sha256: '' }], [composedLocation]), /undefined traveler/)
  assert.throws(() => validateAlbumComposition({ prompt: 'Hero repairs an unknown bridge' }, [{ id: 'hero', name: 'Hero', revision: 2, sha256: '' }], [composedLocation]), /requires a Character reference/)
  assert.throws(() => validateAlbumComposition({ characterSources: [{ characterId: 'hero', revision: 1, sha256: 'a'.repeat(64) }], prompt: 'Hero repairs a bridge' }, [{ id: 'hero', name: 'Hero', revision: 2, sha256: 'a'.repeat(64) }], [composedLocation]), /changed/)
  let library = await service.load()
  const legacyLibrary = structuredClone(library) as Record<string, unknown>
  delete legacyLibrary.storyBooks; delete legacyLibrary.boardBooks
  const migrated = validateWorldLibrary({ ...legacyLibrary, folders: [{ id: 'legacy', name: 'Legacy book', description: '', synopsis: '', direction: '', collectionIds: [], updatedAt: 0 }], boardFolders: { board: 'legacy' } })
  assert.equal(migrated.boardBooks.board, 'legacy', 'Legacy folder metadata migrates once at the schema boundary')
  const location = (id: string, parentId: string | null): LocationSetting => ({ id, parentId, collectionId: 'default', name: id, description: '', consistency: '', updatedAt: 1, tags: [], images: [], conditions: [] })
  library.locations = [location('city', null), location('house', 'city'), location('room', 'house')]
  library = await service.save(library)
  await assert.rejects(service.update({ resource: 'location', action: 'move' } as never, library.revision), /Unsupported location action/)
  await assert.rejects(service.update({ resource: 'reference', action: 'update' } as never, library.revision), /Unsupported reference action/)
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
  library = (await service.update({ resource: 'photo', action: 'move', id: photo.id, albumId: 'default' }, library.revision)).library
  assert.equal(library.photos[0].albumId, 'default')
  await assert.rejects(service.update({ resource: 'photo', action: 'move', id: photo.id, albumId: 'missing' }, library.revision), /Album not found/)
  library = (await service.update({ resource: 'photo', action: 'move', id: photo.id, albumId: 'reference' }, library.revision)).library
  const photoCount = library.photos.length
  const direct = await service.uploadSetting(library, 'room', file, 'Room design', 'design', undefined, 'Direct setting asset')
  library = direct.library
  assert.equal(library.photos.length, photoCount, 'A direct Location image does not create an Album photo')
  assert.equal(library.locations[2].images.find((image) => image.id === direct.id)?.photoId, undefined)
  library.locations[2].images.push({ id: 'reference-image', photoId: photo.id, image: photo.image, label: 'Layout', purpose: 'design', source: 'Reference album' })
  library.locations[2].conditions.push({ id: 'night', name: 'Night', description: 'Warm light', updatedAt: 1, images: [] })
  library = await service.save(library)
  const duplicated = await service.update({ resource: 'location', action: 'duplicate', id: 'room' }, library.revision)
  library = duplicated.library
  const duplicatedRoom = library.locations.find((item) => item.id === duplicated.id)!
  assert.equal(duplicatedRoom.name, 'room copy')
  assert.notEqual(duplicatedRoom.images[0].id, library.locations.find((item) => item.id === 'room')!.images[0].id)
  assert.notEqual(duplicatedRoom.conditions[0].id, 'night')
  const copiedCondition = await service.update({ resource: 'condition', action: 'duplicate', locationId: duplicatedRoom.id, id: duplicatedRoom.conditions[0].id, name: 'Night copy' }, library.revision)
  library = copiedCondition.library
  assert.equal(library.locations.find((item) => item.id === duplicatedRoom.id)!.conditions.at(-1)?.name, 'Night copy')
  library.storyBooks.push({ id: 'episode', name: 'Episode one', description: '', synopsis: 'Return home', direction: 'Warm', collectionIds: ['default'], updatedAt: 1 })
  let board = await boards.update({ action: 'create', name: 'A story' })
  library.boardBooks[board.id] = 'episode'
  library = await service.save(library)
  assert.deepEqual(await service.load(), library)
  await assert.rejects(boards.update({ action: 'add-frame', boardId: board.id, expectedRevision: board.revision, title: 'Invalid photo' }, new Blob(['bad'], { type: 'image/png' })))
  assert.equal((await boards.get(board.id)).frames.length, 0, 'Invalid photo does not leave an empty frame')
  board = await boards.update({ action: 'add-frame', boardId: board.id, expectedRevision: board.revision, title: 'Room' }, file)
  board = await boards.update({ action: 'add-candidate', boardId: board.id, expectedRevision: board.revision, frameId: board.frames[0].id, filename: 'room.png', settings: [{ id: 'room-snapshot', kind: 'location', sourceId: 'room', revision: library.revision, name: 'Room', details: 'Direct setting' }] }, file)
  assert.equal(board.frames[0].settings?.[0].sourceId, 'room', 'Candidate stores its defined setting refs atomically')
  const setting = { id: 'pinned', kind: 'location', sourceId: 'room', revision: library.revision, name: 'Room at night', details: 'Warm light; same doorway' }
  board = await boards.update({ action: 'pin-setting', boardId: board.id, expectedRevision: board.revision, frameId: board.frames[0].id, setting, filename: 'room.png' }, file)
  assert.equal(board.frames[0].selected, null)
  assert.equal(board.frames[0].references.length, 1)
  library.photos = []; library.locations[2].conditions[0].description = 'Changed source'
  library = await service.save(library)
  assert.deepEqual((await boards.get(board.id)).frames[0].settings?.find(({ id }) => id === setting.id), setting)
  assert.equal((await service.image(photo.image.sha256)).size, file.size, 'Removing a photo preserves an adopted setting image')
  const restoredBoard = await boards.import(await boards.export(board.id, board.revision))
  assert.deepEqual(restoredBoard.frames[0].settings?.find(({ id }) => id === setting.id), setting)
  const archive = await service.export()
  library = await service.import(archive, library)
  assert.equal(library.locations.length, 8)
  const copy = library.locations.find((l) => l.name === 'room' && l.id !== 'room')!
  assert.equal(locationAncestors(library, copy.id).length, 3)
  assert.equal(copy.images[0].image.sha256, photo.image.sha256)
  assert.equal(copy.images[0].photoId, undefined, 'Direct Location images survive archive round-trip without Album linkage')
  await assert.rejects(service.upload(library, 'default', [new File(['invalid'], 'bad.png', { type: 'image/png' })]))
  const bad = structuredClone(library); bad.boardBooks.bad = 'missing'
  await assert.rejects(service.save(bad), /book not found/)
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
  const characterArchive = new Blob(['character archive']), emptyCharacters = { entries: [], assets: [], legacyDrafts: [] }
  const archiveServices = {
    exportCharacters: async () => characterArchive,
    prepareCharacters: async (blob: Blob) => { assert.equal(await blob.text(), await characterArchive.text()); return emptyCharacters },
    importCharacters: async (snapshot: typeof emptyCharacters) => assert.equal(snapshot, emptyCharacters),
    world: service,
    storyboards: boards,
  }
  const existingBoards = new Set((await boards.list()).map(({ id }) => id)), boardCount = existingBoards.size
  await importLibraryArchive(await exportLibraryArchive(archiveServices), archiveServices)
  const importedBoards = await boards.list(), importedLibrary = await service.load()
  assert.equal(importedBoards.length, boardCount * 2)
  assert.ok(importedBoards.filter(({ id }) => !existingBoards.has(id)).some((item) => importedLibrary.boardBooks[item.id]), 'Complete archive restores storyboard books')
  console.log('world-library: hierarchy, direct setting images, explicit Album references, CAS, storyboard snapshots and complete additive ZIP: ok')
} finally { globalThis.createImageBitmap = original; service.dispose(); boards.dispose() }
