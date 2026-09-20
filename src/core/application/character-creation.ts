import { itemKey, sameItem, selectItem, migrateItemSelection, orderItemLayers } from '../domain/character-composition.ts'
import type { EntryReader } from '@aotter/mantle-runtime'
import { characterAssets } from './character-assets.ts'
import { CHARACTER_BACKGROUND_GUIDANCE } from './character-agent-guidance.ts'
import { validateCharacterAppearances, validateCharacterSelection } from './character-appearances.ts'

import {
  CHARACTER_RIG,
  CHARACTER_VARIANT_GROUPS,
  CHARACTER_VARIANT_LAYERS,
  IDENTITY_CHARACTER_TRANSFORM,
  resolveCharacterComposition,
  validateCharacterVariantTransform,
  validateCharacterPack,
  type AppearanceRef,
  type CharacterAssetTarget,
  type CharacterAtlasSource,
  type CharacterAssetInspection,
  type CharacterDraft,
  type CharacterDraftAsset,
  type CharacterDraftVariant,
  type CharacterPack,
  type ResolvedCharacterLayer,
  type CharacterVariantGroup,
  type CharacterVariantLayer,
  type CharacterVariantTransform,
} from '../domain/character.ts'
import type { ValidatedStarterPackage } from '../domain/starter.ts'
import type { StagedCandidatePreview } from './candidate.ts'
import type {
  AssetRepositoryFactory,
  CharacterDraftRepository,
  CharacterPackLibraryRecord,
  CharacterPackLibraryRepository,
} from './ports.ts'

export { CHARACTER_CREATION_GROUPS } from './character-asset-policy.ts'

export const REQUIRED_CHARACTER_TARGETS = [
  { group: 'body', variantId: 'base', layer: 'body' },
] as const

const MAX_ASSET_BYTES = 5 * 1024 * 1024
const variantIdPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/
const roundTransformValue = (value: number) => Math.round(value * 10_000) / 10_000
const initialVariants = (): CharacterDraftVariant[] => [
  { group: 'body', id: 'base', label: 'Canonical Body', layers: {} },
  { group: 'expression', id: 'happy', label: 'Happy', metadata: { faceStyleId: 'default' }, layers: {} },
  { group: 'expression', id: 'sad', label: 'Sad', metadata: { faceStyleId: 'default' }, layers: {} },
  { group: 'expression', id: 'angry', label: 'Angry', metadata: { faceStyleId: 'default' }, layers: {} },
  { group: 'expression', id: 'surprised', label: 'Surprised', metadata: { faceStyleId: 'default' }, layers: {} },
  { group: 'expression', id: 'sleepy', label: 'Sleepy', metadata: { faceStyleId: 'default' }, layers: {} },
  { group: 'outfit', id: 'top-1', label: 'Top 1', metadata: { outfit: { slot: 'top', garmentType: 'top' } }, layers: {} },
  { group: 'outfit', id: 'bottom-1', label: 'Bottom 1', metadata: { outfit: { slot: 'bottom', garmentType: 'bottom' } }, layers: {} },
  { group: 'hair', id: 'hair-1', label: 'Hair 1', layers: {} },
  { group: 'headwear', id: 'headwear-1', label: 'Headwear 1', layers: {} },
  { group: 'prop', id: 'prop-1', label: 'Prop 1', layers: {} },
]

export const createCharacterDraft = (packId: string = `character-${crypto.randomUUID()}`, id: string = crypto.randomUUID()): CharacterDraft => ({
  id,
  schemaVersion: 7,
  packId,
  rigProfile: { id: CHARACTER_RIG.id, version: CHARACTER_RIG.version },
  name: 'My Companion',
  variants: initialVariants(),
  faceStyles: [{ id: 'default', label: 'Default', facialHair: null }],
  selected: { smartOrder: true, items: [] },
  updatedAt: Date.now(),
})

/** `<name> copy`, then the smallest free numeric suffix, so same-name Characters stay distinguishable. */
export const copyCharacter = (character: CharacterDraft, existingNames: readonly string[] = []): CharacterDraft => {
  const base = `${character.name || 'Untitled Character'} copy`
  const taken = new Set(existingNames)
  let name = base
  for (let suffix = 2; taken.has(name); suffix++) name = `${base} ${suffix}`
  return {
    ...structuredClone(character),
    id: crypto.randomUUID(),
    packId: `character-${crypto.randomUUID()}`,
    name,
    updatedAt: Date.now(),
  }
}

export const isCharacterDraftPopulated = (draft: CharacterDraft) => draft.variants.some(({ layers }) => Object.keys(layers).length > 0)

import { validateCharacterVariantMetadata } from './character-metadata.ts'
export { updateCharacterProfile, updateCharacterVariantMetadata, validateCharacterVariantMetadata } from './character-metadata.ts'

const boundsCenter = ({ x, y, width, height }: NonNullable<CharacterAssetInspection['visibleBounds']>) => ({
  x: x + width / 2,
  y: y + height / 2,
})

