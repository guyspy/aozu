import assert from 'node:assert/strict'

import { createCharacterDraft, saveCharacterDraftAsset } from '../src/core/application/character-creation.ts'
import { changeCharacterAppearance } from '../src/core/application/character-appearances.ts'
import { CHARACTER_HISTORY_LIMIT, createCharacterEditor } from '../src/core/application/character-editor.ts'
import { CharacterRevisionConflict, type CharacterDraftRepository } from '../src/core/application/ports.ts'
import type { CharacterDraft } from '../src/core/domain/character.ts'

const inspection = { width: 512, height: 768, hasTransparentPixels: true, hasVisiblePixels: true, genuineRgba: true, visibleBounds: { x: 40, y: 20, width: 430, height: 720 }, visiblePixelCount: 100, size: 10, sha256: 'a'.repeat(64) }
const rows = new Map<string, { character: CharacterDraft; version: number }>()
const writeLog: string[] = []
let failNextWrite: Error | undefined
let clock = 100
let holdRead: { id: string; promise: Promise<void>; started: () => void } | undefined
const characters: CharacterDraftRepository = {
  async list() { return [...rows.values()].map(({ character, version }) => ({ character: structuredClone(character), version })) },
  async get(id) {
    if (holdRead?.id === id) {
      holdRead.started()
      await holdRead.promise
    }
    const row = rows.get(id)
    return row ? { character: structuredClone(row.character), version: row.version } : null
  },
  async create(draft) { rows.set(draft.id, { character: structuredClone(draft), version: 1 }); return { character: structuredClone(draft), version: 1 } },
  async put(draft, expectedVersion) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    if (failNextWrite) { const error = failNextWrite; failNextWrite = undefined; throw error }
    const row = rows.get(draft.id)
    if (!row) throw new Error('Character not found')
    if (row.version !== expectedVersion) throw new CharacterRevisionConflict(`expected ${expectedVersion}, found ${row.version}`)
    writeLog.push(draft.variants[0]!.label)
    // The entry owns updatedAt: a write returns the same snapshot's revision and timestamp.
    row.character = { ...structuredClone(draft), updatedAt: ++clock }
    return { version: ++row.version, updatedAt: row.character.updatedAt }
  },
  async delete(id) { rows.delete(id) },
}
const blobs = new Map<string, Map<string, Blob>>()
let failBlobWrite = false
const editor = createCharacterEditor(characters, (scope) => ({
  async put(id, blob) { if (failBlobWrite) throw new Error('quota'); const scoped = blobs.get(scope) ?? new Map(); scoped.set(id, blob); blobs.set(scope, scoped) },
  async get(id) { return blobs.get(scope)?.get(id) ?? null },
  async list() { return [] },
}), async () => inspection)
const state = () => editor.store.getState()
const past = () => editor.history.getState().pastStates.length
const future = () => editor.history.getState().futureStates.length
// Mixed edits exercise Appearance history while the current Character profile stays intact.
const rename = (name: string) => (character: CharacterDraft) => ({ ...character, name, variants: character.variants.map((variant, index) => index ? variant : { ...variant, label: name }) })

await characters.create({ ...createCharacterDraft('alpha-pack', 'alpha'), name: 'Alpha' })
await characters.create({ ...createCharacterDraft('beta-pack', 'beta'), name: 'Beta' })

// Opening is a pure read: no write, no history, revision equals the Mantle version.
const opened = await editor.open('alpha')
assert.equal(opened.name, 'Alpha')
assert.equal(state().persistedRevision, 1)
assert.equal(state().saveStatus, 'saved')
assert.equal(past(), 0)
assert.deepEqual(writeLog, [])
assert.equal(await editor.open('alpha'), opened)

// No-op command: same reference creates neither history nor a write.
assert.equal(await editor.dispatch((character) => character), false)
assert.equal(past(), 0)
assert.deepEqual(writeLog, [])

