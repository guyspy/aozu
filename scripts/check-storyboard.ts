import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { unzipSync, zipSync } from 'fflate'
import { createStoryboardService } from '../src/core/application/storyboard.ts'
import { parseBoardCommand } from '../src/core/domain/storyboard.ts'

// Real PNG decoding is checked in the browser; this isolates transactional and archive behavior.
const originalDecoder = globalThis.createImageBitmap
globalThis.createImageBitmap = (async () => ({ width: 1, height: 1, close() {} })) as typeof createImageBitmap
const service = createStoryboardService()
try {
  const png = new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=', 'base64'))], { type: 'image/png' })
  let board = await service.update({ action: 'create', name: 'Cross collection test' })
  const change = async (command: Record<string, unknown>, image?: Blob) => board = await service.update({ boardId: board.id, expectedRevision: board.revision, ...command }, image)
  await change({ action: 'add-frame', title: 'Catch' }); const first = board.frames[0].id
  await change({ action: 'add-candidate', frameId: first, filename: 'standard.png', source: 'Collection A / Yanyue' }, png)
  assert.equal(board.frames[0].selected, null, 'upload never implies selection')
  const standard = board.images[0].id
  await change({ action: 'select', frameId: first, imageId: standard })
  await change({ action: 'edit-frame', frameId: first, review: 'confirmed' })
  await change({ action: 'add-candidate', frameId: first, source: 'External image' }, png)
  const alternate = board.images[1].id
  assert.equal(board.frames[0].selected, standard)
  assert.equal(board.frames[0].review, 'confirmed', 'candidate does not invalidate approved selection')
  await change({ action: 'add-frame', title: 'Lift' }); const second = board.frames[1].id
  await change({ action: 'add-candidate', frameId: second, source: 'Collection B / Lizi' }, png)
  await change({ action: 'reference', frameId: second, imageId: standard, purpose: 'Leg length and relative height' })
  await change({ action: 'select', frameId: first, imageId: alternate })
  assert.equal(board.frames[0].review, 'draft', 'changing selection invalidates approval')
  assert.equal(board.frames[1].references[0].imageId, standard)
  assert.equal((await service.inspect(board.id)).referenceChanges?.length, 1)
  await assert.rejects(change({ action: 'select', frameId: second, imageId: standard }), /candidate/)
  const stale = board.revision
  await change({ action: 'edit-frame', frameId: first, transition: 'Dive and track behind', duration: 3 })
  await assert.rejects(service.update({ action: 'rename', boardId: board.id, expectedRevision: stale, name: 'Lost update' }), /changed elsewhere/)
  await assert.rejects(change({ action: 'reorder', order: [first, first] }))
  await change({ action: 'reorder', order: [second, first] })
  await change({ action: 'undo' }); assert.equal(board.frames[0].id, first)
  await change({ action: 'redo' }); assert.equal(board.frames[0].id, second)
  await change({ action: 'remove-frame', frameId: first })
  assert.equal(board.frames[0].references[0].imageId, standard, 'removing source frame preserves pinned asset')
  await change({ action: 'undo' })
  assert.deepEqual(await service.get(board.id), board, 'reload preserves board')
  await assert.rejects(service.export(board.id, stale), /changed/)
  const archive = await service.export(board.id, board.revision)
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()))
  assert.ok(files['selected/002.png'])
  assert.ok(files['overview.html'])
  const restored = await service.import(archive)
  assert.notEqual(restored.id, board.id)
  assert.notEqual(restored.images[0].id, board.images[0].id, 'reimport cannot overwrite existing assets')
  assert.deepEqual(restored.images.map((i) => i.sha256), board.images.map((i) => i.sha256))
  assert.equal(restored.frames[0].references[0].imageId, restored.images[0].id)
  assert.equal(restored.frames[1].selected, restored.images[1].id)
  assert.equal(restored.frames[1].duration, 3)
  const imagePath = `images/${standard}.png`, savedBytes = files[imagePath]
  delete files[imagePath]
  await assert.rejects(service.import(new Blob([zipSync(files)])), /missing/)
  files[imagePath] = new Uint8Array([...savedBytes, 0])
  await assert.rejects(service.import(new Blob([zipSync(files)])), /mismatch/)
  assert.equal((await service.list()).length, 2, 'failed imports leave no partial board')
  await assert.rejects(change({ action: 'add-candidate', frameId: first }, new Blob(['invalid'], { type: 'image/png' })))
  assert.throws(() => parseBoardCommand({ action: 'edit-frame', duration: -1 }))
  assert.throws(() => parseBoardCommand({ action: 'reorder', order: ['a', 'a'] }))
  assert.deepEqual(await service.get(board.id), board, 'failed mutations are atomic')
  console.log('storyboard: explicit selection, pinned versions, mixed sources, conflicts, undo, reorder and portable archive integrity: ok')
} finally { service.dispose(); globalThis.createImageBitmap = originalDecoder }
