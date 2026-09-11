import { rehomeWorldCollections } from './world-library-repository.ts'
import { WORLD_NAMESPACE } from '../../core/domain/world-library.ts'
import {
  CHARACTER_LIBRARY_REVISION_FLOOR, characterLibraryKey, inspectCharacterLibrarySnapshot,
  isCharacterLibraryAsset, isCharacterLibraryEntry, mergeCharacterLibraries,
  type CharacterLibraryRepository, type CharacterLibrarySnapshot,
} from '../../core/application/character-library.ts'
import { inspectCharacterImage } from '../browser/character-image.ts'
import { migrateCharacterDraft } from '../../core/application/character-creation.ts'
import { ASSET_STORE, CHARACTER_DRAFT_STORE, ENTRY_STORE, META_STORE, openCompanionDatabase } from './database.ts'

const libraryOnly = (snapshot: CharacterLibrarySnapshot): CharacterLibrarySnapshot => ({
  entries: snapshot.entries.filter(isCharacterLibraryEntry),
  assets: snapshot.assets.filter(isCharacterLibraryAsset),
  legacyDrafts: snapshot.legacyDrafts.map(migrateCharacterDraft),
})

export function createIndexedDbCharacterLibraryRepository({ inspect = inspectCharacterImage } = {}): CharacterLibraryRepository {
  return {
    async snapshot() {
      const database = await openCompanionDatabase()
      const transaction = database.transaction([ENTRY_STORE, ASSET_STORE, CHARACTER_DRAFT_STORE], 'readonly')
      const [entries, assets, legacyDrafts] = await Promise.all([
        transaction.objectStore(ENTRY_STORE).getAll(),
        transaction.objectStore(ASSET_STORE).getAll(),
        transaction.objectStore(CHARACTER_DRAFT_STORE).getAll(),
      ])
      await transaction.done
      return libraryOnly({ entries, assets, legacyDrafts })
    },

    async restore(value, mode) {
      if (mode !== 'merge' && mode !== 'replace') throw new Error('Unsupported Character library import mode')
      const incoming = structuredClone(value)
      // A prepared import is caller-owned data. Revalidate the bytes at the write boundary as well.
      await inspectCharacterLibrarySnapshot(incoming, inspect)
      const database = await openCompanionDatabase()
      const transaction = database.transaction([ENTRY_STORE, ASSET_STORE, CHARACTER_DRAFT_STORE, META_STORE], 'readwrite')
      const entries = transaction.objectStore(ENTRY_STORE)
      const assets = transaction.objectStore(ASSET_STORE)
      const drafts = transaction.objectStore(CHARACTER_DRAFT_STORE)
      const meta = transaction.objectStore(META_STORE)
      // Hashing Blob bytes yields outside IDB. Queue harmless reads to retain the same transaction's write lock
      // until conflict validation completes; no other tab can change assets between the hash check and commit.
      let checking = true
      const keepAlive = (async () => {
        while (checking) await meta.get(CHARACTER_LIBRARY_REVISION_FLOOR)
      })()
      void keepAlive.catch(() => undefined)
      void transaction.done.catch(() => undefined)
      try {
        const [allEntries, allAssets, legacyDrafts, previousFloor] = await Promise.all([
          entries.getAll(), assets.getAll(), drafts.getAll(), meta.get(CHARACTER_LIBRARY_REVISION_FLOOR),
        ])
        // Replace can recover a damaged old library; only merge needs to interpret its legacy draft payloads.
        const current = libraryOnly({ entries: allEntries, assets: allAssets, legacyDrafts: mode === 'merge' ? legacyDrafts : [] })
        const foreignKeys = new Set(allEntries.filter((entry) => !isCharacterLibraryEntry(entry)).map(characterLibraryKey))
        if (incoming.entries.some((entry) => foreignKeys.has(characterLibraryKey(entry)))) throw new Error('Character library ID conflicts with unrelated local data')
        const merged = mode === 'merge' ? await mergeCharacterLibraries(current, incoming) : incoming
        checking = false
        await keepAlive
        const floor = [...current.entries, ...incoming.entries].reduce(
          (maximum, { version }) => Math.max(maximum, version), Math.max(Date.now(), Number(previousFloor) || 0),
        ) + 1
        if (!Number.isSafeInteger(floor) || floor >= Number.MAX_SAFE_INTEGER) throw new Error('Character library revision range is exhausted')
        const currentKeys = new Set(current.entries.map(characterLibraryKey))
        if (mode === 'replace') {
          for (const entry of current.entries) await entries.delete([entry.bundleId, entry.id])
          for (const asset of current.assets) await assets.delete([asset.bundleId, asset.id])
          await drafts.clear()
        }
        for (const entry of merged.entries) {
          const restored = mode === 'replace' || !currentKeys.has(characterLibraryKey(entry))
            ? { ...entry, version: floor, updatedAt: Math.max(Date.now(), entry.updatedAt) } : entry
          await entries.put(restored)
        }
        const world = rehomeWorldCollections(await entries.get([WORLD_NAMESPACE, 'library']), new Set(merged.entries.filter((e) => e.collection === 'character-collections').map((e) => e.id)))
        if (world) await entries.put(world)
        for (const asset of merged.assets) await assets.put(asset)
        for (const draft of merged.legacyDrafts) await drafts.put(draft)
        await meta.put(String(floor), CHARACTER_LIBRARY_REVISION_FLOOR)
        await transaction.done
      } catch (error) {
        checking = false
        try { transaction.abort() } catch { /* A failed IDB request already aborted the transaction. */ }
        await keepAlive.catch(() => undefined)
        await transaction.done.catch(() => undefined)
        throw error
      }
    },
  }
}
