import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'

import { createIndexedDbCharacterCollectionRepository } from '../src/adapters/indexeddb/character-collection-repository.ts'
import { createIndexedDbEntryRepository } from '../src/adapters/indexeddb/mantle-storage.ts'
import { ENTRY_STORE, openCompanionDatabase } from '../src/adapters/indexeddb/database.ts'
import { AUTHORING_NAMESPACE } from '../src/core/application/authoring.ts'
import { characterCollectionName, DEFAULT_CHARACTER_COLLECTION } from '../src/core/domain/character-collection.ts'
import { CharacterRevisionConflict } from '../src/core/application/ports.ts'

const database = await openCompanionDatabase()
const repository = createIndexedDbCharacterCollectionRepository()
const characterId = 'collection-check-character'
await database.add(ENTRY_STORE, {
  bundleId: AUTHORING_NAMESPACE, id: characterId, collection: 'character-workspaces',
  version: 1, status: 'published', data: {}, authorId: null, createdAt: 1, updatedAt: 1,
})
assert.equal(characterCollectionName('  Forest  '), 'Forest')
assert.throws(() => characterCollectionName('   '))
assert.throws(() => characterCollectionName('x'.repeat(101)))
assert.deepEqual((await repository.list())[0]!.characterIds, [characterId], 'unassigned Characters appear in the default book')
assert.equal((await repository.list())[0]!.version, 0, 'the implicit default needs no write')
await repository.update(DEFAULT_CHARACTER_COLLECTION, { name: 'My characters', description: '', backstory: 'Shared origin' }, 0)
await assert.rejects(() => repository.update(DEFAULT_CHARACTER_COLLECTION, { name: 'Stale', description: '', backstory: '' }, 0), CharacterRevisionConflict)
await assert.rejects(() => repository.delete(DEFAULT_CHARACTER_COLLECTION, 1))
await assert.rejects(() => repository.update(DEFAULT_CHARACTER_COLLECTION, { name: 'My characters', description: '', backstory: 'x'.repeat(8001) }, 1))
assert.equal((await repository.list())[0]!.backstory, 'Shared origin')
const forest = await repository.create('Forest')
const city = await repository.create('City')
await repository.assign(characterId, forest.id)
assert.deepEqual((await repository.list()).find(({ id }) => id === forest.id)?.characterIds, [characterId])
await repository.assign(characterId, city.id)
let rows = await repository.list()
assert.deepEqual(rows.find(({ id }) => id === forest.id)?.characterIds, [])
assert.deepEqual(rows.find(({ id }) => id === city.id)?.characterIds, [characterId])
const cityVersion = rows.find(({ id }) => id === city.id)!.version
await repository.assign(characterId, city.id)
assert.equal((await repository.list()).find(({ id }) => id === city.id)?.version, cityVersion, 'same assignment is a no-op')
await assert.rejects(() => repository.assign(characterId, 'missing'))
await assert.rejects(() => repository.assign('missing-character', forest.id))
await assert.rejects(() => repository.update(city.id, { name: 'Changed', description: '', backstory: '' }, 1), CharacterRevisionConflict)
await repository.update(city.id, { name: 'Capital', description: 'A city in the clouds', backstory: 'Everyone shares this world.' }, cityVersion)
const savedCity = (await createIndexedDbCharacterCollectionRepository().list()).find(({ id }) => id === city.id)!
assert.equal(savedCity.name, 'Capital')
assert.equal(savedCity.backstory, 'Everyone shares this world.')
assert.equal(savedCity.description, 'A city in the clouds')
await assert.rejects(() => repository.delete(city.id, cityVersion), CharacterRevisionConflict)
await repository.delete(city.id, cityVersion + 1)
assert.deepEqual((await repository.list())[0]!.characterIds, [characterId], 'deleting a custom book returns Characters to default')
assert.ok(await database.get(ENTRY_STORE, [AUTHORING_NAMESPACE, characterId]), 'deleting a Collection preserves its Characters')
await repository.assign(characterId, forest.id)
await repository.assign(characterId, null)
assert.deepEqual((await repository.list()).find(({ id }) => id === forest.id)?.characterIds, [])
await repository.assign(characterId, forest.id)
await createIndexedDbEntryRepository(AUTHORING_NAMESPACE).delete({
  id: characterId, collection: 'character-workspaces', expectedVersion: 1, expectedStatus: 'published',
})
rows = await repository.list()
assert.deepEqual(rows.find(({ id }) => id === forest.id)?.characterIds, [], 'deleting a Character removes membership in the same transaction')
await repository.delete(forest.id, rows.find(({ id }) => id === forest.id)!.version)
console.log('character Collections: transactional membership, no-ops, conflicts and deletion checks passed')
