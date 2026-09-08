import { createElement as h, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { createCharacterEditor } from '/src/core/application/character-editor.ts'
import { createCharacterDraft } from '/src/core/application/character-creation.ts'
import { AppRoutes } from '/src/ui/routes/AppRoutes.tsx'
import '/src/ui/i18n.ts'
import '/src/index.css'

const result = document.querySelector('#result')
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ready = async (predicate) => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await wait(25) }
  throw new Error(`Timed out: ${predicate}`)
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const makeCharacter = async (id, color) => {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 768
  const context = canvas.getContext('2d')
  context.fillStyle = color; context.fillRect(100, 100, 300, 600)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve))
  const inspection = { width: 512, height: 768, size: blob.size, sha256: id.repeat(64), genuineRgba: true, hasTransparentPixels: true, hasVisiblePixels: true, visibleBounds: { x: 100, y: 100, width: 300, height: 600 } }
  const asset = { blob, filename: `${id}.png`, source: 'user', inspection, canonicalSha256: inspection.sha256 }
  const character = createCharacterDraft(`test-${id}`, id)
  character.name = id
  character.variants.find((v) => v.group === 'body').layers.body = asset
  character.variants.find((v) => v.id === 'happy').layers.head = asset
  character.selected.expression = 'happy'
  return character
}
const characters = await Promise.all([makeCharacter('a', '#b44'), makeCharacter('b', '#46b')])
const reads = new Map(characters.map((c) => [c.id, deferred()]))
const decodes = new Map(characters.map((c) => [c.variants[0].layers.body.blob, deferred()]))
const nativeBitmap = globalThis.createImageBitmap
let failDecode = false
globalThis.createImageBitmap = async (blob, ...args) => {
  if (failDecode) throw new Error('Simulated image decode failure')
  await decodes.get(blob)?.promise
  return nativeBitmap(blob, ...args)
}
const editor = createCharacterEditor({
  get: async (id) => { await reads.get(id).promise; return { character: characters.find((c) => c.id === id), version: 1 } },
}, () => {}, async () => { throw new Error('Fixture inspections already exist') })
let navigateTo
const application = {
  editor,
  webmcp: { getState: () => ({ status: 'ready', toolCount: 0 }), setNavigate: (navigate) => { navigateTo = navigate; return () => {} }, subscribe: () => () => {} },
  subscribeCharacterChanges: () => () => {},
  loadCharacterLibrary: async () => ({ collections: [{ id: 'default', name: 'My characters', description: '', backstory: '', version: 0, updatedAt: 0, characterIds: characters.map((c) => c.id) }], characters: characters.map((c) => ({ id: c.id, name: c.name, revision: 1, updatedAt: c.updatedAt, previewKey: c.id })) }),
  loadCharacterThumbnail: async (id) => characters.find((c) => c.id === id).variants[0].layers.body.blob,
  characterFitSuggestion: async () => ({ status: 'aligned' }),
}
const root = createRoot(document.querySelector('#root'))
root.render(h(StrictMode, null, h(MemoryRouter, { initialEntries: ['/collections/default'] }, h(AppRoutes, { application }))))
const releaseDecode = (character) => decodes.get(character.variants[0].layers.body.blob).resolve()
try {
  for (const character of characters) {
    await ready(() => document.querySelector('.companion-card-open'))
    const cards = [...document.querySelectorAll('.companion-card-open')]
    cards.find((button) => button.querySelector('.companion-card-name').textContent === character.name).click()
    await wait(80)
    check(!document.querySelector('.character-stage-canvas'), 'Pending character read must not show the previous editor')
    reads.get(character.id).resolve()
    await ready(() => document.querySelector('.character-stage-canvas'))
    if (!document.querySelector('.doll-workbench')) {
      document.querySelector('.character-stage-preview button[aria-label="Customize appearance"]').click()
      await ready(() => document.querySelector('.doll-workbench'))
    }
    check(Boolean(document.querySelector('.character-stage-canvas [role="status"]')), 'Preview must show loading until its pixels are ready')
    check(Boolean(document.querySelector('.variant-preview [role="status"]')), 'Thumbnails must show loading until their pixels are ready')
    check(!document.querySelector('.character-stage-canvas img, .variant-preview img[alt="Happy"]'), 'Pending decode must never display raw images first')
    releaseDecode(character)
    await ready(() => document.querySelector('.character-stage-canvas canvas') && !document.querySelector('.character-stage-canvas [role="status"]'))
    await ready(() => document.querySelector('.variant-preview img[alt="Happy"]')?.naturalWidth > 0)
    const stage = document.querySelector('.character-stage-canvas canvas')
    const thumbnail = document.querySelector('.variant-preview img[alt="Happy"]')
    editor.store.setState({ character: { ...editor.store.getState().character, selected: { props: [] } } })
    await wait(300)
    check(stage.isConnected && document.querySelectorAll('.character-stage-canvas canvas').length === 1, 'Selection change remounted or duplicated the canvas')
    check(thumbnail.isConnected && thumbnail.complete, 'Selection change remounted or cleared a thumbnail')
    document.querySelector('[data-slot="sheet-close"]')?.click()
    await wait(250)
    document.querySelector('header button').click()
  }
  await ready(() => document.querySelector('.book-page'))
  for (const character of characters) decodes.set(character.variants[0].layers.body.blob, deferred())
  navigateTo('/characters/a/expressions')
  await ready(() => document.querySelector('.character-stage-canvas [role="status"]'))
  navigateTo('/characters/b/expressions')
  await ready(() => document.querySelector('.character-stage-canvas [role="img"]')?.getAttribute('aria-label') === 'b')
  releaseDecode(characters[0])
  await wait(80)
  check(Boolean(document.querySelector('.character-stage-canvas [role="status"]')) && document.querySelector('.character-stage-canvas canvas')?.parentElement.style.visibility === 'hidden', 'Late previous-character decode escaped into the new character')
  releaseDecode(characters[1])
  await ready(() => document.querySelector('.character-stage-canvas canvas') && !document.querySelector('.character-stage-canvas [role="status"]'))
  failDecode = true
  navigateTo('/characters/a/expressions')
  await ready(() => document.querySelector('.character-stage-canvas [role="alert"]'))
  check(document.querySelector('.character-stage-canvas canvas')?.parentElement.style.visibility === 'hidden', 'Failed decode must not fall back to raw art')
  failDecode = false
  ;document.querySelector('.character-stage-canvas button[aria-label="Retry"]').click()
  await ready(() => document.querySelector('.character-stage-canvas canvas') && !document.querySelector('.character-stage-canvas [role="status"]'))
  result.textContent = failures.length ? `FAIL: ${failures.join('; ')}` : 'PASS: loading without raw-image flash, one stable canvas/thumbnail, StrictMode, late decode cancellation, and failure/retry'
} catch (error) {
  result.textContent = `FAIL: ${error.message}`
  throw error
} finally {
  globalThis.createImageBitmap = nativeBitmap
  if (result.textContent.startsWith('PASS')) root.unmount()
}
