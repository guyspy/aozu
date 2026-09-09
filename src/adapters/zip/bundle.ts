import { ContentState, EntryDataValidator, type Entry } from '@aotter/mantle-spec'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { inspectZipDirectory, parseZipJson, safeZipPath as safePath } from './archive.ts'
export { parseZipJson } from './archive.ts'

import { validateBundle, type BundleRecord } from '../../core/bundle.ts'
import { validateCharacterPack, type CharacterPack } from '../../core/domain/character.ts'
import { resolveSceneComposition, validateSceneAsset, type SceneAsset, type SceneAssetInspection, type SceneComposition } from '../../core/domain/scene.ts'
import { loadStage } from '../../core/application/stage.ts'
import type { StagedCandidatePreview } from '../../core/application/candidate.ts'
import { inspectCharacterImage } from '../browser/character-image.ts'
import { inspectSceneImage } from '../browser/scene-image.ts'
import { createIndexedDbAssetRepository } from '../indexeddb/asset-repository.ts'
import { createIndexedDbBundleRepository } from '../indexeddb/bundle-repository.ts'
import { persistImportedCandidate } from '../indexeddb/candidate-review.ts'
import { createIndexedDbEntryRepository } from '../indexeddb/mantle-storage.ts'

type IntegrityEntry = { path: string; byteLength: number; mediaType: string; sha256: string }
type Descriptor = {
  version: 1
  sourceBundleId: string
  semanticFingerprint: string
  identity: BundleRecord['identity']
  createdAt: number
  metadata?: BundleRecord['metadata']
  assets: Array<{ id: string; path: string; mediaType: string }>
}

const json = (value: unknown) => strToU8(JSON.stringify(value))
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const digest = async (bytes: Uint8Array) => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
}

function portablePath(path: string) {
  return path === 'bundle.json' || path === 'integrity.json' ||
    /^manifests\/[\w./-]+\.ya?ml$/.test(path) ||
    /^entries\/[a-z0-9][a-z0-9-]*\.json$/.test(path) ||
    /^assets\/[A-Za-z0-9%._~-]+$/.test(path)
}

function draftPath(path: string) {
  return path === 'draft.json' || path === 'experience-draft.json' || path === 'character-pack.json' ||
    path === 'character.atlas.webp' || path === 'character.atlas.json' || path === 'README.md' ||
    /^assets\/[a-z0-9][a-z0-9_-]*\.png$/.test(path) ||
    /^assets\/appearance\/[a-z0-9][a-z0-9_-]{0,39}\/reference-[a-z0-9][a-z0-9_-]{0,39}\.png$/.test(path)
}

export function companionArchiveKind(bytes: Uint8Array): 'portable' | 'character-draft' {
  const names = new Set([...inspectZipDirectory(bytes).keys()].filter((name) => !name.endsWith('/')))
  const portable = names.has('bundle.json') || names.has('integrity.json')
  const draft = names.has('draft.json')
  if (portable && draft) throw new Error('The ZIP mixes a Companion bundle with an authoring draft')
  if (portable) {
    if (!names.has('bundle.json')) throw new Error('The Companion bundle is incomplete: bundle.json is missing')
    if (!names.has('integrity.json')) throw new Error('The Companion bundle is incomplete: integrity.json is missing')
    for (const name of names) if (!portablePath(name)) throw new Error(`Unsafe ZIP entry: ${name}`)
    return 'portable'
  }
  if (draft) {
    for (const name of names) if (!draftPath(name)) throw new Error(`Unsafe ZIP entry: ${name}`)
    return 'character-draft'
  }
  throw new Error('Unsupported Companion ZIP: expected bundle.json or draft.json')
}

export function preflightPortableZip(bytes: Uint8Array) {
  if (companionArchiveKind(bytes) !== 'portable') throw new Error('Portable bundle files are missing')
}

export async function exportPortableBundle(): Promise<Blob> {
  const active = await createIndexedDbBundleRepository().getActive()
  if (!active) throw new Error('No active bundle')
  const { record, plan } = active
  const entries = createIndexedDbEntryRepository(record.id)
  const files: Record<string, Uint8Array> = {}
  for (const [sourceId, text] of Object.entries(record.manifestFiles)) {
    const path = `manifests/${sourceId}`
    if (!safePath(path)) throw new Error(`Unsafe manifest path: ${sourceId}`)
    files[path] = strToU8(text)
  }
  for (const collection of Object.keys(plan.schemas).sort()) {
    const rows = await entries.list({ collection, limit: Number.MAX_SAFE_INTEGER })
    files[`entries/${collection}.json`] = json(rows.rows.map(({ id, collection: name, status, version, data, createdAt, updatedAt }) => ({ id, collection: name, status, version, data, createdAt, updatedAt })))
  }
  const assets = await createIndexedDbAssetRepository(record.id).list()
  const assetDescriptors: Descriptor['assets'] = []
  for (const asset of assets.sort((left, right) => left.id.localeCompare(right.id))) {
    const path = `assets/${encodeURIComponent(asset.id)}`
    files[path] = new Uint8Array(await asset.blob.arrayBuffer())
    assetDescriptors.push({ id: asset.id, path, mediaType: asset.blob.type })
  }
  const descriptor: Descriptor = {
    version: 1,
    sourceBundleId: record.id,
    semanticFingerprint: record.semanticFingerprint,
    identity: record.identity,
    createdAt: record.createdAt,
    metadata: record.metadata,
    assets: assetDescriptors,
  }
  files['bundle.json'] = json(descriptor)
  const integrity: IntegrityEntry[] = []
  for (const path of Object.keys(files).sort()) {
    const mediaType = path.endsWith('.json') ? 'application/json' : path.startsWith('assets/') ? assetDescriptors.find((asset) => asset.path === path)!.mediaType : 'application/yaml'
    integrity.push({ path, byteLength: files[path]!.byteLength, mediaType, sha256: await digest(files[path]!) })
  }
  files['integrity.json'] = json({ version: 1, files: integrity })
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' })
}

