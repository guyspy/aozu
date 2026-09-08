import { EntryDataValidator, type Entry } from '@aotter/mantle-spec'

import { AUTHORING_NAMESPACE } from './authoring.ts'
import { characterAssets } from './character-assets.ts'
import { validateModelSheet, validateReferenceInspection, validateReferencePng } from './character-model-sheet.ts'
import { validateCharacterAssetInspection } from './character-creation.ts'
import { CHARACTER_COLLECTIONS } from '../domain/character-collection.ts'
import { compileAuthoringBackbone } from '../mantle/backbone.ts'
import {
  CHARACTER_RIG, CHARACTER_VARIANT_GROUPS, CHARACTER_VARIANT_LAYERS,
  characterAssetScope, resolveCharacterComposition, validateCharacterPack, validateCharacterVariantTransform,
  type CharacterAssetInspection, type CharacterDraft, type CharacterDraftAsset, type CharacterPack, type CharacterWorkspaceData, type StoredCharacterAsset,
} from '../domain/character.ts'

export const CHARACTER_LIBRARY_PACK_NAMESPACE = 'character-pack-library'
export const CHARACTER_LIBRARY_REVISION_FLOOR = 'character-library:revision-floor'
export const CHARACTER_LIBRARY_COLLECTION = CHARACTER_COLLECTIONS
export type CharacterLibraryEntry = Entry & { bundleId: string; authorId: string | null }
export interface CharacterLibraryAsset { bundleId: string; id: string; blob: Blob }
export interface CharacterLibrarySnapshot {
  entries: CharacterLibraryEntry[]
  assets: CharacterLibraryAsset[]
  legacyDrafts: CharacterDraft[]
}
export type CharacterLibraryImportMode = 'merge' | 'replace'
export interface CharacterLibraryRepository {
  snapshot(): Promise<CharacterLibrarySnapshot>
  restore(snapshot: CharacterLibrarySnapshot, mode: CharacterLibraryImportMode): Promise<void>
}
export const isCharacterLibraryEntry = (entry: Pick<CharacterLibraryEntry, 'bundleId' | 'collection'>) =>
  (entry.bundleId === AUTHORING_NAMESPACE && ['character-workspaces', CHARACTER_LIBRARY_COLLECTION].includes(entry.collection)) ||
  (entry.bundleId === CHARACTER_LIBRARY_PACK_NAMESPACE && entry.collection === 'character-packs')
export const isCharacterLibraryAsset = ({ bundleId }: { bundleId: string }) =>
  bundleId === CHARACTER_LIBRARY_PACK_NAMESPACE || /^character:[a-z0-9][a-z0-9_-]{0,63}$/.test(bundleId)
export const characterLibraryKey = ({ bundleId, id }: { bundleId: string; id: string }) => JSON.stringify([bundleId, id])
export const characterLibraryJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Blob)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item)
export async function characterLibraryDigest(blob: Blob): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
function fail(label: string): never { throw new Error(`Invalid Character library ${label}`) }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && !!value.trim() && value.length <= max
const stamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
let authoring: ReturnType<typeof compileAuthoringBackbone> | undefined
const validator = new EntryDataValidator()
const validateAuthoringData = (collection: string, data: Record<string, unknown>) => {
  authoring ??= compileAuthoringBackbone()
  if (validator.validate(authoring.schemas[collection]!.manifest, data).length) fail(`${collection} schema`)
}