type Bounds = NonNullable<CharacterAssetInspection['visibleBounds']>
export type CharacterEditableRegion = {
  source: 'registration-derived'
  basis: 'head-anchor' | 'body-bounds-fallback'
  shape: { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
}

const regionNumber = (value: number) => Math.round(value * 100) / 100
const headEnvelope = (bodyBounds?: Bounds, headBounds?: Bounds) => {
  if (!bodyBounds) return undefined
  return {
    basis: headBounds ? 'head-anchor' as const : 'body-bounds-fallback' as const,
    bounds: headBounds ?? {
      x: bodyBounds.x + bodyBounds.width * 0.15,
      y: bodyBounds.y,
      width: bodyBounds.width * 0.7,
      height: bodyBounds.height * 0.42,
    },
  }
}
const editableRegions = (bodyBounds?: Bounds, headBounds?: Bounds) => {
  const envelope = headEnvelope(bodyBounds, headBounds)
  if (!envelope) return {}
  const { basis, bounds: head } = envelope
  return {
    expression: {
      source: 'registration-derived' as const,
      basis,
      shape: {
        kind: 'ellipse' as const,
        cx: regionNumber(head.x + head.width * 0.5),
        cy: regionNumber(head.y + head.height * 0.55),
        rx: regionNumber(head.width * 0.3),
        ry: regionNumber(head.height * 0.28),
      },
    },
  }
}

export function characterRegistrationFrame(draft: CharacterDraft) {
  const bodyBounds = draft.variants.find(({ group, id }) => group === 'body' && id === 'base')?.layers.body?.inspection.visibleBounds
  const head = characterHeadRegistration(draft)
  const headBounds = head?.asset.inspection.visibleBounds
    ? transformCharacterBounds(head.asset.inspection.visibleBounds, head.transform)
    : undefined
  const envelope = headEnvelope(bodyBounds, headBounds)
  return {
    canvas: { ...CHARACTER_RIG.canvas },
    ...(bodyBounds ? { bodyBounds: { ...bodyBounds }, bodyCenter: boundsCenter(bodyBounds), footLine: bodyBounds.y + bodyBounds.height - 1 } : {}),
    ...(envelope ? { headEnvelope: envelope } : {}),
    ...(head && headBounds ? {
      head: {
        variantId: head.variant.id,
        transform: { ...head.transform },
        bounds: headBounds,
        calibration: {
          status: 'visual-required' as const,
          rebasesCurrentExpressions: true,
        },
      },
    } : {}),
    editableRegions: editableRegions(bodyBounds, headBounds),
  }
}

export function transformCharacterBounds(
  bounds: NonNullable<CharacterAssetInspection['visibleBounds']>,
  transform: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM,
) {
  return {
    x: transform.x + bounds.x * transform.scale,
    y: transform.y + bounds.y * transform.scale,
    width: bounds.width * transform.scale,
    height: bounds.height * transform.scale,
  }
}

const starterCharacter = (loaded: ValidatedStarterPackage, stateId: string) => {
  const state = loaded.starter.characterStates.find(({ id }) => id === stateId)
  if (!state) throw new Error(`Character state not found: ${stateId}`)
  const blobs = new Map(loaded.assets.map(({ id, blob }) => [id, blob]))
  return { state, blobs }
}

export function resolveStarterCharacterLayers(loaded: ValidatedStarterPackage, stateId: string) {
  const { state, blobs } = starterCharacter(loaded, stateId)
  return resolveCharacterComposition(loaded.starter.characterPack, state.composition).map((layer) => {
    const blob = blobs.get(layer.blobId)
    if (!blob) throw new Error(`Starter character asset is missing: ${layer.blobId}`)
    return { ...layer, blob }
  })
}

export function createCharacterDraftFromStarter(loaded: ValidatedStarterPackage, stateId: string, draftId = 'current'): CharacterDraft {
  const { state, blobs } = starterCharacter(loaded, stateId)
  const pack = loaded.starter.characterPack
  const appearances = new Map(pack.appearances.map((appearance) => [appearance.id, appearance]))
  const assets = new Map(pack.assets.map((asset) => [asset.id, asset]))
  const files = new Map(loaded.starter.assetFiles.map((file) => [file.blobId, file]))
  const draft = createCharacterDraft(undefined, draftId)
  const propIds = new Map<string, string>()
  const usedPropIds = new Set<string>()
  const propId = (appearanceId: string) => {
    const existing = propIds.get(appearanceId)
    if (existing) return existing
    const base = appearanceId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 40) || 'prop'
    let id = base
    let suffix = 2
    while (usedPropIds.has(id)) id = `${base.slice(0, 37)}-${suffix++}`
    usedPropIds.add(id)
    propIds.set(appearanceId, id)
    return id
  }
  const put = (group: CharacterVariantGroup, id: string, label: string, layer: CharacterVariantLayer, assetId: string) => {
    const definition = assets.get(assetId)
    const blob = definition && blobs.get(definition.blobId)
    const inspection = definition && loaded.characterInspections.get(definition.blobId)
    const file = definition && files.get(definition.blobId)
    if (!definition || !blob || !inspection || !file) throw new Error(`Starter character asset is missing: ${assetId}`)
    let variant = draft.variants.find((candidate) => candidate.group === group && candidate.id === id)
    if (!variant) {
      variant = { group, id, label, layers: {} }
      draft.variants.push(variant)
    }
    if (variant.layers[layer]) throw new Error(`Starter character layer cannot be edited: ${group}:${id}:${layer}`)
    variant.layers[layer] = {
      blob,
      filename: file.path.split('/').at(-1) ?? file.path,
      source: 'starter',
      inspection,
    }
  }
  for (const reference of state.composition) {
    const appearance = appearances.get(reference.appearanceId)
    if (!appearance) throw new Error(`Starter appearance not found: ${reference.appearanceId}`)
    for (const layer of appearance.layers) {
      if (layer.slot === 'character-skin') put('body', 'base', 'Canonical Body', 'body', layer.asset.assetId)
      else if (layer.slot === 'prop-back' || layer.slot === 'prop-front') {
        const id = propId(appearance.id)
        put('prop', id, appearance.id, layer.slot === 'prop-back' ? 'back' : 'front', layer.asset.assetId)
      }
    }
  }
  if (!isCharacterDraftPopulated(draft) || !draft.variants.find(({ group, id }) => group === 'body' && id === 'base')?.layers.body) {
    throw new Error('Starter character is not editable with the current rig')
  }
  const canonicalSha256 = draft.variants.find(({ group, id }) => group === 'body' && id === 'base')!.layers.body!.inspection.sha256
  for (const variant of draft.variants) {
    if (variant.group === 'body') continue
    for (const asset of Object.values(variant.layers)) if (asset) asset.canonicalSha256 = canonicalSha256
  }
  draft.selected.items.push(...[...propIds.values()].map((id) => ({ group: 'prop' as const, id })))
  return draft
}

