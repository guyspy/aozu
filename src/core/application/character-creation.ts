import type { EntryReader } from '@aotter/mantle-runtime'
import { characterAssets } from './character-assets.ts'
import { CHARACTER_BACKGROUND_GUIDANCE } from './character-agent-guidance.ts'

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
  type CharacterAttributeValue,
  type CharacterDraft,
  type CharacterDraftAsset,
  type CharacterDraftVariant,
  type CharacterPack,
  type CharacterProfilePatch,
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

export const CHARACTER_CREATION_GROUPS: ReadonlyArray<{
  group: CharacterVariantGroup
  layers: readonly CharacterVariantLayer[]
  addable: boolean
}> = [
  { group: 'body', layers: ['body'], addable: false },
  { group: 'expression', layers: ['head'], addable: true },
  { group: 'outfit', layers: ['body'], addable: true },
  { group: 'prop', layers: ['back', 'front'], addable: true },
]

export const REQUIRED_CHARACTER_TARGETS = [
  { group: 'body', variantId: 'base', layer: 'body' },
] as const

const MAX_ASSET_BYTES = 5 * 1024 * 1024
const variantIdPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/
const roundTransformValue = (value: number) => Math.round(value * 10_000) / 10_000
const initialVariants = (): CharacterDraftVariant[] => [
  { group: 'body', id: 'base', label: 'Base body', layers: {} },
  { group: 'expression', id: 'happy', label: 'Happy', layers: {} },
  { group: 'expression', id: 'sad', label: 'Sad', layers: {} },
  { group: 'expression', id: 'angry', label: 'Angry', layers: {} },
  { group: 'expression', id: 'surprised', label: 'Surprised', layers: {} },
  { group: 'expression', id: 'sleepy', label: 'Sleepy', layers: {} },
  { group: 'outfit', id: 'outfit-1', label: 'Outfit 1', layers: {} },
  { group: 'prop', id: 'prop-1', label: 'Prop 1', layers: {} },
]

