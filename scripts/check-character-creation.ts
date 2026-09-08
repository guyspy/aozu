import assert from 'node:assert/strict'
import { strFromU8, unzipSync, zipSync } from 'fflate'

import { activateCharacterVariant, buildCharacterPack, characterDraftAtlasKey, characterHeadRegistration, characterRegistrationFrame, clearCharacterVariantSelection, copyCharacter, createCharacterDraft, deactivateCharacterVariant, hasCurrentCharacterLayer, installCharacterDraft, listInstalledCharacterPacks, loadCharacterProjection, loadInstalledCharacterPackResources, migrateCharacterDraft, migrateLegacyCharacterLibrary, resolveCharacterAssetSources, resolveCharacterDraftAtlasSources, resolveCharacterDraftLayers, reviewCharacterDraft, saveCharacterDraftAsset, setCharacterVariantTransform, updateCharacterProfile } from '../src/core/application/character-creation.ts'
import { highConfidenceCharacterAutoFit, measureCharacterMaskAlignment, measureProtectedRegionDelta, stitchCharacterEditPixels, suggestCharacterVisualRegistration, type CharacterAlphaMask, type CharacterVisualSample } from '../src/core/application/character-alignment.ts'
import type { CharacterDraftAsset, CharacterVariantGroup, CharacterVariantLayer } from '../src/core/domain/character.ts'
import { resolveCharacterComposition, validateCharacterPack } from '../src/core/domain/character.ts'
import type { CharacterPackLibraryRecord, CharacterRecord } from '../src/core/application/ports.ts'
import { exportCharacterDraftZip, readCharacterDraftZip } from '../src/adapters/zip/character-draft.ts'
import { packCharacterAtlasFrames } from '../src/adapters/browser/character-atlas.ts'

const packedFrames = packCharacterAtlasFrames([
  { id: 'body', width: 100, height: 200, bounds: { x: 20, y: 30, width: 100, height: 200 } },
  { id: 'head', width: 80, height: 70, bounds: { x: 42, y: 18, width: 80, height: 70 } },
])
assert.deepEqual(packedFrames.frames.head.spriteSourceSize, { x: 42, y: 18, w: 80, h: 70 })
assert.deepEqual(packedFrames.frames.body.sourceSize, { w: 512, h: 768 })
assert.equal(packedFrames.frames.body.rotated, false)
assert.throws(() => packCharacterAtlasFrames([
  { id: 'same', width: 1, height: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: 'same', width: 1, height: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } },
]), /unique/)
assert.throws(() => packCharacterAtlasFrames([
  { id: 'huge', width: 4097, height: 1, bounds: { x: 0, y: 0, width: 4097, height: 1 } },
]), /exceeds/)

const inspection = { width: 512, height: 768, hasTransparentPixels: true, hasVisiblePixels: true, genuineRgba: true, visibleBounds: { x: 40, y: 20, width: 430, height: 720 }, visiblePixelCount: 100, size: 10, sha256: 'a'.repeat(64) }
const asset: CharacterDraftAsset = { blob: new Blob(['sprite'], { type: 'image/png' }), filename: 'sprite.png', source: 'user', inspection, canonicalSha256: inspection.sha256 }
const draft = createCharacterDraft('test-character')
draft.name = 'Test Character'
draft.description = 'A determined test character.'
draft.backstory = 'First line.\n\nSecond line.'
draft.attributes = { courage: 8, nocturnal: true }
const put = (group: CharacterVariantGroup, id: string, layer: CharacterVariantLayer) => {
  draft.variants.find((variant) => variant.group === group && variant.id === id)!.layers[layer] = asset
}
put('body', 'base', 'body')
put('outfit', 'outfit-1', 'body')
put('expression', 'happy', 'head')
put('prop', 'prop-1', 'back')
put('prop', 'prop-1', 'front')
draft.variants.push({ group: 'prop', id: 'prop-2', label: 'Prop 2', layers: { back: asset, front: asset } })
draft.selected = { expression: 'happy', outfit: 'outfit-1', props: ['prop-1', 'prop-2'] }
draft.headRegistration = { variantId: 'happy' }
draft.variants.find(({ group, id }) => group === 'expression' && id === 'happy')!.transform = { x: 2, y: -3, scale: 1.01 }