const withHeadRegistration = (draft: CharacterDraft): CharacterDraft => {
  const canonicalSha256 = draft.variants.find(({ group, id }) => group === 'body' && id === 'base')?.layers.body?.inspection.sha256
  const current = (variant: CharacterDraftVariant) => Boolean(canonicalSha256)
    && variant.group === 'expression' && variant.layers.head?.canonicalSha256 === canonicalSha256
  const registered = draft.variants.find((variant) => variant.id === draft.headRegistration?.variantId && current(variant))
  if (registered) return draft
  const fallback = draft.variants.find(current)
  if (fallback) return { ...draft, headRegistration: { variantId: fallback.id } }
  if (!draft.headRegistration) return draft
  const { headRegistration: _discarded, ...withoutRegistration } = draft
  return withoutRegistration as CharacterDraft
}

type LegacyCharacterDraft = Omit<CharacterDraft, 'schemaVersion' | 'faceStyles' | 'selected' | 'variants' | 'appearances'> & {
  schemaVersion: 4 | 5 | 6
  faceStyles?: CharacterDraft['faceStyles']
  selected: Record<string, unknown>
  variants: Array<Omit<CharacterDraftVariant, 'layers'> & { layers: Record<string, CharacterDraftAsset> }>
  appearances?: Array<Omit<NonNullable<CharacterDraft['appearances']>[number], 'selected'> & { selected: Record<string, unknown> }>
}

const migrateCharacterVariant = (variant: LegacyCharacterDraft['variants'][number], faceStyleId: string): CharacterDraftVariant => {
  let layers = variant.layers
  if (variant.group === 'outfit' && layers.body) {
    const { body, ...rest } = layers
    layers = { ...rest, front: layers.front ?? body }
  }
  return {
    ...variant,
    ...(variant.group === 'expression' ? { metadata: { ...variant.metadata, faceStyleId: variant.metadata?.faceStyleId ?? faceStyleId } }
      : variant.group === 'outfit' ? { metadata: { ...variant.metadata, outfit: variant.metadata?.outfit ?? { slot: 'one-piece', garmentType: variant.label } } }
        : {}),
    layers,
  }
}

export function migrateCharacterDraft(input: CharacterDraft | LegacyCharacterDraft): CharacterDraft {
  if (![4, 5, 6, 7].includes(input.schemaVersion)) throw new Error('Unsupported Character Draft schema version')
  if (input.schemaVersion === 7) return withHeadRegistration(input as CharacterDraft)
  const schemaVersion = input.schemaVersion
  const faceStyleId = input.faceStyles?.[0]?.id ?? 'default'
  const draft = {
    ...input,
    schemaVersion: 7 as const,
    rigProfile: { id: CHARACTER_RIG.id, version: CHARACTER_RIG.version },
    faceStyles: input.faceStyles?.length ? structuredClone(input.faceStyles) : [{ id: faceStyleId, label: 'Default', facialHair: null }],
    variants: input.variants.map((variant) => migrateCharacterVariant(variant, faceStyleId)),
    selected: migrateItemSelection(input.selected, schemaVersion),
    appearances: input.appearances?.map((appearance) => ({ ...appearance, selected: migrateItemSelection(appearance.selected, schemaVersion) })),
  } satisfies CharacterDraft
  validateCharacterVariantMetadata(draft)
  validateCharacterSelection(draft, draft.selected)
  validateCharacterAppearances(draft)
  return withHeadRegistration(draft)
}

const characterContentJson = (draft: CharacterDraft) => {
  const { id: _id, updatedAt: _updatedAt, description, backstory, attributes, ...content } = draft
  return JSON.stringify({
    ...content,
    description: description || undefined,
    backstory: backstory || undefined,
    attributes: attributes && Object.keys(attributes).length ? attributes : undefined,
  }, (_key, value: unknown) => value instanceof Blob ? undefined
    : value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value)
}

const samePersistedCharacterContent = async (left: CharacterDraft, right: CharacterDraft) => {
  if (characterContentJson(left) !== characterContentJson(right)) return false
  const others = new Map(characterAssets(right).map((asset) => [asset.inspection.sha256, asset]))
  for (const asset of characterAssets(left)) {
    const other = others.get(asset.inspection.sha256)
    if (!other || asset.blob.type !== other.blob.type || asset.blob.size !== other.blob.size) return false
    const [leftBytes, rightBytes] = await Promise.all([asset.blob.arrayBuffer(), other.blob.arrayBuffer()])
    const expected = new Uint8Array(rightBytes)
    if (!new Uint8Array(leftBytes).every((byte, offset) => byte === expected[offset])) return false
  }
  return true
}

