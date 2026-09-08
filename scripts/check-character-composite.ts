import assert from 'node:assert/strict'

import { renderCharacterCompositeBlob, renderCharacterCompositeDataUrl, renderCharacterThumbnail, renderCharacterAssetThumbnail } from '../src/adapters/browser/character-image.ts'
import { CHARACTER_RIG, type ResolvedCharacterLayer } from '../src/core/domain/character.ts'

const layers: Array<ResolvedCharacterLayer & { blob: Blob }> = [
  { id: 'prop-earlier-back', slot: 'item-back', slotOrder: 1, layerOrder: 1 },
  { id: 'body-base-body', slot: 'character-skin', slotOrder: 2, layerOrder: 1 },
  { id: 'expression-happy-head', slot: 'expression-head', slotOrder: 3, layerOrder: 1 },
  { id: 'prop-earlier-front', slot: 'item-front', slotOrder: 4, layerOrder: 1 },
  { id: 'prop-later-front', slot: 'item-front', slotOrder: 4, layerOrder: 2 },
].map((layer, index) => ({
  ...layer,
  blobId: layer.id,
  blob: new Blob([layer.id], { type: 'image/png' }),
  transform: { x: index * -3, y: index * 7, scale: 1 + index / 10 },
}))

type Paint = { id: string; transform: number[] }
const encoded = new Blob(['encoded PNG fixture'], { type: 'image/png' })
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
let paint: Paint[] = []
let decoded: string[] = []
let closed: string[] = []
let transform: number[] = []
let saves = 0
let restores = 0
let failDecode: string | undefined
let failPaint: string | undefined
let unavailable = false
let failEncoding = false
let createdCanvases = 0
let expectedSize = { width: 512, height: 768 }
let cropPaint: number[][] = []
let onDecode = () => {}

Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  createElement(tag: string) {
    assert.equal(tag, 'canvas')
    createdCanvases++
    return {
      width: 0,
      height: 0,
      getContext(kind: string) {
        assert.equal(kind, '2d')
        if (unavailable) return null
        return {
          save() { saves++ },
          restore() { restores++ },
          setTransform(...values: number[]) { transform = values },
          drawImage(bitmap: { id: string }, ...coordinates: number[]) {
            if (coordinates.length === 2) assert.deepEqual(coordinates, [0, 0])
            else cropPaint.push(coordinates)
            if (bitmap.id === failPaint) throw new Error('Drawing failed')
            paint.push({ id: bitmap.id, transform: [...transform] })
          },
        }
      },
      toBlob(callback: (blob: Blob | null) => void, mime: string) {
        assert.equal(mime, 'image/png')
        assert.deepEqual({ width: this.width, height: this.height }, expectedSize)
        callback(failEncoding ? null : encoded)
      },
      toDataURL(mime: string) {
        assert.equal(mime, 'image/png')
        assert.deepEqual({ width: this.width, height: this.height }, expectedSize)
        return 'data:image/png;base64,fixture'
      },
    }
  },
} })
Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (blob: Blob) => {
  const id = await blob.text()
  if (id === failDecode) throw new Error('Image decoding failed')
  decoded.push(id)
  onDecode()
  return { id, ...CHARACTER_RIG.canvas, close() { closed.push(id) } }
} })

const reset = () => {
  paint = []; decoded = []; closed = []; saves = 0; restores = 0
  onDecode = () => {}; cropPaint = []; expectedSize = { ...CHARACTER_RIG.canvas }
  failDecode = undefined; failPaint = undefined; unavailable = false; failEncoding = false
}

try {
  // Exact native canvas, ordered paint and per-layer transforms are shared with AI reference renders.
  assert.equal(await renderCharacterCompositeBlob(layers), encoded)
  const expectedPaint = layers.map(({ id, transform: { x, y, scale } }) => ({ id, transform: [scale, 0, 0, scale, x, y] }))
  assert.deepEqual(paint, expectedPaint)
  assert.deepEqual(closed, decoded)
  assert.equal(saves, layers.length)
  assert.equal(restores, saves)
  reset()
  assert.equal(await renderCharacterCompositeDataUrl(layers), 'data:image/png;base64,fixture')
  assert.deepEqual(paint, expectedPaint)
  assert.deepEqual(closed, decoded)

  // Empty selections fail before allocating a canvas; no blank download masquerades as a character.
  const beforeEmpty = createdCanvases
  await assert.rejects(() => renderCharacterCompositeBlob([]), /Select character artwork/)
  assert.equal(createdCanvases, beforeEmpty)

  reset()
  unavailable = true
  await assert.rejects(() => renderCharacterCompositeBlob(layers), /Canvas is unavailable/)
  assert.deepEqual(decoded, [])

  // No partial PNG is produced and every decoded image is closed when decoding, painting, or encoding fails.
  reset()
  failDecode = layers[1]!.id
  await assert.rejects(() => renderCharacterCompositeBlob(layers), /Image decoding failed/)
  assert.deepEqual(closed, [layers[0]!.id])

  reset()
  failPaint = layers[1]!.id
  await assert.rejects(() => renderCharacterCompositeBlob(layers), /Drawing failed/)
  assert.deepEqual(closed, layers.slice(0, 2).map(({ id }) => id))
  assert.equal(saves, restores)

  reset()
  failEncoding = true
  await assert.rejects(() => renderCharacterCompositeBlob(layers), /Could not encode character image/)
  assert.deepEqual(closed, layers.map(({ id }) => id))

  reset()
  expectedSize = { width: 160, height: 240 }
  await renderCharacterThumbnail(layers)
  assert.deepEqual(paint, expectedPaint.map(({ id, transform }) => ({ id, transform: transform.map((n) => n * 160 / 512) })))
  assert.deepEqual(closed, decoded)

  reset()
  expectedSize = { width: 80, height: 160 }
  const bounds = { x: 30, y: 40, width: 100, height: 200 }
  assert.equal(await renderCharacterAssetThumbnail(layers[0]!.blob, bounds), encoded)
  assert.deepEqual(cropPaint, [[30, 40, 100, 200, 0, 0, 80, 160]])
  await renderCharacterAssetThumbnail(layers[0]!.blob, bounds)
  assert.equal(decoded.length, 1, 'Unchanged asset thumbnail was decoded twice')
  assert.deepEqual(closed, decoded)

  reset()
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(renderCharacterThumbnail(layers, aborted.signal), { name: 'AbortError' })
  await assert.rejects(renderCharacterAssetThumbnail(layers[1]!.blob, bounds, aborted.signal), { name: 'AbortError' })
  assert.deepEqual(decoded, [], 'Cancelled thumbnail decoded an original')
  const duringDecode = new AbortController()
  onDecode = () => duringDecode.abort()
  await assert.rejects(renderCharacterAssetThumbnail(layers[1]!.blob, bounds, duringDecode.signal), { name: 'AbortError' })
  assert.deepEqual(closed, decoded, 'Cancelled thumbnail leaked its bitmap')
} finally {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
  else Reflect.deleteProperty(globalThis, 'document')
  if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap)
  else Reflect.deleteProperty(globalThis, 'createImageBitmap')
}

console.log('character composite: ok')
