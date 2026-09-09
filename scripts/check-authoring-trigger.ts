import assert from 'node:assert/strict'
import { bootMantleRuntime } from '@aotter/mantle-runtime'

import { compileAuthoringBackbone } from '../src/core/mantle/backbone.ts'
import { activateCharacterVariant, createCharacterDraft, deactivateCharacterVariant } from '../src/core/application/character-creation.ts'
import { createExperienceDraftData } from '../src/core/domain/starter.ts'
import { loadFocusStudioFixture } from './starter-fixture.ts'

let createdEntry: Record<string, unknown> | undefined
const repository = {
  async create(input: Record<string, unknown>) {
    createdEntry = {
      id: input.id,
      collection: input.collection,
      status: input.status,
      version: 1,
      data: input.data,
      authorId: input.authorId,
      createdAt: input.now,
      updatedAt: input.now,
    }
    return createdEntry
  },
}
let submittedInput: unknown
let replacementInput: unknown
let repairInput: unknown
let profileInput: unknown
let transformInput: unknown
let selectionDraft = createCharacterDraft('selection-pack', 'selection-character')
selectionDraft.variants.push({ group: 'prop', id: 'prop-2', label: 'Second prop', layers: {} })
let selectionRevision = 1
const runtime = await bootMantleRuntime({
  plan: compileAuthoringBackbone(),
  storage: {
    nativeViewDialects: [],
    async prepare() {
      return { entries: repository as never, views: { async execute() { return { rows: [], page: 1, show: 50, hasMore: false } } } }
    },
  },
  handlers: {
    'companion.update-character-model-sheet': async (input) => ({ status: 'ok', data: input }),
    'companion.inspect-storyboard': async (input) => ({ status: 'ok', data: input }),
    'companion.update-storyboard': async (input) => ({ status: 'ok', data: input }),
    'companion.export-storyboard': async (input) => ({ status: 'ok', data: input }),
    'companion.update-collection-profile': async (input) => ({ status: 'ok', data: input }),
    'companion.inspect-workspace': async () => ({ status: 'ok', data: {} }),
    'companion.navigate-character': async (input) => ({ status: 'ok', data: input }),
    'companion.update-character-profile': async (input) => {
      profileInput = input
      return { status: 'ok', data: input }
    },
    'companion.create-local-companion': async () => ({ status: 'ok', data: { bundleId: 'bundle:local' } }),
    'companion.inspect-experience-contract': async () => ({ status: 'ok', data: {} }),
    'companion.inspect-character-contract': async () => ({ status: 'ok', data: {} }),
    'companion.replace-character-asset': async (input) => {
      replacementInput = input
      return { status: 'ok', data: {} }
    },
    'companion.repair-character-asset': async (input) => {
      repairInput = input
      return { status: 'ok', data: {} }
    },
    'companion.set-character-variant-transform': async (input) => {
      transformInput = input
      return { status: 'ok', data: {} }
    },
    'companion.set-character-variant-selection': async (rawInput) => {
      const input = rawInput as { characterId: string; group: 'prop'; variantId: string; active: boolean; expectedRevision: number }
      if (input.characterId !== selectionDraft.id || input.expectedRevision !== selectionRevision) throw new Error('Stale character selection')
      const next = input.active
        ? activateCharacterVariant(selectionDraft, { group: input.group, id: input.variantId })
        : deactivateCharacterVariant(selectionDraft, { group: input.group, id: input.variantId })
      if (next !== selectionDraft) selectionRevision++
      selectionDraft = next
      return { status: 'ok', data: { selected: selectionDraft.selected, revision: selectionRevision } }
    },
    'companion.undo-character-change': async () => ({ status: 'nothing_to_undo', data: {} }),
    'companion.redo-character-change': async () => ({ status: 'nothing_to_redo', data: {} }),
    'companion.submit-experience-candidate': async (input) => {
      submittedInput = input
      return { status: 'ok', data: { bundleId: 'bundle:triggered', revision: 1, replayed: false } }
    },
  },
  ports: {
    idgen: { next: () => 'draft:triggered' },
    clock: { now: () => 1 },
  },
})
const context = { user: null, staff: null, env: {} }
const selectProp = (variantId: string, active: boolean, expectedRevision = selectionRevision) => runtime.invokeTrigger({
  trigger: 'set-character-variant-selection',
  input: { characterId: selectionDraft.id, group: 'prop', variantId, active, expectedRevision },
  ctx: context,
})
assert.equal((await selectProp('prop-2', true)).ok, true)
assert.equal((await selectProp('prop-1', true)).ok, true)
assert.deepEqual(selectionDraft.selected.props, ['prop-2', 'prop-1'])
assert.equal((await selectProp('prop-2', true)).ok, true)
assert.equal(selectionRevision, 3)
assert.equal((await selectProp('prop-2', false)).ok, true)
assert.equal((await selectProp('prop-2', true)).ok, true)
assert.deepEqual(selectionDraft.selected.props, ['prop-1', 'prop-2'])
assert.equal((await selectProp('prop-1', false, 1)).ok, false)
assert.equal((await selectProp('missing', true)).ok, false)
assert.deepEqual(selectionDraft.selected.props, ['prop-1', 'prop-2'])
assert.equal((await runtime.invokeTrigger({
  trigger: 'set-character-variant-selection',
  input: { characterId: selectionDraft.id, group: 'body', variantId: 'base', active: true, expectedRevision: selectionRevision },
  ctx: context,
})).ok, false)
assert.equal((await runtime.invokeTrigger({
  trigger: 'set-character-variant-selection',
  input: { characterId: selectionDraft.id, group: 'prop', variantId: 'prop-1', active: 'true', expectedRevision: selectionRevision },
  ctx: context,
})).ok, false)
const selected = await runtime.invokeTrigger({
  trigger: 'select-experience-draft',
  input: createExperienceDraftData(await loadFocusStudioFixture(), 'daily-study'),
  ctx: context,
})
assert.equal(selected.ok, true)
assert.equal(createdEntry?.collection, 'experience-drafts')
assert.equal((await runtime.invokeTrigger({ trigger: 'inspect-workspace', input: {}, ctx: context })).ok, true)
assert.equal((await runtime.invokeTrigger({ trigger: 'inspect-workspace', input: { includeSnapshot: true }, ctx: context })).ok, true)
assert.equal((await runtime.invokeTrigger({ trigger: 'inspect-workspace', input: { includeSnapshot: 'true' }, ctx: context })).ok, false)
assert.equal((await runtime.invokeTrigger({ trigger: 'navigate-character', input: { destination: 'characters' }, ctx: context })).ok, true)
const profile = { characterId: 'character:triggered', expectedRevision: 1, name: 'Renamed', backstory: 'Line one.\n\nLine two.', attributes: { courage: 8, nocturnal: true } }
assert.equal((await runtime.invokeTrigger({ trigger: 'update-character-profile', input: profile, ctx: context })).ok, true)
assert.deepEqual(profileInput, profile)
assert.equal((await runtime.invokeTrigger({ trigger: 'create-local-companion', input: { draftId: 'draft:triggered' }, ctx: context })).ok, true)
const candidate = {
  name: 'Triggered', seed: (await loadFocusStudioFixture()).starter.directions[0]!.seed,
  initialStageId: 'start', metrics: { xp: 0 }, flags: {}, itemDefinitions: [],
  stages: [{ id: 'start', title: 'Start', narrative: 'Begin.', actions: [], progress: [] }],
  rules: [{
    ruleId: 'nested', priority: 1,
    when: { not: { all: [{ fact: 'metric', id: 'xp', op: 'lt', value: 1 }] } },
    effects: [{ type: 'setFlag', flagId: 'done', value: true }],
  }],
}
const submission = await runtime.invokeTrigger({
  trigger: 'submit-experience-candidate',
  input: { draftId: 'draft:triggered', expectedRevision: 0, expectedCharacterUpdatedAt: 1, idempotencyKey: 'once', candidate },
  ctx: context,
})
assert.equal(submission.ok, true)
assert.deepEqual(submittedInput, { draftId: 'draft:triggered', expectedRevision: 0, expectedCharacterUpdatedAt: 1, idempotencyKey: 'once', candidate })
submittedInput = undefined
const invalid = await runtime.invokeTrigger({
  trigger: 'submit-experience-candidate',
  input: {
    draftId: 'draft:triggered', expectedRevision: 0, expectedCharacterUpdatedAt: 1, idempotencyKey: 'invalid',
    candidate: {
      name: 'Invalid', seed: candidate.seed, initialStageId: 'start', metrics: {},
      stages: [{ id: 'start', title: 'Start', narrative: 'Begin.', actions: [], progress: [] }],
      rules: [{ ruleId: 'open', priority: 1, when: { fact: 'invented' }, effects: [] }],
    },
  },
  ctx: context,
})
assert.equal(invalid.ok, false)
assert.equal(submittedInput, undefined)
assert.equal((await runtime.invokeTrigger({ trigger: 'inspect-experience-contract', input: { draftId: 'draft:triggered' }, ctx: context })).ok, true)
assert.equal((await runtime.invokeTrigger({ trigger: 'inspect-character-contract', input: { characterId: 'character:triggered' }, ctx: context })).ok, true)
const character = {
  characterId: 'character:triggered',
  group: 'body', variantId: 'base', label: 'Base', layer: 'body',
  expectedRevision: 1, expectedAssetSha256: null,
  filename: 'base.png', dataUrl: 'data:image/png;base64,AAAA',
}
assert.equal((await runtime.invokeTrigger({ trigger: 'replace-character-asset', input: character, ctx: context })).ok, true)
assert.deepEqual(replacementInput, character)
replacementInput = undefined
const normalizedCharacter = { ...character, normalization: { resize: 'exact-aspect-downscale', align: 'none' } }
assert.equal((await runtime.invokeTrigger({ trigger: 'replace-character-asset', input: normalizedCharacter, ctx: context })).ok, true)
assert.deepEqual(replacementInput, normalizedCharacter)
replacementInput = undefined
assert.equal((await runtime.invokeTrigger({
  trigger: 'replace-character-asset', input: { ...character, normalization: { resize: 'crop', align: 'none' } }, ctx: context,
})).ok, false)
assert.equal(replacementInput, undefined)
assert.equal((await runtime.invokeTrigger({
  trigger: 'replace-character-asset', input: { ...character, group: 'hat' }, ctx: context,
})).ok, false)
assert.equal(replacementInput, undefined)
const repair = { ...character, group: 'expression', variantId: 'happy', layer: 'head', expectedAssetSha256: 'a'.repeat(64) }
assert.equal((await runtime.invokeTrigger({ trigger: 'repair-character-asset', input: repair, ctx: context })).ok, true)
assert.deepEqual(repairInput, repair)
repairInput = undefined
assert.equal((await runtime.invokeTrigger({ trigger: 'repair-character-asset', input: { ...repair, group: 'outfit', layer: 'body' }, ctx: context })).ok, false)
assert.equal(repairInput, undefined)
const transform = { characterId: 'character:triggered', group: 'expression', variantId: 'happy', expectedRevision: 1, x: 2, y: -3, scale: 1.01 }
assert.equal((await runtime.invokeTrigger({ trigger: 'set-character-variant-transform', input: transform, ctx: context })).ok, true)
assert.deepEqual(transformInput, transform)
console.log('authoring triggers: ok')

assert.equal((await runtime.invokeTrigger({ trigger: 'update-collection-profile', input: { collectionId: 'default', expectedRevision: 0, backstory: 'Shared world' }, ctx: context })).ok, true)
assert.equal((await runtime.invokeTrigger({ trigger: 'update-collection-profile', input: { collectionId: 'default', expectedRevision: 0, backstory: 'x'.repeat(8001) }, ctx: context })).ok, false)