const atlas = {
  image: new Blob(['atlas'], { type: 'image/webp' }),
  data: {
    frames: { 'body-base-body': { frame: { x: 2, y: 2, w: 10, h: 20 }, rotated: false as const, trimmed: true as const, spriteSourceSize: { x: 40, y: 20, w: 10, h: 20 }, sourceSize: { w: 512, h: 768 } } },
    meta: { app: 'Companion' as const, version: '1' as const, image: 'character.atlas.webp' as const, format: 'RGBA8888' as const, size: { w: 14, h: 24 }, scale: '1' as const },
  },
}
const draftZip = await exportCharacterDraftZip(draft, atlas)
const draftArchive = unzipSync(new Uint8Array(await draftZip.arrayBuffer()))
const archivedDraft = JSON.parse(strFromU8(draftArchive['draft.json']!))
const archivedPack = JSON.parse(strFromU8(draftArchive['character-pack.json']!))
assert.equal(archivedDraft.id, draft.id)
assert.equal(draftArchive['experience-draft.json'], undefined)
assert.deepEqual(archivedDraft.selected, draft.selected)
assert.deepEqual(archivedDraft.headRegistration, draft.headRegistration)
assert.equal(archivedDraft.backstory, draft.backstory)
assert.deepEqual(archivedDraft.attributes, draft.attributes)
assert.deepEqual(archivedDraft.variants.find(({ group, id }: { group: string; id: string }) => group === 'expression' && id === 'happy').transform, { x: 2, y: -3, scale: 1.01 })
assert.deepEqual(archivedPack.appearances.find(({ id }: { id: string }) => id === 'expression-happy').layers[0].transform, { x: 2, y: -3, scale: 1.01 })
assert.equal(strFromU8(draftArchive['assets/expression-happy-head.png']!), 'sprite')
assert.equal(strFromU8(draftArchive['character.atlas.webp']!), 'atlas')
assert.equal(JSON.parse(strFromU8(draftArchive['character.atlas.json']!)).frames['body-base-body'].spriteSourceSize.x, 40)
assert.equal(archivedPack.atlas.image, 'character.atlas.webp')
assert.equal(archivedPack.assets.find(({ id }: { id: string }) => id === 'body-base-body').atlasFrame, 'body-base-body')
const restored = await readCharacterDraftZip(draftZip, async () => inspection)
assert.equal(restored.draft.id, draft.id)
assert.equal('published' in restored.draft, false)
assert.deepEqual(restored.draft.selected, draft.selected)
assert.equal(restored.draft.description, draft.description)
assert.equal(restored.draft.backstory, draft.backstory)
assert.deepEqual(restored.draft.attributes, draft.attributes)
assert.deepEqual(restored.draft.variants.find(({ group, id }) => group === 'expression' && id === 'happy')?.transform, { x: 2, y: -3, scale: 1.01 })
assert.equal(await restored.draft.variants.find(({ group, id }) => group === 'expression' && id === 'happy')!.layers.head!.blob.text(), 'sprite')
const missingAssetArchive = { ...draftArchive }
delete missingAssetArchive['assets/expression-happy-head.png']
await assert.rejects(
  () => readCharacterDraftZip(new Blob([zipSync(missingAssetArchive)], { type: 'application/zip' }), async () => inspection),
  /asset is missing or duplicated: assets\/expression-happy-head\.png/,
)

