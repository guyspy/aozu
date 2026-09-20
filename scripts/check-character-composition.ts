import assert from 'node:assert/strict'
import { createCharacterDraft, activateCharacterVariant, deactivateCharacterVariant, updateCharacterVariantMetadata, resolveCharacterDraftLayers, buildCharacterPack, removeCharacterVariant, migrateCharacterDraft } from '../src/core/application/character-creation.ts'
import { resolveCharacterComposition, type CharacterDraftAsset } from '../src/core/domain/character.ts'
import { exportCharacterDraftZip, readCharacterDraftZip } from '../src/adapters/zip/character-draft.ts'
import { selectItem, setSmartOrder } from '../src/core/domain/character-composition.ts'

const inspection = { width: 512, height: 768, hasTransparentPixels: true, hasVisiblePixels: true, genuineRgba: true, size: 1, sha256: 'a'.repeat(64), visibleBounds: { x: 10, y: 10, width: 100, height: 100 } }
const asset: CharacterDraftAsset = { blob: new Blob(['a'], { type: 'image/png' }), filename: 'a.png', source: 'agent', inspection, canonicalSha256: inspection.sha256 }
let draft = createCharacterDraft('composition-test')
draft.variants = [
  { group: 'body', id: 'base', label: 'Body', layers: { body: asset } },
  { group: 'outfit', id: 'shirt', label: 'Shirt', metadata: { outfit: { slot: 'top', garmentType: 'shirt' } }, layers: { front: asset } },
  { group: 'outfit', id: 'jacket', label: 'Jacket', metadata: { outfit: { slot: 'outerwear', garmentType: 'jacket' } }, layers: { front: asset } },
  { group: 'prop', id: 'necklace', label: 'Necklace', layers: { front: asset } },
  { group: 'hair', id: 'locs', label: 'Locs', layers: { back: asset, front: asset } },
  { group: 'hair', id: 'short', label: 'Short', layers: { front: asset } },
]
for (const item of draft.variants.slice(1, 5)) draft = activateCharacterVariant(draft, item)
draft = updateCharacterVariantMetadata(draft, 'prop', 'necklace', { composition: { order: [
  { layer: 'front', relation: 'above', target: { group: 'outfit', id: 'shirt', layer: 'front' } },
  { layer: 'front', relation: 'below', target: { group: 'outfit', id: 'jacket', layer: 'front' } },
] } })
const ids = (value = draft) => resolveCharacterDraftLayers(value).map(({ id }) => id)
assert.deepEqual(ids(), ['hair-locs-back', 'body-base-body', 'outfit-shirt-front', 'prop-necklace-front', 'outfit-jacket-front', 'hair-locs-front'])
const pack = buildCharacterPack(draft)
assert.deepEqual(resolveCharacterComposition(pack, pack.defaultComposition).map(({ blobId }) => blobId), ids(), 'export agrees with preview')
const backup = await readCharacterDraftZip(await exportCharacterDraftZip(draft), async () => inspection)
assert.deepEqual(ids(backup.draft), ids(), 'ordering survives backup round trip')
const before = JSON.stringify(draft)
assert.throws(() => updateCharacterVariantMetadata(draft, 'outfit', 'shirt', { composition: { order: [{ layer: 'front', relation: 'above', target: { group: 'outfit', id: 'jacket', layer: 'front' } }] } }), /cycle/)
assert.throws(() => updateCharacterVariantMetadata(draft, 'hair', 'locs', { composition: { order: [{ layer: 'back', relation: 'above', target: { group: 'outfit', id: 'shirt', layer: 'front' } }] } }), /same side/)
assert.throws(() => updateCharacterVariantMetadata(draft, 'hair', 'locs', { composition: { order: [{ layer: 'front', relation: 'above', target: { group: 'prop', id: 'missing', layer: 'front' } }] } }), /missing/)
assert.equal(JSON.stringify(draft), before, 'rejected edits never mutate data')
const short = activateCharacterVariant(draft, { group: 'hair', id: 'short' })
assert.deepEqual(short.selected.items.filter(({ group }) => group === 'hair'), [{ group: 'hair', id: 'short' }])
assert.equal(selectItem(short.variants, short.selected, { group: 'hair', id: 'short' }, true), short.selected, 'activation is idempotent')
assert.ok(!deactivateCharacterVariant(short, { group: 'hair', id: 'short' }).selected.items.some(({ group }) => group === 'hair'), 'all optional items toggle off')
let conflict = deactivateCharacterVariant(draft, { group: 'outfit', id: 'jacket' })
conflict = updateCharacterVariantMetadata(conflict, 'outfit', 'shirt', { composition: { exclusiveKeys: ['torso'] } })
conflict = updateCharacterVariantMetadata(conflict, 'outfit', 'jacket', { composition: { exclusiveKeys: ['torso'] } })
conflict = activateCharacterVariant(conflict, { group: 'outfit', id: 'jacket' })
assert.ok(!conflict.selected.items.some(({ id }) => id === 'shirt'))
assert.ok(conflict.selected.items.some(({ id }) => id === 'necklace'), 'unrelated items survive exclusive replacement')
const removed = removeCharacterVariant(draft, { group: 'outfit', id: 'jacket' })
assert.equal(removed.variants.find(({ id }) => id === 'necklace')!.metadata!.composition!.order!.length, 1, 'delete cleans relation references')
const legacy = { ...draft, schemaVersion: 6, selected: { outfits: ['shirt', 'jacket'], hair: 'locs', props: ['necklace'] }, appearances: [{ id: 'saved', label: 'Saved', selected: { outfits: ['shirt'], props: [] } }] }
const migrated = migrateCharacterDraft(legacy as never)
assert.equal(migrated.schemaVersion, 7)
assert.equal(migrated.variants[0].layers.body, draft.variants[0].layers.body, 'migration preserves original pixels')
assert.deepEqual(migrated.appearances![0].selected.items, [{ group: 'outfit', id: 'shirt' }])
assert.deepEqual(ids(migrated), ids(), 'migration preserves the composition')


let manual = { ...conflict, selected: setSmartOrder(conflict.variants, conflict.selected, false) }
manual = activateCharacterVariant(manual, { group: 'outfit', id: 'shirt' })
manual = activateCharacterVariant(manual, { group: 'hair', id: 'short' })
assert.equal(manual.selected.items.filter(({ group }) => group === 'hair').length, 2)
assert.equal(manual.selected.items.filter(({ group }) => group === 'outfit').length, 2)
assert.deepEqual(ids(manual).filter((id) => !id.endsWith('-back') && id !== 'body-base-body'), manual.selected.items.map(({ group, id }) => `${group}-${id}-front`), 'manual mode is click order across categories')
const restored = setSmartOrder(manual.variants, manual.selected, true)
assert.deepEqual(restored.items.filter(({ group }) => group === 'hair'), [{ group: 'hair', id: 'short' }])
assert.deepEqual(restored.items.filter(({ group }) => group === 'outfit'), [{ group: 'outfit', id: 'shirt' }])
const manualBackup = await readCharacterDraftZip(await exportCharacterDraftZip(manual), async () => inspection)
assert.equal(manualBackup.draft.selected.smartOrder, false)
assert.deepEqual(ids(manualBackup.draft), ids(manual))

const manualPack = buildCharacterPack(manual)
assert.deepEqual(resolveCharacterComposition(manualPack, manualPack.defaultComposition).map(({ blobId }) => blobId), ids(manual), 'manual export agrees with live preview')
console.log('character item composition: smart/manual rules, migration and export parity ok')
