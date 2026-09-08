export const CHARACTER_RIG = {
  id: 'companion-fullbody',
  version: 2,
  canvas: { width: 512, height: 768 },
  slots: [
    { id: 'item-back', order: 10, alpha: 'required' },
    { id: 'character-skin', order: 30, alpha: 'required' },
    { id: 'expression-head', order: 35, alpha: 'required' },
    { id: 'item-front', order: 40, alpha: 'required' },
    { id: 'aura', order: 50, alpha: 'required' },
  ],
} as const

/** The size generators produce at; exactly 2× the rig canvas so the deterministic downscale stays exact. */
export const CHARACTER_GENERATION_CANVAS = {
  width: CHARACTER_RIG.canvas.width * 2,
  height: CHARACTER_RIG.canvas.height * 2,
} as const

const LEGACY_CHARACTER_RIG = {
  id: 'companion-fullbody',
  version: 1,
  canvas: { width: 512, height: 768 },
  slots: [
    { id: 'item-back', order: 10, alpha: 'required' },
    { id: 'character-skin', order: 30, alpha: 'required' },
    { id: 'item-front', order: 40, alpha: 'required' },
    { id: 'aura', order: 50, alpha: 'required' },
  ],
} as const

export const CHARACTER_VARIANT_GROUPS = ['body', 'expression', 'outfit', 'prop'] as const
export const CHARACTER_VARIANT_LAYERS = {
  body: ['body'],
  expression: ['head'],
  outfit: ['body'],
  prop: ['back', 'front'],
} as const

export type CharacterVariantGroup = typeof CHARACTER_VARIANT_GROUPS[number]
export type CharacterVariantLayer = 'body' | 'head' | 'back' | 'front'

export interface CharacterVariantTransform {
  x: number
  y: number
  scale: number
}

export const IDENTITY_CHARACTER_TRANSFORM: CharacterVariantTransform = { x: 0, y: 0, scale: 1 }

export const CHARACTER_RESIZE_MODES = ['none', 'exact-aspect-downscale'] as const
export const CHARACTER_ALIGN_MODES = ['none', 'reference-visible-bounds'] as const
export type CharacterResizeMode = typeof CHARACTER_RESIZE_MODES[number]
export type CharacterAlignMode = typeof CHARACTER_ALIGN_MODES[number]

/** Explicit, opt-in raster normalization requested as part of one asset submission. */
export interface CharacterNormalization {
  resize: CharacterResizeMode
  align: CharacterAlignMode
}

export const NO_CHARACTER_NORMALIZATION: CharacterNormalization = { resize: 'none', align: 'none' }

export interface CharacterDraftAsset {
  blob: Blob
  filename: string
  source: 'user' | 'agent' | 'starter'
  inspection: CharacterAssetInspection
  canonicalSha256?: string
}

export interface CharacterDraftVariant {
  id: string
  group: CharacterVariantGroup
  label: string
  layers: Partial<Record<CharacterVariantLayer, CharacterDraftAsset>>
  transform?: CharacterVariantTransform
}

export type CharacterAttributeValue = string | number | boolean

export interface CharacterProfilePatch {
  name?: string
  description?: string
  backstory?: string
  attributes?: Record<string, CharacterAttributeValue>
}

export interface CharacterAssetTarget {
  group: CharacterVariantGroup
  variantId: string
  label: string
  layer: CharacterVariantLayer
}

export const CHARACTER_REFERENCE_VIEWS = ['front', 'three-quarter', 'side', 'back'] as const
export type CharacterReferenceView = typeof CHARACTER_REFERENCE_VIEWS[number]
export const CHARACTER_REFERENCE_KINDS = ['full-body', 'head', 'structure', 'expression', 'detail', 'style'] as const
export interface CharacterReferenceMetadata {
  label?: string
  kind?: typeof CHARACTER_REFERENCE_KINDS[number]
  viewpoint?: string
  pose?: string
  /** Hash of the source image used to draw or capture this reference. */
  sourceSha256?: string
}
export interface CharacterReference<Asset = CharacterDraftAsset> extends CharacterReferenceMetadata {
  asset: Asset
  notes?: string
  /** Fractions of the original image height, explicitly calibrated by the author. */
  guides?: { head: number; feet: number }
}
export interface CharacterModelSheet<Asset = CharacterDraftAsset> {
  heightCm?: number
  views: Partial<Record<CharacterReferenceView, CharacterReference<Asset>>>
  references?: Record<string, CharacterReference<Asset>>
}
export interface CharacterAssetContent<Asset> {
  variants: Array<Omit<CharacterDraftVariant, 'layers'> & { layers: Partial<Record<CharacterVariantLayer, Asset>> }>
  modelSheet?: CharacterModelSheet<Asset>
}