export const createCharacterDraft = (packId: string = `character-${crypto.randomUUID()}`, id: string = crypto.randomUUID()): CharacterDraft => ({
  id,
  schemaVersion: 4,
  packId,
  rigProfile: { id: CHARACTER_RIG.id, version: CHARACTER_RIG.version },
  name: 'My Companion',
  variants: initialVariants(),
  selected: { props: [] },
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

const optionalProfileText = (value: string, maxLength: number, label: string) => {
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new Error(`${label} is too long`)
  return normalized || undefined
}

const normalizedAttributes = (attributes: Record<string, CharacterAttributeValue>) => {
  const entries = Object.entries(attributes)
  if (entries.length > 32) throw new Error('Character attributes are limited to 32 entries')
  const normalized = entries.map(([rawKey, rawValue]) => {
    const key = rawKey.trim()
    if (!key || key.length > 40) throw new Error('Character attribute names must be 1–40 characters')
    if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) throw new Error(`Character attribute ${key} must be finite`)
    const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue
    if (typeof value === 'string' && value.length > 200) throw new Error(`Character attribute ${key} is too long`)
    return [key, value] as const
  }).sort(([left], [right]) => left.localeCompare(right))
  if (new Set(normalized.map(([key]) => key)).size !== normalized.length) throw new Error('Character attribute names must be unique')
  return Object.fromEntries(normalized) as Record<string, CharacterAttributeValue>
}

/** One profile command shared by the UI and WebMCP; omitted fields stay unchanged. */
export function updateCharacterProfile(draft: CharacterDraft, patch: CharacterProfilePatch): CharacterDraft {
  const name = patch.name === undefined ? draft.name : patch.name.trim()
  if (!name || name.length > 80) throw new Error('Character name must be 1–80 characters')
  const description = patch.description === undefined ? draft.description : optionalProfileText(patch.description, 500, 'Character description')
  const backstory = patch.backstory === undefined ? draft.backstory : optionalProfileText(patch.backstory, 8_000, 'Character backstory')
  const attributes = patch.attributes === undefined ? draft.attributes : normalizedAttributes(patch.attributes)
  if (
    name === draft.name && description === draft.description && backstory === draft.backstory &&
    JSON.stringify(attributes ?? {}) === JSON.stringify(draft.attributes ?? {})
  ) return draft
  const { description: _description, backstory: _backstory, attributes: _attributes, ...rest } = draft
  return {
    ...rest,
    name,
    ...(description ? { description } : {}),
    ...(backstory ? { backstory } : {}),
    ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
  }
}

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
      if (layer.slot === 'character-skin') put('body', 'base', 'Base body', 'body', layer.asset.assetId)
      else if (layer.slot === 'item-back' || layer.slot === 'item-front') {
        const id = propId(appearance.id)
        put('prop', id, appearance.id, layer.slot === 'item-back' ? 'back' : 'front', layer.asset.assetId)
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
  draft.selected.props = [...propIds.values()]
  return draft
}

type LegacyRole = 'body-base' | 'head-neutral' | 'head-happy' | 'body-outfit' | 'prop-back' | 'prop-front'
type CharacterDraftV4 = CharacterDraft & { revision?: number; published?: { version: number; revision: number } }
type CharacterDraftV3 = Omit<CharacterDraft, 'schemaVersion' | 'rigProfile'> & {
  schemaVersion: 3
  approvedAt?: number
}
type CharacterDraftV2 = Omit<CharacterDraftV3, 'schemaVersion' | 'variants' | 'selected'> & {
  schemaVersion: 2
  variants: Array<Omit<CharacterDraftVariant, 'group'> & { group: CharacterVariantGroup | 'headwear' }>
  selected: { expression: string; outfit?: string; headwear?: string; prop?: string }
}
type LegacyCharacterDraft = Omit<CharacterDraftV3, 'schemaVersion' | 'variants' | 'selected'> & {
  assets: Partial<Record<LegacyRole, CharacterDraftAsset>>
  selectedBody: 'body-base' | 'body-outfit'
  selectedExpression: 'head-neutral' | 'head-happy'
}

const withoutDefaultExpression = (draft: CharacterDraft): CharacterDraft => {
  const hasNeutral = draft.variants.some(({ group, id }) => group === 'expression' && id === 'neutral')
  if (!hasNeutral && draft.selected.expression !== 'neutral') return draft
  return {
    ...draft,
    variants: draft.variants.filter(({ group, id }) => group !== 'expression' || id !== 'neutral'),
    selected: { ...draft.selected, expression: draft.selected.expression === 'neutral' ? undefined : draft.selected.expression },
  }
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

export function migrateCharacterDraft(draft: CharacterDraftV4 | CharacterDraftV3 | CharacterDraftV2 | LegacyCharacterDraft): CharacterDraft {
  if ('schemaVersion' in draft && draft.schemaVersion === 4) {
    // Legacy `revision` and `published` metadata is dropped on hydration; the Mantle entry version is the only revision.
    if (!('published' in draft) && !('revision' in draft)) return withHeadRegistration(withoutDefaultExpression(draft))
    const { published: _published, revision: _revision, ...character } = draft
    return withHeadRegistration(withoutDefaultExpression(character))
  }
  if ('schemaVersion' in draft && draft.schemaVersion === 3) {
    const { approvedAt: _approvedAt, ...legacy } = draft
    const upgraded: CharacterDraft = {
      ...legacy,
      schemaVersion: 4,
      rigProfile: { id: CHARACTER_RIG.id, version: CHARACTER_RIG.version },
    }
    return withHeadRegistration(withoutDefaultExpression(upgraded))
  }
  if ('schemaVersion' in draft && draft.schemaVersion === 2) {
    const { approvedAt: _approvedAt, ...legacy } = draft
    const usedPropIds = new Set(draft.variants.filter(({ group }) => group === 'prop').map(({ id }) => id))
    const migratedHeadwearIds = new Map<string, string>()
    let nextHatId = 1
    const variants = draft.variants.map((variant): CharacterDraftVariant => {
      if (variant.group !== 'headwear') return variant as CharacterDraftVariant
      let id = variant.id
      while (usedPropIds.has(id)) id = `hat-${nextHatId++}`
      usedPropIds.add(id)
      migratedHeadwearIds.set(variant.id, id)
      return { ...variant, group: 'prop', id }
    })
    return withHeadRegistration(withoutDefaultExpression({
      ...legacy,
      schemaVersion: 4,
      rigProfile: { id: CHARACTER_RIG.id, version: CHARACTER_RIG.version },
      variants,
      selected: {
        ...(draft.selected.expression !== 'neutral' ? { expression: draft.selected.expression } : {}),
        ...(draft.selected.outfit ? { outfit: draft.selected.outfit } : {}),
        props: [draft.selected.headwear ? migratedHeadwearIds.get(draft.selected.headwear) : undefined, draft.selected.prop]
          .filter((id): id is string => Boolean(id)),
      },
    }))
  }
  const legacy = draft as LegacyCharacterDraft
  const next: CharacterDraft = {
    ...createCharacterDraft(legacy.packId, legacy.id),
    name: legacy.name,
    updatedAt: legacy.updatedAt,
    selected: {
      ...(legacy.selectedExpression === 'head-happy' ? { expression: 'happy' } : {}),
      ...(legacy.selectedBody === 'body-outfit' ? { outfit: 'outfit-1' } : {}),
      props: (legacy.assets['prop-back'] || legacy.assets['prop-front']) ? ['prop-1'] : [],
    },
  }
  const copy = (group: CharacterVariantGroup, id: string, layer: CharacterVariantLayer, asset?: CharacterDraftAsset) => {
    if (asset) next.variants.find((variant) => variant.group === group && variant.id === id)!.layers[layer] = asset
  }
  copy('body', 'base', 'body', legacy.assets['body-base'])
  copy('expression', 'happy', 'head', legacy.assets['head-happy'])
  copy('outfit', 'outfit-1', 'body', legacy.assets['body-outfit'])
  copy('prop', 'prop-1', 'back', legacy.assets['prop-back'])
  copy('prop', 'prop-1', 'front', legacy.assets['prop-front'])
  return withHeadRegistration(next)
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
          current && !current.canonicalSha256 ? { ...current, canonicalSha256: previousCanonical } : current,
        ])),
      })
    : variants
  return {
    ...draft,
    variants: nextVariants,
    ...(!derived && previousCanonical && previousCanonical !== inspection.sha256
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
      : input.group === 'outfit' ? canonical : undefined,
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

export function activateCharacterVariant(
  draft: CharacterDraft,
  target: Pick<CharacterDraftVariant, 'group' | 'id'>,
) {
  if (!findVariant(draft, target.group, target.id)) throw new Error('Character variant not found')
  if (target.group === 'body') return draft
  if (target.group === 'expression') return draft.selected.expression === target.id
    ? draft : { ...draft, selected: { ...draft.selected, expression: target.id } }
  if (target.group === 'outfit') return draft.selected.outfit === target.id
    ? draft : { ...draft, selected: { ...draft.selected, outfit: target.id } }
  return draft.selected.props.includes(target.id)
    ? draft : { ...draft, selected: { ...draft.selected, props: [...draft.selected.props, target.id] } }
}

export function deactivateCharacterVariant(
  draft: CharacterDraft,
  target: Pick<CharacterDraftVariant, 'group' | 'id'>,
) {
  if (!findVariant(draft, target.group, target.id)) throw new Error('Character variant not found')
  if (target.group === 'body') return draft
  if (target.group === 'prop') return draft.selected.props.includes(target.id)
    ? { ...draft, selected: { ...draft.selected, props: draft.selected.props.filter((id) => id !== target.id) } } : draft
  return draft.selected[target.group] === target.id
    ? { ...draft, selected: { ...draft.selected, [target.group]: undefined } } : draft
}

export function clearCharacterVariantSelection(draft: CharacterDraft, group: CharacterVariantGroup) {
  if (group === 'body') return draft
  if (group === 'prop') return draft.selected.props.length
    ? { ...draft, selected: { ...draft.selected, props: [] } } : draft
  return draft.selected[group] === undefined
    ? draft : { ...draft, selected: { ...draft.selected, [group]: undefined } }
}

const selectedPropIds = (draft: SelectionMetadata, preview?: Pick<CharacterDraftVariant, 'group' | 'id'>) => {
  const ids = draft.selected.props
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate selected character prop ID')
  if (ids.some((id) => !findVariant(draft, 'prop', id))) throw new Error('Selected character prop is missing')
  return preview?.group === 'prop' && !ids.includes(preview.id) ? [...ids, preview.id] : ids
}

/** Preserve activation order, then assign unused variants unique orders for portable pack appearances. */
const characterPropOrders = (draft: SelectionMetadata, preview?: Pick<CharacterDraftVariant, 'group' | 'id'>) => {
  const selected = selectedPropIds(draft, preview)
  const inactive = draft.variants.filter(({ group, id }) => group === 'prop' && !selected.includes(id)).map(({ id }) => id)
  return new Map([...selected, ...inactive].map((id, index) => [id, index + 1]))
}

const currentLayerEntries = (draft: CharacterDraft, variant: CharacterDraftVariant) =>
  (Object.entries(variant.layers) as Array<[CharacterVariantLayer, CharacterDraftAsset | undefined]>)
    .filter(([layer, asset]) => asset && isCharacterDraftAssetCurrent(draft, variant, layer)) as Array<[CharacterVariantLayer, CharacterDraftAsset]>

const selectedCharacterVariants = <V extends VariantMetadata>(
  draft: SelectionMetadata<V>,
  preview?: Pick<CharacterDraftVariant, 'group' | 'id'>,
  exclude?: Pick<CharacterDraftVariant, 'group' | 'id'>,
) => {
  const outfitId = preview?.group === 'outfit' ? preview.id : draft.selected.outfit
  const outfit = !(exclude?.group === 'outfit' && exclude.id === outfitId) && outfitId && hasCurrentCharacterLayer(draft, 'outfit', outfitId, 'body')
    ? findVariant(draft, 'outfit', outfitId) : undefined
  const expressionId = preview?.group === 'expression' ? preview.id : draft.selected.expression
  const expression = expressionId && !(exclude?.group === 'expression' && exclude.id === expressionId) && hasCurrentCharacterLayer(draft, 'expression', expressionId, 'head')
    ? findVariant(draft, 'expression', expressionId) : undefined
  const props = selectedPropIds(draft, preview)
    .filter((id) => exclude?.group !== 'prop' || exclude.id !== id)
    .map((id) => findVariant(draft, 'prop', id))
  return [outfit ?? findVariant(draft, 'body', 'base'), expression, ...props]
    .filter((variant): variant is V => Boolean(variant && Object.keys(variant.layers).some((layer) => isCharacterDraftAssetCurrent(draft, variant, layer as CharacterVariantLayer))))
}

export const characterAssetPlacement = (group: CharacterVariantGroup, layer: CharacterVariantLayer, propOrder = 1) => {
  if (group === 'body' || group === 'outfit') return { slot: 'character-skin', order: 1 }
  if (group === 'expression') return { slot: 'expression-head', order: 1 }
  return { slot: layer === 'back' ? 'item-back' : 'item-front', order: propOrder }
}

/** Resolve paint order from metadata so library cards need only the PNGs actually painted. */
export const resolveCharacterDraftPlacements = <V extends VariantMetadata>(
  draft: SelectionMetadata<V>,
  preview?: Pick<CharacterDraftVariant, 'group' | 'id'>,
  exclude?: Pick<CharacterDraftVariant, 'group' | 'id'>,
) => {
  const slotOrders = new Map<string, number>(CHARACTER_RIG.slots.map(({ id, order }) => [id, order]))
  const propOrders = characterPropOrders(draft, preview)
  return selectedCharacterVariants(draft, preview, exclude).flatMap((variant) =>
    (Object.keys(variant.layers) as CharacterVariantLayer[]).filter((layer) => isCharacterDraftAssetCurrent(draft, variant, layer)).map((layer) => {
      const placement = characterAssetPlacement(variant.group, layer, propOrders.get(variant.id))
      return {
        variant, layer,
        id: assetKey(variant, layer),
        blobId: assetKey(variant, layer),
        slot: placement.slot,
        slotOrder: slotOrders.get(placement.slot)!,
        layerOrder: placement.order,
        transform: variant.transform ? { ...variant.transform } : { ...IDENTITY_CHARACTER_TRANSFORM },
      }
    }),
  ).sort((left, right) => left.slotOrder - right.slotOrder || left.layerOrder - right.layerOrder || left.id.localeCompare(right.id))
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
    return resolveDraftLayers({ ...draft, selected: { ...draft.selected, expression: undefined } }, undefined, target)
  }
  return resolveDraftLayers(draft, undefined, target)
}

export function buildCharacterPack(draft: CharacterDraft, version = 1): CharacterPack {
  if (!draft.name.trim()) throw new Error('Companion name is required')
  if (!hasCurrentCharacterLayer(draft, 'body', 'base', 'body')) throw new Error('Base body is required')
  const keys = new Set<string>()
  const propOrders = characterPropOrders(draft)
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
        const placement = characterAssetPlacement(variant.group, layer, propOrders.get(variant.id))
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
