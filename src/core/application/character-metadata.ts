import {
  CHARACTER_OUTFIT_SLOTS,
  type CharacterAssetContent,
  type CharacterAttributeValue,
  type CharacterDraft,
  type CharacterProfilePatch,
  type CharacterVariantGroup,
  type CharacterVariantProfilePatch,
} from '../domain/character.ts'

export const CHARACTER_VARIANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/

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
  const heightCm = patch.heightCm === undefined ? draft.modelSheet?.heightCm : patch.heightCm ?? undefined
  if (heightCm !== undefined && (!Number.isFinite(heightCm) || heightCm <= 0 || heightCm > 100_000)) throw new Error('Invalid character height')
  const name = patch.name === undefined ? draft.name : patch.name.trim()
  if (!name || name.length > 80) throw new Error('Character name must be 1–80 characters')
  const description = patch.description === undefined ? draft.description : optionalProfileText(patch.description, 500, 'Character description')
  const backstory = patch.backstory === undefined ? draft.backstory : optionalProfileText(patch.backstory, 8_000, 'Character backstory')
  const attributes = patch.attributes === undefined ? draft.attributes : normalizedAttributes(patch.attributes)
  if (
    heightCm === draft.modelSheet?.heightCm && name === draft.name && description === draft.description && backstory === draft.backstory &&
    JSON.stringify(attributes ?? {}) === JSON.stringify(draft.attributes ?? {})
  ) return draft
  const { description: _description, backstory: _backstory, attributes: _attributes, ...rest } = draft
  return {
    ...rest,
    ...(heightCm !== draft.modelSheet?.heightCm ? { modelSheet: { ...draft.modelSheet, views: draft.modelSheet?.views ?? {}, heightCm } } : {}),
    name,
    ...(description ? { description } : {}),
    ...(backstory ? { backstory } : {}),
    ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
  }
}

const metadataText = (value: string | undefined, max: number, label: string) => value === undefined ? undefined : optionalProfileText(value, max, label)
const metadataTags = (values: string[] | undefined) => {
  if (values === undefined) return undefined
  const tags = [...new Set(values.map((tag) => tag.trim()).filter(Boolean))]
  if (tags.length > 20 || tags.some((tag) => tag.length > 40)) throw new Error('Variant tags are limited to 20 values of 40 characters')
  return tags
}

export function validateCharacterVariantMetadata(content: Pick<CharacterAssetContent<unknown>, 'variants' | 'faceStyles'>): void {
  if (!Array.isArray(content.faceStyles) || !content.faceStyles.length || content.faceStyles.length > 100) throw new Error('Invalid Face Styles')
  const faceStyles = new Set<string>()
  for (const value of content.faceStyles as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Face Style')
    const style = value as Record<string, unknown>, facialHair = style.facialHair
    if (Object.keys(style).some((key) => !['id', 'label', 'description', 'tags', 'facialHair'].includes(key)) ||
      typeof style.id !== 'string' || !CHARACTER_VARIANT_ID_PATTERN.test(style.id) || faceStyles.has(style.id) || typeof style.label !== 'string' || !style.label.trim() || style.label.length > 80 ||
      (style.description !== undefined && (typeof style.description !== 'string' || style.description.length > 500)) ||
      (style.tags !== undefined && (!Array.isArray(style.tags) || style.tags.length > 20 || new Set(style.tags).size !== style.tags.length || style.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40))) ||
      !(facialHair === null || facialHair && typeof facialHair === 'object' && !Array.isArray(facialHair) &&
        !Object.keys(facialHair).some((key) => !['type', 'length', 'density', 'color'].includes(key)) &&
        typeof (facialHair as Record<string, unknown>).type === 'string' && Boolean(((facialHair as Record<string, unknown>).type as string).trim()) && ((facialHair as Record<string, unknown>).type as string).length <= 80 &&
        ['length', 'density', 'color'].every((key) => (facialHair as Record<string, unknown>)[key] === undefined ||
          typeof (facialHair as Record<string, unknown>)[key] === 'string' && Boolean(((facialHair as Record<string, unknown>)[key] as string).trim()) && ((facialHair as Record<string, unknown>)[key] as string).length <= 80))) throw new Error('Invalid Face Style')
    faceStyles.add(style.id)
  }
  for (const variant of content.variants) {
    const metadata = variant.metadata as Record<string, unknown> | undefined
    if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      Object.keys(metadata).some((key) => !['description', 'tags', 'sourceSha256', 'outfit', 'faceStyleId'].includes(key)) ||
      (metadata.description !== undefined && (typeof metadata.description !== 'string' || metadata.description.length > 500)) ||
      (metadata.tags !== undefined && (!Array.isArray(metadata.tags) || metadata.tags.length > 20 || new Set(metadata.tags).size !== metadata.tags.length || metadata.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40))) ||
      (metadata.sourceSha256 !== undefined && (typeof metadata.sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.sourceSha256))))) throw new Error('Invalid character variant metadata')
    const outfit = metadata?.outfit as Record<string, unknown> | undefined
    if (variant.group === 'outfit' && (!outfit || typeof outfit !== 'object' || Array.isArray(outfit) || Object.keys(outfit).some((key) => !['slot', 'garmentType'].includes(key)) || !CHARACTER_OUTFIT_SLOTS.includes(outfit.slot as never) || typeof outfit.garmentType !== 'string' || !outfit.garmentType.trim() || outfit.garmentType.length > 80)) throw new Error('Invalid outfit metadata')
    if (variant.group !== 'outfit' && outfit) throw new Error('Only outfits have garment metadata')
    if (variant.group === 'expression' ? typeof metadata?.faceStyleId !== 'string' || !faceStyles.has(metadata.faceStyleId) : metadata?.faceStyleId !== undefined) throw new Error('Invalid expression Face Style')
  }
}