export interface CharacterDraft extends CharacterAssetContent<CharacterDraftAsset> {
  id: string
  schemaVersion: 4
  packId: string
  rigProfile: { id: string; version: number }
  name: string
  description?: string
  backstory?: string
  attributes?: Record<string, CharacterAttributeValue>
  headRegistration?: { variantId: string }
  selected: {
    expression?: string
    outfit?: string
    /** Bottom to top within each prop rig slot; activating an absent prop appends it. */
    props: string[]
  }
  updatedAt: number
}

export const characterAssetScope = (packId: string) => `character:${packId}`

export type StoredCharacterAsset = Omit<CharacterDraftAsset, 'blob'> & { blobId: string }
export type CharacterWorkspaceData = Omit<CharacterDraft, 'id' | 'updatedAt' | 'variants' | 'modelSheet'> & CharacterAssetContent<StoredCharacterAsset>

export interface AppearanceRef {
  packId: string
  packVersion: number
  appearanceId: string
}

export interface AssetRef {
  packId: string
  packVersion: number
  assetId: string
}

export interface CharacterPack {
  id: string
  version: number
  rigProfile: { id: string; version: number }
  creator: { name: string; url?: string; attribution?: string }
  license: { id: string; url?: string; embedding: 'allowed' }
  assets: Array<{ id: string; blobId: string; mediaType: 'image/png'; size: number; sha256: string }>
  appearances: Array<{
    id: string
    layers: Array<{ asset: AssetRef; slot: string; order: number; transform?: CharacterVariantTransform }>
  }>
  defaultComposition: AppearanceRef[]
}

export interface CharacterAssetInspection {
  width: number
  height: number
  hasTransparentPixels: boolean
  hasVisiblePixels: boolean
  genuineRgba: boolean
  visibleBounds?: { x: number; y: number; width: number; height: number }
  visiblePixelCount?: number
  size: number
  sha256: string
}

export interface ResolvedCharacterLayer {
  id: string
  blobId: string
  slot: string
  slotOrder: number
  layerOrder: number
  transform: CharacterVariantTransform
}

export interface CharacterAtlasSource {
  id: string
  blob: Blob
  transform: CharacterVariantTransform
}

export interface CharacterTextureAtlas {
  image: Blob
  data: {
    frames: Record<string, {
      frame: { x: number; y: number; w: number; h: number }
      rotated: false
      trimmed: true
      spriteSourceSize: { x: number; y: number; w: number; h: number }
      sourceSize: { w: number; h: number }
    }>
    meta: {
      app: 'Companion'
      version: '1'
      image: 'character.atlas.webp'
      format: 'RGBA8888'
      size: { w: number; h: number }
      scale: '1'
    }
  }
}

const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/
const https = (value: string) => new URL(value).protocol === 'https:'
export function validateCharacterVariantTransform({ x, y, scale }: CharacterVariantTransform) {
  if (
    !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale) ||
    Math.abs(x) > CHARACTER_RIG.canvas.width || Math.abs(y) > CHARACTER_RIG.canvas.height ||
    scale < 0.25 || scale > 4
  ) throw new Error('Character transform is outside the supported canvas range')
}
const rigFor = (profile: CharacterPack['rigProfile'] | undefined) => {
  if (!profile || profile.id !== CHARACTER_RIG.id) throw new Error('Unsupported character rig')
  if (profile.version === CHARACTER_RIG.version) return CHARACTER_RIG
  if (profile.version === LEGACY_CHARACTER_RIG.version) return LEGACY_CHARACTER_RIG
  throw new Error('Unsupported character rig')
}

