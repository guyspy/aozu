import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { bootMantleRuntime } from '@aotter/mantle-runtime'
import { createCharacterDraft, resolveCharacterDraftAtlasSources, validateCharacterAssetInspection } from '../src/core/application/character-creation.ts'
import { characterAssets, mapCharacterAssets } from '../src/core/application/character-assets.ts'
import { characterModelSheet, setModelSheetReference, updateCharacterModelSheet, validateModelSheet, validateReferenceInspection, validateReferencePng } from '../src/core/application/character-model-sheet.ts'
import { changeCharacterAppearance, sameCharacterSelection, validateCharacterAppearances } from '../src/core/application/character-appearances.ts'
import { createCharacterEditor } from '../src/core/application/character-editor.ts'
import { createCharacterWorkspaceRepository } from '../src/adapters/indexeddb/character-workspace-repository.ts'
import { createIndexedDbAssetRepository } from '../src/adapters/indexeddb/asset-repository.ts'
import { createIndexedDbMantleStorageAdapter } from '../src/adapters/indexeddb/mantle-storage.ts'
import { compileAuthoringBackbone } from '../src/core/mantle/backbone.ts'
import { AUTHORING_NAMESPACE } from '../src/core/application/authoring.ts'
import { exportCharacterDraftZip, readCharacterDraftZip } from '../src/adapters/zip/character-draft.ts'
import { exportCharacterLibraryZip, readCharacterLibraryZip } from '../src/adapters/zip/character-library.ts'
import { characterLibraryDigest, inspectCharacterLibrarySnapshot, type CharacterLibrarySnapshot } from '../src/core/application/character-library.ts'
import type { CharacterAssetInspection, CharacterDraftAsset } from '../src/core/domain/character.ts'

// The browser check decodes real PNGs. Here an injected decoder isolates persistence and archive contracts.
const header = new Uint8Array(33)
header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
new DataView(header.buffer).setUint32(16, 1000)
new DataView(header.buffer).setUint32(20, 1600)
header[24] = 8; header[25] = 2
const blob = new Blob([header, 'opaque-reference'], { type: 'image/png' })
const inspect = async (image: Blob): Promise<CharacterAssetInspection> => ({ width: 1000, height: 1600,
  genuineRgba: false, hasTransparentPixels: false, hasVisiblePixels: true, size: image.size, sha256: await characterLibraryDigest(image),
  visibleBounds: { x: 0, y: 0, width: 1000, height: 1600 } })
const asset: CharacterDraftAsset = { blob, filename: 'front.png', source: 'user', inspection: await inspect(blob) }
await validateReferencePng(blob)
validateReferenceInspection(asset.inspection)
assert.throws(() => validateCharacterAssetInspection(asset.inspection), /512/)
const oversized = header.slice(); new DataView(oversized.buffer).setUint32(16, 100000)
await assert.rejects(validateReferencePng(new Blob([oversized], { type: 'image/png' })), /4096/)
for (const heightCm of [0, -1, NaN, Infinity]) assert.throws(() => validateModelSheet({ heightCm, views: {} }))
for (const guides of [{ head: 0.9, feet: 0.2 }, { head: -0.1, feet: 1 }, { head: 0.5, feet: 0.5 }]) {
  assert.throws(() => validateModelSheet({ views: { front: { asset, guides } } }))
}
validateModelSheet({ views: { front: { asset, guides: { head: 0.28, feet: 0.29 } } } })
const draft = updateCharacterModelSheet(createCharacterDraft('model-sheet-test'), { heightCm: 185, views: {
  front: { asset, notes: 'Coat ends at the hip.', guides: { head: 0.12, feet: 0.88 } },
  back: { asset: { ...asset, filename: 'back.png' } },
}, references: {
  't-pose': { asset: { ...asset, filename: 't-pose.png' }, label: 'T-pose', kind: 'structure', viewpoint: 'front', pose: 't-pose', sourceSha256: asset.inspection.sha256 },
  'head-angles': { asset, label: 'Head angles', kind: 'head', notes: 'Proposed back-of-head design.' },
} })
assert.throws(() => validateModelSheet({ views: {}, references: { front: { asset } } }), /supplemental/)
assert.throws(() => validateModelSheet({ views: {}, references: { '../file': { asset } } }), /ID/)
assert.equal(setModelSheetReference(draft.modelSheet!, 't-pose').references?.['t-pose'], undefined)
assert.equal(updateCharacterModelSheet(draft, draft.modelSheet!), draft, 'unchanged sheet is a no-op')
assert.equal(resolveCharacterDraftAtlasSources(draft).length, 0, 'references never become appearance layers')
const plan = compileAuthoringBackbone()
const runtime = await bootMantleRuntime({ plan, storage: createIndexedDbMantleStorageAdapter(AUTHORING_NAMESPACE),
  handlers: Object.fromEntries(Object.values(plan.procedures).flatMap(({ manifest }) => manifest.spec.handler.kind === 'ref' ? [[manifest.spec.handler.ref, async () => ({ status: 'ok', data: {} })]] : [])) })