/** Interrupted migrations are replayable; a colliding pack never silently discards different legacy work. */
export async function migrateLegacyCharacterLibrary(
  legacy: { list(): Promise<Array<Parameters<typeof migrateCharacterDraft>[0]>>; delete(id: string): Promise<void> },
  characters: Pick<CharacterDraftRepository, 'list' | 'create'>,
) {
  const pending = await legacy.list()
  if (!pending.length) return
  const current = await characters.list()
  for (const stored of pending) {
    const draft = migrateCharacterDraft(stored)
    const matches = current.filter(({ character }) => character.packId === draft.packId)
    if (matches.length > 1 || (matches[0] && !await samePersistedCharacterContent(draft, migrateCharacterDraft(matches[0].character)))) {
      throw new Error(`Legacy Character migration conflicts with existing pack ${draft.packId}; the legacy Character was kept`)
    }
    if (!matches.length) current.push(await characters.create(draft))
    await legacy.delete(stored.id)
  }
}

export function characterAssetInspectionRejection(inspection: CharacterAssetInspection) {
  if (inspection.width !== CHARACTER_RIG.canvas.width || inspection.height !== CHARACTER_RIG.canvas.height) {
    return { code: 'INVALID_CANVAS', message: `Asset must use the ${CHARACTER_RIG.canvas.width}×${CHARACTER_RIG.canvas.height} canvas.` }
  }
  if (!inspection.hasVisiblePixels) return { code: 'MISSING_VISIBLE_PIXELS', message: 'Asset must contain visible artwork.' }
  if (!inspection.hasTransparentPixels) {
    return {
      code: 'OPAQUE_BACKGROUND',
      message: `Asset has no transparent pixels. ${CHARACTER_BACKGROUND_GUIDANCE}`,
    }
  }
  if (!inspection.genuineRgba) return { code: 'INVALID_RGBA', message: 'Asset must be a genuine RGBA PNG.' }
  if (inspection.size < 1 || inspection.size > MAX_ASSET_BYTES) return { code: 'INVALID_FILE_SIZE', message: 'Asset must be under 5 MiB.' }
  return null
}

export function validateCharacterAssetInspection(inspection: CharacterAssetInspection) {
  const rejection = characterAssetInspectionRejection(inspection)
  if (rejection) throw new Error(rejection.message)
}

/** Pure command: returns the next Character with one variant transform applied (head anchors rebase current expressions). */
export function setCharacterVariantTransform(
  draft: CharacterDraft,
  group: CharacterVariantGroup,
  variantId: string,
  transform: CharacterVariantTransform,
): CharacterDraft {
  if (group === 'body') throw new Error('The canonical body registration is locked')
  validateCharacterVariantTransform(transform)
  const variant = draft.variants.find(({ group: candidateGroup, id }) => candidateGroup === group && id === variantId)
  if (!variant || !Object.values(variant.layers).some(Boolean)) throw new Error('Character variant is empty or missing')
  const remainsVisible = Object.values(variant.layers).some((asset) => {
    if (!asset?.inspection.visibleBounds) return false
    const bounds = transformCharacterBounds(asset.inspection.visibleBounds, transform)
    return bounds.x + bounds.width > 0 && bounds.y + bounds.height > 0 && bounds.x < CHARACTER_RIG.canvas.width && bounds.y < CHARACTER_RIG.canvas.height
  })
  if (!remainsVisible) throw new Error('Character transform moves every layer outside the canvas')
  const previousTransform = variant.transform ?? IDENTITY_CHARACTER_TRANSFORM
  const rebasesHeads = group === 'expression' && draft.headRegistration?.variantId === variantId
  const rebase = (source: CharacterVariantTransform = IDENTITY_CHARACTER_TRANSFORM) => {
    const ratio = transform.scale / previousTransform.scale
    const rebased = {
      x: roundTransformValue(transform.x + (source.x - previousTransform.x) * ratio),
      y: roundTransformValue(transform.y + (source.y - previousTransform.y) * ratio),
      scale: roundTransformValue(source.scale * ratio),
    }
    validateCharacterVariantTransform(rebased)
    return rebased
  }
  return {
    ...draft,
    variants: draft.variants.map((candidate) => candidate === variant
      ? { ...candidate, transform: { ...transform } }
      : rebasesHeads && candidate.group === 'expression' && isCharacterDraftAssetCurrent(draft, candidate, 'head')
        ? { ...candidate, transform: rebase(candidate.transform) }
        : candidate),
  }
}

