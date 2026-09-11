import { strToU8, zipSync } from 'fflate'
import { createWorldLibraryRepository } from '../../adapters/indexeddb/world-library-repository.ts'
import { inspectSceneImage } from '../../adapters/browser/scene-image.ts'
import { readSafeZip, parseZipJson } from '../../adapters/zip/archive.ts'
import { libraryImages, validateWorldLibrary, type AlbumPhoto, type WorldLibrary, type LibraryImage } from '../domain/world-library.ts'

export function createWorldLibraryService() {
  const repository = createWorldLibraryRepository()
  const listeners = new Set<() => void>()
  const channel = typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('aozu-world-library')
  const notify = () => listeners.forEach((listener) => listener())
  if (channel) channel.onmessage = notify
  const changed = (library: WorldLibrary) => { notify(); channel?.postMessage(library.revision); return library }
  async function inspect(blob: Blob, filename: string): Promise<LibraryImage> {
    if (!blob.size || blob.size > 5 * 1024 * 1024) throw new Error('Images must be under 5 MiB')
    const image = await inspectSceneImage(blob)
    if (image.width > 4096 || image.height > 4096 || !filename || filename.length > 200) throw new Error('Images must be at most 4096 × 4096 with a filename under 200 characters')
    return { ...image, filename }
  }
  return {
    async refresh() { return changed(await repository.load()) },
    load: repository.load, image: repository.image,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { channel?.close(); listeners.clear() },
    async save(library: WorldLibrary) { return changed(await repository.save(library)) },
    async upload(library: WorldLibrary, albumId: string, files: File[]) {
      const next = structuredClone(library), blobs = new Map<string, Blob>()
      if (!files.length || files.length > 100) throw new Error('Choose 1–100 images')
      for (const file of files) {
        const image = await inspect(file, file.name)
        const photo: AlbumPhoto = { id: crypto.randomUUID(), name: file.name, description: '', source: '', updatedAt: Date.now(), albumId, image }
        next.photos.push(photo); blobs.set(image.sha256, file)
      }
      return changed(await repository.save(next, blobs))
    },
    async png(image: LibraryImage) {
      const blob = await repository.image(image.sha256)
      if (blob.type === 'image/png') return blob
      const bitmap = await createImageBitmap(blob)
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable')
        context.drawImage(bitmap, 0, 0)
        return await canvas.convertToBlob({ type: 'image/png' })
      } finally { bitmap.close() }
    },
    async export() {
      const library = await repository.load()
      const files: Record<string, Uint8Array> = { 'library.json': strToU8(JSON.stringify({ format: 'aozu-world-library', version: 1, library })) }
      for (const hash of new Set(libraryImages(library).map((i) => i.sha256))) files[`images/${hash}`] = new Uint8Array(await (await repository.image(hash)).arrayBuffer())
      return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' })
    },
    async import(blob: Blob, current: WorldLibrary) {
      if (blob.size > 280 * 1024 * 1024) throw new Error('Archive exceeds 280 MiB')
      const files = readSafeZip(new Uint8Array(await blob.arrayBuffer()), (path) => path === 'library.json' || /^images\/[a-f0-9]{64}$/.test(path), { archive: 280 * 1024 * 1024, expanded: 280 * 1024 * 1024, file: 5 * 1024 * 1024, files: 5000 })
      if (!files['library.json']) throw new Error('Library manifest missing')
      const manifest = parseZipJson<{ format: string; version: number; library: unknown }>(files['library.json'], 'world library')
      if (manifest.format !== 'aozu-world-library' || manifest.version !== 1) throw new Error('Unsupported library archive')
      const incoming = validateWorldLibrary(manifest.library), next = structuredClone(current), blobs = new Map<string, Blob>()
      for (const image of libraryImages(incoming)) {
        if (blobs.has(image.sha256)) continue
        const bytes = files[`images/${image.sha256}`]; if (!bytes) throw new Error('Image missing from archive')
        const blob = new Blob([bytes], { type: image.mediaType }), actual = await inspect(blob, image.filename)
        if (['sha256', 'size', 'width', 'height'].some((field) => actual[field as keyof LibraryImage] !== image[field as keyof LibraryImage])) throw new Error('Image content does not match archive metadata')
        blobs.set(image.sha256, blob)
      }
      // Additive import: independent copies, no overwrite of current user records or local board assignments.
      const remap = new Map<string, string>()
      for (const group of [incoming.albums, incoming.photos, incoming.locations, incoming.folders]) for (const item of group) remap.set(item.id, crypto.randomUUID())
      for (const album of incoming.albums) next.albums.push({ ...album, id: remap.get(album.id)! })
      for (const photo of incoming.photos) next.photos.push({ ...photo, id: remap.get(photo.id)!, albumId: remap.get(photo.albumId)! })
      for (const location of incoming.locations) next.locations.push({ ...location, id: remap.get(location.id)!, parentId: location.parentId ? remap.get(location.parentId)! : null, collectionId: 'default', images: location.images.map((i) => ({ ...i, photoId: remap.get(i.photoId) ?? i.photoId })), conditions: location.conditions.map((c) => ({ ...c, images: c.images.map((i) => ({ ...i, photoId: remap.get(i.photoId) ?? i.photoId })) })) })
      for (const folder of incoming.folders) next.folders.push({ ...folder, id: remap.get(folder.id)!, collectionIds: [] })
      return changed(await repository.save(next, blobs))
    },
  }
}
export type WorldLibraryService = ReturnType<typeof createWorldLibraryService>
