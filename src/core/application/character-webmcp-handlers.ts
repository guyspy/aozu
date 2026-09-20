import { sameItem, setSmartOrder } from '../domain/character-composition.ts'
import { readWorkspaceView } from '../../adapters/webmcp/controller.ts'
import { changeCharacterAppearance, type CharacterAppearanceCommand } from './character-appearances.ts'
import { activateCharacterVariant, deactivateCharacterVariant, resolveCharacterDraftPlacements, updateCharacterProfile, updateCharacterVariantMetadata } from './character-creation.ts'
import type { CharacterProfilePatch, CharacterVariantGroup, CharacterVariantProfilePatch } from '../domain/character.ts'

import { createCharacterContractHandlers } from './character-contract-handlers.ts'
import { createCharacterAssetHandlers } from './character-asset-handlers.ts'
import { describeAppearances, describeModelSheet, type CharacterWebMcpDependencies } from './character-webmcp-shared.ts'

export function createCharacterWebMcpHandlers(dependencies: CharacterWebMcpDependencies) {
  const { document, editor, activeCharacter, settledRevision, characterNextActions, characterPath, historyStatus, routeSelection, currentPath } = dependencies
  async function updateProfile(rawInput: unknown) {
    const { characterId, expectedRevision, ...patch } = rawInput as CharacterProfilePatch & { characterId: string; expectedRevision: number }
    if (!Object.keys(patch).length) throw new Error('At least one Character profile field is required')
    if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or cancel local unsaved input before editing the Character profile')
    await editor.open(characterId)
    const changed = await editor.dispatch((character) => updateCharacterProfile(character, patch), expectedRevision)
    const character = activeCharacter().character
    const revision = settledRevision('Character profile')
    const path = `/characters/${encodeURIComponent(character.id)}/profile`
    return {
      status: 'ok',
      data: {
        characterId: character.id,
        profile: {
          name: character.name,
          description: character.description ?? '',
          backstory: character.backstory ?? '',
          attributes: character.attributes ?? {},
          heightCm: character.modelSheet?.heightCm ?? null,
        },
        revision,
        changed,
      },
      nextActions: characterNextActions(character),
      effects: { navigation: { path, mode: 'push', reason: 'Open the updated Character profile.' } },
    }
  }

  async function updateVariantMetadata(rawInput: unknown) {
    const { characterId, expectedRevision, group, variantId, ...patch } = rawInput as CharacterVariantProfilePatch & {
      characterId: string; expectedRevision: number; group: CharacterVariantGroup; variantId: string
    }
    if (!Object.keys(patch).length) throw new Error('At least one metadata field is required')
    if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or cancel local unsaved input before editing variant metadata')
    await editor.open(characterId)
    const created = !activeCharacter().character.variants.some((item) => item.group === group && item.id === variantId)
    const changed = await editor.dispatch((character) => updateCharacterVariantMetadata(character, group, variantId, patch), expectedRevision)
    const character = activeCharacter().character
    return {
      status: 'ok',
      data: { characterId: character.id, variant: character.variants.find((item) => item.group === group && item.id === variantId), faceStyles: character.faceStyles, revision: settledRevision('Character variant metadata'), created, changed },
      nextActions: [{ tool: 'inspect_character_contract', required: true, reason: 'Read the updated metadata status and exact revision before submitting pixels.', input: { characterId: character.id, scope: 'appearance', group, variantId, layer: group === 'body' ? 'body' : group === 'expression' ? 'head' : 'front' } }],
      effects: { navigation: { path: characterPath(character.id, group, variantId), mode: 'push', reason: 'Review the updated variant metadata.' } },
    }
  }

  async function applyCharacterAppearance(characterId: string, command: CharacterAppearanceCommand, expectedRevision: number) {
    await editor.open(characterId)
    const { character, revision } = activeCharacter()
    if (revision !== expectedRevision) throw new Error('Character changed; inspect it again')
    const next = changeCharacterAppearance(character, command)
    const changed = await editor.dispatch((current) => {
      if (current !== character) throw new Error('Character changed; inspect it again')
      return next
    }, expectedRevision)
    settledRevision('Appearance')
    return changed
  }

  async function setCharacterSelection(rawInput: unknown) {
    const { characterId, expectedRevision, group, variantId, active, appearance, smartOrder } = rawInput as {
      characterId: string
      expectedRevision: number
      group: 'expression' | 'outfit' | 'hair' | 'headwear' | 'prop'
      variantId: string
      active: boolean
      smartOrder?: boolean
      appearance?: CharacterAppearanceCommand
    }
    const hasItem = group !== undefined || variantId !== undefined || active !== undefined
    if (Number(Boolean(appearance)) + Number(smartOrder !== undefined) + Number(hasItem) !== 1 ||
      hasItem && (!['expression', 'outfit', 'hair', 'headwear', 'prop'].includes(group) || typeof variantId !== 'string' || typeof active !== 'boolean') ||
      smartOrder !== undefined && typeof smartOrder !== 'boolean') throw new Error('Choose one: appearance, smartOrder, or group/variantId/active')
    if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or cancel local unsaved input before changing Appearance')
    await editor.open(characterId)
    const before = activeCharacter().character.selected.items
    const target = { group, id: variantId }
    const changed = appearance ? await applyCharacterAppearance(characterId, appearance, expectedRevision)
      : await editor.dispatch((character) => smartOrder !== undefined
      ? character.selected.smartOrder === smartOrder ? character : { ...character, selected: setSmartOrder(character.variants, character.selected, smartOrder) } : active
      ? activateCharacterVariant(character, target)
      : deactivateCharacterVariant(character, target), expectedRevision)
    const character = activeCharacter().character
    return {
      status: 'ok',
      data: {
        characterId: character.id,
        selected: character.selected,
        removed: before.filter((item) => !character.selected.items.some((ref) => sameItem(item, ref))),
        paintOrder: resolveCharacterDraftPlacements(character).map(({ variant, layer }) => ({ group: variant.group, id: variant.id, layer })),
        ...describeAppearances(character),
        modelSheet: describeModelSheet(character),
        revision: settledRevision('Character selection'),
        changed,
      },
      nextActions: characterNextActions(character),
      effects: { navigation: { path: smartOrder !== undefined ? currentPath() : characterPath(character.id, appearance ? 'expression' : group), mode: 'push', reason: 'Show the selected Character composition.' } },
    }
  }

  let assets!: ReturnType<typeof createCharacterAssetHandlers>
  const contracts = createCharacterContractHandlers(dependencies, (...args) => assets.mutateCharacterAsset(...args))
  assets = createCharacterAssetHandlers(dependencies, contracts)

  function characterHistoryTool(direction: 'undo' | 'redo') {
    return async (rawInput: unknown) => {
      const input = rawInput as { characterId: string; expectedRevision: number }
      const state = editor.store.getState()
      const history = historyStatus()
      if (state.activeCharacterId !== input.characterId || !state.character) return { status: 'no_active_history', data: history }
      if (state.saveStatus !== 'saved') return { status: 'not_settled', data: history }
      if (state.persistedRevision !== input.expectedRevision) return { status: 'revision_conflict', data: history }
      if (!(direction === 'undo' ? history.canUndo : history.canRedo)) return { status: `nothing_to_${direction}`, data: history }
      await editor[direction]()
      settledRevision(`Character ${direction}`)
      const route = currentPath()
      const path = routeSelection(route)?.characterId === input.characterId ? route : characterPath(input.characterId)
      return {
        status: 'ok',
        data: { ...historyStatus(), characterId: input.characterId },
        effects: { navigation: { path, mode: 'push', reason: `Review the Character after ${direction}.` } },
      }
    }
  }

  return {
    updateProfile,
    updateVariantMetadata,
    applyCharacterAppearance,
    setCharacterSelection,
    characterFit: contracts.characterFit,
    inspectCharacterContract: contracts.inspectCharacterContract,
    updateModelSheet: assets.updateModelSheet,
    replaceCharacterAssetTool: assets.replaceCharacterAssetTool,
    repairCharacterAssetTool: assets.repairCharacterAssetTool,
    mutateCharacterAsset: assets.mutateCharacterAsset,
    setCharacterTransform: assets.setCharacterTransform,
    characterHistoryTool,
  }
}