// Rapid commands serialize in order against the latest version; one frame each.
const first = editor.dispatch(rename('A1'))
assert.equal(state().saveStatus, 'saving')
const second = editor.dispatch(rename('A2'))
const third = editor.dispatch(rename('A3'))
assert.equal(past(), 3)
assert.deepEqual(await Promise.all([first, second, third]), [true, true, true])
assert.deepEqual(writeLog, ['A1', 'A2', 'A3'])
assert.equal(rows.get('alpha')!.version, 4)
assert.equal(state().persistedRevision, 4)
assert.equal(state().saveStatus, 'saved')
assert.notEqual(state().character, opened)

// Undo and redo each persist a new version without adding a duplicate history frame.
assert.equal(await editor.undo(), true)
assert.equal(state().character!.name, 'A3', 'Appearance Undo preserves the current profile')
assert.equal(state().character!.variants[0]!.label, 'A2')
assert.equal(past(), 2)
assert.equal(future(), 1)
assert.equal(rows.get('alpha')!.character.name, 'A3')
assert.equal(rows.get('alpha')!.character.variants[0]!.label, 'A2')
assert.equal(state().persistedRevision, 5)
assert.equal(await editor.redo(), true)
assert.equal(state().character!.name, 'A3')
assert.equal(past(), 3)
assert.equal(future(), 0)
assert.equal(state().persistedRevision, 6)
assert.equal(await editor.redo(), false)
assert.equal(state().persistedRevision, 6)
// Queued undo while saving keeps order; a new edit after undo clears redo.
const undone = editor.undo()
const edited = editor.dispatch(rename('A4'))
await Promise.all([undone, edited])
assert.deepEqual(writeLog.slice(-2), ['A2', 'A4'])
assert.equal(future(), 0)
assert.equal(state().character!.name, 'A4')
assert.equal(rows.get('alpha')!.character.name, 'A4')

// Transient failure keeps the dirty Character and history; Retry saves the current snapshot.
failNextWrite = new Error('disk full')
const framesBeforeFailure = past()
await editor.dispatch(rename('A5'))
assert.equal(state().saveStatus, 'failed')
assert.equal(state().saveError, 'disk full')
assert.equal(state().character!.name, 'A5')
assert.equal(past(), framesBeforeFailure + 1)
assert.equal(rows.get('alpha')!.character.name, 'A4')
await assert.rejects(() => editor.open('beta'), /unsaved changes/)
assert.equal(state().activeCharacterId, 'alpha')
failNextWrite = new Error('still failing')
await editor.dispatch(rename('A6'))
assert.equal(state().saveStatus, 'failed')
assert.equal(state().character!.name, 'A6')
assert.equal(past(), framesBeforeFailure + 2)
await editor.retry()
assert.equal(state().saveStatus, 'saved')
assert.equal(rows.get('alpha')!.character.name, 'A6')
assert.equal(writeLog.includes('A5'), false)
assert.equal(past(), framesBeforeFailure + 2)

// Later successful snapshot subsumes an earlier failed one.
failNextWrite = new Error('flaky')
const failing = editor.dispatch(rename('A7'))
const recovering = editor.dispatch(rename('A8'))
await Promise.all([failing, recovering])
assert.equal(state().saveStatus, 'saved')
assert.equal(rows.get('alpha')!.character.name, 'A8')

// Stale expected revision is rejected without mutation.
const revision = state().persistedRevision!
assert.throws(() => editor.dispatch(rename('stale'), revision - 1), CharacterRevisionConflict)
assert.equal(state().character!.name, 'A8')
assert.equal(await editor.dispatch(rename('A9'), revision), true)
assert.equal(state().persistedRevision, revision + 1)

// Upload: Blob write failure creates neither a Character change nor a history frame.
failBlobWrite = true
const framesBeforeUpload = past()
await assert.rejects(() => editor.stageAsset(new Blob(['png']), 'body.png', 'user'), /quota/)
assert.equal(past(), framesBeforeUpload)
failBlobWrite = false
const staged = await editor.stageAsset(new Blob(['png']), 'body.png', 'user')
assert.equal(await blobs.get('character:alpha-pack')!.get(inspection.sha256)!.text(), 'png')
await editor.dispatch((character) => saveCharacterDraftAsset(character, { group: 'body', variantId: 'base', label: 'Base body', layer: 'body' }, staged))
assert.equal(past(), framesBeforeUpload + 1)
assert.equal(rows.get('alpha')!.character.variants[0]!.layers.body?.filename, 'body.png')
await editor.undo()
assert.equal(state().character!.variants[0]!.layers.body, undefined)
assert.equal(rows.get('alpha')!.character.variants[0]!.layers.body, undefined)