/** Pure command: returns the next Character with one already-stored asset placed at `target`. */
export function saveCharacterDraftAsset(
  draft: CharacterDraft,
  target: CharacterAssetTarget,
  { blob, filename, source, inspection }: Omit<CharacterDraftAsset, 'canonicalSha256'>,
  rebaseDerivedAssets = false,
): CharacterDraft {
  if (
    !CHARACTER_VARIANT_GROUPS.includes(target.group) ||
    (target.group === 'body' && target.variantId !== 'base') ||
    !(CHARACTER_VARIANT_LAYERS[target.group] as readonly string[]).includes(target.layer) ||
    !variantIdPattern.test(target.variantId) ||
    !target.label.trim() || target.label.trim().length > 80
  ) throw new Error('Unknown character asset target')
  validateCharacterAssetInspection(inspection)
  const previousCanonical = draft.variants.find(({ group, id }) => group === 'body' && id === 'base')?.layers.body?.inspection.sha256
  const derived = !(target.group === 'body' && target.variantId === 'base')
  const asset: CharacterDraftAsset = {
    blob, filename, source, inspection,
    ...(derived && previousCanonical ? { canonicalSha256: previousCanonical } : {}),
  }
  const existing = draft.variants.find((variant) => variant.group === target.group && variant.id === target.variantId)
  if (!existing && ['expression', 'outfit', 'hair', 'headwear'].includes(target.group)) {
    throw new Error(target.group === 'outfit'
      ? 'Create the outfit metadata first. Wardrobe accepts garment-only transparent overlays; never include body pixels or a dressed character composite.'
      : 'Create the variant metadata before installing its asset')
  }
  const variants = existing
    ? draft.variants.map((variant) => variant === existing
      ? { ...variant, label: target.label.trim(), layers: { ...variant.layers, [target.layer]: asset }, transform: undefined }
      : variant)
    : [...draft.variants, { group: target.group, id: target.variantId, label: target.label.trim(), layers: { [target.layer]: asset } }]
  const nextVariants = !derived && previousCanonical && previousCanonical !== inspection.sha256
    ? variants.map((variant) => variant.group === 'body' ? variant : {
        ...variant,
        layers: Object.fromEntries(Object.entries(variant.layers).map(([layer, current]) => [
          layer,
          current && rebaseDerivedAssets && current.canonicalSha256 === previousCanonical
            ? { ...current, canonicalSha256: inspection.sha256 }
            : current && !current.canonicalSha256 ? { ...current, canonicalSha256: previousCanonical } : current,
        ])),
      })
    : variants
  return {
    ...draft,
    variants: nextVariants,
    ...(!derived && previousCanonical && previousCanonical !== inspection.sha256 && !rebaseDerivedAssets
      ? { headRegistration: undefined }
      : target.group === 'expression' && !draft.headRegistration
        ? { headRegistration: { variantId: target.variantId } }
        : {}),
  }
}

const ref = (pack: CharacterPack, appearanceId: string): AppearanceRef => ({
  packId: pack.id,
  packVersion: pack.version,
  appearanceId,
})

const variantKey = ({ group, id }: Pick<CharacterDraftVariant, 'group' | 'id'>) => `${group}-${id}`
const assetKey = (variant: Pick<CharacterDraftVariant, 'group' | 'id'>, layer: CharacterVariantLayer) => `${variantKey(variant)}-${layer}`
type VariantMetadata = Omit<CharacterDraftVariant, 'layers'> & { layers: Partial<Record<CharacterVariantLayer, Pick<CharacterDraftAsset, 'inspection' | 'canonicalSha256'>>> }
type SelectionMetadata<V extends VariantMetadata = VariantMetadata> = { variants: V[]; selected: CharacterDraft['selected'] }
const findVariant = <V extends VariantMetadata>(draft: { variants: V[] }, group: CharacterVariantGroup, id: string) => draft.variants.find((variant) => variant.group === group && variant.id === id)
const canonicalAsset = (draft: CharacterDraft) => findVariant(draft, 'body', 'base')?.layers.body

export function characterHeadRegistration(draft: CharacterDraft) {
  const variant = draft.headRegistration && findVariant(draft, 'expression', draft.headRegistration.variantId)
  const asset = variant?.layers.head
  if (!variant || !asset || !isCharacterDraftAssetCurrent(draft, variant, 'head')) return null
  return { variant, asset, transform: variant.transform ?? IDENTITY_CHARACTER_TRANSFORM }
}

export function isCharacterDraftAssetCurrent(
  draft: { variants: VariantMetadata[] },
  variant: VariantMetadata,
  layer: CharacterVariantLayer,
) {
  const asset = variant.layers[layer]
  if (!asset) return false
  if (variant.group === 'body') return variant.id === 'base' && layer === 'body'
  const canonical = findVariant(draft, 'body', 'base')?.layers.body
  if (!canonical) return false
  return asset.canonicalSha256 === canonical.inspection.sha256
}

export function resolveCharacterAssetSources(
  draft: CharacterDraft,
  input: Pick<CharacterAssetTarget, 'group' | 'variantId' | 'layer'>,
) {
  const variant = findVariant(draft, input.group, input.variantId)
  const asset = variant?.layers[input.layer]
  const canonical = canonicalAsset(draft)
  const headRegistration = characterHeadRegistration(draft)
  const expressionReference = headRegistration?.asset
  const current = Boolean(asset && variant && isCharacterDraftAssetCurrent(draft, variant, input.layer))
  const transform = variant?.transform ?? IDENTITY_CHARACTER_TRANSFORM
  return {
    asset,
    canonical,
    headRegistration,
    current,
    transform,
    alignmentReference: input.group === 'expression' && headRegistration?.variant.id !== input.variantId
      ? expressionReference
      : ['outfit', 'hair', 'headwear', 'prop'].includes(input.group) ? canonical : undefined,
    referenceTransform: input.group === 'expression' ? headRegistration?.transform : undefined,
    editSource: current && input.group === 'expression' ? asset : undefined,
    editSourceTransform: current && input.group === 'expression' ? transform : undefined,
  }
}

