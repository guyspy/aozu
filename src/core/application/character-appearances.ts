import { CHARACTER_OUTFIT_SLOTS, type CharacterAssetContent, type CharacterDraft, type CharacterSelection } from '../domain/character.ts'
import { validateModelSheet } from './character-model-sheet.ts'

export const activeCharacterAppearance = (draft: Pick<CharacterDraft, 'appearances' | 'activeAppearanceId'>) =>
  draft.appearances?.find(({ id }) => id === draft.activeAppearanceId)

/** Adopt legacy working art in memory; the next real edit persists it through the normal save. */
export const withDefaultCharacterAppearance = (draft: CharacterDraft): CharacterDraft => draft.appearances?.length ? draft
  : changeCharacterAppearance(draft, { action: 'save-as', id: 'default', label: 'Default' })

export const sameCharacterSelection = (left: CharacterSelection, right: CharacterSelection) =>
  left.expression === right.expression && left.hair === right.hair && left.headwear === right.headwear &&
  JSON.stringify(left.outfits) === JSON.stringify(right.outfits) &&
  left.props.length === right.props.length && left.props.every((id, index) => id === right.props[index])

export function validateCharacterSelection(draft: CharacterAssetContent<unknown>, selected: CharacterSelection): void {
  const has = (group: string, id: unknown) => typeof id === 'string' && draft.variants.some((variant) => variant.group === group && variant.id === id)
  if (!selected || typeof selected !== 'object' || Array.isArray(selected) ||
    Object.keys(selected).some((key) => !['expression', 'outfits', 'hair', 'headwear', 'props'].includes(key)) ||
    !selected.outfits || typeof selected.outfits !== 'object' || Array.isArray(selected.outfits) ||
    Object.keys(selected.outfits).some((slot) => !CHARACTER_OUTFIT_SLOTS.includes(slot as typeof CHARACTER_OUTFIT_SLOTS[number])) ||
    !Array.isArray(selected.props) || selected.props.length > 100 || new Set(selected.props).size !== selected.props.length ||
    selected.props.some((id) => !has('prop', id)) ||
    (selected.expression !== undefined && !has('expression', selected.expression)) ||
    (selected.hair !== undefined && !has('hair', selected.hair)) ||
    (selected.headwear !== undefined && !has('headwear', selected.headwear))) throw new Error('Appearance references a missing or invalid variant')
  for (const [slot, id] of Object.entries(selected.outfits)) {
    const variant = draft.variants.find((candidate) => candidate.group === 'outfit' && candidate.id === id)
    if (!variant || variant.metadata?.outfit?.slot !== slot) throw new Error('Appearance references a missing or invalid outfit slot')
  }
  if (selected.outfits['one-piece'] && (selected.outfits.top || selected.outfits.bottom)) throw new Error('One-piece outfits replace top and bottom')
}

/** The top-level selection is the current editor's projection of its named Appearance. */
export function saveCurrentCharacterAppearance(draft: CharacterDraft): CharacterDraft {
  const active = activeCharacterAppearance(draft)
  if (!active || sameCharacterSelection(active.selected, draft.selected)) return draft
  return { ...draft, appearances: draft.appearances!.map((appearance) => appearance === active
    ? { ...appearance, selected: structuredClone(draft.selected) } : appearance) }
}

export function sameAppearanceEdit(left: CharacterDraft | null, right: CharacterDraft | null) {
  if (!left || !right) return left === right
  const a = activeCharacterAppearance(left), b = activeCharacterAppearance(right)
  const aSheet = a?.modelSheet ?? left.modelSheet, bSheet = b?.modelSheet ?? right.modelSheet
  return left.variants === right.variants && left.headRegistration === right.headRegistration &&
    sameCharacterSelection(left.selected, right.selected) && a?.label === b?.label &&
    sameReferenceMap(aSheet?.views, bSheet?.views) && sameReferenceMap(aSheet?.references, bSheet?.references)
}

const sameReferenceMap = (left?: object, right?: object) => left === right ||
  !Object.keys(left ?? {}).length && !Object.keys(right ?? {}).length

/** Undo affects Appearance art and references; current profile, shared height and other looks survive. */
export function restoreCharacterAppearance(current: CharacterDraft, saved: CharacterDraft): CharacterDraft {
  const appearance = activeCharacterAppearance(saved)
  return { ...current, variants: saved.variants, headRegistration: saved.headRegistration, selected: saved.selected,
    ...(appearance ? { appearances: current.appearances!.map((item) => item.id === appearance.id ? appearance : item) }
      : { modelSheet: { ...saved.modelSheet, views: saved.modelSheet?.views ?? {}, heightCm: current.modelSheet?.heightCm } }),
  }
}

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
    validateCharacterSelection(draft, appearance.selected)
    if (appearance.modelSheet !== undefined) {
      validateModelSheet(appearance.modelSheet)
      if ('heightCm' in appearance.modelSheet) throw new Error('Height belongs to the character, not an Appearance')
    }
  }
  if (draft.activeAppearanceId !== undefined && !ids.has(draft.activeAppearanceId)) throw new Error('Active Appearance is missing')
}

export type CharacterAppearanceCommand = { action: 'create' | 'save-as' | 'select' | 'rename' | 'delete'; id: string; label?: string }
export function changeCharacterAppearance(draft: CharacterDraft, command: CharacterAppearanceCommand): CharacterDraft {
  const { action, id, label } = command
  const existing = draft.appearances?.find((appearance) => appearance.id === id)
  let next: CharacterDraft
  if (action === 'save-as' || action === 'create') {
    if (existing) throw new Error('Appearance already exists; save with a new ID to preserve its references')
    if (action === 'create') draft = withDefaultCharacterAppearance(draft)
    const first = !draft.appearances?.length
    const selected = action === 'create' ? { outfits: {}, props: [] } : draft.selected
    const { heightCm, ...references } = draft.modelSheet ?? { views: {} }
    next = { ...draft, activeAppearanceId: id, selected,
      appearances: [...draft.appearances ?? [], { id, label: label?.trim() ?? '', selected: structuredClone(selected),
        ...(action === 'create' ? { modelSheet: { views: {} } } : first && draft.modelSheet ? { modelSheet: references } : {}) }],
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
    } else if (action === 'delete') {
      if (label !== undefined) throw new Error('Deleting an Appearance does not rename it')
      const appearances = draft.appearances!.filter((appearance) => appearance !== existing)
      if (!appearances.length) throw new Error('Keep at least one Appearance')
      next = { ...draft, appearances, ...(draft.activeAppearanceId === id
        ? { activeAppearanceId: appearances[0].id, selected: structuredClone(appearances[0].selected) } : {}) }
    } else throw new Error('Unknown Appearance action')
  }
  validateCharacterAppearances(next)
  return next
}