const repository = createCharacterWorkspaceRepository(async () => runtime, createIndexedDbAssetRepository)
const saved = await repository.create(draft)
assert.deepEqual(saved.character.modelSheet, draft.modelSheet)
assert.equal((await repository.listSummaries()).find(({ id }) => id === saved.character.id)?.previewKey, '[]', 'reference art leaves card composite cache unchanged')
const editor = createCharacterEditor(repository, createIndexedDbAssetRepository, inspect)
await editor.open(saved.character.id)
await editor.dispatch((current) => updateCharacterModelSheet(current, { ...current.modelSheet!, heightCm: undefined }))
assert.equal(editor.store.getState().saveStatus, 'saved')
assert.equal((await repository.get(saved.character.id))?.character.modelSheet?.heightCm, undefined)
await editor.undo()
assert.equal(editor.store.getState().character?.modelSheet?.heightCm, 185)
const copy = await editor.duplicate(editor.store.getState().character!)
assert.notEqual(copy.character.packId, draft.packId)
assert.deepEqual(copy.character.modelSheet, draft.modelSheet)
const restored = (await readCharacterDraftZip(await exportCharacterDraftZip(draft), inspect)).draft
assert.deepEqual(restored.modelSheet, draft.modelSheet, 'individual ZIP preserves guides, notes, height and original art')
const { id, updatedAt: _updatedAt, ...data } = draft
const snapshot: CharacterLibrarySnapshot = { entries: [{ bundleId: AUTHORING_NAMESPACE, id, collection: 'character-workspaces',
  status: 'published', version: 1, createdAt: 1, updatedAt: 1, authorId: null,
  data: { ...data, ...await mapCharacterAssets(draft, ({ blob: _blob, ...asset }) => ({ ...asset, blobId: asset.inspection.sha256 })) } }],
  assets: [{ bundleId: `character:${draft.packId}`, id: asset.inspection.sha256, blob }],
  legacyDrafts: [{ ...draft, id: 'legacy-model-sheet', packId: 'legacy-model-sheet' }], }
const library = await readCharacterLibraryZip(await exportCharacterLibraryZip(snapshot, inspect), inspect)
assert.deepEqual(library.entries, JSON.parse(JSON.stringify(snapshot.entries)))
assert.deepEqual(library.legacyDrafts[0].modelSheet, draft.modelSheet)
assert.equal(characterAssets(library.legacyDrafts[0]).length, 4)
await assert.rejects(inspectCharacterLibrarySnapshot({ ...snapshot, assets: [] }, inspect), /missing or inconsistent/)