// Conflict keeps local work, blocks persistence and undo/redo, and requires Reload or Save As.
rows.get('alpha')!.version += 1
await editor.dispatch(rename('Local'))
assert.equal(state().saveStatus, 'conflict')
assert.equal(state().character!.name, 'Local')
assert.equal(await editor.undo(), false)
assert.throws(() => editor.dispatch(rename('More')), CharacterRevisionConflict)
await assert.rejects(() => editor.open('beta'), /unsaved changes/)
const writesBeforeRetry = writeLog.length
await editor.retry()
assert.equal(writeLog.length, writesBeforeRetry)
assert.equal(state().saveStatus, 'conflict')

// Save As preserves the local value as a new independent Character and becomes the active session.
const copy = await editor.saveAs()
assert.notEqual(copy.id, 'alpha')
assert.notEqual(copy.packId, 'alpha-pack')
assert.equal(copy.name, 'Local copy')
assert.equal(state().activeCharacterId, copy.id)
assert.equal(state().saveStatus, 'saved')
assert.equal(state().persistedRevision, 1)
assert.equal(past(), 0)
assert.equal(rows.get('alpha')!.character.name, 'A9')

// Reload discards the local session and history without writing.
await editor.dispatch(rename('Unsaved'))
rows.get(copy.id)!.version += 1
await editor.dispatch(rename('Unsaved 2'))
assert.equal(state().saveStatus, 'conflict')
const writesBeforeReload = writeLog.length
const reloaded = await editor.reload()
assert.equal(reloaded.name, 'Unsaved')
assert.equal(state().saveStatus, 'saved')
assert.equal(past(), 0)
assert.equal(writeLog.length, writesBeforeReload)

// Switching clears history and never writes the previous Character.
await editor.dispatch(rename('Before switch'))
const writesBeforeSwitch = writeLog.length
const beta = await editor.open('beta')
assert.equal(beta.name, 'Beta')
assert.equal(state().activeCharacterId, 'beta')
assert.equal(past(), 0)
assert.equal(writeLog.length, writesBeforeSwitch)
assert.equal(rows.get(copy.id)!.character.name, 'Before switch')

// History is bounded.
for (let index = 0; index < CHARACTER_HISTORY_LIMIT + 5; index++) void editor.dispatch(rename(`B${index}`))
await editor.settle()
assert.equal(past(), CHARACTER_HISTORY_LIMIT)

// view() reads the active in-memory value and pure-reads others; close() ends the session.
assert.equal((await editor.view('beta')).character.name, state().character!.name)
assert.equal((await editor.view('alpha')).character.name, 'A9')
await editor.close('beta')
assert.equal(state().character, null)
assert.equal(past(), 0)

// Character opens are ordered: a slow earlier read cannot overwrite the latest requested Character.
let releaseRead!: () => void
let markReadStarted!: () => void
const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
holdRead = { id: 'alpha', promise: new Promise((resolve) => { releaseRead = resolve }), started: markReadStarted }
const slowAlpha = editor.open('alpha')
await readStarted
const latestBeta = editor.open('beta')
releaseRead()
await Promise.all([slowAlpha, latestBeta])
assert.equal(state().activeCharacterId, 'beta')

// One settled snapshot: view() projects revision and updatedAt from the same persisted entry, so a saved
// mutation can never expose the tracked snapshot's prior timestamp while its revision is already current.
await characters.create({ ...createCharacterDraft('gamma-pack', 'gamma'), name: 'Gamma', updatedAt: 1 })
const gamma = await editor.open('gamma')
assert.equal(gamma.updatedAt, 1)
assert.equal(await editor.dispatch(rename('Gamma 2')), true)
const projected = await editor.view('gamma')
const stored = (await characters.list()).find(({ character }) => character.id === 'gamma')!
assert.equal(projected.version, stored.version)
assert.equal(projected.character.updatedAt, stored.character.updatedAt)
assert.notEqual(projected.character.updatedAt, 1)
// The tracked Character keeps its identity, so projecting a fresh timestamp adds no history frame.
assert.equal(state().character!.updatedAt, 1)
assert.equal(past(), 1)

