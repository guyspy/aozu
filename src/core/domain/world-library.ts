import { jsonSchemaToZod, type JsonSchema } from '@aotter/mantle-spec'

export const WORLD_NAMESPACE = 'aozu-world-library'
export interface LibraryGroup { id: string; name: string; description: string; updatedAt: number }
export interface AlbumPhoto extends LibraryGroup { albumId: string; source: string; image: LibraryImage }
export interface LibraryImage { sha256: string; filename: string; mediaType: string; width: number; height: number; size: number }
export interface SettingImage { id: string; label: string; purpose: 'inspiration' | 'design'; photoId: string; image: LibraryImage; source: string }
export interface LocationCondition extends LibraryGroup { images: SettingImage[] }
export interface LocationSetting extends LibraryGroup {
  collectionId: string; parentId: string | null; tags: string[]; consistency: string
  images: SettingImage[]; conditions: LocationCondition[]
}
export interface StoryFolder extends LibraryGroup { synopsis: string; direction: string; collectionIds: string[] }
export interface WorldLibrary {
  revision: number; albums: LibraryGroup[]; photos: AlbumPhoto[]; locations: LocationSetting[]; folders: StoryFolder[]
  boardFolders: Record<string, string>
}
export const emptyWorldLibrary = (): WorldLibrary => ({ revision: 0, albums: [{ id: 'default', name: 'My images', description: '', updatedAt: 0 }], photos: [], locations: [], folders: [], boardFolders: {} })
const str = (maxLength = 8000): JsonSchema => ({ type: 'string', maxLength })
const id: JsonSchema = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,100}$' }
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const array = (items: JsonSchema, maxItems = 1000): JsonSchema => ({ type: 'array', items, maxItems })
const group = { id, name: { type: 'string', minLength: 1, maxLength: 120 }, description: str(), updatedAt: { type: 'integer', minimum: 0 } } satisfies Record<string, JsonSchema>
const image = obj({ sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, filename: str(200), mediaType: { enum: ['image/png', 'image/jpeg', 'image/webp'] }, width: { type: 'integer', minimum: 1, maximum: 4096 }, height: { type: 'integer', minimum: 1, maximum: 4096 }, size: { type: 'integer', minimum: 1, maximum: 5242880 } })
const settingImage = obj({ id, label: str(120), purpose: { enum: ['inspiration', 'design'] }, photoId: id, image, source: str(2000) })
export const WORLD_LIBRARY_SCHEMA = obj({
  revision: { type: 'integer', minimum: 0 }, albums: array(obj(group)), photos: array(obj({ ...group, albumId: id, source: str(2000), image })),
  locations: array(obj({ ...group, collectionId: id, parentId: { oneOf: [id, { type: 'null' }] }, tags: array(str(40), 30), consistency: str(), images: array(settingImage, 100), conditions: array(obj({ ...group, images: array(settingImage, 100) }), 100) })),
  folders: array(obj({ ...group, synopsis: str(), direction: str(), collectionIds: array(id, 100) })),
  boardFolders: { type: 'object', maxProperties: 1000, additionalProperties: id },
})
const validator = jsonSchemaToZod(WORLD_LIBRARY_SCHEMA)
export function validateWorldLibrary(input: unknown): WorldLibrary {
  const result = validator.safeParse(input)
  if (!result.success) throw new Error(`Invalid library: ${result.error.issues[0]?.message}`)
  const library = result.data as WorldLibrary
  for (const group of [library.albums, library.photos, library.locations, library.folders, ...library.locations.map((l) => l.conditions)]) {
    if (new Set(group.map((item) => item.id)).size !== group.length || group.some((item) => !item.name.trim())) throw new Error('Names must not be blank and IDs must be unique')
  }
  if (!library.albums.some((album) => album.id === 'default') || library.photos.some((p) => !library.albums.some((a) => a.id === p.albumId))) throw new Error('Album not found')
  if (Object.keys(library.boardFolders).some((key) => !/^[a-zA-Z0-9_-]{1,100}$/.test(key))) throw new Error('Invalid storyboard ID')
  const descriptors = new Map<string, LibraryImage>()
  for (const image of libraryImages(library)) {
    const previous = descriptors.get(image.sha256)
    if (previous && (['mediaType', 'size', 'width', 'height'] as const).some((key) => previous[key] !== image[key])) throw new Error('Conflicting image descriptors')
    descriptors.set(image.sha256, image)
  }
  if (Object.values(library.boardFolders).some((id) => !library.folders.some((f) => f.id === id))) throw new Error('Storyboard folder not found')
  for (const location of library.locations) {
    locationAncestors(library, location.id)
    if (location.tags.some((tag) => !tag.trim()) || new Set(location.tags).size !== location.tags.length) throw new Error('Tags must be nonempty and unique')
    for (const images of [location.images, ...location.conditions.map((c) => c.images)]) {
      if (new Set(images.map((i) => i.id)).size !== images.length || images.some((i) => !i.label.trim())) throw new Error('Image labels and unique IDs are required')
    }
  }
  if (JSON.stringify(library).length > 4 * 1024 * 1024) throw new Error('Library metadata exceeds 4 MiB')
  return library
}
export function locationAncestors(library: WorldLibrary, id: string): LocationSetting[] {
  const chain: LocationSetting[] = [], seen = new Set<string>()
  const locations = new Map(library.locations.map((location) => [location.id, location]))
  let current = locations.get(id)
  if (!current) throw new Error('Location not found')
  const collectionId = current.collectionId
  while (current) {
    if (seen.has(current.id)) throw new Error('A location cannot contain itself or an ancestor')
    if (current.collectionId !== collectionId) throw new Error('Parent location must belong to the same setting collection')
    seen.add(current.id); chain.unshift(current)
    if (!current.parentId) break
    current = locations.get(current.parentId)
    if (!current) throw new Error('Parent location not found')
  }
  return chain
}
export const libraryImages = (library: WorldLibrary) => [...library.photos.map((p) => p.image), ...library.locations.flatMap((l) => [...l.images, ...l.conditions.flatMap((c) => c.images)].map((i) => i.image))]