/** Shared metadata command for the editor and WebMCP. */
export function updateCharacterVariantMetadata(
  draft: CharacterDraft,
  group: CharacterVariantGroup,
  variantId: string,
  patch: CharacterVariantProfilePatch,
): CharacterDraft {
  let variant = draft.variants.find((candidate) => candidate.group === group && candidate.id === variantId)
  if (!variant) {
    if (group === 'body' || !CHARACTER_VARIANT_ID_PATTERN.test(variantId) || !patch.label?.trim()) throw new Error('Character variant not found; a valid label is required to create it')
    variant = { group, id: variantId, label: patch.label.trim(), layers: {} }
    draft = { ...draft, variants: [...draft.variants, variant] }
  }
  const label = patch.label === undefined ? variant.label : patch.label.trim()
  if (!label || label.length > 80) throw new Error('Variant name must be 1–80 characters')
  if (patch.outfit && group !== 'outfit') throw new Error('Only outfits have garment metadata')
  if (group === 'outfit' && !patch.outfit && !variant.metadata?.outfit) throw new Error('Outfit metadata requires a slot and garment type')
  const outfit = patch.outfit ?? variant.metadata?.outfit
  if (outfit && (!CHARACTER_OUTFIT_SLOTS.includes(outfit.slot) || !outfit.garmentType.trim() || outfit.garmentType.trim().length > 80)) {
    throw new Error('Invalid outfit metadata')
  }
  const sourceSha256 = patch.sourceSha256 === undefined ? variant.metadata?.sourceSha256 : patch.sourceSha256 ?? undefined
  if (sourceSha256 && !/^[0-9a-f]{64}$/.test(sourceSha256)) throw new Error('Invalid source image hash')
  const description = metadataText(patch.description, 500, 'Variant description') ?? (patch.description === undefined ? variant.metadata?.description : undefined)
  const tags = metadataTags(patch.tags) ?? (patch.tags === undefined ? variant.metadata?.tags : undefined)
  let faceStyles = draft.faceStyles
  let faceStyleId = patch.faceStyleId ?? variant.metadata?.faceStyleId
  if (patch.faceStyleId && !draft.faceStyles.some(({ id }) => id === patch.faceStyleId)) throw new Error('Face Style not found')
  if (patch.faceStyle) {
    if (group !== 'expression') throw new Error('Only expressions belong to a Face Style')
    const existing = draft.faceStyles.find((item) => item.id === patch.faceStyle!.id.trim())
    const faceStyle = {
      ...patch.faceStyle,
      id: patch.faceStyle.id.trim(),
      label: patch.faceStyle.label.trim(),
      description: patch.faceStyle.description === undefined ? existing?.description : metadataText(patch.faceStyle.description, 500, 'Face Style description'),
      tags: patch.faceStyle.tags === undefined ? existing?.tags : metadataTags(patch.faceStyle.tags),
      facialHair: patch.faceStyle.facialHair === undefined ? existing?.facialHair ?? null : patch.faceStyle.facialHair ? {
        ...patch.faceStyle.facialHair,
        type: patch.faceStyle.facialHair.type.trim(),
      } : null,
    }
    if (!CHARACTER_VARIANT_ID_PATTERN.test(faceStyle.id) || !faceStyle.label || faceStyle.label.length > 80 || (faceStyle.facialHair && !faceStyle.facialHair.type)) throw new Error('Invalid Face Style')
    faceStyles = faceStyles.some(({ id }) => id === faceStyle.id)
      ? faceStyles.map((item) => item.id === faceStyle.id ? faceStyle : item)
      : [...faceStyles, faceStyle]
    faceStyleId = faceStyle.id
  }
  const metadata = { ...(description ? { description } : {}), ...(tags?.length ? { tags } : {}), ...(sourceSha256 ? { sourceSha256 } : {}),
    ...(outfit ? { outfit: { slot: outfit.slot, garmentType: outfit.garmentType.trim() } } : {}), ...(faceStyleId ? { faceStyleId } : {}) }
  const variants = draft.variants.map((candidate) => candidate === variant ? { ...candidate, label, metadata } : candidate)
  const next = { ...draft, variants, faceStyles }
  validateCharacterVariantMetadata(next)
  return next
}