const pack = buildCharacterPack(draft)
assert.equal(migrateCharacterDraft(draft), draft)
const copied = copyCharacter(draft)
assert.notEqual(copied.id, draft.id)
assert.notEqual(copied.packId, draft.packId)
assert.equal(await copied.variants[0]!.layers.body!.blob.text(), 'sprite')
assert.equal(copied.name, 'Test Character copy')
assert.equal(copyCharacter(draft, ['Test Character copy']).name, 'Test Character copy 2')
assert.equal(copyCharacter(draft, ['Test Character copy', 'Test Character copy 2']).name, 'Test Character copy 3')
assert.equal(copyCharacter({ ...draft, name: '' }, ['Untitled Character copy']).name, 'Untitled Character copy 2')
const profiled = updateCharacterProfile(draft, { name: '  Profiled  ', description: '  Summary  ', backstory: 'Line one.\n\nLine two.', attributes: { species: ' boar ', courage: 9 } })
assert.deepEqual({ name: profiled.name, description: profiled.description, backstory: profiled.backstory, attributes: profiled.attributes }, {
  name: 'Profiled', description: 'Summary', backstory: 'Line one.\n\nLine two.', attributes: { courage: 9, species: 'boar' },
})
assert.equal(updateCharacterProfile(profiled, { name: 'Profiled' }), profiled)
assert.throws(() => updateCharacterProfile(profiled, { attributes: { mood: 'calm', ' mood ': 'bold' } }), /must be unique/)
const migratedPublishedCharacter = migrateCharacterDraft({
  ...draft,
  revision: 7,
  published: { version: 3, revision: 7 },
})
assert.equal('published' in migratedPublishedCharacter, false)
assert.equal('revision' in migratedPublishedCharacter, false)
assert.equal('revision' in restored.draft, false)
assert.equal(await migratedPublishedCharacter.variants[0]!.layers.body!.blob.text(), 'sprite')
assert.deepEqual(pack.defaultComposition.map(({ appearanceId }) => appearanceId), ['outfit-outfit-1', 'expression-happy', 'prop-prop-1', 'prop-prop-2'])
assert.deepEqual(
  validateCharacterPack(pack, new Map(pack.assets.map(({ blobId }) => [blobId, inspection]))).map(({ slot }) => slot),
  ['item-back', 'item-back', 'character-skin', 'expression-head', 'item-front', 'item-front'],
)
assert.deepEqual(resolveCharacterDraftLayers(draft).map(({ layerOrder }) => layerOrder), [1, 2, 1, 1, 1, 2])
// Activation order, including reverse creation order, must survive preview and portable export.
const clearedProps = clearCharacterVariantSelection(draft, 'prop')
assert.equal(clearCharacterVariantSelection(clearedProps, 'prop'), clearedProps)
const secondPropFirst = activateCharacterVariant(clearedProps, { group: 'prop', id: 'prop-2' })
const reversedProps = activateCharacterVariant(secondPropFirst, { group: 'prop', id: 'prop-1' })
assert.deepEqual(reversedProps.selected.props, ['prop-2', 'prop-1'])
assert.equal(activateCharacterVariant(reversedProps, { group: 'prop', id: 'prop-2' }), reversedProps)
const reversedLayerIds = ['prop-prop-2-back', 'prop-prop-1-back', 'outfit-outfit-1-body', 'expression-happy-head', 'prop-prop-2-front', 'prop-prop-1-front']
assert.deepEqual(resolveCharacterDraftLayers(reversedProps).map(({ id }) => id), reversedLayerIds)
assert.deepEqual(resolveCharacterDraftLayers(reversedProps, { group: 'prop', id: 'prop-2' }).map(({ id }) => id), reversedLayerIds)
assert.deepEqual(resolveCharacterDraftLayers(secondPropFirst, { group: 'prop', id: 'prop-1' }).map(({ id }) => id), reversedLayerIds)
assert.deepEqual(secondPropFirst.selected.props, ['prop-2'])
const readdedProp = activateCharacterVariant(deactivateCharacterVariant(reversedProps, { group: 'prop', id: 'prop-2' }), { group: 'prop', id: 'prop-2' })
assert.deepEqual(readdedProp.selected.props, ['prop-1', 'prop-2'])
assert.equal(deactivateCharacterVariant(clearedProps, { group: 'prop', id: 'prop-2' }), clearedProps)
assert.deepEqual(draft.selected.props, ['prop-1', 'prop-2'])
assert.throws(() => activateCharacterVariant(draft, { group: 'prop', id: 'missing' }), /not found/)
assert.throws(() => resolveCharacterDraftLayers({ ...draft, selected: { props: ['prop-1', 'prop-1'] } }), /Duplicate selected/)
assert.throws(() => buildCharacterPack({ ...draft, selected: { props: ['missing'] } }), /prop is missing/)
const reversedPack = buildCharacterPack(reversedProps)
assert.deepEqual(resolveCharacterComposition(reversedPack, reversedPack.defaultComposition).map(({ blobId }) => blobId), reversedLayerIds)
const reversedRestored = await readCharacterDraftZip(await exportCharacterDraftZip(reversedProps), async () => inspection)
assert.deepEqual(reversedRestored.draft.selected.props, ['prop-2', 'prop-1'])
assert.deepEqual(resolveCharacterDraftLayers(reversedRestored.draft).map(({ id }) => id), reversedLayerIds)
assert.deepEqual(resolveCharacterDraftLayers(draft).find(({ slot }) => slot === 'expression-head')?.transform, { x: 2, y: -3, scale: 1.01 })
assert.deepEqual(resolveCharacterDraftAtlasSources(draft).find(({ id }) => id === 'expression-happy-head')?.transform, { x: 2, y: -3, scale: 1.01 })
const atlasKey = characterDraftAtlasKey(draft)
assert.equal(characterDraftAtlasKey({ ...draft, name: 'Renamed', updatedAt: draft.updatedAt + 1, selected: { expression: undefined, outfit: undefined, props: [] } }), atlasKey)
assert.equal('revision' in archivedDraft, false)
const movedAtlasDraft = structuredClone(draft)
movedAtlasDraft.variants.find(({ group, id }) => group === 'expression' && id === 'happy')!.transform!.x += 1
assert.notEqual(characterDraftAtlasKey(movedAtlasDraft), atlasKey)
assert.deepEqual(characterRegistrationFrame(draft).footLine, 739)
assert.equal(characterHeadRegistration(draft)?.variant.id, 'happy')
assert.equal(characterRegistrationFrame(draft).head?.variantId, 'happy')
assert.equal(characterRegistrationFrame(draft).head?.calibration.rebasesCurrentExpressions, true)
assert.equal(characterRegistrationFrame(draft).editableRegions.expression?.basis, 'head-anchor')
assert.equal(characterRegistrationFrame(draft).editableRegions.expression?.shape.kind, 'ellipse')
const raincoatAsset = {
  ...asset,
  filename: 'raincoat.png',
  inspection: { ...inspection, sha256: 'b'.repeat(64) },
}
const raincoatDraft = structuredClone(draft)
raincoatDraft.variants.find(({ group, id }) => group === 'outfit' && id === 'outfit-1')!.layers.body = raincoatAsset
const raincoatSources = resolveCharacterAssetSources(raincoatDraft, { group: 'outfit', variantId: 'outfit-1', layer: 'body' })
assert.equal(raincoatSources.current, true)
assert.equal(raincoatSources.editSource, undefined)
assert.equal(raincoatSources.alignmentReference?.filename, 'sprite.png')
raincoatAsset.canonicalSha256 = 'c'.repeat(64)
assert.equal(resolveCharacterAssetSources(raincoatDraft, { group: 'outfit', variantId: 'outfit-1', layer: 'body' }).current, false)
const fallbackRegistration = characterRegistrationFrame({
  ...draft,
  headRegistration: undefined,
  variants: draft.variants.filter(({ group }) => group !== 'expression'),
})
assert.equal(fallbackRegistration.editableRegions.expression?.basis, 'body-bounds-fallback')
assert.equal(resolveCharacterAssetSources({ ...draft, headRegistration: undefined }, { group: 'expression', variantId: 'sad', layer: 'head' }).editSource, undefined)
const preview = await reviewCharacterDraft(async () => inspection, draft)
assert.equal(preview.source, 'character')
assert.equal('bundleId' in preview, false)
const installed: CharacterPackLibraryRecord[] = []
const library = {
  async install(record: CharacterPackLibraryRecord) {
    if (installed.some(({ pack }) => pack.id === record.pack.id && pack.version === record.pack.version)) throw new Error('already installed')
    installed.push(structuredClone(record))
  },
  async list() { return structuredClone(installed) },
}
const firstInstalled = await installCharacterDraft(library, async () => inspection, draft)
assert.equal(firstInstalled.id, pack.id)
assert.equal((await listInstalledCharacterPacks(library, async () => inspection))[0]?.layers.length, 6)
await assert.rejects(() => installCharacterDraft(library, async () => inspection, draft), /already installed/)
const secondVersion = await installCharacterDraft(library, async () => inspection, draft, 2)
assert.equal(secondVersion.version, 2)
assert.equal(secondVersion.defaultComposition.every(({ packVersion }) => packVersion === 2), true)
const secondDraft = structuredClone(draft)
secondDraft.packId = 'test-character-two'
secondDraft.name = 'Test Character Two'
await installCharacterDraft(library, async () => inspection, secondDraft)
assert.equal((await listInstalledCharacterPacks(library, async () => inspection)).length, 3)
const installedResources = await loadInstalledCharacterPackResources(library, async () => inspection, {
  packId: pack.id,
  packVersion: pack.version,
})
assert.equal(installedResources.state.id, `character:${pack.id}:v${pack.version}`)
assert.equal(installedResources.assets.length, pack.assets.length)
await assert.rejects(() => loadInstalledCharacterPackResources(library, async () => inspection, {
  packId: 'missing', packVersion: 1,
}), /not found/)
await assert.rejects(() => loadInstalledCharacterPackResources(library, async () => inspection, {
  packId: pack.id,
  packVersion: pack.version,
  composition: [{ packId: pack.id, packVersion: pack.version, appearanceId: 'missing' }],
}), /Appearance not found/)
const incomplete = createCharacterDraft('incomplete')
assert.throws(() => buildCharacterPack(incomplete), /required/)
await assert.rejects(() => installCharacterDraft(library, async () => inspection, incomplete), /required/)
const incompleteArchive = unzipSync(new Uint8Array(await (await exportCharacterDraftZip(incomplete)).arrayBuffer()))
assert.ok(incompleteArchive['draft.json'])
assert.equal(incompleteArchive['character-pack.json'], undefined)
assert.equal(installed.length, 3)