/** Validate partial authoring work without requiring publishable artwork. No mutation or repair on import. */
function validateDraft(draft: CharacterDraft | (CharacterWorkspaceData & { id: string; updatedAt: number }), assets: Map<string, CharacterLibraryAsset>) {
  if (!record(draft) || !text(draft.id) || draft.schemaVersion !== 4 || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(draft.packId) ||
    !text(draft.name) || !stamp(draft.updatedAt) || !record(draft.rigProfile) || draft.rigProfile.id !== CHARACTER_RIG.id || draft.rigProfile.version !== CHARACTER_RIG.version ||
    !Array.isArray(draft.variants) || !draft.variants.length || draft.variants.length > 100) fail('Character record')
  for (const [field, max] of [['description', 500], ['backstory', 8000]] as const) {
    if (draft[field] !== undefined && (typeof draft[field] !== 'string' || draft[field]!.length > max)) fail(field)
  }
  if (draft.attributes !== undefined && (!record(draft.attributes) || Object.keys(draft.attributes).length > 32 ||
    Object.entries(draft.attributes).some(([key, value]) => !text(key, 40) ||
      !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'string' && value.length > 200) ||
      (typeof value === 'number' && !Number.isFinite(value))))) fail('attributes')
  const validateAsset = (asset: CharacterDraftAsset | StoredCharacterAsset, reference = false) => {
    if (!record(asset) || !text(asset.filename) || !['user', 'agent', 'starter'].includes(asset.source) || !record(asset.inspection) ||
      !hash(asset.inspection.sha256) || (asset.canonicalSha256 !== undefined && !hash(asset.canonicalSha256))) fail('asset descriptor')
    if (reference) validateReferenceInspection(asset.inspection)
    else validateCharacterAssetInspection(asset.inspection)
    const blob = 'blob' in asset ? asset.blob : assets.get(characterLibraryKey({ bundleId: characterAssetScope(draft.packId), id: asset.blobId }))?.blob
    if (!(blob instanceof Blob) || blob.type !== 'image/png' || blob.size !== asset.inspection.size ||
      ('blobId' in asset && asset.blobId !== asset.inspection.sha256)) fail('missing or inconsistent Character asset')
  }
  if (draft.modelSheet !== undefined) {
    validateModelSheet(draft.modelSheet)
    for (const { asset } of Object.values(draft.modelSheet.views)) validateAsset(asset, true)
  }
  const variants = new Set<string>()
  for (const variant of draft.variants) {
    if (!record(variant) || !CHARACTER_VARIANT_GROUPS.includes(variant.group) ||
      typeof variant.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(variant.id) || !text(variant.label, 80) || !record(variant.layers)) fail('variant')
    const key = `${variant.group}:${variant.id}`
    if (variants.has(key)) fail('duplicate variant ID')
    variants.add(key)
    if (variant.group === 'body' && variant.transform !== undefined) fail('locked body transform')
    if (variant.transform) validateCharacterVariantTransform(variant.transform)
    for (const [layer, asset] of Object.entries(variant.layers)) {
      if (!(CHARACTER_VARIANT_LAYERS[variant.group] as readonly string[]).includes(layer)) fail('asset layer')
      validateAsset(asset)
    }
  }
  if (!variants.has('body:base') || [...variants].some((key) => key.startsWith('body:') && key !== 'body:base')) fail('base body')
  if (!record(draft.selected) || !Array.isArray(draft.selected.props) || new Set(draft.selected.props).size !== draft.selected.props.length ||
    draft.selected.props.some((id) => typeof id !== 'string' || !variants.has(`prop:${id}`))) fail('prop selection')
  for (const group of ['expression', 'outfit'] as const) {
    const id = draft.selected[group]
    if (id !== undefined && (typeof id !== 'string' || !variants.has(`${group}:${id}`))) fail('selection reference')
  }
  if (draft.headRegistration !== undefined && (!record(draft.headRegistration) || !variants.has(`expression:${draft.headRegistration.variantId}`))) fail('head registration')
}

