import { AUTHORING_NAMESPACE } from '../../core/application/authoring.ts'
import { CharacterRevisionConflict } from '../../core/application/ports.ts'
import { CHARACTER_LIBRARY_REVISION_FLOOR } from '../../core/application/character-library.ts'
import { CHARACTER_COLLECTIONS, characterCollectionName, type CharacterCollection } from '../../core/domain/character-collection.ts'
import { ENTRY_STORE, META_STORE, openCompanionDatabase, type StoredEntry } from './database.ts'

const key = (id: string): [string, string] => [AUTHORING_NAMESPACE, id]
const project = (entry: StoredEntry): CharacterCollection => ({
  id: entry.id, name: String(entry.data.name), characterIds: [...entry.data.characterIds as string[]],
  version: entry.version, updatedAt: entry.updatedAt,
})

/** Semantic operations keep membership and expected-version checks in the same IndexedDB transaction. */
export function createIndexedDbCharacterCollectionRepository() {
  const mutate = async (id: string, expectedVersion: number, name?: string) => {
    const database = await openCompanionDatabase()
    const transaction = database.transaction([ENTRY_STORE, META_STORE], 'readwrite')
    const entries = transaction.objectStore(ENTRY_STORE)
    const entry = await entries.get(key(id))
    if (!entry || entry.collection !== CHARACTER_COLLECTIONS || entry.version !== expectedVersion) {
      await transaction.done
      throw new CharacterRevisionConflict('Collection changed elsewhere; refresh and try again')
    }
    if (name === undefined) {
      await entries.delete(key(id))
      const meta = transaction.objectStore(META_STORE)
      await meta.put(String(Math.max(Number(await meta.get(CHARACTER_LIBRARY_REVISION_FLOOR)) || 0, entry.version)), CHARACTER_LIBRARY_REVISION_FLOOR)
    } else if (entry.data.name !== name) await entries.put({ ...entry, data: { ...entry.data, name }, version: entry.version + 1, updatedAt: Date.now() })
    await transaction.done
  }
  return {
    async list(): Promise<CharacterCollection[]> {
      const database = await openCompanionDatabase()
      return (await database.getAllFromIndex(ENTRY_STORE, 'bundleId', AUTHORING_NAMESPACE))
        .filter((entry) => entry.collection === CHARACTER_COLLECTIONS && entry.status === 'published')
        .map(project).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
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
    rename: (id: string, name: string, expectedVersion: number) => mutate(id, expectedVersion, characterCollectionName(name)),
    delete: (id: string, expectedVersion: number) => mutate(id, expectedVersion),
    /** One membership per Character. A null target returns it to Uncollected. */
    async assign(characterId: string, collectionId: string | null): Promise<void> {
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