export async function stagePortableBundle(blob: Blob): Promise<StagedCandidatePreview> {
  const archive = new Uint8Array(await blob.arrayBuffer())
  preflightPortableZip(archive)
  const files = unzipSync(archive)
  for (const path of Object.keys(files)) if (path.endsWith('/')) delete files[path]
  const integrity = parseZipJson<{ version: number; files: IntegrityEntry[] }>(files['integrity.json']!, 'integrity manifest')
  if (integrity.version !== 1 || !Array.isArray(integrity.files)) throw new Error('Unsupported integrity manifest')
  const expectedPaths = new Set(Object.keys(files).filter((path) => path !== 'integrity.json'))
  const integrityByPath = new Map<string, IntegrityEntry>()
  if (integrity.files.length !== expectedPaths.size) throw new Error('Integrity file count mismatch')
  for (const item of integrity.files) {
    const bytes = files[item.path]
    if (
      !bytes || !expectedPaths.delete(item.path) || !/^[0-9a-f]{64}$/.test(item.sha256) ||
      bytes.byteLength !== item.byteLength || (await digest(bytes)) !== item.sha256
    ) throw new Error(`Integrity mismatch: ${item.path}`)
    integrityByPath.set(item.path, item)
  }
  if (expectedPaths.size) throw new Error('Unlisted archive file')
  const descriptor = parseZipJson<Descriptor>(files['bundle.json']!, 'bundle descriptor')
  if (
    descriptor.version !== 1 || !Array.isArray(descriptor.assets) ||
    !descriptor.semanticFingerprint || !descriptor.identity || !descriptor.metadata
  ) throw new Error('Unsupported portable bundle')
  for (const [path, item] of integrityByPath) {
    const expected = path.endsWith('.json') ? 'application/json' : path.startsWith('manifests/') ? 'application/yaml' : descriptor.assets.find((asset) => asset.path === path)?.mediaType
    if (!expected || item.mediaType !== expected) throw new Error(`Invalid media type: ${path}`)
  }
  const manifestFiles = Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => path.startsWith('manifests/'))
      .map(([path, bytes]) => [path.slice('manifests/'.length), strFromU8(bytes)]),
  )
  const id = `bundle:${crypto.randomUUID()}`
  const record: BundleRecord = {
    id,
    manifestFiles,
    semanticFingerprint: descriptor.semanticFingerprint,
    identity: descriptor.identity,
    createdAt: Date.now(),
    metadata: descriptor.metadata,
  }
  const validated = validateBundle(record)
  const entries: Entry[] = []
  const validator = new EntryDataValidator()
  const entryFiles = Object.entries(files).filter(([path]) => path.startsWith('entries/'))
  if (entryFiles.length !== Object.keys(validated.plan.schemas).length) throw new Error('Entry collections are incomplete')
  for (const [path, bytes] of entryFiles) {
    const collection = path.slice('entries/'.length, -'.json'.length)
    const values = parseZipJson<Entry[]>(bytes, path)
    const schema = validated.plan.schemas[collection]?.manifest
    if (!schema || !Array.isArray(values)) throw new Error(`Unknown entry collection: ${collection}`)
    for (const entry of values) {
      if (
        entry.collection !== collection || !entry.id || entry.id.length > 200 ||
        !Object.values(ContentState).includes(entry.status) ||
        !Number.isSafeInteger(entry.version) || entry.version < 1 ||
        !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0 ||
        !Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < entry.createdAt ||
        !entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data) ||
        validator.validate(schema, entry.data).length
      ) throw new Error(`Invalid entry: ${collection}/${entry.id}`)
      entries.push(entry)
    }
  }
  if (new Set(entries.map(({ id: entryId }) => entryId)).size !== entries.length) throw new Error('Duplicate entry ID')
  const assets = new Map<string, Blob>()
  const assetPaths = new Set(Object.keys(files).filter((path) => path.startsWith('assets/')))
  for (const descriptorAsset of descriptor.assets) {
    const bytes = files[descriptorAsset.path]
    if (
      !descriptorAsset.id || !descriptorAsset.mediaType || !bytes ||
      !descriptorAsset.path.startsWith('assets/') || !safePath(descriptorAsset.path) ||
      !assetPaths.delete(descriptorAsset.path) || assets.has(descriptorAsset.id)
    ) throw new Error(`Invalid asset: ${descriptorAsset.id}`)
    assets.set(descriptorAsset.id, new Blob([bytes], { type: descriptorAsset.mediaType }))
  }
  if (assetPaths.size) throw new Error('Unlisted asset file')
  for (const entry of entries.filter(({ collection }) => collection === 'character-packs')) {
    const pack = entry.data.pack as CharacterPack
    const inspections = new Map<string, Awaited<ReturnType<typeof inspectCharacterImage>>>()
    for (const asset of pack.assets ?? []) {
      const file = assets.get(asset.blobId)
      if (!file) throw new Error(`Character asset is missing: ${asset.blobId}`)
      inspections.set(asset.blobId, await inspectCharacterImage(file))
    }
    validateCharacterPack(pack, inspections)
  }
  const publishedCharacterStates = new Set(entries
    .filter(({ collection, status }) => collection === 'character-states' && status === 'published')
    .map(({ id: entryId }) => entryId))
  const sceneAssetEntries = entries.filter(({ collection }) => collection === 'scene-assets')
  const sceneAssets = new Map(sceneAssetEntries
    .map((entry) => [entry.id, { id: entry.id, ...entry.data } as unknown as SceneAsset]))
  const publishedSceneAssets = new Set(sceneAssetEntries
    .filter(({ status }) => status === 'published')
    .map(({ id: entryId }) => entryId))
  const sceneInspections = new Map<string, SceneAssetInspection>()
  for (const asset of sceneAssets.values()) {
    const file = assets.get(asset.blobId)
    if (!file) throw new Error(`Scene asset is missing: ${asset.blobId}`)
    const inspection = await inspectSceneImage(file)
    validateSceneAsset(asset, inspection)
    sceneInspections.set(asset.blobId, inspection)
  }
  const sceneCompositionEntries = entries.filter(({ collection }) => collection === 'scene-compositions')
  const sceneCompositions = new Map(sceneCompositionEntries
    .map((entry) => [entry.id, { id: entry.id, ...entry.data } as unknown as SceneComposition]))
  for (const composition of sceneCompositions.values()) resolveSceneComposition(composition, sceneAssets, sceneInspections)
  const publishedSceneCompositions = new Set(sceneCompositionEntries
    .filter(({ status }) => status === 'published')
    .map(({ id: entryId }) => entryId))
  for (const entry of sceneCompositionEntries.filter(({ status }) => status === 'published')) {
    const composition = sceneCompositions.get(entry.id)!
    if (composition.layers.some(({ assetId }) => !publishedSceneAssets.has(assetId))) throw new Error(`Published scene composition references unpublished asset: ${entry.id}`)
  }
  for (const stage of entries.filter(({ collection, status }) => collection === 'stages' && status === 'published')) {
    const scene = stage.data.scene as { compositionId?: unknown; characterStateId?: unknown; backgroundAssetId?: unknown } | undefined
    if (scene && typeof scene.compositionId !== 'string' && typeof scene.backgroundAssetId === 'string') continue
    if (scene && typeof scene.compositionId !== 'string' && typeof scene.characterStateId !== 'string') {
      throw new Error(`Stage scene is missing: ${stage.id}`)
    }
    if (scene && typeof scene.compositionId === 'string' && !publishedSceneCompositions.has(scene.compositionId)) throw new Error(`Stage scene is missing: ${stage.id}`)
    if (scene && typeof scene.characterStateId === 'string' && !publishedCharacterStates.has(scene.characterStateId)) throw new Error(`Stage character state is missing: ${stage.id}`)
  }
  const bundles = createIndexedDbBundleRepository()
  await persistImportedCandidate(record, entries, assets)
  try {
    const assetRepository = createIndexedDbAssetRepository(id)
    const storedEntries = createIndexedDbEntryRepository(id)
    for (const entry of entries) {
      const stored = await storedEntries.readById(entry.id)
      if (!stored || stored.collection !== entry.collection || stored.status !== entry.status || stored.version !== entry.version || JSON.stringify(stored.data) !== JSON.stringify(entry.data)) {
        throw new Error(`Entry read-back failed: ${entry.id}`)
      }
    }
    const storedAssets = await assetRepository.list()
    if (storedAssets.length !== assets.size) throw new Error('Asset read-back count mismatch')
    for (const asset of storedAssets) {
      const descriptorAsset = descriptor.assets.find(({ id: assetId }) => assetId === asset.id)!
      const expected = integrityByPath.get(descriptorAsset.path)!
      const bytes = new Uint8Array(await asset.blob.arrayBuffer())
      if (asset.blob.type !== descriptorAsset.mediaType || bytes.byteLength !== expected.byteLength || await digest(bytes) !== expected.sha256) throw new Error(`Asset read-back failed: ${asset.id}`)
    }
    await loadStage(storedEntries, descriptor.metadata.runId)
  } catch (error) {
    await bundles.discardPendingReview(id)
    throw error
  }
  return {
    source: 'import',
    bundleId: id,
    name: descriptor.metadata.name,
    entryCount: entries.length,
    assetCount: assets.size,
  }
}
