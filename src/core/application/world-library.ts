import { strToU8, zipSync } from 'fflate'
import { createWorldLibraryRepository } from '../../adapters/indexeddb/world-library-repository.ts'
import { inspectSceneImage } from '../../adapters/browser/scene-image.ts'
import { readSafeZip, parseZipJson } from '../../adapters/zip/archive.ts'
import { libraryImages, locationAncestors, validateWorldLibrary, type AlbumPhoto, type WorldLibrary, type LibraryImage, type LocationSetting, type SettingImage, type StoryBook } from '../domain/world-library.ts'

type GroupPatch = { name?: string; description?: string }
export type AlbumCharacterSource = { characterId: string; revision: number; sha256: string }
export type AlbumCompositionInput = { characterSources?: AlbumCharacterSource[]; sourceLocationId?: string; sourceConditionId?: string; prompt?: string; name?: string; description?: string }

export function validateAlbumComposition(input: AlbumCompositionInput, characters: { id: string; name: string; revision: number; sha256: string }[], locations: LocationSetting[]) {
  const prompt = input.prompt?.trim(); if (!prompt) throw new Error('Album photos require the composition prompt')
  const sources = input.characterSources ?? []
  if (new Set(sources.map(({ characterId }) => characterId)).size !== sources.length) throw new Error('Character sources must be unique')
  const names = sources.map((source) => {
    const character = characters.find(({ id }) => id === source.characterId); if (!character) throw new Error('Character source not found')
    if (character.revision !== source.revision || character.sha256 !== source.sha256) throw new Error(`${character.name} changed or its Appearance hash is incorrect; inspect_character_contract again`)
    return character.name
  })
  const text = `${input.name ?? ''}\n${input.description ?? ''}\n${prompt}`
  const referencedNames = characters.filter(({ id }) => sources.some(({ characterId }) => characterId === id)).map(({ name }) => name)
  const missingCharacter = [...characters].sort((a, b) => b.name.length - a.name.length).find(({ id, name }) => name && text.includes(name) && !sources.some(({ characterId }) => characterId === id) && !referencedNames.some((referenced) => referenced.includes(name) && text.includes(referenced)))
  if (missingCharacter) throw new Error(`${missingCharacter.name} is defined in AOZU and requires a Character reference`)
  const location = input.sourceLocationId ? locations.find(({ id }) => id === input.sourceLocationId) : undefined
  if (input.sourceLocationId && !location) throw new Error('Source Location not found')
  const mentionedLocation = locations.find(({ name }) => name && text.includes(name))
  if (mentionedLocation && mentionedLocation.id !== input.sourceLocationId) throw new Error(`${mentionedLocation.name} is defined in AOZU and requires a Location reference`)
  const condition = input.sourceConditionId && location ? location.conditions.find(({ id }) => id === input.sourceConditionId) : undefined
  if (input.sourceConditionId && !condition) throw new Error('Source Condition not found in the selected Location')
  const mentionedCondition = locations.flatMap((item) => item.conditions.map((candidate) => ({ location: item, condition: candidate }))).find(({ condition: candidate }) => candidate.name && text.includes(candidate.name))
  if (mentionedCondition && (mentionedCondition.location.id !== input.sourceLocationId || mentionedCondition.condition.id !== input.sourceConditionId)) throw new Error(`${mentionedCondition.condition.name} is defined in AOZU and requires a Condition reference`)
  return [`Characters: ${names.join(', ')}`, location && `Location: ${location.name}`, condition && `Condition: ${condition.name}`, `Prompt: ${prompt}`].filter(Boolean).join('; ').slice(0, 2000)
}

