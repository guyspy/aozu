import { strToU8, zipSync } from 'fflate'
import { mapCharacterAssets } from '../../core/application/character-assets.ts'
import { validateModelSheet } from '../../core/application/character-model-sheet.ts'

import {
  characterLibraryDigest, inspectCharacterLibrarySnapshot,
  type CharacterLibrarySnapshot,
} from '../../core/application/character-library.ts'
import type { CharacterAssetContent, CharacterAssetInspection, CharacterDraft, CharacterDraftAsset } from '../../core/domain/character.ts'
import { parseZipJson, readSafeZip, type ZipLimits } from './archive.ts'
import { inspectCharacterImage } from '../browser/character-image.ts'

export const CHARACTER_LIBRARY_ZIP_LIMITS: ZipLimits = {
  archive: 256 * 1024 * 1024, expanded: 256 * 1024 * 1024, file: 20 * 1024 * 1024, files: 10_000,
}
const accepts = (path: string) => path === 'library.json' || path === 'integrity.json' || /^assets\/[0-9]+\.png$/.test(path)
const json = (value: unknown) => strToU8(JSON.stringify(value))
interface IntegrityFile { path: string; byteLength: number; sha256: string }
interface AssetDescriptor { bundleId: string; id: string; path: string; mediaType: string }
type ArchivedDraft = Omit<CharacterDraft, 'variants' | 'modelSheet'> & CharacterAssetContent<Omit<CharacterDraftAsset, 'blob'> & { path: string; mediaType: string }>

interface Manifest {
  format: 'aozu-character-library'
  version: 1
  entries: CharacterLibrarySnapshot['entries']
  assets: AssetDescriptor[]
  legacyDrafts: ArchivedDraft[]
}

/** One lossless library archive: editable workspaces, Collections, installed packs, staged assets, and legacy drafts. */
export async function exportCharacterLibraryZip(snapshot: CharacterLibrarySnapshot, inspect = inspectCharacterImage): Promise<Blob> {
  await inspectCharacterLibrarySnapshot(snapshot, inspect)
  const files: Record<string, Uint8Array> = {}
  const integrity: IntegrityFile[] = []
  let expanded = 0
  const add = async (path: string, blob: Blob, expectedDigest?: string) => {
    if (blob.size > CHARACTER_LIBRARY_ZIP_LIMITS.file) throw new Error('Character library file is too large')
    expanded += blob.size
    if (expanded > CHARACTER_LIBRARY_ZIP_LIMITS.expanded || integrity.length + 2 > CHARACTER_LIBRARY_ZIP_LIMITS.files) throw new Error('Character library archive is too large')
    const sha256 = await characterLibraryDigest(blob)
    if (expectedDigest !== undefined && expectedDigest !== sha256) throw new Error(`Character library asset digest mismatch: ${path}`)
    files[path] = new Uint8Array(await blob.arrayBuffer())
    integrity.push({ path, byteLength: blob.size, sha256 })
    return path
  }
  const assets: AssetDescriptor[] = []
  for (const asset of snapshot.assets) {
    const path = await add(`assets/${integrity.length}.png`, asset.blob, asset.bundleId.startsWith('character:') ? asset.id : undefined)
    assets.push({ bundleId: asset.bundleId, id: asset.id, path, mediaType: asset.blob.type })
  }
  const legacyDrafts: ArchivedDraft[] = []
  let nextAsset = assets.length
  for (const draft of snapshot.legacyDrafts) {
    const content = await mapCharacterAssets(draft, async ({ blob, ...descriptor }) => {
      const path = await add(`assets/${nextAsset++}.png`, blob, descriptor.inspection.sha256)
      return { ...descriptor, path, mediaType: blob.type }
    })
    legacyDrafts.push({ ...draft, ...content })
  }
  await add('library.json', new Blob([json({ format: 'aozu-character-library', version: 1, entries: snapshot.entries, assets, legacyDrafts } satisfies Manifest)]))
  files['integrity.json'] = json({ version: 1, files: integrity })
  const archive = zipSync(files, { level: 0 })
  // Apply the same limits to our output, including ZIP and manifest overhead.
  readSafeZip(archive, accepts, CHARACTER_LIBRARY_ZIP_LIMITS)
  return new Blob([archive], { type: 'application/zip' })
}