/** Structural/reference validation is also used by the repository before any storage transaction. */
export function validateCharacterLibrarySnapshot(snapshot: CharacterLibrarySnapshot): void {
  if (!record(snapshot) || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.assets) || !Array.isArray(snapshot.legacyDrafts)) fail('snapshot')
  const assetKeys = new Set<string>()
  for (const asset of snapshot.assets) {
    if (!record(asset) || !text(asset.bundleId) || !isCharacterLibraryAsset(asset) || !text(asset.id, 300) || !(asset.blob instanceof Blob)) fail('asset scope')
    const key = characterLibraryKey(asset)
    if (assetKeys.has(key)) fail('duplicate asset ID')
    assetKeys.add(key)
  }
  const assets = new Map(snapshot.assets.map((asset) => [characterLibraryKey(asset), asset]))
  const entryKeys = new Set<string>()
  const characterIds = new Set<string>()
  const packIds = new Set<string>()
  for (const entry of snapshot.entries) {
    if (!record(entry) || !isCharacterLibraryEntry(entry) || !text(entry.id) || !record(entry.data) ||
      !['draft', 'published', 'archived'].includes(entry.status) || !Number.isSafeInteger(entry.version) || entry.version < 1 || entry.version >= Number.MAX_SAFE_INTEGER ||
      !stamp(entry.createdAt) || !stamp(entry.updatedAt) || entry.updatedAt < entry.createdAt ||
      !(entry.authorId === null || text(entry.authorId))) fail('entry')
    const key = characterLibraryKey(entry)
    if (entryKeys.has(key)) fail('duplicate entry ID')
    entryKeys.add(key)
    if (entry.bundleId === AUTHORING_NAMESPACE) {
      // These two fields existed before Mantle became the sole revision authority. Reads preserve them until a save.
      const { revision: _revision, published: _published, ...data } = entry.data
      validateAuthoringData(entry.collection, data)
    }
    if (entry.collection === 'character-workspaces') {
      validateDraft({ ...entry.data as unknown as CharacterWorkspaceData, id: entry.id, updatedAt: entry.updatedAt }, assets)
      characterIds.add(entry.id)
      const packId = String(entry.data.packId)
      if (packIds.has(packId)) fail('duplicate Character pack ID')
      packIds.add(packId)
    } else if (entry.collection === 'character-packs') {
      const pack = entry.data.pack as CharacterPack
      if (!text(entry.data.name) || !record(pack) || entry.id !== `${pack.id}@${pack.version}` || !Array.isArray(pack.assets) || !Array.isArray(entry.data.composition)) fail('installed pack')
      for (const asset of pack.assets) {
        if (!record(asset) || !text(asset.blobId) || !assets.has(characterLibraryKey({ bundleId: entry.bundleId, id: `${entry.id}:${asset.blobId}` }))) fail('installed pack asset reference')
      }
    }
  }
  const draftIds = new Set<string>()
  for (const draft of snapshot.legacyDrafts) {
    validateDraft(draft, assets)
    const { id: _id, updatedAt: _updatedAt, approvedAt: _approvedAt, variants, modelSheet, ...data } = draft as CharacterDraft & { approvedAt?: number }
    const descriptorFor = ({ blob: _blob, ...asset }: CharacterDraftAsset) => ({ ...asset, blobId: asset.inspection.sha256 })
    validateAuthoringData('character-workspaces', {
      ...data,
      ...(modelSheet ? { modelSheet: { ...modelSheet, views: Object.fromEntries(Object.entries(modelSheet.views).map(([view, reference]) => [view, { ...reference, asset: descriptorFor(reference.asset) }])) } } : {}),
      variants: variants.map(({ layers, ...variant }) => ({ ...variant, layers: Object.fromEntries(Object.entries(layers).map(([layer, asset]) => {
        return [layer, descriptorFor(asset!)]
      })) })),
    })
    if (draftIds.has(draft.id) || characterIds.has(draft.id) || packIds.has(draft.packId)) fail('duplicate legacy Character ID or pack ID')
    draftIds.add(draft.id)
    packIds.add(draft.packId)
  }
  const membership = new Set<string>()
  for (const entry of snapshot.entries.filter(({ collection }) => collection === CHARACTER_LIBRARY_COLLECTION)) {
    if (!text(entry.data.name, 100) || !Array.isArray(entry.data.characterIds)) fail('Collection')
    for (const id of entry.data.characterIds as unknown[]) {
      if (typeof id !== 'string' || !characterIds.has(id) || membership.has(id)) fail('duplicate or missing Collection Character reference')
      membership.add(id)
    }
  }
}

