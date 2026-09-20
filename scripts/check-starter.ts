import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { loadStarterCatalog } from '../src/adapters/browser/starter-packages.ts'
import { buildCharacterPack, createCharacterDraftFromStarter, isCharacterDraftPopulated, resolveStarterCharacterLayers } from '../src/core/application/character-creation.ts'
import { resolveStarterSceneLayers } from '../src/core/application/scene.ts'
import { createExperienceDraftData } from '../src/core/domain/starter.ts'
import { inspectCharacterFixture, inspectSceneFixture, loadFocusStudioFixture, publicFile } from './starter-fixture.ts'

const fetcher = async (input: RequestInfo | URL) => {
  const pathname = new URL(String(input), 'http://localhost').pathname
  try {
    const bytes = await readFile(publicFile(pathname))
    const mediaType = pathname.endsWith('.json') ? 'application/json' : pathname.endsWith('.webp') ? 'image/webp' : 'image/png'
    return new Response(bytes, { status: 200, headers: { 'content-type': mediaType } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

assert.deepEqual(await loadStarterCatalog(fetcher, inspectCharacterFixture, inspectSceneFixture, '6'), [])

const starter = await loadFocusStudioFixture()
assert.equal(starter.starter.id, 'focus-studio')
assert.equal(starter.starter.scenePack.assets[0]!.mediaType, 'image/webp')
assert.deepEqual(starter.starter.directions[0]!.seed.loopIds, ['rhythm', 'mastery'])
assert.equal(starter.starter.directions[0]!.playbook.initialStageId, 'study-session')
assert.equal(starter.starter.characterStates[0]!.name, 'Focus Friend')
assert.match(starter.manifestSha256, /^[0-9a-f]{64}$/)
const draft = createExperienceDraftData(starter, 'daily-study')
assert.equal(draft.revision, 0)
assert.equal(draft.story!.starter.id, 'focus-studio')
assert.equal(draft.story!.starter.manifestSha256, starter.manifestSha256)
assert.equal('assets' in draft, false)
assert.equal('stages' in draft, false)
assert.equal('playbook' in draft.story!.direction, false)
const character = createCharacterDraftFromStarter(starter, 'character:focus-default')
assert.equal(isCharacterDraftPopulated(character), true)
assert.equal(buildCharacterPack(character).defaultComposition.length, 1)
assert.equal(character.variants.find(({ group, id }) => group === 'body' && id === 'base')!.layers.body!.source, 'starter')
assert.equal(character.selected.items.find((item) => item.group === 'expression')?.id, undefined)
assert.deepEqual(resolveStarterCharacterLayers(starter, 'character:focus-default').map(({ slot }) => slot), ['character-skin'])
assert.deepEqual(resolveStarterSceneLayers(starter, 'daily-study').map(({ plane }) => plane), ['back'])
console.log('starter packages: ok')