export type WorldLibraryCommand =
  | ({ resource: 'album'; action: 'create' | 'update' | 'delete'; id?: string } & GroupPatch)
  | ({ resource: 'photo'; action: 'update' | 'delete' | 'move'; id: string; albumId?: string; source?: string } & GroupPatch)
  | ({ resource: 'location'; action: 'create' | 'update' | 'delete' | 'duplicate'; id?: string; collectionId?: string; parentId?: string | null; tags?: string[]; consistency?: string } & GroupPatch)
  | ({ resource: 'condition'; action: 'create' | 'update' | 'delete' | 'duplicate'; locationId: string; id?: string } & GroupPatch)
  | ({ resource: 'reference'; action: 'create' | 'delete'; locationId: string; conditionId?: string; id?: string; photoId?: string; label?: string; purpose?: SettingImage['purpose'] })
  | ({ resource: 'story-book'; action: 'create' | 'update' | 'delete'; id?: string; synopsis?: string; direction?: string; collectionIds?: string[] } & GroupPatch)
  | { resource: 'storyboard-book'; action: 'move'; boardId: string; bookId?: string | null }

const requiredName = (name: string | undefined) => {
  const value = name?.trim()
  if (!value) throw new Error('Name is required')
  return value
}

export function applyWorldLibraryCommand(current: WorldLibrary, command: WorldLibraryCommand): { library: WorldLibrary; id: string | null } {
  const library = structuredClone(current), now = Date.now(), patch = command as GroupPatch
  const group = (fallback?: { name: string; description: string }) => ({
    name: patch.name === undefined ? fallback?.name ?? requiredName(patch.name) : requiredName(patch.name),
    description: patch.description ?? fallback?.description ?? '', updatedAt: now,
  })
  if (command.resource === 'album') {
    if (command.action === 'create') { const id = command.id ?? crypto.randomUUID(); library.albums.push({ id, ...group() }); return { library, id } }
    const album = library.albums.find((item) => item.id === command.id); if (!album) throw new Error('Album not found')
    if (command.action === 'update') Object.assign(album, group(album))
    else { if (album.id === 'default') throw new Error('The default Album cannot be deleted'); library.albums = library.albums.filter((item) => item.id !== album.id); library.photos.forEach((photo) => { if (photo.albumId === album.id) photo.albumId = 'default' }) }
    return { library, id: album.id }
  }
  if (command.resource === 'photo') {
    const photo = library.photos.find((item) => item.id === command.id); if (!photo) throw new Error('Photo not found')
    if (command.action === 'delete') library.photos = library.photos.filter((item) => item.id !== photo.id)
    else {
      if (command.action === 'move' && !command.albumId) throw new Error('Album ID is required')
      if (command.albumId && !library.albums.some((item) => item.id === command.albumId)) throw new Error('Album not found')
      Object.assign(photo, group(photo), command.albumId === undefined ? {} : { albumId: command.albumId }, command.source === undefined ? {} : { source: command.source })
    }
    return { library, id: photo.id }
  }
  if (command.resource === 'location') {
    if (command.action === 'create') {
      const id = command.id ?? crypto.randomUUID(), location: LocationSetting = { id, ...group(), collectionId: command.collectionId ?? 'default', parentId: command.parentId ?? null, tags: command.tags ?? [], consistency: command.consistency ?? '', images: [], conditions: [] }
      library.locations.push(location); return { library, id }
    }
    const location = library.locations.find((item) => item.id === command.id); if (!location) throw new Error('Location not found')
    if (command.action === 'duplicate') {
      const id = crypto.randomUUID(), used = new Set(library.locations.map(({ name }) => name)), base = `${location.name} copy`
      let name = base; for (let suffix = 2; used.has(name); suffix++) name = `${base} ${suffix}`
      library.locations.push({ ...structuredClone(location), id, name, parentId: location.parentId, updatedAt: now, images: location.images.map((image) => ({ ...image, id: crypto.randomUUID() })), conditions: location.conditions.map((condition) => ({ ...condition, id: crypto.randomUUID(), updatedAt: now, images: condition.images.map((image) => ({ ...image, id: crypto.randomUUID() })) })) })
      return { library, id }
    }
    if (command.action === 'delete') library.locations = library.locations.filter((item) => item.id !== location.id).map((item) => item.parentId === location.id ? { ...item, parentId: location.parentId } : item)
    else {
      const collectionId = command.collectionId ?? location.collectionId
      for (const item of library.locations) if (locationAncestors(library, item.id).some((ancestor) => ancestor.id === location.id)) item.collectionId = collectionId
      Object.assign(location, group(location), { collectionId }, command.parentId === undefined ? {} : { parentId: command.parentId }, command.tags === undefined ? {} : { tags: [...new Set(command.tags.map((tag) => tag.trim()).filter(Boolean))] }, command.consistency === undefined ? {} : { consistency: command.consistency })
    }
    return { library, id: location.id }
  }
  if (command.resource === 'condition') {
    const location = library.locations.find((item) => item.id === command.locationId); if (!location) throw new Error('Location not found')
    if (command.action === 'create') { const id = command.id ?? crypto.randomUUID(); location.conditions.push({ id, ...group(), images: [] }); location.updatedAt = now; return { library, id } }
    const condition = location.conditions.find((item) => item.id === command.id); if (!condition) throw new Error('Condition not found')
    if (command.action === 'duplicate') {
      const id = crypto.randomUUID(); location.conditions.push({ ...structuredClone(condition), id, ...group(condition), images: condition.images.map((image) => ({ ...image, id: crypto.randomUUID() })) }); location.updatedAt = now; return { library, id }
    }
    if (command.action === 'delete') location.conditions = location.conditions.filter((item) => item.id !== condition.id)
    else Object.assign(condition, group(condition))
    location.updatedAt = now; return { library, id: condition.id }
  }
  if (command.resource === 'reference') {
    const location = library.locations.find((item) => item.id === command.locationId); if (!location) throw new Error('Location not found')
    const target = command.conditionId ? location.conditions.find((item) => item.id === command.conditionId) : location
    if (!target) throw new Error('Condition not found')
    if (command.action === 'delete') { if (!target.images.some((item) => item.id === command.id)) throw new Error('Reference not found'); target.images = target.images.filter((item) => item.id !== command.id); location.updatedAt = now; return { library, id: command.id! } }
    const photo = library.photos.find((item) => item.id === command.photoId); if (!photo) throw new Error('Photo not found')
    const id = command.id ?? crypto.randomUUID(); target.images.push({ id, label: requiredName(command.label), purpose: command.purpose ?? 'inspiration', photoId: photo.id, image: { ...photo.image }, source: `${photo.name} · ${photo.source}`.slice(0, 2000) }); location.updatedAt = now
    return { library, id }
  }
  if (command.resource === 'story-book') {
    if (command.action === 'create') { const id = command.id ?? crypto.randomUUID(), book: StoryBook = { id, ...group(), synopsis: command.synopsis ?? '', direction: command.direction ?? '', collectionIds: command.collectionIds ?? [] }; library.storyBooks.push(book); return { library, id } }
    const book = library.storyBooks.find((item) => item.id === command.id); if (!book) throw new Error('Story book not found')
    if (command.action === 'delete') { library.storyBooks = library.storyBooks.filter((item) => item.id !== book.id); for (const [boardId, bookId] of Object.entries(library.boardBooks)) if (bookId === book.id) delete library.boardBooks[boardId] }
    else Object.assign(book, group(book), command.synopsis === undefined ? {} : { synopsis: command.synopsis }, command.direction === undefined ? {} : { direction: command.direction }, command.collectionIds === undefined ? {} : { collectionIds: command.collectionIds })
    return { library, id: book.id }
  }
  if (command.bookId && !library.storyBooks.some((item) => item.id === command.bookId)) throw new Error('Story book not found')
  if (command.bookId) library.boardBooks[command.boardId] = command.bookId
  else delete library.boardBooks[command.boardId]
  return { library, id: command.bookId ?? null }
}

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
  async function importArchive(blob: Blob, current: WorldLibrary, preserveCollections: boolean) {
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
    const remap = new Map<string, string>()
    for (const group of [incoming.albums, incoming.photos, incoming.locations, incoming.storyBooks]) for (const item of group) remap.set(item.id, crypto.randomUUID())
    for (const album of incoming.albums) next.albums.push({ ...album, id: remap.get(album.id)! })
    for (const photo of incoming.photos) next.photos.push({ ...photo, id: remap.get(photo.id)!, albumId: remap.get(photo.albumId)! })
    for (const location of incoming.locations) next.locations.push({ ...location, id: remap.get(location.id)!, parentId: location.parentId ? remap.get(location.parentId)! : null, collectionId: preserveCollections ? location.collectionId : 'default', images: location.images.map((i) => ({ ...i, ...(i.photoId ? { photoId: remap.get(i.photoId) ?? i.photoId } : {}) })), conditions: location.conditions.map((c) => ({ ...c, images: c.images.map((i) => ({ ...i, ...(i.photoId ? { photoId: remap.get(i.photoId) ?? i.photoId } : {}) })) })) })
    for (const book of incoming.storyBooks) next.storyBooks.push({ ...book, id: remap.get(book.id)!, collectionIds: preserveCollections ? book.collectionIds : [] })
    return { library: changed(await repository.save(next, blobs)), idMap: Object.fromEntries(remap) }
  }
  return {
    async refresh() { return changed(await repository.load()) },
    load: repository.load, image: repository.image,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { channel?.close(); listeners.clear() },
    async save(library: WorldLibrary) { return changed(await repository.save(library)) },
    async update(command: WorldLibraryCommand, expectedRevision: number) {
      const current = await repository.load()
      if (current.revision !== expectedRevision) throw new Error('Library changed elsewhere; inspect and try again')
      const result = applyWorldLibraryCommand(current, command)
      return { library: changed(await repository.save(result.library)), id: result.id }
    },
    async upload(library: WorldLibrary, albumId: string, files: File[], reference?: { locationId: string; conditionId?: string; label: string; purpose: SettingImage['purpose'] }, metadata?: { name?: string; description?: string; source?: string }) {
      let next = structuredClone(library); const blobs = new Map<string, Blob>()
      if (!files.length || files.length > 100) throw new Error('Choose 1–100 images')
      if (reference && files.length !== 1) throw new Error('A Location reference requires exactly one image')
      if (metadata && files.length !== 1) throw new Error('Photo metadata requires exactly one image')
      for (const file of files) {
        const image = await inspect(file, file.name)
        const photo: AlbumPhoto = { id: crypto.randomUUID(), name: metadata?.name?.trim() || file.name, description: metadata?.description ?? '', source: metadata?.source ?? '', updatedAt: Date.now(), albumId, image }
        next.photos.push(photo); blobs.set(image.sha256, file)
      }
      if (reference) next = applyWorldLibraryCommand(next, { resource: 'reference', action: 'create', ...reference, photoId: next.photos.at(-1)!.id }).library
      return changed(await repository.save(next, blobs))
    },
    async uploadSetting(library: WorldLibrary, locationId: string, file: File, label: string, purpose: SettingImage['purpose'], conditionId?: string, source = '') {
      const next = structuredClone(library), location = next.locations.find((item) => item.id === locationId)
      if (!location) throw new Error('Location not found')
      const target = conditionId ? location.conditions.find((item) => item.id === conditionId) : location
      if (!target) throw new Error('Condition not found')
      const image = await inspect(file, file.name), id = crypto.randomUUID()
      target.images.push({ id, label: requiredName(label), purpose, image, source: source.slice(0, 2000) }); location.updatedAt = Date.now()
      return { library: changed(await repository.save(next, new Map([[image.sha256, file]]))), id }
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
    async import(blob: Blob, current: WorldLibrary) { return (await importArchive(blob, current, false)).library },
    importPreservingCollections(blob: Blob, current: WorldLibrary) { return importArchive(blob, current, true) },
  }
}
export type WorldLibraryService = ReturnType<typeof createWorldLibraryService>
