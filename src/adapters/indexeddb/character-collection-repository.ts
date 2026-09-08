import { AUTHORING_NAMESPACE } from '../../core/application/authoring.ts'
import { CharacterRevisionConflict } from '../../core/application/ports.ts'
import { CHARACTER_LIBRARY_REVISION_FLOOR } from '../../core/application/character-library.ts'
import { CHARACTER_COLLECTIONS, DEFAULT_CHARACTER_COLLECTION, characterCollectionName, characterCollectionProfile, type CharacterCollection, type CharacterCollectionProfile } from '../../core/domain/character-collection.ts'
import { ENTRY_STORE, META_STORE, openCompanionDatabase, type StoredEntry } from './database.ts'

const key = (id: string): [string, string] => [AUTHORING_NAMESPACE, id]
const project = (entry: StoredEntry): CharacterCollection => ({
  id: entry.id, name: String(entry.data.name), description: String(entry.data.description ?? ''), backstory: String(entry.data.backstory ?? ''), characterIds: [...entry.data.characterIds as string[]],
  version: entry.version, updatedAt: entry.updatedAt,
})

/** Semantic operations keep membership and expected-version checks in the same IndexedDB transaction. */
export function createIndexedDbCharacterCollectionRepository() {
  return {
    async list(): Promise<CharacterCollection[]> {
      const database = await openCompanionDatabase()
      const rows = await database.getAllFromIndex(ENTRY_STORE, 'bundleId', AUTHORING_NAMESPACE)
      const books = rows.filter((entry) => entry.collection === CHARACTER_COLLECTIONS && entry.status === 'published').map(project)
      const custom = books.filter(({ id }) => id !== DEFAULT_CHARACTER_COLLECTION).sort((a, b) => a.name.localeCompare(b.name))
      const assigned = new Set(custom.flatMap(({ characterIds }) => characterIds))
      // Default membership is the complement of custom books: creation/deletion needs no second write.
      const defaultBook = books.find(({ id }) => id === DEFAULT_CHARACTER_COLLECTION) ?? {
        id: DEFAULT_CHARACTER_COLLECTION, name: 'My characters', description: '', backstory: '', version: 0, updatedAt: 0, characterIds: [],
      }
      return [{ ...defaultBook, characterIds: rows.filter((entry) => entry.collection === 'character-workspaces' && entry.status === 'published' && !assigned.has(entry.id)).map(({ id }) => id) }, ...custom]
    },
    async update(id: string, value: CharacterCollectionProfile, expectedVersion: number) {
      const profile = characterCollectionProfile(value)
      const database = await openCompanionDatabase()
      const transaction = database.transaction([ENTRY_STORE, META_STORE], 'readwrite')
      const entries = transaction.objectStore(ENTRY_STORE)
      const current = await entries.get(key(id))
      if ((!current && (id !== DEFAULT_CHARACTER_COLLECTION || expectedVersion !== 0)) ||
        (current && (current.collection !== CHARACTER_COLLECTIONS || current.status !== 'published' || current.version !== expectedVersion))) {
        throw new CharacterRevisionConflict('Collection changed elsewhere; refresh and try again')
      }
      const now = Date.now()
      if (!current) {
        await entries.add({ bundleId: AUTHORING_NAMESPACE, id, collection: CHARACTER_COLLECTIONS, status: 'published',
          version: Math.max(1, (Number(await transaction.objectStore(META_STORE).get(CHARACTER_LIBRARY_REVISION_FLOOR)) || 0) + 1),
          data: { ...profile, characterIds: [] }, authorId: null, createdAt: now, updatedAt: now })
      } else if (Object.entries(profile).some(([field, value]) => (current.data[field] ?? '') !== value)) {
        await entries.put({ ...current, data: { ...current.data, ...profile }, version: current.version + 1, updatedAt: now })
      }
      await transaction.done
    },
    async delete(id: string, expectedVersion: number) {
      if (id === DEFAULT_CHARACTER_COLLECTION) throw new Error('The default Collection cannot be deleted')
      const database = await openCompanionDatabase()
      const transaction = database.transaction([ENTRY_STORE, META_STORE], 'readwrite')
      const entries = transaction.objectStore(ENTRY_STORE)
      const entry = await entries.get(key(id))
      if (!entry || entry.collection !== CHARACTER_COLLECTIONS || entry.version !== expectedVersion) {
        throw new CharacterRevisionConflict('Collection changed elsewhere; refresh and try again')
      }
      await entries.delete(key(id))
      const meta = transaction.objectStore(META_STORE)
      await meta.put(String(Math.max(Number(await meta.get(CHARACTER_LIBRARY_REVISION_FLOOR)) || 0, entry.version)), CHARACTER_LIBRARY_REVISION_FLOOR)
      await transaction.done
    },
    async create(value: string): Promise<CharacterCollection> {
      const name = characterCollectionName(value)
      const now = Date.now()
      const entry: StoredEntry = {
        id: crypto.randomUUID(), bundleId: AUTHORING_NAMESPACE, collection: CHARACTER_COLLECTIONS,
        status: 'published', version: 1, authorId: null, createdAt: now, updatedAt: now,
        data: { name, characterIds: [] },
      }
      await (await openCompanionDatabase()).add(ENTRY_STORE, entry)
      return project(entry)
    },
    /** One membership per Character. A default/null target removes explicit membership, returning it to My characters. */
    async assign(characterId: string, collectionId: string | null): Promise<void> {
      if (collectionId === DEFAULT_CHARACTER_COLLECTION) collectionId = null
      const database = await openCompanionDatabase()
      const transaction = database.transaction(ENTRY_STORE, 'readwrite')
      const rows = await transaction.store.index('bundleId').getAll(AUTHORING_NAMESPACE)
      const character = rows.find((entry) => entry.id === characterId && entry.collection === 'character-workspaces' && entry.status === 'published')
      const collections = rows.filter((entry) => entry.collection === CHARACTER_COLLECTIONS && entry.status === 'published')
      if (!character || (collectionId !== null && !collections.some((entry) => entry.id === collectionId))) {
        await transaction.done
        throw new Error('Character or Collection no longer exists; refresh and try again')
      }
      for (const entry of collections) {
        const previous = entry.data.characterIds as string[]
        const includes = previous.includes(characterId)
        if (includes === (entry.id === collectionId)) continue
        const characterIds = entry.id === collectionId ? [...previous, characterId] : previous.filter((id) => id !== characterId)
        await transaction.store.put({ ...entry, data: { ...entry.data, characterIds }, version: entry.version + 1, updatedAt: Date.now() })
      }
      await transaction.done
    },
  }
}