const legacySource = {
  id: 'current', packId: 'legacy', name: 'Legacy', updatedAt: 1,
  assets: { 'body-base': asset, 'head-neutral': asset, 'head-happy': asset, 'prop-front': asset },
  selectedBody: 'body-base', selectedExpression: 'head-happy',
} as unknown as Parameters<typeof migrateCharacterDraft>[0]
const migrated = migrateCharacterDraft(legacySource)
assert.equal(migrated.id, 'current')
assert.equal(migrated.updatedAt, 1)
assert.deepEqual(migrateCharacterDraft(legacySource), migrated)
assert.equal(migrated.schemaVersion, 4)
assert.equal(migrated.selected.expression, 'happy')
assert.deepEqual(migrated.selected.props, ['prop-1'])
assert.equal(migrated.variants.find(({ group, id }) => group === 'prop' && id === 'prop-1')!.layers.front, asset as CharacterDraftAsset)

// If the entry save committed but legacy cleanup failed, retry may remove only byte-identical legacy work.
const pendingLegacy = new Map([[legacySource.id, legacySource]])
const migratedRows: CharacterRecord[] = []
let failLegacyDelete = true
const legacyRepository = {
  async list() { return [...pendingLegacy.values()] },
  async delete(id: string) {
    if (failLegacyDelete) { failLegacyDelete = false; throw new Error('Legacy cleanup interrupted') }
    pendingLegacy.delete(id)
  },
}
const migratedRepository = {
  async list() { return [...migratedRows] },
  async create(character: typeof draft) {
    const record = { character: { ...structuredClone(character), id: 'mantle-id', updatedAt: 99 }, version: 1 }
    migratedRows.push(record)
    return record
  },
}
await assert.rejects(() => migrateLegacyCharacterLibrary(legacyRepository, migratedRepository), /cleanup interrupted/)
assert.equal(migratedRows.length, 1)
assert.equal(pendingLegacy.size, 1)
await migrateLegacyCharacterLibrary(legacyRepository, migratedRepository)
assert.equal(migratedRows.length, 1)
assert.equal(pendingLegacy.size, 0)
pendingLegacy.set(legacySource.id, { ...legacySource, name: 'Conflicting legacy work' })
await assert.rejects(() => migrateLegacyCharacterLibrary(legacyRepository, migratedRepository), /legacy Character was kept/)
assert.equal(pendingLegacy.size, 1)
pendingLegacy.set(legacySource.id, legacySource)
migratedRows[0]!.character.variants[0]!.layers.body!.blob = new Blob(['broken'], { type: 'image/png' })
await assert.rejects(() => migrateLegacyCharacterLibrary(legacyRepository, migratedRepository), /legacy Character was kept/)
assert.equal(pendingLegacy.size, 1)
assert.equal(migratedRows.length, 1)