/** Inspect bytes as well as descriptors; JSON metadata cannot bless a corrupt or wrongly sized PNG. */
export async function inspectCharacterLibrarySnapshot(snapshot: CharacterLibrarySnapshot, inspect: (blob: Blob) => Promise<CharacterAssetInspection>) {
  validateCharacterLibrarySnapshot(snapshot)
  const inspectPng = async (blob: Blob) => {
    await validateReferencePng(blob)
    return inspect(blob)
  }
  const inspections = new Map<string, CharacterAssetInspection>()
  for (const asset of snapshot.assets) {
    const result = await inspectPng(asset.blob)
    validateReferenceInspection(result)
    if (asset.bundleId.startsWith('character:') && result.sha256 !== asset.id) fail('asset digest identity')
    inspections.set(characterLibraryKey(asset), result)
  }
  const verifyDescriptor = (actual: CharacterAssetInspection, expected: CharacterAssetInspection) => {
    for (const key of Object.keys(expected) as Array<keyof CharacterAssetInspection>) {
      if (characterLibraryJson(actual[key]) !== characterLibraryJson(expected[key])) fail('asset inspection mismatch')
    }
  }
  for (const entry of snapshot.entries) {
    if (entry.collection === 'character-workspaces') {
      const data = entry.data as unknown as CharacterWorkspaceData
      for (const asset of characterAssets(data)) {
        verifyDescriptor(inspections.get(characterLibraryKey({ bundleId: characterAssetScope(data.packId), id: asset.blobId }))!, asset.inspection)
      }
    } else if (entry.collection === 'character-packs') {
      const pack = entry.data.pack as CharacterPack
      const local = new Map(pack.assets.map((asset) => [asset.blobId, inspections.get(characterLibraryKey({ bundleId: entry.bundleId, id: `${entry.id}:${asset.blobId}` }))!]))
      validateCharacterPack(pack, local)
      resolveCharacterComposition(pack, entry.data.composition as CharacterPack['defaultComposition'])
    }
  }
  for (const draft of snapshot.legacyDrafts) for (const asset of characterAssets(draft)) {
    verifyDescriptor(await inspectPng(asset.blob), asset.inspection)
  }
}

/** Merge never chooses a winner for conflicting IDs. Metadata/revisions of an identical local record stay local. */
export async function mergeCharacterLibraries(current: CharacterLibrarySnapshot, incoming: CharacterLibrarySnapshot): Promise<CharacterLibrarySnapshot> {
  const entries = new Map(current.entries.map((entry) => [characterLibraryKey(entry), entry]))
  for (const entry of incoming.entries) {
    const key = characterLibraryKey(entry)
    const previous = entries.get(key)
    if (previous && characterLibraryJson({ collection: previous.collection, status: previous.status, data: previous.data }) !==
      characterLibraryJson({ collection: entry.collection, status: entry.status, data: entry.data })) throw new Error(`Character library merge conflict: ${entry.id}`)
    if (!previous) entries.set(key, entry)
  }
  const assets = new Map(current.assets.map((asset) => [characterLibraryKey(asset), asset]))
  for (const asset of incoming.assets) {
    const key = characterLibraryKey(asset)
    const previous = assets.get(key)
    if (previous && (previous.blob.type !== asset.blob.type || previous.blob.size !== asset.blob.size ||
      await characterLibraryDigest(previous.blob) !== await characterLibraryDigest(asset.blob))) throw new Error(`Character library merge asset conflict: ${asset.id}`)
    if (!previous) assets.set(key, asset)
  }
  const drafts = new Map(current.legacyDrafts.map((draft) => [draft.id, draft]))
  for (const draft of incoming.legacyDrafts) {
    const previous = drafts.get(draft.id)
    if (previous) {
      if (characterLibraryJson(previous) !== characterLibraryJson(draft)) throw new Error(`Character library merge draft conflict: ${draft.id}`)
      const oldAssets = new Map(characterAssets(previous).map((asset) => [asset.inspection.sha256, asset]))
      for (const asset of characterAssets(draft)) {
        const old = oldAssets.get(asset.inspection.sha256)
        if (!old || await characterLibraryDigest(old.blob) !== await characterLibraryDigest(asset.blob)) throw new Error(`Character library merge draft asset conflict: ${draft.id}`)
      }
    } else drafts.set(draft.id, draft)
  }
  const result = { entries: [...entries.values()], assets: [...assets.values()], legacyDrafts: [...drafts.values()] }
  validateCharacterLibrarySnapshot(result)
  return result
}
