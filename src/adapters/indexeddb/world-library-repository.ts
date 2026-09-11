import { WORLD_NAMESPACE, emptyWorldLibrary, libraryImages, validateWorldLibrary, type WorldLibrary } from '../../core/domain/world-library.ts'
import { ASSET_STORE, ENTRY_STORE, openCompanionDatabase } from './database.ts'
import { AUTHORING_NAMESPACE } from '../../core/application/authoring.ts'

const key: [string, string] = [WORLD_NAMESPACE, 'library']
export function createWorldLibraryRepository() {
  return {
    async load(): Promise<WorldLibrary> {
      const entry = await (await openCompanionDatabase()).get(ENTRY_STORE, key)
      return entry ? validateWorldLibrary(entry.data.library) : emptyWorldLibrary()
    },
    async image(hash: string): Promise<Blob> {
      const asset = await (await openCompanionDatabase()).get(ASSET_STORE, [WORLD_NAMESPACE, hash])
      if (!asset) throw new Error('Image is missing')
      return asset.blob
    },
    async save(input: WorldLibrary, blobs = new Map<string, Blob>()) {
      const next = validateWorldLibrary(input)
      // ponytail: one CAS-protected metadata document (4 MiB); split records if concurrent library editing becomes common.
      const tx = (await openCompanionDatabase()).transaction([ENTRY_STORE, ASSET_STORE], 'readwrite')
      try {
        const entries = tx.objectStore(ENTRY_STORE), assets = tx.objectStore(ASSET_STORE)
        const current = await entries.get(key)
        if ((current?.version ?? 0) !== next.revision) throw new Error('Library changed elsewhere. Reload before saving; your edits have not been applied.')
        const collectionIds = new Set((await entries.index('bundleId').getAll(AUTHORING_NAMESPACE)).filter((e) => e.collection === 'character-collections' && e.status === 'published').map((e) => e.id))
        collectionIds.add('default')
        if (next.locations.some((l) => !collectionIds.has(l.collectionId)) || next.folders.some((f) => f.collectionIds.some((id) => !collectionIds.has(id)))) throw new Error('Setting collection no longer exists')
        const previousImages = new Map(current ? libraryImages(validateWorldLibrary(current.data.library)).map((i) => [i.sha256, i]) : [])
        const images = new Map(libraryImages(next).map((i) => [i.sha256, i]))
        if ([...images.values()].reduce((sum, i) => sum + i.size, 0) > 256 * 1024 * 1024) throw new Error('Library image limit reached (256 MiB)')
        for (const [hash, image] of images) {
          const blob = blobs.get(hash)
          if (blob) {
            if (blob.size !== image.size || blob.type !== image.mediaType) throw new Error('Image metadata mismatch')
            await assets.put({ bundleId: WORLD_NAMESPACE, id: hash, blob })
          } else {
            const previous = previousImages.get(hash)
            if (!previous || (['mediaType', 'size', 'width', 'height'] as const).some((key) => previous[key] !== image[key])) throw new Error('Image metadata changed; upload the original image again')
            if (!await assets.get([WORLD_NAMESPACE, hash])) throw new Error('Referenced image is missing')
          }
        }
        next.revision++
        const now = Date.now()
        await entries.put({ bundleId: WORLD_NAMESPACE, id: 'library', collection: 'world-library', data: { library: next }, status: 'published', authorId: null, version: next.revision, createdAt: current?.createdAt ?? now, updatedAt: now })
        await tx.done; return next
      } catch (error) { try { tx.abort() } catch { /* Already settled. */ } await tx.done.catch(() => {}); throw error }
    },
  }
}

/** Keep location hierarchies reachable when a setting collection is removed or a character backup is restored. */
export function rehomeWorldCollections(entry: import('./database.ts').StoredEntry | undefined, collectionIds: Set<string>) {
  if (!entry) return undefined
  const library = validateWorldLibrary(entry.data.library)
  collectionIds.add('default')
  const before = JSON.stringify(library)
  library.locations = library.locations.map((l) => collectionIds.has(l.collectionId) ? l : { ...l, collectionId: 'default' })
  library.folders = library.folders.map((f) => ({ ...f, collectionIds: f.collectionIds.filter((id) => collectionIds.has(id)) }))
  if (before === JSON.stringify(library)) return undefined
  library.revision++
  return { ...entry, version: library.revision, updatedAt: Date.now(), data: { library } }
}