const first = changeCharacterAppearance(draft, { action: 'save', id: 'gym', label: 'Gym' })
assert.deepEqual(characterModelSheet(first), draft.modelSheet, 'first Appearance adopts every existing reference without changing art')
assert.deepEqual(first.modelSheet, { views: {}, heightCm: 185 }, 'height stays on the character')
assert.equal(characterAssets(first).length, 4, 'adoption does not duplicate assets')
const another = changeCharacterAppearance({ ...first, selected: { outfit: 'outfit-1', expression: 'happy', props: ['prop-1'] } }, { action: 'save', id: 'formal', label: 'Formal' })
assert.deepEqual(characterModelSheet(another), { views: {}, heightCm: 185 }, 'second Appearance never inherits another outfit’s references')
const withSide = updateCharacterModelSheet(another, { heightCm: 190, views: { side: { asset, notes: 'Formal only' } } })
assert.equal(characterModelSheet(changeCharacterAppearance(withSide, { action: 'select', id: 'gym' })).views.side, undefined)
assert.equal(characterModelSheet(changeCharacterAppearance(withSide, { action: 'select', id: 'gym' })).heightCm, 190, 'all Appearances share height')
assert.deepEqual(changeCharacterAppearance(withSide, { action: 'select', id: 'gym' }).selected, first.selected)
assert.equal(sameCharacterSelection({ props: ['a', 'b'] }, { props: ['b', 'a'] }), false, 'prop order is part of the combination')
assert.throws(() => changeCharacterAppearance(first, { action: 'save', id: 'gym', label: 'Overwrite' }), /already exists/)
assert.throws(() => changeCharacterAppearance(first, { action: 'save', id: '../bad', label: 'Bad' }), /Appearance/)
assert.throws(() => changeCharacterAppearance(first, { action: 'rename', id: 'gym', label: ' ' }), /Appearance/)
assert.throws(() => validateCharacterAppearances({ ...first, activeAppearanceId: 'missing' }), /missing/)
assert.throws(() => validateCharacterAppearances({ ...first, appearances: [{ ...first.appearances![0], selected: { props: ['missing'] } }] }), /missing/)
const named = await repository.create({ ...withSide, packId: 'named-model-sheet' })
assert.deepEqual(named.character.appearances, withSide.appearances, 'Mantle hydrates Appearance references')
await editor.open(named.character.id)
await editor.dispatch((current) => changeCharacterAppearance(current, { action: 'select', id: 'gym' }))
await editor.undo()
assert.equal(editor.store.getState().character?.activeAppearanceId, 'formal', 'selection and sheet undo together')
await editor.redo()
assert.equal(editor.store.getState().character?.activeAppearanceId, 'gym')
const namedZip = (await readCharacterDraftZip(await exportCharacterDraftZip(withSide), inspect)).draft
assert.deepEqual(namedZip.appearances, withSide.appearances, 'individual ZIP restores both reference sets')
assert.equal(namedZip.activeAppearanceId, 'formal')
const namedCopy = await editor.duplicate(withSide)
assert.deepEqual(namedCopy.character.appearances, withSide.appearances, 'duplicate preserves Appearance art')
const namedData = await mapCharacterAssets(withSide, ({ blob: _blob, ...asset }) => ({ ...asset, blobId: asset.inspection.sha256 }))
const namedSnapshot: CharacterLibrarySnapshot = { ...snapshot, entries: [{ ...snapshot.entries[0], data: { ...data, ...namedData, activeAppearanceId: 'formal' } }], legacyDrafts: [{ ...withSide, id: 'legacy-model-sheet', packId: 'legacy-model-sheet' }] }
const namedLibrary = await readCharacterLibraryZip(await exportCharacterLibraryZip(namedSnapshot, inspect), inspect)
assert.deepEqual(namedLibrary.entries, JSON.parse(JSON.stringify(namedSnapshot.entries)))
assert.deepEqual(namedLibrary.legacyDrafts[0].appearances, withSide.appearances, 'library archive preserves Appearance reference assets')
await repository.delete(named.character.id)
await repository.delete(namedCopy.character.id)
await repository.delete(saved.character.id)
await repository.delete(copy.character.id)
console.log('character model sheet: limits, height/guides, persistence, undo/copy, both ZIP formats and missing-asset rejection ok')