export function validateCharacterPack(
  pack: CharacterPack,
  inspections: ReadonlyMap<string, CharacterAssetInspection>,
): ResolvedCharacterLayer[] {
  if (!idPattern.test(pack.id) || !Number.isSafeInteger(pack.version) || pack.version < 1) throw new Error('Invalid character pack identity')
  const rig = rigFor(pack.rigProfile)
  if (!pack.creator.name || (pack.creator.url && !https(pack.creator.url))) throw new Error('Invalid character creator')
  if (!pack.license.id || (pack.license.url && !https(pack.license.url)) || pack.license.embedding !== 'allowed') throw new Error('Character pack cannot be embedded')
  const assets = new Map(pack.assets.map((asset) => [asset.id, asset]))
  if (assets.size !== pack.assets.length || [...assets].some(([id]) => !idPattern.test(id))) throw new Error('Duplicate or invalid character asset ID')
  for (const asset of pack.assets) {
    const inspected = inspections.get(asset.blobId)
    if (
      asset.mediaType !== 'image/png' ||
      !asset.blobId ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 ||
      !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      !inspected ||
      inspected.width !== rig.canvas.width ||
      inspected.height !== rig.canvas.height ||
      !inspected.genuineRgba ||
      !inspected.hasTransparentPixels ||
      !inspected.hasVisiblePixels ||
      !inspected.visibleBounds ||
      inspected.size !== asset.size ||
      inspected.sha256 !== asset.sha256
    ) throw new Error(`Invalid character asset: ${asset.id}`)
  }
  const appearances = new Map(pack.appearances.map((appearance) => [appearance.id, appearance]))
  if (
    appearances.size !== pack.appearances.length ||
    pack.appearances.some(({ id, layers }) => !idPattern.test(id) || !layers.length)
  ) throw new Error('Duplicate or invalid appearance ID')
  const slotOrders = new Map<string, number>(rig.slots.map((slot) => [slot.id, slot.order]))
  for (const appearance of pack.appearances) {
    const localOrders = new Set<string>()
    for (const layer of appearance.layers) {
      const orderKey = `${layer.slot}:${layer.order}`
      if (layer.transform) validateCharacterVariantTransform(layer.transform)
      const transform = layer.transform ?? IDENTITY_CHARACTER_TRANSFORM
      const asset = assets.get(layer.asset.assetId)
      const bounds = asset && inspections.get(asset.blobId)?.visibleBounds
      const visible = bounds && {
        x: transform.x + bounds.x * transform.scale,
        y: transform.y + bounds.y * transform.scale,
        width: bounds.width * transform.scale,
        height: bounds.height * transform.scale,
      }
      if (
        layer.asset.packId !== pack.id || layer.asset.packVersion !== pack.version ||
        !asset || !slotOrders.has(layer.slot) || !Number.isSafeInteger(layer.order) || localOrders.has(orderKey) ||
        !visible || visible.x + visible.width <= 0 || visible.y + visible.height <= 0 ||
        visible.x >= rig.canvas.width || visible.y >= rig.canvas.height
      ) throw new Error(`Invalid appearance layer: ${appearance.id}`)
      localOrders.add(orderKey)
    }
  }
  return resolveCharacterComposition(pack, pack.defaultComposition)
}

export function resolveCharacterComposition(
  pack: CharacterPack,
  composition: readonly AppearanceRef[],
): ResolvedCharacterLayer[] {
  const assets = new Map(pack.assets.map((asset) => [asset.id, asset]))
  const appearances = new Map(pack.appearances.map((appearance) => [appearance.id, appearance]))
  const rig = rigFor(pack.rigProfile)
  const slotOrders = new Map<string, number>(rig.slots.map((slot) => [slot.id, slot.order]))
  const layers: ResolvedCharacterLayer[] = []
  for (const reference of composition) {
    if (reference.packId !== pack.id || reference.packVersion !== pack.version) throw new Error('Unqualified appearance reference')
    const appearance = appearances.get(reference.appearanceId)
    if (!appearance) throw new Error(`Appearance not found: ${reference.appearanceId}`)
    const localOrders = new Set<string>()
    for (const layer of appearance.layers) {
      if (layer.asset.packId !== pack.id || layer.asset.packVersion !== pack.version) throw new Error('Unqualified asset reference')
      const asset = assets.get(layer.asset.assetId)
      const slotOrder = slotOrders.get(layer.slot)
      const orderKey = `${layer.slot}:${layer.order}`
      if (!asset || slotOrder === undefined || !Number.isSafeInteger(layer.order) || localOrders.has(orderKey)) throw new Error(`Invalid appearance layer: ${appearance.id}`)
      localOrders.add(orderKey)
      layers.push({
        id: `${pack.id}@${pack.version}:${appearance.id}:${layer.asset.assetId}`,
        blobId: asset.blobId,
        slot: layer.slot,
        slotOrder,
        layerOrder: layer.order,
        transform: layer.transform ? { ...layer.transform } : { ...IDENTITY_CHARACTER_TRANSFORM },
      })
    }
  }
  if (!layers.some(({ slot }) => slot === 'character-skin')) throw new Error('Character composition requires a skin')
  const finalOrders = new Set(layers.map(({ slot, layerOrder }) => `${slot}:${layerOrder}`))
  if (finalOrders.size !== layers.length) throw new Error('Composition layer order collision')
  return layers.sort((left, right) => left.slotOrder - right.slotOrder || left.layerOrder - right.layerOrder || left.id.localeCompare(right.id))
}
