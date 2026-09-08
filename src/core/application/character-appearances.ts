import type { CharacterAssetContent, CharacterDraft, CharacterSelection } from '../domain/character.ts'
import { validateModelSheet } from './character-model-sheet.ts'

export const activeCharacterAppearance = (draft: Pick<CharacterDraft, 'appearances' | 'activeAppearanceId'>) =>
  draft.appearances?.find(({ id }) => id === draft.activeAppearanceId)

export const sameCharacterSelection = (left: CharacterSelection, right: CharacterSelection) =>
  left.expression === right.expression && left.outfit === right.outfit &&
  left.props.length === right.props.length && left.props.every((id, index) => id === right.props[index])

/** Appearance saves a combination of existing variants, not another copy of their pixels. */
export function validateCharacterAppearances(draft: CharacterAssetContent<unknown> & { activeAppearanceId?: string }) {
  if (draft.appearances !== undefined && (!Array.isArray(draft.appearances) || draft.appearances.length > 100)) throw new Error('Invalid Appearances')
  const ids = new Set<string>()
  for (const appearance of draft.appearances ?? []) {
    if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance) ||
      Object.keys(appearance).some((key) => !['id', 'label', 'selected', 'modelSheet'].includes(key)) ||
      typeof appearance.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(appearance.id) || ids.has(appearance.id) ||
      typeof appearance.label !== 'string' || !appearance.label.trim() || appearance.label.length > 80) throw new Error('Invalid or duplicate Appearance')
    ids.add(appearance.id)
    const selected = appearance.selected
    const has = (group: string, id: unknown) => typeof id === 'string' && draft.variants.some((variant) => variant.group === group && variant.id === id)
    if (!selected || typeof selected !== 'object' || Array.isArray(selected) ||
      Object.keys(selected).some((key) => !['expression', 'outfit', 'props'].includes(key)) ||
      !Array.isArray(selected.props) || selected.props.length > 100 || new Set(selected.props).size !== selected.props.length ||
      selected.props.some((id) => !has('prop', id)) ||
      (selected.expression !== undefined && !has('expression', selected.expression)) ||
      (selected.outfit !== undefined && !has('outfit', selected.outfit))) throw new Error('Appearance references a missing or invalid variant')
    if (appearance.modelSheet !== undefined) {
      validateModelSheet(appearance.modelSheet)
      if ('heightCm' in appearance.modelSheet) throw new Error('Height belongs to the character, not an Appearance')
    }
  }
  if (draft.activeAppearanceId !== undefined && !ids.has(draft.activeAppearanceId)) throw new Error('Active Appearance is missing')
}

export type CharacterAppearanceCommand = { action: 'save' | 'select' | 'rename'; id: string; label?: string }
export function changeCharacterAppearance(draft: CharacterDraft, command: CharacterAppearanceCommand): CharacterDraft {
  const { action, id, label } = command
  const existing = draft.appearances?.find((appearance) => appearance.id === id)
  let next: CharacterDraft
  if (action === 'save') {
    if (existing) throw new Error('Appearance already exists; save with a new ID to preserve its references')
    const first = !draft.appearances?.length
    const { heightCm, ...references } = draft.modelSheet ?? { views: {} }
    next = { ...draft, activeAppearanceId: id,
      appearances: [...draft.appearances ?? [], { id, label: label?.trim() ?? '', selected: structuredClone(draft.selected),
        ...(first && draft.modelSheet ? { modelSheet: references } : {}) }],
      ...(first && draft.modelSheet ? { modelSheet: { views: {}, ...(heightCm !== undefined ? { heightCm } : {}) } } : {}),
    }
  } else {
    if (!existing) throw new Error('Appearance not found')
    if (action === 'select') {
      if (label !== undefined) throw new Error('Selecting an Appearance does not rename it')
      if (draft.activeAppearanceId === id && sameCharacterSelection(draft.selected, existing.selected)) return draft
      next = { ...draft, activeAppearanceId: id, selected: structuredClone(existing.selected) }
    } else if (action === 'rename') {
      if (existing.label === label?.trim()) return draft
      next = { ...draft, appearances: draft.appearances!.map((appearance) => appearance === existing ? { ...appearance, label: label?.trim() ?? '' } : appearance) }
    } else throw new Error('Unknown Appearance action')
  }
  validateCharacterAppearances(next)
  return next
}