export const hasCurrentCharacterLayer = (
  draft: SelectionMetadata,
  group: CharacterVariantGroup,
  id: string,
  layer: CharacterVariantLayer,
) => {
  const variant = findVariant(draft, group, id)
  return Boolean(variant && isCharacterDraftAssetCurrent(draft, variant, layer))
}

export function activateCharacterVariant(draft: CharacterDraft, target: Pick<CharacterDraftVariant, 'group' | 'id'>) {
  const selected = selectItem(draft.variants, draft.selected, target, true)
  return selected === draft.selected ? draft : { ...draft, selected }
}

export function deactivateCharacterVariant(draft: CharacterDraft, target: Pick<CharacterDraftVariant, 'group' | 'id'>) {
  const selected = selectItem(draft.variants, draft.selected, target, false)
  return selected === draft.selected ? draft : { ...draft, selected }
}

export function clearCharacterVariantSelection(draft: CharacterDraft, group: CharacterVariantGroup) {
  return draft.selected.items.some((item) => item.group === group)
    ? { ...draft, selected: { ...draft.selected, items: draft.selected.items.filter((item) => item.group !== group) } } : draft
}

/** Remove artwork and its selection/order references from all saved looks in one edit. */
export function removeCharacterVariant(draft: CharacterDraft, target: Pick<CharacterDraftVariant, 'group' | 'id'>) {
  if (target.group === 'body') throw new Error('Canonical Body cannot be deleted')
  if (!findVariant(draft, target.group, target.id)) throw new Error('Character variant not found')
  const without = (selected: CharacterDraft['selected']) => ({ ...selected, items: selected.items.filter((item) => !sameItem(item, target)) })
  const next = { ...draft,
    variants: draft.variants.filter((item) => !sameItem(item, target)).map((item) => item.metadata?.composition?.order
      ? { ...item, metadata: { ...item.metadata, composition: { ...item.metadata.composition, order: item.metadata.composition.order.filter((rule) => !sameItem(rule.target, target)) } } } : item),
    selected: without(draft.selected),
    appearances: draft.appearances?.map((appearance) => ({ ...appearance, selected: without(appearance.selected) })),
  }
  validateCharacterVariantMetadata(next)
  validateCharacterAppearances(next)
  return next
}

const currentLayerEntries = (draft: CharacterDraft, variant: CharacterDraftVariant) =>
  (Object.entries(variant.layers) as Array<[CharacterVariantLayer, CharacterDraftAsset | undefined]>)
    .filter(([layer, asset]) => asset && isCharacterDraftAssetCurrent(draft, variant, layer)) as Array<[CharacterVariantLayer, CharacterDraftAsset]>

const selectedCharacterVariants = <V extends VariantMetadata>(
  draft: SelectionMetadata<V>, preview?: Pick<CharacterDraftVariant, 'group' | 'id'>, exclude?: Pick<CharacterDraftVariant, 'group' | 'id'>,
) => {
  const selected = preview ? selectItem(draft.variants, draft.selected, preview, true) : draft.selected
  return [{ group: 'body' as const, id: 'base' }, ...selected.items]
    .filter((item) => !exclude || !sameItem(item, exclude))
    .map((item) => findVariant(draft, item.group, item.id))
    .filter((item): item is V => Boolean(item))
}

export const characterAssetPlacement = (group: CharacterVariantGroup, layer: CharacterVariantLayer, order = 1) => ({
  slot: group === 'body' ? 'character-skin' : layer === 'back' ? 'item-back' : 'item-front', order,
})

const orderedCharacterLayers = <V extends VariantMetadata>(draft: SelectionMetadata<V>, selected = draft.selected) =>
  orderItemLayers(draft.variants, draft.variants.flatMap((variant) =>
    (Object.keys(variant.layers) as CharacterVariantLayer[]).filter((layer) => isCharacterDraftAssetCurrent(draft, variant, layer))
      .map((layer) => ({ group: variant.group, id: variant.id, variant, layer }))), selected)

/** One order resolver for live preview, thumbnails and portable pack compilation. */
export const resolveCharacterDraftPlacements = <V extends VariantMetadata>(
  draft: SelectionMetadata<V>, preview?: Pick<CharacterDraftVariant, 'group' | 'id'>, exclude?: Pick<CharacterDraftVariant, 'group' | 'id'>,
) => {
  validateCharacterSelection({ ...draft, faceStyles: [] }, draft.selected)
  const variants = new Set(selectedCharacterVariants(draft, preview, exclude).map(itemKey))
  const selected = preview ? selectItem(draft.variants, draft.selected, preview, true) : draft.selected
  return orderedCharacterLayers(draft, selected).map(({ variant, layer }, index) => {
    const placement = characterAssetPlacement(variant.group, layer, index + 1)
    return { variant, layer, id: assetKey(variant, layer), blobId: assetKey(variant, layer), slot: placement.slot,
      slotOrder: CHARACTER_RIG.slots.find(({ id }) => id === placement.slot)!.order, layerOrder: placement.order,
      transform: variant.transform ? { ...variant.transform } : { ...IDENTITY_CHARACTER_TRANSFORM } }
  }).filter(({ variant }) => variants.has(itemKey(variant)))
}

const resolveDraftLayers = (
  draft: CharacterDraft,
  preview?: Pick<CharacterDraftVariant, 'group' | 'id'>,
  exclude?: Pick<CharacterDraftVariant, 'group' | 'id'>,
): Array<ResolvedCharacterLayer & { blob: Blob }> => resolveCharacterDraftPlacements(draft, preview, exclude)
  .map(({ variant, layer, ...placement }) => ({ ...placement, blob: variant.layers[layer]!.blob }))