// Copies stay distinguishable: `<name> copy`, then the smallest free numeric suffix.
const firstCopy = await editor.saveAs()
assert.equal(firstCopy.name, 'Gamma 2 copy')
await editor.open('gamma')
const secondCopy = await editor.saveAs()
assert.equal(secondCopy.name, 'Gamma 2 copy 2')
await editor.open('gamma')
assert.equal((await editor.saveAs()).name, 'Gamma 2 copy 3')

// Opening/reopening the first workshop creates no record. Rapid first edits create once, then update the permanent Mantle ID.
let creations = 0
const newEditor = createCharacterEditor({ ...characters, async create(draft) {
  creations++
  await new Promise((resolve) => setTimeout(resolve, 5))
  return characters.create({ ...draft, id: 'first-created-character' })
} }, () => { throw new Error('No assets in this check') }, async () => inspection)
const beforeNew = rows.size
await newEditor.open('new')
await newEditor.open('new')
assert.equal(rows.size, beforeNew)
assert.equal(newEditor.store.getState().persistedRevision, 0)
await Promise.all([newEditor.dispatch(rename('First name'), 0), newEditor.dispatch(rename('Latest name'), 0)])
assert.equal(creations, 1)
assert.equal(rows.size, beforeNew + 1)
assert.equal(rows.get('first-created-character')!.character.name, 'Latest name')
assert.equal(newEditor.store.getState().activeCharacterId, 'first-created-character')
assert.equal(newEditor.store.getState().saveStatus, 'saved')
await newEditor.undo()
assert.equal(rows.get('first-created-character')!.character.name, 'Latest name')
assert.equal(rows.get('first-created-character')!.character.variants[0]!.label, 'First name')
assert.equal(newEditor.store.getState().character!.id, 'first-created-character')
await newEditor.redo()
assert.equal(rows.get('first-created-character')!.character.name, 'Latest name')
assert.equal(creations, 1)
// Preparation is part of the save: a failed front capture cannot partially save a look or allow switching.
let failPreparation = true
const preparedEditor = createCharacterEditor(characters, () => { throw new Error('No assets in this check') }, async () => inspection, async (draft) => {
  if (failPreparation) throw new Error('Front capture failed')
  return { ...draft, description: 'Prepared before persistence' }
})
const namedDraft = changeCharacterAppearance(changeCharacterAppearance(createCharacterDraft('prepared-pack', 'prepared'),
  { action: 'save-as', id: 'first', label: 'First' }), { action: 'save-as', id: 'second', label: 'Second' })
await characters.create(namedDraft)
await preparedEditor.open(namedDraft.id)
await preparedEditor.dispatch((draft) => ({ ...draft, selected: { ...draft.selected, expression: 'happy' } }))
assert.equal(preparedEditor.store.getState().saveStatus, 'failed')
assert.equal(rows.get(namedDraft.id)!.character.selected.expression, undefined)
assert.equal(rows.get(namedDraft.id)!.version, 1)
assert.throws(() => preparedEditor.dispatch((draft) => changeCharacterAppearance(draft, { action: 'select', id: 'first' })), /retry/)
failPreparation = false
await preparedEditor.retry()
assert.equal(rows.get(namedDraft.id)!.character.appearances![1]!.selected.expression, 'happy')
assert.equal(rows.get(namedDraft.id)!.character.description, 'Prepared before persistence')
const queuedEdit = preparedEditor.dispatch(rename('Latest prepared edit'))
const preparedCopy = await preparedEditor.saveAs()
await queuedEdit
assert.equal(preparedCopy.variants[0]!.label, 'Latest prepared edit', 'Character copy waits for the pending save')
await preparedEditor.open('new')
await preparedEditor.dispatch((draft) => ({ ...draft, modelSheet: { views: {}, heightCm: 230 } }))
assert.equal(await preparedEditor.undo(), false, 'Adding height to an empty sheet stays outside Appearance history')
console.log('character editor: ok')