const migratedV2 = migrateCharacterDraft({
  id: 'current', schemaVersion: 2, packId: 'v2', name: 'V2', updatedAt: 2,
  variants: [
    { group: 'headwear', id: 'prop-1', label: 'Hat', layers: { front: asset } },
    { group: 'prop', id: 'prop-1', label: 'Wand', layers: { front: asset } },
  ],
  selected: { expression: 'neutral', headwear: 'prop-1', prop: 'prop-1' },
  approvedAt: 1,
} as unknown as Parameters<typeof migrateCharacterDraft>[0])
assert.equal(migratedV2.schemaVersion, 4)
assert.equal('approvedAt' in migratedV2, false)
assert.deepEqual(migratedV2.variants.map(({ group, id }) => `${group}:${id}`), ['prop:hat-1', 'prop:prop-1'])
assert.deepEqual(migratedV2.selected.props, ['hat-1', 'prop-1'])
assert.equal(migratedV2.selected.expression, undefined)

const state = {
  id: 'character:base', collection: 'character-states', status: 'published' as const, version: 1, createdAt: 1, updatedAt: 1,
  data: {
    packId: pack.id,
    packVersion: pack.version,
    composition: [
      { packId: pack.id, packVersion: pack.version, appearanceId: 'body-base' },
      { packId: pack.id, packVersion: pack.version, appearanceId: 'expression-happy' },
    ],
  },
}
const loaded = await loadCharacterProjection(
  {
    async readById(id: string) { return id === state.id ? state : null },
    async readPublished({ collection }: { collection?: string } = {}) {
      return collection === 'character-packs'
        ? [{ id: `pack:${pack.id}`, collection: 'character-packs', status: 'published' as const, version: 1, createdAt: 1, updatedAt: 1, data: { pack } }]
        : []
    },
  } as never,
  () => ({ async get() { return asset.blob } }) as never,
  'bundle-1',
  async () => inspection,
  state.id,
)
assert.deepEqual(loaded?.map(({ slot }) => slot), ['character-skin', 'expression-head'])