export const resolveCharacterDraftLayers = (
  draft: CharacterDraft,
  preview?: Pick<CharacterDraftVariant, 'group' | 'id'>,
) => resolveDraftLayers(draft, preview)

export const resolveCharacterDraftAtlasSources = (draft: CharacterDraft): CharacterAtlasSource[] =>
  draft.variants.flatMap((variant) => currentLayerEntries(draft, variant).map(([layer, asset]) => ({
    id: assetKey(variant, layer),
    blob: asset.blob,
    transform: variant.transform ? { ...variant.transform } : { ...IDENTITY_CHARACTER_TRANSFORM },
  })))

export const characterDraftAtlasKey = (draft: CharacterDraft) => JSON.stringify(
  draft.variants.flatMap((variant) => currentLayerEntries(draft, variant).map(([layer, asset]) => ({
    id: assetKey(variant, layer),
    sha256: asset.inspection.sha256,
    transform: variant.transform ?? IDENTITY_CHARACTER_TRANSFORM,
  }))).sort((left, right) => left.id.localeCompare(right.id)),
)

export function resolveCharacterDraftReferenceLayers(
  draft: CharacterDraft,
  target: Pick<CharacterDraftVariant, 'group' | 'id'>,
) {
  if (target.group === 'body') return []
  if (target.group === 'expression') {
    return resolveDraftLayers({ ...draft, selected: { ...draft.selected, items: draft.selected.items.filter((item) => item.group !== 'expression') } }, undefined, target)
  }
  return resolveDraftLayers(draft, undefined, target)
}

export function buildCharacterPack(draft: CharacterDraft, version = 1): CharacterPack {
  if (!draft.name.trim()) throw new Error('Companion name is required')
  if (!hasCurrentCharacterLayer(draft, 'body', 'base', 'body')) throw new Error('Base body is required')
  const keys = new Set<string>()
  validateCharacterVariantMetadata(draft)
  const ordered = orderedCharacterLayers(draft)
  const orders = new Map(ordered.map((item, index) => [`${itemKey(item)}:${item.layer}`, index + 1]))
  for (const variant of draft.variants) {
    if (variant.transform) validateCharacterVariantTransform(variant.transform)
    if (
      !CHARACTER_VARIANT_GROUPS.includes(variant.group) || !variantIdPattern.test(variant.id) ||
      keys.has(variantKey(variant)) || !variant.label.trim() || variant.label.length > 80 ||
      (variant.group === 'body' && variant.transform !== undefined) ||
      Object.keys(variant.layers).some((layer) => !(CHARACTER_VARIANT_LAYERS[variant.group] as readonly string[]).includes(layer))
    ) throw new Error('Invalid character variant')
    keys.add(variantKey(variant))
  }
  validateCharacterSelection(draft, draft.selected)
  const pack: CharacterPack = {
    id: draft.packId,
    version,
    rigProfile: structuredClone(draft.rigProfile),
    creator: { name: 'Local user' },
    license: { id: 'private-use', embedding: 'allowed' },
    assets: draft.variants.flatMap((variant) => currentLayerEntries(draft, variant).map(([layer, asset]) => ({
      id: assetKey(variant, layer),
      blobId: assetKey(variant, layer),
      mediaType: 'image/png' as const,
      size: asset.inspection.size,
      sha256: asset.inspection.sha256,
    }))),
    appearances: draft.variants.flatMap((variant) => {
      const layers = currentLayerEntries(draft, variant).map(([layer]) => {
        const placement = characterAssetPlacement(variant.group, layer,
          orders.get(`${itemKey(variant)}:${layer}`))
        return {
          asset: { packId: draft.packId, packVersion: version, assetId: assetKey(variant, layer) },
          ...placement,
          ...(variant.transform ? { transform: { ...variant.transform } } : {}),
        }
      })
      return layers.length ? [{ id: variantKey(variant), layers }] : []
    }),
    defaultComposition: [],
  }
  pack.defaultComposition = selectedCharacterVariants(draft).map((variant) => ref(pack, variantKey(variant)))
  validateCharacterPack(pack, new Map(draft.variants.flatMap((variant) => currentLayerEntries(draft, variant).map(([layer, asset]) => [
    assetKey(variant, layer), asset.inspection,
  ] as const))))
  return pack
}

export function buildCharacterDraftResources(draft: CharacterDraft, version?: number) {
  const pack = buildCharacterPack(draft, version)
  const state = {
    id: `character:${pack.id}`,
    packId: pack.id,
    packVersion: pack.version,
    composition: structuredClone(pack.defaultComposition),
  }
  const assets = draft.variants.flatMap((variant) => currentLayerEntries(draft, variant).map(([layer, asset]) => ({
    id: assetKey(variant, layer),
    blob: asset.blob,
  })))
  return { pack, state, assets, layers: resolveCharacterDraftLayers(draft) }
}

export async function reviewCharacterDraft(
  inspect: (blob: Blob) => Promise<CharacterAssetInspection>,
  draft: CharacterDraft,
): Promise<StagedCandidatePreview> {
  const { pack, assets, layers } = buildCharacterDraftResources(draft)
  await validateLibraryRecord(inspect, { name: draft.name.trim(), pack, composition: pack.defaultComposition, assets })
  return {
    source: 'character',
    draftId: draft.id,
    name: draft.name.trim(),
    appearanceCount: pack.appearances.length,
    layers,
  }
}