/** All archive, digest, model, reference, and decoded-image checks finish before a caller can restore storage. */
export async function readCharacterLibraryZip(blob: Blob, inspect: (blob: Blob) => Promise<CharacterAssetInspection>): Promise<CharacterLibrarySnapshot> {
  if (blob.size > CHARACTER_LIBRARY_ZIP_LIMITS.archive) throw new Error('Archive is too large')
  const files = readSafeZip(new Uint8Array(await blob.arrayBuffer()), accepts, CHARACTER_LIBRARY_ZIP_LIMITS)
  if (!files['library.json'] || !files['integrity.json']) throw new Error('Character library manifest or integrity file is missing')
  const integrity = parseZipJson<{ version: number; files: IntegrityFile[] }>(files['integrity.json'], 'Character library integrity manifest')
  if (integrity?.version !== 1 || !Array.isArray(integrity.files)) throw new Error('Unsupported Character library integrity manifest')
  const paths = new Set(Object.keys(files).filter((path) => path !== 'integrity.json'))
  if (paths.size !== integrity.files.length) throw new Error('Character library integrity file count mismatch')
  for (const item of integrity.files) {
    if (!item || typeof item.path !== 'string' || !paths.delete(item.path) || !Number.isSafeInteger(item.byteLength) ||
      files[item.path].byteLength !== item.byteLength || !/^[0-9a-f]{64}$/.test(item.sha256) ||
      await characterLibraryDigest(new Blob([files[item.path]])) !== item.sha256) throw new Error(`Character library integrity mismatch: ${item?.path}`)
  }
  const manifest = parseZipJson<Manifest>(files['library.json'], 'Character library manifest')
  if (manifest?.format !== 'aozu-character-library' || manifest.version !== 1 || !Array.isArray(manifest.entries) ||
    !Array.isArray(manifest.assets) || !Array.isArray(manifest.legacyDrafts)) throw new Error('Unsupported Character library format')
  const assetPaths = new Set(Object.keys(files).filter((path) => path.startsWith('assets/')))
  const take = (descriptor: { path: string; mediaType: string }): Blob => {
    if (!descriptor || typeof descriptor.path !== 'string' || descriptor.mediaType !== 'image/png' ||
      !assetPaths.delete(descriptor.path)) throw new Error('Missing, duplicate, or invalid Character library asset path')
    return new Blob([files[descriptor.path]], { type: descriptor.mediaType })
  }
  const assets = manifest.assets.map((asset) => ({ bundleId: asset.bundleId, id: asset.id, blob: take(asset) }))
  const legacyDrafts = await Promise.all(manifest.legacyDrafts.map(async (draft) => {
    if (!draft || !Array.isArray(draft.variants)) throw new Error('Invalid legacy Character library draft')
    for (const variant of draft.variants) if (!variant || !variant.layers || typeof variant.layers !== 'object' || Array.isArray(variant.layers)) throw new Error('Invalid legacy Character library layers')
    if (draft.modelSheet !== undefined) validateModelSheet(draft.modelSheet)
    return { ...draft, ...await mapCharacterAssets(draft, (asset) => {
      const blob = take(asset)
      const { path: _path, mediaType: _mediaType, ...descriptor } = asset
      return { ...descriptor, blob }
    }) }
  }))
  if (assetPaths.size) throw new Error('Unreferenced Character library archive asset')
  const snapshot = { entries: manifest.entries, assets, legacyDrafts }
  await inspectCharacterLibrarySnapshot(snapshot, inspect)
  return snapshot
}