const replacementInspection = { ...inspection, sha256: 'b'.repeat(64), visibleBounds: { x: 40, y: 10, width: 430, height: 730 }, visiblePixelCount: 100 }
const before = structuredClone(draft)
let savedDraft = saveCharacterDraftAsset(
  before,
  { group: 'body', variantId: 'base', label: 'New base', layer: 'body' },
  { blob: new Blob(['replacement'], { type: 'image/png' }), filename: 'replacement.png', source: 'agent', inspection: replacementInspection },
)
assert.notEqual(savedDraft, before)
assert.equal(before.variants[0]!.layers.body!.filename, 'sprite.png')
assert.equal(hasCurrentCharacterLayer(savedDraft, 'expression', 'happy', 'head'), false)
assert.deepEqual(resolveCharacterDraftLayers(savedDraft).map(({ slot }) => slot), ['character-skin'])
assert.throws(() => saveCharacterDraftAsset(savedDraft, { group: 'body', variantId: 'other', label: 'Nope', layer: 'body' }, {
  blob: new Blob(['x']), filename: 'x.png', source: 'agent', inspection: replacementInspection,
}), /Unknown character asset target/)
savedDraft = saveCharacterDraftAsset(
  savedDraft,
  { group: 'expression', variantId: 'happy', label: 'New happy', layer: 'head' },
  { blob: new Blob(['happy'], { type: 'image/png' }), filename: 'happy.png', source: 'agent', inspection: { ...replacementInspection, sha256: 'c'.repeat(64), visibleBounds: { x: 60, y: 10, width: 390, height: 350 } } },
)
assert.equal(hasCurrentCharacterLayer(savedDraft, 'expression', 'happy', 'head'), true)
assert.equal(savedDraft.variants.find(({ group, id }) => group === 'expression' && id === 'happy')?.label, 'New happy')
savedDraft = saveCharacterDraftAsset(
  savedDraft,
  { group: 'expression', variantId: 'angry', label: 'New angry', layer: 'head' },
  { blob: new Blob(['angry'], { type: 'image/png' }), filename: 'angry.png', source: 'agent', inspection: { ...replacementInspection, sha256: 'd'.repeat(64), visibleBounds: { x: 62, y: 11, width: 388, height: 348 } } },
)
const characterMask = (...rectangles: Array<{ x: number; y: number; width: number; height: number }>): CharacterAlphaMask => {
  const alpha = new Uint8Array(512 * 768)
  for (const rectangle of rectangles) for (let y = rectangle.y; y < rectangle.y + rectangle.height; y++) {
    alpha.fill(255, y * 512 + rectangle.x, y * 512 + rectangle.x + rectangle.width)
  }
  return { width: 512, height: 768, alpha }
}
const canonicalMask = characterMask(
  { x: 100, y: 20, width: 312, height: 300 },
  { x: 220, y: 320, width: 72, height: 20 },
  { x: 120, y: 340, width: 272, height: 320 },
  { x: 150, y: 660, width: 80, height: 70 },
  { x: 282, y: 660, width: 80, height: 70 },
)
const wholeHeadMask = characterMask({ x: 100, y: 20, width: 312, height: 300 }, { x: 220, y: 320, width: 72, height: 20 })
assert.equal(measureCharacterMaskAlignment('outfit', canonicalMask, canonicalMask).status, 'aligned')
assert.equal(measureCharacterMaskAlignment('outfit', canonicalMask, characterMask(
  { x: 100, y: 20, width: 312, height: 300 },
  { x: 200, y: 320, width: 112, height: 20 },
  { x: 110, y: 340, width: 292, height: 320 },
  { x: 150, y: 660, width: 80, height: 70 },
  { x: 282, y: 660, width: 80, height: 70 },
)).status, 'aligned')
assert.equal(measureCharacterMaskAlignment('outfit', canonicalMask, characterMask({ x: 140, y: 340, width: 232, height: 250 })).status, 'invalid')
assert.equal(measureCharacterMaskAlignment('expression', wholeHeadMask, wholeHeadMask).status, 'aligned')
assert.equal(measureCharacterMaskAlignment('expression', null, wholeHeadMask).status, 'unverified')
assert.equal(measureCharacterMaskAlignment('expression', wholeHeadMask, characterMask({ x: 190, y: 130, width: 132, height: 80 })).status, 'invalid')
assert.equal(measureCharacterMaskAlignment('outfit', canonicalMask, canonicalMask, { x: 20, y: 20, scale: 1 }).status, 'misaligned')
assert.equal(measureCharacterMaskAlignment('outfit', canonicalMask, characterMask({ x: 0, y: 0, width: 10, height: 10 })).diagnostics[0]?.code, 'ALPHA_TOUCHES_CANVAS_EDGE')
const boarHeadMask = characterMask({ x: 100, y: 100, width: 300, height: 300 })
const boarHeadTransform = { x: 105, y: -40, scale: 0.55 }
const boarAlignment = measureCharacterMaskAlignment('expression', boarHeadMask, boarHeadMask, undefined, boarHeadTransform)
assert.equal(boarAlignment.status, 'misaligned')
assert.deepEqual(highConfidenceCharacterAutoFit(boarAlignment), boarHeadTransform)
const visualSample = (left: number, top: number): CharacterVisualSample => {
  const width = 64; const height = 96; const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const pixel = ((top + y) * width + left + x) * 4
    const value = (x * 37 + y * 73 + x * y * 11) % 256
    rgba[pixel] = value; rgba[pixel + 1] = value * 3 % 256; rgba[pixel + 2] = value * 7 % 256; rgba[pixel + 3] = 255
  }
  return { width, height, rgba }
}
const visualFit = suggestCharacterVisualRegistration(visualSample(32, 4), visualSample(8, 8))
assert.ok(visualFit?.suggestedTransform)
assert.deepEqual(visualFit.suggestedTransform, { x: 192, y: -32, scale: 1 })
const protectedReference = visualSample(0, 0)
protectedReference.rgba.fill(64)
for (let index = 3; index < protectedReference.rgba.length; index += 4) protectedReference.rgba[index] = 255
const protectedRegion = { source: 'registration-derived' as const, basis: 'head-anchor' as const, shape: { kind: 'ellipse' as const, cx: 256, cy: 192, rx: 128, ry: 96 } }
const insideEdit = structuredClone(protectedReference)
insideEdit.rgba[(24 * 64 + 32) * 4] = 255
assert.equal(measureProtectedRegionDelta(protectedReference, insideEdit, protectedRegion)?.protectedChangeRatio, 0)
const outsideEdit = structuredClone(protectedReference)
outsideEdit.rgba[(2 * 64 + 2) * 4] = 255
const protectedDelta = measureProtectedRegionDelta(protectedReference, outsideEdit, protectedRegion)
assert.equal(protectedDelta?.changedPixels, 1)
assert.ok((protectedDelta?.protectedChangeRatio ?? 0) > 0)
const editProposal = structuredClone(outsideEdit)
editProposal.rgba[(24 * 64 + 32) * 4] = 255
const stitchedEdit = stitchCharacterEditPixels(protectedReference, editProposal, protectedRegion)
assert.equal(stitchedEdit.rgba[(2 * 64 + 2) * 4], 64)
assert.equal(stitchedEdit.rgba[(24 * 64 + 32) * 4], 255)
assert.equal(measureProtectedRegionDelta(protectedReference, stitchedEdit, protectedRegion)?.protectedChangeRatio, 0)
const transformed = setCharacterVariantTransform(savedDraft, 'expression', 'happy', { x: 2, y: -3, scale: 0.505 })
assert.deepEqual(transformed.variants.find(({ group, id }) => group === 'expression' && id === 'happy')?.transform, { x: 2, y: -3, scale: 0.505 })
assert.deepEqual(transformed.variants.find(({ group, id }) => group === 'expression' && id === 'angry')?.transform, { x: 2, y: -3, scale: 0.505 })
assert.equal(savedDraft.variants.find(({ group, id }) => group === 'expression' && id === 'happy')?.transform, undefined)
assert.throws(() => setCharacterVariantTransform(savedDraft, 'body', 'base', { x: 0, y: 0, scale: 1 }), /locked/)
assert.throws(() => setCharacterVariantTransform(savedDraft, 'expression', 'happy', { x: 9999, y: 0, scale: 1 }), /canvas/)
console.log('character creation: ok')
