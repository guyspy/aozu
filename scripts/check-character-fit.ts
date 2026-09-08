import assert from 'node:assert/strict'
import { createApplication } from '../src/bootstrap.ts'
import { createCharacterDraft } from '../src/core/application/character-creation.ts'

// Fit suggestions need masks, never contract reference PNGs, base64 strings, or export workers.
const document = {
  defaultView: null,
  createElement(tag: string) {
    assert.equal(tag, 'canvas')
    return { width: 0, height: 0, getContext() { return {
      drawImage() {},
      getImageData() { return { data: pixels } },
    } }, toDataURL() { throw new Error('Fit encoded a reference PNG') }, toBlob() { throw new Error('Fit encoded a PNG') } }
  },
} as unknown as Document
const originals = new Map(['document', 'createImageBitmap', 'FileReader', 'Worker'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const pixels = new Uint8ClampedArray(512 * 768 * 4)
for (let y = 100; y < 700; y++) for (let x = 100; x < 400; x++) pixels[(y * 512 + x) * 4 + 3] = 255
let decoded = 0, closed = 0
Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => { decoded++; return { width: 512, height: 768, close() { closed++ } } } })
for (const key of ['FileReader', 'Worker']) Object.defineProperty(globalThis, key, { configurable: true, value: class { constructor() { throw new Error(`Fit used ${key}`) } } })
try {
  const application = createApplication(document)
  const character = createCharacterDraft('fit-fixture', 'fit-character')
  const blob = new Blob(['fixture'], { type: 'image/png' })
  const inspection = { width: 512, height: 768, size: 7, sha256: 'a'.repeat(64), genuineRgba: true, hasTransparentPixels: true, hasVisiblePixels: true, visibleBounds: { x: 100, y: 100, width: 300, height: 600 } }
  character.variants[0]!.layers.body = { blob, filename: 'base.png', source: 'user', inspection }
  character.variants.push({ group: 'outfit', id: 'test-outfit', label: 'Test', layers: {
    body: { blob, filename: 'outfit.png', source: 'user', inspection, canonicalSha256: inspection.sha256 },
  } })
  application.editor.store.setState({ activeCharacterId: character.id, character, persistedRevision: 1 })
  assert.equal((await application.characterFitSuggestion('outfit', 'test-outfit')).status, 'aligned')
  assert.equal(decoded, 2)
  assert.equal(closed, decoded)
  await assert.rejects(application.characterFitSuggestion('outfit', 'missing'), /empty or missing/)
  assert.equal(decoded, 2)
  application.webmcp.dispose()
} finally {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
}
console.log('character fit: mask-only suggestion, no PNG/base64/worker, missing-target guard ok')