export interface InstalledCharacterPackProjection {
  id: string
  version: number
  name: string
  rigProfile: CharacterPack['rigProfile']
  defaultComposition: AppearanceRef[]
  layers: Array<ResolvedCharacterLayer & { blob: Blob }>
}

async function validateLibraryRecord(
  inspect: (blob: Blob) => Promise<CharacterAssetInspection>,
  record: CharacterPackLibraryRecord,
): Promise<InstalledCharacterPackProjection> {
  const blobs = new Map(record.assets.map(({ id, blob }) => [id, blob]))
  const inspections = new Map<string, CharacterAssetInspection>()
  for (const asset of record.pack.assets) {
    const blob = blobs.get(asset.blobId)
    if (!blob) throw new Error(`Character asset read-back failed: ${asset.id}`)
    inspections.set(asset.blobId, await inspect(blob))
  }
  validateCharacterPack(record.pack, inspections)
  return {
    id: record.pack.id,
    version: record.pack.version,
    name: record.name,
    rigProfile: structuredClone(record.pack.rigProfile),
    defaultComposition: structuredClone(record.composition),
    layers: resolveCharacterComposition(record.pack, record.composition)
      .map((layer) => ({ ...layer, blob: blobs.get(layer.blobId)! })),
  }
}

export async function installCharacterDraft(
  library: CharacterPackLibraryRepository,
  inspect: (blob: Blob) => Promise<CharacterAssetInspection>,
  draft: CharacterDraft,
  version?: number,
): Promise<InstalledCharacterPackProjection> {
  const { pack, assets } = buildCharacterDraftResources(draft, version)
  const record = { name: draft.name.trim(), pack, composition: structuredClone(pack.defaultComposition), assets }
  const projection = await validateLibraryRecord(inspect, record)
  await library.install(record)
  return projection
}

export async function listInstalledCharacterPacks(
  library: CharacterPackLibraryRepository,
  inspect: (blob: Blob) => Promise<CharacterAssetInspection>,
): Promise<InstalledCharacterPackProjection[]> {
  return Promise.all((await library.list()).map((record) => validateLibraryRecord(inspect, record)))
}

export async function loadInstalledCharacterPackResources(
  library: CharacterPackLibraryRepository,
  inspect: (blob: Blob) => Promise<CharacterAssetInspection>,
  selection: { packId: string; packVersion: number; composition?: AppearanceRef[] },
) {
  const record = (await library.list()).find(({ pack }) =>
    pack.id === selection.packId && pack.version === selection.packVersion,
  )
  if (!record) throw new Error(`Installed Character Pack not found: ${selection.packId}@${selection.packVersion}`)
  const composition = selection.composition ?? record.composition
  const selected = { ...record, composition: structuredClone(composition) }
  const projection = await validateLibraryRecord(inspect, selected)
  return {
    name: record.name,
    pack: structuredClone(record.pack),
    state: {
      id: `character:${record.pack.id}:v${record.pack.version}`,
      packId: record.pack.id,
      packVersion: record.pack.version,
      composition: structuredClone(composition),
    },
    assets: record.assets.map(({ id, blob }) => ({ id, blob })),
    layers: projection.layers,
  }
}

export async function loadCharacterProjection(
  entries: EntryReader,
  assetsFor: AssetRepositoryFactory,
  bundleId: string,
  inspect: (blob: Blob) => Promise<CharacterAssetInspection>,
  stateId?: string,
): Promise<Array<ResolvedCharacterLayer & { blob: Blob }> | undefined> {
  const requestedState = stateId ? await entries.readById(stateId) : undefined
  if (stateId && (!requestedState || requestedState.collection !== 'character-states' || requestedState.status !== 'published')) {
    throw new Error(`Character state not found: ${stateId}`)
  }
  const packEntry = (await entries.readPublished({ collection: 'character-packs' }))
    .find(({ data }) => {
      const pack = data.pack as Partial<CharacterPack> | undefined
      return Boolean(
        pack?.rigProfile && Array.isArray(pack.assets) && Array.isArray(pack.appearances) && Array.isArray(pack.defaultComposition) &&
        (!requestedState || (requestedState.data.packId === pack.id && requestedState.data.packVersion === pack.version)),
      )
    })
  if (!packEntry) {
    if (stateId) throw new Error(`Character pack not found for state: ${stateId}`)
    return undefined
  }
  const pack = packEntry.data.pack as CharacterPack
  const state = requestedState ?? (await entries.readPublished({ collection: 'character-states' }))
    .find(({ data }) => data.packId === pack.id && data.packVersion === pack.version)
  const assets = assetsFor(bundleId)
  const blobs = new Map<string, Blob>()
  const inspections = new Map<string, CharacterAssetInspection>()
  for (const asset of pack.assets ?? []) {
    const blob = await assets.get(asset.blobId)
    if (!blob) throw new Error(`Character asset is missing: ${asset.blobId}`)
    blobs.set(asset.blobId, blob)
    // ponytail: re-inspect local blobs on load; cache verified metadata if large packs make this measurable.
    inspections.set(asset.blobId, await inspect(blob))
  }
  validateCharacterPack(pack, inspections)
  const composition = (state?.data.composition as AppearanceRef[] | undefined) ?? pack.defaultComposition
  return resolveCharacterComposition(pack, composition).map((layer) => ({ ...layer, blob: blobs.get(layer.blobId)! }))
}
